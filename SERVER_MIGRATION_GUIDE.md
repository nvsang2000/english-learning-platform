# Hướng dẫn chuyển OpenClaw English Learning sang server mới

Tài liệu này mô tả đúng kiến trúc đang chạy ngày **14/08/2026** trên máy `database@192.168.18.5`, nhưng không chứa token, mật khẩu, API key hoặc Telegram ID. Mục tiêu là chuyển nguyên trạng bot, dữ liệu học viên, lịch sử học, cấu hình Bé 3, OpenClaw, Antigravity và 9router sang một máy Linux khác.

> Cảnh báo quan trọng: không khởi động OpenClaw trên máy mới khi OpenClaw máy cũ vẫn polling cùng Telegram bot token. Hai gateway chạy đồng thời có thể tranh update, làm mất hoặc xử lý lặp tin nhắn.

## 1. Kiến trúc hiện tại

```text
Telegram @leaning_eng_be3_bot
             │
             ▼
OpenClaw Gateway :18789 (loopback)
             │
             ├── agent public-english
             │     ├── primary: Antigravity local gateway :18101
             │     ├── fallback 1: 9router/ag/gemini-3-flash-agent :20128
             │     └── fallback 2: 9router/cx/gpt-5.6-luna :20128
             │
             └── plugin english-learning
                   └── PostgreSQL :55432

English Learning Worker
             ├── PostgreSQL outbox
             ├── RabbitMQ :5673
             └── openclaw message send → Telegram
```

Tất cả cổng dịch vụ chỉ nghe trên `127.0.0.1`; không cần và không nên mở trực tiếp ra Internet.

### Phiên bản đang dùng

| Thành phần | Phiên bản hiện tại |
|---|---:|
| Hệ điều hành | Debian 13.2 x86_64 |
| Node dùng cho service | 24.18.0 |
| OpenClaw | 2026.7.1-2 |
| 9router | 0.5.40 |
| Antigravity CLI `agy` | 1.1.13 |
| Docker Engine | 29.1.3 |
| Docker Compose | 5.0.0 |
| PostgreSQL container | pgvector/pgvector 0.8.6-pg17 |
| RabbitMQ container | 4-management-alpine |
| English Learning plugin | 1.5.0 |

Khi chuyển máy, nên cài đúng các phiên bản này trước. Chỉ nâng phiên bản sau khi việc chuyển máy đã hoàn tất và có backup riêng.

### Đường dẫn quan trọng

| Dữ liệu | Đường dẫn hiện tại |
|---|---|
| Người dùng vận hành | `database` |
| Mã English Learning | `/home/database/english-learning-platform` |
| Toàn bộ state OpenClaw | `/home/database/.openclaw` |
| Cấu hình chính | `/home/database/.openclaw/openclaw.json` |
| Workspace Bé 3 | `/home/database/.openclaw/workspace-public-english` |
| Session agent Bé 3 | `/home/database/.openclaw/agents/public-english` |
| Dữ liệu và credential 9router | `/home/database/.9router` |
| Antigravity CLI | `/home/database/.local/bin/agy` |
| Dữ liệu đăng nhập Antigravity | `/home/database/.gemini` |
| Project env | `.env`, `.env.worker`, `.env.openclaw`, `.env.antigravity` |
| User services | `/home/database/.config/systemd/user` |

Các thư mục `.openclaw`, `.9router`, `.gemini` và các file `.env*` đều là dữ liệu mật. Backup của chúng có quyền tương đương quyền điều khiển bot và tài khoản model.

## 2. Chọn phương án model sau khi chuyển

Cấu hình hiện tại là phương án A.

### A — Antigravity chính, 9router dự phòng (hiện tại)

- Primary: `antigravity-local/antigravity-default`.
- Fallback: `9router/ag/gemini-3-flash-agent`, sau đó `9router/cx/gpt-5.6-luna`.
- Cần chạy cả `english-learning-antigravity-gateway.service` và `9router.service`.
- Đây là phương án nên dùng để sao chép giống máy cũ nhất.

### B — Chỉ dùng 9router

- Không cần service Antigravity.
- Đặt primary thành một model 9router đã kiểm tra được.
- Phù hợp nếu chưa thể đăng nhập Google trên server mới.

### C — Chỉ dùng Antigravity

- Không cần 9router, nhưng sẽ mất fallback khi Antigravity hết quota hoặc lỗi đăng nhập.
- Không khuyến nghị cho bot cần hoạt động liên tục.

## 3. Chuẩn bị server mới

Nên giữ cùng username `database` để không phải sửa nhiều đường dẫn. Nếu dùng username khác, phải thay toàn bộ `/home/database` trong systemd unit, env, OpenClaw config, workspace và plugin path.

Yêu cầu cơ bản:

- Debian/Ubuntu x86_64, đồng bộ giờ bằng NTP.
- SSH key, firewall và backup storage an toàn.
- Docker Engine + Compose plugin.
- Node.js 24.18.0 và npm.
- Cho user `database` dùng Docker và bật systemd lingering.
- Cho phép outbound HTTPS tới Telegram, Google Antigravity và các provider được cấu hình trong 9router.
- Tối thiểu khoảng 2 GB dung lượng trống; nên có 4 GB trở lên cho backup, build và audio tạm.

Ví dụ phần user/service:

```bash
sudo adduser database
sudo usermod -aG docker database
sudo loginctl enable-linger database
```

Đăng xuất/đăng nhập lại sau khi thêm group Docker. Từ bước tiếp theo, chạy bằng user `database`, không chạy OpenClaw bằng root.

### Cài đúng Node, OpenClaw và 9router

Nếu dùng NVM:

```bash
nvm install 24.18.0
nvm alias default 24.18.0
nvm use 24.18.0
npm install -g openclaw@2026.7.1-2 9router@0.5.40
node --version
openclaw --version
9router --version
```

OpenClaw chính thức hướng dẫn cài gateway Linux dưới dạng systemd user service và bật lingering. Tham khảo [OpenClaw Linux](https://docs.openclaw.ai/platforms/linux) và [Gateway runbook](https://docs.openclaw.ai/gateway).

### Cài Antigravity CLI

Lệnh cài chính thức cho Linux:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version
```

Sau đó chạy `agy` bằng đúng user `database` và hoàn tất Google Sign-In. Trên SSH, CLI sẽ hiển thị URL để đăng nhập từ trình duyệt khác. Xem [Google Antigravity CLI](https://antigravity.google/docs/cli-getting-started?authuser=0).

Khuyến nghị đăng nhập mới trên server đích. Chỉ sao chép `.gemini` khi đã xác nhận credential cho phép chuyển máy; OAuth/keyring có thể gắn với môi trường cũ.

## 4. Chuẩn bị backup trên máy cũ

### 4.1 Kiểm tra trước khi dừng

```bash
cd /home/database/english-learning-platform
npm test
docker compose ps
systemctl --user --no-pager is-active \
  openclaw-gateway.service \
  english-learning-worker.service \
  english-learning-antigravity-gateway.service \
  9router.service
```

Kết quả mong đợi: test đều pass, PostgreSQL/RabbitMQ healthy và bốn service đều `active`.

Tạo nơi chứa backup chỉ chủ sở hữu đọc được:

```bash
MIGRATION_DIR="/home/database/migration-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$MIGRATION_DIR"
install -d -m 700 "$MIGRATION_DIR/openclaw-native"
```

### 4.2 Bắt đầu thời gian cutover

Dừng các thành phần tạo/nhận dữ liệu, nhưng giữ PostgreSQL chạy để dump:

```bash
systemctl --user stop english-learning-worker.service
systemctl --user stop openclaw-gateway.service
systemctl --user stop english-learning-antigravity-gateway.service
systemctl --user stop 9router.service
```

Từ thời điểm này bot tạm ngừng phản hồi. Không khởi động lại gateway cũ nếu chuẩn bị bật gateway mới.

### 4.3 Backup OpenClaw

Tạo một backup có manifest và kiểm tra bằng CLI:

```bash
openclaw backup create --output "$MIGRATION_DIR/openclaw-native" --verify
```

Đồng thời tạo archive toàn bộ state để restore trực tiếp đúng theo hướng dẫn migration của OpenClaw:

```bash
tar --acls --xattrs -C /home/database \
  -czf "$MIGRATION_DIR/openclaw-state.tgz" .openclaw
```

Không chỉ sao chép `openclaw.json`. Toàn bộ state còn chứa auth profile, channel state, session và workspace. Xem [OpenClaw migration guide](https://docs.openclaw.ai/install/migrating).

### 4.4 Backup PostgreSQL

Nạp biến môi trường mà không in giá trị:

```bash
cd /home/database/english-learning-platform
set -a
. ./.env
set +a
```

Tạo logical dump:

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$MIGRATION_DIR/english-learning-postgres.dump"
```

Kiểm tra dump đọc được:

```bash
pg_restore --list "$MIGRATION_DIR/english-learning-postgres.dump" >/dev/null
```

Dump này chứa học viên, cách xưng hô, lộ trình, lịch sử từ vựng, điểm, bài học, notification outbox và chỉ mục kho học liệu curriculum.

### 4.5 Backup code và env

```bash
tar -C /home/database \
  --exclude='english-learning-platform/node_modules' \
  --exclude='english-learning-platform/dist' \
  -czf "$MIGRATION_DIR/english-learning-project.tgz" \
  english-learning-platform
```

Archive vẫn chứa `.env`, `.env.worker`, `.env.openclaw` và `.env.antigravity`; vì vậy phải coi nó là secret.

### 4.6 Backup 9router và systemd

9router đã được dừng nên SQLite có thể sao chép nhất quán:

```bash
tar --acls --xattrs -C /home/database \
  -czf "$MIGRATION_DIR/9router-state.tgz" .9router

tar -C /home/database -czf "$MIGRATION_DIR/systemd-user.tgz" \
  .config/systemd/user/openclaw-gateway.service \
  .config/systemd/user/openclaw-gateway.service.d \
  .config/systemd/user/english-learning-worker.service \
  .config/systemd/user/english-learning-antigravity-gateway.service \
  .config/systemd/user/9router.service
```

`.9router` chứa SQLite, API key, JWT secret và tài khoản provider. Không lấy riêng `data.sqlite` mà bỏ các file secret còn lại.

Nếu quyết định chuyển credential Antigravity thay vì đăng nhập mới:

```bash
tar --acls --xattrs -C /home/database \
  -czf "$MIGRATION_DIR/antigravity-auth.tgz" .gemini
```

### 4.7 Checksum và chuyển file

```bash
cd "$MIGRATION_DIR"
sha256sum *.tgz *.dump > SHA256SUMS
sha256sum -c SHA256SUMS
```

Chuyển bằng SSH/rsync vào một thư mục mode `0700` trên server mới:

```bash
rsync -a --info=progress2 "$MIGRATION_DIR/" \
  database@NEW_SERVER:/home/database/migration-in/
```

Không gửi các archive này qua chat, email hoặc lưu trong Git. Nếu lưu lâu, mã hóa backup và quản lý khóa mã hóa riêng.

## 5. Restore trên server mới

### 5.1 Xác thực archive

```bash
cd /home/database/migration-in
sha256sum -c SHA256SUMS
```

### 5.2 Restore code

```bash
cd /home/database
tar -xzf /home/database/migration-in/english-learning-project.tgz
cd /home/database/english-learning-platform
chmod 600 .env .env.worker .env.openclaw .env.antigravity
npm ci
npm test
```

Không chạy `npm update` trong lần cutover đầu tiên.

### 5.3 Khởi tạo PostgreSQL và RabbitMQ

```bash
cd /home/database/english-learning-platform
docker compose up -d postgres rabbitmq
docker compose ps
```

Chờ cả hai container healthy, sau đó restore PostgreSQL:

```bash
set -a
. ./.env
set +a

docker compose exec -T postgres \
  pg_restore --clean --if-exists --no-owner \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < /home/database/migration-in/english-learning-postgres.dump
```

Đồng bộ curriculum hiện tại:

```bash
node --env-file=.env.worker dist/seed.js
```

RabbitMQ không cần mang queue cũ sang. PostgreSQL outbox là nguồn dữ liệu chính; đưa các bản ghi đang chuyển dở về trạng thái retry:

```bash
docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE notification_outbox SET status='retry', next_attempt_at=now(), updated_at=now() WHERE status IN ('queued','sending');"
```

Worker mới sẽ tự khai báo exchange/queue và phát lại những outbox chưa hoàn tất. Không thay đổi các bản ghi `sent`.

### 5.4 Restore OpenClaw

Đảm bảo gateway mới chưa chạy:

```bash
systemctl --user stop openclaw-gateway.service 2>/dev/null || true
cd /home/database
if test -d .openclaw; then
  mv .openclaw ".openclaw.before-migration-$(date -u +%Y%m%dT%H%M%SZ)"
fi
tar --acls --xattrs -xzf /home/database/migration-in/openclaw-state.tgz
chown -R database:database /home/database/.openclaw
chmod 600 /home/database/.openclaw/openclaw.json
```

Kiểm tra các đường dẫn cũ:

```bash
rg -n '/home/[^/]+' \
  /home/database/.openclaw/openclaw.json \
  /home/database/.openclaw/workspace-public-english \
  /home/database/english-learning-platform/.env.*
```

Nếu username vẫn là `database`, các đường dẫn hiện tại không cần đổi. Nếu username khác, sửa bằng công cụ cấu hình OpenClaw hoặc chỉnh có kiểm soát rồi chạy `openclaw config validate`; không dùng replace mù trên session/database.

Chạy kiểm tra cấu hình:

```bash
openclaw doctor
openclaw config validate
```

### 5.5 Restore và khởi động 9router

```bash
cd /home/database
tar --acls --xattrs -xzf /home/database/migration-in/9router-state.tgz
chown -R database:database /home/database/.9router
chmod 600 /home/database/.9router/auth/cli-secret \
  /home/database/.9router/jwt-secret \
  /home/database/.9router/machine-id
```

Unit hiện tại chạy:

```text
9router --host 127.0.0.1 --port 20128 --no-browser --skip-update
```

Cài/copy `9router.service`, sau đó:

```bash
systemctl --user daemon-reload
systemctl --user enable --now 9router.service
ss -lnt | grep '127.0.0.1:20128'
```

Nếu credential 9router không dùng được trên host mới, mở dashboard qua SSH tunnel, đăng nhập lại từng provider rồi cập nhật API key trong OpenClaw. Không bind dashboard ra `0.0.0.0`.

Ví dụ tunnel từ máy quản trị:

```bash
ssh -L 20128:127.0.0.1:20128 database@NEW_SERVER
```

Sau đó mở `http://127.0.0.1:20128` trên máy quản trị.

### 5.6 Cấu hình Antigravity gateway

Nếu đăng nhập mới, chạy `agy` và hoàn tất xác thực trước. Kiểm tra model:

```bash
agy models
```

`.env.antigravity` hiện cần các key sau:

```dotenv
ANTIGRAVITY_GATEWAY_TOKEN=<random-64-hex>
ANTIGRAVITY_GATEWAY_BIND=127.0.0.1
ANTIGRAVITY_GATEWAY_PORT=18101
ANTIGRAVITY_BIN=/home/database/.local/bin/agy
ANTIGRAVITY_WORKDIR=/home/database/.openclaw/state/antigravity-english-workspace
ANTIGRAVITY_MODEL=gemini-3.7-flash-low
ANTIGRAVITY_MODEL_ID=antigravity-default
ANTIGRAVITY_MAX_CONCURRENCY=1
ANTIGRAVITY_TIMEOUT_MS=300000
ANTIGRAVITY_MAX_BODY_BYTES=524288
```

Token phải giống giá trị `ANTIGRAVITY_GATEWAY_TOKEN` trong `.env.openclaw`. Script trong repo tự lấy home của user đang chạy và có thể sinh lại token mà không in token:

```bash
node scripts/setup-antigravity-env.mjs /home/database/english-learning-platform
chmod 600 .env.antigravity .env.openclaw
```

Khởi động và kiểm tra:

```bash
systemctl --user enable --now english-learning-antigravity-gateway.service
curl -fsS http://127.0.0.1:18101/health
```

### 5.7 Cài các systemd service

Giải nén `systemd-user.tgz` hoặc cài lại các unit tương ứng. Mọi unit phải trỏ tới:

- Node: `/home/database/.nvm/versions/node/v24.18.0/bin/node`.
- Project: `/home/database/english-learning-platform`.
- OpenClaw state: `/home/database/.openclaw`.
- Env đúng service.

Gateway OpenClaw phải có drop-in:

```ini
# ~/.config/systemd/user/openclaw-gateway.service.d/english-learning.conf
[Service]
EnvironmentFile=/home/database/english-learning-platform/.env.openclaw
```

Nạp lại systemd nhưng chưa bật OpenClaw:

```bash
systemctl --user daemon-reload
systemctl --user enable english-learning-worker.service
systemctl --user enable english-learning-antigravity-gateway.service
systemctl --user enable 9router.service
```

## 6. Cấu hình OpenClaw cần đạt được

Restore toàn bộ `.openclaw` sẽ giữ cấu hình này. Dùng danh sách sau để đối chiếu, không chép API key từ tài liệu.

### Agent và Telegram

- Agent ID: `public-english`.
- Workspace: `/home/database/.openclaw/workspace-public-english`.
- Binding: Telegram account `default` → `public-english`.
- Telegram: enabled, DM policy `open`, group policy `disabled`.
- Plugin path: `/home/database/english-learning-platform`.
- Plugin `english-learning`: enabled.
- Plugin config:

```json
{
  "databaseUrlEnv": "ENGLISH_LEARNING_DATABASE_URL",
  "publicAgentId": "public-english"
}
```

### Model provider

9router:

```json
{
  "baseUrl": "http://127.0.0.1:20128/v1",
  "api": "openai-completions"
}
```

Antigravity gateway:

```json
{
  "baseUrl": "http://127.0.0.1:18101/v1",
  "api": "openai-completions",
  "models": [{ "id": "antigravity-default" }]
}
```

Model của `public-english`:

```json
{
  "primary": "antigravity-local/antigravity-default",
  "fallbacks": [
    "9router/ag/gemini-3-flash-agent",
    "9router/cx/gpt-5.6-luna"
  ]
}
```

API key 9router phải lấy từ dashboard 9router hoặc từ cấu hình đã restore. API key Antigravity là SecretRef tới biến `ANTIGRAVITY_GATEWAY_TOKEN`; không ghi token trực tiếp trong tài liệu hoặc Git.

## 7. Cutover và kiểm tra

Chỉ tiếp tục khi gateway OpenClaw máy cũ đã dừng.

Khởi động theo thứ tự:

```bash
systemctl --user start 9router.service
systemctl --user start english-learning-antigravity-gateway.service
systemctl --user start openclaw-gateway.service
systemctl --user start english-learning-worker.service
```

Kiểm tra service và cổng:

```bash
systemctl --user --no-pager --full status \
  9router.service \
  english-learning-antigravity-gateway.service \
  openclaw-gateway.service \
  english-learning-worker.service

ss -lnt | grep -E ':(18101|18789|20128|55432|5673|15673)\b'
```

Kiểm tra OpenClaw:

```bash
openclaw config validate
openclaw plugins list --enabled --verbose
openclaw models --agent public-english status --plain
openclaw channels status --probe
openclaw health
```

Kết quả chính cần thấy:

- Model: `antigravity-local/antigravity-default`.
- Plugin `english-learning` đã nạp.
- Telegram `running`, `connected`, bot đúng username và probe báo `works`.
- Worker log có `Notification worker đã sẵn sàng.`

Kiểm tra nhanh dữ liệu đã restore mà không hiển thị nội dung cá nhân:

```bash
cd /home/database/english-learning-platform
set -a
. ./.env
set +a
docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT (SELECT count(*) FROM learners) AS learners, (SELECT count(*) FROM enrollments) AS enrollments, (SELECT count(*) FROM learner_vocabulary_history) AS vocabulary_history;"
```

Kiểm tra log:

```bash
journalctl --user -u openclaw-gateway.service -n 150 --no-pager
journalctl --user -u english-learning-worker.service -n 100 --no-pager
journalctl --user -u english-learning-antigravity-gateway.service -n 100 --no-pager
journalctl --user -u 9router.service -n 100 --no-pager
```

Kiểm tra chức năng Telegram:

1. Gửi `/start` và xác nhận có nút chọn `anh`, `chị`, `bạn`.
2. Chọn cách xưng hô, mở `/hoc`, kiểm tra Bé 3 gọi đúng.
3. Mở bài hôm nay và gửi một câu trả lời.
4. Thử một bài cần nghe để xác nhận file MP3 được gửi, không phải Telegram voice.
5. Kiểm tra micro-learning kỳ tiếp theo và lịch nhắc 07:00.
6. Kiểm tra một user khác có dữ liệu/lựa chọn tách biệt.

## 8. Rollback

Nếu máy mới lỗi trước khi có dữ liệu học mới quan trọng:

```bash
# Máy mới
systemctl --user stop english-learning-worker.service
systemctl --user stop openclaw-gateway.service

# Máy cũ
systemctl --user start 9router.service
systemctl --user start english-learning-antigravity-gateway.service
systemctl --user start openclaw-gateway.service
systemctl --user start english-learning-worker.service
```

Không chạy hai gateway Telegram cùng lúc. Nếu người dùng đã học trên máy mới, PostgreSQL máy mới đã có dữ liệu mới; không rollback mù về dump cũ. Khi đó phải dừng cả hai phía, tạo dump mới và lập kế hoạch hợp nhất/restore có kiểm soát.

Giữ máy cũ ở trạng thái tắt service ít nhất 3–7 ngày. Chỉ xóa dữ liệu sau khi đã kiểm tra lịch 07:00, micro-learning, tổng kết tuần và có ít nhất một backup mới từ server đích.

## 9. Checklist bàn giao

- [ ] Cùng username hoặc đã sửa toàn bộ đường dẫn.
- [ ] Đúng phiên bản Node/OpenClaw/9router/agy.
- [ ] Checksum backup đạt.
- [ ] PostgreSQL restore đủ dữ liệu học viên.
- [ ] `.env*`, `.openclaw`, `.9router` có owner/mode đúng.
- [ ] Antigravity đăng nhập được và health port 18101 đạt.
- [ ] 9router port 20128 đạt và provider còn hoạt động.
- [ ] OpenClaw config validate đạt.
- [ ] Agent `public-english` dùng đúng primary/fallback.
- [ ] Plugin English Learning đã nạp.
- [ ] Telegram probe báo connected/works.
- [ ] Chỉ một gateway polling bot token.
- [ ] Worker/RabbitMQ hoạt động và không gửi lặp outbox đã `sent`.
- [ ] `/start`, xưng hô Bé 3, `/hoc`, audio MP3 và lịch nhắc đã thử.
- [ ] Backup trên máy mới được tạo và mã hóa.

## 10. Lệnh kiểm kê an toàn

Các lệnh sau chỉ hiển thị tên biến/trạng thái, không in secret:

```bash
for file in .env .env.worker .env.openclaw .env.antigravity; do
  echo "$file"
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/  \1=present/p' "$file"
done

stat -c '%n mode=%a owner=%U:%G' \
  .env .env.worker .env.openclaw .env.antigravity \
  /home/database/.openclaw/openclaw.json
```

Không dùng `cat` với `.env*`, `openclaw.json`, `.9router/auth/cli-secret`, `.9router/jwt-secret` hoặc auth profile trong log/chat hỗ trợ.
