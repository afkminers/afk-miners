// index.js (unificado)
// Mantém: auth/CSRF, rotas existentes, static SPA, migrate
// Adiciona: /api/training (start/stop/status) + worker + endpoints de debug de treino

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
const teamRoutes = require('./team/routes');

// ========= CONFIG =========
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ROOT_DIR = path.join(__dirname, '..', 'client');

// Ritmo/limites do sistema de treino (ajuste no .env se quiser)
const TRIES_PER_MINUTE_BASE = Number(process.env.TRIES_PER_MINUTE_BASE || 60);
const WORKER_TICK_SECONDS   = Number(process.env.WORKER_TICK_SECONDS   || 60);
const MAX_SESSION_SECONDS   = Number(process.env.MAX_SESSION_SECONDS   || 12 * 3600);
const DEFAULT_START_LEVEL   = Number(process.env.DEFAULT_START_LEVEL   || 1);

// ========= APP =========
const app = express();

// middlewares
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(requireCsrf);

// estático
app.use(express.static(CLIENT_ROOT_DIR));

// CSRF token
app.get('/api/csrf', csrfRoute);

// rotas existentes
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/gacha', requireAuth, gachaRoutes);
app.use('/api/team', requireAuth, teamRoutes);

// skills (suas rotas já existentes — mantidas)
app.use('/api/skills', require('./skills/routes'));

// ========= DB (treino) =========
const DB_PATH = path.join(__dirname, 'db', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// helpers async
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));

// set de tipos válidos
const SKILLS = new Set(['SWORD', 'AXE', 'CLUB', 'DISTANCE', 'SHIELD', 'MAGIC']);

// ========= Funções de domínio (treino) =========
async function resolveSkillType(weaponOrSkill) {
  if (!weaponOrSkill) return null;
  const raw = String(weaponOrSkill);
  const up = raw.toUpperCase();
  if (SKILLS.has(up)) return up;

  const row = await dbGet(
    `SELECT skill_type FROM weapon_skill_map WHERE LOWER(weapon) = LOWER(?)`,
    [raw]
  );
  return row?.skill_type || null;
}

async function getClassRate(heroClass, skillType) {
  if (!heroClass) return 1.0;
  const row = await dbGet(
    `SELECT rate FROM class_skill_rates WHERE class = ? AND skill_type = ?`,
    [String(heroClass).toUpperCase(), skillType]
  );
  return row?.rate ?? 1.0;
}

async function ensureSkillRow(heroId, skillType) {
  const row = await dbGet(
    `SELECT hero_id, skill_type FROM player_hero_skills WHERE hero_id = ? AND skill_type = ?`,
    [heroId, skillType]
  );
  if (!row) {
    await dbRun(
      `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress) VALUES (?, ?, ?, 0)`,
      [heroId, skillType, DEFAULT_START_LEVEL]
    );
  }
}

async function getSkillState(heroId, skillType) {
  return await dbGet(
    `SELECT level, tries_progress FROM player_hero_skills WHERE hero_id = ? AND skill_type = ?`,
    [heroId, skillType]
  );
}

async function setSkillState(heroId, skillType, level, triesProgress) {
  await dbRun(
    `UPDATE player_hero_skills SET level = ?, tries_progress = ? WHERE hero_id = ? AND skill_type = ?`,
    [level, triesProgress, heroId, skillType]
  );
}

async function triesNeeded(skillType, level) {
  const row = await dbGet(
    `SELECT tries_needed FROM skill_curves WHERE skill_type = ? AND level = ?`,
    [skillType, level]
  );
  return row ? row.tries_needed : null; // null = cap
}

async function applyTries(heroId, skillType, triesToApply) {
  if (triesToApply <= 0) return { leveled: 0 };

  await ensureSkillRow(heroId, skillType);
  let { level, tries_progress } = await getSkillState(heroId, skillType);
  let remaining = triesToApply;
  let leveled = 0;

  while (remaining > 0) {
    const need = await triesNeeded(skillType, level);
    if (need == null) break; // cap
    const missing = need - tries_progress;

    if (remaining >= missing) {
      level += 1;
      tries_progress = 0;
      remaining -= missing;
      leveled += 1;
    } else {
      tries_progress += remaining;
      remaining = 0;
    }
  }

  await setSkillState(heroId, skillType, level, tries_progress);
  return { leveled };
}

async function processTrainingSlice({ heroId, skillType, heroClass, seconds }) {
  if (seconds <= 0) return { appliedTries: 0, leveled: 0 };

  const rate = await getClassRate(heroClass, skillType);
  const triesPerMinute = TRIES_PER_MINUTE_BASE * rate;
  const triesToApply = (triesPerMinute / 60) * seconds;

  const { leveled } = await applyTries(heroId, skillType, triesToApply);
  return { appliedTries: triesToApply, leveled };
}

// ========= Rotas de Treino =========
// Nota: coloquei requireAuth para seguir seu padrão de proteger rotas de jogo
const trainingRouter = express.Router();

// Iniciar treino
trainingRouter.post('/start', requireAuth, async (req, res) => {
  try {
    const { heroId, weaponOrSkill, heroClass } = req.body || {};
    if (!heroId || !weaponOrSkill || !heroClass) {
      return res.status(400).json({ error: 'heroId, weaponOrSkill e heroClass são obrigatórios' });
    }

    const skillType = await resolveSkillType(weaponOrSkill);
    if (!skillType) return res.status(400).json({ error: 'weaponOrSkill inválido' });

    await ensureSkillRow(heroId, skillType);

    const nowIso = new Date().toISOString();
    const notes = JSON.stringify({ heroClass: String(heroClass).toUpperCase() });

    const existing = await dbGet(`SELECT rowid as id, status FROM hero_training WHERE hero_id = ?`, [heroId]);
    if (existing) {
      await dbRun(
        `UPDATE hero_training
           SET skill_type = ?, status = 'RUNNING', last_tick_at = ?, notes = ?, session_seconds = COALESCE(session_seconds,0)
         WHERE hero_id = ?`,
        [skillType, nowIso, notes, heroId]
      );
    } else {
      await dbRun(
        `INSERT INTO hero_training (hero_id, skill_type, status, started_at, last_tick_at, energy_spent, session_seconds, notes)
         VALUES (?, ?, 'RUNNING', ?, ?, 0, 0, ?)`,
        [heroId, skillType, nowIso, nowIso, notes]
      );
    }

    res.json({ ok: true, message: 'Treino iniciado', heroId, skillType, heroClass: String(heroClass).toUpperCase() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao iniciar treino' });
  }
});

// Parar treino (processa pendente)
trainingRouter.post('/stop', requireAuth, async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id = ?`, [heroId]);
    if (!t || t.status !== 'RUNNING') return res.json({ ok: true, message: 'Nenhuma sessão ativa' });

    const now = Date.now();
    const last = Date.parse(t.last_tick_at || t.started_at);
    let delta = Math.max(0, Math.floor((now - last) / 1000));

    const sess = Number(t.session_seconds || 0);
    const allowed = Math.max(0, Math.min(delta, MAX_SESSION_SECONDS - sess));

    let heroClass = null;
    try { heroClass = JSON.parse(t.notes || '{}').heroClass; } catch {}

    if (allowed > 0) {
      await processTrainingSlice({
        heroId: t.hero_id,
        skillType: t.skill_type,
        heroClass,
        seconds: allowed
      });
    }

    await dbRun(
      `UPDATE hero_training SET status = 'STOPPED', last_tick_at = ?, session_seconds = ?, notes = ? WHERE hero_id = ?`,
      [new Date(now - (delta - allowed) * 1000).toISOString(), sess + allowed, t.notes, heroId]
    );

    res.json({ ok: true, message: 'Treino parado', processed_seconds: allowed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao parar treino' });
  }
});

// Status + ETA para próximo nível
trainingRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    const t = await dbGet(`SELECT * FROM hero_training WHERE hero_id = ?`, [heroId]);
    if (!t) return res.json({ status: 'IDLE' });

    const skill = await getSkillState(heroId, t.skill_type);
    if (!skill) return res.json({ status: t.status, detail: 'sem registro em player_hero_skills' });

    const need = await triesNeeded(t.skill_type, skill.level);
    let next = null;
    if (need != null) {
      const remaining = Math.max(0, need - skill.tries_progress);
      let heroClass = null;
      try { heroClass = JSON.parse(t.notes || '{}').heroClass; } catch {}
      const rate = await getClassRate(heroClass, t.skill_type);
      const triesPerMinute = TRIES_PER_MINUTE_BASE * rate;
      const minutes = triesPerMinute > 0 ? remaining / triesPerMinute : null;
      next = {
        remaining_tries: remaining,
        eta_minutes_at_current_rate: minutes != null ? Math.ceil(minutes) : null
      };
    }

    res.json({
      status: t.status,
      skill_type: t.skill_type,
      hero_id: t.hero_id,
      class: (() => { try { return JSON.parse(t.notes || '{}').heroClass; } catch { return null; } })(),
      level: skill.level,
      tries_progress: skill.tries_progress,
      session_seconds: t.session_seconds,
      started_at: t.started_at,
      last_tick_at: t.last_tick_at,
      next
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao consultar status' });
  }
});

// Endpoints de debug do treino (prefixo /api/training/debug para não colidir com /api/skills existente)
trainingRouter.get('/debug/curves', requireAuth, async (req, res) => {
  try {
    const skill = (req.query.skill || '').toUpperCase();
    if (!skill || !SKILLS.has(skill)) return res.status(400).json({ error: 'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC' });
    const rows = await dbAll(`SELECT level, tries_needed FROM skill_curves WHERE skill_type = ? ORDER BY level`, [skill]);
    res.json({ skill_type: skill, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao listar curvas' });
  }
});

trainingRouter.get('/debug/class-rates', requireAuth, async (req, res) => {
  try {
    const rows = await dbAll(`SELECT class, skill_type, rate FROM class_skill_rates ORDER BY class, skill_type`, []);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao listar rates' });
  }
});

trainingRouter.get('/debug/me', requireAuth, async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });
    const rows = await dbAll(
      `SELECT skill_type, level, tries_progress FROM player_hero_skills WHERE hero_id = ? ORDER BY skill_type`,
      [heroId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'erro ao listar skills do herói' });
  }
});

app.use('/api/training', trainingRouter);

// ========= WORKER =========
async function trainingTick() {
  try {
    const running = await dbAll(`SELECT * FROM hero_training WHERE status = 'RUNNING'`, []);
    const now = Date.now();

    for (const t of running) {
      const last = Date.parse(t.last_tick_at || t.started_at);
      let delta = Math.max(0, Math.floor((now - last) / 1000));
      if (delta <= 0) continue;

      const sess = Number(t.session_seconds || 0);
      const allowed = Math.max(0, Math.min(delta, MAX_SESSION_SECONDS - sess));
      if (allowed <= 0) {
        await dbRun(`UPDATE hero_training SET status = 'STOPPED', last_tick_at = ? WHERE hero_id = ?`,
          [new Date(last).toISOString(), t.hero_id]);
        continue;
      }

      let heroClass = null;
      try { heroClass = JSON.parse(t.notes || '{}').heroClass; } catch {}

      await processTrainingSlice({
        heroId: t.hero_id,
        skillType: t.skill_type,
        heroClass,
        seconds: allowed
      });

      const newLast = new Date(last + allowed * 1000).toISOString();
      await dbRun(
        `UPDATE hero_training
           SET last_tick_at = ?, session_seconds = COALESCE(session_seconds,0) + ?
         WHERE hero_id = ?`,
        [newLast, allowed, t.hero_id]
      );
    }
  } catch (err) {
    console.error('[worker] erro no tick:', err.message);
  }
}

// ========= SPA fallback =========
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(CLIENT_ROOT_DIR, 'index.html'));
});

// ========= START =========
(async () => {
  await migrate(); // mantém sua migração
  app.listen(PORT, () => {
    console.log(`> ${NODE_ENV} | http://localhost:${PORT}`);
    console.log(`[training] DB: ${DB_PATH}`);
  });
  // inicia o worker após o servidor subir
  setInterval(trainingTick, WORKER_TICK_SECONDS * 1000);
})();
