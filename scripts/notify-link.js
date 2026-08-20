// =========================================================
// notify-link.js — detecta mudança no link público e envia
// os links (celular + notebook) por email automaticamente.
// Executado por um timer do systemd a cada 2 minutos.
// =========================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DATA = path.join(__dirname, '..', 'data');
const TUNNEL_LOG = path.join(DATA, 'tunnel.log');
const TUNNEL_URL_FILE = path.join(DATA, 'tunnel.url');
const LAST_SENT_FILE = path.join(DATA, 'last-sent.url');

const TO_EMAIL = process.env.NEXUS_AGENT_EMAIL || process.env.MAIL_USER;
const PC_LINK = 'http://localhost:3000';

function getCurrentTunnelUrl() {
  try {
    const log = fs.readFileSync(TUNNEL_LOG, 'utf8');
    const matches = log.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/g);
    return matches && matches.length ? matches[matches.length - 1] : '';
  } catch {
    return '';
  }
}

function readLastSent() {
  try {
    return fs.readFileSync(LAST_SENT_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

async function isReachable(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url + '/', { signal: controller.signal, method: 'GET' });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function sendEmail(phoneLink) {
  if (!process.env.MAIL_HOST || process.env.MAIL_MODE === 'console') {
    console.log(`[MODE=console] Novo link: ${phoneLink}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === 'true',
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #1a2a55;border-radius:14px;background:linear-gradient(160deg,#0b1020,#12204a)">
    <h2 style="margin:0 0 8px;color:#8fd0ff">🛰️ Nexus Control — novo link de acesso</h2>
    <p style="color:#c9d4ff">Seu notebook ligou e o link público foi renovado. Use os links abaixo:</p>

    <div style="background:rgba(255,255,255,.07);border:1px solid #2a4a8a;border-radius:10px;padding:14px;margin:12px 0">
      <div style="font-size:13px;color:#9fb4e8">📱 <b>No celular</b> (novo link):</div>
      <a href="${phoneLink}" style="font-size:15px;font-weight:bold;color:#6fe3ff;word-break:break-all;display:block;margin-top:4px">${phoneLink}</a>
    </div>

    <div style="background:rgba(255,255,255,.07);border:1px solid #2a4a8a;border-radius:10px;padding:14px;margin:12px 0">
      <div style="font-size:13px;color:#9fb4e8">💻 <b>Neste notebook</b> (link local):</div>
      <div style="font-size:15px;font-weight:bold;color:#8fd0ff;margin-top:4px">${PC_LINK}</div>
    </div>

    <p style="color:#7d8ec0;font-size:12px;margin-top:16px">
      Guarde este email. Sempre que o notebook religar, um novo link chegará automaticamente aqui.
    </p>
  </div>`;
  await transporter.sendMail({
    from: process.env.MAIL_FROM || `"Nexus Control" <${process.env.MAIL_USER}>`,
    to: TO_EMAIL,
    subject: '🛰️ Novo link do Nexus Control (celular)',
    html,
  });
}

async function main() {
  const url = getCurrentTunnelUrl();
  if (!url) {
    console.log('Ainda sem link público no log.');
    return;
  }
  fs.writeFileSync(TUNNEL_URL_FILE, url);

  if (url === readLastSent()) {
    console.log('Link inalterado, nada a fazer.');
    return;
  }

  console.log('Novo link detectado:', url, '— verificando se está no ar…');
  if (!(await isReachable(url))) {
    console.log('Link ainda não está no ar. Tentarei novamente na próxima rodada.');
    return;
  }

  await sendEmail(url);
  fs.writeFileSync(LAST_SENT_FILE, url);
  console.log('Email enviado com o novo link.');
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});