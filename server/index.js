require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const mailer = require('./mailer');
const routes = require('./routes');
const store = require('./store');
const { setup: setupSocket, pruneStale } = require('./socket');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// token do agente gerado automaticamente (se NEXUS_AGENT_EMAIL estiver no .env)
function ensureAgentToken() {
  const email = process.env.NEXUS_AGENT_EMAIL;
  if (!email) return null;
  const tokenFile = path.join(store.DATA_DIR, 'agent.token');
  try {
    const existing = fs.readFileSync(tokenFile, 'utf8');
    if (jwt.verify(existing, store.getOrCreateSecret())) return existing;
  } catch {}
  const token = jwt.sign({ email: String(email).trim().toLowerCase() }, store.getOrCreateSecret(), { expiresIn: '365d' });
  fs.writeFileSync(tokenFile, token);
  store.getOrCreateUser(email);
  return token;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2 * 1024 * 1024, // 2 MB por frame (câmera)
});

mailer.init();
app.use(routes(io));
setupSocket(io);

// limpa dispositivos antigos no início e a cada 1 minuto
pruneStale();
setInterval(pruneStale, 60 * 1000);

server.listen(PORT, HOST, () => {
  const token = ensureAgentToken();
  console.log(`\nNexus Control rodando em http://${HOST}:${PORT}`);
  if (token) {
    console.log(`Token do agente gerado para ${process.env.NEXUS_AGENT_EMAIL} em data/agent.token`);
    console.log('O agente será iniciado pelo start.sh automaticamente.\n');
  } else {
    console.log('Para o agente rodar sozinho, defina NEXUS_AGENT_EMAIL no .env.\n');
  }
});