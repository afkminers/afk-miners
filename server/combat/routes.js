// server/combat/routes.js
// Endpoints do combate: /nearest, /attack/start, /attack/stop, /hit
// Prefixo no index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();

const K = require('../balance/config');
// const autoloop = require('./autoloop'); // ← desativado por enquanto

const { get, run } = require('../models/db');
const { getHeroPos, getMonsterPos } = require('./pos');
const { inReachPx } = require('./geom');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { broadcast } = require('../ws/bus'); // <- necessário p/ atualizar UI em tempo real
const { applyHit } = require('./service'); // <- combat service for server-authoritative hits

// >>> loot service (em memória)
const { createLootFromKill } = require('../services/loot');

// deixe true por enquanto; quando LOS/alcance estiverem 100% a gente liga de novo
const PERMISSIVE_START = true;

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// ===== SESSÕES DE ATAQUE EM MEMÓRIA =====
// chave: targetInstanceId -> { heroId, weaponType, startedAt }
const attackSessions = new Map();

// quanto cada hit vale (em "tries"), antes de multiplicar pelos rates de classe
const BASE_TRY_PER_HIT = Number(process.env.SKILL_TRY_PER_HIT || 1);

router.use((req, _res, next) => {
  if (DEBUG) console.log(`[combat] ${req.method} ${req.originalUrl}`);
  next();
});

router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));
router.get('/_routes', (_req, res) => {
  const list = (router.stack || [])
    .filter(l => l.route)
    .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods || {}) }));
  res.json({ routes: list });
});

/* =========================================================================
   Helpers de Skill
   ========================================================================== */

/** Resolve weapon_type a partir do equipamento atual do herói (slot WEAPON). */
async function getEquippedWeaponType(heroId) {
  const row = await get(
    `SELECT im.weapon_type
       FROM hero_equipment he
       JOIN items_master im ON im.key = he.item_key
      WHERE he.hero_id = $1 AND he.slot = 'WEAPON'`,
    [String(heroId)]
  );
  return row?.weapon_type ? String(row.weapon_type).toUpperCase() : null;
}

/** Resolve o skill_type usado para ganhar skill:
 *  1) Se veio weaponType do cliente, mapeia via weapon_skill_map.
 *  2) Senão, tenta a arma EQUIPADA do herói (slot WEAPON) e mapeia.
 *  3) Senão, faz fallback pela classe do herói.
 *  4) Se nada encontrado, retorna null (não conta skill).
 */
async function resolveSkillTypeOrClass({ weaponType, heroId }) {
  async function mapWeaponToSkill(wtype) {
    if (!wtype) return null;
    const row = await get(
      `SELECT skill_type
         FROM weapon_skill_map
        WHERE lower(weapon_type) = lower($1)
        LIMIT 1`,
      [String(wtype)]
    );
    return row?.skill_type ? String(row.skill_type).toUpperCase() : null;
  }

  if (weaponType) {
    const s = await mapWeaponToSkill(weaponType);
    if (s) return s;
  }

  if (heroId) {
    const equippedWeaponType = await getEquippedWeaponType(heroId);
    const s2 = await mapWeaponToSkill(equippedWeaponType);
    if (s2) return s2;

    const c = await get(
      `SELECT hm.class
         FROM player_heroes ph
         JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
        WHERE ph.id = $1`,
      [String(heroId)]
    );
    const heroClass = (c?.class || '').toUpperCase();

    if (heroClass === 'RANGER' || heroClass === 'PALADIN') return 'DISTANCE';
    if (heroClass === 'MAGE' || heroClass === 'WIZARD')   return 'MAGIC';
    if (heroClass === 'KNIGHT' || heroClass === 'GUARDIAN') return 'SWORD';
  }
  return null;
}

/** Aplica ganho de skill no banco. */
async function gainSkillFromHit({ heroId, weaponType }) {
  const skillType = await resolveSkillTypeOrClass({ weaponType, heroId });
  if (!skillType) return { ok: false, reason: 'no-skill-type' };

  await run(
    `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
     VALUES ($1, $2, 1, 0)
     ON CONFLICT (hero_id, skill_type) DO NOTHING`,
    [String(heroId), skillType]
  );

  const cur = await get(
    `SELECT level, tries_progress FROM player_hero_skills
      WHERE hero_id=$1 AND skill_type=$2`,
    [String(heroId), skillType]
  );
  if (!cur) return { ok: false };

  let level = Number(cur.level) || 1;
  let progress = Number(cur.tries_progress) || 0;

  const klass = await get(
    `SELECT hm.class
       FROM player_heroes ph
       JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [String(heroId)]
  );
  const heroClass = (klass?.class || '').toUpperCase();

  const rateRow = await get(
    `SELECT rate FROM class_skill_rates
      WHERE class=$1 AND skill_type=$2`,
    [heroClass, skillType]
  );
  const rate = Number(rateRow?.rate) || 1.0;

  const inc = BASE_TRY_PER_HIT * rate;
  progress += inc;

  let needRow = await get(
    `SELECT tries_needed FROM skill_curves WHERE skill_type=$1 AND level=$2`,
    [skillType, level]
  );
  let need = Number(needRow?.tries_needed) || 999999;

  let ups = 0;
  while (progress >= need) {
    progress -= need;
    level += 1;
    ups += 1;
    needRow = await get(
      `SELECT tries_needed FROM skill_curves WHERE skill_type=$1 AND level=$2`,
      [skillType, level]
    );
    need = Number(needRow?.tries_needed) || 999999;
  }

  await run(
    `UPDATE player_hero_skills
        SET level=$3, tries_progress=$4
      WHERE hero_id=$1 AND skill_type=$2`,
    [String(heroId), skillType, level, progress]
  );

  if (DEBUG) {
    console.log('[skill] hero', heroId, 'skill', skillType, 'inc', inc.toFixed(2), 'lvl', level, 'prog', progress.toFixed(2));
    if (ups) console.log(`[skill] level up +${ups} (${skillType})`);
  }

  return { ok: true, heroId, skillType, level, progress, inc };
}

/* =========================================================================
   /nearest - DISABLED: Use unified /api/combat/nearest from combat_nearest.js
   ========================================================================== */
// router.get('/nearest', async (req, res) => {
//   ... (code moved to server/routes/combat_nearest.js with shared targeting)
// });

// ====== START/STOP =========================================================
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const { heroId, targetInstanceId, weaponType } = req.body || {};
    if (!heroId || !targetInstanceId) {
      return res.status(400).json({ ok:false, error:'missing-params' });
    }

    // Get strict mode configuration
    const strictMode = K.ATTACK_STRICT_MODE;
    
    if (strictMode) {
      // Get monster position and state
      const mobPos = await getMonsterPos(targetInstanceId);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      // Verify monster is alive and on same map
      const mobState = await get(
        `SELECT state FROM monster_instances WHERE id = $1`,
        [targetInstanceId]
      );
      if (!mobState || mobState.state !== 'ALIVE') {
        return res.status(400).json({ ok:false, error:'target-not-alive' });
      }

      // Get hero position
      const heroPos = await getHeroPos(heroId, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'different-maps' });

      // Get equipped weapon type (server-authoritative)
      const equippedWeaponType = await getEquippedWeaponType(heroId);
      const weaponTypeToUse = equippedWeaponType || weaponType || 'SWORD';

      // Validate range using equipped weapon
      if (!inReachPx(heroPos, mobPos, weaponTypeToUse, K)) {
        return res.json({ ok:false, error:'out_of_range' });
      }

      // Validate line of sight
      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) {
        return res.json({ ok:false, error:'no_los' });
      }

      // Store the server-determined weapon type in session
      attackSessions.set(String(targetInstanceId), {
        heroId: String(heroId),
        weaponType: weaponTypeToUse,
        startedAt: Date.now()
      });
    } else {
      // Legacy permissive mode
      attackSessions.set(String(targetInstanceId), {
        heroId: String(heroId),
        weaponType: weaponType ? String(weaponType) : null,
        startedAt: Date.now()
      });
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

router.post('/attack/stop', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (heroId) {
      for (const [instId, sess] of attackSessions.entries()) {
        if (sess.heroId === String(heroId)) attackSessions.delete(instId);
      }
    }
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/stop error:', e);
    return res.status(500).json({ ok:false, error:'stop-failed' });
  }
});

// ====== HIT (debug DB-only) ===============================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// roll de loot super simples por monsterKey (apenas para visualizar drop)
function rollSimpleLoot(monsterKey) {
  const k = String(monsterKey || '').toLowerCase();
  // ajuste os item keys conforme seu items_master (ou deixe como placeholders)
  if (k.includes('rat')) {
    // 50% 1 cheese, 20% até 3 gold
    const out = [];
    if (Math.random() < 0.5) out.push({ key: 'cheese', amount: 1 });
    if (Math.random() < 0.2) out.push({ key: 'gold_coin', amount: 1 + Math.floor(Math.random() * 3) });
    return out;
  }
  if (k.includes('deer')) {
    const out = [];
    if (Math.random() < 0.6) out.push({ key: 'meat', amount: 1 });
    if (Math.random() < 0.15) out.push({ key: 'antlers', amount: 1 });
    return out;
  }
  // genérico: chance pequena de gold
  if (Math.random() < 0.1) return [{ key: 'gold_coin', amount: 1 }];
  return [];
}

router.post('/hit', express.json(), async (req, res) => {
  try {
    // pode vir como id, targetInstanceId, ou query ?id
    const raw = req.body?.id ?? req.body?.targetInstanceId ?? req.query?.id;
    if (!raw) return res.status(400).json({ ok:false, error:'missing-id' });

    // tenta descobrir heroId/weaponType da sessão iniciada em /attack/start
    const sess = attackSessions.get(String(raw)) || null;
    const heroIdFromSess = sess?.heroId || (req.body?.heroId ? String(req.body.heroId) : null);
    const weaponTypeFromSess = sess?.weaponType || (req.body?.weaponType ? String(req.body.weaponType) : null);

    if (!heroIdFromSess) {
      return res.status(400).json({ ok:false, error:'no-hero-session' });
    }

    // Get strict mode configuration
    const strictMode = K.ATTACK_STRICT_MODE;
    
    if (strictMode) {
      // Validate monster exists and is alive
      let mi;
      if (UUID_RE.test(String(raw))) {
        mi = await get(
          `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
             FROM monster_instances mi
             JOIN spawns s ON s.id = mi.spawn_id
            WHERE mi.id = $1 AND mi.state = 'ALIVE'`,
          [String(raw)]
        );
      } else {
        return res.status(400).json({ ok:false, error:'invalid-target-id' });
      }

      if (!mi) return res.status(404).json({ ok:false, error:'no-such-alive' });

      // Get monster and hero positions for validation
      const mobPos = await getMonsterPos(raw);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      const heroPos = await getHeroPos(heroIdFromSess, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) {
        return res.status(400).json({ ok:false, error:'different-maps' });
      }

      // Get equipped weapon type (server-authoritative)
      const equippedWeaponType = await getEquippedWeaponType(heroIdFromSess);
      const weaponTypeToUse = equippedWeaponType || weaponTypeFromSess || 'SWORD';

      // Validate range using equipped weapon
      if (!inReachPx(heroPos, mobPos, weaponTypeToUse, K)) {
        return res.json({ ok:false, error:'out_of_range' });
      }

      // Validate line of sight
      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) {
        return res.json({ ok:false, error:'no_los' });
      }

      // Use combat service for server-authoritative hit
      const result = await applyHit({
        attackerHeroId: heroIdFromSess,
        targetInstanceId: raw,
        weaponType: weaponTypeToUse
      });

      if (!result.ok) {
        return res.status(400).json({ ok:false, error: result.message || 'hit-failed' });
      }

      // Clean up attack session if target died
      if (result.dead) {
        attackSessions.delete(String(raw));
      }

      // Return response matching client expectations
      return res.json({
        ok: true,
        id: result.instanceId,
        dmg: result.damage,
        hpAfter: result.hpAfter,
        hp: result.hpAfter, // alias for compatibility
        maxHp: result.maxHp || 0,
        dead: result.dead
      });
    } else {
      // Legacy mode - keep existing ad-hoc implementation for debugging
      let mi;
      if (UUID_RE.test(String(raw))) {
        mi = await get(
          `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
             FROM monster_instances mi
             JOIN spawns s ON s.id = mi.spawn_id
            WHERE mi.id = $1 AND mi.state = 'ALIVE'`,
          [String(raw)]
        );
      } else if (/^\d+$/.test(String(raw))) {
        const n = Number(raw);
        mi = await get(
          `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
             FROM monster_instances mi
             JOIN spawns s ON s.id = mi.spawn_id
             JOIN monsters_master mm ON mm.key = s."monsterKey"
            WHERE mi.state = 'ALIVE' AND mm.id = $1
            ORDER BY mi.updated_at DESC LIMIT 1`, [n]
        ) || await get(
          `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
             FROM monster_instances mi
             JOIN spawns s ON s.id = mi.spawn_id
            WHERE mi.state = 'ALIVE' AND mi.spawn_id = $1
            ORDER BY mi.updated_at DESC LIMIT 1`, [n]
        );
      } else {
        return res.status(400).json({ ok:false, error:'bad-id' });
      }

      if (!mi) return res.status(404).json({ ok:false, error:'no-such-alive' });

      const DMG = Number.isFinite(+req.body?.damage) ? Math.max(1, Math.floor(+req.body.damage)) : 10;

      let hp = Math.max(0, Number(mi.hp) - DMG);
      let dead = false;

      if (hp <= 0) {
        dead = true; hp = 0;
        const secs = Math.max(5, Number(mi.respawnSec) || 30);
        await run(
          `UPDATE monster_instances
              SET state='DEAD', hp=0,
                  respawn_at = now() + make_interval(secs => $2),
                  updated_at = now()
            WHERE id = $1`,
          [mi.id, secs]
        );
        // morreu: limpa sessão desse alvo
        attackSessions.delete(String(mi.id));
      } else {
        await run(`UPDATE monster_instances SET hp=$2, updated_at=now() WHERE id=$1`, [mi.id, hp]);
      }

      // === Envia atualizações em tempo real pelo WS (barra de HP + floater de dano) ===
      const cur = await get(`
        SELECT mi.id,
               mi.hp,
               mi.max_hp,
               mi.state,
               mi.spawn_id        AS "spawnId",
               s."monsterKey"     AS "monsterKey"
          FROM monster_instances mi
          JOIN spawns s ON s.id = mi.spawn_id
         WHERE mi.id = $1
      `, [mi.id]);

      if (cur) {
        broadcast({
          type: 'monster_hp',
          id: String(cur.id),
          hp: Number(cur.hp),
          maxHp: Number(cur.max_hp || cur.hp || 1),
          dmg: Number(DMG),
          monsterKey: cur.monsterKey,
          spawnId: Number(cur.spawnId)
        });

        if (String(cur.state) === 'DEAD' || Number(cur.hp) <= 0) {
          const xp = 0; // calcule XP real se quiser
          broadcast({ type: 'monster_dead', id: String(cur.id), xp });

          // >>>>>>>>>>>>> DROP DE LOOT <<<<<<<<<<<<<<
          try {
            // posição atual do monstro em PX + map
            const pos = await getMonsterPos(cur.id);
            // rolagem simples por tipo
            const items = rollSimpleLoot(cur.monsterKey);
            if (pos && items && items.length > 0) {
              await createLootFromKill({
                mapKey: pos.map_key || pos.mapKey || 'house',
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                items
              });
            }
          } catch (e) {
            console.warn('[loot] drop failed:', e?.message);
          }
        }
      }

      // >>>>>>>>>>>> GANHO DE SKILL POR HIT (armas equipadas) <<<<<<<<<<<<<
      if (heroIdFromSess) {
        try {
          const weaponTypeEquipped = await getEquippedWeaponType(heroIdFromSess);
          await gainSkillFromHit({ heroId: heroIdFromSess, weaponType: weaponTypeEquipped });
        } catch (e) {
          console.warn('[combat] skill gain failed:', e?.message);
        }
      }

      return res.json({ ok:true, id: mi.id, dmg: DMG, hp, maxHp: Number(mi.max_hp)||0, dead });
    }
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

module.exports = router;
