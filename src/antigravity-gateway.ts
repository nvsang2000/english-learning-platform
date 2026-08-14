import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  ASSISTANT_OUTPUT_SCHEMA,
  buildAgyPrompt,
  parseAgyOutput,
  toOpenAiMessage,
  type ChatMessage,
  type ChatTool
} from "./antigravity.js";

const execFileAsync = promisify(execFile);

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(raw) || raw < 1) return fallback;
  return Math.min(raw, maximum);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

const bindAddress = process.env.ANTIGRAVITY_GATEWAY_BIND?.trim() || "127.0.0.1";
if (!new Set(["127.0.0.1", "::1", "localhost"]).has(bindAddress)) {
  throw new Error("ANTIGRAVITY_GATEWAY_BIND chỉ được phép là địa chỉ loopback.");
}
const port = positiveInteger("ANTIGRAVITY_GATEWAY_PORT", 18101, 65_535);
const gatewayToken = requireEnv("ANTIGRAVITY_GATEWAY_TOKEN");
const agyBin = process.env.ANTIGRAVITY_BIN?.trim() || "agy";
const agyModel = process.env.ANTIGRAVITY_MODEL?.trim() || "";
const publicModelId = process.env.ANTIGRAVITY_MODEL_ID?.trim() || "antigravity-default";
const workdir = path.resolve(process.env.ANTIGRAVITY_WORKDIR?.trim() || process.cwd());
const timeoutMs = positiveInteger("ANTIGRAVITY_TIMEOUT_MS", 300_000, 900_000);
const maxConcurrency = positiveInteger("ANTIGRAVITY_MAX_CONCURRENCY", 1, 8);
const maxBodyBytes = positiveInteger("ANTIGRAVITY_MAX_BODY_BYTES", 512 * 1024, 2 * 1024 * 1024);
let activeRequests = 0;

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function errorBody(message: string, type = "gateway_error") {
  return { error: { message, type } };
}

function authorized(req: IncomingMessage): boolean {
  const value = String(req.headers.authorization ?? "");
  const expected = `Bearer ${gatewayToken}`;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") throw error;
    throw new Error("INVALID_JSON");
  }
}

async function runAgy(messages: ChatMessage[], tools: ChatTool[]): Promise<ReturnType<typeof toOpenAiMessage>> {
  const prompt = buildAgyPrompt(messages, tools);
  const args = [
    "--print", prompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(ASSISTANT_OUTPUT_SCHEMA),
    "--sandbox",
    "--disable-slash-commands",
    "--print-timeout", `${Math.ceil(timeoutMs / 1000)}s`
  ];
  if (agyModel) args.push("--model", agyModel);
  const result = await execFileAsync(agyBin, args, {
    cwd: workdir,
    timeout: timeoutMs + 5_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  return toOpenAiMessage(parseAgyOutput(result.stdout));
}

function streamCompletion(
  res: ServerResponse,
  requestId: string,
  model: string,
  message: Record<string, unknown>,
  finishReason: "stop" | "tool_calls"
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const created = Math.floor(Date.now() / 1000);
  const delta = { ...message };
  delete delta.role;
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls = delta.tool_calls.map((call, index) => ({ index, ...(call as Record<string, unknown>) }));
  }
  res.write(`data: ${JSON.stringify({ id: requestId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: requestId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = `chatcmpl-${randomUUID().replaceAll("-", "")}`;
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { status: "ok", activeRequests, maxConcurrency, model: publicModelId });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, errorBody("Bearer token không hợp lệ.", "authentication_error"));
    return;
  }
  if (req.method === "GET" && pathname === "/v1/models") {
    json(res, 200, { object: "list", data: [{ id: publicModelId, object: "model", created: 0, owned_by: "google-antigravity" }] });
    return;
  }
  if (req.method !== "POST" || pathname !== "/v1/chat/completions") {
    json(res, 404, errorBody("Endpoint không tồn tại.", "not_found"));
    return;
  }
  if (activeRequests >= maxConcurrency) {
    res.setHeader("retry-after", "5");
    json(res, 429, errorBody("Antigravity gateway đang bận, hãy thử lại sau.", "rate_limit_error"));
    return;
  }

  activeRequests += 1;
  try {
    const body = await readJsonBody(req);
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      json(res, 400, errorBody("messages phải là một mảng không rỗng.", "invalid_request_error"));
      return;
    }
    const messages = body.messages as ChatMessage[];
    const tools = Array.isArray(body.tools) ? body.tools as ChatTool[] : [];
    const model = typeof body.model === "string" && body.model.trim() ? body.model : publicModelId;
    if (model !== publicModelId) {
      json(res, 404, errorBody(`Model không tồn tại: ${model}`, "invalid_request_error"));
      return;
    }
    const completion = await runAgy(messages, tools);
    if (body.stream === true) {
      streamCompletion(res, requestId, model, completion.message, completion.finishReason);
      return;
    }
    json(res, 200, {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: completion.message, finish_reason: completion.finishReason }]
    });
    console.log(`${requestId} completed in ${Date.now() - startedAt}ms (${completion.finishReason})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "BODY_TOO_LARGE" ? 413 : message === "INVALID_JSON" ? 400 : /timed out|TIMEOUT/i.test(message) ? 504 : 502;
    console.error(`${requestId} failed in ${Date.now() - startedAt}ms: ${message.slice(0, 1000)}`);
    if (!res.headersSent) json(res, status, errorBody(status === 502 ? "Antigravity không xử lý được yêu cầu." : message));
    else res.end();
  } finally {
    activeRequests -= 1;
  }
});

server.requestTimeout = timeoutMs + 15_000;
server.headersTimeout = 15_000;
server.listen(port, bindAddress, () => {
  console.log(`Antigravity gateway listening on http://${bindAddress}:${port}/v1 (model=${publicModelId}, concurrency=${maxConcurrency})`);
});

function shutdown(signal: string): void {
  console.log(`Stopping Antigravity gateway (${signal})...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
