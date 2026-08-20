#!/usr/bin/env bash
# Inicia o servidor e o agente do notebook juntos.
set -e
cd "$(dirname "$0")"

export PATH="$HOME/.local/bin:$PATH"

# inicia o servidor (em segundo plano)
node server/index.js > data/server.log 2>&1 &
SERVER_PID=$!
echo "Servidor iniciado (PID $SERVER_PID) - http://localhost:3000"

# aguarda o servidor gerar o token do agente
sleep 2
if [ -f data/agent.token ] && [ -n "$NEXUS_AGENT_EMAIL" ]; then
  node agent/agent.js > data/agent.log 2>&1 &
  echo "Agente iniciado (PID $!) - controle total do notebook ativo"
fi

# mostra o link público (cloudflared) se estiver configurado
if command -v cloudflared >/dev/null 2>&1 && [ -f data/tunnel.url ]; then
  echo "Link público: $(cat data/tunnel.url)"
fi

echo
echo "Pressione Ctrl+C para parar tudo."
wait $SERVER_PID