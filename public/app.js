/* =========================================================
   Nexus Control — frontend
   ========================================================= */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  token: localStorage.getItem('nexus.token') || '',
  email: localStorage.getItem('nexus.email') || '',
  deviceId: localStorage.getItem('nexus.deviceId') || '',
  deviceName: localStorage.getItem('nexus.deviceName') || '',
  socket: null,
  devices: [],
  statuses: {},
  pending: new Map(),
  cameraWatching: false,
  cameraStreaming: false,
  stream: null,
  streamFacing: 'user',
  torchOn: false,
  liveShot: null,
  selectedTarget: '',
  files: [],
};

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
if (!state.deviceId) {
  state.deviceId = 'web-' + Math.random().toString(36).slice(2, 12);
  state.deviceName = isMobile ? 'Celular' : 'Navegador (notebook)';
  localStorage.setItem('nexus.deviceId', state.deviceId);
  localStorage.setItem('nexus.deviceName', state.deviceName);
}

/* ---------------- helpers ---------------- */

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), ms);
}

function setMsg(sel, text, cls) {
  const el = $(sel);
  el.textContent = text || '';
  el.className = 'msg' + (cls ? ' ' + cls : '');
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: 'Bearer ' + state.token,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro ' + res.status);
  return data;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ---------------- login ---------------- */

async function requestCode() {
  const email = $('#login-email').value.trim();
  setMsg('#login-msg', '');
  if (!email) return setMsg('#login-msg', 'Digite seu email.', 'err');
  $('#btn-request').disabled = true;
  try {
    const r = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.email = email;
    $('#step-code').classList.remove('hidden');
    $('#btn-request').classList.add('hidden');
    if (data.mode === 'console') {
      setMsg('#login-msg', 'Servidor sem email configurado! O código está nos logs do Railway (variáveis MAIL_* ausentes).', 'err');
    } else {
      setMsg('#login-msg', 'Código enviado! Verifique seu email (e a caixa de spam).', 'ok');
    }
  } catch (e) {
    setMsg('#login-msg', e.message, 'err');
  } finally {
    $('#btn-request').disabled = false;
  }
}

async function verifyCode() {
  const code = $('#login-code').value.trim();
  setMsg('#login-msg', '');
  if (code.length !== 6) return setMsg('#login-msg', 'Digite os 6 dígitos.', 'err');
  try {
    const r = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.email, code }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.token = data.token;
    state.email = data.email;
    localStorage.setItem('nexus.token', state.token);
    localStorage.setItem('nexus.email', state.email);
    enterApp();
  } catch (e) {
    setMsg('#login-msg', e.message, 'err');
  }
}

async function logout() {
  state.token = '';
  localStorage.removeItem('nexus.token');
  localStorage.removeItem('nexus.email');
  if (state.socket) state.socket.disconnect();
  stopLocalCamera();
  location.reload();
}

/* ---------------- socket ---------------- */

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const socket = io({
    query: {
      token: state.token,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      platform: navigator.userAgent,
    },
    transports: ['websocket', 'polling'],
  });
  state.socket = socket;

  socket.on('connect', () => {
    $('#conn-state').textContent = 'conectado';
    $('#conn-state').classList.add('on');
  });
  socket.on('disconnect', () => {
    $('#conn-state').textContent = 'desconectado';
    $('#conn-state').classList.remove('on');
  });
  socket.on('connect_error', (e) => {
    if (e.message === 'Não autenticado.') logout();
    $('#conn-state').textContent = 'erro de conexão';
    $('#conn-state').classList.remove('on');
  });

  socket.on('joined', ({ deviceId }) => {
    state.deviceId = deviceId;
    localStorage.setItem('nexus.deviceId', deviceId);
    toast('Dispositivo registrado!');
  });

  socket.on('devices', (devices) => {
    state.devices = devices;
    renderDevices();
    renderTargets();
    renderCamSource();
  });

  socket.on('device:status', ({ deviceId, status }) => {
    state.statuses[deviceId] = status;
    renderStatusCards();
  });

  socket.on('cam:frame', (frame) => {
    if (!state.cameraWatching) return;
    const blob = new Blob([frame.data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = $('#cam-img');
    if (img._prevUrl) URL.revokeObjectURL(img._prevUrl);
    img.src = url;
    img._prevUrl = url;
  });

  socket.on('ctrl:resp', (msg) => {
    const p = state.pending.get(msg.reqId);
    if (!p) return;
    state.pending.delete(msg.reqId);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || 'Falha no comando'));
  });

  socket.on('file:push', ({ file }) => {
    toast('📥 Arquivo recebido: ' + file.name);
  });

  // comandos vindos de outro dispositivo (quando este é o alvo)
  socket.on('ctrl:recv', handleRemoteCommand);
}

function ctrl(to, type, payload, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const reqId = 'r' + Math.random().toString(36).slice(2, 12);
    const timer = setTimeout(() => {
      state.pending.delete(reqId);
      reject(new Error('Sem resposta (dispositivo offline?).'));
    }, timeout);
    state.pending.set(reqId, { resolve, reject, timer });
    state.socket.emit('ctrl:send', { to, reqId, type, payload });
  });
}

/* ---------------- comandos que ESTE dispositivo executa ---------------- */

async function handleRemoteCommand(msg) {
  const { reqId, type, payload } = msg;
  const reply = (ok, data, error) =>
    state.socket.emit('ctrl:resp', { reqId, ok, data, error });

  try {
    switch (type) {
      case 'phone:open':
        window.open(payload.url, '_blank');
        reply(true, { opened: payload.url });
        break;
      case 'phone:vibrate':
        if (navigator.vibrate) navigator.vibrate(payload.ms || 400);
        reply(true, {});
        break;
      case 'phone:flash':
        await toggleTorch();
        reply(true, { torch: state.torchOn });
        break;
      case 'phone:status':
        reply(true, await collectBrowserStatus());
        break;
      case 'cam:start':
        await startLocalCamera();
        reply(true, { streaming: state.cameraStreaming });
        break;
      case 'cam:stop':
        stopLocalCamera();
        reply(true, {});
        break;
      case 'phone:toast':
        toast(payload.text || '📱 Comando do outro dispositivo');
        reply(true, {});
        break;
      default:
        reply(false, null, 'Tipo de comando não suportado neste dispositivo: ' + type);
    }
  } catch (e) {
    reply(false, null, e.message);
  }
}

async function collectBrowserStatus() {
  const st = {
    device: state.deviceName,
    platform: navigator.platform || navigator.userAgent,
    online: navigator.onLine,
    time: Date.now(),
  };
  if (navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      st.battery = { level: Math.round(b.level * 100), charging: b.charging };
    } catch {}
  }
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      );
      st.location = {
        lat: pos.coords.latitude.toFixed(5),
        lon: pos.coords.longitude.toFixed(5),
        acc: Math.round(pos.coords.accuracy),
      };
    } catch {}
  }
  if (navigator.connection) {
    st.network = navigator.connection.effectiveType;
  }
  st.mem = navigator.deviceMemory || undefined;
  st.cores = navigator.hardwareConcurrency || undefined;
  return st;
}

/* ---------------- render ---------------- */

function renderDevices() {
  const wrap = $('#device-rows');
  if (!state.devices.length) {
    wrap.innerHTML = '<div class="muted">Nenhum dispositivo ainda.</div>';
    return;
  }
  wrap.innerHTML = state.devices
    .map((d) => {
      const online = d.online;
      const badge = d.type === 'agent' ? '🤖 agente' : d.type === 'browser' ? '🌐 navegador' : '';
      const me = d.id === state.deviceId ? ' (este)' : '';
      return `<div class="device">
        <div class="dev-info">
          <span class="${online ? 'online' : 'offline'}">${online ? '●' : '○'}</span>
          <div>
            <div class="dev-name">${esc(d.name)}${esc(me)}</div>
            <div class="dev-meta">${esc(badge)} · ${esc(d.platform || '')}</div>
          </div>
        </div>
        <div class="dev-actions">
          <button data-act="status" data-id="${esc(d.id)}">📊 Status</button>
          <button data-act="remote" data-id="${esc(d.id)}">🕹️ Controlar</button>
          <button data-act="cam" data-id="${esc(d.id)}">📷 Câmera</button>
        </div>
      </div>`;
    })
    .join('');

  $$('#device-rows .dev-actions button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === 'status') showTab('devices');
      if (btn.dataset.act === 'remote') {
        $('#remote-target').value = id;
        selectTarget();
        showTab('remote');
      }
      if (btn.dataset.act === 'cam') {
        $('#cam-source').value = id;
        showTab('camera');
      }
    });
  });
}

function renderStatusCards() {
  const wrap = $('#status-cards');
  let html = '';
  for (const id of Object.keys(state.statuses)) {
    const d = state.devices.find((x) => x.id === id);
    const name = (d && d.name) || id;
    const s = state.statuses[id];
    const bat = s.battery
      ? `<div class="status-card">
           <div class="k">${esc(name)} · bateria</div>
           <div class="v">${s.battery.level}%${s.battery.charging ? ' ⚡' : ''}</div>
           <div class="bar"><div style="width:${s.battery.level}%"></div></div>
         </div>`
      : '';
    const loc = s.location
      ? `<div class="status-card">
           <div class="k">${esc(name)} · localização</div>
           <div class="v">${s.location.lat}, ${s.location.lon}</div>
           <div class="v small muted">precisão ±${s.location.acc}m</div>
         </div>`
      : '';
    const net = s.network
      ? `<div class="status-card"><div class="k">${esc(name)} · rede</div><div class="v">${s.network} · ${s.online ? 'online' : 'offline'}</div></div>`
      : '';
    const mem = s.mem
      ? typeof s.mem === 'object'
        ? `<div class="status-card"><div class="k">${esc(name)} · memória</div><div class="v">${(s.mem.used / 1073741824).toFixed(1)} GB usados</div><div class="bar"><div style="width:${s.mem.percent}%"></div></div></div>`
        : `<div class="status-card"><div class="k">${esc(name)} · memória</div><div class="v">~${s.mem} GB (estimado)</div></div>`
      : '';
    const host = s.hostname
      ? `<div class="status-card"><div class="k">${esc(name)} · sistema</div><div class="v">${esc(s.hostname)}</div></div>`
      : '';
    html += bat + loc + net + mem + host;
  }
  wrap.innerHTML = html || '<div class="muted">Nenhum status ainda. Os dispositivos enviam status automaticamente.</div>';
}

function renderTargets() {
  const sel = $('#remote-target');
  const prev = sel.value;
  sel.innerHTML =
    '<option value="">— selecione um dispositivo —</option>' +
    state.devices
      .map((d) => `<option value="${esc(d.id)}" ${!d.online ? 'disabled' : ''}>${esc(d.name)} (${d.type})${d.online ? ' · online' : ' · offline'}</option>`)
      .join('');
  if (prev && state.devices.some((d) => d.id === prev)) sel.value = prev;
  selectTarget();
}

function renderCamSource() {
  const sel = $('#cam-source');
  const prev = sel.value;
  sel.innerHTML =
    '<option value="">— selecione —</option>' +
    state.devices
      .map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${d.type})</option>`)
      .join('');
  if (prev) sel.value = prev;
}

function renderFiles() {
  const wrap = $('#file-list');
  if (!state.files.length) {
    wrap.innerHTML = '<div class="muted">Nenhum arquivo ainda.</div>';
    return;
  }
  wrap.innerHTML = state.files
    .map((f) => `
      <div class="file-item">
        <div>
          <div class="f-name">${esc(f.name)}</div>
          <div class="f-meta">${fmtSize(f.size)} · ${new Date(f.createdAt).toLocaleString('pt-BR')}</div>
        </div>
        <div class="f-actions">
          <button data-fid="${esc(f.id)}" data-fname="${esc(f.name)}" data-act="dl">⬇️</button>
          <button data-fid="${esc(f.id)}" data-fname="${esc(f.name)}" data-act="push">📤 Enviar p/ notebook</button>
          <button data-fid="${esc(f.id)}" data-act="del">🗑️</button>
        </div>
      </div>`)
    .join('');

  $$('#file-list .f-actions button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.dataset.fid;
      if (btn.dataset.act === 'dl') downloadFile(fid);
      if (btn.dataset.act === 'del') deleteFile(fid);
      if (btn.dataset.act === 'push') pushFileToAgent(fid, btn.dataset.fname);
    });
  });
}

/* ---------------- tabs ---------------- */

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
}

/* ---------------- target selection ---------------- */

function selectTarget() {
  const id = $('#remote-target').value;
  state.selectedTarget = id;
  const d = state.devices.find((x) => x.id === id);
  const hint = $('#remote-target-hint');
  $('#remote-phone').classList.add('hidden');
  $('#remote-agent').classList.add('hidden');
  $('#remote-none').classList.remove('hidden');
  if (!d) {
    hint.textContent = '';
    return;
  }
  $('#remote-none').classList.add('hidden');
  if (d.type === 'agent') {
    $('#remote-agent').classList.remove('hidden');
    hint.textContent = 'Controlando o agente no notebook: comandos, tela, mouse e teclado.';
  } else {
    $('#remote-phone').classList.remove('hidden');
    hint.textContent = d.name + ' é um navegador. Você pode abrir links, vibrar, acender a lanterna, pedir status e transmitir câmera.';
  }
}

/* ---------------- comando de celular ---------------- */

function target() {
  return $('#remote-target').value;
}

async function runPhoneCmd() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const url = $('#rc-phone-url').value.trim();
  try {
    await ctrl(id, 'phone:open', { url: url || 'https://google.com' });
    setMsg('#rc-status', '✅ Link enviado.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function runPhoneVibrate() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  try {
    await ctrl(id, 'phone:vibrate', { ms: 500 });
    setMsg('#rc-status', '✅ Vibração enviada.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function runPhoneFlash() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  try {
    const r = await ctrl(id, 'phone:flash', {});
    setMsg('#rc-status', r.torch ? '🔦 Lanterna ligada.' : '🔦 Lanterna desligada.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function runPhoneCam(on) {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  try {
    await ctrl(id, on ? 'cam:start' : 'cam:stop', {});
    setMsg('#rc-status', on ? '📡 Câmera ligada no aparelho.' : 'Câmera parada.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function runPhoneStatus() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  try {
    const st = await ctrl(id, 'phone:status', {});
    state.statuses[id] = { ...state.statuses[id], ...st };
    renderStatusCards();
    showTab('devices');
    toast('Status atualizado!');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

/* ---------------- comando no agente ---------------- */

async function runExec(appMode) {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const cmd = $('#rc-exec').value.trim();
  if (!cmd) return toast('Digite um comando.');
  setMsg('#rc-status', 'Executando…');
  try {
    const type = appMode ? 'open:app' : 'exec';
    const r = await ctrl(id, type, { command: cmd });
    const out = r.stdout + (r.stderr ? '\n[erro] ' + r.stderr : '');
    $('#rc-output').textContent = out || '(sem saída)';
    setMsg('#rc-status', r.code === 0 ? '✅ Concluído.' : '⚠️ Terminou com código ' + r.code, r.code === 0 ? 'ok' : 'err');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function runOpenUrl() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const url = $('#rc-url').value.trim();
  if (!url) return toast('Digite a URL.');
  try {
    await ctrl(id, 'open:url', { url });
    setMsg('#rc-status', '✅ Link aberto no notebook.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

async function listDir() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const dir = $('#rc-dir').value.trim() || '~';
  try {
    const r = await ctrl(id, 'files:list', { dir });
    if (r.error) return setMsg('#rc-status', '❌ ' + r.error, 'err');
    const lines = (r.entries || []).map((e) => `${e.type === 'dir' ? '[D]' : '[F]'}  ${e.name}  ${fmtSize(e.size)}`).join('\n');
    $('#rc-output').textContent = '📁 ' + r.dir + '\n' + lines;
    setMsg('#rc-status', '✅ ' + r.entries.length + ' itens.', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  }
}

let shotBusy = false;
async function takeScreenshot() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  if (shotBusy) return;
  shotBusy = true;
  try {
    const r = await ctrl(id, 'screen:shot', {}, 30000);
    if (r.error) return setMsg('#rc-status', '❌ ' + r.error, 'err');
    $('#screen-img').src = 'data:image/png;base64,' + r.image;
    setMsg('#rc-status', '✅ Tela atualizada (' + Math.round(r.size / 1024) + ' KB).', 'ok');
  } catch (e) {
    setMsg('#rc-status', '❌ ' + e.message, 'err');
  } finally {
    shotBusy = false;
  }
}

async function toggleLiveShot() {
  const btn = $('#btn-live');
  if (state.liveShot) {
    clearInterval(state.liveShot);
    state.liveShot = null;
    btn.textContent = '⏱️ Ao vivo';
  } else {
    state.liveShot = setInterval(takeScreenshot, 2500);
    btn.textContent = '⏸️ Parar ao vivo';
    takeScreenshot();
  }
}

function sendKey() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const keys = $('#rc-key').value.trim();
  if (!keys) return toast('Digite as teclas.');
  ctrl(id, 'input:key', { keys })
    .then(() => setMsg('#rc-status', '✅ Teclas enviadas.', 'ok'))
    .catch((e) => setMsg('#rc-status', '❌ ' + e.message, 'err'));
}

function sendType() {
  const id = target();
  if (!id) return toast('Selecione um dispositivo primeiro.');
  const text = $('#rc-type').value;
  if (!text) return toast('Digite o texto.');
  ctrl(id, 'input:type', { text })
    .then(() => { $('#rc-type').value = ''; setMsg('#rc-status', '✅ Texto digitado.', 'ok'); })
    .catch((e) => setMsg('#rc-status', '❌ ' + e.message, 'err'));
}

/* ---------------- touchpad + mouse ---------------- */

function setupTouchpad() {
  const pad = $('#touchpad');
  let last = null;
  let moved = false;
  let downAt = 0;
  let longTimer = null;

  const send = (dx, dy, click, button) => {
    const id = target();
    if (!id || state.devices.find((d) => d.id === id)?.type !== 'agent') return;
    if (dx || dy) ctrl(id, 'input:mouse', { dx, dy });
    if (click) ctrl(id, 'input:mouse', { button, click: true });
  };

  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
    moved = false;
    downAt = Date.now();
    clearTimeout(longTimer);
    longTimer = setTimeout(() => {
      if (!moved) {
        send(0, 0, true, 'right');
        navigator.vibrate && navigator.vibrate(30);
      }
    }, 600);
  });

  pad.addEventListener('pointermove', (e) => {
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      moved = true;
      send(dx * 2, dy * 2, false);
    }
  });

  pad.addEventListener('pointerup', (e) => {
    clearTimeout(longTimer);
    if (!moved && Date.now() - downAt < 400) send(0, 0, true, 'left');
    last = null;
  });
}

function setupScreenClick() {
  $('#screen-img').addEventListener('click', (e) => {
    const id = target();
    if (!id) return;
    const img = e.target;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    ctrl(id, 'input:mouseabs', { x, y });
    ctrl(id, 'input:mouse', { button: 'left', click: true });
    setMsg('#rc-status', '🖱️ Clique enviado (' + Math.round(x) + ',' + Math.round(y) + ').', 'ok');
  });
}

/* ---------------- câmera ---------------- */

async function startLocalCamera() {
  if (state.cameraStreaming) return;
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  const constraints = {
    audio: false,
    video: { facingMode: state.streamFacing, width: { ideal: 640 }, height: { ideal: 480 } },
  };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    throw new Error('Sem acesso à câmera: ' + e.message);
  }
  video.srcObject = state.stream;
  await video.play();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  state.cameraStreaming = true;
  $('#btn-cam-start').textContent = '⏹️ Parar transmissão';

  state.camTimer = setInterval(() => {
    if (!state.cameraStreaming) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob || !state.cameraStreaming) return;
        blob.arrayBuffer().then((buf) => {
          state.socket.emit('cam:frame', {
            data: buf,
            meta: { w: canvas.width, h: canvas.height, ts: Date.now() },
          });
        });
      }, 'image/jpeg', 0.6);
    } catch {}
  }, 180);
}

function stopLocalCamera() {
  state.cameraStreaming = false;
  clearInterval(state.camTimer);
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  state.torchOn = false;
  $('#btn-cam-start').textContent = '📡 Transmitir minha câmera';
}

async function flipCamera() {
  state.streamFacing = state.streamFacing === 'user' ? 'environment' : 'user';
  if (state.cameraStreaming) {
    stopLocalCamera();
    await startLocalCamera();
  }
}

async function toggleTorch() {
  if (!state.stream) await startLocalCamera();
  if (!state.stream) return;
  const track = state.stream.getVideoTracks()[0];
  if (!track) return;
  const capable = track.getCapabilities && track.getCapabilities().torch;
  if (!capable) throw new Error('Lanterna não suportada neste dispositivo/câmera.');
  state.torchOn = !state.torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
  } catch (e) {
    state.torchOn = !state.torchOn;
    throw e;
  }
  return state.torchOn;
}

function watchCamera() {
  const id = $('#cam-source').value;
  if (!id) return toast('Selecione um dispositivo.');
  if (id === state.deviceId) {
    startLocalCamera().catch((e) => toast(e.message));
    return;
  }
  state.socket.emit('cam:watch', { deviceId: id });
  state.cameraWatching = true;
  $('#cam-viewer').classList.remove('hidden');
  toast('Assistindo câmera de ' + id + '.');
}

function stopWatching() {
  state.socket.emit('cam:unwatch');
  state.cameraWatching = false;
  $('#cam-viewer').classList.add('hidden');
}

/* ---------------- arquivos ---------------- */

async function uploadFiles() {
  const input = $('#file-input');
  const files = input.files;
  if (!files.length) return toast('Escolha um arquivo.');
  const prog = $('#upload-progress');
  for (const file of files) {
    prog.textContent = 'Enviando ' + file.name + '…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/files', { method: 'POST', body: fd });
      toast('✅ ' + file.name + ' enviado.');
    } catch (e) {
      toast('❌ ' + file.name + ': ' + e.message);
    }
  }
  prog.textContent = '';
  input.value = '';
  refreshFiles();
}

async function refreshFiles() {
  try {
    const data = await api('/api/files');
    state.files = data.files;
    renderFiles();
  } catch {}
}

async function downloadFile(id) {
  const f = state.files.find((x) => x.id === id);
  try {
    const res = await fetch('/api/files/' + id, {
      headers: { Authorization: 'Bearer ' + state.token },
    });
    if (!res.ok) throw new Error('Não foi possível baixar.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (f && f.name) || 'arquivo';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    toast('❌ ' + e.message);
  }
}

async function deleteFile(id) {
  if (!confirm('Apagar este arquivo?')) return;
  try {
    await api('/api/files/' + id, { method: 'DELETE' });
    refreshFiles();
  } catch (e) {
    toast(e.message);
  }
}

async function pushFileToAgent(id, name) {
  const agent = state.devices.find((d) => d.type === 'agent' && d.online);
  if (!agent) return toast('Nenhum agente do notebook está online.');
  try {
    await ctrl(agent.id, 'files:download', {
      url: '/api/files/' + id,
      token: state.token,
      path: '~/Downloads/Nexus/' + name,
    });
    toast('📤 Enviado para o notebook (' + agent.name + ').');
  } catch (e) {
    toast('❌ ' + e.message);
  }
}

/* ---------------- Jarvis ---------------- */

const jarvis = {
  recognition: null,
  speaking: false,
  speechSupported: !!(window.SpeechSynthesis && window.speechSynthesis),
};

function ptBrVoice() {
  if (!jarvis.speechSupported) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'pt-BR') || voices.find((v) => v.lang && v.lang.startsWith('pt')) || null;
}

function jarvisSay(text) {
  if (!$('#jarvis-tts').checked || !jarvis.speechSupported) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = ptBrVoice();
    if (voice) u.voice = voice;
    u.lang = 'pt-BR';
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch {}
}

function jarvisAddBubble(who, text, opts = {}) {
  const chat = $('#jarvis-chat');
  const div = document.createElement('div');
  div.className = 'bubble ' + who;
  if (opts.image) {
    const img = document.createElement('img');
    img.src = opts.image;
    div.appendChild(img);
    if (text) div.appendChild(document.createElement('br'));
  }
  if (text) div.appendChild(document.createTextNode(text));
  const ts = document.createElement('div');
  ts.className = 'b-ts';
  ts.textContent = new Date().toLocaleTimeString('pt-BR');
  div.appendChild(ts);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

async function jarvisSend() {
  const input = $('#jarvis-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  jarvisAddBubble('user', text);
  const typing = jarvisAddBubble('jarvis', '…');

  try {
    const r = await fetch('/api/jarvis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + state.token,
      },
      body: JSON.stringify({ message: text, deviceId: state.deviceId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
    typing.remove();
    jarvisAddBubble('jarvis', data.reply || '', { image: data.image || null });
    jarvisSay(data.reply || 'Pronto.');
  } catch (e) {
    typing.remove();
    jarvisAddBubble('err', '⚠️ ' + e.message);
  }
}

function jarvisMic() {
  if (jarvis.recognition) {
    jarvis.recognition.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    jarvisAddBubble('err', 'Seu navegador não suporta reconhecimento de voz (use Chrome/Edge no celular ou notebook).');
    return;
  }
  const rec = new SR();
  rec.lang = 'pt-BR';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  jarvis.recognition = rec;
  const btn = $('#btn-jarvis-mic');
  const st = $('#jarvis-mic-state');

  rec.onstart = () => {
    btn.classList.add('listening');
    st.textContent = 'ouvindo…';
  };
  rec.onend = () => {
    btn.classList.remove('listening');
    st.textContent = '';
    jarvis.recognition = null;
  };
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $('#jarvis-input').value = t;
    jarvisSend();
  };
  rec.onerror = (e) => {
    btn.classList.remove('listening');
    st.textContent = e.error === 'not-allowed' ? 'mic bloqueado' : '';
    jarvis.recognition = null;
  };
  rec.start();
}

function setupJarvis() {
  if (jarvis.speechSupported) window.speechSynthesis.getVoices();
  $('#btn-jarvis-send').addEventListener('click', jarvisSend);
  $('#jarvis-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') jarvisSend();
  });
  $('#btn-jarvis-mic').addEventListener('click', jarvisMic);
  jarvisAddBubble(
    'jarvis',
    'Olá! Eu sou o Jarvis. Diga ou digite um comando, por exemplo "como está o notebook" ou "ver a tela do notebook". Digite "ajuda" para ver tudo que posso fazer.'
  );
}

/* ---------------- entrar no app ---------------- */

function enterApp() {
  $('#view-login').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  $('#me-email').textContent = state.email;
  $('#agent-token').value = state.token;
  $('#agent-token').addEventListener('click', () => $('#agent-token').select());
  connectSocket();
  refreshFiles();
  setupJarvis();
  setInterval(refreshFiles, 15000);
}

/* ---------------- eventos da UI ---------------- */

function bindEvents() {
  $('#btn-request').addEventListener('click', requestCode);
  $('#btn-verify').addEventListener('click', verifyCode);
  $('#btn-resend').addEventListener('click', requestCode);
  $('#btn-logout').addEventListener('click', logout);

  $('#login-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    if (e.target.value.length === 6) verifyCode();
  });
  $('#login-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') requestCode();
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  $('#remote-target').addEventListener('change', selectTarget);

  $('#btn-phone-open').addEventListener('click', runPhoneCmd);
  $('#btn-phone-vibrate').addEventListener('click', runPhoneVibrate);
  $('#btn-phone-flash').addEventListener('click', runPhoneFlash);
  $('#btn-phone-status').addEventListener('click', runPhoneStatus);
  $('#btn-phone-cam').addEventListener('click', () => runPhoneCam(true));
  $('#btn-phone-camstop').addEventListener('click', () => runPhoneCam(false));

  $('#btn-exec').addEventListener('click', () => runExec(false));
  $('#btn-open-app').addEventListener('click', () => runExec(true));
  $('#btn-open-url').addEventListener('click', runOpenUrl);
  $('#btn-list-dir').addEventListener('click', listDir);

  $('#btn-shot').addEventListener('click', takeScreenshot);
  $('#btn-live').addEventListener('click', toggleLiveShot);
  $('#btn-right').addEventListener('click', () => {
    const id = target();
    if (id) ctrl(id, 'input:mouse', { button: 'right', click: true });
  });
  $('#btn-scroll-up').addEventListener('click', () => {
    const id = target();
    if (id) ctrl(id, 'input:scroll', { amount: 1 });
  });
  $('#btn-scroll-down').addEventListener('click', () => {
    const id = target();
    if (id) ctrl(id, 'input:scroll', { amount: -1 });
  });
  $('#btn-key').addEventListener('click', sendKey);
  $('#btn-type').addEventListener('click', sendType);

  $('#btn-cam-watch').addEventListener('click', watchCamera);
  $('#btn-cam-stop').addEventListener('click', stopWatching);
  $('#btn-cam-start').addEventListener('click', () => {
    if (state.cameraStreaming) stopLocalCamera();
    else startLocalCamera().catch((e) => toast(e.message));
  });
  $('#btn-cam-flip').addEventListener('click', flipCamera);
  $('#btn-cam-torch').addEventListener('click', () =>
    toggleTorch().then((on) => toast(on ? '🔦 Lanterna ligada' : '🔦 Lanterna desligada')).catch((e) => toast(e.message))
  );

  $('#btn-upload').addEventListener('click', uploadFiles);
  $('#btn-copy-token').addEventListener('click', () => {
    navigator.clipboard.writeText(state.token);
    toast('Token copiado!');
  });

  setupTouchpad();
  setupScreenClick();

  // status periódico deste navegador
  setInterval(async () => {
    if (!state.socket || !state.socket.connected) return;
    try {
      state.socket.emit('status:report', await collectBrowserStatus());
    } catch {}
  }, 8000);
}

/* ---------------- boot ---------------- */

bindEvents();

if (state.token) {
  fetch('/api/me', {
    headers: { Authorization: 'Bearer ' + state.token },
  })
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then(() => enterApp())
    .catch(() => {
      state.token = '';
      localStorage.removeItem('nexus.token');
    });
}