# 🛰️ Nexus Control

Controle seu **celular** e seu **notebook** de qualquer lugar, usando apenas o navegador.
A verificação de acesso é feita por **código enviado por email** (OTP).

> **Aviso importante sobre "controlar a tela do celular":**
> Nenhum navegador permite controlar ou ver a tela de um celular Android/iPhone
> (isso exige um aplicativo nativo, como TeamViewer/RustDesk). Este projeto entrega
> o que é possível e útil pelo navegador: **ver a câmera**, **status** (bateria,
> localização, rede), **abrir links**, **vibrar**, **lanterna**, **arquivos** e
> **controle total do notebook** (tela, mouse, teclado, aplicativos) via agente.

---

## O que funciona

| Função | Celular → Notebook | Notebook → Celular |
|---|---|---|
| Ver tela | ✅ (prints ao vivo) | ❌ (limitação do navegador) |
| Controlar mouse/teclado | ✅ (agente + xdotool) | ❌ |
| Abrir apps / executar comandos | ✅ (agente) | — |
| Ver câmera | ✅ | ✅ (o celular transmite) |
| Lanterna / vibrar | — | ✅ |
| Bateria / localização / status | ✅ (agente) | ✅ (navegador) |
| Central de arquivos | ✅ | ✅ |
| Enviar arquivo direto p/ dispositivo | ✅ (agente baixa) | — |

---

## 🤖 Jarvis — assistente de voz

O Nexus Control tem um assistente estilo "Jarvis" (aba **Jarvis** no site):
- **Fale ou digite** em português e ele **responde falando** (voz do navegador).
- Ele **controla seus dispositivos**: status, bateria, localização, tela do notebook,
  abrir sites/aplicativos, executar comandos, lanterna, vibrar, câmera, arquivos.
- **Sem configurar nada**, ele reconhece comandos prontos. Para conversa livre de
  verdade, adicione uma chave de IA no `.env`:
  ```
  OPENAI_API_KEY=sk-...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o-mini
  ```
  (compatível com Groq/Ollama trocando `OPENAI_BASE_URL`).

Exemplos de comandos:
`"qual a bateria do celular"` · `"onde está o celular"` · `"como está o notebook"` ·
`"ver a tela do notebook"` · `"abrir youtube"` · `"abrir o site twitter.com"` ·
`"abrir o aplicativo vscode"` · `"executar o comando ls -la"` ·
`"listar a pasta ~"` · `"lanterna"` · `"vibrar"` · `"ligar a câmera"` · `"ajuda"`

> A voz usa o microfone/falante do próprio navegador (Chrome/Edge tem melhor suporte).

### Chave de IA grátis (Groq)

1. Acesse https://console.groq.com e entre com Google ou GitHub.
2. Menu **API Keys** → **Create API Key** → copie a chave `gsk_...`.
3. No `.env` do servidor:
   ```
   OPENAI_API_KEY=gsk_...
   OPENAI_BASE_URL=https://api.groq.com/openai/v1
   OPENAI_MODEL=llama-3.3-70b-versatile
   ```
4. Reinicie o servidor.

## 🌐 Colocar na internet (grátis, sem conta)

Com o servidor rodando, use o túnel Cloudflare (gera um link HTTPS público imediato):

```bash
./tunnel.sh        # ou: bash tunnel.sh
# ✅ Link público: https://xxx.trycloudflare.com
```

- Abra esse link no celular **de qualquer lugar** (funciona em 4G/5G).
- HTTPS incluso → **câmera, lanterna e localização funcionam**.
- O link muda a cada vez que o túnel reinicia.

> Para um endereço fixo, faça deploy no Railway (grátis) seguindo as instruções na seção "Deploy".

## 🚀 Tudo rodando junto (servidor + agente)

```bash
./start.sh   # inicia servidor E agente do notebook juntos
```

Pré-requisito: defina `NEXUS_AGENT_EMAIL` no `.env` com o email que você usa no site.
O token do agente é gerado automaticamente em `data/agent.token`.

---

## Como rodar

### 1. Instalar e iniciar o servidor

```bash
cd nexus-control
npm install
cp .env.example .env
npm start
```

Abra `http://localhost:3000` no **notebook**. Para testar no celular na mesma rede,
abra `http://IP-DO-NOTEBOOK:3000` (o IP aparece no início do servidor).

### 2. Email (código de verificação)

Por padrão (`MAIL_MODE=console`) o código aparece **no terminal do servidor** — só para testar.

Para **enviar email de verdade** (funciona com qualquer internet), configure um SMTP
no `.env`. Exemplo com Gmail:
1. Ative a "verificação em 2 etapas" no Google.
2. Crie uma "senha de app" em https://myaccount.google.com/apppasswords
3. Preencha no `.env`:
   ```
   MAIL_MODE=smtp
   MAIL_HOST=smtp.gmail.com
   MAIL_PORT=587
   MAIL_SECURE=false
   MAIL_USER=seuemail@gmail.com
   MAIL_PASS=sua-senha-de-app
   ```
Outros provedores (Outlook, Zoho, Brevo…) funcionam trocando `MAIL_HOST`/`MAIL_PORT`.

### 3. Conectar o celular

No navegador do celular, abra o endereço do servidor, entre com seu email e o código
recebido. Deixe o site aberto. Pronto: ele aparece como dispositivo.

### 4. Agente do notebook (controle total pelo celular)

Para controlar **tela, mouse, teclado e aplicativos** do notebook a partir do celular:

```bash
# no notebook, instale as dependências do sistema (uma vez):
sudo apt install xdotool scrot        # Debian/Ubuntu

# configure o .env com a URL do servidor e o token (aba "Agente" no site):
NEXUS_URL=http://SEU-IP:3000
NEXUS_TOKEN=cole-o-token-aqui

# rode o agente:
npm run agent
```

> Sem `xdotool`/`scrot`, comandos como abrir app/URL e listar pastas ainda funcionam;
> só tela/mouse/teclado precisam deles.

### ⚠️ Câmera, lanterna e localização exigem HTTPS

O navegador só libera câmera e geolocalização em conexões seguras (`https://`).
Para testar na **rede local** com `http://IP`, isso não funciona no Android/iPhone.
Soluções:
- Faça o **deploy online** (Railway/Render fornecem HTTPS grátis), ou
- Rode um túnel como `cloudflared tunnel` / `ngrok` apontando para a porta 3000.

O restante (status, arquivos, comandos, tela do notebook) funciona normalmente em HTTP.

---

## Funcionamento com qualquer internet

- O servidor central conecta os dois dispositivos (celular e notebook), então **não importa**
  se estão em redes diferentes (4G/5G/Wi-Fi).
- Para funcionar fora da rede local, o servidor precisa estar **online**.
  Opções gratuitas: **Railway**, **Render**, **Fly.io** ou um VPS.
- No deploy, defina as variáveis `PORT`, `MAIL_*` e use HTTPS (Railway/Render fornecem).

### Deploy rápido na Railway (grátis)

1. Crie um repositório com esta pasta no GitHub.
2. Em [railway.app](https://railway.app) → New Project → Deploy from GitHub.
3. Adicione as variáveis de ambiente `MAIL_MODE=smtp`, `MAIL_USER`, `MAIL_PASS`, `MAIL_HOST`, `MAIL_FROM`.
4. O site ganha uma URL `https://xxx.up.railway.app` — use essa URL no celular e no `.env` do agente (`NEXUS_URL`).

---

## Segurança

- O token JWT expira em 30 dias; ele identifica você e autoriza o agente.
- O código OTP tem validade de 10 minutos e máximo de 5 tentativas.
- Cada conta só enxerga os próprios dispositivos e arquivos.
- **Não compartilhe** o token do agente nem acesse o servidor sem HTTPS fora da rede local.

## Estrutura

```
nexus-control/
├── server/        # servidor Express + Socket.IO (auth, arquivos, relay)
├── agent/         # agente que roda no notebook (comandos, tela, mouse)
├── public/        # site (login + painel de controle)
└── data/          # banco, arquivos enviados e segredo JWT (gerados)
```