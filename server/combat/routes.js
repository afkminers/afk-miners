// server/combat/routes.js
// Endpoints do combate: /attack/start, /attack/stop, /hit
// Proteção por auth vem do index.js (app.use('/api/combat', requireAuth, router))

const express = require('express');
const router = express.Router();

// ===== Config: em dev, permitir criar monstros "efêmeros" se não achar no DB =====
const ALLOW_EPHEMERAL_IF_NOT_FOUND = true;

// ---- LOG: toda request que chega aqui (ajuda a diagnosticar 404/401/403) ----
router.use((req, _res, next) => {
  console.log(`[combat] ${req.method} ${req.originalUrl}`);
  next();
});

// ---- DEBUG: health check e lista de rotas ----
router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));
router.get('/_routes', (_req, res) => {
  const list = (router.stack || [])
    .filter(l => l.route)
    .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods || {}) }));
  res.json({ routes: list });
});

// ==== Dependências de DB (opcionais) ====
let db = null;
try { db = require('../models/db'); } catch { /* ok em dev */ }

// ====== In-memory fallback ======
const InMem = {
  monsters: new Map(),   // id => { id, x, y, key, hp, hpMax }
  attacks: new Map(),    // playerId => { targetId, ts }
};

function ensureDemo() {
  if (InMem.monsters.size > 0) return;
  InMem.monsters.set('demo-1', { id:'demo-1', x: 8*32,  y: 6*32,  key:'goblin',  hp:100, hpMax:100 });
  InMem.monsters.set('demo-2', { id:'demo-2', x:12*32,  y:10*32,  key:'skeleton',hp:80,  hpMax:80  });
}
ensureDemo();

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

async function tableExists(name) {
  if (!db || !db.get) return false;
  // Postgres
  try {
    const row = await db.get(`SELECT to_regclass($1)::text AS t`, [name]);
    if (row && row.t) return true;
  } catch {}
  // SQLite
  try {
    const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
    return !!row;
  } catch {}
  return false;
}

// ----------- Helpers DB com fallback de colunas -----------
async function tryGetMonsterWith(selectSql, params) {
  try { return await db.get(selectSql, params); } catch { return null; }
}
async function tryRun(sql, params) {
  try { await db.run(sql, params); return true; } catch { return false; }
}

// ----------- GET MONSTER (sem depender de nomes específicos) -----------
async function getMonster(instanceId) {
  const id = String(instanceId);
  if (db && db.get && await tableExists('monster_instances')) {
    // Tenta várias variações de schema
    const tries = [
      `SELECT id, x, y, hp, COALESCE(hp_max, 100)          AS "hpMax" FROM monster_instances WHERE id = $1`, // snake_case
      `SELECT id, x, y, hp, COALESCE("hpMax", 100)         AS "hpMax" FROM monster_instances WHERE id = $1`, // camelCase
      `SELECT id, x, y, hp, COALESCE(hpmax, 100)           AS "hpMax" FROM monster_instances WHERE id = $1`, // plain
      `SELECT id, x, y, hp, 100                            AS "hpMax" FROM monster_instances WHERE id = $1`, // sem coluna
    ];
    for (const sql of tries) {
      const row = await tryGetMonsterWith(sql, [id]);
      if (row) {
        return {
          id: String(row.id),
          x: row.x | 0,
          y: row.y | 0,
          hp: row.hp ?? row.hpMax ?? 100,
          hpMax: row.hpMax ?? 100,
          key: null
        };
      }
    }
  }
  // Fallback memória
  ensureDemo();
  const mem = InMem.monsters.get(id);
  if (mem) return mem;

  // Opcional dev: se não achou, cria placeholder efêmero p/ não travar o fluxo
  if (ALLOW_EPHEMERAL_IF_NOT_FOUND) {
    const phantom = { id, x:0, y:0, key:null, hp:100, hpMax:100 };
    InMem.monsters.set(id, phantom);
    return phantom;
  }

  return null;
}

async function saveMonsterHp(instanceId, newHp) {
  const id = String(instanceId);
  if (db && db.run && await tableExists('monster_instances')) {
    // Fallback de colunas aqui não é necessário porque só atualizamos hp
    const ok = await tryRun(`UPDATE monster_instances SET hp = $1 WHERE id = $2`, [newHp, id]);
    if (ok) return true;
  }
  ensureDemo();
  const m = InMem.monsters.get(id);
  if (m) { m.hp = newHp; InMem.monsters.set(id, m); return true; }
  return false;
}

// ====== ENDPOINTS ======

// Inicia auto-ataque
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const playerId = req.user?.id || 'dev-player';
    const { targetInstanceId } = req.body || {};
    if (!targetInstanceId) return res.status(400).json({ ok:false, error:'targetInstanceId required' });

    const target = await getMonster(targetInstanceId);
    if (!target) return res.status(404).json({ ok:false, error:'target not found' });

    InMem.attacks.set(playerId, { targetId: String(targetInstanceId), ts: Date.now() });
    return res.json({ ok:true, target:{ id: String(targetInstanceId) } });
  } catch (e) {
    console.error('[combat] /attack/start', e);
    res.status(500).json({ ok:false, error:'internal' });
  }
});

// Para auto-ataque
router.post('/attack/stop', express.json(), async (req, res) => {
  try {
    const playerId = req.user?.id || 'dev-player';
    InMem.attacks.delete(playerId);
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/stop', e);
    res.status(500).json({ ok:false, error:'internal' });
  }
});

// Aplica um hit
router.post('/hit', express.json(), async (req, res) => {
  try {
    const { targetInstanceId, damage } = req.body || {};
    if (!targetInstanceId) return res.status(400).json({ ok:false, error:'targetInstanceId required' });
    const dmg = Math.max(1, Math.floor(+damage || 5));

    const m = await getMonster(targetInstanceId);
    if (!m) return res.status(404).json({ ok:false, error:'target not found' });

    const hpMax = m.hpMax || 100;
    const hpBefore = clamp(m.hp ?? hpMax, 0, hpMax);
    const hpAfter  = clamp(hpBefore - dmg, 0, hpMax);
    await saveMonsterHp(targetInstanceId, hpAfter);

    res.json({ ok:true, targetId:String(targetInstanceId), damage:dmg, hpBefore, hpAfter, dead: hpAfter <= 0 });
  } catch (e) {
    console.error('[combat] /hit', e);
    res.status(500).json({ ok:false, error:'internal' });
  }
});

module.exports = router;
