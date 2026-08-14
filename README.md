# English Learning Platform for OpenClaw

Nền tảng lưu lộ trình học tiếng Anh theo từng Telegram ID và gửi bài học hằng ngày.

## Thành phần

- PostgreSQL riêng: hồ sơ học viên, lộ trình, bài hằng ngày, điểm và lỗi cần cải thiện.
- RabbitMQ riêng: hàng đợi thông báo; không chứa token Telegram.
- Plugin OpenClaw `english-learning`: cung cấp sáu công cụ học tập đã giới hạn theo danh tính Telegram đáng tin cậy của lượt chat, gồm cả lưu kết quả mini-game.
- Worker: tạo thông báo đến hạn và gọi `openclaw message send`.
- Telegram `/start`: hiện ngay hai hướng `Tiếng Anh giao tiếp` và `Tiếng Anh ôn thi`; mỗi hướng dẫn tới các curriculum riêng.
- Menu Telegram `/hoc`: các nút tạo/đổi lộ trình, bài hôm nay, nhập nội dung luyện tập, mini-game, tiến độ và phát âm; callback không chứa Telegram ID.
- TTS Microsoft: tự tạo voice message khi phản hồi có nội dung tiếng Anh dành cho người học; chỉ đọc phần tiếng Anh, mặc định giọng Mỹ.
- Scheduler: nhắc bài chính lúc 07:00 và tùy chọn micro-learning mỗi 30 phút trong khung 07:30–22:00 giờ Việt Nam; không gửi ban đêm.

Các cổng dịch vụ chỉ bind vào `127.0.0.1`: PostgreSQL `55432`, AMQP `5673`, RabbitMQ Management `15673`.

## Lộ trình có sẵn

Hai hướng học được tách rõ:

- Giao tiếp: Nền tảng A0–A2, Giao tiếp đời thường, English đi làm, English du lịch.
- Ôn thi: B1, B2, TOEIC Listening & Reading, IELTS Academic.

- Foundation A0–A2: 16 tuần
- B1: 16 tuần
- B2: 20 tuần
- TOEIC Listening & Reading: 16 tuần
- IELTS Academic: 24 tuần
- Giao tiếp đời thường: 12 tuần
- English đi làm: 12 tuần
- English du lịch: 8 tuần

Mỗi tuần có một chủ đề. Chu kỳ 7 ngày gồm từ vựng/ngữ pháp, nghe/phát âm, đọc, viết, nói, kiểm tra ngắn và ôn nhẹ. Thời lượng từng phần tự co giãn theo số phút người học đăng ký.

## Luyện tương tác và mini-game

Trong `/hoc`, người học có thể chọn:

- `✍️ Điền nội dung`: điền chỗ trống, sửa câu, dịch Việt–Anh hoặc gửi nội dung riêng để tạo bài luyện.
- `🎮 Chơi game`: Đoán từ, Xếp câu, Giải mã emoji hoặc Role-play Quest.

Mỗi game diễn ra từng vòng để chờ người học trả lời, chấm theo thang 100 và lưu kết quả/XP vào `progress_events`. Phần lời dẫn dùng giọng trẻ trung, có tiết chế; kiến thức và giải thích lỗi vẫn dùng tiếng Việt chuẩn.

Sau khi cập nhật mã nguồn, chạy `npm run build` rồi `npm run seed` để đồng bộ ba khóa học mới vào PostgreSQL trước khi nạp lại plugin OpenClaw.

## Quyền riêng tư và an toàn

Plugin không nhận `user_id` từ mô hình. Mọi thao tác lấy danh tính từ `requesterSenderId` do runtime OpenClaw cung cấp, chỉ hoạt động với agent `public-english` trên Telegram. Không lưu toàn bộ hội thoại; chỉ lưu dữ liệu học tập có cấu trúc.
