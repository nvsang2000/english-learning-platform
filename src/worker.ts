import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { EdgeTTS } from "node-edge-tts";
import { databasePool, ensureTodayLesson } from "./db.js";
import {
  currentMicroSlot,
  DAILY_REMINDER_MINUTES,
  isNotificationDeliveryWindow,
  VIETNAM_TIMEZONE,
  vietnamNow
} from "./schedule.js";

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
const audioDir = path.join(process.cwd(), "tmp-audio");

const db = databasePool(databaseUrl);
let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let stopping = false;

function notificationText(lesson: any): string {
  const objectives = Array.isArray(lesson.objectives) ? lesson.objectives.slice(0, 2) : [];
  return [
    "🔔 Tới giờ vào mode tiếng Anh rồi!",
    "",
    `📘 ${lesson.title_vi}`,
    `⏱ ${lesson.daily_minutes} phút`,
    ...objectives.map((item: string) => `• ${item}`),
    "",
    "Nhắn “Học bài hôm nay” để bắt đầu. Mình đi từng bước, học chill mà vẫn level up nhé."
  ].join("\n");
}

function stableIndex(value: string, modulo: number): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, modulo);
}

function microText(item: any, slot: string): string {
  return [
    `🌱 Micro-learning · ${slot}`,
    "",
    `🔤 ${item.english_text}`,
    `🇻🇳 ${item.vietnamese_meaning}`,
    "",
    `Ví dụ: ${item.example_en}`,
    `Nghĩa: ${item.example_vi}`,
    "",
    "🔊 Nghe audio, nhắc lại 3 lần, rồi tự đặt một câu mới."
  ].join("\n");
}

async function createDailyLessonOutbox(now = new Date()): Promise<number> {
  const local = vietnamNow(now);
  if (local.totalMinutes < DAILY_REMINDER_MINUTES || local.totalMinutes >= DAILY_REMINDER_MINUTES + 30) return 0;
  const due = await db.query(
    `SELECT l.id, l.external_user_id
       FROM learners l
      WHERE l.notification_enabled = true`
  );
  let created = 0;
  for (const row of due.rows) {
    try {
      const lesson = await ensureTodayLesson(db, row.external_user_id);
      const text = lesson
        ? notificationText(lesson)
        : "🔔 Đã đến giờ học tiếng Anh lúc 07:00.\n\nBạn chưa có lộ trình. Hãy nhắn /hoc để chọn mục tiêu và tạo bài học cá nhân hôm nay.";
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
  const [learnersResult, itemsResult] = await Promise.all([
    db.query(
      `SELECT l.id, l.external_user_id
         FROM learners l
        WHERE l.micro_learning_enabled = true`
    ),
    db.query(
      `SELECT item_key, english_text, vietnamese_meaning, example_en, example_vi
         FROM micro_learning_items WHERE active = true ORDER BY id`
    )
  ]);
  if (itemsResult.rows.length === 0) return 0;
  let created = 0;
  for (const learner of learnersResult.rows) {
    const item = itemsResult.rows[stableIndex(`${local.date}:${slot}:${learner.external_user_id}`, itemsResult.rows.length)];
    const result = await db.query(
      `INSERT INTO notification_outbox
         (learner_id, notification_date, notification_type, payload)
       VALUES ($1, $2::date, $3, $4::jsonb)
       ON CONFLICT (learner_id, notification_date, notification_type) DO NOTHING
       RETURNING id`,
      [
        learner.id,
        local.date,
        notificationType,
        JSON.stringify({
          text: microText(item, slot),
          speechText: `${item.english_text}. ${item.example_en}`,
          slot,
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
    let audioPath: string | undefined;
    try {
      const speechText = String(record.payload?.speechText ?? "").trim().slice(0, 800);
      const args = ["message", "send", "--channel", "telegram", "--target", record.external_user_id, "--message", text];
      if (speechText) {
        await mkdir(audioDir, { recursive: true });
        audioPath = path.join(audioDir, `${outboxId}-${randomUUID()}.mp3`);
        const tts = new EdgeTTS({
          voice: "en-US-JennyNeural",
          lang: "en-US",
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          rate: "-5%",
          pitch: "+0%",
          timeout: 30_000
        });
        await tts.ttsPromise(speechText, audioPath);
        args.push("--media", audioPath);
      }
      args.push("--json");
      await execFileAsync(openclawBin, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
    } finally {
      if (audioPath) await unlink(audioPath).catch(() => undefined);
    }
    await db.query(
      "UPDATE notification_outbox SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now() WHERE id = $1",
      [outboxId]
    );
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
    const relayed = await relayOutbox();
    if (dailyCreated || microCreated || relayed) {
      console.log(`Scheduler: bài chính=${dailyCreated}, micro=${microCreated}, đưa vào hàng đợi=${relayed}`);
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
