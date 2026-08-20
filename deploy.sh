#!/usr/bin/env bash
# Deploy do Nexus Control no Railway (via GitHub).
# Rode este script no SEU terminal. Ele pede login no GitHub (abre o navegador).
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"

echo "==> 1/3 Entrando no GitHub (abre o navegador para autorizar)..."
gh auth status >/dev/null 2>&1 || gh auth login --web -h github.com

echo "==> 2/3 Criando repositório e enviando o código..."
gh repo create nexus-control --public --source . --remote origin --push || \
  git remote -v | grep -q origin || { echo "Falha ao criar o repo."; exit 1; }

echo "==> 3/3 Repositório no GitHub criado."
gh repo view --json url -q .url
echo
echo "AGORA, no navegador:"
echo "  1) Crie sua conta grátis em https://railway.app (entrar com GitHub)"
echo "  2) New Project -> Deploy from GitHub repo -> escolha 'nexus-control'"
echo "  3) Vá em Variables e adicione (copie do arquivo data/railway-vars.txt):"
cat data/railway-vars.txt 2>/dev/null || echo "     (gere com: ./railway-vars.sh)"
echo "  4) Railway vai dar a URL https://nexus-control.up.railway.app"
echo
echo "Depois, no .env do notebook:"
echo "  NEXUS_URL=https://nexus-control.up.railway.app"
echo "  NEXUS_TOKEN=<token da aba Agente no site (no Railway)>"
echo "  e rode: npm run agent"