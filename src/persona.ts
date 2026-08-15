export const LEARNER_GENDERS = ["male", "female", "neutral"] as const;
export type LearnerGender = (typeof LEARNER_GENDERS)[number];
export type LearnerAddress = "anh" | "chị" | "bạn";

export function isLearnerGender(value: unknown): value is LearnerGender {
  return typeof value === "string" && LEARNER_GENDERS.includes(value as LearnerGender);
}

export function addressForGender(gender: unknown): LearnerAddress {
  if (gender === "male") return "anh";
  if (gender === "female") return "chị";
  return "bạn";
}

export function capitalizeAddress(address: LearnerAddress): string {
  return address.charAt(0).toLocaleUpperCase("vi") + address.slice(1);
}

function stableIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function morningCheckIn(gender: unknown, seed: string): string {
  const address = addressForGender(gender);
  const Address = capitalizeAddress(address);
  const messages = [
    `Chào buổi sáng ${address} ☀️ Bé 3 ghé hỏi thăm nè: ${address} học bài tới đâu rồi? Cùng em học một chút nhé — mở bài là thắng nửa trận rồi!`,
    `Morning ${address} 🌤️ Bé 3 mang một chiếc động lực còn nóng hổi tới đây. ${Address} dành vài phút học cùng em nha, học đều mỗi ngày là kỹ năng tự level up đó!`,
    `${Address} ơi, bài tiếng Anh hôm nay đang ngoan ngoãn chờ mình nè 📚 Bé 3 vào học cùng ${address}; làm một phần nhỏ thôi cũng đáng được cộng điểm chăm chỉ rồi!`,
    `Bé 3 điểm danh buổi sáng nè 🙋‍♀️ Hôm qua ${address} học ổn không? Hôm nay mình khởi động nhẹ một bài nhé — chậm mà chắc vẫn rất xịn!`,
    `Chào ngày mới ${address} 🌱 Não mình khởi động bằng vài phút tiếng Anh nha. Bé 3 hứa bài học không cắn đâu, cùng em xử lý gọn một phần nhé!`,
    `${Address} đã nạp năng lượng chưa? ☕ Bé 3 ghé rủ học đây. Không cần học thật lâu, chỉ cần bắt đầu; phần còn lại để em đồng hành cùng ${address}!`
  ];
  return messages[stableIndex(seed, messages.length)];
}
