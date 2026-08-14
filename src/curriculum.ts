export type CourseSlug =
  | "foundation"
  | "b1"
  | "b2"
  | "toeic"
  | "ielts"
  | "conversation"
  | "workplace"
  | "travel";

export type CourseDefinition = {
  slug: CourseSlug;
  direction: "communication" | "exam";
  titleVi: string;
  targetLevel: string;
  durationWeeks: number;
  descriptionVi: string;
  weeks: string[];
};

export const COURSE_DEFINITIONS: CourseDefinition[] = [
  {
    slug: "foundation",
    direction: "communication",
    titleVi: "Tiếng Anh nền tảng A0–A2",
    targetLevel: "A2",
    durationWeeks: 16,
    descriptionVi: "Xây nền phát âm, từ vựng, ngữ pháp và giao tiếp đời sống từ con số 0.",
    weeks: [
      "Chào hỏi, bảng chữ cái và thông tin cá nhân",
      "Số, thời gian, ngày tháng và lịch hẹn",
      "Gia đình, nghề nghiệp và đại từ sở hữu",
      "Thói quen hằng ngày và thì hiện tại đơn",
      "Nhà cửa, đồ vật và giới từ vị trí",
      "Đồ ăn, thức uống và danh từ đếm được",
      "Mua sắm, giá cả và câu hỏi lịch sự",
      "Nơi chốn trong thành phố và chỉ đường",
      "Hoạt động đang diễn ra và hiện tại tiếp diễn",
      "Quá khứ, trải nghiệm cuối tuần và quá khứ đơn",
      "Sức khỏe, cơ thể và lời khuyên với should",
      "Kế hoạch tương lai với be going to",
      "So sánh người, vật và địa điểm",
      "Du lịch, phương tiện và tình huống dịch vụ",
      "Viết tin nhắn, email ngắn và hội thoại thực tế",
      "Ôn tập A2 và dự án giao tiếp tổng hợp"
    ]
  },
  {
    slug: "b1",
    direction: "exam",
    titleVi: "Tiếng Anh B1",
    targetLevel: "B1",
    durationWeeks: 16,
    descriptionVi: "Phát triển giao tiếp độc lập và bốn kỹ năng theo chuẩn CEFR B1.",
    weeks: [
      "Chẩn đoán đầu vào và củng cố các thì cơ bản",
      "Học tập, công việc và cách diễn đạt mục tiêu",
      "Du lịch và kể lại trải nghiệm có trình tự",
      "Sức khỏe, lối sống và đưa lời khuyên",
      "Công nghệ và nêu ưu điểm, nhược điểm",
      "Môi trường và câu điều kiện loại 1",
      "Mối quan hệ và diễn đạt cảm xúc",
      "Truyền thông, tin tức và câu bị động",
      "Văn hóa, lễ hội và mệnh đề quan hệ",
      "Tiền bạc, mua sắm và xử lý vấn đề",
      "Giả định và câu điều kiện loại 2",
      "Tường thuật ý kiến và reported speech",
      "Đọc hiểu ý chính, chi tiết và suy luận",
      "Viết email, bài luận ý kiến và liên kết ý",
      "Nghe–nói B1: mô tả, thảo luận và tương tác",
      "Đề mô phỏng B1 và kế hoạch khắc phục điểm yếu"
    ]
  },
  {
    slug: "b2",
    direction: "exam",
    titleVi: "Tiếng Anh B2",
    targetLevel: "B2",
    durationWeeks: 20,
    descriptionVi: "Nâng độ chính xác, độ trôi chảy và tư duy lập luận cho CEFR B2.",
    weeks: [
      "Đánh giá B1 và chiến lược tiến lên B2",
      "Hệ thống thì nâng cao và sắc thái thời gian",
      "Giáo dục và tư duy phản biện",
      "Nghề nghiệp, kỹ năng và phỏng vấn",
      "Khoa học, đổi mới và ngôn ngữ nguyên nhân–kết quả",
      "Môi trường và lập luận cân bằng",
      "Xã hội, cộng đồng và modal verbs nâng cao",
      "Truyền thông và đánh giá độ tin cậy",
      "Văn hóa, nghệ thuật và ngôn ngữ mô tả",
      "Tâm lý, hành vi và collocations",
      "Câu điều kiện hỗn hợp và giả định",
      "Đảo ngữ, nhấn mạnh và cấu trúc phức",
      "Đọc văn bản dài: cấu trúc và thái độ tác giả",
      "Nghe bài nói dài: ghi chú và suy luận",
      "Nói B2: phát triển và bảo vệ quan điểm",
      "Viết luận thảo luận hai chiều",
      "Viết báo cáo, đề xuất và email trang trọng",
      "Sửa lỗi hóa thạch và nâng độ tự nhiên",
      "Đề mô phỏng B2 có giới hạn thời gian",
      "Tổng ôn và kế hoạch duy trì sau B2"
    ]
  },
  {
    slug: "toeic",
    direction: "exam",
    titleVi: "Luyện thi TOEIC Listening & Reading",
    targetLevel: "TOEIC",
    durationWeeks: 16,
    descriptionVi: "Từ vựng công sở, chiến thuật 7 Part và luyện tốc độ có đo lường.",
    weeks: [
      "Chẩn đoán điểm, cấu trúc đề và quản lý thời gian",
      "Part 1: mô tả người, vật và hành động",
      "Part 2: loại câu hỏi và phản xạ đáp án",
      "Part 3: hội thoại, mục đích và suy luận",
      "Part 4: bài nói, thông báo và ghi chú nhanh",
      "Part 5: từ loại và cấu trúc câu",
      "Part 5: thì, hòa hợp và đại từ",
      "Part 5: giới từ, liên từ và từ vựng",
      "Part 6: mạch văn và câu chèn",
      "Part 7: email, tin nhắn và thông báo",
      "Part 7: bài đơn và tìm bằng chứng",
      "Part 7: bài đôi, bài ba và đối chiếu thông tin",
      "Từ vựng công sở: nhân sự, cuộc họp, dự án",
      "Từ vựng dịch vụ: du lịch, bán lẻ, tài chính",
      "Đề mô phỏng, phân tích lỗi và luyện tốc độ",
      "Tổng ôn theo mục tiêu điểm và chiến thuật ngày thi"
    ]
  },
  {
    slug: "ielts",
    direction: "exam",
    titleVi: "Luyện thi IELTS Academic",
    targetLevel: "IELTS",
    durationWeeks: 24,
    descriptionVi: "Phát triển nền ngôn ngữ, chiến thuật bốn kỹ năng và phản hồi theo tiêu chí IELTS.",
    weeks: [
      "Chẩn đoán band, tiêu chí chấm và kế hoạch cá nhân",
      "Từ vựng học thuật và paraphrase chính xác",
      "Ngữ pháp cho độ chính xác và đa dạng",
      "Listening Section 1: form, số và chính tả",
      "Listening Section 2: bản đồ và lựa chọn",
      "Listening Section 3: thảo luận học thuật",
      "Listening Section 4: bài giảng và ghi chú",
      "Reading: skimming, scanning và quản lý thời gian",
      "Reading: True/False/Not Given",
      "Reading: headings và matching information",
      "Reading: multiple choice và sentence completion",
      "Reading: suy luận, từ đồng nghĩa và bẫy đáp án",
      "Writing Task 1: biểu đồ đường và cột",
      "Writing Task 1: bảng, tròn và biểu đồ kết hợp",
      "Writing Task 1: quy trình và bản đồ",
      "Writing Task 2: opinion essay",
      "Writing Task 2: discussion essay",
      "Writing Task 2: problem–solution và two-part question",
      "Speaking Part 1: trả lời tự nhiên và mở rộng",
      "Speaking Part 2: lập dàn ý và nói hai phút",
      "Speaking Part 3: ý tưởng, ví dụ và lập luận",
      "Phát âm: trọng âm, nối âm và ngữ điệu",
      "Đề mô phỏng bốn kỹ năng và phân tích band",
      "Tổng ôn, chiến lược ngày thi và kế hoạch nâng band"
    ]
  },
  {
    slug: "conversation",
    direction: "communication",
    titleVi: "Giao tiếp đời thường — Nói là dùng được",
    targetLevel: "A1–B1",
    durationWeeks: 12,
    descriptionVi: "Luyện phản xạ trong các tình huống hằng ngày, ưu tiên nói tự nhiên và bớt ngại giao tiếp.",
    weeks: [
      "Chào hỏi, giới thiệu bản thân và bắt chuyện tự nhiên",
      "Bạn bè, sở thích và cách duy trì cuộc trò chuyện",
      "Ăn uống, gọi món và xử lý yêu cầu tại quán",
      "Mua sắm, hỏi giá và đổi trả sản phẩm",
      "Hỏi đường, phương tiện và mô tả vị trí",
      "Điện thoại, nhắn tin và hẹn lịch",
      "Cảm xúc, quan điểm và cách đồng tình hoặc phản đối lịch sự",
      "Sức khỏe, triệu chứng và nhờ giúp đỡ",
      "Kể chuyện đã xảy ra có mở đầu, diễn biến và kết thúc",
      "Small talk ở trường học, công sở và sự kiện",
      "Xử lý hiểu nhầm và yêu cầu người khác nói lại",
      "Thử thách hội thoại thực tế và kế hoạch duy trì phản xạ"
    ]
  },
  {
    slug: "workplace",
    direction: "communication",
    titleVi: "English đi làm — Tự tin công sở",
    targetLevel: "A2–B2",
    durationWeeks: 12,
    descriptionVi: "Tiếng Anh thực chiến cho email, họp, thuyết trình, phỏng vấn và phối hợp công việc.",
    weeks: [
      "Giới thiệu vai trò, công ty và trách nhiệm công việc",
      "Email rõ ràng: tiêu đề, yêu cầu và phản hồi",
      "Sắp lịch, đổi lịch và xác nhận cuộc hẹn",
      "Họp: cập nhật tiến độ và đặt câu hỏi",
      "Giao việc, deadline và cách nhắc việc lịch sự",
      "Trình bày số liệu, xu hướng và kết quả",
      "Nêu vấn đề, nguyên nhân và đề xuất giải pháp",
      "Trao đổi với khách hàng và xử lý phàn nàn",
      "Thuyết trình ngắn và trả lời câu hỏi",
      "CV, thành tích và phỏng vấn tuyển dụng",
      "Đàm phán, phản hồi và bất đồng chuyên nghiệp",
      "Mô phỏng một ngày làm việc bằng tiếng Anh"
    ]
  },
  {
    slug: "travel",
    direction: "communication",
    titleVi: "English du lịch — Xách vali và đi",
    targetLevel: "A1–B1",
    durationWeeks: 8,
    descriptionVi: "Mẫu câu sinh tồn và phản xạ cần thiết từ lúc đặt vé đến khi khám phá điểm đến.",
    weeks: [
      "Lập kế hoạch, đặt vé và hỏi thông tin chuyến đi",
      "Sân bay, nhập cảnh và hành lý",
      "Khách sạn: nhận phòng, tiện nghi và sự cố",
      "Di chuyển, hỏi đường và thuê phương tiện",
      "Nhà hàng, món ăn và yêu cầu đặc biệt",
      "Tham quan, mua vé và hỏi gợi ý địa phương",
      "Mua sắm, thanh toán và tình huống khẩn cấp",
      "Role-play hành trình hoàn chỉnh và bộ câu sinh tồn"
    ]
  }
];

const DAY_FOCUS = [
  { focus: "Từ vựng + ngữ pháp", skills: ["vocabulary", "grammar"] },
  { focus: "Nghe + phát âm", skills: ["listening", "speaking"] },
  { focus: "Đọc hiểu", skills: ["reading", "vocabulary"] },
  { focus: "Viết", skills: ["writing", "grammar"] },
  { focus: "Nói + phản xạ", skills: ["speaking", "pronunciation"] },
  { focus: "Ôn tập + bài kiểm tra ngắn", skills: ["review", "assessment"] },
  { focus: "Ôn nhẹ + tiếp xúc tiếng Anh", skills: ["review", "habits"] }
] as const;

export function courseBySlug(slug: string): CourseDefinition {
  const course = COURSE_DEFINITIONS.find((item) => item.slug === slug);
  if (!course) throw new Error(`Khóa học không tồn tại: ${slug}`);
  return course;
}

export function startingWeek(slug: CourseSlug, level: string): number {
  const map: Record<CourseSlug, Record<string, number>> = {
    foundation: { chua_biet: 1, a1: 5, a2: 11, b1: 14, b2: 14, c1: 14 },
    b1: { chua_biet: 1, a1: 1, a2: 1, b1: 7, b2: 12, c1: 12 },
    b2: { chua_biet: 1, a1: 1, a2: 1, b1: 1, b2: 9, c1: 14 },
    toeic: { chua_biet: 1, a1: 1, a2: 1, b1: 1, b2: 1, c1: 1 },
    ielts: { chua_biet: 1, a1: 1, a2: 1, b1: 1, b2: 2, c1: 3 },
    conversation: { chua_biet: 1, a1: 1, a2: 4, b1: 8, b2: 10, c1: 10 },
    workplace: { chua_biet: 1, a1: 1, a2: 1, b1: 4, b2: 8, c1: 10 },
    travel: { chua_biet: 1, a1: 1, a2: 3, b1: 5, b2: 7, c1: 7 }
  };
  return map[slug][level] ?? 1;
}

export function buildLessonContent(course: CourseDefinition, week: number, day: number, dailyMinutes: number) {
  const safeWeek = Math.max(1, Math.min(course.durationWeeks, week));
  const safeDay = Math.max(1, Math.min(7, day));
  const totalMinutes = Math.max(10, Math.min(180, Math.round(dailyMinutes)));
  const theme = course.weeks[safeWeek - 1];
  const daily = DAY_FOCUS[safeDay - 1];
  const warmup = Math.max(1, Math.round(totalMinutes * 0.1));
  const input = Math.max(2, Math.round(totalMinutes * 0.3));
  const practice = Math.max(3, Math.round(totalMinutes * 0.4));
  const review = totalMinutes - warmup - input - practice;

  return {
    titleVi: `Tuần ${safeWeek} · Ngày ${safeDay}: ${daily.focus} — ${theme}`,
    objectives: [
      `Hiểu và sử dụng ngôn ngữ trọng tâm của chủ đề “${theme}”.`,
      `Luyện có chủ đích kỹ năng ${daily.skills.join(" và ")}.`,
      "Tự nhận diện lỗi và sửa lại ít nhất một lần."
    ],
    lessonPlan: {
      totalMinutes,
      theme,
      focus: daily.focus,
      skills: daily.skills,
      stages: [
        { name: "Khởi động/ôn cũ", minutes: warmup },
        { name: "Học nội dung mới có ví dụ", minutes: input },
        { name: "Luyện tập chủ động", minutes: practice },
        { name: "Sửa lỗi và ghi nhớ", minutes: review }
      ]
    },
    exercises: {
      requirements: [
        "Tạo bài tập nguyên bản, phù hợp đúng trình độ và chủ đề.",
        "Cho người học trả lời từng câu trước khi đưa đáp án.",
        "Giải thích lỗi bằng tiếng Việt; ví dụ và phần luyện tập dùng tiếng Anh.",
        "Dẫn dắt trẻ trung, tích cực; có thể dùng tối đa 1–2 cụm Gen Z phù hợp mỗi lượt nhưng không làm sai lệch kiến thức.",
        "Sau mỗi phần, báo tiến độ ngắn gọn và trao XP mang tính khích lệ.",
        day === 6 ? "Kết thúc bằng bài kiểm tra ngắn 8–12 câu và chấm theo thang 100." : "Kết thúc bằng 3 câu ôn nhớ không nhìn tài liệu."
      ],
      homework: day === 7 ? "Ôn flashcard 10 phút và nghe tiếng Anh thư giãn." : "Làm một nhiệm vụ ứng dụng 5–10 phút sau buổi học."
    }
  };
}
