// server/index.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const { migrate } = require('./models/migrate');
const { cookieParser, requireAuth, requireCsrf, csrfRoute } = require('./auth/middleware');

const authRoutes = require('./auth/routes');
const playerRoutes = require('./player/routes');
const gachaRoutes = require('./gacha/routes');
const catalogRoutes = require('./routes/catalog');

const K = require('./balance/config');
const buildStarterRouter = require('./starter/routes');

// ======== Pipeline de Conteúdo (YAML/Tiled) ========
const { loadAll, loadMap } = require('./content/loader');
const CONTENT_PIPELINE = process.env.CONTENT_PIPELINE || 'off'; // off | shadow | on
// ===================================================

// ========= CONFIG =========
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR = path.join(__dirname, '..', 'client');
const WORKER_TICK_SECONDS = Number(process.env.WORKER_TICK_SECONDS || 3);
const { randomUUID } = require('crypto');
const { get, run, all } = require('./models/db'); // usa os mesmos helpers do routes.js
// Chat moderation / rate-limit config
const RATE_TOKENS_PER_SEC = Number(process.env.CHAT_TOKENS_PER_SEC || 2);
const RATE_BURST = Number(process.env.CHAT_RATE_BURST || 4);
const BANNED_WORDS = (process.env.BANNED_WORDS || 'badword1,badword2').split(',').map(s=>s.trim()).filter(Boolean);

// in-memory fallback (mantido apenas como cache)
const mutedCache = new Map();

// simple filter
function filterText(s) {
  if (!s) return s;
  let out = String(s);
  for (const w of BANNED_WORDS) {
    if (!w) continue;
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'ig');
    out = out.replace(re, '***');
  }
  return out;
}

// token-bucket helpers
function ensureTokenBucket(ws) {
  if (!ws._tokens) {
    ws._tokens = RATE_BURST;
    ws._lastRefill = Date.now();
  } else {
    const now = Date.now();
    const delta = (now - (ws._lastRefill || now))/1000;
    if (delta > 0) {
      ws._tokens = Math.min(RATE_BURST, (ws._tokens || 0) + delta * RATE_TOKENS_PER_SEC);
      ws._lastRefill = now;
    }
  }
}
function consumeToken(ws) {
  ensureTokenBucket(ws);
  if ((ws._tokens || 0) >= 1) { ws._tokens -= 1; return true; }
  return false;
}

// ========= APP =========
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(requireCsrf);

// CSRF token
app.get('/api/csrf', csrfRoute);

// ========= DB =========
const DB_PATH = path.join(__dirname, 'db', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// helpers DB (promises)
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this) }));

// --- bootstrap de segurança do pipeline ---
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS content_files (
  path TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS monsters_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  name TEXT,
  xp INTEGER,
  healthMax INTEGER,
  speed INTEGER,
  flagsJSON TEXT,
  elementsJSON TEXT,
  attacksJSON TEXT,
  defensesJSON TEXT,
  lootJSON TEXT,
  lookJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS items_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sprites_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  kind TEXT,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS maps (
  key TEXT PRIMARY KEY,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS map_objects (
  id INTEGER PRIMARY KEY,
  mapKey TEXT,
  type TEXT,
  x INTEGER, y INTEGER, w INTEGER, h INTEGER,
  propsJSON TEXT,
  FOREIGN KEY(mapKey) REFERENCES maps(key)
);
CREATE TABLE IF NOT EXISTS spawns (
  id INTEGER PRIMARY KEY,
  mapKey TEXT,
  monsterKey TEXT,
  x INTEGER, y INTEGER, w INTEGER, h INTEGER,
  count INTEGER, respawnSec INTEGER,
  levelMin INTEGER, levelMax INTEGER,
  FOREIGN KEY(mapKey) REFERENCES maps(key)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  fromId TEXT,
  fromName TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`, (e) => {
  if (e) console.error("[content] bootstrap error:", e.message);
  else console.log("[content] tables ready (bootstrap)");
});

// ========= ROTAS QUE NÃO PRECISAM DO DB PASSADO =========
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha', requireAuth, gachaRoutes);
app.use('/api/skills', require('./skills/routes'));

// ========= Helpers =========
const SKILLS = new Set(['SWORD', 'AXE', 'CLUB', 'DISTANCE', 'SHIELD', 'MAGIC']);

async function resolveSkillType(weaponOrSkill) {
  if (!weaponOrSkill) return null;
  const raw = String(weaponOrSkill);
  const up = raw.toUpperCase();
  if (SKILLS.has(up)) return up;

  const row = await dbGet(
    `SELECT skill_type FROM weapon_skill_map WHERE LOWER(weapon_type) = LOWER(?)`,
    [raw]
  );
  return row?.skill_type || null;
}

// ========= Rotas de Treino =========
const trainingRouter = express.Router();

// START
trainingRouter.post('/start', requireAuth, async (req, res) => {
  try {
    const { heroId, weaponOrSkill, heroClass } = req.body || {};
    if (!heroId || !weaponOrSkill || !heroClass) {
      return res.status(400).json({ error: 'heroId, weaponOrSkill e heroClass são obrigatórios' });
    }

    const skillType = await resolveSkillType(weaponOrSkill);
    if (!skillType) return res.status(400).json({ error: 'weaponOrSkill inválido' });

    const nowIso = new Date().toISOString();
    const notes = JSON.stringify({ heroClass: String(heroClass).toUpperCase() });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id=?`, [heroId]);
    if (t) {
      await dbRun(
        `UPDATE hero_training
            SET skill_type=?, status='RUNNING',
                started_at=COALESCE(started_at, ?),
                last_tick_at=?,
                notes=?,
                daily_reset_at = COALESCE(daily_reset_at, datetime('now','start of day','+1 day')),
                energy_current = COALESCE(energy_current, energy_max)
          WHERE hero_id=?`,
        [skillType, nowIso, nowIso, notes, heroId]
      );
    } else {
      await dbRun(
        `INSERT INTO hero_training
           (hero_id, skill_type, status, started_at, last_tick_at,
            energy_current, energy_max, energy_spent, session_seconds, daily_seconds, daily_reset_at, notes)
         VALUES (?, ?, 'RUNNING', ?, ?, 100, 100, 0, 0, 0, datetime('now','start of day','+1 day'), ?)`,
        [heroId, skillType, nowIso, nowIso, notes]
      );
    }

    res.json({ ok: true, message: 'Training started', heroId, skillType });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erro ao iniciar treino' });
  }
});

// STOP
trainingRouter.post('/stop', requireAuth, async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id=?`, [heroId]);
    if (!t || t.status !== 'RUNNING') return res.json({ ok: true, message: 'No active session' });

    const now = Date.now();
    const last = Date.parse(t.last_tick_at || t.started_at || new Date(0).toISOString());
    const delta = Math.max(0, Math.floor((now - last) / 1000));

    const energyCost = K.ENERGY_PER_MIN_WHEN_TRAINING * (delta / 60);
    const newEnergy = Math.max(0, (t.energy_current || 0) - energyCost);

    await dbRun(
      `UPDATE hero_training
          SET status='STOPPED',
              last_tick_at=?,
              session_seconds=COALESCE(session_seconds,0)+?,
              daily_seconds=COALESCE(daily_seconds,0)+?,
              energy_current=?,
              energy_spent=COALESCE(energy_spent,0)+?
        WHERE hero_id=?`,
      [new Date(now).toISOString(), delta, delta, newEnergy, energyCost, heroId]
    );

    res.json({ ok: true, message: 'Training stopped', processed_seconds: delta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erro ao parar treino' });
  }
});

// STATUS
trainingRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id=?`, [heroId]);
    if (!t) return res.json({ status: 'IDLE' });

    const skillRow = await dbGet(
      `SELECT level, tries_progress FROM player_hero_skills WHERE hero_id=? AND skill_type=?`,
      [heroId, t.skill_type]
    );
    let need = null, remaining = null, pct = null;
    if (skillRow) {
      const n = await dbGet(
        `SELECT tries_needed FROM skill_curves WHERE skill_type=? AND level=?`,
        [t.skill_type, skillRow.level]
      );
      need = n?.tries_needed ?? null;
      if (need != null) {
        remaining = Math.max(0, need - (skillRow.tries_progress || 0));
        pct = Math.floor((skillRow.tries_progress / need) * 100);
      }
    }

    res.json({
      status: t.status,
      hero_id: t.hero_id,
      skill_type: t.skill_type,
      class: (() => { try { return JSON.parse(t.notes || '{}').heroClass } catch { return null } })(),
      energy_current: t.energy_current,
      energy_max: t.energy_max,
      session_seconds: t.session_seconds,
      daily_seconds: t.daily_seconds,
      caps: { daily: K.DAILY_TRAIN_CAP_SECONDS, session: K.MAX_SESSION_SECONDS },
      level: skillRow?.level ?? null,
      tries_progress: skillRow?.tries_progress ?? null,
      tries_needed: need,
      remaining_tries: remaining,
      progress_pct: pct
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erro ao consultar status' });
  }
});

app.use('/api/training', trainingRouter);

// ========= ROTAS QUE USAM DB (admin/content + starter) =========

// utilitários (pipeline YAML/Tiled)
app.get('/api/admin/content/monsters', async (_req, res) => {
  db.all('SELECT key,name,xp FROM monsters_master ORDER BY key', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/assets/items', (_req, res) => {
  db.all('SELECT key, dataJSON FROM items_master ORDER BY key', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ key: r.key, data: JSON.parse(r.dataJSON) })));
  });
});

app.get('/api/assets/sprites', (_req, res) => {
  db.all('SELECT key, kind, dataJSON FROM sprites_master ORDER BY key', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ key: r.key, kind: r.kind, data: JSON.parse(r.dataJSON) })));
  });
});

// DEBUG MAPS
app.get('/api/admin/content/maps', (_req, res) => {
  db.all('SELECT key, length(dataJSON) AS bytes, updated_at FROM maps ORDER BY key', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/admin/content/map/:key/objects', (req, res) => {
  db.all(
    'SELECT id, type, x, y, w, h, propsJSON FROM map_objects WHERE mapKey=? ORDER BY id',
    [req.params.key],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map(r => ({ ...r, props: safeParse(r.propsJSON) })));
    }
  );
});

app.get('/api/admin/content/map/:key/spawns', (req, res) => {
  db.all(
    'SELECT id, monsterKey, x, y, w, h, count, respawnSec, levelMin, levelMax FROM spawns WHERE mapKey=? ORDER BY id',
    [req.params.key],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// JSON bruto do mapa
app.get('/api/admin/content/map/:key/data', (req, res) => {
  db.get('SELECT dataJSON FROM maps WHERE key=?', [req.params.key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'map not found' });
    try {
      return res.json(JSON.parse(row.dataJSON || '{}'));
    } catch (e) {
      return res.status(500).json({ error: 'invalid map json' });
    }
  });
});

// reload de mapa sem reiniciar
app.post('/api/admin/content/reload-map', async (req, res) => {
  try {
    const mapKey = (req.query.map || 'house').toString();
    await loadMap(db, path.join(__dirname, '..'), mapKey);
    res.json({ ok: true, reloaded: mapKey });
  } catch (e) {
    console.error('[content] reload-map error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

// >>> ROTA STARTER
app.use('/api/starter', requireAuth, buildStarterRouter(db));

// ---- Raiz pública: entrega index.html (landing + login)
app.get('/', (_req, res) => {
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// ========= SERVE CLIENTE (estático)
app.use(express.static(CLIENT_ROOT_DIR));

// ========= SPA fallback (não intercepta assets)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|map)$/i.test(req.path)) return next();
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// after app and middleware setup (localize this where app is configured)
// add monsters endpoint (admin/content)
app.get('/api/admin/content/monsters', requireAuth, (req, res) => {
  db.all('SELECT key, name, xp, healthMax, speed, lookJSON FROM monsters_master', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // parse lookJSON for convenience
    const parsed = rows.map(r => ({ ...r, look: r.lookJSON ? JSON.parse(r.lookJSON) : {} }));
    res.json(parsed);
  });
});

// WebSocket minimal server (optional)
const http = require('http').createServer(app);

// try to load ws optionally so server won't crash if it's not installed
let WebSocketLib = null;
let useWebSocket = false;
try {
  WebSocketLib = require('ws');
  useWebSocket = !!WebSocketLib && !!WebSocketLib.Server;
  if (!useWebSocket) console.warn('[ws] package loaded but Server not available');
} catch (err) {
  console.warn('[ws] optional dependency "ws" not installed — realtime disabled. Run `npm install ws` to enable.');
  WebSocketLib = null;
  useWebSocket = false;
}

// Consolidated: jwt, redis, crypto and Redis helpers (single declaration)
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const crypto = require('crypto');

const REDIS_URL = process.env.REDIS_URL || null; // ex: redis://127.0.0.1:6379
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'token'; // ajuste se seu cookie tiver outro nome

let redisPub = null;
let redisSub = null;

async function setupRedis(wss) {
  if (!REDIS_URL) {
    console.log('[redis] REDIS_URL not set — running without Redis pub/sub (single-instance)');
    return;
  }
  try {
    redisPub = createClient({ url: REDIS_URL });
    redisSub = redisPub.duplicate();
    await redisPub.connect();
    await redisSub.connect();
    await redisSub.subscribe('chat:global', (message) => {
      try {
        const obj = JSON.parse(message);
        const out = JSON.stringify(obj);
        wss.clients.forEach(c => {
          if (c && c.readyState === WebSocket.OPEN) {
            try { c.send(out); } catch (e) { /* ignore */ }
          }
        });
      } catch (e) { console.warn('[redis] bad pubsub message', e?.message); }
    });
    console.log('[redis] connected and subscribed to chat:global');
  } catch (e) {
    console.warn('[redis] failed to connect — continuing without Redis', e?.message);
    redisPub = null; redisSub = null;
  }
}

// helper: parse cookies from header
function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    (cookieHeader || '').split(';').map(s => {
      const idx = s.indexOf('=');
      if (idx === -1) return [];
      const k = s.slice(0, idx).trim();
      const v = s.slice(idx + 1).trim();
      return [k, decodeURIComponent(v)];
    }).filter(Boolean)
  );
}

if (useWebSocket) {
  const wss = new WebSocketLib.Server({ server: http, path: '/ws' });

  // inicializa redis (se configurado)
  setupRedis(wss).catch(() => { /* ignore */ });

  const instanceId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    console.log(`[ws] connection from ${addr} — clients=${wss.clients.size}`);

    // DEBUG: log cookies header (remova em produção se preferir)
    console.log('[ws] cookies header:', req.headers && req.headers.cookie);

    ws._connectedAt = Date.now();
    ws._player = null;

    // try validate JWT from cookie immediately (so explicit handshake not required)
    try {
      const cookies = parseCookies(req.headers.cookie || '');
      const token = cookies[COOKIE_NAME] || null;
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          ws._player = { id: String(payload.id || payload.playerId || ''), name: String(payload.name || payload.username || payload.displayName || 'Anon') };
          console.log(`[ws] session validated from cookie for ${addr} => id=${ws._player.id} name=${ws._player.name}`);
        } catch (err) {
          console.log('[ws] jwt verify failed', err && err.message);
        }
      }
    } catch (e) {
      console.warn('[ws] cookie parse error', e && e.message);
    }

    ws.on('message', async (raw) => {
      try {
        const d = JSON.parse(String(raw));
        console.log('[ws recv]', req.socket.remoteAddress, '<-', d.type || 'msg');

        if (d.type === 'chat' && d.scope === 'global') {
          // if you persist chat to DB, do that here and use DB id/timestamp
          // Example: if you have an async saveChat(obj) that returns saved row with id and created_at:
          // const saved = await saveChat({ fromId: ws.userId, fromName: d.name || ws.userName, text: d.text, scope:'global' });
          // const out = { type:'chat', scope:'global', id: saved.id, fromId: saved.fromId, fromName: saved.fromName, text: saved.text, ts: new Date(saved.created_at).getTime(), _clientId: d._clientId };

          // If you don't have DB here, create a stable id + ts before broadcasting:
          const out = {
            type: 'chat',
            scope: 'global',
            id: d.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,8)),
            fromId: d.idSender || ws.userId || null,
            fromName: d.name || ws.userName || 'Anon',
            text: d.text,
            ts: Date.now(),
            _clientId: d._clientId || null
          };

          // broadcast once
          broadcast(out);
          // optionally persist in background
          // saveChat(...) .catch(e=>console.warn('saveChat failed', e));
        }

        // handle typing and other events unchanged:
        if (d.type === 'typing') {
          const out = { type: 'typing', fromId: ws.userId || null, fromName: ws.userName || 'Anon', state: !!d.state };
          broadcast(out);
        }

        // ...other message types...
      } catch (e) {
        console.warn('[ws] bad msg', e && e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[ws] close from ${addr} — clients=${wss.clients.size}`);
    });

    ws.on('error', (err) => {
      console.warn('[ws] socket error', err && err.message);
    });
  });
}

// ensure DB helpers available
http.listen(PORT, () => console.log(`server listening on ${PORT} ${useWebSocket ? '(ws enabled)' : '(ws disabled)'}`));

// ========= START =========
(async () => {
  await migrate();

  if (CONTENT_PIPELINE !== 'off') {
    console.log(`[content] pipeline: ${CONTENT_PIPELINE}`);
    await loadAll(db, path.join(__dirname, '..'));
  }

  // Removido app.listen duplicado — usamos o http server criado acima.
  console.log(`> ${NODE_ENV} | http://localhost:${PORT}`);
  console.log(`[training] DB: ${DB_PATH}`);

  // ========= WORKER (stamina/limites; NÃO dá tries) =========
  async function trainingTick() {
    try {
      await dbRun(`
        UPDATE hero_training
           SET daily_seconds=CASE
                 WHEN daily_reset_at IS NULL THEN daily_seconds
                 WHEN datetime('now') >= daily_reset_at THEN 0
                 ELSE daily_seconds
               END,
               daily_reset_at=CASE
                 WHEN daily_reset_at IS NULL THEN datetime('now','start of day','+1 day')
                 WHEN datetime('now') >= daily_reset_at THEN datetime('now','start of day','+1 day')
                 ELSE daily_reset_at
               END
      `, []);

      const running = await dbAll(`SELECT * FROM hero_training WHERE status='RUNNING'`, []);
      const now = Date.now();

      for (const t of running) {
        const last  = Date.parse(t.last_tick_at || t.started_at || new Date().toISOString());
        let delta   = Math.max(0, Math.floor((now - last)/1000));
        if (delta <= 0) continue;

        const sessLeft = Math.max(0, K.MAX_SESSION_SECONDS     - (t.session_seconds || 0));
        const dayLeft  = Math.max(0, K.DAILY_TRAIN_CAP_SECONDS - (t.daily_seconds   || 0));
        let allowed    = Math.min(delta, sessLeft, dayLeft);

        const energySec = Math.floor(((t.energy_current || 0) / K.ENERGY_PER_MIN_WHEN_TRAINING) * 60);
        allowed = Math.min(allowed, energySec);
        if (allowed <= 0) {
          await dbRun(`UPDATE hero_training SET status='STOPPED' WHERE hero_id=?`, [t.hero_id]);
          continue;
        }

        const newLast   = new Date(last + allowed*1000).toISOString();
        const energyUse = K.ENERGY_PER_MIN_WHEN_TRAINING * (allowed/60);
        const newEnergy = Math.max(0, (t.energy_current || 0) - energyUse);

        await dbRun(
          `UPDATE hero_training
              SET last_tick_at=?,
                  session_seconds=COALESCE(session_seconds,0)+?,
                  daily_seconds=COALESCE(daily_seconds,0)+?,
                  energy_current=?,
                  energy_spent=COALESCE(energy_spent,0)+?
            WHERE hero_id=?`,
          [newLast, allowed, allowed, newEnergy, energyUse, t.hero_id]
        );

        if (newEnergy <= 0 || allowed < delta || allowed === sessLeft || allowed === dayLeft) {
          await dbRun(`UPDATE hero_training SET status='STOPPED' WHERE hero_id=?`, [t.hero_id]);
        }
      }
    } catch (err) {
      console.error('[worker] tick error:', err.message);
    }
  }

  setInterval(trainingTick, WORKER_TICK_SECONDS * 1000);
})();

// rota para obter histórico global (últimas N mensagens)
app.get('/api/chat/global', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit || 100));
    const before = req.query.before ? Number(req.query.before) : null; // id before
    if (before) {
      db.all(
        'SELECT id, scope, fromId, fromName, text, created_at FROM chat_messages WHERE scope=? AND id < ? ORDER BY id DESC LIMIT ?',
        ['global', before, limit],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json(rows.reverse());
        }
      );
    } else {
      db.all(
        'SELECT id, scope, fromId, fromName, text, created_at FROM chat_messages WHERE scope=? ORDER BY id DESC LIMIT ?',
        ['global', limit],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json(rows.reverse());
        }
      );
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// mute endpoints (in-memory). Adjust protection as needed (requireAuth present)
app.post('/api/chat/mute', requireAuth, async (req, res) => {
  try {
    const byId = String(req.user?.id || '');
    const me = await get('SELECT role FROM players WHERE id = ?', [byId]);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    const targetId = String(req.body?.targetId || '');
    const seconds = Number(req.body?.seconds || 0);
    const reason = String(req.body?.reason || '');
    if (!targetId || !seconds) return res.status(400).json({ error:'targetId and seconds required' });

    const until = Date.now() + Math.max(0, seconds)*1000;
    await run('INSERT INTO chat_mutes(targetId, byId, until, reason, created_at) VALUES (?,?,?,?,?)',
      [targetId, byId, until, reason || null, Date.now()]);
    // update cache
    mutedCache.set(targetId, until);
    return res.json({ ok: true, targetId, until });
  } catch (e) {
    console.error('[api/chat/mute] ', e);
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat/unmute', requireAuth, async (req, res) => {
  try {
    const byId = String(req.user?.id || '');
    const me = await get('SELECT role FROM players WHERE id = ?', [byId]);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    const targetId = String(req.body?.targetId || '');
    if (!targetId) return res.status(400).json({ error:'targetId required' });
    await run('DELETE FROM chat_mutes WHERE targetId = ?', [targetId]);
    mutedCache.delete(targetId);
    return res.json({ ok: true, targetId });
  } catch (e) {
    console.error('[api/chat/unmute] ', e);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/chat/mutes', requireAuth, async (req, res) => {
  try {
    const byId = String(req.user?.id || '');
    const me = await get('SELECT role FROM players WHERE id = ?', [byId]);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const rows = await all('SELECT id, targetId, byId, until, reason, created_at FROM chat_mutes ORDER BY created_at DESC');
    return res.json(rows || []);
  } catch (e) {
    console.error('[api/chat/mutes] ', e);
    return res.status(500).json({ error: e.message });
  }
});

// robust broadcast + message handler (replace existing broadcast/handler)

const recentBroadcastIds = new Set();

function broadcast(msg) {
  try {
    if (!msg) return;
    // ensure msg has an id string so dedupe works
    if (!msg.id) msg.id = (Date.now().toString(36) + Math.random().toString(36).slice(2,8));
    const idStr = String(msg.id);
    if (recentBroadcastIds.has(idStr)) {
      console.log('[ws] skip broadcast (recent id)', idStr);
      return;
    }
    recentBroadcastIds.add(idStr);
    setTimeout(() => recentBroadcastIds.delete(idStr), 30_000); // keep for 30s

    const targets = [];
    wss.clients.forEach(c => { if (c && c.readyState === WebSocket.OPEN) targets.push(c); });
    console.log('[ws] broadcasting message to', targets.length, 'clients', msg.type || '');
    for (const c of targets) {
      try { c.send(JSON.stringify(msg)); } catch (e) { console.warn('[ws] send failed', e && e.message); }
    }
  } catch (e) {
    console.warn('[ws] broadcast error', e && e.message);
  }
}

// in your wss.on('connection', ws => { ... }) replace or ensure you have a single message handler like:

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  console.log(`[ws] connection from ${addr} — clients=${wss.clients.size}`);

  // DEBUG: log cookies header (remova em produção se preferir)
  console.log('[ws] cookies header:', req.headers && req.headers.cookie);

  ws._connectedAt = Date.now();
  ws._player = null;

  // try validate JWT from cookie immediately (so explicit handshake not required)
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[COOKIE_NAME] || null;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        ws._player = { id: String(payload.id || payload.playerId || ''), name: String(payload.name || payload.username || payload.displayName || 'Anon') };
        console.log(`[ws] session validated from cookie for ${addr} => id=${ws._player.id} name=${ws._player.name}`);
      } catch (err) {
        console.log('[ws] jwt verify failed', err && err.message);
      }
    }
  } catch (e) {
    console.warn('[ws] cookie parse error', e && e.message);
  }

  ws.on('message', async (raw) => {
    try {
      const d = JSON.parse(String(raw));
      console.log('[ws recv]', req.socket.remoteAddress, '<-', d.type || 'msg');

      if (d.type === 'chat' && d.scope === 'global') {
        // if you persist chat to DB, do that here and use DB id/timestamp
        // Example: if you have an async saveChat(obj) that returns saved row with id and created_at:
        // const saved = await saveChat({ fromId: ws.userId, fromName: d.name || ws.userName, text: d.text, scope:'global' });
        // const out = { type:'chat', scope:'global', id: saved.id, fromId: saved.fromId, fromName: saved.fromName, text: saved.text, ts: new Date(saved.created_at).getTime(), _clientId: d._clientId };

        // If you don't have DB here, create a stable id + ts before broadcasting:
        const out = {
          type: 'chat',
          scope: 'global',
          id: d.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,8)),
          fromId: d.idSender || ws.userId || null,
          fromName: d.name || ws.userName || 'Anon',
          text: d.text,
          ts: Date.now(),
          _clientId: d._clientId || null
        };

        // broadcast once
        broadcast(out);
        // optionally persist in background
        // saveChat(...) .catch(e=>console.warn('saveChat failed', e));
      }

      // handle typing and other events unchanged:
      if (d.type === 'typing') {
        const out = { type: 'typing', fromId: ws.userId || null, fromName: ws.userName || 'Anon', state: !!d.state };
        broadcast(out);
      }

      // ...other message types...
    } catch (e) {
      console.warn('[ws] bad msg', e && e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[ws] close from ${addr} — clients=${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.warn('[ws] socket error', err && err.message);
  });
});



