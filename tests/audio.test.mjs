import assert from "node:assert/strict";
import test from "node:test";
import {
  deliberateSpeechSegments,
  EXERCISE_PAUSE_SECONDS,
  extractExerciseAudioText,
  LEARNING_TTS_RATE,
  SENTENCE_PAUSE_SECONDS,
  stripExerciseAudioDirectives,
  vocabularyAudioFileName
} from "../dist/audio.js";

test("audio định kỳ dùng tên từ vựng an toàn", () => {
  assert.equal(vocabularyAudioFileName("Effective"), "effective.mp3");
  assert.equal(vocabularyAudioFileName("take off"), "take-off.mp3");
});

test("bài tập chỉ lấy câu cần đọc và bỏ qua đáp án dùng để đối chiếu", () => {
  const reply = `Đáp án chuẩn:\n"I usually drink coffee, but today I am drinking tea."\n\nCâu 2:\n"Yesterday, we ________ (go) home and ________ (buy) fruit."`;
  assert.equal(
    extractExerciseAudioText(reply),
    "Yesterday, we ________ (go) home and ________ (buy) fruit."
  );
});

test("khối TTS ẩn tạo audio nhưng không lặp lại trong nội dung Telegram", () => {
  const reply = `Hãy đọc câu sau:\nShe works from home.\n[[tts:text]]She works from home.[[/tts:text]]`;
  assert.equal(extractExerciseAudioText(reply), "She works from home.");
  assert.equal(stripExerciseAudioDirectives(reply), "Hãy đọc câu sau:\nShe works from home.");
});

test("chỗ trống và gợi ý được đổi thành khoảng nghỉ ba giây", () => {
  assert.equal(EXERCISE_PAUSE_SECONDS, 3);
  assert.deepEqual(
    deliberateSpeechSegments("Yesterday, we ________ (go) to the supermarket and ________ (buy) some fresh fruits."),
    ["Yesterday, we", "to the supermarket and", "some fresh fruits."]
  );
});

test("audio chậm và tách các câu để chèn khoảng nghỉ", () => {
  assert.equal(LEARNING_TTS_RATE, "-20%");
  assert.equal(SENTENCE_PAUSE_SECONDS, 2);
  assert.deepEqual(
    deliberateSpeechSegments(["effective", "This method works. It saves time!"]),
    ["effective", "This method works.", "It saves time!"]
  );
});
