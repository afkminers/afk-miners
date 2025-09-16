// server/combat/ai-mobs.js
// IA dos mobs: targeting com LOS, ataque ativo e I/O mínimo no Postgres.
// - 1 SELECT por mapa por tick (heróis + posições) — SOMENTE posições recentes
// - Grid cache
// - Guard de pressão do pool (evita derrubar login/respawn)
// - Leash expandido quando em CHASE (evita "orbitar" na borda do spawn)
// - Logs de ataque quando COMBAT_DEBUG=1
// - Keep-alive opcional do Postgres (evita fechar pool por ociosidade)

const { all, getPool } = require('../models/db');
const bus = require('../ws/bus');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { applyMobHit } = require('./service');
const { TILE } = require('./geom');
const YAML = require('yaml');
const fs = require('fs');
const path = require('path');

const TICK_MS = Number(process.env.AI_TICK_MS || 350);
const DEFAULT_ATTACK_RANGE = Number(process.env.AI_ATTACK_RANGE || (TILE * 2)); // 64px
const LEASH_MARGIN = Number(process.env.AI_LEASH_MARGIN || 96);                 // +96px em CHASE
const ACTIVE_WINDOW_SEC = Number(process.env.AI_ACTIVE_WINDOW_SEC || 120);      // posição "recente"
const DBG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// Keep-alive do Postgres (0 = desliga). Padrão 240s.
const KEEPALIVE_MS = Number(process.env.DB_KEEPALIVE_MS || 240_000);

let timer = null;
let keepAlive = null;

// Instâncias vivas em memória
const INST = new Map();

// Caches
const MONSTER_STATS = new Map();      // monsterKey -> { stats, ai }
const GRID_CACHE = new Map();         // mapKey -> { data, cols, rows }
const HEROES_POS_CACHE = new Map();   // mapKey -> { ts, list:[{heroId,x,y}] }
const HERO_CACHE_TTL_MS = 250;        // 0.25s

// ===== YAML stats =====
function getMonsterYmlStats(monsterKey) {
  if (MONSTER_STATS.has(monsterKey)) return MONSTER_STATS.get(monsterKey);
  try {
    const file = path.resolve(__dirname, `../../data/sprites/monsters/${monsterKey}.yml`);
    const yml = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
    const stats = yml.stats || {};
    const ai = {
      aggro_range:        stats.aggro_range ?? 160,
      move_speed:         stats.move_speed ?? 40,
      chase_speed:        stats.chase_speed ?? 60,
      attack_range:       stats.attack_range ?? DEFAULT_ATTACK_RANGE,
      attack_cooldown_ms: stats.attack_cooldown_ms ?? 1200,
      attack_min:         stats.attack_min ?? 4,
      attack_max:         stats.attack_max ?? 10,
    };
    const merged = { ...stats, ai };
    MONSTER_STATS.set(monsterKey, merged);
    return merged;
  } catch {
    const ai = {
      aggro_range:160, move_speed:40, chase_speed:60,
      attack_range: DEFAULT_ATTACK_RANGE, attack_cooldown_ms:1200,
      attack_min:4, attack_max:10
    };
    return { ai };
  }
}

// ===== Helpers =====
function clampToRect(x, y, r) {
  const cx = Math.min(Math.max(x, r.x), r.x + r.w);
  const cy = Math.min(Math.max(y, r.y), r.y + r.h);
  return { x: cx, y: cy };
}
function expandRect(r, margin) {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 };
}

async function getGridCached(mapKey) {
  if (GRID_CACHE.has(mapKey)) return GRID_CACHE.get(mapKey);
  const { grid, cols, rows } = await getGrid(mapKey);
  const losGrid = { data: grid, cols, rows };
  GRID_CACHE.set(mapKey, losGrid);
  return losGrid;
}

// ===== 1 SELECT por mapa: heróis + posições (APENAS recentes) =====
// Observação: "playerId" é camelCase em player_heroes.
async function getHeroesWithPosByMap(mapKey) {
  const rows = await all(
    `SELECT ph.id AS hero_id, plp.x, plp.y
       FROM player_heroes ph
       JOIN player_last_pos plp
         ON plp.player_id::text = ph."playerId"::text
      WHERE plp.map_key = $1
        AND plp.updated_at >= now() - ($2 || ' seconds')::interval
        AND COALESCE(ph.hp, ph.max_hp) > 0`,
    [mapKey, String(ACTIVE_WINDOW_SEC)]
  ).catch(() => []);
  return rows.map(r => ({ heroId: String(r.hero_id), x: r.x | 0, y: r.y | 0 }));
}

async function getHeroesWithPosByMapCached(mapKey) {
  const now = Date.now();
  const c = HEROES_POS_CACHE.get(mapKey);
  if (c && (now - c.ts) <= HERO_CACHE_TTL_MS) return c.list;
  const list = await getHeroesWithPosByMap(mapKey);
  HEROES_POS_CACHE.set(mapKey, { ts: now, list });
  return list;
}

// ===== API externa =====
function seedPosition({ id, x, y, mapKey, spawnRect, monsterKey }) {
  const sr = (spawnRect && Number.isFinite(spawnRect.w) && Number.isFinite(spawnRect.h))
    ? { x: Number(spawnRect.x)||0, y: Number(spawnRect.y)||0, w: Number(spawnRect.w), h: Number(spawnRect.h) }
    : { x: Math.max(0,(Number(x)||0)-48), y: Math.max(0,(Number(y)||0)-48), w:96, h:96 };

  const stats = getMonsterYmlStats(monsterKey);
  INST.set(String(id), {
    id: String(id),
    x: Math.round(Number(x)||0),
    y: Math.round(Number(y)||0),
    mapKey: String(mapKey||'house'),
    spawnRect: sr,
    state: 'IDLE',
    targetId: null,
    aggroUntil: null,
    monsterKey,
    lastAttackAt: 0,
    ...stats
  });
}

function forget(id) { INST.delete(String(id)); }

// ===== Loop =====
async function tick() {
  // Guard de pressão do pool — se tem fila, pula o tick inteiro
  try {
    const p = getPool();
    if (p.waitingCount > 0) return;
  } catch { /* ignore */ }

  const dt = TICK_MS / 1000;

  for (const [id, m] of INST.entries()) {
    try {
      // Grid 1x por mapa
      let losGrid;
      try {
        losGrid = await getGridCached(m.mapKey);
      } catch {
        continue; // DB indisponível: pula este mob
      }

      // Lista de heróis + posições (cache curto)
      const heroes = await getHeroesWithPosByMapCached(m.mapKey);

      // 1) Targeting
      let targetId = m.targetId;
      let targetPos = null;

      if (targetId) {
        const hp = heroes.find(h => h.heroId === targetId);
        if (!hp || Math.hypot(hp.x - m.x, hp.y - m.y) > m.ai.aggro_range) {
          targetId = null;
          targetPos = null;
          m.state = 'IDLE';
          m.aggroUntil = null;
          m.targetId = null;
        } else {
          targetPos = { x: hp.x, y: hp.y };
        }
      }

      if (!targetId) {
        let best = null, bestDist = Infinity;
        for (const h of heroes) {
          const dist = Math.hypot(h.x - m.x, h.y - m.y);
          if (dist > m.ai.aggro_range) continue;
          if (!hasLineOfSight(losGrid, m.x, m.y, h.x, h.y)) continue;
          if (dist < bestDist) { bestDist = dist; best = h; }
        }
        if (best) {
          targetId = best.heroId;
          targetPos = { x: best.x, y: best.y };
          m.state = 'AGRO';
          m.aggroUntil = Date.now() + 4000;
          m.targetId = targetId;
        }
      }

      // 2) Movimento (com leash expandido em CHASE)
      let dx = 0, dy = 0, speed = m.ai.move_speed;
      let clampRect = m.spawnRect;

      if (targetId && targetPos) {
        m.state = 'CHASE';
        speed = m.ai.chase_speed;
        clampRect = expandRect(m.spawnRect, LEASH_MARGIN);
        const dist = Math.hypot(targetPos.x - m.x, targetPos.y - m.y);
        dx = (targetPos.x - m.x) / (dist || 1);
        dy = (targetPos.y - m.y) / (dist || 1);
      } else {
        if (!m._wanderAngle || Math.random() < 0.05) m._wanderAngle = Math.random() * Math.PI * 2;
        dx = Math.cos(m._wanderAngle);
        dy = Math.sin(m._wanderAngle);
      }

      let nx = m.x + dx * speed * dt;
      let ny = m.y + dy * speed * dt;
      const cl = clampToRect(nx, ny, clampRect);
      m.x = Math.round(cl.x);
      m.y = Math.round(cl.y);
      INST.set(id, m);

      bus.broadcast({ type:'monster_move', id:String(id), x:m.x, y:m.y, state:m.state, target:m.targetId });

      // 3) Ataque
      if (targetId && targetPos) {
        const inRange = Math.hypot(targetPos.x - m.x, targetPos.y - m.y) <= m.ai.attack_range;
        if (inRange && (Date.now() - (m.lastAttackAt || 0) > m.ai.attack_cooldown_ms)) {
          if (hasLineOfSight(losGrid, m.x, m.y, targetPos.x, targetPos.y)) {
            if (DBG) console.log(`[ai-mobs] ATTEMPT mob=${m.id} -> hero=${targetId} range=${m.ai.attack_range}`);
            try {
              const result = await applyMobHit({
                attackerInstanceId: m.id,
                targetHeroId: targetId,
                attackInfo: { min: m.ai.attack_min, max: m.ai.attack_max }
              });
              if (DBG) console.log('[ai-mobs] HIT result:', result);
            } catch (e) {
              if (DBG) console.log('[ai-mobs] HIT error:', e?.message);
            }
            m.lastAttackAt = Date.now();
          }
        }
      }
    } catch {
      // erro em 1 mob não derruba o loop
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  if (!keepAlive && KEEPALIVE_MS > 0) {
    // evita o idle-pool fechar o Postgres e parar a IA
    keepAlive = setInterval(() => {
      all('SELECT 1').catch(() => {});
    }, KEEPALIVE_MS);
  }
  console.log(`[ai-mobs] started (tick=${TICK_MS}ms; targeting/agro/attack)`);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
  console.log('[ai-mobs] stopped');
}

module.exports = { start, stop, seedPosition, forget };
