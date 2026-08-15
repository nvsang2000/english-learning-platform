import assert from "node:assert/strict";
import test from "node:test";
import { logGameResult, normalizeTelegramId, setLearnerGender } from "../dist/db.js";

test("Telegram identity normalization accepts only trusted numeric ids", () => {
  assert.equal(normalizeTelegramId("telegram:123456789"), "123456789");
  assert.equal(normalizeTelegramId("user:987654"), "987654");
  assert.throws(() => normalizeTelegramId("telegram:@someone"), /Telegram ID/);
});

test("game results are sanitized and stored against the active enrollment", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO learners")) return { rows: [{ id: "learner-1" }] };
      if (sql.startsWith("SELECT id FROM enrollments")) return { rows: [{ id: "enrollment-1" }] };
      if (sql.includes("INSERT INTO progress_events")) {
        return { rows: [{ id: "event-1", created_at: "2026-08-13T12:00:00Z" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await logGameResult(db, "123456789", {
    gameType: "sentence_race",
    score: 80,
    completed: true,
    correctAnswers: 4,
    totalQuestions: 5,
    note: "  Great round\u0000  "
  });

  assert.equal(result.xpEarned, 36);
  assert.equal(result.note, "Great round");
  assert.equal(calls.at(-1).params[1], "enrollment-1");
  assert.deepEqual(JSON.parse(calls.at(-1).params[2]), {
    gameType: "sentence_race",
    score: 80,
    completed: true,
    correctAnswers: 4,
    totalQuestions: 5,
    note: "Great round",
    xpEarned: 36
  });
});

test("selected gender is stored against the Telegram learner", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ gender_identity: params[1] }] };
    }
  };

  assert.deepEqual(await setLearnerGender(db, "123456789", "female"), {
    gender: "female",
    address: "chị"
  });
  assert.deepEqual(calls[0].params, ["123456789", "female"]);
  await assert.rejects(() => setLearnerGender(db, "123456789", "unknown"), /không hợp lệ/);
});
