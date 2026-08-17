# English Learning Platform for OpenClaw

Nền tảng lưu lộ trình học tiếng Anh theo từng Telegram ID và gửi bài học hằng ngày.

Hướng dẫn sao lưu và chuyển nguyên hệ thống sang server khác: [SERVER_MIGRATION_GUIDE.md](./SERVER_MIGRATION_GUIDE.md).

## Thành phần

- PostgreSQL riêng: hồ sơ học viên, lộ trình, bài hằng ngày, điểm và lỗi cần cải thiện.
- RabbitMQ riêng: hàng đợi thông báo; không chứa token Telegram.
- Plugin OpenClaw `english-learning`: cung cấp bảy công cụ học tập đã giới hạn theo danh tính Telegram đáng tin cậy của lượt chat, gồm lưu kết quả mini-game và tìm kiếm kho học liệu có dẫn nguồn.
- Worker: tạo thông báo đến hạn và gọi `openclaw message send`.
- Telegram `/start`: cho từng người tự chọn cách Bé 3 gọi là `anh`, `chị` hoặc `bạn`, sau đó mới chọn hướng giao tiếp/ôn thi; lựa chọn được lưu riêng theo Telegram ID và có thể đổi lại bằng `/start`.
- Menu Telegram `/hoc`: các nút tạo/đổi lộ trình, bài hôm nay, nhập nội dung luyện tập, mini-game, tiến độ và phát âm; callback không chứa Telegram ID.
- TTS Microsoft: tự tạo file MP3 khi phản hồi có câu tiếng Anh cần người học nghe/đọc theo; chỉ đọc phần cần luyện, mặc định giọng Mỹ chậm và có khoảng nghỉ tại chỗ trống.
- Scheduler: nhắc bài chính lúc 07:00 và tùy chọn micro-learning mỗi 30 phút trong khung 07:30–22:00 giờ Việt Nam; không gửi ban đêm.
- Kho 214 từ/cụm từ B1 theo chủ đề học tập, công việc, du lịch, giao tiếp, sức khỏe và đời sống; mỗi Telegram user có lịch sử riêng để không nhận trùng từ.
- Tối Chủ nhật lúc 22:15 giờ Việt Nam, bot gửi tổng kết những từ đã học thành công trong tuần cho từng user.
- Persona Bé 3: tự xưng `em`/`Bé 3`, dễ thương và hài hước nhẹ nhàng; lời nhắc 07:00 thay đổi theo ngày, hỏi thăm việc học và dùng đúng cách xưng hô đã chọn.
- Antigravity gateway: chuyển Antigravity CLI thành endpoint OpenAI-compatible nội bộ, có hỗ trợ `tool_calls` để plugin vẫn lưu được lộ trình và điểm.
- Kho học liệu curriculum: nhập DOCX, XLSX và PNG vào PostgreSQL, tách passage/chủ đề/bảng tham khảo thành chunk, tìm kết hợp full-text + trigram và tùy chọn pgvector; answer key bị loại khỏi tìm kiếm thông thường.

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

Sau khi cập nhật mã nguồn, chạy `npm run build`, `npm run migrate` rồi `npm run seed` để đồng bộ schema và lộ trình vào PostgreSQL trước khi nạp lại plugin OpenClaw. Migration runner lưu checksum trong `schema_migrations`, bỏ qua file đã áp dụng và từ chối migration cũ bị sửa nội dung.

## Nhập và tìm kiếm kho học liệu

PostgreSQL dùng image `pgvector/pgvector:0.8.6-pg17`. Với hệ thống đã có volume, đổi image không xóa dữ liệu nhưng vẫn phải backup database trước khi dựng lại container.

Pipeline hỗ trợ:

- DOCX: lấy đoạn văn và bảng từ OOXML.
- XLSX: giữ tên sheet, thứ tự hàng và cột.
- PNG: OCR bằng Tesseract (`eng`, hoặc `eng+vie` nếu có language pack tiếng Việt).
- Tự gắn metadata B1, kỹ năng, VSTEP và tách file answer key từ file đề `NO KEY`.
- Nhập lặp lại an toàn theo SHA-256; file không đổi sẽ được bỏ qua.

Yêu cầu máy chạy có `unzip` và `tesseract`. Sau khi PostgreSQL đã chạy bằng image pgvector:

```bash
npm run build
node --env-file=.env.worker dist/migrate.js
node --env-file=.env.worker dist/curriculum-ingest.js \
  --root curriculum \
  --no-embeddings
```

Lệnh trên tự áp dụng migration `db/init/006_curriculum_knowledge.sql`. Có thể chạy lại với `--force` khi muốn nhập lại toàn bộ file, hoặc chỉ áp dụng schema:

```bash
node --env-file=.env.worker dist/curriculum-ingest.js --schema-only
```

### Bật semantic search bằng embedding

Không dùng gateway Antigravity cho embedding vì gateway này chỉ cung cấp chat completions. Đặt một endpoint OpenAI-compatible riêng trong môi trường của worker và OpenClaw Gateway:

```dotenv
CURRICULUM_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
CURRICULUM_EMBEDDING_MODEL=ten-model-embedding
CURRICULUM_EMBEDDING_API_KEY=
CURRICULUM_EMBEDDING_BATCH_SIZE=32
```

Sau đó nhập lại để sinh vector:

```bash
node --env-file=.env.worker dist/curriculum-ingest.js --root curriculum --force
```

Nếu endpoint embedding lỗi hoặc chưa cấu hình, tool tự rơi về tìm kiếm full-text + trigram. Không ghi API key vào repo.

### Kiểm duyệt học liệu

Mọi tài liệu mới mặc định có `review_status = 'unreviewed'`; kết quả tool sẽ cảnh báo model không coi đó là đáp án chuẩn. Sau khi giáo viên kiểm tra một file, đánh dấu bằng câu lệnh SQL có tham số/path cụ thể, ví dụ:

```sql
UPDATE curriculum_sources
   SET review_status = 'approved', updated_at = now()
 WHERE source_path = 'curriculum/b1/Read/VSTEP-Reading test 1- NO KEY.docx';
```

Tool `learning_search_curriculum` mặc định không đọc nguồn `answer_key`. Model chỉ được yêu cầu `include_after_attempt` sau khi người học đã gửi bài; policy này cũng được thêm vào system context của Bé 3.

## Dùng một tài khoản Antigravity cho OpenClaw

Gateway gọi `agy` headless cho từng request. OpenClaw giữ lịch sử hội thoại; gateway không tái sử dụng conversation ID của Antigravity giữa các Telegram user, tránh lẫn dữ liệu. Gateway chỉ bind loopback, yêu cầu Bearer token, mặc định xử lý tuần tự và chạy Antigravity ở `plan + sandbox`.

### 1. Đăng nhập và kiểm tra Antigravity

Chạy dưới đúng user vận hành OpenClaw:

```bash
agy
agy models
```

Đăng nhập Google OAuth trong `agy`, chọn/trust workspace riêng `/home/nvsang/.openclaw/state/antigravity-english-workspace`, sau đó thoát CLI. Không sao chép refresh token vào repo.

### 2. Cấu hình gateway

Sao chép `.env.antigravity.example` thành `.env.antigravity`, tạo token dài bằng `openssl rand -hex 32`, rồi đặt cùng token đó vào môi trường của OpenClaw Gateway với tên `ANTIGRAVITY_GATEWAY_TOKEN`.

```bash
npm run build
systemctl --user link /home/nvsang/english-learning-platform/systemd/english-learning-antigravity-gateway.service
systemctl --user enable --now english-learning-antigravity-gateway.service
curl -sS http://127.0.0.1:18101/health
```

### 3. Khai báo provider trong OpenClaw

```bash
openclaw config set models.providers.antigravity-local '{
  "baseUrl":"http://127.0.0.1:18101/v1",
  "api":"openai-completions",
  "models":[{
    "id":"antigravity-default",
    "name":"Antigravity (local account)",
    "reasoning":true,
    "input":["text"],
    "contextWindow":200000,
    "contextTokens":100000,
    "maxTokens":8192,
    "compat":{"supportsTools":true,"requiresStringContent":true}
  }]
}' --strict-json --merge

openclaw config set models.providers.antigravity-local.apiKey \
  --ref-provider default --ref-source env --ref-id ANTIGRAVITY_GATEWAY_TOKEN

openclaw config validate
openclaw models --agent public-english set antigravity-local/antigravity-default
openclaw gateway restart
```

Nếu model mặc định không phù hợp, chạy `agy models` rồi đặt tên hiển thị chính xác vào `ANTIGRAVITY_MODEL` và restart service. Không đặt token trực tiếp trong lệnh hoặc commit `.env.antigravity`.

Để triển khai đúng layout hiện tại trên máy này sau khi đã review thay đổi:

```bash
bash scripts/deploy-antigravity-live.sh \
  /database/server/micorservice/english-learning-platform \
  /home/nvsang/english-learning-platform
```

Script tạo backup trước khi đồng bộ, sinh secret với quyền `0600`, seed curriculum, bật gateway, cấu hình duy nhất agent `public-english`, kiểm tra cấu hình rồi restart OpenClaw.

## Quyền riêng tư và an toàn

Plugin không nhận `user_id` từ mô hình. Mọi thao tác lấy danh tính từ `requesterSenderId` do runtime OpenClaw cung cấp, chỉ hoạt động với agent `public-english` trên Telegram. Không lưu toàn bộ hội thoại; chỉ lưu dữ liệu học tập có cấu trúc.

Bot này phục vụ nhiều học viên qua DM nên cấu hình Telegram phải đồng bộ như sau:

```bash
openclaw config set channels.telegram.dmPolicy open
openclaw config set channels.telegram.allowFrom '["*"]' --strict-json
```

`dmPolicy: open` nhưng `allowFrom` chỉ có một ID sẽ làm callback của mọi học viên khác bị đánh dấu `isAuthorizedSender=false`, dù nút vẫn hiển thị. Quyền quản trị không dùng wildcard này; giữ owner riêng trong `commands.ownerAllowFrom`. Plugin vẫn lấy Telegram ID đáng tin cậy từ callback/runtime và tách dữ liệu từng học viên trong PostgreSQL.
