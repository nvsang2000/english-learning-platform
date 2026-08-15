export type VocabularySummaryItem = {
  english_text: string;
  phonetic_text: string;
  vietnamese_meaning: string;
  category: string;
};

const categoryLabels: Record<string, string> = {
  "b1-core": "B1 cốt lõi",
  "daily-life": "Đời sống",
  study: "Học tập",
  work: "Công việc",
  travel: "Du lịch",
  social: "Giao tiếp",
  health: "Sức khỏe"
};

export function preferredVocabularyCategories(courseSlug?: string | null): string[] {
  if (courseSlug === "workplace" || courseSlug === "toeic") return ["work", "b1-core", "daily-life", "social"];
  if (courseSlug === "travel") return ["travel", "daily-life", "social", "b1-core"];
  if (courseSlug === "foundation" || courseSlug === "conversation") return ["daily-life", "social", "b1-core", "travel"];
  if (courseSlug === "b1") return ["b1-core", "study", "daily-life", "social"];
  return ["b1-core", "study", "work", "daily-life"];
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function weeklyVocabularySummaryText(
  items: VocabularySummaryItem[],
  weekStart: string,
  weekEnd: string,
  maxLength = 3400,
  address = "bạn"
): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const categoryLine = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => `${categoryLabels[category] ?? category}: ${count}`)
    .join(" · ");

  const lines = [
    `📚 Tổng kết từ vựng tuần · ${displayDate(weekStart)}–${displayDate(weekEnd)}`,
    "",
    `✅ Đã học ${items.length} từ/cụm từ không trùng lặp.`,
    categoryLine ? `🏷 ${categoryLine}` : "",
    "",
    "🔤 Danh sách đã học:"
  ].filter(Boolean);

  let included = 0;
  for (const item of items) {
    const line = `• ${item.english_text} ${item.phonetic_text} — ${item.vietnamese_meaning}`;
    const suffix = `\n\n🎯 ${address.charAt(0).toLocaleUpperCase("vi") + address.slice(1)} chọn 5 từ khó nhất rồi nhắn Bé 3 để ôn bằng câu hoặc mini game nhé.`;
    if ([...lines, line].join("\n").length + suffix.length > maxLength) break;
    lines.push(line);
    included += 1;
  }
  if (included < items.length) lines.push(`• … và ${items.length - included} từ khác trong lịch sử học tuần này.`);
  lines.push("", `🎯 ${address.charAt(0).toLocaleUpperCase("vi") + address.slice(1)} chọn 5 từ khó nhất rồi nhắn Bé 3 để ôn bằng câu hoặc mini game nhé.`);
  return lines.join("\n").slice(0, maxLength);
}
