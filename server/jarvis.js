// =========================================================
// Jarvis — assistente que controla os dispositivos
// Modo 1 (sem API key): reconhece comandos em português
// Modo 2 (com OPENAI_API_KEY): conversa real com funções
// =========================================================
const socketCtl = require('./socket');

const HAS_LLM = !!process.env.OPENAI_API_KEY;
const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/* ---------- normalização de texto ---------- */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.:/@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTarget(email, types) {
  const devices = socketCtl.getOnlineDevices(email);
  const picks = devices.filter((d) => types.includes(d.type) && d.online);
  return picks[0] || null;
}

function findPhone(email, excludeId) {
  const devices = socketCtl.getOnlineDevices(email);
  const phones = devices.filter((d) => d.type === 'browser' && d.online);
  return phones.find((d) => d.id !== excludeId) || phones[0] || null;
}

const APP_MAP = {
  firefox: 'firefox',
  chrome: 'google-chrome',
  brave: 'brave',
  code: 'code',
  vscode: 'code',
  visual: 'code',
  editor: 'code',
  terminal: 'x-terminal-emulator',
  console: 'x-terminal-emulator',
  arquivos: 'nautilus',
  pasta: 'nautilus',
  calculadora: 'gnome-calculator',
  calc: 'gnome-calculator',
  musicas: 'rhythmbox',
  musica: 'rhythmbox',
  player: 'vlc',
  vlc: 'vlc',
  notas: 'gnome-text-editor',
  text: 'gnome-text-editor',
};

const SITE_MAP = {
  youtube: 'https://youtube.com',
  whatsaap: 'https://web.whatsapp.com',
  whatsapp: 'https://web.whatsapp.com',
  zap: 'https://web.whatsapp.com',
  instagram: 'https://instagram.com',
  gmail: 'https://mail.google.com',
  email: 'https://mail.google.com',
  spotify: 'https://open.spotify.com',
  facebook: 'https://facebook.com',
  x: 'https://x.com',
  twitter: 'https://x.com',
  netflix: 'https://netflix.com',
  'youtube music': 'https://music.youtube.com',
};

/* ---------- detecção de intenção (modo sem LLM) ---------- */

function detectIntent(norm) {
  const has = (re) => re.test(norm);
  const pick = (re) => (norm.match(re) || [])[0] || '';

  if (has(/^(oi|ola|salve|eai|hey|bom dia|boa tarde|boa noite|e a[ií])\b/))
    return { intent: 'greeting' };
  if (has(/quem e (voce|você)|o que (voce|você) (faz|e|é)|como funciona|o que voce pode/))
    return { intent: 'whoami' };
  if (has(/ajuda|help|comandos|o que (voce|você) sabe/))
    return { intent: 'help' };

  if (has(/bateria|nivel da bateria|carga do (celular|aparelho)/))
    return { intent: 'battery' };
  if (has(/localizaca|localização|onde (esta|está|tá) o|posicao|posição|gps|meu celular esta/))
    return { intent: 'location' };
  if (has(/status|como (esta|está)|como vao|como vão|tudo bem|tudo certo|situaca|o que esta acontecendo|tudo tranquilo/))
    return { intent: 'status' };

  if (has(/(tirar|tira|ver|mostra|mostrar|capturar|capture|pantalla).*(tela|print|screenshot|imagem|screen)|tela do notebook|print da tela|veja a tela/))
    return { intent: 'screenshot' };

  if (has(/lanterna|flash|acende|apaga a luz|torch/))
    return { intent: 'flash' };
  if (has(/vibrar|vibra|vibracao/))
    return { intent: 'vibrate' };
  if (has(/\b(liga|ligar|ativar|ativa)\b.*\b(camera|câmera)\b|ligar camera|camera on|camera liga/))
    return { intent: 'cameraOn' };
  if (has(/\b(desliga|desligar|parar|para|fechar|encerra)\b.*\b(camera|câmera)\b|camera off|camera desliga/))
    return { intent: 'cameraOff' };

  if (has(/listar.*(arquivo|pasta|diretorio|diretorio)|o que tem (na|em).*(pasta|diretorio)/))
    return { intent: 'listDir' };

  if (has(/executar (o |um )?comando|execute (o |um )?comando|rode (o |um )?comando|roda (o |um )?comando|comando\s*[:=]/))
    return { intent: 'exec' };

  if (has(/^(abre|abrir|execute|executar|roda|rode)\b.*(site|link|url|pagina|página|pagina web)/) ||
      has(/(site|link|url)\b.*(abre|abrir|executa|executar)/))
    return { intent: 'openUrlFromPhrase' };
  if (has(/^abre\s+[a-z0-9]+\.[a-z]{2,}/) || has(/abrir (o )?site\s+/))
    return { intent: 'openUrl' };

  if (has(/^(abre|abrir|execute|executar|roda|rode).*(app|aplicativo|programa)/) ||
      has(/aplicativo|app do/))
    return { intent: 'openApp' };
  if (has(/^(abre|abrir|abra|execute|executar|roda|rode)\s+(\S+)/))
    return { intent: 'openApp' };

  return null;
}

function extractUrl(norm) {
  const m = norm.match(/(?:https?:\/\/|www\.)?([a-z0-9-]+(\.[a-z]{2,})+)(\/[^\s]*)?/);
  if (m) return (m[0].startsWith('http') ? m[0] : 'https://' + m[0]);
  return null;
}

/* ---------- execução de intenção ---------- */

const HELP_TEXT =
  'Posso fazer muita coisa: "qual a bateria do celular", "onde está o celular", ' +
  '"como está o notebook" (status), "ver a tela do notebook" (print), ' +
  '"abrir youtube", "abrir o site twitter.com", "abrir o aplicativo vscode", ' +
  '"executar o comando ls -la", "lanterna", "vibrar o celular", ' +
  '"ligar a câmera", "desligar a câmera" e "listar a pasta ~".';

async function executeIntent(email, deviceId, intent, params = {}) {
  const agent = findTarget(email, ['agent']);
  const phone = findPhone(email, deviceId);
  const failAgent = () => ({
    reply:
      'O agente do notebook não está online. Rode "npm run agent" no notebook (com o token da aba Agente no site) para eu poder controlá-lo.',
  });
  const failPhone = () => ({
    reply:
      'Nenhum navegador (celular ou notebook) está online com este site aberto. Abra o site no outro aparelho para eu controlá-lo.',
  });

  switch (intent) {
    case 'greeting':
      return {
        reply: 'Olá! Eu sou o seu Jarvis. Estou aqui para ajudar a controlar seus dispositivos. O que deseja fazer?',
      };
    case 'whoami':
      return {
        reply:
          'Sou o Jarvis, um assistente que conecta seus dispositivos. Consigo ver status, bateria e localização, ver a tela do notebook, abrir sites e aplicativos, controlar o mouse e o teclado, mexer na câmera e na lanterna do celular, além de centralizar arquivos. Diga "ajuda" para ver exemplos.',
      };
    case 'help':
      return { reply: HELP_TEXT };

    case 'battery': {
      const target = phone || agent;
      if (!target) return failPhone();
      try {
        if (target.type === 'agent') {
          const st = await socketCtl.sendCommand(email, target.id, 'status:get', {});
          const b = st.battery;
          return {
            reply: b && b.present
              ? `A bateria do notebook está em ${b.level}% (${(b.status || '').toLowerCase()}).`
              : 'O notebook não parece ter bateria (é um desktop ou o sistema não informa).',
          };
        }
        const st = await socketCtl.sendCommand(email, target.id, 'phone:status', {});
        return {
          reply: st.battery
            ? `A bateria do ${target.name} está em ${st.battery.level}%${st.battery.charging ? ', carregando.' : '.'}`
            : 'Não consegui ler a bateria deste aparelho.',
        };
      } catch (e) {
        return { reply: 'Não consegui ler a bateria: ' + e.message };
      }
    }

    case 'location': {
      if (!phone) return failPhone();
      try {
        const st = await socketCtl.sendCommand(email, phone.id, 'phone:status', {});
        if (!st.location)
          return {
            reply:
              'Não consegui a localização do celular. Pode ser necessário autorizar o acesso à localização no site (permite localizar quando o site está aberto) e o site precisa estar em HTTPS.',
          };
        return {
          reply: `O ${phone.name} está em latitude ${st.location.lat}, longitude ${st.location.lon}, com precisão de ±${st.location.acc} metros.`,
        };
      } catch (e) {
        return { reply: 'Não consegui a localização: ' + e.message };
      }
    }

    case 'status': {
      const targets = [
        agent ? { name: agent.name, type: 'agent', id: agent.id } : null,
        phone ? { name: phone.name, type: 'browser', id: phone.id } : null,
      ].filter(Boolean);
      if (!targets.length) return failAgent();
      const lines = [];
      for (const t of targets) {
        try {
          if (t.type === 'agent') {
            const st = await socketCtl.sendCommand(email, t.id, 'status:get', {});
            const memPct = st.mem ? st.mem.percent : '?';
            const upMin = Math.round((st.uptime || 0) / 60);
            const bat = st.battery && st.battery.present ? `, bateria ${st.battery.level}%` : '';
            lines.push(
              `${t.name}: processador com carga ${st.cpus || '?'}, memória ${memPct}% usada, no ar há ${upMin} min${bat}.`
            );
          } else {
            const st = await socketCtl.sendCommand(email, t.id, 'phone:status', {});
            const bat = st.battery ? `, bateria ${st.battery.level}%` : '';
            const net = st.network ? `, rede ${st.network}` : '';
            lines.push(`${t.name}: online${bat}${net}.`);
          }
        } catch {}
      }
      return lines.length
        ? { reply: 'Aqui está o resumo:\n• ' + lines.join('\n• ') }
        : { reply: 'Não consegui coletar o status agora.' };
    }

    case 'screenshot': {
      if (!agent) return failAgent();
      try {
        const r = await socketCtl.sendCommand(email, agent.id, 'screen:shot', {}, 30000);
        if (r.error)
          return {
            reply:
              r.error +
              ' (para ver a tela, instale no notebook: sudo apt install scrot, e rode o agente em uma sessão gráfica)',
          };
        return {
          reply: 'Pronto! Capturei a tela do notebook.',
          image: 'data:image/png;base64,' + r.image,
        };
      } catch (e) {
        return { reply: 'Falha ao capturar a tela: ' + e.message };
      }
    }

    case 'flash': {
      if (!phone) return failPhone();
      try {
        const r = await socketCtl.sendCommand(email, phone.id, 'phone:flash', {});
        return { reply: r.torch ? 'Lanterna acesa! 🔦' : 'Lanterna apagada.' };
      } catch (e) {
        return {
          reply:
            'Não consegui a lanterna: ' + e.message + ' (a lanterna precisa do site aberto em HTTPS no celular)',
        };
      }
    }

    case 'vibrate': {
      if (!phone) return failPhone();
      try {
        await socketCtl.sendCommand(email, phone.id, 'phone:vibrate', { ms: 500 });
        return { reply: 'Pronto, enviei uma vibração. 📳' };
      } catch (e) {
        return { reply: 'Não consegui vibrar: ' + e.message };
      }
    }

    case 'cameraOn':
    case 'cameraOff': {
      if (!phone) return failPhone();
      try {
        await socketCtl.sendCommand(email, phone.id, phone.type === 'agent' ? '' : (intent === 'cameraOn' ? 'cam:start' : 'cam:stop'), {});
        return {
          reply:
            intent === 'cameraOn'
              ? `A câmera do ${phone.name} está ligada. Abra a aba Câmera em outro dispositivo para assistir.`
              : `Câmera do ${phone.name} desligada.`,
        };
      } catch (e) {
        return {
          reply:
            'Não consegui: ' + e.message + ' (a câmera precisa do site aberto em HTTPS no aparelho)',
        };
      }
    }

    case 'listDir': {
      if (!agent) return failAgent();
      try {
        const dir = params.dir || '~';
        const r = await socketCtl.sendCommand(email, agent.id, 'files:list', { dir });
        if (r.error) return { reply: 'Erro ao listar: ' + r.error };
        const count = (r.entries || []).length;
        const names = (r.entries || [])
          .slice(0, 12)
          .map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`)
          .join(', ');
        return {
          reply: `A pasta ${r.dir} tem ${count} itens. Exemplos: ${names}. Peça "abrir aplicativo X" ou "executar comando Y" para continuar.`,
        };
      } catch (e) {
        return { reply: 'Não consegui listar: ' + e.message };
      }
    }

    case 'openUrl':
    case 'openUrlFromPhrase': {
      if (!agent) return failAgent();
      const url = extractUrl(normalize(intent === 'openUrlFromPhrase' ? params.text : params.text || ''));
      const target2 = url || params.url;
      if (!target2) return { reply: 'Não encontrei um site ou link no que você disse. Tente: "abrir o site youtube.com".' };
      try {
        await socketCtl.sendCommand(email, agent.id, 'open:url', { url: target2 });
        return { reply: `Abrindo ${target2} no notebook.` };
      } catch (e) {
        return { reply: 'Falha ao abrir: ' + e.message };
      }
    }

    case 'openApp': {
      if (!agent) return failAgent();
      const app = (params.app || params.command || '').trim();
      if (!app) return { reply: 'Qual aplicativo você quer abrir? Ex.: "abrir vscode".' };
      const command = APP_MAP[app] || app;
      const isSite = SITE_MAP[app] || extractUrl(app);
      try {
        if (isSite) {
          await socketCtl.sendCommand(email, agent.id, 'open:url', {
            url: typeof isSite === 'string' && isSite.startsWith('http') ? isSite : 'https://' + isSite,
          });
          return { reply: `Abrindo ${isSite} no notebook.` };
        }
        await socketCtl.sendCommand(email, agent.id, 'open:app', { command });
        return { reply: `Abrindo o aplicativo "${app}" no notebook.` };
      } catch (e) {
        return { reply: 'Falha ao abrir: ' + e.message };
      }
    }

    case 'exec': {
      if (!agent) return failAgent();
      const command = (params.command || '').trim();
      if (!command) return { reply: 'Qual comando devo executar? Ex.: "executar comando ls -la".' };
      try {
        const r = await socketCtl.sendCommand(email, agent.id, 'exec', { command });
        const out = (r.stdout || '').trim();
        const err = (r.stderr || '').trim();
        const short = (out || err || '(sem saída)').slice(0, 600);
        return {
          reply: `Comando "${command}" concluído (código ${r.code}). Saída:\n${short}`,
        };
      } catch (e) {
        return { reply: 'Falha ao executar: ' + e.message };
      }
    }

    default:
      return {
        reply:
          'Não entendi esse comando ainda. Eu sei fazer estas coisas: ' + HELP_TEXT,
      };
  }
}

/* ---------- modo LLM (Jarvis de verdade) ---------- */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Obtém o status do notebook (CPU, memória, bateria, disco) ou do celular/navegador.',
      parameters: { type: 'object', properties: { device: { type: 'string', enum: ['notebook', 'celular'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_battery',
      description: 'Mostra a bateria do notebook ou do celular.',
      parameters: { type: 'object', properties: { device: { type: 'string', enum: ['notebook', 'celular'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_location',
      description: 'Obtém a localização (GPS) do celular.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Captura a tela do notebook.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: 'Abre uma URL/site no navegador do notebook.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL completa, ex: https://youtube.com' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Abre um aplicativo no notebook (firefox, chrome, code, terminal, etc).',
      parameters: {
        type: 'object',
        properties: { app: { type: 'string', description: 'nome do aplicativo' } },
        required: ['app'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exec_command',
      description: 'Executa um comando no terminal do notebook.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Lista o conteúdo de uma pasta do notebook.',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', default: '~' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vibrate_phone',
      description: 'Faz o celular vibrar.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_flash',
      description: 'Liga ou desliga a lanterna do celular.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_camera',
      description: 'Liga a câmera do celular para transmissão.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_camera',
      description: 'Desliga a câmera do celular.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

async function executeTool(email, deviceId, name, args) {
  const agent = findTarget(email, ['agent']);
  const phone = findPhone(email, deviceId);
  const wantNotebook = /notebook|computador|pc|agente/i.test(JSON.stringify(args));
  const wantPhone = /celular|telefone|aparelho|gps|localizac/i.test(JSON.stringify(args));
  const t = wantPhone ? phone : wantNotebook ? agent : name === 'open_url' || name === 'open_app' || name === 'exec_command' || name === 'list_dir' || name === 'take_screenshot' ? agent : phone || agent;
  if (!t) return { error: 'Dispositivo alvo offline.' };

  switch (name) {
    case 'get_status':
      if (t.type === 'agent') return await socketCtl.sendCommand(email, t.id, 'status:get', {});
      return await socketCtl.sendCommand(email, t.id, 'phone:status', {});
    case 'get_battery':
      if (t.type === 'agent') {
        const st = await socketCtl.sendCommand(email, t.id, 'status:get', {});
        return st.battery && st.battery.present ? { level: st.battery.level, status: st.battery.status } : { error: 'sem bateria' };
      }
      return await socketCtl.sendCommand(email, t.id, 'phone:status', {});
    case 'get_location':
      return await socketCtl.sendCommand(email, t.id, 'phone:status', {});
    case 'take_screenshot':
      return await socketCtl.sendCommand(email, t.id, 'screen:shot', {}, 30000);
    case 'open_url':
      return await socketCtl.sendCommand(email, t.id, 'open:url', { url: args.url });
    case 'open_app':
      return await socketCtl.sendCommand(email, t.id, 'open:app', { command: APP_MAP[args.app] || args.app });
    case 'exec_command':
      return await socketCtl.sendCommand(email, t.id, 'exec', { command: args.command });
    case 'list_dir':
      return await socketCtl.sendCommand(email, t.id, 'files:list', { dir: args.dir || '~' });
    case 'vibrate_phone':
      return await socketCtl.sendCommand(email, t.id, 'phone:vibrate', { ms: 500 });
    case 'toggle_flash':
      return await socketCtl.sendCommand(email, t.id, 'phone:flash', {});
    case 'start_camera':
      return await socketCtl.sendCommand(email, t.id, 'cam:start', {});
    case 'stop_camera':
      return await socketCtl.sendCommand(email, t.id, 'cam:stop', {});
    default:
      return { error: 'Ferramenta desconhecida: ' + name };
  }
}

async function askLLM(email, message, deviceId) {
  const devices = socketCtl.getOnlineDevices(email);
  const context =
    'Dispositivos conectados na conta: ' +
    (devices.length
      ? devices.map((d) => `${d.name} (${d.type}, ${d.online ? 'online' : 'offline'})`).join(', ')
      : 'nenhum') +
    '. O "agente" é o notebook; "browser" são navegadores (celular/notebook com o site aberto).';

  const messages = [
    {
      role: 'system',
      content:
        'Você é o Jarvis, um assistente pessoal em português que controla os dispositivos do usuário. ' +
        'Seja conciso e amigável. Use as ferramentas para executar o que o usuário pedir. ' +
        'Se o usuário perguntar algo sem relação com os dispositivos, responda normalmente. ' +
        'Contexto: ' + context,
    },
    { role: 'user', content: message },
  ];

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('Erro do modelo de IA (' + res.status + '): ' + txt.slice(0, 200));
    }
    const data = await res.json();
    const msg = data.choices[0].message;
    if (msg.tool_calls && msg.tool_calls.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        let result;
        try {
          result = await executeTool(email, deviceId, tc.function.name, JSON.parse(tc.function.arguments || '{}'));
        } catch (e) {
          result = { error: e.message };
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }
    return { reply: msg.content || '…', image: null };
  }
  return { reply: 'Não consegui concluir a tarefa. Peça de outra forma.' };
}

/* ---------- ponto de entrada ---------- */

async function handle(email, message, deviceId) {
  const norm = normalize(message);
  if (!norm) return { reply: 'Diga o que precisa. Ex.: "qual a bateria do celular".' };

  if (HAS_LLM) {
    try {
      return await askLLM(email, message, deviceId);
    } catch (e) {
      // se a IA falhar, usa o modo regras
      const det = detectIntent(norm);
      if (det) {
        const params = parseParams(norm, det.intent);
        return await executeIntent(email, deviceId, det.intent, params);
      }
      return { reply: 'Me desculpe, tive um problema com o modelo de IA: ' + e.message };
    }
  }

  const det = detectIntent(norm);
  if (det) {
    const params = parseParams(norm, det.intent);
    return await executeIntent(email, deviceId, det.intent, params);
  }

  return {
    reply:
      'Ainda não aprendi esse comando. Eu sei fazer estas coisas: ' + HELP_TEXT +
      (process.env.OPENAI_API_KEY
        ? ''
        : '\n\n💡 Para me deixar mais inteligente (conversar livremente), configure OPENAI_API_KEY no arquivo .env e reinicie o servidor.'),
  };
}

function parseParams(norm, intent) {
  const p = {};
  if (intent === 'openApp') {
    let rest = norm
      .replace(/^(abre|abrir|abra|execute|executar|roda|rode)\s+/, '')
      .replace(/^(o |a |um |uma |app |aplicativo |programa )+/g, '')
      .trim();
    if (/app|aplicativo|programa/.test(norm)) {
      const m = norm.match(/(?:app|aplicativo|programa)\s+(o |a )?\s*([a-z0-9 ]+)$/);
      if (m) rest = m[2];
    }
    p.app = rest || null;
  }
  if (intent === 'openUrlFromPhrase') {
    p.text = norm;
  }
  if (intent === 'exec') {
    const m = norm.match(/comando\s*[:=]?\s*(.+)$/) || norm.match(/executar\s+(.+)$/);
    p.command = m ? m[1] : null;
  }
  if (intent === 'listDir') {
    const m = norm.match(/(?:pasta|diretorio|arquivo)\s*[:=]?\s*(.+)$/);
    p.dir = m ? m[1] : '~';
  }
  return p;
}

module.exports = { handle, hasLLM: HAS_LLM, model: OPENAI_MODEL };