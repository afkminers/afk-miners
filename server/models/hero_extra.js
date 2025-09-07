// server/models/hero_extra.js
const { get, all, run } = require('./db');

/* ======================================================================
   EQUIPS (slots estilo Tibia) — usa TABELA hero_equipment
   ====================================================================== */

const TIBIA_SLOTS = [
  'AMULET', 'HELMET', 'BACKPACK',
  'WEAPON', 'ARMOR', 'SHIELD',
  'RING', 'LEGS', 'BOOTS',
];

/** Garante que todos os slots existam em hero_equipment para o herói. */
async function ensureHeroEquipRows(heroId) {
  const rows = await all(
    `SELECT slot FROM hero_equipment WHERE hero_id = $1`,
    [String(heroId)]
  );
  const have = new Set(rows.map(r => String(r.slot).toUpperCase()));

  for (const s of TIBIA_SLOTS) {
    if (!have.has(s)) {
      await run(
        `INSERT INTO hero_equipment (hero_id, slot, item_key)
         VALUES ($1, $2, NULL)
         ON CONFLICT (hero_id, slot) DO NOTHING`,
        [String(heroId), s]
      );
    }
  }
}

/* ======================================================================
   SKILLS BASE — usa TABELA player_hero_skills
   ====================================================================== */

const BASE_SKILLS = ['SWORD', 'DISTANCE', 'MAGIC', 'SHIELD'];

async function ensureHeroSkills(heroId) {
  for (const sk of BASE_SKILLS) {
    await run(
      `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (hero_id, skill_type) DO NOTHING`,
      [String(heroId), sk]
    );
  }
}

/* ======================================================================
   AUTO-EQUIP do starter — usa hero_equipment + player_inventories
   ====================================================================== */

/** Busca heroKey + class do herói. */
async function getHeroMeta(heroId) {
  return await get(
    `SELECT ph."heroKey" AS hero_key, COALESCE(hm.class, '') AS class
       FROM player_heroes ph
       LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [String(heroId)]
  );
}

/** Decide a arma inicial pelo heroKey/classe. Ajuste se quiser. */
function decideStarterWeapon({ heroKey, klass }) {
  const hk = String(heroKey || '').toLowerCase();
  const k  = String(klass || '').toUpperCase();

  if (hk === 'lyria' || k === 'RANGER' || k === 'PALADIN') return 'short_bow';
  if (hk === 'aric'  || hk === 'brokk' || k === 'KNIGHT'  || k === 'WARRIOR') return 'rusty_sword';
  return 'oak_staff'; // fallback mágico
}

/**
 * Auto-equipa a arma inicial **sem deixar cópia fantasma** no inventário:
 * - se o player não tem o item, cria qty=1;
 * - debita 1 do inventário;
 * - upsert no slot WEAPON.
 */
async function autoEquipStarterWeapon({ playerId, heroId }) {
  const meta = await getHeroMeta(heroId);
  const itemKey = decideStarterWeapon({ heroKey: meta?.hero_key, klass: meta?.class });

  // valida item e slot
  const item = await get(`SELECT key, slot FROM items_master WHERE key = $1`, [itemKey]);
  if (!item || String(item.slot).toUpperCase() !== 'WEAPON') {
    return { ok: false, reason: 'starter-item-not-found-or-not-weapon', itemKey };
  }

  // garante linha do slot WEAPON
  await run(
    `INSERT INTO hero_equipment (hero_id, slot, item_key)
     VALUES ($1, 'WEAPON', NULL)
     ON CONFLICT (hero_id, slot) DO NOTHING`,
    [String(heroId)]
  );

  // transação
  await run('BEGIN');
  try {
    // estoque atual
    const inv = await get(
      `SELECT qty FROM player_inventories WHERE player_id = $1::uuid AND item_key = $2`,
      [String(playerId), String(itemKey)]
    );
    const qty = Number(inv?.qty || 0);

    // se não tem, cria 1 para já debitar
    if (qty <= 0) {
      await run(
        `INSERT INTO player_inventories (player_id, item_key, qty)
         VALUES ($1::uuid, $2, 1)
         ON CONFLICT (player_id, item_key)
         DO UPDATE SET qty = player_inventories.qty + 1`,
        [String(playerId), String(itemKey)]
      );
    }

    // debita 1
    await run(
      `UPDATE player_inventories
          SET qty = qty - 1
        WHERE player_id = $1::uuid AND item_key = $2 AND qty > 0`,
      [String(playerId), String(itemKey)]
    );

    // equipa (upsert)
    await run(
      `INSERT INTO hero_equipment (hero_id, slot, item_key)
       VALUES ($1, 'WEAPON', $2)
       ON CONFLICT (hero_id, slot)
       DO UPDATE SET item_key = EXCLUDED.item_key, updated_at = now()`,
      [String(heroId), String(itemKey)]
    );

    await run('COMMIT');
    return { ok: true, itemKey };
  } catch (e) {
    await run('ROLLBACK');
    throw e;
  }
}

module.exports = {
  ensureHeroEquipRows,
  ensureHeroSkills,
  autoEquipStarterWeapon,
};
