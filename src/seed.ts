import { Pool } from "pg";
import { ADDITIONAL_B1_VOCABULARY, type VocabularySeedItem } from "./b1-vocabulary.js";
import { COURSE_DEFINITIONS } from "./curriculum.js";

const databaseUrl = process.env.ENGLISH_LEARNING_DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu ENGLISH_LEARNING_DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const studyKeys = new Set(["pay-attention", "effective", "improve", "opportunity", "recommend", "responsible"]);
const socialKeys = new Set([
  "could-you", "what-do-you-mean", "sounds-good", "not-sure", "it-depends", "in-my-opinion",
  "im-down", "low-key", "good-vibe", "no-big-deal", "thats-on-me", "legit"
]);

function vocabularyCategory(itemKey: string): string {
  if (itemKey.startsWith("corev-")) return "b1-core";
  if (itemKey.startsWith("dailyv-")) return "daily-life";
  if (itemKey.startsWith("studyv-")) return "study";
  if (itemKey.startsWith("workv-")) return "work";
  if (itemKey.startsWith("travelv-")) return "travel";
  if (itemKey.startsWith("socialv-")) return "social";
  if (itemKey.startsWith("healthv-")) return "health";
  if (studyKeys.has(itemKey)) return "study";
  if (socialKeys.has(itemKey)) return "social";
  return itemKey.includes("-") ? "daily-life" : "b1-core";
}

try {
  for (const course of COURSE_DEFINITIONS) {
    await pool.query(
      `INSERT INTO courses (slug, title_vi, target_level, duration_weeks, description_vi, curriculum)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (slug) DO UPDATE SET
         title_vi = EXCLUDED.title_vi,
         target_level = EXCLUDED.target_level,
         duration_weeks = EXCLUDED.duration_weeks,
         description_vi = EXCLUDED.description_vi,
         curriculum = EXCLUDED.curriculum,
         version = courses.version + 1,
         updated_at = now()`,
      [
        course.slug,
        course.titleVi,
        course.targetLevel,
        course.durationWeeks,
        course.descriptionVi,
        JSON.stringify({ direction: course.direction, weeks: course.weeks })
      ]
    );
  }
  const microItems: VocabularySeedItem[] = [
    ["make-progress", "A1", "make progress", "/meɪk ˈprɑːɡres/", "tiến bộ", "I make progress when I practise every day.", "Tôi tiến bộ khi luyện tập mỗi ngày."],
    ["take-a-break", "A1", "take a break", "/teɪk ə breɪk/", "nghỉ giải lao", "Let's take a short break.", "Chúng ta hãy nghỉ một lát."],
    ["figure-out", "B1", "figure out", "/ˈfɪɡjər aʊt/", "tìm ra; hiểu ra", "I need to figure out how this works.", "Tôi cần tìm hiểu cách việc này hoạt động."],
    ["be-used-to", "B1", "be used to", "/biː juːst tə/", "quen với", "I am used to getting up early.", "Tôi quen với việc dậy sớm."],
    ["look-forward-to", "A2", "look forward to", "/lʊk ˈfɔːrwərd tə/", "mong chờ", "I look forward to hearing from you.", "Tôi mong nhận được hồi âm của bạn."],
    ["in-advance", "A2", "in advance", "/ɪn ədˈvæns/", "trước; sớm", "Please book your ticket in advance.", "Hãy đặt vé trước."],
    ["on-time", "A1", "on time", "/ɑːn taɪm/", "đúng giờ", "The meeting started on time.", "Cuộc họp bắt đầu đúng giờ."],
    ["instead-of", "A2", "instead of", "/ɪnˈsted əv/", "thay vì", "Try walking instead of driving.", "Hãy thử đi bộ thay vì lái xe."],
    ["according-to", "B1", "according to", "/əˈkɔːrdɪŋ tə/", "theo như", "According to the report, sales increased.", "Theo báo cáo, doanh số đã tăng."],
    ["as-a-result", "B1", "as a result", "/æz ə rɪˈzʌlt/", "kết quả là", "It rained heavily; as a result, the match was cancelled.", "Trời mưa lớn; kết quả là trận đấu bị hủy."],
    ["deal-with", "B1", "deal with", "/diːl wɪð/", "xử lý", "She knows how to deal with difficult customers.", "Cô ấy biết cách xử lý khách hàng khó tính."],
    ["depend-on", "A2", "depend on", "/dɪˈpend ɑːn/", "phụ thuộc vào", "Success depends on consistent practice.", "Thành công phụ thuộc vào việc luyện tập đều đặn."],
    ["get-along", "B1", "get along with", "/ɡet əˈlɔːŋ wɪð/", "hòa hợp với", "I get along well with my colleagues.", "Tôi hòa hợp với đồng nghiệp."],
    ["keep-in-mind", "B1", "keep in mind", "/kiːp ɪn maɪnd/", "ghi nhớ", "Keep in mind that the deadline is Friday.", "Hãy nhớ rằng hạn chót là thứ Sáu."],
    ["make-sense", "B1", "make sense", "/meɪk sens/", "hợp lý; dễ hiểu", "Your explanation makes sense.", "Lời giải thích của bạn rất hợp lý."],
    ["pay-attention", "A2", "pay attention", "/peɪ əˈtenʃən/", "chú ý", "Pay attention to the final sound.", "Hãy chú ý đến âm cuối."],
    ["run-out-of", "B1", "run out of", "/rʌn aʊt əv/", "hết", "We have run out of milk.", "Chúng ta đã hết sữa."],
    ["take-part-in", "A2", "take part in", "/teɪk pɑːrt ɪn/", "tham gia", "Many students took part in the competition.", "Nhiều học sinh đã tham gia cuộc thi."],
    ["used-to", "A2", "used to", "/juːst tə/", "đã từng", "I used to live near the beach.", "Tôi từng sống gần bãi biển."],
    ["work-out", "B1", "work out", "/wɜːrk aʊt/", "tập thể dục; tìm ra", "We can work out a solution together.", "Chúng ta có thể cùng tìm ra giải pháp."],
    ["available", "A2", "available", "/əˈveɪləbəl/", "có sẵn; rảnh", "Is this seat available?", "Chỗ ngồi này còn trống không?"],
    ["confident", "A2", "confident", "/ˈkɑːnfɪdənt/", "tự tin", "She feels confident about the interview.", "Cô ấy cảm thấy tự tin về buổi phỏng vấn."],
    ["convenient", "B1", "convenient", "/kənˈviːniənt/", "thuận tiện", "Online banking is convenient for busy people.", "Ngân hàng trực tuyến thuận tiện cho người bận rộn."],
    ["effective", "B1", "effective", "/ɪˈfektɪv/", "hiệu quả", "This is an effective way to learn vocabulary.", "Đây là cách học từ vựng hiệu quả."],
    ["improve", "A1", "improve", "/ɪmˈpruːv/", "cải thiện", "Reading daily can improve your vocabulary.", "Đọc hằng ngày có thể cải thiện vốn từ."],
    ["opportunity", "A2", "opportunity", "/ˌɑːpərˈtuːnəti/", "cơ hội", "This job is a great opportunity.", "Công việc này là một cơ hội tuyệt vời."],
    ["recommend", "A2", "recommend", "/ˌrekəˈmend/", "đề xuất; giới thiệu", "I recommend practising with short sentences.", "Tôi khuyên bạn luyện tập bằng câu ngắn."],
    ["responsible", "B1", "responsible", "/rɪˈspɑːnsəbəl/", "có trách nhiệm", "She is responsible for the weekly report.", "Cô ấy chịu trách nhiệm cho báo cáo tuần."],
    ["although", "A2", "although", "/ɔːlˈðoʊ/", "mặc dù", "Although it was late, he kept studying.", "Mặc dù đã muộn, anh ấy vẫn tiếp tục học."],
    ["unless", "B1", "unless", "/ənˈles/", "trừ khi", "You won't improve unless you practise.", "Bạn sẽ không tiến bộ nếu không luyện tập."],
    ["would-rather", "B1", "would rather", "/wʊd ˈræðər/", "thà; thích hơn", "I would rather study in the morning.", "Tôi thích học vào buổi sáng hơn."],
    ["could-you", "A1", "Could you say that again?", "/kʊd juː seɪ ðæt əˈɡen/", "Bạn có thể nói lại được không?", "Could you say that again more slowly?", "Bạn có thể nói lại chậm hơn không?"],
    ["what-do-you-mean", "A2", "What do you mean?", "/wʌt də juː miːn/", "Bạn có ý gì?", "What do you mean by practical English?", "Bạn có ý gì khi nói tiếng Anh thực tế?"],
    ["sounds-good", "A1", "That sounds good.", "/ðæt saʊndz ɡʊd/", "Nghe hay đấy.", "Let's meet at seven. That sounds good.", "Hãy gặp nhau lúc bảy giờ. Nghe hay đấy."],
    ["not-sure", "A1", "I'm not sure.", "/aɪm nɑːt ʃʊr/", "Tôi không chắc.", "I'm not sure, but I can check.", "Tôi không chắc, nhưng tôi có thể kiểm tra."],
    ["it-depends", "A2", "It depends.", "/ɪt dɪˈpendz/", "Còn tùy.", "It depends on how much time we have.", "Điều đó tùy vào thời gian chúng ta có."],
    ["in-my-opinion", "B1", "In my opinion", "/ɪn maɪ əˈpɪnjən/", "Theo ý kiến của tôi", "In my opinion, public transport should be cheaper.", "Theo tôi, phương tiện công cộng nên rẻ hơn."],
    ["for-example", "A2", "for example", "/fər ɪɡˈzæmpəl/", "ví dụ", "You can practise anywhere, for example, on the bus.", "Bạn có thể luyện tập ở bất cứ đâu, ví dụ trên xe buýt."],
    ["however", "B1", "however", "/haʊˈevər/", "tuy nhiên", "The task was difficult; however, we completed it.", "Nhiệm vụ khó; tuy nhiên, chúng tôi đã hoàn thành."],
    ["therefore", "B1", "therefore", "/ˈðerfɔːr/", "vì vậy", "The road was closed; therefore, we took another route.", "Con đường bị đóng; vì vậy, chúng tôi đi tuyến khác."],
    ["im-down", "A2", "I'm down.", "/aɪm daʊn/", "Tôi đồng ý/tham gia (thân mật)", "I'm down for a quick English game.", "Tôi tham gia một game tiếng Anh nhanh."],
    ["low-key", "B1", "low-key", "/ˌloʊˈkiː/", "hơi; kín đáo; không phô trương (thân mật)", "I'm low-key excited about the trip.", "Tôi hơi háo hức về chuyến đi."],
    ["good-vibe", "A2", "a good vibe", "/ə ɡʊd vaɪb/", "một cảm giác/bầu không khí tích cực (thân mật)", "This café has a good vibe.", "Quán cà phê này có bầu không khí rất dễ chịu."],
    ["no-big-deal", "A2", "No big deal.", "/noʊ bɪɡ diːl/", "Không có gì to tát (thân mật)", "Thanks for helping me. No big deal.", "Cảm ơn bạn đã giúp tôi. Không có gì đâu."],
    ["thats-on-me", "B1", "That's on me.", "/ðæts ɑːn miː/", "Đó là lỗi/trách nhiệm của tôi (thân mật)", "I missed the deadline, and that's on me.", "Tôi đã lỡ hạn; đó là trách nhiệm của tôi."],
    ["legit", "B1", "legit", "/lɪˈdʒɪt/", "thật sự; chính hiệu (thân mật)", "That pronunciation tip is legit useful.", "Mẹo phát âm đó thật sự hữu ích."]
  ];
  microItems.push(...ADDITIONAL_B1_VOCABULARY);
  for (const item of microItems) {
    await pool.query(
      `INSERT INTO micro_learning_items
         (item_key, min_level, english_text, phonetic_text, vietnamese_meaning, example_en, example_vi, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (item_key) DO UPDATE SET
         min_level = EXCLUDED.min_level,
         english_text = EXCLUDED.english_text,
         phonetic_text = EXCLUDED.phonetic_text,
         vietnamese_meaning = EXCLUDED.vietnamese_meaning,
         example_en = EXCLUDED.example_en,
         example_vi = EXCLUDED.example_vi,
         category = EXCLUDED.category,
         active = true`,
      [...item, vocabularyCategory(item[0])]
    );
  }
  console.log(`Đã seed ${COURSE_DEFINITIONS.length} lộ trình và ${microItems.length} mục micro-learning.`);
} finally {
  await pool.end();
}
