const path = require('path');
const multer = require('multer');
const express = require('express');
const auth = require('./auth');
const store = require('./store');
const jarvis = require('./jarvis');

const MAX_FILE = 1024 * 1024 * 1024; // 1 GB por arquivo

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.FILES_DIR),
    filename: (req, file, cb) => {
      const id = require('crypto').randomBytes(8).toString('hex');
      cb(null, `${id}-${Date.now()}`);
    },
  }),
  limits: { fileSize: MAX_FILE },
});

function router(io) {
  const r = express.Router();

  r.post('/api/auth/request', async (req, res) => {
    try {
      const { mode } = await auth.requestCode(req.body.email);
      const message = mode === 'console'
        ? 'AVISO: o servidor está sem email configurado. O código aparece apenas nos logs do Railway.'
        : 'Código enviado. Verifique seu email (veja também o spam).';
      res.json({ ok: true, mode, message });
    } catch (e) {
      console.error('[AUTH] request-code falhou:', e.message);
      res.status(400).json({ error: e.message });
    }
  });

  r.post('/api/auth/verify', (req, res) => {
    try {
      const result = auth.verifyCode(req.body.email, req.body.code);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(401).json({ error: e.message });
    }
  });

  const requireAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const email = token && auth.verifyToken(token);
    if (!email) return res.status(401).json({ error: 'Não autenticado.' });
    req.email = email;
    next();
  };

  r.get('/api/me', requireAuth, (req, res) => {
    res.json({
      email: req.email,
      devices: store.getDevices(req.email),
      files: store.listFiles(req.email),
    });
  });

  r.post('/api/jarvis', requireAuth, async (req, res) => {
    const message = String(req.body.message || '').slice(0, 1000);
    const deviceId = String(req.body.deviceId || '');
    if (!message) return res.status(400).json({ error: 'Mensagem vazia.' });
    try {
      const result = await jarvis.handle(req.email, message, deviceId);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post('/api/files', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const rec = store.addFile(req.email, {
      id: require('crypto').randomBytes(8).toString('hex'),
      name: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
      mime: req.file.mimetype,
    });
    res.json({ ok: true, file: rec });
  });

  r.get('/api/files', requireAuth, (req, res) => {
    res.json({ files: store.listFiles(req.email) });
  });

  r.get('/api/files/:id', requireAuth, (req, res) => {
    const f = store.getFile(req.email, req.params.id);
    if (!f) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.download(f.path, f.name);
  });

  r.delete('/api/files/:id', requireAuth, (req, res) => {
    const f = store.removeFile(req.email, req.params.id);
    res.json({ ok: !!f });
  });

  return r;
}

module.exports = router;