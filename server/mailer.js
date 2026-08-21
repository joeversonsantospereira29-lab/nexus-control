const nodemailer = require('nodemailer');

let transporter = null;

function init() {
  const host = process.env.MAIL_HOST;
  if (!host || process.env.MAIL_MODE === 'console') {
    // modo console: código aparece no terminal/log do servidor
    console.warn('\n[MAILER] ATENÇÃO: envio de email DESATIVADO (sem MAIL_HOST ou MAIL_MODE=console).');
    console.warn('[MAILER] Os códigos de verificação só aparecerão nos LOGS do servidor.');
    console.warn('[MAILER] Defina MAIL_HOST, MAIL_PORT, MAIL_USER e MAIL_PASS nas variáveis da Railway.\n');
    return;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

async function sendCode(email, code) {
  const subject = 'Seu código de acesso Nexus Control';
  const text = `Nexus Control\n\nSeu código de acesso: ${code}\n\nEle expira em 10 minutos. Se você não pediu este código, ignore este email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e3e3e3;border-radius:12px">
      <h2 style="margin:0 0 8px;color:#0b1020">Nexus Control</h2>
      <p style="color:#444">Use o código abaixo para entrar. Ele expira em <b>10 minutos</b>.</p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0b1020;background:#f4f6fb;border-radius:8px;padding:16px;text-align:center">${code}</div>
      <p style="color:#999;font-size:12px;margin-top:20px">Se você não pediu este código, ignore este email.</p>
    </div>`;

  if (!transporter) {
    console.log('\n==========================================');
    console.log(`[EMAIL MODE=console] Código para ${email}: ${code}`);
    console.log('==========================================\n');
    return { mode: 'console' };
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"Nexus Control" <${process.env.MAIL_USER}>`,
      to: email,
      subject,
      text,
      html,
    });
  } catch (e) {
    console.error('[MAILER] Falha ao enviar email para', email, '-', e.response || e.message);
    throw new Error('Falha ao enviar o email: ' + (e.response || e.message));
  }
  return { mode: 'smtp' };
}

module.exports = { init, sendCode };