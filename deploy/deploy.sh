#!/bin/sh
# Pousse le repo sur le VPS et (re)lance site + relais.
set -e
HOST="${HOST:-root@187.124.38.234}"
cd "$(dirname "$0")/.."
rsync -az --delete --exclude .git --exclude node_modules ./ "$HOST:/docker/tchat/"
ssh "$HOST" 'cd /docker/tchat/deploy && docker compose up -d --build \
  && docker compose exec -T relay ntfy access everyone "tc_*" rw >/dev/null \
  && docker compose ps'
