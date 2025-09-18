// server/combat/ai-mobs.js
// IA dos mobs: targeting com LOS, ataque ativo e I/O mínimo no Postgres.
// - 1 SELECT por mapa por tick (heróis + posições)
// - Grid cache
// - Guard opcional de pressão do pool (configurável)
// - Leash expandido quando em CHASE
// - Logs de ataque quando COMBAT_DEBUG=1
// - Modo DIAGNÓSTICO por ENV (sem inventar dano: continua chamando applyMobHit)

const { all, getPool } = require('../models/db');
const bus = require('../ws/bus');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { applyMobHit } = require('./service');
const { TILE } = require('./geom');
const YAML = require('yaml'); // usa 'yaml' (produção-friendly)
const fs = require('fs');
const path = require('path');

/* ==================== CONFIG por ENV ==================== */
const TICK_MS = Number(process.env.AI_TICK_MS || 350);
const DEFAULT_ATTACK_RANGE = Number(process.env.AI_ATTACK_RANGE || (TILE * 2)); // 64px
const LEASH_MARGIN = Number(process.env.AI_LEASH_MARGIN || 96);                 // +96px em CHASE
const DBG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// Diagnóstico / toggles por ENV
const IGNORE_LOS      = String(process.env.AI_IGNORE_LOS || '').trim() === '1'; // ignora LoS (teste)
const FORCE_RANGE     = Number(process.env.AI_FORCE_RANGE || 0) || 0;           // ex.: 999 (teste)
const HERO_RECENT_S   = Number(process.env.AI_HERO_RECENT_SEC || 0) || 0;       // 0 = sem filtro de recência (fallback)
const POOL_WAIT_MAX   = Number(process.env.AI_POOL_WAIT_MAX || 0) || 0;         // 0 = não pula por fila
const USE_ONLINE      = String(process.env.AI_REQUIRE_ONLINE || '1').trim() === '1'; // usa player_online
const ONLINE_WINDOW_S = Number(process.env.AI_ONLINE_WINDOW_SEC || 20) || 20;   // janela de presença

let timer = null;

// Instâncias vivas em memória
const INST = new Map();

// Caches
const MONSTER_STATS = new Map();      // monsterKey -> { stats, ai }
const GRID_CACHE = new Map();         // mapKey -> { data, cols, rows }
const HEROES_POS_CACHE = new Map();   // mapKey -> { ts, list:[{heroId,x,y}] }
const HERO_CACHE_TTL_MS = 250;        // 0.25s

/* ==================== YAML stats ==================== */
function getMonsterYmlStats(monsterKey) {
  if (MONSTER_STATS.has(monsterKey)) return MONSTER_STATS.get(monsterKey);
  const file = path.resolve(__dirname, `../../data/sprites/monsters/${monsterKey}.yml`);
  try {
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
  } catch (e) {
    if (DBG) console.warn(`[ai-mobs] YAML ausente p/ ${monsterKey} em ${file} — usando valores padrão (só de IA, dano real continua no service).`);
    const ai = {
      aggro_range:160, move_speed:40, chase_speed:60,
      attack_range: DEFAULT_ATTACK_RANGE, attack_cooldown_ms:1200,
      attack_min:4, attack_max:10
    };
    const merged = { ai };
    MONSTER_STATS.set(monsterKey, merged);
    return merged;
  }
}

/* ==================== Helpers ==================== */
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

/* ============ Heróis + posições (gated por presença online com fallback) ============ */
async function getHeroesWithPosByMap(mapKey) {
  const params = [mapKey];

  // 1) Caminho preferido: usar player_online para garantir que é gente conectada de verdade
  if (USE_ONLINE) {
    try {
      params.push(String(ONLINE_WINDOW_S));
      const rows = await all(`
        SELECT po.hero_id::text AS hero_id, plp.x, plp.y
          FROM player_online po
          JOIN player_last_pos plp
            ON plp.player_id::text = po.player_id::text
           AND plp.map_key = po.map_key
          JOIN player_heroes ph
            ON ph.id::text = po.hero_id::text
         WHERE po.map_key = $1
           AND po.last_seen >= now() - ($2::int || ' seconds')::interval
           AND COALESCE(ph.hp, ph.max_hp) > 0
      `, params);
      return rows.map(r => ({ heroId: String(r.hero_id), x: r.x | 0, y: r.y | 0 }));
    } catch (e) {
      // Fallback se a tabela ainda não existir ou der erro
      if (DBG) console.warn('[ai-mobs] presença online indisponível, caindo para fallback:', e?.message || e);
    }
  }

  // 2) Fallback: usar player_last_pos + player_heroes, opcionalmente com recência (HERO_RECENT_S)
  const fbParams = [mapKey];
  let sql = `
    SELECT ph.id AS hero_id, plp.x, plp.y
      FROM player_heroes ph
      JOIN player_last_pos plp
        ON plp.player_id::text = ph."playerId"::text
     WHERE plp.map_key = $1
       AND COALESCE(ph.hp, ph.max_hp) > 0
  `;
  if (HERO_RECENT_S > 0) {
    sql += ` AND plp.updated_at >= now() - ($2 || ' seconds')::interval`;
    fbParams.push(String(HERO_RECENT_S));
  }

  const rows = await all(sql, fbParams).catch((e) => {
    if (DBG) console.warn('[ai-mobs] heróis query falhou:', e?.message || e);
    return [];
  });
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

/* ==================== API externa ==================== */
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
  if (DBG) console.log(`[ai-mobs] seed mob=${id} map=${mapKey} @(${x},${y})`);
}

function forget(id) { INST.delete(String(id)); }

/* ==================== Loop ==================== */
let skippedByPool = 0;

async function tick() {
  // Guard opcional de pressão do pool
  if (POOL_WAIT_MAX > 0) {
    try {
      const p = getPool();
      if (p.waitingCount > POOL_WAIT_MAX) {
        skippedByPool++;
        if (DBG && skippedByPool % 10 === 1) {
          console.warn(`[ai-mobs] tick pulado por pool.waitingCount=${p.waitingCount} (> ${POOL_WAIT_MAX})`);
        }
        return;
      } else {
        skippedByPool = 0;
      }
    } catch { /* ignore */ }
  }

  const dt = TICK_MS / 1000;

  for (const [id, m] of INST.entries()) {
    try {
      // Grid 1x por mapa
      let losGrid;
      try {
        losGrid = await getGridCached(m.mapKey);
      } catch (e) {
        if (DBG) console.warn('[ai-mobs] getGridCached falhou:', e?.message || e);
        continue;
      }

      // Heróis + pos (cache curto)
      const heroes = await getHeroesWithPosByMapCached(m.mapKey);
      if (DBG && heroes.length === 0 && Math.random() < 0.05) {
        console.log(`[ai-mobs] mapa=${m.mapKey} sem heróis visíveis (USE_ONLINE=${USE_ONLINE ? 1:0}, ONLINE_WINDOW_S=${ONLINE_WINDOW_S}, HERO_RECENT_S=${HERO_RECENT_S})`);
      }

      // 1) Targeting
      let targetId = m.targetId;
      let targetPos = null;

      if (targetId) {
        const hp = heroes.find(h => h.heroId === targetId);
        if (!hp || Math.hypot(hp.x - m.x, hp.y - m.y) > m.ai.aggro_range) {
          if (DBG && m.targetId) console.log(`[ai-mobs] LOST target mob=${m.id} -> hero=${m.targetId}`);
          targetId = null;
          targetPos = null;
          m.state = 'IDLE';
          m.aggroUntil = null;
          m.targetId = null;
        } else {
          targetPos = { x: hp.x, y: hp.y };
        }
      }

      if (!targetId && heroes.length) {
        let best = null, bestDist = Infinity;
        for (const h of heroes) {
          const dist = Math.hypot(h.x - m.x, h.y - m.y);
          if (dist > m.ai.aggro_range) continue;
          if (!IGNORE_LOS && !hasLineOfSight(losGrid, m.x, m.y, h.x, h.y)) continue;
          if (dist < bestDist) { bestDist = dist; best = h; }
        }
        if (best) {
          targetId = best.heroId;
          targetPos = { x: best.x, y: best.y };
          m.state = 'AGRO';
          m.aggroUntil = Date.now() + 4000;
          m.targetId = targetId;
          if (DBG) console.log(`[ai-mobs] ACQUIRE mob=${m.id} -> hero=${targetId} dist=${Math.hypot(best.x-m.x,best.y-m.y)|0}`);
        }
      }

      // 2) Movimento (leash expandido em CHASE)
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
        const baseRange = FORCE_RANGE > 0 ? FORCE_RANGE : m.ai.attack_range;
        const inRange = Math.hypot(targetPos.x - m.x, targetPos.y - m.y) <= baseRange;
        if (inRange && (Date.now() - (m.lastAttackAt || 0) > m.ai.attack_cooldown_ms)) {
          if (IGNORE_LOS || hasLineOfSight(losGrid, m.x, m.y, targetPos.x, targetPos.y)) {
            if (DBG) console.log(`[ai-mobs] ATTEMPT mob=${m.id} -> hero=${targetId} range=${baseRange}`);
            try {
              const result = await applyMobHit({
                attackerInstanceId: m.id,
                targetHeroId: targetId,
                attackInfo: { min: m.ai.attack_min, max: m.ai.attack_max } // dano real é validado no service
              });
              if (DBG) console.log('[ai-mobs] HIT result:', result);
            } catch (e) {
              if (DBG) console.log('[ai-mobs] HIT error:', e?.message);
            }
            m.lastAttackAt = Date.now();
          } else if (DBG && Math.random() < 0.05) {
            console.log(`[ai-mobs] LOS BLOCKED mob=${m.id} -> hero=${targetId}`);
          }
        }
      }
    } catch (e) {
      if (DBG) console.warn('[ai-mobs] erro no mob loop:', e?.message || e);
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  console.log(`[ai-mobs] started (tick=${TICK_MS}ms; targeting/agro/attack; USE_ONLINE=${USE_ONLINE ? 1:0}; ONLINE_WINDOW_S=${ONLINE_WINDOW_S}; HERO_RECENT_S=${HERO_RECENT_S}; IGNORE_LOS=${IGNORE_LOS ? 1:0}; POOL_WAIT_MAX=${POOL_WAIT_MAX})`);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  console.log('[ai-mobs] stopped');
}

module.exports = { start, stop, seedPosition, forget };
