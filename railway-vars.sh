#!/usr/bin/env bash
# Gera a lista de variáveis de ambiente para colar no Railway (sem segredos de arquivo).
cd "$(dirname "$0")"
mkdir -p data
cat > data/railway-vars.txt <<'EOF'
PORT=3000
MAIL_MODE=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=joeversonsantospereira29@gmail.com
MAIL_PASS=ectfyofscerzispb
MAIL_FROM=Nexus Control <joeversonsantospereira29@gmail.com>
OPENAI_API_KEY=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
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=openai/gpt-oss-120b
NEXUS_AGENT_EMAIL=joeversonsantospereira29@gmail.com
EOF
echo "Variáveis gravadas em data/railway-vars.txt"
echo
echo "=== Copie isto e cole no Railway (Variables) ==="
cat data/railway-vars.txt