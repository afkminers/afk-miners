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
  const hid = String(heroId);
  const rows = await all(
    `SELECT slot FROM hero_equipment WHERE hero_id = $1`,
    [hid]
  );
  const have = new Set(rows.map(r => String(r.slot).toUpperCase()));

  for (const s of TIBIA_SLOTS) {
    if (!have.has(s)) {
      await run(
        `INSERT INTO hero_equipment (hero_id, slot, item_key)
         VALUES ($1, $2, NULL)
         ON CONFLICT (hero_id, slot) DO NOTHING`,
        [hid, s]
      );
    }
  }
}

/* ======================================================================
   SKILLS BASE — usa TABELA player_hero_skills
   ====================================================================== */

/**
 * Garante que TODAS as skills base existam pro herói.
 * Preferência: função do banco ensure_hero_skill_rows(hero_id).
 * Fallback: insere uma linha por skill distinta encontrada em skill_curves.
 * Idempotente: ON CONFLICT (hero_id, skill_type) DO NOTHING.
 */
async function ensureHeroSkills(heroId) {
  const hid = String(heroId);

  // 1) Tenta via função nativa do banco (se estiver criada nas migrations)
  try {
    await run(`SELECT ensure_hero_skill_rows($1)`, [hid]);
    return;
  } catch (e) {
    // Se a função não existir neste ambiente, cai pro fallback
    const msg = String(e && e.message || '');
    // Erros comuns quando a função não existe:
    //  - function ensure_hero_skill_rows(unknown) does not exist
    //  - relation "..." does not exist (em ambientes incompletos)
    if (!/ensure_hero_skill_rows/i.test(msg)) {
      // A função existe mas falhou por outro motivo → propaga
      // (ajuda a não mascarar erro real de banco)
      // Porém, se preferir sempre fallback, comente a linha abaixo.
      // throw e;
    }
  }

  // 2) Fallback idempotente (usa o que houver em skill_curves)
  await run(
    `
    INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
    SELECT $1, s.skill_type, 1, 0
      FROM (SELECT DISTINCT skill_type FROM skill_curves) s
 LEFT JOIN player_hero_skills phs
        ON phs.hero_id = $1
       AND phs.skill_type = s.skill_type
     WHERE phs.hero_id IS NULL
    `,
    [hid]
  );
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

/** Decide a arma inicial pelo heroKey/classe (ajuste livre se quiser). */
function decideStarterWeapon({ heroKey, klass }) {
  const hk = String(heroKey || '').toLowerCase();
  const k  = String(klass || '').toUpperCase();

  // Rangers/Paladins → arco
  if (hk === 'lyria' || k === 'RANGER' || k === 'PALADIN') return 'starter_bow';

  // Knights/Warriors (ex.: aric/brokk) → espada
  if (hk === 'aric' || hk === 'brokk' || k === 'KNIGHT' || k === 'WARRIOR') return 'rusty_sword';

  // Mago/Outros → cajado simples
  return 'oak_staff';
}

/**
 * Auto-equipa a arma inicial **sem cópia fantasma** no inventário:
 * - se o player não tem o item, cria qty=1;
 * - debita 1 do inventário (garantido > 0);
 * - upsert no slot WEAPON.
 */
async function autoEquipStarterWeapon({ playerId, heroId }) {
  const pid = String(playerId);
  const hid = String(heroId);

  const meta = await getHeroMeta(hid);
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
    [hid]
  );

  // transação
  await run('BEGIN');
  try {
    // estoque atual
    const inv = await get(
      `SELECT qty FROM player_inventories WHERE player_id = $1::uuid AND item_key = $2`,
      [pid, String(itemKey)]
    );
    const qty = Number(inv?.qty || 0);

    // se não tem, cria 1 para já debitar
    if (qty <= 0) {
      await run(
        `INSERT INTO player_inventories (player_id, item_key, qty)
         VALUES ($1::uuid, $2, 1)
         ON CONFLICT (player_id, item_key)
         DO UPDATE SET qty = player_inventories.qty + 1`,
        [pid, String(itemKey)]
      );
    }

    // debita 1 (garante qty>0 na cláusula)
    await run(
      `UPDATE player_inventories
          SET qty = qty - 1
        WHERE player_id = $1::uuid AND item_key = $2 AND qty > 0`,
      [pid, String(itemKey)]
    );

    // equipa (upsert)
    await run(
      `INSERT INTO hero_equipment (hero_id, slot, item_key)
       VALUES ($1, 'WEAPON', $2)
       ON CONFLICT (hero_id, slot)
       DO UPDATE SET item_key = EXCLUDED.item_key, updated_at = now()`,
      [hid, String(itemKey)]
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
