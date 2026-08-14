import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { EdgeTTS } from "node-edge-tts";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import {
  databasePool,
  ensureTodayLesson,
  getProgress,
  lessonForPrompt,
  logGameResult,
  normalizeTelegramId,
  setNotifications,
  setupPlan,
  submitTodayResult,
  upsertLearner
} from "./db.js";

const TOOL_NAMES = [
  "learning_setup_plan",
  "learning_get_today",
  "learning_submit_result",
  "learning_log_game_result",
  "learning_get_progress",
  "learning_set_notifications"
];

const vietnameseMarks = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/iu;
const englishCommonWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "day", "did", "do", "does",
  "for", "from", "good", "great", "had", "has", "have", "he", "hello", "her", "here", "him", "his", "how", "i",
  "if", "in", "is", "it", "let", "make", "me", "morning", "my", "not", "of", "on", "or", "our", "please", "say",
  "she", "should", "so", "that", "the", "their", "them", "there", "they", "this", "to", "today", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your"
]);
const recentAudioRuns = new Map<string, number>();

function cleanupRecentAudioRuns(now = Date.now()): void {
  for (const [key, createdAt] of recentAudioRuns) {
    if (now - createdAt > 10 * 60_000) recentAudioRuns.delete(key);
  }
}

function looksEnglish(value: string): boolean {
  const clean = value.replace(/https?:\/\/\S+/g, " ").replace(/[*_`#>()[\]{}]/g, " ").trim();
  if (!/[A-Za-z]/.test(clean) || vietnameseMarks.test(clean)) return false;
  const words = clean.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  if (words.length === 0) return false;
  if (words.length === 1) return clean.length <= 40 && /^[A-Za-z]+(?:[-'][A-Za-z]+)*[.!?]?$/.test(clean);
  const commonCount = words.filter((word) => englishCommonWords.has(word)).length;
  return commonCount >= 1 || /\b(?:ing|ed|ly|tion|ment|ness|able|ous)\b/i.test(clean) || /[.!?]$/.test(clean);
}

export function extractEnglishForAudio(text: string): string | null {
  const candidates: string[] = [];
  const explicitBlocks = [...text.matchAll(/\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi)].map((match) => match[1].trim());
  candidates.push(...explicitBlocks);
  const inlineDirectives = [...text.matchAll(/\[\[tts:([^\]\n]{1,1000})\]\]/gi)].map((match) => match[1].trim());
  candidates.push(...inlineDirectives);
  const withoutDirectives = stripTtsDirectives(text);
  for (const match of withoutDirectives.matchAll(/["“”']([^"“”'\n]{2,300})["“”']/g)) {
    if (looksEnglish(match[1])) candidates.push(match[1].trim());
  }
  for (const rawLine of withoutDirectives.split(/\n+/)) {
    const line = rawLine
      .replace(/^\s*(?:[-*•]|\d+[.)]|[🔤🗣️🔊📘])\s*/, "")
      .replace(/^\s*(?:English|Ví dụ|Example)\s*:\s*/i, "")
      .trim();
    if (looksEnglish(line)) candidates.push(line);
  }
  const unique = [...new Set(candidates.map((item) => item
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  return unique.join(" ").slice(0, 1000);
}

function stripTtsDirectives(text: string): string {
  return text
    .replace(/\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi, "$1")
    .replace(/\n?\s*\[\[tts:[^\]\n]{1,1000}\]\]\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function synthesizeEnglish(text: string): Promise<string> {
  const stateDirectory = process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), ".openclaw");
  const directory = path.join(stateDirectory, "media", "english-auto-audio");
  await mkdir(directory, { recursive: true });
  const audioPath = path.join(directory, `${randomUUID()}.mp3`);
  const tts = new EdgeTTS({
    voice: "en-US-JennyNeural",
    lang: "en-US",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    rate: "-5%",
    pitch: "+0%",
    timeout: 30_000
  });
  try {
    await tts.ttsPromise(text, audioPath);
    const timer = setTimeout(() => void unlink(audioPath).catch(() => undefined), 10 * 60_000);
    timer.unref();
    return audioPath;
  } catch (error) {
    await unlink(audioPath).catch(() => undefined);
    throw error;
  }
}

function trustedTelegramIdFromContext(ctx: {
  requesterSenderId?: string;
  sessionKey?: string;
  agentId?: string;
  messageChannel?: string;
}, expectedAgentId = "public-english"): string | null {
  if (ctx.agentId !== expectedAgentId || ctx.messageChannel !== "telegram") return null;
  if (ctx.requesterSenderId) return normalizeTelegramId(ctx.requesterSenderId);
  const escapedAgentId = expectedAgentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = ctx.sessionKey?.match(new RegExp(`^agent:${escapedAgentId}:telegram:direct:(\\d{5,20})$`));
  return match ? normalizeTelegramId(match[1]) : null;
}

function menuReply() {
  return {
    text: "Alo bạn học ơi 👋 Hôm nay mình vào mode nào?",
    presentation: {
      title: "English Learning Hub",
      tone: "info" as const,
      blocks: [
        {
          type: "buttons" as const,
          buttons: [
            { label: "🎯 Tạo lộ trình", action: { type: "callback" as const, value: "englearn:plan" }, style: "primary" as const },
            { label: "📘 Bài hôm nay", action: { type: "callback" as const, value: "englearn:today" } }
          ]
        },
        {
          type: "buttons" as const,
          buttons: [
            { label: "✍️ Điền nội dung", action: { type: "callback" as const, value: "englearn:practice" } },
            { label: "🎮 Chơi game", action: { type: "callback" as const, value: "englearn:games" }, style: "primary" as const }
          ]
        },
        {
          type: "buttons" as const,
          buttons: [
            { label: "📊 Xem tiến độ", action: { type: "callback" as const, value: "englearn:progress" } },
            { label: "🔊 Nghe phát âm", action: { type: "callback" as const, value: "englearn:audio" } }
          ]
        },
        { type: "context" as const, text: "Gõ /hoc bất cứ lúc nào để quay lại hub. Học chill nhưng tiến bộ là real!" }
      ]
    }
  };
}

function startReply() {
  return {
    text: "Welcome bạn học mới 👋 Chọn hướng học để mình lên lộ trình riêng cho bạn nhé!",
    presentation: {
      title: "Bắt đầu hành trình tiếng Anh",
      tone: "info" as const,
      blocks: [
        {
          type: "buttons" as const,
          buttons: [
            {
              label: "💬 Tiếng Anh giao tiếp",
              action: { type: "callback" as const, value: "englearn:direction:communication" },
              style: "primary" as const
            }
          ]
        },
        {
          type: "buttons" as const,
          buttons: [
            {
              label: "🏆 Tiếng Anh ôn thi",
              action: { type: "callback" as const, value: "englearn:direction:exam" }
            }
          ]
        },
        { type: "context" as const, text: "Giao tiếp và ôn thi dùng curriculum tách biệt. Bạn có thể đổi lộ trình sau trong /hoc." }
      ]
    }
  };
}

const callbackButton = (text: string, payload: string) => ({ text, callback_data: `englearn:${payload}` });

function directionButtons() {
  return [
    [callbackButton("💬 Tiếng Anh giao tiếp", "direction:communication")],
    [callbackButton("🏆 Tiếng Anh ôn thi", "direction:exam")],
    [callbackButton("↩️ Menu", "menu")]
  ];
}

function communicationCourseButtons() {
  return [
    [callbackButton("🌱 Nền tảng A0–A2", "goal:foundation"), callbackButton("💬 Đời thường", "goal:conversation")],
    [callbackButton("💼 Đi làm", "goal:workplace"), callbackButton("✈️ Du lịch", "goal:travel")],
    [callbackButton("↩️ Chọn lại hướng học", "plan")]
  ];
}

function examCourseButtons() {
  return [
    [callbackButton("B1", "goal:b1"), callbackButton("B2", "goal:b2")],
    [callbackButton("TOEIC", "goal:toeic"), callbackButton("IELTS", "goal:ielts")],
    [callbackButton("↩️ Chọn lại hướng học", "plan")]
  ];
}

function courseDirection(goal: string): "communication" | "exam" {
  return new Set(["foundation", "conversation", "workplace", "travel"]).has(goal) ? "communication" : "exam";
}

function mainMenuButtons() {
  return [
    [callbackButton("🎯 Tạo lộ trình", "plan"), callbackButton("📘 Bài hôm nay", "today")],
    [callbackButton("✍️ Điền nội dung", "practice"), callbackButton("🎮 Chơi game", "games")],
    [callbackButton("📊 Xem tiến độ", "progress"), callbackButton("🔊 Nghe phát âm", "audio")]
  ];
}

function practiceButtons() {
  return [
    [callbackButton("🧩 Điền chỗ trống", "practice:cloze"), callbackButton("🛠 Sửa câu", "practice:correction")],
    [callbackButton("🔄 Dịch Việt → Anh", "practice:translation"), callbackButton("📝 Nội dung của tôi", "practice:custom")],
    [callbackButton("↩️ Menu", "menu")]
  ];
}

function gameButtons() {
  return [
    [callbackButton("⚡ Đoán từ", "game:word_guess"), callbackButton("🏎 Xếp câu", "game:sentence_race")],
    [callbackButton("🕵️ Giải mã emoji", "game:emoji_decode"), callbackButton("🎭 Role-play", "game:roleplay_quest")],
    [callbackButton("↩️ Menu", "menu")]
  ];
}

function levelButtons(goal: string) {
  return [
    [callbackButton("Chưa biết", `level:${goal}:chua_biet`), callbackButton("A1", `level:${goal}:a1`), callbackButton("A2", `level:${goal}:a2`)],
    [callbackButton("B1", `level:${goal}:b1`), callbackButton("B2", `level:${goal}:b2`), callbackButton("C1", `level:${goal}:c1`)],
    [callbackButton("↩️ Chọn lại khóa học", `direction:${courseDirection(goal)}`)]
  ];
}

function minuteButtons(goal: string, level: string) {
  return [
    [callbackButton("15 phút", `minutes:${goal}:${level}:15`), callbackButton("30 phút", `minutes:${goal}:${level}:30`)],
    [callbackButton("45 phút", `minutes:${goal}:${level}:45`), callbackButton("60 phút", `minutes:${goal}:${level}:60`)],
    [callbackButton("↩️ Chọn lại trình độ", `goal:${goal}`)]
  ];
}

function microLearningButtons(goal: string, level: string, minutes: string) {
  return [
    [callbackButton("✅ Có, bật 30 phút/lần", `micro:${goal}:${level}:${minutes}:on`)],
    [callbackButton("Không, chỉ nhắc 07:00", `micro:${goal}:${level}:${minutes}:off`)],
    [callbackButton("↩️ Chọn lại thời lượng", `level:${goal}:${level}`)]
  ];
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value && typeof value === "object" ? value : { value }
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Có lỗi khi truy cập dữ liệu học tập.";
  return {
    content: [{ type: "text" as const, text: `Không thể hoàn tất: ${message}` }],
    details: { error: message },
    isError: true
  };
}

export default definePluginEntry({
  id: "english-learning",
  name: "English Learning",
  description: "Lộ trình, menu Telegram và tiến độ học tiếng Anh tách biệt theo Telegram ID.",
  register(api) {
    const pluginConfig = (api.pluginConfig ?? {}) as { databaseUrlEnv?: string; publicAgentId?: string };
    const databaseUrlEnv = pluginConfig.databaseUrlEnv ?? "ENGLISH_LEARNING_DATABASE_URL";
    const publicAgentId = pluginConfig.publicAgentId ?? "public-english";
    const getDb = () => {
      const databaseUrl = process.env[databaseUrlEnv];
      if (!databaseUrl) throw new Error(`Gateway chưa có biến môi trường ${databaseUrlEnv}.`);
      return databasePool(databaseUrl);
    };

    api.registerTool(
      (ctx) => {
        if (ctx.agentId !== publicAgentId || ctx.messageChannel !== "telegram") return null;
        let telegramId: string;
        try {
          telegramId = trustedTelegramIdFromContext(ctx, publicAgentId) ?? "";
          if (!telegramId) return null;
        } catch {
          return null;
        }
        const db = getDb();

        return [
          {
            name: "learning_setup_plan",
            label: "Tạo lộ trình học",
            description:
              "Tạo hoặc thay lộ trình cá nhân cho chính người Telegram đang chat. Dùng sau khi biết mục tiêu, trình độ, số phút/ngày; không hỏi hay truyền Telegram ID.",
            parameters: Type.Object({
              goal: Type.Union([
                Type.Literal("foundation"),
                Type.Literal("b1"),
                Type.Literal("b2"),
                Type.Literal("toeic"),
                Type.Literal("ielts"),
                Type.Literal("conversation"),
                Type.Literal("workplace"),
                Type.Literal("travel")
              ]),
              currentLevel: Type.Union([
                Type.Literal("chua_biet"),
                Type.Literal("a1"),
                Type.Literal("a2"),
                Type.Literal("b1"),
                Type.Literal("b2"),
                Type.Literal("c1")
              ]),
              dailyMinutes: Type.Integer({ minimum: 10, maximum: 180 }),
              microLearningEnabled: Type.Optional(Type.Boolean({ description: "Gửi từ/câu mỗi 30 phút trong khung 07:30–22:00 giờ Việt Nam; mặc định bật" })),
              targetDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
              targetScore: Type.Optional(Type.String({ maxLength: 50 }))
            }),
            async execute(_id: string, params: any) {
              try {
                return textResult(await setupPlan(db, telegramId, params));
              } catch (error) {
                return errorResult(error);
              }
            }
          },
          {
            name: "learning_get_today",
            label: "Bài học hôm nay",
            description: "Lấy bài học hôm nay của chính người Telegram đang chat. Không nhận định danh người dùng.",
            parameters: Type.Object({}),
            async execute() {
              try {
                const lesson = await ensureTodayLesson(db, telegramId);
                return textResult(lesson ? { hasPlan: true, lesson: lessonForPrompt(lesson) } : { hasPlan: false });
              } catch (error) {
                return errorResult(error);
              }
            }
          },
          {
            name: "learning_submit_result",
            label: "Lưu kết quả bài học",
            description:
              "Lưu điểm, điểm mạnh và lỗi cần cải thiện của bài hôm nay cho chính người đang chat. Chỉ dùng sau khi đã chấm hoặc người học xác nhận hoàn thành.",
            parameters: Type.Object({
              score: Type.Number({ minimum: 0, maximum: 100 }),
              completed: Type.Boolean(),
              strengths: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { maxItems: 8 })),
              weaknesses: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { maxItems: 8 })),
              learnerNote: Type.Optional(Type.String({ maxLength: 500 }))
            }),
            async execute(_id: string, params: any) {
              try {
                return textResult(await submitTodayResult(db, telegramId, params));
              } catch (error) {
                return errorResult(error);
              }
            }
          },
          {
            name: "learning_log_game_result",
            label: "Lưu kết quả trò chơi",
            description:
              "Lưu kết quả sau khi người học kết thúc một mini-game tiếng Anh. Chỉ gọi đúng một lần khi game kết thúc hoặc người học dừng game; không nhận định danh người dùng.",
            parameters: Type.Object({
              gameType: Type.Union([
                Type.Literal("word_guess"),
                Type.Literal("sentence_race"),
                Type.Literal("emoji_decode"),
                Type.Literal("roleplay_quest")
              ]),
              score: Type.Number({ minimum: 0, maximum: 100 }),
              completed: Type.Boolean(),
              correctAnswers: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
              totalQuestions: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
              note: Type.Optional(Type.String({ maxLength: 300 }))
            }),
            async execute(_id: string, params: any) {
              try {
                return textResult(await logGameResult(db, telegramId, params));
              } catch (error) {
                return errorResult(error);
              }
            }
          },
          {
            name: "learning_get_progress",
            label: "Xem tiến độ học",
            description: "Đọc thống kê lộ trình và lỗi thường gặp của chính người Telegram đang chat.",
            parameters: Type.Object({}),
            async execute() {
              try {
                return textResult(await getProgress(db, telegramId));
              } catch (error) {
                return errorResult(error);
              }
            }
          },
          {
            name: "learning_set_notifications",
            label: "Cài thông báo học",
            description: "Bật/tắt nhắc học 07:00 và micro-learning 30 phút/lần cho chính người Telegram đang chat. Lịch dùng giờ Việt Nam và không gửi ban đêm.",
            parameters: Type.Object({
              enabled: Type.Boolean(),
              microLearningEnabled: Type.Optional(Type.Boolean())
            }),
            async execute(_id: string, params: any) {
              try {
                return textResult(await setNotifications(db, telegramId, params));
              } catch (error) {
                return errorResult(error);
              }
            }
          }
        ];
      },
      { names: TOOL_NAMES }
    );

    api.registerCommand({
      name: "hoc",
      description: "Mở menu học tiếng Anh",
      descriptionLocalizations: { vi: "Mở menu học tiếng Anh" },
      channels: ["telegram"],
      acceptsArgs: false,
      requireAuth: false,
      handler: async (ctx) => {
        if (ctx.channelId !== "telegram" || ctx.agentId !== publicAgentId) return { text: "Menu này chỉ dùng trên Telegram." };
        return menuReply();
      }
    });

    api.registerInteractiveHandler({
      channel: "telegram",
      namespace: "englearn",
      handler: async (ctx: any) => {
        if (ctx.auth?.isAuthorizedSender === false) {
          await ctx.respond?.reply?.({ text: "Bạn không được phép dùng nút này." });
          return { handled: true };
        }
        const payload = String(ctx.callback?.payload ?? "");
        const validGoals = new Set(["foundation", "b1", "b2", "toeic", "ielts", "conversation", "workplace", "travel"]);
        const validLevels = new Set(["chua_biet", "a1", "a2", "b1", "b2", "c1"]);
        const validMinutes = new Set(["15", "30", "45", "60"]);
        const practicePrompts: Record<string, string> = {
          cloze: "Tôi muốn luyện điền chỗ trống. Hãy tạo 5 câu phù hợp với trình độ và bài học hiện tại, đưa từng câu một, chờ tôi điền rồi mới chấm và giải thích.",
          correction: "Tôi muốn nhập câu tiếng Anh để bạn sửa. Hãy mời tôi gửi một câu hoặc đoạn ngắn, sau đó sửa lỗi, giải thích bằng tiếng Việt và cho phiên bản tự nhiên hơn.",
          translation: "Tôi muốn luyện dịch Việt sang Anh. Hãy đưa từng câu tiếng Việt phù hợp với trình độ của tôi, chờ tôi dịch rồi mới chấm và giải thích.",
          custom: "Tôi muốn tự điền nội dung cần học. Hãy mời tôi gửi từ, câu, đoạn văn hoặc chủ đề; hỏi mục đích nếu chưa rõ rồi tạo bài luyện tương tác từ chính nội dung đó."
        };
        const gamePrompts: Record<string, string> = {
          word_guess: "Bắt đầu game Đoán từ thần tốc gồm 5 vòng phù hợp trình độ của tôi. Mỗi vòng cho tối đa 3 gợi ý, chờ tôi trả lời rồi mới mở đáp án và cập nhật điểm.",
          sentence_race: "Bắt đầu game Xếp câu tốc độ gồm 5 vòng phù hợp trình độ của tôi. Mỗi vòng xáo trộn một câu tiếng Anh, chờ tôi xếp lại rồi mới chấm và giải thích.",
          emoji_decode: "Bắt đầu game Giải mã emoji gồm 5 vòng. Mỗi vòng dùng emoji và một gợi ý tiếng Việt để tôi đoán từ hoặc cụm từ tiếng Anh, chờ tôi trả lời rồi mới chấm.",
          roleplay_quest: "Bắt đầu game Role-play Quest gồm 5 lượt trong một tình huống thực tế phù hợp lộ trình của tôi. Hãy nhập vai, để tôi trả lời bằng tiếng Anh, phản hồi diễn biến và chấm độ phù hợp sau từng lượt."
        };

        if (payload === "menu") {
          await ctx.respond.editMessage({ text: "Học gì hôm nay để level up đây? 👇", buttons: mainMenuButtons() });
          return { handled: true };
        }
        if (payload === "plan") {
          await ctx.respond.editMessage({
            text: "Bước 1/5 — Bạn muốn học theo hướng nào? Mỗi hướng có lộ trình riêng nhé 👇",
            buttons: directionButtons()
          });
          return { handled: true };
        }
        if (payload === "today") return { handled: true, submitText: "Hãy mở bài học hôm nay của tôi và bắt đầu phần đầu tiên." };
        if (payload === "progress") return { handled: true, submitText: "Hãy cho tôi xem tiến độ học tập hiện tại." };
        if (payload === "audio") return { handled: true, submitText: "Tôi muốn luyện phát âm bằng audio. Hãy hỏi tôi từ hoặc câu tiếng Anh cần nghe." };
        if (payload === "practice") {
          await ctx.respond.editMessage({ text: "Bạn muốn tự tay luyện kiểu nào? Chọn một option nhé ✍️", buttons: practiceButtons() });
          return { handled: true };
        }
        if (payload === "games") {
          await ctx.respond.editMessage({ text: "Chọn game rồi mình combat tiếng Anh nhẹ nhàng thôi 🎮", buttons: gameButtons() });
          return { handled: true };
        }

        const parts = payload.split(":");
        if (parts[0] === "direction" && parts[1] === "communication") {
          await ctx.respond.editMessage({
            text: "Bước 2/5 — Chọn lộ trình giao tiếp hợp vibe của bạn:",
            buttons: communicationCourseButtons()
          });
          return { handled: true };
        }
        if (parts[0] === "direction" && parts[1] === "exam") {
          await ctx.respond.editMessage({
            text: "Bước 2/5 — Bạn đang muốn chinh phục chứng chỉ nào?",
            buttons: examCourseButtons()
          });
          return { handled: true };
        }
        if (parts[0] === "practice" && practicePrompts[parts[1]]) {
          return { handled: true, submitText: practicePrompts[parts[1]] };
        }
        if (parts[0] === "game" && gamePrompts[parts[1]]) {
          return {
            handled: true,
            submitText: `${gamePrompts[parts[1]]} Khi kết thúc hoặc tôi dừng, hãy tính điểm thang 100, gọi learning_log_game_result đúng một lần với gameType ${parts[1]}, rồi cho tôi xem điểm, XP và một mẹo cải thiện.`
          };
        }
        if (parts[0] === "goal" && validGoals.has(parts[1])) {
          await ctx.respond.editMessage({ text: "Bước 3/5 — Trình độ hiện tại của bạn là gì?", buttons: levelButtons(parts[1]) });
          return { handled: true };
        }
        if (parts[0] === "level" && validGoals.has(parts[1]) && validLevels.has(parts[2])) {
          await ctx.respond.editMessage({ text: "Bước 4/5 — Mỗi ngày bạn có thể học bao lâu?", buttons: minuteButtons(parts[1], parts[2]) });
          return { handled: true };
        }
        if (parts[0] === "minutes" && validGoals.has(parts[1]) && validLevels.has(parts[2]) && validMinutes.has(parts[3])) {
          await ctx.respond.editMessage({
            text: "Bước 5/5 — Bài chính luôn nhắc lúc 07:00 giờ Việt Nam. Bạn có muốn nhận thêm một từ/câu mỗi 30 phút từ 07:30 đến 22:00 không?",
            buttons: microLearningButtons(parts[1], parts[2], parts[3])
          });
          return { handled: true };
        }
        if (
          parts[0] === "micro" && validGoals.has(parts[1]) && validLevels.has(parts[2]) &&
          validMinutes.has(parts[3]) && new Set(["on", "off"]).has(parts[4])
        ) {
          await ctx.respond.editMessage({ text: "Đã nhận lựa chọn. Em đang tạo lộ trình cá nhân cho bạn…" });
          return {
            handled: true,
            submitText: `Tôi chọn lộ trình ${parts[1]}, trình độ hiện tại ${parts[2]}, học ${parts[3]} phút mỗi ngày. Tạo lộ trình, nhắc bài chính lúc 07:00 giờ Việt Nam và ${parts[4] === "on" ? "bật" : "tắt"} micro-learning 30 phút/lần trong khung 07:30–22:00.`
          };
        }

        await ctx.respond.editMessage({ text: "Option này đã hết hạn hoặc không hợp lệ. Về hub chọn lại nhé:", buttons: mainMenuButtons() });
        return { handled: true };
      }
    });

    api.on("before_agent_reply", async (event, ctx) => {
      if (ctx.agentId !== publicAgentId || ctx.messageProvider !== "telegram") return;
      const text = event.cleanedBody.trim().toLocaleLowerCase("vi");
      if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
        return { handled: true, reply: startReply() };
      }
      if (["menu", "mở menu", "lựa chọn", "tùy chọn"].includes(text)) {
        return { handled: true, reply: menuReply() };
      }
    });

    api.on("reply_payload_sending", async (event, ctx) => {
      if (event.kind !== "final" || (event.channel ?? ctx.channelId) !== "telegram") return;
      const sessionKey = event.sessionKey ?? ctx.sessionKey;
      if (event.payload.mediaUrl || (event.payload.mediaUrls?.length ?? 0) > 0) return;
      const visibleText = event.payload.text?.trim();
      if (!visibleText) return;
      const cleanVisibleText = stripTtsDirectives(visibleText);
      cleanupRecentAudioRuns();
      const dedupeKey = event.runId ?? ctx.runId ?? `${sessionKey ?? ctx.conversationId ?? "telegram"}:${visibleText.slice(0, 120)}`;
      if (recentAudioRuns.has(dedupeKey)) return;
      const englishText = extractEnglishForAudio(visibleText);
      if (!englishText) return;
      try {
        const mediaUrl = await synthesizeEnglish(englishText);
        recentAudioRuns.set(dedupeKey, Date.now());
        return {
          payload: {
            ...event.payload,
            text: cleanVisibleText,
            mediaUrl,
            mediaUrls: [mediaUrl],
            audioAsVoice: true,
            spokenText: englishText,
            ttsSupplement: { spokenText: englishText, visibleTextAlreadyDelivered: false }
          }
        };
      } catch (error) {
        api.logger.warn(`Không thể tự tạo audio tiếng Anh: ${error instanceof Error ? error.message : "unknown"}`);
      }
    });

    api.on("message_received", async (event, ctx) => {
      if (ctx.channelId !== "telegram" || !ctx.sessionKey?.startsWith(`agent:${publicAgentId}:`)) return;
      try {
        const telegramId = normalizeTelegramId(ctx.senderId ?? event.senderId);
        await upsertLearner(getDb(), telegramId);
      } catch (error) {
        api.logger.warn(`Không thể cập nhật lần hoạt động của học viên: ${error instanceof Error ? error.message : "unknown"}`);
      }
    });

    api.on("before_prompt_build", async (_event, ctx) => {
      if (ctx.agentId !== publicAgentId || ctx.messageProvider !== "telegram" || !ctx.senderId) return;
      const vietnamesePolicy = [
        "QUY TẮC NGÔN NGỮ BẮT BUỘC: Luôn giải thích, hướng dẫn, nhận xét và hỏi người học bằng tiếng Việt.",
        "Chỉ dùng tiếng Anh cho câu mẫu, từ/cụm từ, đoạn đọc, câu hỏi luyện tập và phần người học cần thực hành; kèm giải thích tiếng Việt khi cần.",
        "PHONG CÁCH: Thân thiện, trẻ trung và khích lệ. Có thể dùng vừa phải các cụm Gen Z dễ hiểu như 'vào mode', 'level up', 'chill', 'flex nhẹ', 'quá slay'; tối đa 1–2 cụm mỗi lượt, không lạm dụng, không châm chọc và không dùng slang trong phần giải thích học thuật cần chính xác.",
        "LUYỆN TƯƠNG TÁC: Với bài điền hoặc game, luôn đưa từng câu/từng vòng và chờ người học trả lời; không tự trả lời thay. Sau mỗi vòng báo điểm ngắn gọn. Khi game kết thúc hoặc người học dừng, gọi learning_log_game_result đúng một lần.",
        "Không tiết lộ dữ liệu, điểm số hoặc lộ trình của bất kỳ Telegram ID nào khác.",
        "AUDIO TỰ ĐỘNG: Hệ thống sẽ tự phát hiện và đọc phần tiếng Anh. Hãy đặt câu/từ tiếng Anh cần luyện trên dòng riêng hoặc trong dấu ngoặc kép. Cuối phản hồi, thêm đúng khối [[tts:text]]nội dung tiếng Anh cần đọc[[/tts:text]]; tuyệt đối không dùng dạng sai [[tts:nội dung]]. Không gọi công cụ tts cho phản hồi thông thường."
      ].join("\n");
      try {
        const telegramId = normalizeTelegramId(ctx.senderId);
        const lesson = await ensureTodayLesson(getDb(), telegramId);
        const dynamicContext = lesson
          ? `DỮ LIỆU HỌC TẬP ĐÁNG TIN CẬY CỦA NGƯỜI ĐANG CHAT (không hiển thị JSON thô):\n${JSON.stringify(lessonForPrompt(lesson))}\nHãy bám bài hôm nay, cho làm từng phần và dùng learning_submit_result khi đã có kết quả.`
          : "Người học chưa có lộ trình. Trước tiên cho chọn một trong hai hướng: (1) tiếng Anh giao tiếp gồm nền tảng/giao tiếp đời thường/đi làm/du lịch; (2) tiếng Anh ôn thi gồm B1/B2/TOEIC/IELTS. Sau đó hỏi khóa học cụ thể, trình độ hiện tại, số phút mỗi ngày, mục tiêu điểm/ngày thi nếu có và gọi learning_setup_plan. Mỗi khóa học dùng curriculum riêng; không trộn chủ đề giữa các khóa. Người học vẫn có thể chơi game hoặc gửi nội dung luyện tập mà chưa cần tạo lộ trình.";
        return { appendSystemContext: vietnamesePolicy, prependContext: dynamicContext };
      } catch (error) {
        api.logger.warn(`Không thể nạp dữ liệu bài học: ${error instanceof Error ? error.message : "unknown"}`);
        return {
          appendSystemContext: vietnamesePolicy,
          prependContext: "Hệ thống dữ liệu học tập đang tạm thời không truy cập được. Không bịa tiến độ; xin lỗi ngắn gọn và vẫn hỗ trợ bài học trực tiếp bằng tiếng Việt."
        };
      }
    });
  }
});
