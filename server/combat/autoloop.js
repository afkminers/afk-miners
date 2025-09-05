// server/combat/autoloop.js
const K = require('../balance/config');
const { applyHit } = require('./service');
const { getHeroPos, getMonsterPos } = require('./pos');   // posições
const { inReachPx } = require('./geom');                  // Chebyshev
const { hasLineOfSight } = require('./los');              // Bresenham
const { getGrid } = require('../maps/grid');              // colisão server
const { get } = require('../models/db');                  // já usado no isTargetAlive

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// heroId -> { timer, targetInstanceId, weaponType, cooldownMs }
const loops = new Map();

function cooldownFor(weaponType) {
  const key = String(weaponType || 'SWORD').toUpperCase();
  return (K.WEAPON_SPEED_MS && K.WEAPON_SPEED_MS[key]) || 1000;
}

async function isTargetAlive(instanceId) {
  const row = await get(
    'SELECT state, hp FROM monster_instances WHERE id=$1',
    [instanceId]
  );
  return !!row && row.state === 'ALIVE' && Number(row.hp || 0) > 0;
}

// Validação “OT-like” por golpe (alcance + LOS em cada tick)
async function tickOnce(heroId, targetInstanceId, weaponType) {
  const mobPos = await getMonsterPos(targetInstanceId);
  if (!mobPos) return { ok:false, reason:'mob-pos-missing' };

  const heroPos = await getHeroPos(heroId, mobPos.map_key);
  if (!heroPos) return { ok:false, reason:'hero-pos-missing' };
  if (heroPos.map_key !== mobPos.map_key) return { ok:false, reason:'map-diff' };

  // pega grid linear e passa wrapper com metadata p/ LOS
  const { grid, cols } = await getGrid(heroPos.map_key);
  const losGrid = { data: grid, cols };

  if (!inReachPx(heroPos, mobPos, weaponType, K)) {
    if (DEBUG) console.log('[autoloop] out_of_range');
    return { ok:false, reason:'out_of_range' };
  }
  if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) {
    if (DEBUG) console.log('[autoloop] no_los');
    return { ok:false, reason:'no_los' };
  }

  return await applyHit({
    attackerHeroId: String(heroId),
    targetInstanceId: String(targetInstanceId),
    weaponType: String(weaponType || 'SWORD')
  });
}

function start(heroId, targetInstanceId, weaponType = 'SWORD') {
  stop(heroId); // idempotente

  const cooldownMs = cooldownFor(weaponType);
  if (DEBUG) console.log(`[autoloop] start hero=${heroId} target=${targetInstanceId} cd=${cooldownMs}ms`);

  const tick = async () => {
    try {
      if (!(await isTargetAlive(targetInstanceId))) {
        if (DEBUG) console.log(`[autoloop] target not alive -> stop hero=${heroId}`);
        stop(heroId);
        return;
      }
      const r = await tickOnce(heroId, targetInstanceId, weaponType);
      if (r?.dead) {
        if (DEBUG) console.log(`[autoloop] target died -> stop hero=${heroId}`);
        stop(heroId);
      }
    } catch (e) {
      console.warn('[autoloop] tick error:', e?.message);
    }
  };

  // primeiro hit imediato e agenda os próximos
  tick();
  const timer = setInterval(tick, cooldownMs);
  loops.set(heroId, { timer, targetInstanceId, weaponType, cooldownMs });
}

function stop(heroId) {
  const entry = loops.get(heroId);
  if (entry?.timer) clearInterval(entry.timer);
  if (entry && DEBUG) console.log(`[autoloop] stop hero=${heroId}`);
  loops.delete(heroId);
}

function stopAll() {
  for (const heroId of loops.keys()) stop(heroId);
}

function getState(heroId) {
  const e = loops.get(heroId);
  return e ? { targetInstanceId: e.targetInstanceId, weaponType: e.weaponType, cooldownMs: e.cooldownMs } : null;
}

module.exports = { start, stop, stopAll, cooldownFor, getState, _tickOnce: tickOnce };
