const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');

function run(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: opts.timeout || 15000, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function readBattery() {
  try {
    for (const name of fs.readdirSync('/sys/class/power_supply')) {
      try {
        const type = fs.readFileSync(`/sys/class/power_supply/${name}/type`, 'utf8').trim();
        if (type === 'Battery') {
          const capacity = Number(fs.readFileSync(`/sys/class/power_supply/${name}/capacity`, 'utf8'));
          let status = 'unknown';
          try {
            status = fs.readFileSync(`/sys/class/power_supply/${name}/status`, 'utf8').trim();
          } catch {}
          return { level: capacity, status, present: true };
        }
      } catch {}
    }
  } catch {}
  return null;
}

function readMem() {
  const total = os.totalmem();
  const free = os.freemem();
  return { total, free, used: total - free, percent: Math.round(((total - free) / total) * 100) };
}

function ipAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'unknown';
}

async function getStatus() {
  const uptime = os.uptime();
  const load = os.loadavg();
  const stat = await run('cat /proc/loadavg');
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime,
    load: load.map((l) => Number(l.toFixed(2))),
    cpuCount: os.cpus().length,
    mem: readMem(),
    battery: readBattery(),
    ip: ipAddress(),
    cpus: stat.stdout.trim(),
    disk: await readDisk(),
    time: Date.now(),
  };
}

async function readDisk() {
  const out = await run("df -P / | tail -1");
  const parts = out.stdout.trim().split(/\s+/);
  if (parts.length >= 5) {
    return { total: Number(parts[1]) * 1024, used: Number(parts[2]) * 1024, available: Number(parts[3]) * 1024, mount: parts[5] };
  }
  return null;
}

async function openUrl(url) {
  return run(`xdg-open "${String(url).replace(/"/g, '\\"')}" >/dev/null 2>&1 &`);
}

async function openApp(command) {
  return run(`nohup ${command} >/dev/null 2>&1 &`);
}

async function execCommand(command) {
  const res = await run(command, { timeout: 30000 });
  return res;
}

async function screenshot() {
  const id = Date.now();
  const tmp = `/tmp/nexus-shot-${id}.png`;
  const tools = [
    `scrot "${tmp}"`,
    `import -window root "${tmp}"`,
    `gnome-screenshot -f "${tmp}"`,
  ];
  for (const tool of tools) {
    const res = await run(tool);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      const b64 = fs.readFileSync(tmp).toString('base64');
      try { fs.unlinkSync(tmp); } catch {}
      return { image: b64, size: b64.length };
    }
  }
  // fallback: xwd (captura X11) + conversão via netpbm (xwdtopnm + pnmtopng)
  const xwd = `/tmp/nexus-shot-${id}.xwd`;
  const res = await run(`xwd -root -silent -out "${xwd}"`);
  if (res.code === 0 && fs.existsSync(xwd) && fs.statSync(xwd).size > 0) {
    const conv = await run(`xwdtopnm "${xwd}" 2>/dev/null | pnmtopng > "${tmp}"`);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      const b64 = fs.readFileSync(tmp).toString('base64');
      try { fs.unlinkSync(tmp); } catch {}
      try { fs.unlinkSync(xwd); } catch {}
      return { image: b64, size: b64.length };
    }
    try { fs.unlinkSync(xwd); } catch {}
  }
  return { error: 'Nenhuma ferramenta de screenshot encontrada. Instale: sudo apt install scrot' };
}

function parseLs(listing) {
  return listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) return { raw: line };
      const type = m[1][0] === 'd' ? 'dir' : m[1][0] === 'l' ? 'link' : 'file';
      return { type, size: Number(m[2]), date: m[3], name: m[4] };
    });
}

async function listDir(dir) {
  const safe = String(dir || '.').replace(/["`$\\]/g, '\\$&');
  const res = await run(`ls -la --time-style=+%Y-%m-%d ${safe}`);
  if (res.code !== 0) return { error: res.stderr.trim() || 'Erro ao listar diretório' };
  const lines = parseLs(res.stdout);
  return { dir: String(dir || '.'), entries: lines.slice(1) };
}

async function readFileBase64(p) {
  try {
    const p2 = String(p);
    const stat = fs.statSync(p2);
    if (stat.size > 200 * 1024 * 1024) return { error: 'Arquivo muito grande para envio direto (>200MB). Use o hub de arquivos.' };
    return { data: fs.readFileSync(p2).toString('base64'), name: require('path').basename(p2), size: stat.size };
  } catch (e) {
    return { error: String(e.message) };
  }
}

async function writeFileBase64(p, data) {
  try {
    const buf = Buffer.from(String(data || ''), 'base64');
    const target = String(p);
    require('fs').mkdirSync(require('path').dirname(target), { recursive: true });
    require('fs').writeFileSync(target, buf);
    return { ok: true, size: buf.length };
  } catch (e) {
    return { error: String(e.message) };
  }
}

async function mouse(dx, dy, button, click) {
  const parts = [];
  if (dx) parts.push(`mousemove_relative ${Math.round(dx)} ${Math.round(dy)}`);
  if (click) {
    const btn = button === 'right' ? 3 : button === 'middle' ? 2 : 1;
    parts.push(`click ${btn}`);
  }
  if (!parts.length) return { ok: true };
  return run(`xdotool ${parts.join(' ')}`);
}

async function mouseMoveAbs(x, y) {
  return run(`xdotool mousemove ${Math.round(x)} ${Math.round(y)}`);
}

async function scroll(amount) {
  return run(`xdotool click ${amount > 0 ? 4 : 5}`);
}

async function key(keys) {
  const safe = String(keys || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .join(' ');
  if (!safe) return { ok: true };
  return run(`xdotool key ${safe}`);
}

async function typeText(text) {
  const escaped = String(text).replace(/[\\"$`]/g, '\\$&');
  return run(`xdotool type --delay 30 "${escaped}"`);
}

module.exports = {
  getStatus,
  openUrl,
  openApp,
  execCommand,
  screenshot,
  listDir,
  readFileBase64,
  writeFileBase64,
  mouse,
  mouseMoveAbs,
  scroll,
  key,
  typeText,
};