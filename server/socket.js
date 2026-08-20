const crypto = require('crypto');
const auth = require('./auth');
const store = require('./store');

// mapa de sockets por email
const emailSockets = new Map(); // email -> Set<socketId>
const socketEmail = new Map(); // socketId -> email
const socketDevice = new Map(); // socketId -> deviceId
const pendingResp = new Map(); // reqId -> socketId (origem)
const serverPending = new Map(); // reqId -> {resolve,reject,timer} (comandos do servidor)
const camWatchers = new Map(); // socketId -> deviceId (para qual câmera está assistindo)

let ioRef = null;

async function sendCommand(email, deviceId, type, payload, timeout = 20000) {
  if (!ioRef) throw new Error('Servidor não iniciado.');
  return new Promise((resolve, reject) => {
    const reqId = 'srv' + crypto.randomBytes(6).toString('hex');
    const timer = setTimeout(() => {
      serverPending.delete(reqId);
      reject(new Error('Sem resposta do dispositivo.'));
    }, timeout);
    serverPending.set(reqId, { resolve, reject, timer });
    const targets = getSockets(ioRef, email).filter(
      (s) => socketDevice.get(s.id) === deviceId
    );
    if (!targets.length) {
      clearTimeout(timer);
      serverPending.delete(reqId);
      return reject(new Error('Dispositivo offline.'));
    }
    for (const t of targets) {
      t.emit('ctrl:recv', { reqId, from: 'jarvis', type, payload });
    }
  });
}

function getOnlineDevices(email) {
  if (!ioRef) return store.getDevices(email).map((d) => ({ ...d, online: false }));
  const online = onlineDeviceIds(email);
  return store.getDevices(email).map((d) => ({
    ...d,
    online: online.has(d.id),
  }));
}

function getSockets(io, email) {
  const ids = emailSockets.get(email) || new Set();
  const out = [];
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s) out.push(s);
  }
  return out;
}

function onlineDeviceIds(email) {
  const ids = new Set();
  for (const id of emailSockets.get(email) || new Set()) {
    const dev = socketDevice.get(id);
    if (dev) ids.add(dev);
  }
  return ids;
}

function broadcastDevices(io, email) {
  const online = onlineDeviceIds(email);
  const devices = store.getDevices(email).map((d) => ({
    ...d,
    online: online.has(d.id),
  }));
  for (const s of getSockets(io, email)) {
    s.emit('devices', devices);
  }
}

function setup(io) {
  ioRef = io;
  io.use((socket, next) => {
    const token = socket.handshake.query.token;
    const email = token && auth.verifyToken(token);
    if (!email) return next(new Error('Não autenticado.'));
    socket.data.email = email;
    next();
  });

  io.on('connection', (socket) => {
    const email = socket.data.email;

    // registra o dispositivo
    const q = socket.handshake.query;
    const deviceId = String(q.deviceId || socket.id).slice(0, 64);
    const deviceName = String(q.deviceName || 'Dispositivo').slice(0, 40);
    const deviceType = q.deviceType === 'agent' ? 'agent' : 'browser';

    socketDevice.set(socket.id, deviceId);
    socketEmail.set(socket.id, email);
    if (!emailSockets.has(email)) emailSockets.set(email, new Set());
    emailSockets.get(email).add(socket.id);

    const existing = store.getDevice(email, deviceId) || {};
    store.addDevice(email, {
      id: deviceId,
      name: q.deviceName || existing.name || 'Dispositivo',
      type: deviceType,
      platform: q.platform || existing.platform || 'unknown',
      lastSeen: Date.now(),
    });

    broadcastDevices(io, email);
    socket.emit('joined', { deviceId, email });

    // status (bateria, localização, cpu, etc)
    socket.on('status:report', (status) => {
      store.touchDevice(email, deviceId);
      for (const s of getSockets(io, email)) {
        if (s.id !== socket.id) s.emit('device:status', { deviceId, status });
      }
    });

    // streaming de câmera
    socket.on('cam:watch', (data) => {
      camWatchers.set(socket.id, data.deviceId);
    });
    socket.on('cam:unwatch', () => {
      camWatchers.delete(socket.id);
    });
    socket.on('cam:frame', (frame) => {
      // encaminha apenas para sockets assistindo a câmera deste device
      for (const [wid, watching] of camWatchers) {
        if (watching === deviceId) {
          const watcher = io.sockets.sockets.get(wid);
          if (watcher) watcher.emit('cam:frame', { from: deviceId, ...frame });
        }
      }
    });

    // controle remoto
    socket.on('ctrl:send', (msg) => {
      const { to, reqId, type, payload } = msg || {};
      if (!to || !reqId || !type) return;
      const targets = getSockets(io, email).filter(
        (s) => socketDevice.get(s.id) === to
      );
      pendingResp.set(reqId, socket.id);
      for (const t of targets) {
        t.emit('ctrl:recv', { reqId, from: deviceId, type, payload });
      }
    });

    socket.on('ctrl:resp', (msg) => {
      const { reqId, ok, data, error } = msg || {};
      const sp = serverPending.get(reqId);
      if (sp) {
        serverPending.delete(reqId);
        clearTimeout(sp.timer);
        return ok ? sp.resolve(data) : sp.reject(new Error(error || 'Falha no comando'));
      }
      const originId = pendingResp.get(reqId);
      pendingResp.delete(reqId);
      const origin = originId && io.sockets.sockets.get(originId);
      if (origin) origin.emit('ctrl:resp', { reqId, ok, data, error });
    });

    // notificação de novo arquivo para um dispositivo
    socket.on('file:pushed', (msg) => {
      const { to, file } = msg || {};
      const targets = getSockets(io, email).filter(
        (s) => socketDevice.get(s.id) === to
      );
      for (const t of targets) t.emit('file:push', { file });
    });

    socket.on('disconnect', () => {
      const set = emailSockets.get(email);
      if (set) set.delete(socket.id);
      socketEmail.delete(socket.id);
      socketDevice.delete(socket.id);
      camWatchers.delete(socket.id);
      broadcastDevices(io, email);
    });
  });
}

module.exports = { setup, sendCommand, getOnlineDevices };