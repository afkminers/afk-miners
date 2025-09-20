// server/combat/ai-mobs.js
// IA server-authoritative estilo Tibia/Ragnarok:
// - Capta alvos via player_online (presença real) + player_last_pos (última posição conhecida).
// - Threat/Agro com decaimento + histerese (troca de alvo “natural” entre heróis).
// - Chase cardinal com colisão no servidor.
// - Ataque com alcance (tiles) + LOS (Bresenham).
// - Sem targeting.js e sem dependências no cliente.

const K = require('../balance/config');
const { all, run } = require('../models/db');
const { getGrid } = require('../maps/grid');
const { hasLineOfSight } = require('./los');
const { inReachPx } = require('./geom');
const { applyMobHit } = require('./service');
let broadcast = () => {};
try {
  // se existir, usamos para notificar clientes da posição do mob
  ({ broadcast } = require('../ws/bus'));
} catch {}

// --------- Tuning ----------
const TICK_MS = 100;                  // 10 tps
const STEP_PX = 32;                   // 1 tile
const CHASE_SPEED_PX_S = 90;          // px/s
const REPATH_MS = 500;                // recálculo de direção
const GIVEUP_MS = 8000;               // desiste se perder o alvo por muito tempo
const ONLINE_RECENT_MS = 20000;       // presença considerada “viva” nos últimos 20s

// Threat / Aggro
const AGGRO_TILES = Number(K.AGGRO_TILES ?? 8); // raio de captação em tiles
const THREAT_ON_SIGHT = 2.5;                    // ganho por tick quando vê
const THREAT_ON_HIT   = 7;                      // ganho quando herói bate no mob
const THREAT_DECAY    = 0.9;                    // decaimento por segundo
const SWITCH_HYSTERESIS = 5;                    // delta para trocar de alvo
const DEBUG_AI = process.env.AI_MOBS_DEBUG === '1';

// --------- Estado ----------
const mobs = new Map(); // instanceId -> state
let loopTimer = null;
let lastTickAt = 0;

// --------- DB helpers ----------
async function fetchAliveMonsters() {
  return (await all(`
    SELECT id, map_key, x, y
      FROM monster_instances
     WHERE state = 'ALIVE' AND hp > 0
  `)) || [];
}

// 💡 Usa player_online (presença real) + última posição daquele player no mesmo mapa.
//    **Filtra só heróis VIVOS (hp > 0)** para não mirar em morto.
async function fetchOnlineHeroesInMap(mapKey) {
  return await all(`
    SELECT po.player_id::text                AS player_id,
           ph.id::text                       AS hero_id,
           plp.x|0                           AS x,
           plp.y|0                           AS y
      FROM player_online po
      JOIN LATERAL (
        SELECT id, hp
          FROM player_heroes
         WHERE "playerId"::text = po.player_id::text
           AND hp > 0                  -- <<<<<< só vivo
         ORDER BY id
         LIMIT 1
      ) ph ON TRUE
      JOIN player_last_pos plp
        ON plp.player_id::text = po.player_id::text
       AND plp.map_key = $1
     WHERE po.map_key = $1
       AND po.last_seen >= NOW() - ($2 || ' milliseconds')::interval
  `, [mapKey, String(ONLINE_RECENT_MS)]);
}


// --------- State helpers ----------
function ensureMob(instanceId, patch = {}) {
  const id = String(instanceId);
  const cur = mobs.get(id) || {};
  const next = {
    instanceId: id,
    mapKey: cur.mapKey || null,
    x: cur.x ?? 0,
    y: cur.y ?? 0,
    mode: cur.mode || 'idle',           // idle | chase | attack
    targetHeroId: cur.targetHeroId || null,
    lastSeenAt: cur.lastSeenAt || 0,
    nextAttackAt: cur.nextAttackAt || 0,
    repathAt: cur.repathAt || 0,
    lastSwitchAt: cur.lastSwitchAt || 0,
    threat: cur.threat || new Map(),    // heroId -> value
    ...patch
  };
  mobs.set(id, next);
  return next;
}

// Exposta para seed inicial a partir do index.js
function seedPosition({ id, x, y, mapKey }) {
  ensureMob(id, { x: x|0, y: y|0, mapKey: String(mapKey), mode: 'idle', targetHeroId: null });
}

// Exposta para herói->mob (quando herói bate, aumenta threat)
function addThreatFromHeroHit(instanceId, heroId, amount = THREAT_ON_HIT) {
  const mob = mobs.get(String(instanceId));
  if (!mob) return;
  const cur = mob.threat.get(String(heroId)) || 0;
  const inc = Math.max(0, Number(amount) || 0);
  mob.threat.set(String(heroId), cur + inc);
  if (DEBUG_AI) console.log(`[ai-mobs] threat++ mob=${instanceId} hero=${heroId} -> ${cur}+${inc}`);
}

// --------- Boot/Stop ----------
async function start() {
  if (loopTimer) return;
  const alive = await fetchAliveMonsters();
  for (const r of alive) ensureMob(r.id, { mapKey: r.map_key, x: r.x|0, y: r.y|0, mode: 'idle' });
  lastTickAt = Date.now();
  loopTimer = setInterval(tickLoop, TICK_MS);
  console.log('[ai-mobs] started. alive=', alive.length);
}

function stop() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  mobs.clear();
  console.log('[ai-mobs] stopped.');
}

// --------- Loop principal ----------
async function tickLoop() {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTickAt) / 1000);
  lastTickAt = now;

  // group by map
  const byMap = new Map();
  for (const m of mobs.values()) {
    if (!m.mapKey) continue;
    if (!byMap.has(m.mapKey)) byMap.set(m.mapKey, []);
    byMap.get(m.mapKey).push(m);
  }

  for (const [mapKey, list] of byMap.entries()) {
    const heroesRows = await fetchOnlineHeroesInMap(mapKey);
    const heroes = heroesRows.map(r => ({ heroId: r.hero_id, x: r.x|0, y: r.y|0 }));
    const { grid, cols } = await getGrid(mapKey);
    const losGrid = { data: grid, cols };

    if (DEBUG_AI && heroes.length === 0 && list.length) {
      console.log(`[ai-mobs] no heroes online in map=${mapKey}`);
    }

    for (const mob of list) {
      try {
        await stepMob(now, dt, mob, heroes, losGrid);
      } catch (e) {
        console.warn('[ai-mobs] stepMob error:', e?.message);
      }
    }
  }
}

async function stepMob(now, dt, mob, heroes, losGrid) {
  decayThreat(mob, dt);
  selectTargetByThreat(now, mob, heroes, losGrid);

  if (!mob.targetHeroId) { mob.mode = 'idle'; return; }

  const tgtPos = heroes.find(h => h.heroId === mob.targetHeroId);
  if (!tgtPos) {
    if (now - mob.lastSeenAt > GIVEUP_MS) { mob.targetHeroId = null; mob.mode = 'idle'; }
    return;
  }

  // ATK: alcance + LOS
  if (inReachPx({x:mob.x,y:mob.y}, {x:tgtPos.x,y:tgtPos.y}, 'MONSTER', K)
      && hasLineOfSight(losGrid, mob.x, mob.y, tgtPos.x, tgtPos.y)) {

    mob.mode = 'attack';
    mob.lastSeenAt = now;

    if (now >= mob.nextAttackAt) {
      const cd = (K.MONSTER_SPEED_MS && K.MONSTER_SPEED_MS.DEFAULT) || 1200;
      mob.nextAttackAt = now + cd;

      try {
        await applyMobHit({
          attackerInstanceId: String(mob.instanceId),
          targetHeroId: String(mob.targetHeroId),
          attackInfo: { min: 1, max: 3 } // ajuste por monstro depois
        });
      } catch (e) {
        console.warn('[ai-mobs] applyMobHit error:', e?.message);
      }
    }
    return;
  }

  // CHASE
  mob.mode = 'chase';
  if (now >= mob.repathAt) {
    mob.repathAt = now + REPATH_MS;
    const step = pickStepGreedy(mob, tgtPos, losGrid);
    if (step) await moveMobAndPersist(mob, step, dt);
  }
}

// --------- Threat ----------
function chebTiles(ax, ay, bx, by) {
  const cax = Math.floor(ax / STEP_PX), cay = Math.floor(ay / STEP_PX);
  const cbx = Math.floor(bx / STEP_PX), cby = Math.floor(by / STEP_PX);
  return Math.max(Math.abs(cax - cbx), Math.abs(cay - cby));
}

function decayThreat(mob, dt) {
  if (!mob.threat || mob.threat.size === 0) return;
  const dec = THREAT_DECAY * dt;
  for (const [hid, v] of mob.threat.entries()) {
    const nv = Math.max(0, v - dec);
    if (nv <= 0.001) mob.threat.delete(hid);
    else mob.threat.set(hid, nv);
  }
}

function selectTargetByThreat(now, mob, heroes, losGrid) {
  // Alimenta threat por proximidade/visão (AGGRO_TILES)
  for (const h of heroes) {
    const dTiles = chebTiles(mob.x, mob.y, h.x, h.y);
    if (dTiles <= AGGRO_TILES) {
      const canSee = hasLineOfSight(losGrid, mob.x, mob.y, h.x, h.y);
      const base = canSee ? THREAT_ON_SIGHT : THREAT_ON_SIGHT * 0.4;
      const cur = mob.threat.get(h.heroId) || 0;
      mob.threat.set(h.heroId, cur + base);
      if (canSee) mob.lastSeenAt = now;
    }
  }

  // Escolhe o maior threat; troca só se superar atual + histerese
  let bestId = null, bestV = -1;
  for (const [hid, v] of mob.threat.entries()) if (v > bestV) { bestV = v; bestId = hid; }

  if (!bestId) { mob.targetHeroId = null; return; }
  if (!mob.targetHeroId) { mob.targetHeroId = bestId; mob.lastSwitchAt = now; return; }

  if (bestId !== mob.targetHeroId) {
    const curV = mob.threat.get(mob.targetHeroId) || 0;
    if (bestV >= curV + SWITCH_HYSTERESIS) {
      if (DEBUG_AI) console.log(`[ai-mobs] switch target mob=${mob.instanceId} -> ${bestId} (best=${bestV.toFixed(2)} cur=${curV.toFixed(2)})`);
      mob.targetHeroId = bestId;
      mob.lastSwitchAt = now;
    }
  }
}

// --------- Movement ----------
function isBlockedPx(losGrid, wx, wy) {
  const cx = Math.floor(wx / STEP_PX);
  const cy = Math.floor(wy / STEP_PX);
  if (cx < 0 || cy < 0 || cy * losGrid.cols + cx >= losGrid.data.length) return true;
  return losGrid.data[cy * losGrid.cols + cx] === 1;
}

function pickStepGreedy(mob, tgtPos, losGrid) {
  const c0x = Math.floor(mob.x / STEP_PX), c0y = Math.floor(mob.y / STEP_PX);
  const c1x = Math.floor(tgtPos.x / STEP_PX), c1y = Math.floor(tgtPos.y / STEP_PX);
  const dx = Math.sign(c1x - c0x), dy = Math.sign(c1y - c0y);

  const cand = [];
  if (Math.abs(c1x - c0x) >= Math.abs(c1y - c0y)) {
    if (dx) cand.push({cx:c0x+dx, cy:c0y});
    if (dy) cand.push({cx:c0x, cy:c0y+dy});
  } else {
    if (dy) cand.push({cx:c0x, cy:c0y+dy});
    if (dx) cand.push({cx:c0x+dx, cy:c0y});
  }

  for (const c of cand) {
    const wx = c.cx * STEP_PX + STEP_PX/2;
    const wy = c.cy * STEP_PX + STEP_PX/2;
    if (!isBlockedPx(losGrid, wx, wy)) return { x: wx, y: wy };
  }
  return null;
}

async function moveMobAndPersist(mob, step, dt) {
  const speed = CHASE_SPEED_PX_S;
  const maxMove = speed * dt;

  const dx = step.x - mob.x, dy = step.y - mob.y;
  const dist = Math.hypot(dx, dy);
  const ux = dx / (dist || 1), uy = dy / (dist || 1);
  const nx = dist <= maxMove ? step.x : (mob.x + ux * maxMove);
  const ny = dist <= maxMove ? step.y : (mob.y + uy * maxMove);

  const prevCell = (Math.floor(mob.x/STEP_PX) << 16) | Math.floor(mob.y/STEP_PX);
  const nextCell = (Math.floor(nx/STEP_PX) << 16) | Math.floor(ny/STEP_PX);

  mob.x = nx|0; mob.y = ny|0;

  if (prevCell !== nextCell) {
    try {
      await run(
        `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
        [mob.instanceId, mob.x, mob.y]
      );
      try {
        broadcast({ type:'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
      } catch {}
    } catch (e) {
      console.warn('[ai-mobs] persist pos error:', e?.message);
    }
  }
}

// --------- Exports ----------
module.exports = {
  start,
  stop,
  seedPosition,
  addThreatFromHeroHit,
  _state: mobs
};
