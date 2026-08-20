require('dotenv').config();
const { io } = require('socket.io-client');
const crypto = require('crypto');
const commands = require('./commands');

const SERVER_URL = process.env.NEXUS_URL || process.env.SERVER_URL || 'http://localhost:3000';
const TOKEN = process.env.NEXUS_TOKEN;
const DEVICE_NAME = process.env.NEXUS_DEVICE_NAME || 'Notebook (agente)';

if (!TOKEN) {
  console.error('Faltando NEXUS_TOKEN. Defina no arquivo .env o token (pegue após login no site em "Token do agente").');
  process.exit(1);
}

const deviceId = 'agent-' + crypto.randomBytes(6).toString('hex');

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

const socket = io(SERVER_URL, {
  query: {
    token: TOKEN,
    deviceId,
    deviceName: DEVICE_NAME,
    deviceType: 'agent',
    platform: `${process.platform} ${process.arch}`,
  },
  transports: ['websocket', 'polling'],
  reconnection: true,
});

socket.on('connect', () => {
  log('Conectado ao servidor:', SERVER_URL);
  setInterval(async () => {
    try {
      const status = await commands.getStatus();
      socket.emit('status:report', status);
    } catch (e) {
      log('Erro ao coletar status:', e.message);
    }
  }, 5000);
});

socket.on('disconnect', (reason) => log('Desconectado:', reason));

socket.on('ctrl:recv', async (msg) => {
  const { reqId, type, payload } = msg;
  log('Comando recebido:', type, payload ? JSON.stringify(payload).slice(0, 200) : '');
  try {
    let result;
    switch (type) {
      case 'status:get':
        result = await commands.getStatus();
        break;
      case 'open:url':
        result = await commands.openUrl(payload.url);
        break;
      case 'open:app':
        result = await commands.openApp(payload.command);
        break;
      case 'exec':
        result = await commands.execCommand(payload.command);
        break;
      case 'screen:shot':
        result = await commands.screenshot();
        break;
      case 'files:list':
        result = await commands.listDir(payload.dir);
        break;
      case 'files:get':
        result = await commands.readFileBase64(payload.path);
        break;
      case 'files:put':
        result = await commands.writeFileBase64(payload.path, payload.data);
        break;
      case 'input:mouse':
        result = await commands.mouse(payload.dx, payload.dy, payload.button, payload.click);
        break;
      case 'input:mouseabs':
        result = await commands.mouseMoveAbs(payload.x, payload.y);
        break;
      case 'input:scroll':
        result = await commands.scroll(payload.amount);
        break;
      case 'input:key':
        result = await commands.key(payload.keys);
        break;
      case 'input:type':
        result = await commands.typeText(payload.text);
        break;
      case 'files:download':
        result = await readFromHub(payload.url, payload.token, payload.path);
        break;
      default:
        result = { error: `Tipo de comando desconhecido: ${type}` };
    }
    socket.emit('ctrl:resp', { reqId, ok: !result.error, data: result, error: result.error });
  } catch (e) {
    socket.emit('ctrl:resp', { reqId, ok: false, error: e.message });
  }
});

socket.on('file:push', async (msg) => {
  const { file } = msg || {};
  if (!file || !file.id) return;
  const dest = process.env.NEXUS_DOWNLOAD_DIR || `${process.env.HOME || '.'}/Downloads/Nexus`;
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(dest, { recursive: true });
    const res = await fetch(`${SERVER_URL}/api/files/${file.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error('download falhou: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(dest, file.name), buf);
    log('Arquivo recebido em', path.join(dest, file.name));
  } catch (e) {
    log('Erro ao receber arquivo:', e.message);
  }
});

async function readFromHub(url, token, dest) {
  try {
    const fs = require('fs');
    const path = require('path');
    const res = await fetch(new URL(url, SERVER_URL).toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('download falhou: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const target = expandPath(dest);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    return { ok: true, size: buf.length, path: target };
  } catch (e) {
    return { error: e.message };
  }
}

function expandPath(p) {
  if (p === '~') return process.env.HOME || '.';
  if (String(p).startsWith('~/')) return String(p).replace(/^~/, process.env.HOME || '.');
  return String(p);
}