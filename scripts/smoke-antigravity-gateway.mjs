import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const token = randomBytes(32).toString("hex");
const port = 18102;
const child = spawn(process.execPath, ["dist/antigravity-gateway.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ANTIGRAVITY_GATEWAY_TOKEN: token,
    ANTIGRAVITY_GATEWAY_PORT: String(port),
    ANTIGRAVITY_BIN: process.env.ANTIGRAVITY_BIN || "/home/nvsang/.local/bin/agy",
    ANTIGRAVITY_MODEL: process.env.ANTIGRAVITY_MODEL || "gemini-3.7-flash-low",
    ANTIGRAVITY_MODEL_ID: "antigravity-default",
    ANTIGRAVITY_MAX_CONCURRENCY: "1",
    ANTIGRAVITY_TIMEOUT_MS: "120000"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

async function waitUntilReady() {
  const deadline = Date.now() + 10_000;
  while (!stdout.includes("gateway listening")) {
    if (child.exitCode !== null) throw new Error(`Gateway exited early: ${stderr || stdout}`);
    if (Date.now() > deadline) throw new Error(`Gateway did not become ready: ${stderr || stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await waitUntilReady();
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  if (health.status !== "ok") throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "antigravity-default",
      stream: false,
      messages: [
        { role: "system", content: "Trả lời ngắn gọn bằng tiếng Việt." },
        { role: "user", content: "Chỉ trả lời: Gateway hoạt động." }
      ]
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Gateway request failed (${response.status}): ${JSON.stringify(body)}`);
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) throw new Error(`Missing assistant content: ${JSON.stringify(body)}`);

  const toolResponse = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "antigravity-default",
      stream: false,
      messages: [
        { role: "system", content: "Khi người dùng yêu cầu xem tiến độ, bắt buộc gọi learning_get_progress và không tự bịa dữ liệu." },
        { role: "user", content: "Cho tôi xem tiến độ học." }
      ],
      tools: [{
        type: "function",
        function: {
          name: "learning_get_progress",
          description: "Đọc tiến độ học của người đang chat.",
          parameters: { type: "object", additionalProperties: false, properties: {} }
        }
      }]
    })
  });
  const toolBody = await toolResponse.json();
  if (!toolResponse.ok) throw new Error(`Tool request failed (${toolResponse.status}): ${JSON.stringify(toolBody)}`);
  const toolCall = toolBody.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.name !== "learning_get_progress") {
    throw new Error(`Missing expected tool call: ${JSON.stringify(toolBody)}`);
  }
  console.log(JSON.stringify({
    health,
    message: { model: body.model, finishReason: body.choices[0].finish_reason, content },
    toolCall: { finishReason: toolBody.choices[0].finish_reason, name: toolCall.function.name, arguments: toolCall.function.arguments }
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000).unref();
  });
}
