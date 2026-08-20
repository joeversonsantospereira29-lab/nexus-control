const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.json');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
}

function defaultDb() {
  return { users: {}, devices: {}, files: {} };
}

let db = null;
let saveTimer = null;

function load() {
  ensureDirs();
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = defaultDb();
    persist();
  }
}

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 200);
}

function getOrCreateUser(email) {
  email = String(email || '').trim().toLowerCase();
  if (!db.users[email]) {
    db.users[email] = { email, devices: {}, files: {}, createdAt: Date.now() };
    save();
  }
  return db.users[email];
}

function getUser(email) {
  email = String(email || '').trim().toLowerCase();
  return db.users[email] || null;
}

function addDevice(email, device) {
  const user = getOrCreateUser(email);
  user.devices[device.id] = { ...device, lastSeen: Date.now() };
  save();
  return user.devices[device.id];
}

function removeDevice(email, deviceId) {
  const user = getUser(email);
  if (user && user.devices[deviceId]) {
    delete user.devices[deviceId];
    save();
  }
}

function touchDevice(email, deviceId) {
  const user = getUser(email);
  if (user && user.devices[deviceId]) {
    user.devices[deviceId].lastSeen = Date.now();
    save();
  }
}

function getDevices(email) {
  const user = getUser(email);
  return user ? Object.values(user.devices) : [];
}

function listUsers() {
  return Object.keys(db.users);
}

function pruneDevices(email, beforeMs) {
  const user = getUser(email);
  if (!user) return 0;
  let removed = 0;
  for (const id of Object.keys(user.devices)) {
    if (user.devices[id].lastSeen < beforeMs) {
      delete user.devices[id];
      removed++;
    }
  }
  if (removed) save();
  return removed;
}

function getDevice(email, deviceId) {
  const user = getUser(email);
  return user && user.devices[deviceId] ? user.devices[deviceId] : null;
}

function addFile(email, file) {
  const user = getOrCreateUser(email);
  db.files[file.id] = { ...file, owner: email, createdAt: Date.now() };
  user.files[file.id] = db.files[file.id];
  save();
  return db.files[file.id];
}

function getFile(email, fileId) {
  const f = db.files[fileId];
  if (!f || f.owner !== email) return null;
  return f;
}

function listFiles(email) {
  return Object.values(db.files)
    .filter((f) => f.owner === email)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function removeFile(email, fileId) {
  const f = getFile(email, fileId);
  if (!f) return null;
  delete db.files[fileId];
  const user = getUser(email);
  if (user) delete user.files[fileId];
  save();
  try {
    fs.unlinkSync(f.path);
  } catch {}
  return f;
}

function getOrCreateSecret() {
  if (process.env.NEXUS_SECRET) return process.env.NEXUS_SECRET;
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).secret;
  } catch {
    const secret = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret }, null, 2));
    return secret;
  }
}

load();

module.exports = {
  DATA_DIR,
  FILES_DIR: path.join(DATA_DIR, 'files'),
  getOrCreateUser,
  getUser,
  addDevice,
  removeDevice,
  touchDevice,
  getDevices,
  getDevice,
  listUsers,
  pruneDevices,
  addFile,
  getFile,
  listFiles,
  removeFile,
  getOrCreateSecret,
};