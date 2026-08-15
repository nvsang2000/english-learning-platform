import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deliberateSpeechSegments, synthesizeLearningAudio, vocabularyAudioFileName } from "./audio.js";
import { databasePool, ensureTodayLesson } from "./db.js";
import { addressForGender, capitalizeAddress, morningCheckIn } from "./persona.js";
import {
  currentMicroSlot,
  DAILY_REMINDER_MINUTES,
  isNotificationDeliveryWindow,
  isWeeklySummaryWindow,
  VIETNAM_TIMEZONE,
  vietnamNow,
  vietnamWeekRange
} from "./schedule.js";
import { preferredVocabularyCategories, weeklyVocabularySummaryText } from "./vocabulary.js";

const execFileAsync = promisify(execFile);
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

const databaseUrl = requireEnv("ENGLISH_LEARNING_DATABASE_URL");
const rabbitUrl = requireEnv("ENGLISH_LEARNING_RABBIT_URL");
const openclawBin = process.env.OPENCLAW_BIN ?? "openclaw";
const schedulerInterval = Math.max(10_000, Number(process.env.LEARNING_SCHEDULER_INTERVAL_MS ?? 30_000));
const queueName = "english.daily-lessons.v1";
const exchangeName = "english.notifications.v1";
const openclawStateDirectory = process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), ".openclaw");
const audioDir = path.join(openclawStateDirectory, "media", "english-learning-worker");

const db = databasePool(databaseUrl);
let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let stopping = false;

function notificationText(lesson: any, gender: unknown, seed: string): string {
  const address = addressForGender(gender);
  const objectives = Array.isArray(lesson.objectives) ? lesson.objectives.slice(0, 2) : [];
  return [
    morningCheckIn(gender, seed),
    "",
    `📘 Bài của ${address} hôm nay: ${lesson.title_vi}`,
    `⏱ ${lesson.daily_minutes} phút`,
    ...objectives.map((item: string) => `• ${item}`),
    "",
    `Nhắn “Học bài hôm nay” để bắt đầu. Bé 3 sẽ đi cùng ${address} từng bước, học chill mà vẫn level up nhé.`
  ].join("\n");
}

function microText(item: any, slot: string, gender: unknown): string {
  const address = addressForGender(gender);
  return [
    `🌱 Micro-learning · ${slot}`,
    "",
    `🔤 ${item.english_text}`,
    `🗣 IPA (Mỹ): ${item.phonetic_text}`,
    `🇻🇳 ${item.vietnamese_meaning}`,
    "",
    `Ví dụ: ${item.example_en}`,
    `Nghĩa: ${item.example_vi}`,
    "",
    `🔊 ${capitalizeAddress(address)} nghe audio, nhắc lại 3 lần rồi tự đặt một câu mới nha. Bé 3 chờ câu của ${address}!`
  ].join("\n");
}

async function createDailyLessonOutbox(now = new Date()): Promise<number> {
  const local = vietnamNow(now);
  if (local.totalMinutes < DAILY_REMINDER_MINUTES || local.totalMinutes >= DAILY_REMINDER_MINUTES + 30) return 0;
  const due = await db.query(
    `SELECT l.id, l.external_user_id, l.gender_identity
       FROM learners l
      WHERE l.notification_enabled = true`
  );
  let created = 0;
  for (const row of due.rows) {
    try {
      const lesson = await ensureTodayLesson(db, row.external_user_id);
      const greeting = morningCheckIn(row.gender_identity, `${local.date}:${row.external_user_id}`);
      const text = lesson
        ? notificationText(lesson, row.gender_identity, `${local.date}:${row.external_user_id}`)
        : `${greeting}\n\nBé 3 chưa thấy lộ trình của ${addressForGender(row.gender_identity)}. Nhắn /hoc để chọn mục tiêu và tạo bài học cá nhân hôm nay nhé.`;
      const result = await db.query(
        `INSERT INTO notification_outbox
           (learner_id, lesson_id, notification_date, notification_type, payload)
         VALUES ($1, $2, $3::date, 'daily_lesson', $4::jsonb)
         ON CONFLICT (learner_id, notification_date, notification_type) DO NOTHING
         RETURNING id`,
        [row.id, lesson?.id ?? null, local.date, JSON.stringify({ text })]
      );
      created += result.rowCount ?? 0;
    } catch (error) {
      console.error("Không thể tạo thông báo đến hạn:", error);
    }
  }
  return created;
}

async function createMicroLearningOutbox(now = new Date()): Promise<number> {
  const local = vietnamNow(now);
  const slot = currentMicroSlot(now);
  if (!slot) return 0;
  const notificationType = `micro_${slot.replace(":", "")}`;
  const learnersResult = await db.query(
    `SELECT l.id, l.external_user_id, l.gender_identity, active.course_slug
       FROM learners l
       LEFT JOIN LATERAL (
         SELECT e.course_slug FROM enrollments e
          WHERE e.learner_id = l.id AND e.status = 'active' LIMIT 1
       ) active ON true
      WHERE l.micro_learning_enabled = true`
  );
  let created = 0;
  for (const learner of learnersResult.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT id FROM notification_outbox
          WHERE learner_id = $1 AND notification_date = $2::date AND notification_type = $3`,
        [learner.id, local.date, notificationType]
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        continue;
      }

      const preferredCategories = preferredVocabularyCategories(learner.course_slug);
      const itemResult = await client.query(
        `SELECT i.id, i.item_key, i.english_text, i.phonetic_text, i.vietnamese_meaning,
                i.example_en, i.example_vi, i.category
           FROM micro_learning_items i
          WHERE i.active = true
            AND NOT EXISTS (
              SELECT 1 FROM learner_vocabulary_history h
               WHERE h.learner_id = $1 AND h.item_id = i.id
            )
          ORDER BY COALESCE(array_position($2::text[], i.category), 999),
                   md5(i.item_key || $1::text)
          LIMIT 1
          FOR UPDATE OF i SKIP LOCKED`,
        [learner.id, preferredCategories]
      );
      const item = itemResult.rows[0];
      if (!item) {
        await client.query("COMMIT");
        continue;
      }

      const payload = {
        text: microText(item, slot, learner.gender_identity),
        speechText: `${item.english_text}. ${item.example_en}`,
        speechSegments: [item.english_text, item.example_en],
        audioFileName: vocabularyAudioFileName(item.english_text),
        vocabularyItemId: item.id,
        vocabularyItemKey: item.item_key,
        vocabularyCategory: item.category,
        slot,
        timezone: VIETNAM_TIMEZONE
      };
      const outboxResult = await client.query(
        `INSERT INTO notification_outbox
           (learner_id, notification_date, notification_type, payload)
         VALUES ($1, $2::date, $3, $4::jsonb)
         RETURNING id`,
        [learner.id, local.date, notificationType, JSON.stringify(payload)]
      );
      await client.query(
        `INSERT INTO learner_vocabulary_history (learner_id, item_id, outbox_id)
         VALUES ($1, $2, $3)`,
        [learner.id, item.id, outboxResult.rows[0].id]
      );
      await client.query("COMMIT");
      created += 1;
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.code !== "23505") throw error;
    } finally {
      client.release();
    }
  }
  return created;
}

async function createWeeklyVocabularySummaryOutbox(now = new Date()): Promise<number> {
  const local = vietnamNow(now);
  if (!isWeeklySummaryWindow(now, local.date)) return 0;
  const range = vietnamWeekRange(now);
  const learnersResult = await db.query(
    `SELECT id, gender_identity FROM learners
      WHERE micro_learning_enabled = true`
  );
  let created = 0;
  for (const learner of learnersResult.rows) {
    const itemsResult = await db.query(
      `SELECT i.english_text, i.phonetic_text, i.vietnamese_meaning, i.category
         FROM learner_vocabulary_history h
         JOIN micro_learning_items i ON i.id = h.item_id
        WHERE h.learner_id = $1
          AND h.delivered_at >= ($2::date::timestamp AT TIME ZONE $4)
          AND h.delivered_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
        ORDER BY h.delivered_at, i.id`,
      [learner.id, range.start, range.end, VIETNAM_TIMEZONE]
    );
    if (itemsResult.rows.length === 0) continue;
    const result = await db.query(
      `INSERT INTO notification_outbox
         (learner_id, notification_date, notification_type, payload)
       VALUES ($1, $2::date, 'weekly_vocabulary', $3::jsonb)
       ON CONFLICT (learner_id, notification_date, notification_type) DO NOTHING
       RETURNING id`,
      [
        learner.id,
        local.date,
        JSON.stringify({
          text: weeklyVocabularySummaryText(
            itemsResult.rows,
            range.start,
            range.end,
            3400,
            addressForGender(learner.gender_identity)
          ),
          weekStart: range.start,
          weekEnd: range.end,
          vocabularyCount: itemsResult.rows.length,
          timezone: VIETNAM_TIMEZONE
        })
      ]
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

async function relayOutbox(): Promise<number> {
  if (!channel) return 0;
  await db.query(
    `UPDATE notification_outbox SET status = 'retry', next_attempt_at = now(), updated_at = now()
      WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`
  );
  const pending = await db.query(
    `SELECT id FROM notification_outbox
      WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()
      ORDER BY created_at LIMIT 100`
  );
  let relayed = 0;
  for (const row of pending.rows) {
    const sent = channel.publish(exchangeName, "daily", Buffer.from(JSON.stringify({ outboxId: row.id })), {
      persistent: true,
      contentType: "application/json",
      messageId: row.id
    });
    if (!sent) await new Promise<void>((resolve) => channel!.once("drain", resolve));
    await db.query("UPDATE notification_outbox SET status = 'queued', updated_at = now() WHERE id = $1 AND status IN ('pending', 'retry')", [row.id]);
    relayed += 1;
  }
  return relayed;
}

async function deliver(message: ConsumeMessage): Promise<void> {
  if (!channel) return;
  let outboxId: string | undefined;
  try {
    const parsed = JSON.parse(message.content.toString("utf8"));
    outboxId = String(parsed.outboxId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(outboxId)) throw new Error("outboxId không hợp lệ");
    const recordResult = await db.query(
      `SELECT o.*, l.external_user_id
         FROM notification_outbox o JOIN learners l ON l.id = o.learner_id
        WHERE o.id = $1`,
      [outboxId]
    );
    const record = recordResult.rows[0];
    if (!record || record.status === "sent") {
      channel.ack(message);
      return;
    }
    const local = vietnamNow();
    const recordDate = record.notification_date instanceof Date
      ? record.notification_date.toISOString().slice(0, 10)
      : String(record.notification_date).slice(0, 10);
    if (!isNotificationDeliveryWindow(String(record.notification_type), recordDate)) {
      await db.query(
        "UPDATE notification_outbox SET status = 'failed', last_error = 'expired_or_quiet_hours', updated_at = now() WHERE id = $1",
        [outboxId]
      );
      channel.ack(message);
      return;
    }
    await db.query("UPDATE notification_outbox SET status = 'sending', attempts = attempts + 1, updated_at = now() WHERE id = $1", [outboxId]);
    const text = String(record.payload?.text ?? "").slice(0, 3500);
    if (!text) throw new Error("Nội dung thông báo rỗng");
    let audioWorkDir: string | undefined;
    try {
      const speechText = String(record.payload?.speechText ?? "").trim().slice(0, 800);
      const speechSegments = deliberateSpeechSegments(
        Array.isArray(record.payload?.speechSegments)
          ? record.payload.speechSegments.map((item: unknown) => String(item)).slice(0, 12)
          : speechText
      );
      const args = ["message", "send", "--channel", "telegram", "--target", record.external_user_id, "--message", text];
      if (speechSegments.length > 0) {
        audioWorkDir = path.join(audioDir, outboxId);
        await mkdir(audioWorkDir, { recursive: true });
        const requestedFileName = String(record.payload?.audioFileName ?? speechSegments[0]);
        const audioPath = path.join(audioWorkDir, vocabularyAudioFileName(requestedFileName.replace(/\.mp3$/i, "")));
        await synthesizeLearningAudio(speechSegments, audioPath);
        args.push("--media", audioPath);
      }
      args.push("--json");
      await execFileAsync(openclawBin, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
    } finally {
      if (audioWorkDir) await rm(audioWorkDir, { recursive: true, force: true }).catch(() => undefined);
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE notification_outbox SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now() WHERE id = $1",
        [outboxId]
      );
      const vocabularyItemId = String(record.payload?.vocabularyItemId ?? "");
      if (/^\d+$/.test(vocabularyItemId)) {
        await client.query(
          `UPDATE learner_vocabulary_history
              SET delivered_at = COALESCE(delivered_at, now())
            WHERE learner_id = $1 AND item_id = $2::bigint`,
          [record.learner_id, vocabularyItemId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    channel.ack(message);
  } catch (error) {
    const errorText = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    console.error("Gửi thông báo thất bại:", errorText);
    if (outboxId) {
      await db.query(
        `UPDATE notification_outbox SET
           status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retry' END,
           last_error = $2,
           next_attempt_at = now() + (interval '1 minute' * LEAST(60, power(2, attempts)::int)),
           updated_at = now()
         WHERE id = $1`,
        [outboxId, errorText]
      ).catch(() => undefined);
    }
    channel.ack(message);
  }
}

async function schedulerTick(): Promise<void> {
  try {
    const dailyCreated = await createDailyLessonOutbox();
    const microCreated = await createMicroLearningOutbox();
    const weeklyCreated = await createWeeklyVocabularySummaryOutbox();
    const relayed = await relayOutbox();
    if (dailyCreated || microCreated || weeklyCreated || relayed) {
      console.log(`Scheduler: bài chính=${dailyCreated}, micro=${microCreated}, tổng kết tuần=${weeklyCreated}, đưa vào hàng đợi=${relayed}`);
    }
  } catch (error) {
    console.error("Lỗi scheduler:", error);
  }
}

async function main(): Promise<void> {
  connection = await amqp.connect(rabbitUrl);
  channel = await connection.createChannel();
  await channel.assertExchange(exchangeName, "direct", { durable: true });
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, exchangeName, "daily");
  await channel.prefetch(4);
  await channel.consume(queueName, (message) => {
    if (message) void deliver(message);
  });
  console.log("Notification worker đã sẵn sàng.");
  await schedulerTick();
  const timer = setInterval(() => void schedulerTick(), schedulerInterval);
  timer.unref();
  while (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
  clearInterval(timer);
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Đang dừng worker (${signal})...`);
  await channel?.close().catch(() => undefined);
  await connection?.close().catch(() => undefined);
  await db.end().catch(() => undefined);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error("Worker không khởi động được:", error);
  await shutdown("startup-error");
  process.exitCode = 1;
});
