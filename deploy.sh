#!/usr/bin/env bash
set -Eeuo pipefail

deployment_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$deployment_root"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin are required." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo ".env must be installed before deploying." >&2
  exit 1
fi

if ! grep -Eq '^DISCORD_TOKEN=.+' .env \
  || ! grep -Eq '^DISCORD_CHANNEL_ID=[0-9]{17,20}$' .env \
  || ! grep -Eq '^DISCORD_WELCOME_ROLE_ID=[0-9]{17,20}$' .env \
  || ! grep -Eq '^DISCORD_HONEYPOT_CHANNEL_ID=[0-9]{17,20}$' .env; then
  echo ".env is missing a valid Discord token, channel ID, welcome role ID, or honeypot channel ID." >&2
  exit 1
fi

configured_image="$(sed -n 's/^DISCORD_BOT_IMAGE=//p' .env | tail -n 1)"
if [[ ! "$configured_image" =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]+:[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "DISCORD_BOT_IMAGE must be a tagged GHCR image." >&2
  exit 1
fi
if [[ "$configured_image" == *:latest ]]; then
  echo "Warning: latest is mutable; deploy a commit-SHA or version tag in production." >&2
fi

compose=(docker compose --env-file .env -f compose.yml)
"${compose[@]}" config --quiet

container_id="$("${compose[@]}" ps -q discord-changelog-bot 2>/dev/null || true)"
previous_image=""
if [[ -n "$container_id" ]]; then
  previous_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
fi

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ -n "$previous_image" ]]; then
    echo "Deployment failed; restoring $previous_image." >&2
    DISCORD_BOT_IMAGE="$previous_image" "${compose[@]}" up -d --wait --wait-timeout 60 discord-changelog-bot || true
  fi
  exit "$exit_code"
}
trap rollback ERR

"${compose[@]}" pull discord-changelog-bot
"${compose[@]}" up -d --wait --wait-timeout 60 discord-changelog-bot
trap - ERR
