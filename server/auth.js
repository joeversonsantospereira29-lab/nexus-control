const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const store = require('./store');
const mailer = require('./mailer');

const OTP_TTL = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 5;
const JWT_TTL = '30d';

// códigos OTP mantidos em memória (voláteis, por segurança)
const otps = new Map();

function getSecret() {
  return store.getOrCreateSecret();
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function requestCode(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email inválido.');
  }
  store.getOrCreateUser(email);
  const code = newCode();
  otps.set(email, { code, expiresAt: Date.now() + OTP_TTL, attempts: 0 });
  await mailer.sendCode(email, code);
  return { ok: true };
}

function verifyCode(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  const entry = otps.get(email);
  if (!entry) throw new Error('Nenhum código foi solicitado para este email.');
  if (Date.now() > entry.expiresAt) {
    otps.delete(email);
    throw new Error('Código expirado. Solicite um novo.');
  }
  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    otps.delete(email);
    throw new Error('Muitas tentativas. Solicite um novo código.');
  }
  if (entry.code !== code) {
    throw new Error('Código incorreto.');
  }
  otps.delete(email);
  const token = jwt.sign({ email }, getSecret(), { expiresIn: JWT_TTL });
  return { token, email };
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, getSecret());
    return payload.email || null;
  } catch {
    return null;
  }
}

module.exports = { requestCode, verifyCode, verifyToken };