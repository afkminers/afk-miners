// server/combat/service.js

const { get, run, all } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');
//ws bus
const { broadcast } = require('../ws/bus');

/** Util: cálculo de dano Tibia-like, progressão real, sem dano mínimo */
function computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor, variance = K.DAMAGE_VARIANCE) {
    const base = weaponAtk * (1 + skillLevel / 50);
    const minDmg = Math.floor(base * (1 - variance));
    const maxDmg = Math.ceil(base * (1 + variance));
    const raw = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
    const defenseReduction = Math.floor(Math.random() * (monsterArmor + 1));
    return Math.max(0, raw - defenseReduction); // sem dano mínimo garantido
}

/** Resolve skill pelo tipo de arma (usa tabela weapon_skill_map que você já tem) */
async function resolveSkillFromWeapon(weaponType) {
    if (!weaponType) return null;
    const row = await get(
        `SELECT skill_type FROM weapon_skill_map WHERE lower(weapon_type) = lower($1)`,
        [String(weaponType)]
    );
    return row?.skill_type || null;
}

/** Busca o nível do skill do herói para o tipo de skill usado */
async function getHeroSkillLevel(heroId, skillType) {
    if (!heroId || !skillType) return 10; // fallback razoável
    const row = await get(
        `SELECT level FROM player_hero_skills WHERE hero_id = $1 AND skill_type = $2`,
        [heroId, skillType]
    );
    return row?.level ? Number(row.level) : 10; // fallback inicial
}

/** Stats básicos do herói (usa suas tabelas) */
async function getHeroStats(heroId) {
    return await get(
        `SELECT 
            ph.id AS hero_id,
            COALESCE(ph.attack,10) + COALESCE(i.atk,0) AS attack,
            COALESCE(ph.defense,10) AS defense,
            hm.class,
            eq.item_key AS weapon_key,
            i.atk AS weapon_atk,
            i.weapon_type AS weapon_type
         FROM player_heroes ph
    LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
    LEFT JOIN hero_equipment eq ON eq.hero_id = ph.id::uuid AND eq.slot = 'WEAPON'
    LEFT JOIN items_master i    ON i.key = eq.item_key
        WHERE ph.id = $1`,
        [heroId]
    );
}

/** Carrega a instância + dados do monstro (xp/loot/armor) */
async function getInstanceWithMonster(instanceId) {
    return await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.state, mi.spawn_id, mi.map_key,
            m.id AS monster_id, m.key AS monster_key,
            COALESCE(m.xp,25) AS xp_reward,
            COALESCE(m."lootJSON",'[]'::jsonb) AS loot_json,
            COALESCE(m."defensesJSON",'{}'::jsonb) AS defenses_json
       FROM monster_instances mi
       JOIN monsters_master m ON m.id = mi.monster_id
      WHERE mi.id = $1`,
        [instanceId]
    );
}

/** Consulta respawnSec pelo spawn_id da instância (fallback 30s) */
async function getRespawnSeconds(spawnId) {
    if (!spawnId) return 30;
    const row = await get(
        `SELECT COALESCE("respawnSec",30) AS sec FROM spawns WHERE id=$1`,
        [spawnId]
    );
    return row?.sec ?? 30;
}

/** Rola loot de acordo com lootJSON do monsters_master (array de {item,min,max,chance}) */
function rollLoot(lootJson) {
    const drops = [];
    const arr = Array.isArray(lootJson) ? lootJson : [];
    for (const e of arr) {
        const item = e?.item;
        const min = Number(e?.min ?? 1);
        const max = Number(e?.max ?? 1);
        const chance = Number(e?.chance ?? 0); // em %
        if (!item || chance <= 0) continue;
        const roll = Math.random() * 100;
        if (roll <= chance) {
            const amount = min >= max ? min : (min + Math.floor(Math.random() * (max - min + 1)));
            if (amount > 0) drops.push({ item_key: String(item), amount });
        }
    }
    return drops;
}

/** Dá XP pro herói */
async function giveXp(heroId, xp) {
    if (!xp || xp <= 0) return;
    await run(
        `UPDATE player_heroes
        SET xp = COALESCE(xp,0) + $2
      WHERE id = $1`,
        [heroId, xp]
    );
}

/** Persiste drops na tabela hero_loot_drops */
async function persistDrops(heroId, instanceId, drops) {
    if (!drops || !drops.length) return 0;
    const values = [];
    const params = [];
    let i = 1;
    for (const d of drops) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(heroId, instanceId, d.item_key, d.amount);
    }
    await run(
        `INSERT INTO hero_loot_drops (hero_id, monster_instance_id, item_key, amount)
     VALUES ${values.join(',')}`,
        params
    );
    return drops.length;
}

/** Aplica hit (dano + skill + morte/loot/xp/respawn) */
async function applyHit({ attackerHeroId, targetInstanceId, weaponType }) {
    const hero = await getHeroStats(attackerHeroId);
    const inst = await getInstanceWithMonster(targetInstanceId);
    if (!hero || !inst) return { ok: false, message: 'attacker or target not found' };
    if (inst.state !== 'ALIVE') return { ok: false, message: 'target not alive' };

    // Resolve skill e nível do skill
    const resolvedWeaponType = weaponType || hero.weapon_type || null;
    const skillType = await resolveSkillFromWeapon(resolvedWeaponType);
    const skillLevel = await getHeroSkillLevel(attackerHeroId, skillType);

    // Busca atk real da arma (ou fallback)
    const weaponAtk = hero.weapon_atk || 1;

    // Busca armor do monstro (defenses_json.armor)
    let monsterArmor = 0;
    try {
        const defenses = typeof inst.defenses_json === "object" ? inst.defenses_json :
            JSON.parse(inst.defenses_json || '{}');
        monsterArmor = Number(defenses.armor || 0);
    } catch { monsterArmor = 0; }

    // Cálculo novo de dano
    const dmg = computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor);

    const newHp = Math.max(0, inst.hp - dmg);
    const dead = newHp === 0;

    // sempre marcamos quem bateu por último
    await run(
        `UPDATE monster_instances
        SET hp=$2,
            last_hit_hero_id=$3,
            last_hit_at=now(),
            state = CASE WHEN $2=0 THEN 'DEAD' ELSE state END,
            updated_at=now()
      WHERE id=$1`,
        [inst.id, newHp, hero.hero_id]
    );

    // notifica clientes em tempo real
    broadcast({
        type: 'monster_hp',
        id: inst.id,
        hp: newHp,
        maxHp: inst.max_hp,
        byHero: hero.hero_id,
        dmg
    });

    // Skill gain ONLY when damage > 0
    if (skillType && dmg > 0) {
        const rate = await getClassRate(hero.class || null, skillType);
        await applyTries(attackerHeroId, skillType, 1 * rate);
    }

    // Se morreu: XP + loot + agenda respawn
    let xpGained = 0;
    let drops = [];
    if (dead) {
        // XP
        xpGained = Number(inst.xp_reward || 0);
        await giveXp(attackerHeroId, xpGained);

        // Loot
        try {
            const lootArray = Array.isArray(inst.loot_json) ? inst.loot_json : [];
            drops = rollLoot(lootArray);
            if (drops.length) await persistDrops(attackerHeroId, inst.id, drops);
        } catch (e) {
            console.warn('[combat] loot roll error:', e?.message);
        }

        // Agenda respawn
        const sec = await getRespawnSeconds(inst.spawn_id);
        await run(
            `UPDATE monster_instances
            SET respawn_at = now() + ($2 || ' seconds')::interval
        WHERE id = $1`,
            [inst.id, String(sec)]
        );

        // avisa clientes que morreu (só aqui dentro!)
        broadcast({
            type: 'monster_dead',
            id: inst.id,
            xp: xpGained,
            drops
        });
    }

    return {
        ok: true,
        damage: dmg,
        hpAfter: newHp,
        maxHp: inst.max_hp,
        dead,
        instanceId: inst.id,
        xpGained,
        drops
    };
}

module.exports = { applyHit };