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

if ! grep -Eq '^DISCORD_TOKEN=.+' .env || ! grep -Eq '^DISCORD_CHANNEL_ID=[0-9]{17,20}$' .env; then
  echo ".env is missing a valid DISCORD_TOKEN or DISCORD_CHANNEL_ID." >&2
  exit 1
fi

docker compose --env-file .env -f compose.yml pull discord-changelog-bot
docker compose --env-file .env -f compose.yml up -d --wait --wait-timeout 60 discord-changelog-bot
