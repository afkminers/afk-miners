// server/combat/autoloop.js
const K = require('../balance/config');
const { applyHit } = require('./service');
const { get } = require('../models/db');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// heroId -> { timer, targetInstanceId, weaponType, cooldownMs }
const loops = new Map();

function cooldownFor(weaponType) {
  const key = String(weaponType || 'SWORD').toUpperCase();
  return (K.WEAPON_SPEED_MS && K.WEAPON_SPEED_MS[key]) || 1000;
}

async function isTargetAlive(instanceId) {
  // checa estado e HP > 0 (defensivo)
  const row = await get(
    'SELECT state, hp FROM monster_instances WHERE id=$1',
    [instanceId]
  );
  return !!row && row.state === 'ALIVE' && Number(row.hp || 0) > 0;
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
      const r = await applyHit({
        attackerHeroId: String(heroId),
        targetInstanceId: String(targetInstanceId),
        weaponType: String(weaponType || 'SWORD')
      });
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

// opcional: utilitário para encerrar tudo ao desligar o servidor
function stopAll() {
  for (const heroId of loops.keys()) stop(heroId);
}

module.exports = { start, stop, stopAll, cooldownFor };
