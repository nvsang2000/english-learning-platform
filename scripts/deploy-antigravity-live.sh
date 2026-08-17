#!/usr/bin/env bash
set -euo pipefail

source_root="${1:?source workspace path is required}"
live_root="${2:?live plugin path is required}"

if [[ "$source_root" != "/database/server/micorservice/english-learning-platform" ]]; then
  echo "Unexpected source path: $source_root" >&2
  exit 2
fi
if [[ "$live_root" != "/home/nvsang/english-learning-platform" ]]; then
  echo "Unexpected live path: $live_root" >&2
  exit 2
fi
if [[ ! -f "$source_root/openclaw.plugin.json" || ! -f "$live_root/openclaw.plugin.json" ]]; then
  echo "Source or live plugin manifest is missing." >&2
  exit 2
fi

backup_root="/home/nvsang/.openclaw/state/deployment-backups"
backup_file="$backup_root/english-learning-before-antigravity-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
mkdir -p "$backup_root"
backup_entries=(.gitignore README.md openclaw.plugin.json package.json package-lock.json tsconfig.json src systemd)
for optional_entry in docker-compose.yml db curriculum; do
  if [[ -e "$live_root/$optional_entry" ]]; then
    backup_entries+=("$optional_entry")
  fi
done
tar -C "$live_root" -czf "$backup_file" "${backup_entries[@]}"
echo "Backup created: $backup_file"

cp -a \
  "$source_root/.gitignore" \
  "$source_root/README.md" \
  "$source_root/openclaw.plugin.json" \
  "$source_root/package.json" \
  "$source_root/package-lock.json" \
  "$source_root/tsconfig.json" \
  "$source_root/docker-compose.yml" \
  "$live_root/"
mkdir -p "$live_root/src" "$live_root/dist" "$live_root/scripts" "$live_root/systemd" "$live_root/tests" "$live_root/db" "$live_root/curriculum"
cp -a "$source_root/src/." "$live_root/src/"
cp -a "$source_root/dist/." "$live_root/dist/"
cp -a "$source_root/scripts/." "$live_root/scripts/"
cp -a "$source_root/systemd/." "$live_root/systemd/"
cp -a "$source_root/tests/." "$live_root/tests/"
cp -a "$source_root/db/." "$live_root/db/"
cp -a "$source_root/curriculum/." "$live_root/curriculum/"
cp -a "$source_root/.env.antigravity.example" "$live_root/.env.antigravity.example"

node "$source_root/scripts/setup-antigravity-env.mjs" "$live_root"
node --env-file="$live_root/.env.worker" "$live_root/dist/migrate.js" "$live_root/db/init"
node --env-file="$live_root/.env.worker" "$live_root/dist/seed.js"
(cd "$live_root" && node --env-file=.env.worker dist/curriculum-ingest.js --root curriculum --no-embeddings)

mkdir -p /home/nvsang/.openclaw/state/antigravity-english-workspace
systemctl --user link "$live_root/systemd/english-learning-antigravity-gateway.service" >/dev/null 2>&1 || true
systemctl --user daemon-reload
systemctl --user enable --now english-learning-antigravity-gateway.service

# Tránh Gateway tự reload giữa chuỗi config set và ngắt phần validate/deploy còn lại.
systemctl --user stop openclaw-gateway.service >/dev/null 2>&1 || true
provider_json='{"baseUrl":"http://127.0.0.1:18101/v1","api":"openai-completions","models":[{"id":"antigravity-default","name":"Antigravity (local account)","reasoning":true,"input":["text"],"contextWindow":200000,"contextTokens":100000,"maxTokens":8192,"compat":{"supportsTools":true,"requiresStringContent":true}}]}'
openclaw config set models.providers.antigravity-local "$provider_json" --strict-json --merge
openclaw config set models.providers.antigravity-local.apiKey \
  --ref-provider default --ref-source env --ref-id ANTIGRAVITY_GATEWAY_TOKEN
openclaw config unset plugins.entries.antigravity >/dev/null 2>&1 || true
openclaw config set channels.telegram.dmPolicy open
openclaw config set channels.telegram.allowFrom '["*"]' --strict-json
openclaw config validate
agents_json="$(openclaw config get agents.list --json)"
public_english_index="$(AGENTS_JSON="$agents_json" node -e '
const source = process.env.AGENTS_JSON ?? "";
const start = source.indexOf("[");
if (start < 0) process.exit(2);
const agents = JSON.parse(source.slice(start));
const index = agents.findIndex((agent) => agent?.id === "public-english");
if (index < 0) process.exit(3);
process.stdout.write(String(index));
')"
echo "public-english agent index: $public_english_index"
openclaw config set "agents.list[$public_english_index].model.primary" antigravity-local/antigravity-default
learning_tools_json='["learning_setup_plan","learning_get_today","learning_submit_result","learning_log_game_result","learning_get_progress","learning_set_notifications","learning_search_curriculum","tts"]'
openclaw config set "agents.list[$public_english_index].tools.alsoAllow" "$learning_tools_json" --strict-json
openclaw config validate
systemctl --user enable --now openclaw-gateway.service
systemctl --user restart openclaw-gateway.service
systemctl --user restart english-learning-worker.service

curl -fsS --retry 15 --retry-delay 1 http://127.0.0.1:18101/health
echo
systemctl --user is-active english-learning-antigravity-gateway.service
openclaw models --agent public-english status --plain
echo "Deployment completed. Backup: $backup_file"
