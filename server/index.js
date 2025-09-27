// server/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');

// ==== Combat mode flag (simple vs legacy)
const SIMPLE_MODE = String(process.env.MONSTER_ATK_MODE || '').toLowerCase() === 'simple';


// Segurança e performance
const compression = require('compression');
const helmetMiddleware = require('./middleware/security-headers');
const { buildCors } = require('./middleware/cors-allowlist');
const bodyParserLimited = require('./middleware/body-limit');
const makeLimiter = require('./middleware/limiter');
const { isOriginAllowed } = require('./ws/origins');


const { all, get, run } = require('./models/db'); // PG helpers
const { migrate } = require('./models/migrate');
const { cookieParser, requireAuth, requireCsrf, csrfRoute } = require('./auth/middleware');

// Import optimization features
const { endpointMetrics } = require('./middleware/endpoint-metrics');
const catalogCache = require('./services/catalogCache');
const idlePoolCloser = require('./services/idlePoolCloser');
const httpCache = require('./services/httpCache');

const authRoutes = require('./auth/routes');
const playerRoutes = require('./player/routes'); // mantém seu caminho atual
const gachaRoutes = require('./gacha/routes');
const catalogRoutes = require('./routes/catalog');
const skillsRoutes = require('./skills/routes');

// Loot (pickup + listar loots)
const lootRoutes = require('./routes/loot'); // <<-- novo

// Backpack (modelo Tibia-like)
const backpackRoutes = require('./routes/backpack');

// AFK & Farm
const afkRoutes = require('./routes/afk');
const farmRoutes = require('./routes/farm');

// Game tick route
const gameTickRoutes = require('./routes/game_tick');

const K = require('./balance/config');
const buildStarterRouter = require('./starter/routes');
const { startRespawnLoop, stopRespawnLoop } = require('./respawn/worker');

// ws bus
const { attach: attachWsBus, joinMapSocket } = require('./ws/bus');
const { listAliveMonsters } = require('./ws/initial_monsters');

// ======== Pipeline de Conteúdo ========
const { loadAll, loadMap } = require('./content/loader');
const CONTENT_PIPELINE = process.env.CONTENT_PIPELINE || 'off';
// =====================================


// ---- Autoridade de movimento (Tibia-like) ----
const TILE = 32;
const SPEED_CAP_PX_S = 180; // ~0.18 s por tile
const MIN_STEP_MS = Math.floor((TILE / SPEED_CAP_PX_S) * 1000 * 0.75); // 20% folga

function isAdjacentStep(lx, ly, nx, ny) {
  const dx = Math.abs(nx - lx), dy = Math.abs(ny - ly);
  return (dx === TILE && dy === 0) || (dx === 0 && dy === TILE);
}

// ---- [MMO] Posições vivas em RAM + flush periódico p/ DB ----
const {
  livePositions,
  setLivePlayerPosition,
  getLivePlayerPosition,
  removeLivePlayerPosition,
} = require('./state/live-positions');
const FLUSH_POS_INTERVAL_MS = Number(process.env.FLUSH_POS_INTERVAL_MS || 1000);
let posFlushTimer = null;

async function flushOnePlayerPos(pid) {
  const p = getLivePlayerPosition(pid);
  if (!p) return;
  try {
    await run(`
      INSERT INTO player_last_pos (player_id, map_key, x, y, last_seq, updated_at)
      VALUES ($1, $2, $3, $4,
              COALESCE((SELECT last_seq FROM player_last_pos WHERE player_id=$1 AND map_key=$2), 0) + 1,
              now())
      ON CONFLICT (player_id, map_key)
      DO UPDATE SET
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        last_seq = player_last_pos.last_seq + 1,
        updated_at = now()
    `, [String(pid), p.mapKey, p.x | 0, p.y | 0]);
  } catch (e) {
    console.warn('[pos:flush] fail:', e?.message);
  }
}

async function flushAllPlayerPos() {
  const ids = Array.from(livePositions.keys());
  for (const pid of ids) {
    await flushOnePlayerPos(pid);
  }
}

function startPosFlusher() {
  if (posFlushTimer) return;
  posFlushTimer = setInterval(async () => {
    for (const pid of livePositions.keys()) {
      await flushOnePlayerPos(pid);
    }
  }, FLUSH_POS_INTERVAL_MS);
}

function stopPosFlusher() {
  if (posFlushTimer) {
    clearInterval(posFlushTimer);
    posFlushTimer = null;
  }
}


// === Sync automático de instâncias de spawn (opcional) ===
let syncSpawns = async () => {};
try {
  ({ syncSpawns } = require('./jobs/sync_spawns'));
} catch {
  // ok em dev: se o arquivo não existir, segue sem quebrar
}

// (Opcional) cleanup do loot expirado
let startLootCleanupLoop = null;
try {
  ({ startLootCleanupLoop } = require('./loot/cleanup'));
} catch {
  // se não existir, segue sem cleanup
}

// ========= CONFIG =========
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR = path.join(__dirname, '..', 'client');

// New environment variables for idle-aware scheduling
const SYNC_SPAWNS_INTERVAL_MS = Number(process.env.SYNC_SPAWNS_INTERVAL_MS || 300000); // 5 minutes default
const IDLE_SCHEDULER_CHECK_MS = Number(process.env.IDLE_SCHEDULER_CHECK_MS || 30000); // 30 seconds default

// Assets cache configuration
const ASSETS_CACHE_TTL_MS = Number(process.env.ASSETS_CACHE_TTL_MS || 300000); // 5 minutes default

// Optional migration gating (prod-safe)
const SKIP_MIGRATIONS_ON_BOOT = process.env.SKIP_MIGRATIONS_ON_BOOT === '1';

// ========= APP =========
const app = express();
app.use(cookieParser());

// Middlewares de segurança e performance
app.use(helmetMiddleware);
app.use(buildCors());
app.use(bodyParserLimited());
app.use(compression());

// Add optimization middleware
app.use(endpointMetrics);
app.use(idlePoolCloser.trackActivity);

// 1) CSRF BEFORE guard
app.get('/api/csrf', csrfRoute);

// 2) CSRF guard global (métodos que mudam estado)
app.use(requireCsrf);

// Rate limits direcionados (sem alterar resposta das rotas)
app.use('/api/game/tick',  makeLimiter({ windowMs: 1000, max: 6  }));

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

    // chat_messages — nomes MINÚSCULOS
    await run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        scope TEXT NOT NULL,
        fromid TEXT,
        fromname TEXT,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    try { await run(`ALTER TABLE chat_messages RENAME COLUMN "fromId" TO fromid`); } catch(_) {}
    try { await run(`ALTER TABLE chat_messages RENAME COLUMN "fromName" TO fromname`); } catch(_) {}
    await run(`CREATE INDEX IF NOT EXISTS chat_scope_id_idx ON chat_messages (scope, id DESC)`);

    // posição do player por mapa
    await run(`
      CREATE TABLE IF NOT EXISTS player_last_pos (
        player_id BIGINT NOT NULL,
        map_key   TEXT   NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        last_seq BIGINT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (player_id, map_key)
      )
    `);

    // hero_backpack_slots — conteúdo da mochila por herói (modelo Tibia-like)
    await run(`
      CREATE TABLE IF NOT EXISTS hero_backpack_slots (
        hero_id    TEXT  NOT NULL,
        slot_index INTEGER NOT NULL,
        item_key   TEXT,
        qty        INTEGER,
        PRIMARY KEY (hero_id, slot_index)
      )
    `);

    // Add performance indexes for common lookups
    await run(`CREATE INDEX IF NOT EXISTS idx_map_objects_mapkey ON map_objects("mapKey")`);
    await run(`CREATE INDEX IF NOT EXISTS idx_spawns_mapkey ON spawns("mapKey")`);
    await run(`CREATE INDEX IF NOT EXISTS idx_spawns_monster ON spawns("monsterKey")`);
    await run(`CREATE INDEX IF NOT EXISTS idx_monster_instances_map ON monster_instances(map_key)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_monster_instances_spawn ON monster_instances(spawn_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_monster_instances_state ON monster_instances(state)`);
    
    console.log('[content] performance indexes created');
    console.log('[content] tables ready (bootstrap)');
  } catch (e) {
    console.error('[content] bootstrap error:', e.message);
  }
}

/* ========= ROTAS ========= */

// públicas / auth
app.use('/api/auth', authRoutes);

// Combat HTTP routes (sempre ligadas, mesmo no SIMPLE_MODE)
const combatRoutes = require('./combat/routes');
app.use('/api/combat', requireAuth, combatRoutes);


// endpoint auxiliar de nearest (aqui pode ficar ligado sem problema)
const combatNearest = require('./routes/combat_nearest');
app.use(combatNearest);


// protegidas
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha', requireAuth, gachaRoutes);
app.use('/api/skills', requireAuth, skillsRoutes);

// AFK / Farm
app.use('/api/afk', requireAuth, afkRoutes);
app.use('/api/farm', requireAuth, farmRoutes);

// inventário / equipment
app.use('/api/inventory', requireAuth, require('./routes/inventory'));
app.use('/api/equipment', requireAuth, require('./routes/equipment'));

// Loot (pickup + listar loots)
app.use('/api', requireAuth, lootRoutes); // <<-- novo (expõe: POST /api/loot/pickup e GET /api/map/:mapKey/loot)
app.use('/api', require('./routes/csrf_alias'));  // compat: /api/auth/csrf

// backpack (modelo Tibia-like)
app.use('/api/backpack', requireAuth, backpackRoutes);

// Game tick aggregated endpoint
app.use('/api/game', requireAuth, gameTickRoutes);


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

/* ========= Rotas de Treino ========= */
const trainingRouter = express.Router();

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

trainingRouter.post('/stop', requireAuth, async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    const t = await get(`SELECT * FROM hero_training WHERE hero_id=$1`, [heroId]);
    if (!t || t.status !== 'RUNNING') return res.json({ ok: true, message: 'No active session' });

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

// DEBUG: listar monsters
app.get('/api/admin/content/monsters', requireAuth, async (_req, res) => {
  try {
    const rows = await all('SELECT key, name, xp, "healthMax", speed, "lookJSON" FROM monsters_master ORDER BY id');
    const parsed = rows.map(r => ({ ...r, look: r.lookJSON || {} }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// assets
app.get('/api/assets/items', async (req, res) => {
  try {
    const cacheKey = 'assets:items';
    
    // Try cache first, then query database if needed
    let data;
    const cachedEntry = httpCache.get(cacheKey);
    
    if (cachedEntry) {
      data = cachedEntry.value;
    } else {
      const rows = await all('SELECT key, "dataJSON" FROM items_master ORDER BY key');
      data = rows.map(r => ({ key: r.key, data: r.dataJSON || {} }));
    }
    
    // Handle ETag/304 response
    httpCache.handleEtagResponse(req, res, cacheKey, data, ASSETS_CACHE_TTL_MS);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assets/sprites', async (req, res) => {
  try {
    const cacheKey = 'assets:sprites';
    
    // Try cache first, then query database if needed
    let data;
    const cachedEntry = httpCache.get(cacheKey);
    
    if (cachedEntry) {
      data = cachedEntry.value;
    } else {
      const rows = await all('SELECT key, kind, "dataJSON" FROM sprites_master ORDER BY key');
      data = rows.map(r => ({ key: r.key, kind: r.kind, data: r.dataJSON || {} }));
    }
    
    // Handle ETag/304 response
    httpCache.handleEtagResponse(req, res, cacheKey, data, ASSETS_CACHE_TTL_MS);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// maps debug
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

app.get('/api/admin/content/map/:key/data', async (req, res) => {
  try {
    const row = await get('SELECT "dataJSON" FROM maps WHERE key=$1', [req.params.key]);
    if (!row) return res.status(404).json({ error: 'map not found' });
    res.json(row.dataJSON || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/content/reload-map', async (req, res) => {
  try {
    const mapKey = (req.query.map || 'house').toString();

    await loadMap({ all, get, run }, path.join(__dirname, '..'), mapKey);
    await syncSpawns(); // garante instâncias após recarregar o mapa

    // Re-semeia AI apenas no modo legacy
    if (!SIMPLE_MODE) {
      try { 
        const aiMobs = require('./combat/ai-mobs');
        await seedAIMobsFromDB(aiMobs);
      } catch (e) {
        console.warn('[ai-mobs] seed after reload failed:', e?.message);
      }
    }


    res.json({ ok: true, reloaded: mapKey });
  } catch (e) {
    console.error('[content] reload-map error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


function safeParse(s) { try { return typeof s === 'object' ? s : JSON.parse(s || '{}'); } catch { return {}; } }

// starter
app.use('/api/starter', requireAuth, buildStarterRouter({ all, get, run }));

// <<<<<<<<<<<<< SOMENTE AGORA o catálago genérico /api >>>>>>>>>>>>>>
app.use('/api', catalogRoutes);

// ---- Raiz pública
app.get('/', (_req, res) => {
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// ========= STATIC
// servir sprites direto da pasta client/sprites
app.use('/sprites', express.static(path.join(__dirname, '../client/sprites')));

// ========= STATIC
app.use(express.static(CLIENT_ROOT_DIR));

// ========= SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|map)$/i.test(req.path)) return next();
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// ========= WebSocket =========
let WebSocketLib = null;
let useWebSocket = false;
try {
  WebSocketLib = require('ws');
  useWebSocket = !!WebSocketLib && !!WebSocketLib.Server;
  if (!useWebSocket) console.warn('[ws] package loaded but Server not available');
} catch (err) {
  console.warn('[ws] optional dependency "ws" not installed — realtime disabled. Run npm install ws to enable.');
  WebSocketLib = null;
  useWebSocket = false;
}

const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const crypto = require('crypto');

// (NOVO) handler de chat que insere no DB e retorna payload com id
const { createChatPayload } = require('./ws/chat-handler');

const REDIS_URL = process.env.REDIS_URL || null;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || process.env.COOKIE_NAME || 'sid';

let redisPub = null;
let redisSub = null;

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

// ========= PRESENÇA ONLINE (players realmente conectados ao WS) =========

// cria a tabela só se não existir
async function ensurePlayerOnlineTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS player_online(
      hero_id UUID PRIMARY KEY,
      player_id TEXT,
      map_key TEXT,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_player_online_last_seen ON player_online(last_seen DESC)`);
}

// tenta descobrir o herói "ativo" desse player (pela última posição conhecida)
async function resolveActiveHeroId(playerId) {
  if (!playerId) return null;

  const hRecent = await get(`
    SELECT ph.id
    FROM player_heroes ph
    JOIN player_last_pos plp
      ON plp.player_id::text = ph."playerId"::text
    WHERE ph."playerId" = $1
    ORDER BY plp.updated_at DESC
    LIMIT 1
  `, [playerId]);
  if (hRecent?.id) return hRecent.id;

  const hAny = await get(`
    SELECT id
    FROM player_heroes
    WHERE "playerId" = $1
    ORDER BY id
    LIMIT 1
  `, [playerId]);
  return hAny?.id || null;
}

// marca/renova presença (upsert)
async function upsertOnlineByPlayer(playerId, mapKey = null) {
  const heroId = await resolveActiveHeroId(playerId);
  if (!heroId) return;
  await run(`
    INSERT INTO player_online(hero_id, player_id, map_key, last_seen)
    VALUES ($1,$2,$3, now())
    ON CONFLICT (hero_id) DO UPDATE
      SET map_key = EXCLUDED.map_key,
          last_seen = now()
  `, [heroId, String(playerId), mapKey]);
}

// remove presença (quando WS fecha)
async function markOfflineByPlayer(playerId) {
  await run(`DELETE FROM player_online WHERE player_id = $1`, [String(playerId)]);
}


// Heartbeat: derruba sockets inativos (zumbis) de forma segura
function setupHeartbeat(wss) {
  const intervalMs = 30000; // 30s
  function noop() {}
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(noop); } catch {}
    });
  }, intervalMs);
  wss.on('close', () => clearInterval(interval));
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
            try { c.send(out); } catch { /* ignore */ }
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

// ========= IDLE-AWARE SCHEDULER =========

/**
 * Check if the application is currently idle and manage background loops accordingly
 */
function checkIdleAndManageLoops() {
  const status = idlePoolCloser.getStatus();
  
  if (!status.enabled) {
    // Idle management not enabled - ensure loops are running
    if (!respawnRunning) {
      startRespawnLoop({ all, run });
      respawnRunning = true;
      console.log('[idle-scheduler] idle management disabled, ensuring respawn loop is running');
    }
    return;
  }
  
  const isIdle = status.idleMs >= (status.idleCloseMinutes * 60 * 1000);
  
  if (isIdle && respawnRunning) {
    // App is idle and respawn is running - stop it
    stopRespawnLoop();
    respawnRunning = false;
    console.log(`[idle-scheduler] stopping respawn loop after ${status.idleMinutes.toFixed(1)} minutes idle`);
  } else if (!isIdle && !respawnRunning) {
    // App is not idle and respawn is not running - start it
    startRespawnLoop({ all, run });
    respawnRunning = true;
    console.log(`[idle-scheduler] starting respawn loop after activity detected`);
  }
}

/**
 * Idle-aware syncSpawns executor
 */
function idleAwareSyncSpawns() {
  const status = idlePoolCloser.getStatus();
  
  if (status.enabled) {
    const isIdle = status.idleMs >= (status.idleCloseMinutes * 60 * 1000);
    if (isIdle) {
      console.log('[idle-scheduler] skipping syncSpawns due to idle state');
      return;
    }
  }
  
  syncSpawns().catch(e => {
    console.warn('[idle-scheduler] syncSpawns failed:', e?.message);
  });
}

/**
 * Start the idle-aware scheduler
 */
function startIdleScheduler() {
  if (idleSchedulerTimer) return;
  
  // Start periodic idle check
  idleSchedulerTimer = setInterval(checkIdleAndManageLoops, IDLE_SCHEDULER_CHECK_MS);
  
  // Start idle-aware syncSpawns
  syncSpawnsTimer = setInterval(idleAwareSyncSpawns, SYNC_SPAWNS_INTERVAL_MS);
  
  console.log(`[idle-scheduler] started with ${IDLE_SCHEDULER_CHECK_MS}ms check interval`);
  console.log(`[idle-scheduler] syncSpawns interval: ${SYNC_SPAWNS_INTERVAL_MS}ms`);
}

/**
 * Stop the idle-aware scheduler
 */
function stopIdleScheduler() {
  if (idleSchedulerTimer) {
    clearInterval(idleSchedulerTimer);
    idleSchedulerTimer = null;
  }
  if (syncSpawnsTimer) {
    clearInterval(syncSpawnsTimer);
    syncSpawnsTimer = null;
  }
  console.log('[idle-scheduler] stopped');
}

let server; // http.Server
let wss = null;

// Idle-aware scheduler variables
let respawnRunning = false;
let syncSpawnsTimer = null;
let idleSchedulerTimer = null;

// Semeia o ai-mobs com todas as instâncias vivas do banco
async function seedAIMobsFromDB(aiMobs) {
  try {
    const rows = await all(`
      SELECT mi.id,
             mi.x, mi.y, mi.map_key,
             s.x  AS sx, s.y  AS sy, s.w AS sw, s.h AS sh,
             s."monsterKey" AS monster_key
        FROM monster_instances mi
        JOIN spawns s ON s.id = mi.spawn_id
       WHERE mi.state = 'ALIVE'
    `);
    for (const r of rows) {
      aiMobs.seedPosition({
        id: r.id,
        x: r.x,
        y: r.y,
        mapKey: r.map_key,
        spawnRect: { x: r.sx, y: r.sy, w: r.sw, h: r.sh },
        monsterKey: r.monster_key
      });
    }
    console.log(`[ai-mobs] seeded ${rows.length} alive instances from DB`);
  } catch (e) {
    console.warn('[ai-mobs] seed failed:', e?.message);
  }
}


// ========= START =========
(async () => {
  try {
    if (SKIP_MIGRATIONS_ON_BOOT) {
      console.log('[startup] skipping migrations due to SKIP_MIGRATIONS_ON_BOOT=1');
    } else {
      await migrate();
      await bootstrapContentTables();
      await ensurePlayerOnlineTable(); // <<< presença online
    }

    // Initialize optimization features
    idlePoolCloser.init();

    // Initialize catalog cache
    await catalogCache.warm();

    const shouldRunContentPipeline = CONTENT_PIPELINE !== 'off';
    const shouldGenerateContext = process.env.GEN_CONTEXT_ON_START === '1';

    if (shouldRunContentPipeline) {
      console.log(`[content] pipeline: ${CONTENT_PIPELINE}`);
      await loadAll({ all, get, run }, path.join(__dirname, '..'));
    }
    
    // Garante instâncias (sempre)
    try { await syncSpawns(); } catch (e) { console.warn('[sync_spawns] initial failed:', e?.message); }

    if (!SIMPLE_MODE) {
      // ===== Legacy AI =====
      const aiMobs = require('./combat/ai-mobs');
      aiMobs.start();

      await seedAIMobsFromDB(aiMobs);

      // Mantém spawns atualizados + scheduler
      try { await syncSpawns(); } catch (e) { console.warn('[sync_spawns] initial failed:', e?.message); }
      startIdleScheduler();
      console.log('[combat] LEGACY AI/respawn habilitados');
    } else {
      // ===== SIMPLE MODE =====
      require('./combat/monster_atk_simple').start();
      // Ainda podemos manter o respawn/scheduler se quiser, mas o ataque é do worker simples
      startIdleScheduler();
      console.log('[combat] SIMPLE monster attack mode ENABLED');
    }


    server = http.createServer(app);

    if (useWebSocket) {
      const WebSocketServer = WebSocketLib.Server;
      // Hardening: limita payload do WS
      wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
            // >>>>>>>>>>>>>>> NOVO: helper global para broadcast por mapa <<<<<<<<<<<<<<<
      global._sendToMap = (mapKey, payload) => {
        if (!wss) return;
        const key = String(mapKey || 'house');
        const msg = JSON.stringify(payload);
        wss.clients.forEach((c) => {
          if (c && c.readyState === WebSocketLib.OPEN && c._mapKey === key) {
            try { c.send(msg); } catch {}
          }
        });
      };
      // >>>>>>>>>>>>>>> FIM DO TRECHO NOVO <<<<<<<<<<<<<<<
      attachWsBus(wss);
      setupHeartbeat(wss); // <<< Heartbeat habilitado
      setupRedis(wss).catch(() => {});

      const instanceId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

      wss.on('connection', (ws, req) => {
        // Checagem de Origin (CORS para WS)
        const origin = req.headers.origin || '';
        if (!isOriginAllowed(origin)) {
          try { ws.close(1008, 'origin not allowed'); } catch {}
          return;
        }

        // Track WebSocket activity for idle management
        idlePoolCloser.updateLastRequest();
        
        const addr = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
        console.log(`[ws] connection from ${addr} — clients=${wss.clients.size}`);
        if (NODE_ENV !== 'production') {
          console.log('[ws] cookies header:', req.headers && req.headers.cookie);
        }

        ws._connectedAt = Date.now();
        ws._player = null;
        ws._mapKey = 'house'; // padrão até resolver abaixo
        ws.isAlive = true; // compat com heartbeat
        ws._presenceTimer = null;
        ws._pos = null; // cache local da pos autorizada

        // Tenta validar sessão via cookie JWT
        try {
          const cookies = parseCookies(req.headers.cookie || '');
          const token = cookies[COOKIE_NAME] || null;
          if (token) {
            try {
              const payload = jwt.verify(token, JWT_SECRET);
              ws._player = {
                id: String(payload.id || payload.playerId || ''),
                name: String(payload.name || payload.username || payload.displayName || 'Anon')
              };
              console.log(`[ws] session validated from cookie for ${addr} => id=${ws._player.id} name=${ws._player.name}`);
            } catch (err) {
              console.log('[ws] jwt verify failed', err && err.message);
            }
          }
        } catch (e) {
          console.warn('[ws] cookie parse error', e && e.message);
        }

        // >>> Coloca o socket na sala do mapa do jogador (fallback: 'house') e guarda o mapKey no socket
        (async () => {
          try {
            let mapKey = 'house';
            if (ws._player?.id) {
              const row = await get(
                `SELECT map_key FROM player_last_pos
                   WHERE player_id = $1
                   ORDER BY updated_at DESC
                   LIMIT 1`,
                [ws._player.id]
              );
              if (row?.map_key) mapKey = row.map_key;
            }
            ws._mapKey = mapKey;            // <<< guarda para persistência de /pos
            joinMapSocket(mapKey, ws);
          } catch {
            ws._mapKey = 'house';
            joinMapSocket('house', ws);
          }

          // [MMO] Carrega última posição do DB e envia SNAP inicial; inicializa RAM
          try {
            if (ws._player?.id) {
              const row2 = await get(
                `SELECT x, y FROM player_last_pos WHERE player_id=$1 AND map_key=$2`,
                [ws._player.id, ws._mapKey]
              );
              if (row2 && Number.isFinite(row2.x) && Number.isFinite(row2.y)) {
                const px = row2.x | 0, py = row2.y | 0;
                setLivePlayerPosition(ws._player.id, { x: px, y: py, mapKey: ws._mapKey, ts: Date.now() });
                ws._pos = { x: px, y: py, mapKey: ws._mapKey, ts: Date.now() };
                try { ws.send(JSON.stringify({ type: 'pos_snap', x: px, y: py, mapKey: ws._mapKey })); } catch {}
              }
            }
          } catch (e) {
            // segue sem travar
          }

          // >>> NOVO: marca presença assim que conectar (e renova a cada 15s)
          try {
            if (ws._player?.id) {
              await upsertOnlineByPlayer(ws._player.id, ws._mapKey || 'house');
              ws._presenceTimer = setInterval(() => {
                upsertOnlineByPlayer(ws._player.id, ws._mapKey || 'house').catch(() => {});
              }, 15000);
            }
          } catch {}
        })();

        // snapshot inicial de monstros vivos
        (async () => {
          try {
            const msgs = await listAliveMonsters();
            for (const m of msgs) {
              try { ws.send(JSON.stringify(m)); } catch {}
            }
          } catch (e) {
            console.warn('[ws] init monsters failed:', e?.message);
          }
        })();

        ws.on('message', async (msg) => {
          // Track WebSocket activity for idle management
          idlePoolCloser.updateLastRequest();
          ws.isAlive = true; // marcou atividade

          let data;
          try { data = JSON.parse(msg.toString()); } catch { console.warn('[ws] malformed json from', addr); return; }

          if (data.type === 'auth') {
            ws._player = { id: String(data.id || ''), name: String(data.name || 'Anonymous') };
            try { ws.send(JSON.stringify({ type:'auth_ok', id: ws._player.id })); } catch {}

            // >>> NOVO: reforça presença após auth
            try {
              await upsertOnlineByPlayer(ws._player.id, ws._mapKey || 'house');
              if (!ws._presenceTimer) {
                ws._presenceTimer = setInterval(() => {
                  upsertOnlineByPlayer(ws._player.id, ws._mapKey || 'house').catch(() => {});
                }, 15000);
              }
            } catch {}

            return;
          }

          if (data.type === 'chat') {
            if (!ws._player) {
              try { ws.send(JSON.stringify({ type:'error', message:'not-authenticated' })); } catch {}
              return;
            }
            const scope = String(data.scope || 'global').toLowerCase();
            const raw = String(data.text || '').trim().slice(0, 800);
            if (!raw) return;

            if (scope === 'global') {
              // NOVO: cria payload com id a partir do insert no DB
              const payload = await createChatPayload(ws, raw);
              if (!payload) return;

              // mantém campo 'origin' como antes (útil se usar Redis e quiser dedupe por instância)
              payload.origin = instanceId;

              const outStr = JSON.stringify(payload);

              // Publica no Redis (se estiver configurado) para replicar entre instâncias
              if (redisPub) {
                try { await redisPub.publish('chat:global', outStr); }
                catch (e) { console.warn('[redis] publish failed', e && e.message); }
              }

              // Broadcast local para todos os clientes
              wss.clients.forEach(c => {
                if (c && c.readyState === WebSocketLib.OPEN) {
                  try { c.send(outStr); } catch {}
                }
              });
            }
            return;
          }

          if (data.type === 'pos') {
            // Autoridade de movimento + RAM cache (persistência é batelada pelo flusher)
            const pid = ws._player?.id || String(data.id || '');
            if (!pid) return;

            // >>> BLOQUEIO DE MOVIMENTO PARA HERÓI MORTO (server-authoritative)
            try {
              const activeHeroId = await resolveActiveHeroId(pid);
              if (activeHeroId) {
                const rowAlive = await get(`SELECT alive FROM player_heroes WHERE id=$1`, [activeHeroId]);
                if (rowAlive && rowAlive.alive === false) {
                  // opcional: reforça overlay de morte no cliente
                  try { ws.send(JSON.stringify({ type:'hero_dead', heroId: String(activeHeroId) })); } catch {}
                  return; // morto não move
                }
              }
            } catch {}

            const nx = Number(data.x || 0) | 0;
            const ny = Number(data.y || 0) | 0;
            const mapKey = String(data.mapKey || ws._mapKey || 'house');

            // Base anterior (RAM ou bootstrap)
            if (!ws._pos || ws._pos.mapKey !== mapKey) {
              const prev = getLivePlayerPosition(pid);
              if (prev && prev.mapKey === mapKey) {
                ws._pos = { ...prev };
              } else {
                ws._pos = { x: nx, y: ny, mapKey, ts: Date.now() };
                setLivePlayerPosition(pid, ws._pos);
              }
            }

            const { x: lx, y: ly, ts: lts } = ws._pos;
            const now = Date.now();
            const dt = now - (lts || 0);

            // helpers
            const sameTile = (a, b) => Math.floor(a / TILE) === Math.floor(b / TILE);
            const okAdj = isAdjacentStep(lx, ly, nx, ny);
            const okTime = dt >= MIN_STEP_MS;

            // --- NOVO: se o último ponto não estava quantizado, aceite o 1º passo dentro do MESMO tile
            const tolerateSameTileFirstStep = (!okAdj && sameTile(lx, nx) && sameTile(ly, ny));

            if (!(okAdj && okTime) && !tolerateSameTileFirstStep) {
              try { ws.send(JSON.stringify({ type: 'pos_snap', x: lx, y: ly, mapKey })); } catch {}
              return;
            }

            // Autoriza: atualiza RAM
            ws._pos = { x: nx, y: ny, mapKey, ts: now };
            setLivePlayerPosition(pid, { x: nx, y: ny, mapKey, ts: now });
            ws._mapKey = mapKey;

            // presença online
            try { await upsertOnlineByPlayer(pid, mapKey); } catch {}

            // >>>>>> FAST FLUSH (200ms enquanto estiver se movendo)
            if (!global.__posFastFlush) global.__posFastFlush = new Map(); // pid -> lastWriteMs
            const lastW = global.__posFastFlush.get(String(pid)) || 0;
            const FAST_FLUSH_MS = 200;
            if (now - lastW >= FAST_FLUSH_MS) {
              try { await flushOnePlayerPos(pid); } catch {}
              global.__posFastFlush.set(String(pid), now);
            }


            // broadcast p/ outros jogadores
            const out = { type:'pos', id:String(pid), x: nx, y: ny, name: ws._player?.name || '' };
            wss.clients.forEach(c => {
              if (c !== ws && c.readyState === WebSocketLib.OPEN) {
                try { c.send(JSON.stringify(out)); } catch {}
              }
            });
            return;
          }

        });

        ws.on('pong', () => { ws.isAlive = true; }); // compat extra

        ws.on('close', () => {
          const addr2 = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
          console.log(`[ws] close from ${addr2} — clients=${wss.clients.size}`);
          if (ws._presenceTimer) {
            clearInterval(ws._presenceTimer);
            ws._presenceTimer = null;
          }
          if (ws._player?.id) {
            // flush posição no logout + remove presença
            flushOnePlayerPos(ws._player.id).catch(() => {});
            removeLivePlayerPosition(ws._player.id);
            markOfflineByPlayer(ws._player.id).catch(() => {});
          }
        });

        ws.on('error', (err) => {
          console.warn('[ws] socket error', err && err.message);
        });
      });
    }

    server.listen(PORT, () => {
      console.log(`server listening on ${PORT} ${useWebSocket ? '(ws enabled)' : '(ws disabled)'}`);
      console.log(`> ${NODE_ENV} | http://localhost:${PORT}`);
      
      // Initialize respawn loop based on idle gating status
      const idleStatus = idlePoolCloser.getStatus();
      if (!idleStatus.enabled) {
        // If idle management is disabled, start respawn loop immediately for safety
        startRespawnLoop({ all, run });
        respawnRunning = true;
        console.log('[startup] idle management disabled, starting respawn loop immediately');
      } else {
        // If idle management is enabled, the scheduler will handle respawn loop state
        console.log('[startup] idle management enabled, respawn loop will be managed by scheduler');
      }

      // opcional: inicia cleanup do loot expirado (se existir)
      if (typeof startLootCleanupLoop === 'function') {
        try { startLootCleanupLoop({ run }); } catch {}
      }

      // [MMO] inicia flusher periódico de posições (persistência em lote)
      startPosFlusher();
    });

    // Encerramento limpo (Ctrl+C / kill) com flush completo de posições
    process.on('SIGINT',  async () => {
      try { const ai = require('./combat/ai-mobs'); ai.stop?.(); } catch {}
      try { stopPosFlusher(); await flushAllPlayerPos(); } catch {}
      try { stopRespawnLoop(); } catch {}
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      try { const ai = require('./combat/ai-mobs'); ai.stop?.(); } catch {}
      try { stopPosFlusher(); await flushAllPlayerPos(); } catch {}
      try { stopRespawnLoop(); } catch {}
      process.exit(0);
    });

  } catch (err) {
    console.error('Fatal start error:', err);
    process.exit(1);
  }
})();



/* ========= Chat HTTP API ========= */

// História (cronológico asc)
app.get('/api/chat/global', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit || 100));
    const rows = await all(
      `SELECT id,
              scope,
              fromid   AS "fromId",
              fromname AS "fromName",
              text,
              created_at AS "createdAt"
         FROM chat_messages
        WHERE scope = $1
        ORDER BY id DESC
        LIMIT $2`,
      ['global', limit]
    );
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enviar mensagem (HTTP, opcional — WS já envia em tempo real)
app.post('/api/chat/global', requireAuth, async (req, res) => {
  try {
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Mensagem vazia' });

    await run(
      `INSERT INTO chat_messages (scope, fromid, fromname, text) VALUES ($1, $2, $3, $4)`,
      ['global', req.user.id, req.user.name, text]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
