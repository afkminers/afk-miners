// server/index.js
require('dotenv').config();

const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const sqlite3  = require('sqlite3').verbose();

const { migrate } = require('./models/migrate');
const { cookieParser, requireAuth, requireCsrf, csrfRoute } = require('./auth/middleware');

const authRoutes    = require('./auth/routes');
const playerRoutes  = require('./player/routes');
const gachaRoutes   = require('./gacha/routes');
const catalogRoutes = require('./routes/catalog');

const K = require('./balance/config');
// starter router exporta a função diretamente
const buildStarterRouter = require('./starter/routes');

// ======== Pipeline de Conteúdo (YAML/Tiled) ========
const { loadAll, loadMap } = require('./content/loader');
const CONTENT_PIPELINE = process.env.CONTENT_PIPELINE || 'off'; // off | shadow | on
// ===================================================

// ========= CONFIG =========
const NODE_ENV            = process.env.NODE_ENV || 'development';
const PORT                = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR     = path.join(__dirname, '..', 'client');
const WORKER_TICK_SECONDS = Number(process.env.WORKER_TICK_SECONDS || 3);

// ========= APP =========
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(requireCsrf);

// CSRF token (antes das outras rotas usadas pelo cliente)
app.get('/api/csrf', csrfRoute);

// ========= DB =========
const DB_PATH = path.join(__dirname, 'db', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// helpers DB (promises)
const dbGet = (sql, params=[]) => new Promise((res,rej)=>db.get(sql, params,(e,r)=>e?rej(e):res(r)));
const dbAll = (sql, params=[]) => new Promise((res,rej)=>db.all(sql, params,(e,r)=>e?rej(e):res(r)));
const dbRun = (sql, params=[]) => new Promise((res,rej)=>db.run(sql, params,function(e){e?rej(e):res(this)}));

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
`, (e) => {
  if (e) console.error("[content] bootstrap error:", e.message);
  else console.log("[content] tables ready (bootstrap)");
});
// ---------------------------------------------------------------------------

// ========= ROTAS QUE NÃO PRECISAM DO DB PASSADO =========
app.use('/api/auth',   authRoutes);
app.use('/api',        catalogRoutes);
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha',  requireAuth, gachaRoutes);
app.use('/api/skills', require('./skills/routes'));

// ========= Helpers =========
const SKILLS = new Set(['SWORD','AXE','CLUB','DISTANCE','SHIELD','MAGIC']);

async function resolveSkillType(weaponOrSkill) {
  if (!weaponOrSkill) return null;
  const raw = String(weaponOrSkill);
  const up  = raw.toUpperCase();
  if (SKILLS.has(up)) return up;

  const row = await dbGet(
    `SELECT skill_type FROM weapon_skill_map WHERE LOWER(weapon_type) = LOWER(?)`,
    [raw]
  );
  return row?.skill_type || null;
}

// ========= Rotas de Treino =========
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
    const notes  = JSON.stringify({ heroClass: String(heroClass).toUpperCase() });

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

    res.json({ ok:true, message:'Training started', heroId, skillType });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'erro ao iniciar treino' });
  }
});

trainingRouter.post('/stop', requireAuth, async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ error:'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id=?`, [heroId]);
    if (!t || t.status !== 'RUNNING') return res.json({ ok:true, message:'No active session' });

    const now   = Date.now();
    const last  = Date.parse(t.last_tick_at || t.started_at || new Date(0).toISOString());
    const delta = Math.max(0, Math.floor((now - last)/1000));

    const energyCost = K.ENERGY_PER_MIN_WHEN_TRAINING * (delta/60);
    const newEnergy  = Math.max(0, (t.energy_current || 0) - energyCost);

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

    res.json({ ok:true, message:'Training stopped', processed_seconds: delta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'erro ao parar treino' });
  }
});

trainingRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error:'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id=?`, [heroId]);
    if (!t) return res.json({ status:'IDLE' });

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
        remaining = Math.max(0, need - (skillRow.tries_progress||0));
        pct = Math.floor((skillRow.tries_progress/need) * 100);
      }
    }

    res.json({
      status: t.status,
      hero_id: t.hero_id,
      skill_type: t.skill_type,
      class: (()=>{try{return JSON.parse(t.notes||'{}').heroClass}catch{return null}})(),
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
    res.status(500).json({ error:'erro ao consultar status' });
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

// JSON bruto do mapa (para o render client-side)
app.get('/api/admin/content/map/:key/data', (req, res) => {
  db.get('SELECT dataJSON FROM maps WHERE key=?', [req.params.key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row)   return res.status(404).json({ error: 'map not found' });
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

// >>> ROTA STARTER (agora que db já existe)
app.use('/api/starter', requireAuth, buildStarterRouter(db));

/* ========= PÁGINAS PÚBLICAS =========
   Deixe /, /index.html, /starter.html, /app.html, /house.html acessíveis
   sem exigir auth — a lógica de redirecionamento fica no client (boot.js).
*/
const PUBLIC_PAGES = [
  '/', '/index.html', '/starter.html', '/app.html', '/house.html'
];

app.get(PUBLIC_PAGES, (req, res) => {
  // normaliza para o arquivo dentro de /client
  const file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  res.sendFile(path.join(CLIENT_ROOT_DIR, file));
});

// ========= SERVE CLIENTE (estático)
app.use(express.static(CLIENT_ROOT_DIR));

// ========= SPA fallback (não intercepta assets nem /api)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|map|mp3|wav)$/i.test(req.path)) return next();
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// ========= START =========
(async () => {
  await migrate();

  if (CONTENT_PIPELINE !== 'off') {
    console.log(`[content] pipeline: ${CONTENT_PIPELINE}`);
    await loadAll(db, path.join(__dirname, '..'));
  }

  app.listen(PORT, () => {
    console.log(`> ${NODE_ENV} | http://localhost:${PORT}`);
    console.log(`[training] DB: ${DB_PATH}`);
  });

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
