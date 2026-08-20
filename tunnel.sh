#!/usr/bin/env bash
# Cria um link público HTTPS (grátis) para o servidor usando cloudflared.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"

PORT="${1:-3000}"
echo "Abrindo túnel para http://localhost:${PORT} ..."

cloudflared tunnel --url "http://localhost:${PORT}" \
  > data/tunnel.log 2>&1 &

for i in $(seq 1 20); do
  sleep 1
  URL=$(grep -oP 'https://[-a-z0-9]+\.trycloudflare\.com' data/tunnel.log | head -1)
  if [ -n "$URL" ]; then
    echo "$URL" > data/tunnel.url
    echo "✅ Link público: $URL"
    echo "(guardado em data/tunnel.url)"
    exit 0
  fi
done

echo "Não consegui obter o link. Veja data/tunnel.log"