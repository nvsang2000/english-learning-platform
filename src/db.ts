import { Pool, type PoolClient } from "pg";
import { buildLessonContent, courseBySlug, startingWeek, type CourseSlug } from "./curriculum.js";

export type SetupPlanInput = {
  goal: CourseSlug;
  currentLevel: string;
  dailyMinutes: number;
  timezone?: string;
  notificationTime?: string;
  targetDate?: string;
  targetScore?: string;
  microLearningEnabled?: boolean;
};

export type SubmitResultInput = {
  score: number;
  completed: boolean;
  strengths?: string[];
  weaknesses?: string[];
  learnerNote?: string;
};

export const GAME_TYPES = ["word_guess", "sentence_race", "emoji_decode", "roleplay_quest"] as const;
export type GameType = (typeof GAME_TYPES)[number];

export type LogGameResultInput = {
  gameType: GameType;
  score: number;
  completed: boolean;
  correctAnswers?: number;
  totalQuestions?: number;
  note?: string;
};

let pool: Pool | undefined;

export function databasePool(databaseUrl: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return pool;
}

export function normalizeTelegramId(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const normalized = raw.replace(/^telegram:/i, "").replace(/^user:/i, "");
  if (!/^\d{5,20}$/.test(normalized)) {
    throw new Error("Không xác định được Telegram ID đáng tin cậy của người đang chat.");
  }
  return normalized;
}

export function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error("Múi giờ không hợp lệ. Hãy dùng tên IANA, ví dụ Asia/Ho_Chi_Minh.");
  }
}

export function localDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cleanText(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return clean || null;
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).slice(0, 8).map((value) => cleanText(value, 160)).filter((value): value is string => Boolean(value));
}

async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertLearner(db: Pool, telegramId: string): Promise<any> {
  const result = await db.query(
    `INSERT INTO learners (channel, external_user_id)
     VALUES ('telegram', $1)
     ON CONFLICT (channel, external_user_id) DO UPDATE SET
       last_seen_at = now(), updated_at = now()
     RETURNING *`,
    [telegramId]
  );
  return result.rows[0];
}

export async function setupPlan(db: Pool, telegramId: string, input: SetupPlanInput): Promise<any> {
  const timezone = "Asia/Ho_Chi_Minh";
  const notificationTime = "07:00";
  if (input.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) throw new Error("Ngày mục tiêu phải có dạng YYYY-MM-DD.");
  const date = localDate(timezone);
  const course = courseBySlug(input.goal);

  return withTransaction(db, async (client) => {
    const learnerResult = await client.query(
      `INSERT INTO learners (channel, external_user_id, timezone, notification_time, micro_learning_enabled)
       VALUES ('telegram', $1, $2, $3::time, $4)
       ON CONFLICT (channel, external_user_id) DO UPDATE SET
         timezone = EXCLUDED.timezone,
         notification_time = EXCLUDED.notification_time,
         micro_learning_enabled = EXCLUDED.micro_learning_enabled,
         notification_enabled = true,
         last_seen_at = now(), updated_at = now()
       RETURNING *`,
      [telegramId, timezone, notificationTime, input.microLearningEnabled ?? true]
    );
    const learner = learnerResult.rows[0];
    await client.query("UPDATE enrollments SET status = 'paused', updated_at = now() WHERE learner_id = $1 AND status = 'active'", [learner.id]);
    const enrollmentResult = await client.query(
      `INSERT INTO enrollments
         (learner_id, course_slug, current_level, daily_minutes, start_date, target_date, target_score, start_week)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8)
       RETURNING *`,
      [
        learner.id,
        input.goal,
        input.currentLevel,
        Math.max(10, Math.min(180, input.dailyMinutes)),
        date,
        input.targetDate ?? null,
        cleanText(input.targetScore, 50),
        startingWeek(input.goal, input.currentLevel)
      ]
    );
    const enrollment = enrollmentResult.rows[0];
    await client.query(
      `INSERT INTO progress_events (learner_id, enrollment_id, event_type, payload)
       VALUES ($1, $2, 'plan_created', $3::jsonb)`,
      [learner.id, enrollment.id, JSON.stringify({ course: input.goal, dailyMinutes: input.dailyMinutes, timezone })]
    );
    return {
      learner: {
        timezone: learner.timezone,
        notificationTime: String(learner.notification_time).slice(0, 5),
        microLearningEnabled: learner.micro_learning_enabled,
        microLearningWindow: "07:30–22:00",
        microLearningIntervalMinutes: 30
      },
      enrollment: {
        id: enrollment.id,
        course: input.goal,
        courseTitle: course.titleVi,
        durationWeeks: course.durationWeeks,
        startDate: date,
        startWeek: enrollment.start_week,
        dailyMinutes: enrollment.daily_minutes,
        targetDate: enrollment.target_date,
        targetScore: enrollment.target_score
      }
    };
  });
}

export async function ensureTodayLesson(db: Pool, telegramId: string, now = new Date()): Promise<any | null> {
  const learner = await upsertLearner(db, telegramId);
  const date = localDate(learner.timezone, now);
  const activeResult = await db.query(
    `SELECT e.*, c.title_vi, c.duration_weeks
       FROM enrollments e
       JOIN courses c ON c.slug = e.course_slug
      WHERE e.learner_id = $1 AND e.status = 'active'
      LIMIT 1`,
    [learner.id]
  );
  const enrollment = activeResult.rows[0];
  if (!enrollment) return null;

  const offsetResult = await db.query("SELECT GREATEST(0, $1::date - $2::date)::int AS day_offset", [date, enrollment.start_date]);
  const dayOffset = Number(offsetResult.rows[0].day_offset);
  const course = courseBySlug(enrollment.course_slug);
  const week = Math.min(course.durationWeeks, Number(enrollment.start_week) + Math.floor(dayOffset / 7));
  const day = (dayOffset % 7) + 1;
  const content = buildLessonContent(course, week, day, Number(enrollment.daily_minutes));

  const result = await db.query(
    `INSERT INTO daily_lessons
       (enrollment_id, learner_id, lesson_date, week_number, day_number, title_vi, objectives, lesson_plan, exercises)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
     ON CONFLICT (enrollment_id, lesson_date) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      enrollment.id,
      learner.id,
      date,
      week,
      day,
      content.titleVi,
      JSON.stringify(content.objectives),
      JSON.stringify(content.lessonPlan),
      JSON.stringify(content.exercises)
    ]
  );
  return {
    ...result.rows[0],
    course_slug: enrollment.course_slug,
    course_title: enrollment.title_vi,
    daily_minutes: enrollment.daily_minutes,
    timezone: learner.timezone,
    notification_time: String(learner.notification_time).slice(0, 5),
    notification_enabled: learner.notification_enabled
  };
}

export async function submitTodayResult(db: Pool, telegramId: string, input: SubmitResultInput): Promise<any> {
  const lesson = await ensureTodayLesson(db, telegramId);
  if (!lesson) throw new Error("Bạn chưa có lộ trình đang hoạt động. Hãy tạo lộ trình trước.");
  const status = input.completed ? "completed" : "in_progress";
  const strengths = cleanList(input.strengths);
  const weaknesses = cleanList(input.weaknesses);
  const result = await db.query(
    `UPDATE daily_lessons SET
       status = $2,
       score = $3,
       strengths = $4::jsonb,
       weaknesses = $5::jsonb,
       learner_note = $6,
       completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [lesson.id, status, Math.max(0, Math.min(100, input.score)), JSON.stringify(strengths), JSON.stringify(weaknesses), cleanText(input.learnerNote, 500)]
  );
  await db.query(
    `INSERT INTO progress_events (learner_id, enrollment_id, lesson_id, event_type, payload)
     VALUES ($1, $2, $3, 'lesson_result', $4::jsonb)`,
    [lesson.learner_id, lesson.enrollment_id, lesson.id, JSON.stringify({ status, score: input.score, strengths, weaknesses })]
  );
  return result.rows[0];
}

export async function getProgress(db: Pool, telegramId: string): Promise<any> {
  const learner = await upsertLearner(db, telegramId);
  const gameStatsResult = await db.query(
    `SELECT
       count(*)::int AS sessions,
       count(*) FILTER (WHERE (payload->>'completed')::boolean = true)::int AS completed,
       round(avg((payload->>'score')::numeric), 1) AS average_score,
       COALESCE(sum((payload->>'correctAnswers')::int), 0)::int AS correct_answers
     FROM progress_events
     WHERE learner_id = $1 AND event_type = 'game_result'`,
    [learner.id]
  );
  const games = gameStatsResult.rows[0];
  const enrollmentResult = await db.query(
    `SELECT e.*, c.title_vi, c.duration_weeks
       FROM enrollments e JOIN courses c ON c.slug = e.course_slug
      WHERE e.learner_id = $1 AND e.status = 'active' LIMIT 1`,
    [learner.id]
  );
  const enrollment = enrollmentResult.rows[0];
  if (!enrollment) return { hasPlan: false, games };
  const statsResult = await db.query(
    `SELECT
       count(*)::int AS assigned,
       count(*) FILTER (WHERE status = 'completed')::int AS completed,
       round(avg(score) FILTER (WHERE score IS NOT NULL), 1) AS average_score,
       max(lesson_date) FILTER (WHERE status = 'completed') AS last_completed_date
     FROM daily_lessons WHERE enrollment_id = $1`,
    [enrollment.id]
  );
  const weakResult = await db.query(
    `SELECT weakness, count(*)::int AS occurrences
       FROM daily_lessons d, jsonb_array_elements_text(d.weaknesses) AS weakness
      WHERE d.enrollment_id = $1
      GROUP BY weakness ORDER BY occurrences DESC, weakness LIMIT 5`,
    [enrollment.id]
  );
  const today = await ensureTodayLesson(db, telegramId);
  return {
    hasPlan: true,
    course: enrollment.course_slug,
    courseTitle: enrollment.title_vi,
    durationWeeks: enrollment.duration_weeks,
    dailyMinutes: enrollment.daily_minutes,
    startDate: enrollment.start_date,
    targetDate: enrollment.target_date,
    targetScore: enrollment.target_score,
    stats: statsResult.rows[0],
    games,
    commonWeaknesses: weakResult.rows,
    today: today ? { date: today.lesson_date, week: today.week_number, day: today.day_number, status: today.status, score: today.score } : null
  };
}

export async function logGameResult(db: Pool, telegramId: string, input: LogGameResultInput): Promise<any> {
  if (!GAME_TYPES.includes(input.gameType)) throw new Error("Trò chơi không hợp lệ.");
  const learner = await upsertLearner(db, telegramId);
  const enrollmentResult = await db.query(
    "SELECT id FROM enrollments WHERE learner_id = $1 AND status = 'active' LIMIT 1",
    [learner.id]
  );
  const score = Math.max(0, Math.min(100, input.score));
  const totalQuestions = Math.max(0, Math.min(100, Math.trunc(input.totalQuestions ?? 0)));
  const correctAnswers = Math.max(0, Math.min(totalQuestions || 100, Math.trunc(input.correctAnswers ?? 0)));
  const completed = Boolean(input.completed);
  const xpEarned = completed ? 20 + Math.round(score / 5) : Math.round(score / 10);
  const payload = {
    gameType: input.gameType,
    score,
    completed,
    correctAnswers,
    totalQuestions,
    note: cleanText(input.note, 300),
    xpEarned
  };
  const result = await db.query(
    `INSERT INTO progress_events (learner_id, enrollment_id, event_type, payload)
     VALUES ($1, $2, 'game_result', $3::jsonb)
     RETURNING id, created_at`,
    [learner.id, enrollmentResult.rows[0]?.id ?? null, JSON.stringify(payload)]
  );
  return { ...payload, eventId: result.rows[0].id, playedAt: result.rows[0].created_at };
}

export async function setNotifications(
  db: Pool,
  telegramId: string,
  input: { enabled: boolean; microLearningEnabled?: boolean }
): Promise<any> {
  const learner = await upsertLearner(db, telegramId);
  const result = await db.query(
    `UPDATE learners SET
       notification_enabled = $2,
       micro_learning_enabled = COALESCE($3, micro_learning_enabled),
       notification_time = '07:00'::time,
       timezone = 'Asia/Ho_Chi_Minh',
       updated_at = now()
      WHERE id = $1
      RETURNING notification_enabled, notification_time, timezone,
                micro_learning_enabled, micro_learning_start, micro_learning_end,
                micro_learning_interval_minutes`,
    [learner.id, input.enabled, input.microLearningEnabled ?? null]
  );
  return {
    enabled: result.rows[0].notification_enabled,
    notificationTime: String(result.rows[0].notification_time).slice(0, 5),
    timezone: result.rows[0].timezone,
    microLearningEnabled: result.rows[0].micro_learning_enabled,
    microLearningWindow: `${String(result.rows[0].micro_learning_start).slice(0, 5)}–${String(result.rows[0].micro_learning_end).slice(0, 5)}`,
    microLearningIntervalMinutes: result.rows[0].micro_learning_interval_minutes
  };
}

export function lessonForPrompt(lesson: any): Record<string, unknown> {
  return {
    course: lesson.course_title,
    date: lesson.lesson_date,
    week: lesson.week_number,
    day: lesson.day_number,
    title: lesson.title_vi,
    minutes: lesson.daily_minutes,
    objectives: lesson.objectives,
    plan: lesson.lesson_plan,
    exerciseRequirements: lesson.exercises,
    status: lesson.status,
    previousScore: lesson.score,
    previousWeaknesses: lesson.weaknesses
  };
}
