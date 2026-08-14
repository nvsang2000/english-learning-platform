import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, chmod, writeFile } from "node:fs/promises";
import path from "node:path";

const targetRoot = path.resolve(process.argv[2] || process.cwd());
const gatewayEnvPath = path.join(targetRoot, ".env.antigravity");
const openclawEnvPath = path.join(targetRoot, ".env.openclaw");

async function readRegularFile(filePath) {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing non-regular environment file: ${filePath}`);
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function valueOf(source, name) {
  const match = source.match(new RegExp(`^${name}=([^\\r\\n]*)$`, "m"));
  return match?.[1]?.trim() || "";
}

function setValue(source, name, value) {
  const lines = source.split(/\r?\n/).filter((line) => !line.startsWith(`${name}=`));
  while (lines.at(-1) === "") lines.pop();
  lines.push(`${name}=${value}`, "");
  return lines.join("\n");
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
}

const currentGatewayEnv = await readRegularFile(gatewayEnvPath);
const currentOpenclawEnv = await readRegularFile(openclawEnvPath);
const existingToken = valueOf(currentGatewayEnv, "ANTIGRAVITY_GATEWAY_TOKEN")
  || valueOf(currentOpenclawEnv, "ANTIGRAVITY_GATEWAY_TOKEN");
const token = /^[a-f0-9]{64}$/i.test(existingToken) ? existingToken : randomBytes(32).toString("hex");

const gatewayEnv = [
  `ANTIGRAVITY_GATEWAY_TOKEN=${token}`,
  "ANTIGRAVITY_GATEWAY_BIND=127.0.0.1",
  "ANTIGRAVITY_GATEWAY_PORT=18101",
  "ANTIGRAVITY_BIN=/home/nvsang/.local/bin/agy",
  "ANTIGRAVITY_WORKDIR=/home/nvsang/.openclaw/state/antigravity-english-workspace",
  "ANTIGRAVITY_MODEL=gemini-3.7-flash-low",
  "ANTIGRAVITY_MODEL_ID=antigravity-default",
  "ANTIGRAVITY_MAX_CONCURRENCY=1",
  "ANTIGRAVITY_TIMEOUT_MS=300000",
  "ANTIGRAVITY_MAX_BODY_BYTES=524288",
  ""
].join("\n");

await atomicWrite(gatewayEnvPath, gatewayEnv);
await atomicWrite(openclawEnvPath, setValue(currentOpenclawEnv, "ANTIGRAVITY_GATEWAY_TOKEN", token));
console.log(`Antigravity environment ready in ${targetRoot}; secret value was not printed.`);
