// AI dos mobs: targeting inteligente, parametrizado e ataque ativo.
// Aproveita funções utilitárias do projeto (pos.js, los.js, service.js, etc).
//server/combat/ai-mobs.js
// AI dos mobs: targeting inteligente, parametrizado e ataque ativo.
// Aproveita funções utilitárias do projeto (pos.js, los.js, service.js, etc).
const { get } = require('../models/db');
const bus = require('../ws/bus');
const { getHeroPos } = require('./pos');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { applyMobHit } = require('./service'); // Corrigido: usar o ataque real do monstro!
const { TILE } = require('./geom');
const YAML = require('js-yaml');
const fs = require('fs');
const path = require('path');

const TICK_MS = 350;
let timer = null;

// Cache: id -> { x, y, mapKey, spawnRect:{x,y,w,h}, state, targetId, aggroUntil }
const INST = new Map();

// Cache de stats/AI dos YAMLs para evitar I/O em cada tick
const MONSTER_STATS = new Map();

// Load stats do YAML (monstroKey) — você pode adaptar para hotreload se desejar
function getMonsterYmlStats(monsterKey) {
  if (MONSTER_STATS.has(monsterKey)) return MONSTER_STATS.get(monsterKey);
  try {
    const file = path.resolve(__dirname, `../../data/sprites/monsters/${monsterKey}.yml`);
    const yml = YAML.load(fs.readFileSync(file, 'utf8'));
    const stats = yml.stats || {};
    // Defaults para AI:
    const ai = {
      aggro_range: stats.aggro_range ?? 160,           // px
      move_speed: stats.move_speed ?? 40,              // px/s idle/wander
      chase_speed: stats.chase_speed ?? 60,            // px/s chasing
      attack_range: stats.attack_range ?? TILE,         // px, melee = TILE
      attack_cooldown_ms: stats.attack_cooldown_ms ?? 1200,
      attack_damage: stats.attack_damage ?? 10,
      attack_min: stats.attack_min ?? 4,
      attack_max: stats.attack_max ?? 10
    };
    MONSTER_STATS.set(monsterKey, { ...stats, ai });
    return { ...stats, ai };
  } catch (e) {
    return { ai: { aggro_range: 160, move_speed: 40, chase_speed: 60, attack_range: TILE, attack_cooldown_ms: 1200, attack_damage: 10, attack_min: 4, attack_max: 10 } };
  }
}

// Seed inicial (pode ser chamado no respawn/loader)
function seedPosition({ id, x, y, mapKey, spawnRect, monsterKey }) {
  const sr = (spawnRect && Number.isFinite(spawnRect.w) && Number.isFinite(spawnRect.h))
    ? { x: Number(spawnRect.x) || 0, y: Number(spawnRect.y) || 0, w: Number(spawnRect.w), h: Number(spawnRect.h) }
    : { x: Math.max(0, (Number(x) || 0) - 48), y: Math.max(0, (Number(y) || 0) - 48), w: 96, h: 96 };
  const stats = getMonsterYmlStats(monsterKey);
  INST.set(String(id), {
    id: String(id),
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    mapKey: String(mapKey || 'house'),
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

function clampToRect(x, y, r) {
  const cx = Math.min(Math.max(x, r.x), r.x + r.w);
  const cy = Math.min(Math.max(y, r.y), r.y + r.h);
  return { x: cx, y: cy };
}

// Busca todos heróis ativos no mapa (você pode otimizar via cache, aqui consulta ao DB)
async function getHeroesOnMap(mapKey) {
  const rows = await get(
    `SELECT ph.id FROM player_heroes ph
      JOIN player_last_pos plp ON plp.player_id = ph.player_id
     WHERE plp.map_key = $1
     GROUP BY ph.id`,
    [mapKey]
  ).catch(() => []);
  return rows.map(r => r.id);
}

// Checa se herói está vivo e na posição válida
async function isHeroAlive(heroId, mapKey) {
  // Você pode customizar para só players online/vivos
  const pos = await getHeroPos(heroId, mapKey);
  return !!(pos && pos.map_key === mapKey);
}

async function tick() {
  const now = Date.now();
  const dt = TICK_MS / 1000;

  for (const [id, m] of INST.entries()) {
    // Step 1: Targeting/agro
    let targetId = m.targetId;
    let targetPos = null;
    let lostAgro = false;

    // LOG: início do processamento do mob
    console.log(`[AI] Mob ${id} (${m.monsterKey}) tick - State: ${m.state}, Target: ${m.targetId}`);

    // Se tem target, valida se ainda é válido
    if (targetId) {
      targetPos = await getHeroPos(targetId, m.mapKey);
      if (
        !targetPos ||
        Math.hypot(targetPos.x - m.x, targetPos.y - m.y) > m.ai.aggro_range ||
        !(await isHeroAlive(targetId, m.mapKey))
      ) {
        // Perdeu agro
        console.log(`[AI] Mob ${id} perdeu agro do target ${targetId}`);
        targetId = null;
        targetPos = null;
        lostAgro = true;
        m.state = 'IDLE';
        m.aggroUntil = null;
        m.targetId = null;
      }
    }

    // Se não tem target, busca um novo
    if (!targetId) {
      const heroIds = await getHeroesOnMap(m.mapKey);
      let best = null, bestDist = Infinity;
      for (const hId of heroIds) {
        const hPos = await getHeroPos(hId, m.mapKey);
        if (!hPos) continue;
        const dist = Math.hypot(hPos.x - m.x, hPos.y - m.y);
        if (dist > m.ai.aggro_range) continue;

        // LOS check
        const { grid, cols, rows } = await getGrid(m.mapKey);
        const losGrid = { data: grid, cols, rows };
        if (!hasLineOfSight(losGrid, m.x, m.y, hPos.x, hPos.y)) continue;

        if (dist < bestDist) {
          bestDist = dist;
          best = { id: hId, pos: hPos };
        }
      }
      if (best) {
        targetId = best.id;
        targetPos = best.pos;
        m.state = 'AGRO';
        m.aggroUntil = now + 4000; // 4s tolerância após sair do range
        m.targetId = targetId;
        console.log(`[AI] Mob ${id} achou target ${targetId} a ${bestDist.toFixed(2)} px`);
      }
    }

    // Step 2: Movimento
    let dx = 0, dy = 0, speed = m.ai.move_speed;
    if (targetId && targetPos) {
      m.state = 'CHASE';
      speed = m.ai.chase_speed;
      const dist = Math.hypot(targetPos.x - m.x, targetPos.y - m.y);
      dx = (targetPos.x - m.x) / (dist || 1);
      dy = (targetPos.y - m.y) / (dist || 1);

      // LOG: perseguição
      console.log(`[AI] Mob ${id} perseguindo target ${targetId} (dist: ${dist.toFixed(2)} px)`);
    } else {
      // Passeio aleatório
      if (!m._wanderAngle || Math.random() < 0.05) {
        m._wanderAngle = Math.random() * Math.PI * 2;
      }
      dx = Math.cos(m._wanderAngle);
      dy = Math.sin(m._wanderAngle);

      // LOG: idle/wander
      if (!targetId) {
        console.log(`[AI] Mob ${id} em idle/wander`);
      }
    }

    let nx = m.x + dx * speed * dt;
    let ny = m.y + dy * speed * dt;
    const cl = clampToRect(nx, ny, m.spawnRect);
    nx = Math.round(cl.x);
    ny = Math.round(cl.y);

    m.x = nx; m.y = ny; INST.set(id, m);

    bus.broadcast({ type: 'monster_move', id: String(id), x: nx, y: ny, state: m.state, target: m.targetId });

    // Step 3: Ataque ativo (melee simples, pode evoluir)
    if (targetId && targetPos) {
      const inAttackRange = Math.hypot(targetPos.x - m.x, targetPos.y - m.y) <= m.ai.attack_range;
      if (inAttackRange && now - (m.lastAttackAt || 0) > m.ai.attack_cooldown_ms) {
        // Verifica LOS antes de atacar
        const { grid, cols, rows } = await getGrid(m.mapKey);
        const losGrid = { data: grid, cols, rows };
        if (hasLineOfSight(losGrid, m.x, m.y, targetPos.x, targetPos.y)) {
          // LOG: ataque
          console.log(`[AI] Mob ${id} ATACANDO hero ${targetId} (dano: ${m.ai.attack_min}-${m.ai.attack_max})`);

          // Chama applyMobHit (ataque real)
          applyMobHit({
            attackerInstanceId: m.id,
            targetHeroId: targetId,
            attackInfo: {
              min: m.ai.attack_min,
              max: m.ai.attack_max,
              // Adicione mais campos se quiser (elementos, tipo, etc)
            }
          }).then(result => {
            if (result && result.ok) {
              console.log(`[AI] Mob ${id} causou ${result.damage} de dano em hero ${targetId} (novo HP: ${result.hpAfter})`);
            } else {
              console.warn(`[AI] Mob ${id} falha no ataque: ${result && result.message}`);
            }
          }).catch(e => {
            console.error(`[AI] Mob ${id} erro no ataque:`, e);
          });

          m.lastAttackAt = now;
        }
      }
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  console.log(`[ai] mob AI started (${TICK_MS}ms, targeting/agro/attack)`);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  console.log('[ai] mob AI stopped');
}

module.exports = { start, stop, seedPosition, forget };