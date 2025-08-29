// server/index.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');

const { all, get, run } = require('./models/db'); // <- PG helpers
const { migrate } = require('./models/migrate');
const { cookieParser, requireAuth, requireCsrf, csrfRoute } = require('./auth/middleware');

const authRoutes = require('./auth/routes');
const playerRoutes = require('./player/routes');
const gachaRoutes = require('./gacha/routes');
const catalogRoutes = require('./routes/catalog');
const skillsRoutes = require('./skills/routes');

// AFK & Farm (base/ilha)
const afkRoutes = require('./routes/afk');
const farmRoutes = require('./routes/farm');

const K = require('./balance/config'); // ainda usado nas rotas de treino (stop/status)
const buildStarterRouter = require('./starter/routes');

// ======== Pipeline de Conteúdo (YAML/Tiled) ========
const { loadAll, loadMap } = require('./content/loader');
const CONTENT_PIPELINE = process.env.CONTENT_PIPELINE || 'off'; // off | shadow | on
// ===================================================

// ========= CONFIG =========
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR = path.join(__dirname, '..', 'client');

// ========= APP =========
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// 1) Expor o endpoint de CSRF ANTES de ligar o guard global
app.get('/api/csrf', csrfRoute);

// 2) Ativar o guard de CSRF para o restante das rotas
app.use(requireCsrf);

/* ========= Bootstrap: tabelas do pipeline (Postgres) ========= */
async function bootstrapContentTables() {
  try {
    // content_files
    await run(`
      CREATE TABLE IF NOT EXISTS content_files (
        path TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // monsters_master
    await run(`
      CREATE TABLE IF NOT EXISTS monsters_master (
        id BIGSERIAL PRIMARY KEY,
        key TEXT UNIQUE,
        name TEXT,
        xp INTEGER,
        "healthMax" INTEGER,
        speed INTEGER,
        "flagsJSON" JSONB,
        "elementsJSON" JSONB,
        "attacksJSON" JSONB,
        "defensesJSON" JSONB,
        "lootJSON" JSONB,
        "lookJSON" JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // items_master
    await run(`
      CREATE TABLE IF NOT EXISTS items_master (
        id BIGSERIAL PRIMARY KEY,
        key TEXT UNIQUE,
        "dataJSON" JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // sprites_master
    await run(`
      CREATE TABLE IF NOT EXISTS sprites_master (
        id BIGSERIAL PRIMARY KEY,
        key TEXT UNIQUE,
        kind TEXT,
        "dataJSON" JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // maps
    await run(`
      CREATE TABLE IF NOT EXISTS maps (
        key TEXT PRIMARY KEY,
        "dataJSON" JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // map_objects
    await run(`
      CREATE TABLE IF NOT EXISTS map_objects (
        id BIGSERIAL PRIMARY KEY,
        "mapKey" TEXT REFERENCES maps(key) ON DELETE CASCADE,
        type TEXT,
        x INTEGER, y INTEGER, w INTEGER, h INTEGER,
        "propsJSON" JSONB
      )
    `);

    // spawns
    await run(`
      CREATE TABLE IF NOT EXISTS spawns (
        id BIGSERIAL PRIMARY KEY,
        "mapKey" TEXT REFERENCES maps(key) ON DELETE CASCADE,
        "monsterKey" TEXT,
        x INTEGER, y INTEGER, w INTEGER, h INTEGER,
        count INTEGER, "respawnSec" INTEGER,
        "levelMin" INTEGER, "levelMax" INTEGER
      )
    `);

    // chat_messages
    await run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        scope TEXT NOT NULL,
        "fromId" TEXT,
        "fromName" TEXT,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    console.log('[content] tables ready (bootstrap)');
  } catch (e) {
    console.error('[content] bootstrap error:', e.message);
  }
}

/* ========= ROTAS ========= */

// públicas / auth
app.use('/api/auth', authRoutes);

// catálogos públicos (seu router já cuida do que é público)
app.use('/api', catalogRoutes);

// protegidas
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha', requireAuth, gachaRoutes);
app.use('/api/skills', requireAuth, skillsRoutes);

// AFK (base/ilha)
app.use('/api/afk', requireAuth, afkRoutes);
app.use('/api/farm', requireAuth, farmRoutes);

/* ========= Helpers (Treino) ========= */
async function resolveSkillType(weaponOrSkill) {
  if (!weaponOrSkill) return null;
  const raw = String(weaponOrSkill);
  const row = await get(
    `SELECT skill_type FROM weapon_skill_map WHERE lower(weapon_type) = lower($1)`,
    [raw]
  );
  return row?.skill_type || null;
}

/* ========= Rotas de Treino (sem tick global) ========= */
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

    const t = await get(`SELECT * FROM hero_training WHERE hero_id=$1`, [heroId]);
    if (t) {
      await run(
        `UPDATE hero_training
            SET skill_type=$1, status='RUNNING',
                started_at=COALESCE(started_at, $2),
                last_tick_at=$3,
                notes=$4,
                daily_reset_at = COALESCE(daily_reset_at, date_trunc('day', now()) + interval '1 day'),
                energy_current = COALESCE(energy_current, energy_max)
          WHERE hero_id=$5`,
        [skillType, nowIso, nowIso, notes, heroId]
      );
    } else {
      await run(
        `INSERT INTO hero_training
           (hero_id, skill_type, status, started_at, last_tick_at,
            energy_current, energy_max, energy_spent, session_seconds, daily_seconds, daily_reset_at, notes)
         VALUES ($1, $2, 'RUNNING', $3, $4, 100, 100, 0, 0, 0,
                 date_trunc('day', now()) + interval '1 day', $5)`,
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

    const t = await get(`SELECT * FROM hero_training WHERE hero_id=$1`, [heroId]);
    if (!t || t.status !== 'RUNNING') return res.json({ ok: true, message: 'No active session' });

    // Sem tick global: ainda computamos o delta só para fechar a sessão atual
    const now = Date.now();
    const last = Date.parse(t.last_tick_at || t.started_at || new Date(0).toISOString());
    const delta = Math.max(0, Math.floor((now - last) / 1000));

    const energyCost = K.ENERGY_PER_MIN_WHEN_TRAINING * (delta / 60);
    const newEnergy = Math.max(0, (t.energy_current || 0) - energyCost);

    await run(
      `UPDATE hero_training
          SET status='STOPPED',
              last_tick_at=$1,
              session_seconds=COALESCE(session_seconds,0)+$2,
              daily_seconds=COALESCE(daily_seconds,0)+$3,
              energy_current=$4,
              energy_spent=COALESCE(energy_spent,0)+$5
        WHERE hero_id=$6`,
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

    const t = await get(`SELECT * FROM hero_training WHERE hero_id=$1`, [heroId]);
    if (!t) return res.json({ status: 'IDLE' });

    const skillRow = await get(
      `SELECT level, tries_progress FROM player_hero_skills WHERE hero_id=$1 AND skill_type=$2`,
      [heroId, t.skill_type]
    );
    let need = null, remaining = null, pct = null;
    if (skillRow) {
      const n = await get(
        `SELECT tries_needed FROM skill_curves WHERE skill_type=$1 AND level=$2`,
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

/* ========= admin/content + starter ========= */

// DEBUG: listar monsters (autenticado)
app.get('/api/admin/content/monsters', requireAuth, async (_req, res) => {
  try {
    const rows = await all('SELECT key, name, xp, "healthMax", speed, "lookJSON" FROM monsters_master ORDER BY id');
    const parsed = rows.map(r => ({ ...r, look: r.lookJSON || {} }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// itens/sprites
app.get('/api/assets/items', async (_req, res) => {
  try {
    const rows = await all('SELECT key, "dataJSON" FROM items_master ORDER BY key');
    res.json(rows.map(r => ({ key: r.key, data: r.dataJSON || {} })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assets/sprites', async (_req, res) => {
  try {
    const rows = await all('SELECT key, kind, "dataJSON" FROM sprites_master ORDER BY key');
    res.json(rows.map(r => ({ key: r.key, kind: r.kind, data: r.dataJSON || {} })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DEBUG MAPS
app.get('/api/admin/content/maps', async (_req, res) => {
  try {
    const rows = await all(
      `SELECT key, length(("dataJSON"::text)) AS bytes, updated_at FROM maps ORDER BY key`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/content/map/:key/objects', async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, type, x, y, w, h, "propsJSON" FROM map_objects WHERE "mapKey"=$1 ORDER BY id`,
      [req.params.key]
    );
    res.json(rows.map(r => ({ ...r, props: safeParse(r.propsJSON) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/content/map/:key/spawns', async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, "monsterKey", x, y, w, h, count, "respawnSec", "levelMin", "levelMax"
         FROM spawns WHERE "mapKey"=$1 ORDER BY id`,
      [req.params.key]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// JSON bruto do mapa
app.get('/api/admin/content/map/:key/data', async (req, res) => {
  try {
    const row = await get('SELECT "dataJSON" FROM maps WHERE key=$1', [req.params.key]);
    if (!row) return res.status(404).json({ error: 'map not found' });
    res.json(row.dataJSON || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// reload de mapa sem reiniciar
app.post('/api/admin/content/reload-map', async (req, res) => {
  try {
    const mapKey = (req.query.map || 'house').toString();
    // passa um adaptador com as mesmas assinaturas (all/get/run)
    await loadMap({ all, get, run }, path.join(__dirname, '..'), mapKey);
    res.json({ ok: true, reloaded: mapKey });
  } catch (e) {
    console.error('[content] reload-map error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function safeParse(s) { try { return typeof s === 'object' ? s : JSON.parse(s || '{}'); } catch { return {}; } }

// >>> ROTA STARTER
// passa adaptador {all,get,run} para o router do starter
app.use('/api/starter', requireAuth, buildStarterRouter({ all, get, run }));

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

// ========= WebSocket minimal server (opcional) =========
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
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || process.env.COOKIE_NAME || 'sid';
 // ajuste se seu cookie tiver outro nome

let redisPub = null;
let redisSub = null;

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
          if (c && c.readyState === WebSocketLib.OPEN) {
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

let server; // http.Server
let wss = null;

// ========= START =========
(async () => {
  try {
    await migrate();              // aplica migrations PG
    await bootstrapContentTables();

    if (CONTENT_PIPELINE !== 'off') {
      console.log(`[content] pipeline: ${CONTENT_PIPELINE}`);
      // passa adaptador com as mesmas assinaturas
      await loadAll({ all, get, run }, path.join(__dirname, '..'));
    }

    server = http.createServer(app);

    if (useWebSocket) {
      const WebSocketServer = WebSocketLib.Server;
      wss = new WebSocketServer({ server, path: '/ws' });

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

        // valida JWT do cookie (handshake implícito)
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

        ws.on('message', async (msg) => {
          let data;
          try { data = JSON.parse(msg.toString()); } catch (err) { console.warn('[ws] malformed json from', addr); return; }

          if (data.type === 'auth') {
            ws._player = { id: String(data.id || ''), name: String(data.name || 'Anonymous') };
            console.log(`[ws] auth from ${addr} => id=${ws._player.id} name=${ws._player.name}`);
            try { ws.send(JSON.stringify({ type:'auth_ok', id: ws._player.id })); } catch {}
            return;
          }

          if (data.type === 'chat') {
            if (!ws._player) {
              console.warn('[ws] received chat from unauthenticated socket — ignoring');
              try { ws.send(JSON.stringify({ type:'error', message:'not-authenticated' })); } catch {}
              return;
            }
            const scope = String(data.scope || 'global').toLowerCase();
            const raw = String(data.text || '').trim().slice(0, 800);
            if (!raw) return;

            console.log(`[chat] from=${ws._player.id} scope=${scope} text="${raw}"`);

            // persist in PG
            try {
              if (scope === 'global') {
                await run(
                  `INSERT INTO chat_messages(scope, "fromId", "fromName", text) VALUES ($1, $2, $3, $4)`,
                  ['global', ws._player.id, ws._player.name, raw]
                );
              }
            } catch (e) { console.warn('[chat] persist error', e && e.message); }

            const out = {
              type: 'chat',
              scope,
              fromId: ws._player.id,
              fromName: ws._player.name,
              text: raw,
              ts: Date.now(),
              origin: instanceId
            };

            if (redisPub) {
              try {
                await redisPub.publish('chat:global', JSON.stringify(out));
              } catch (e) {
                console.warn('[redis] publish failed', e && e.message);
                const outStr = JSON.stringify(out);
                wss.clients.forEach(c => {
                  if (c && c.readyState === WebSocketLib.OPEN) {
                    try { c.send(outStr); } catch (e) {}
                  }
                });
              }
            } else {
              const outStr = JSON.stringify(out);
              wss.clients.forEach(c => {
                if (c && c.readyState === WebSocketLib.OPEN) {
                  try { c.send(outStr); } catch (e) {}
                }
              });
            }
            return;
          }

          // pos handling (se já existir)
          if (data.type === 'pos') {
            const out = { type:'pos', id:String(data.id||''), x:Number(data.x||0), y:Number(data.y||0), name:String(data.name||'') };
            wss.clients.forEach(c => {
              if (c !== ws && c.readyState === WebSocketLib.OPEN) {
                try { c.send(JSON.stringify(out)); } catch(e) {}
              }
            });
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

    server.listen(PORT, () => {
      console.log(`server listening on ${PORT} ${useWebSocket ? '(ws enabled)' : '(ws disabled)'}`);
      console.log(`> ${NODE_ENV} | http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Fatal start error:', err);
    process.exit(1);
  }
})();

/* ========= Chat history ========= */
app.get('/api/chat/global', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit || 100));
    const rows = await all(
      `SELECT id, scope, "fromId", "fromName", text, created_at
         FROM chat_messages
        WHERE scope=$1
        ORDER BY id DESC
        LIMIT $2`,
      ['global', limit]
    );
    res.json(rows.reverse()); // ordem cronológica asc
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
