import assert from "node:assert/strict";
import test from "node:test";
import { buildAgyPrompt, parseAgyOutput, toOpenAiMessage } from "../dist/antigravity.js";

test("Antigravity prompt preserves roles and OpenClaw tool schemas", () => {
  const prompt = buildAgyPrompt(
    [
      { role: "system", content: "Luôn trả lời bằng tiếng Việt." },
      { role: "user", content: "Tạo lộ trình cho tôi." }
    ],
    [{ type: "function", function: { name: "learning_setup_plan", description: "Tạo lộ trình", parameters: { type: "object" } } }]
  );
  assert.match(prompt, /learning_setup_plan/);
  assert.match(prompt, /Luôn trả lời bằng tiếng Việt/);
  assert.match(prompt, /Không giả lập kết quả công cụ/);
});

test("Antigravity JSON message maps to an OpenAI assistant message", () => {
  const envelope = parseAgyOutput(JSON.stringify({ result: { structured_output: { type: "message", content: "Xin chào!", tool_calls: [] } } }));
  assert.deepEqual(toOpenAiMessage(envelope), {
    message: { role: "assistant", content: "Xin chào!" },
    finishReason: "stop"
  });
});

test("Antigravity tool request maps to OpenAI tool_calls", () => {
  const envelope = parseAgyOutput(JSON.stringify({
    type: "result",
    output: JSON.stringify({
      type: "tool_calls",
      content: "",
      tool_calls: [{ name: "learning_get_today", arguments: {} }]
    })
  }));
  const mapped = toOpenAiMessage(envelope);
  assert.equal(mapped.finishReason, "tool_calls");
  assert.equal(mapped.message.tool_calls[0].function.name, "learning_get_today");
  assert.equal(mapped.message.tool_calls[0].function.arguments, "{}");
});
