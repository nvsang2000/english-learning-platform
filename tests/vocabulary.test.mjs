import assert from "node:assert/strict";
import test from "node:test";
import { preferredVocabularyCategories, weeklyVocabularySummaryText } from "../dist/vocabulary.js";
import { isWeeklySummaryWindow, vietnamWeekRange } from "../dist/schedule.js";

test("mỗi khóa học ưu tiên đúng nhóm từ vựng", () => {
  assert.deepEqual(preferredVocabularyCategories("b1").slice(0, 2), ["b1-core", "study"]);
  assert.deepEqual(preferredVocabularyCategories("workplace").slice(0, 2), ["work", "b1-core"]);
  assert.deepEqual(preferredVocabularyCategories("travel").slice(0, 2), ["travel", "daily-life"]);
});

test("tổng kết tuần chạy tối Chủ nhật theo giờ Việt Nam", () => {
  const sundayAt2215Vietnam = new Date("2026-08-16T15:15:00.000Z");
  assert.equal(isWeeklySummaryWindow(sundayAt2215Vietnam), true);
  assert.deepEqual(vietnamWeekRange(sundayAt2215Vietnam), { start: "2026-08-10", end: "2026-08-16" });
  assert.equal(isWeeklySummaryWindow(new Date("2026-08-15T15:15:00.000Z")), false);
});

test("bản tổng kết có số lượng, IPA và không vượt giới hạn Telegram", () => {
  const items = Array.from({ length: 220 }, (_, index) => ({
    english_text: `word-${index}`,
    phonetic_text: "/wɜːrd/",
    vietnamese_meaning: `từ số ${index}`,
    category: index % 2 ? "daily-life" : "b1-core"
  }));
  const text = weeklyVocabularySummaryText(items, "2026-08-10", "2026-08-16");
  assert.match(text, /Đã học 220 từ\/cụm từ không trùng lặp/);
  assert.match(text, /B1 cốt lõi: 110/);
  assert.match(text, /\/wɜːrd\//);
  assert.ok(text.length <= 3400);
});
