import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EXAMPLE_AMERICAN_IPA } from "../dist/example-ipa.js";
import { AMERICAN_IPA_POLICY } from "../dist/learning-language.js";
import { microLearningText } from "../dist/vocabulary.js";

async function vocabularySeedKeys() {
  const keys = [];
  for (const file of ["src/seed.ts", "src/b1-vocabulary.ts"]) {
    const source = await readFile(file, "utf8");
    for (const line of source.split("\n")) {
      if (!/^\s*\[\"/.test(line)) continue;
      try {
        keys.push(JSON.parse(line.trim().replace(/,$/, ""))[0]);
      } catch {
        // Bỏ qua các mảng cấu hình không phải tuple từ vựng.
      }
    }
  }
  return keys;
}

test("cả 214 câu ví dụ trong kho từ vựng đều có IPA", async () => {
  const seedKeys = await vocabularySeedKeys();
  assert.equal(seedKeys.length, 214);
  assert.deepEqual(Object.keys(EXAMPLE_AMERICAN_IPA).sort(), [...seedKeys].sort());
  for (const ipa of Object.values(EXAMPLE_AMERICAN_IPA)) {
    assert.match(ipa, /^\/.+\/$/u);
  }
});

test("micro-learning hiển thị riêng IPA của từ và IPA của câu ví dụ", () => {
  const text = microLearningText({
    english_text: "make progress",
    phonetic_text: "/meɪk ˈprɑːɡres/",
    vietnamese_meaning: "tiến bộ",
    example_en: "I make progress every day.",
    example_phonetic_text: "/aɪ meɪk ˈprɑːɡres ˈevri deɪ/",
    example_vi: "Tôi tiến bộ mỗi ngày."
  }, "08:00", "anh");

  assert.match(text, /🔤 make progress\n🗣 IPA \(Mỹ\): \/meɪk ˈprɑːɡres\//);
  assert.match(text, /Ví dụ: I make progress every day\.\n🗣 IPA câu \(Mỹ\): \/aɪ meɪk ˈprɑːɡres ˈevri deɪ\//);
});

test("chính sách yêu cầu IPA cho câu ví dụ và câu bài tập mà không lộ đáp án", () => {
  assert.match(AMERICAN_IPA_POLICY, /câu ví dụ/);
  assert.match(AMERICAN_IPA_POLICY, /câu trong bài tập/);
  assert.match(AMERICAN_IPA_POLICY, /giữ nguyên ______/);
  assert.match(AMERICAN_IPA_POLICY, /Không chép IPA vào khối \[\[tts:text\]\]/);
});
