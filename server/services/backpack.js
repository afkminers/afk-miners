// server/services/backpack.js
// Container da "Backpack" (modelo Tibia):
// - A capacidade vem do item equipado no slot "back" do herói.
// - Conteúdo por herói em hero_backpack_slots (não mexe no inventário global).
// - Empilha quando o item é stackable (seja em dataJSON ou em coluna plana).

const { all, get, run } = require('../models/db');

/* Utils seguros */
const asInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const asBool = (v, d = false) => {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 't', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', 'f', '0', 'no', 'n'].includes(s)) return false;
  return d;
};

/** Descobre qual item está equipado no slot "back" do herói */
async function _getEquippedBackpackKey(heroId) {
  try {
    const row = await get(
      `SELECT item_key
         FROM hero_equipment
        WHERE hero_id = $1
          AND lower(slot) = 'back'`,
      [String(heroId)]
    );
    return row?.item_key || null;
  } catch {
    return null;
  }
}

/** Lê metadados do item mesclando:
 *  - dataJSON (preferido): { slots, stackable, ... }
 *  - colunas planas: slots (int), stackable (bool)
 *  Se dataJSON existir mas não tiver 'slots', caímos para as colunas.
 */
async function _getItemData(key) {
  const K = String(key);
  // acumulador com defaults
  const out = { slots: 0, stackable: false };

  // 1) Tenta dataJSON
  try {
    const r = await get(`SELECT "dataJSON" FROM items_master WHERE key=$1`, [K]);
    if (r && r.dataJSON) {
      const dj = r.dataJSON || {};
      if (dj.slots != null) out.slots = asInt(dj.slots, out.slots);
      if (dj.stackable != null) out.stackable = asBool(dj.stackable, out.stackable);
    }
  } catch (_) {
    // coluna dataJSON pode não existir; segue
  }

  // 2) Mescla com colunas planas (se existirem)
  try {
    const r2 = await get(`SELECT slots, stackable FROM items_master WHERE key=$1`, [K]);
    if (r2) {
      if (r2.slots != null) out.slots = asInt(r2.slots, out.slots);
      if (r2.stackable != null) out.stackable = asBool(r2.stackable, out.stackable);
    }
  } catch (_) {
    // pode não haver essas colunas; segue com o que já temos
  }

  return out;
}

/** Especificação da mochila equipada (key + capacidade) */
async function getBackpackSpec(heroId) {
  const key = await _getEquippedBackpackKey(heroId);
  if (!key) return { key: null, slots: 0 };

  const data = await _getItemData(key);
  const slots = asInt(data?.slots, 0);
  return { key, slots };
}

/** Lista os slots (0..capacity-1) da mochila do herói */
async function listBackpack(heroId) {
  const spec = await getBackpackSpec(heroId);
  const capacity = asInt(spec.slots, 0);

  if (capacity <= 0) {
    return { heroId: String(heroId), capacity: 0, used: 0, items: [] };
  }

  const rows = await all(
    `SELECT slot_index AS "slotIndex", item_key AS "itemKey", qty
       FROM hero_backpack_slots
      WHERE hero_id=$1
      ORDER BY slot_index`,
    [String(heroId)]
  );

  const items = [];
  for (let i = 0; i < capacity; i++) {
    const found = rows.find((r) => r.slotIndex === i);
    if (found) items.push(found);
    else items.push({ slotIndex: i, itemKey: null, qty: 0 });
  }

  const used = items.filter((s) => s.itemKey && s.qty > 0).length;
  return { heroId: String(heroId), capacity, used, items };
}

/** Checa se item é empilhável */
async function _isStackable(itemKey) {
  const data = await _getItemData(itemKey);
  return asBool(data?.stackable, false);
}

/** Tenta empilhar em slots existentes com o mesmo item */
async function _tryStack(heroId, itemKey, amount) {
  if (amount <= 0) return 0;
  if (!(await _isStackable(itemKey))) return 0;

  const rows = await all(
    `SELECT slot_index AS "slotIndex", qty
       FROM hero_backpack_slots
      WHERE hero_id=$1 AND item_key=$2
      ORDER BY slot_index`,
    [String(heroId), String(itemKey)]
  );

  let left = amount;
  for (const r of rows) {
    if (left <= 0) break;
    await run(
      `UPDATE hero_backpack_slots
          SET qty = COALESCE(qty,0) + $3
        WHERE hero_id=$1 AND slot_index=$2`,
      [String(heroId), r.slotIndex, left]
    );
    left = 0; // sem cap por pilha no momento
  }
  return amount - left; // quanto empilhou
}

/** Encontra primeiro slot vazio (existente ou novo até a capacidade) */
async function _firstEmptySlot(heroId, capacity) {
  // Slots já existentes vazios
  const rows = await all(
    `SELECT slot_index AS "slotIndex"
       FROM hero_backpack_slots
      WHERE hero_id=$1
        AND (item_key IS NULL OR qty IS NULL OR qty=0)
      ORDER BY slot_index`,
    [String(heroId)]
  );
  const empties = new Set(rows.map((r) => r.slotIndex));
  for (let i = 0; i < capacity; i++) {
    if (empties.has(i)) return i;
  }

  // Slot ainda não inserido
  const takenRows = await all(
    `SELECT slot_index AS "slotIndex"
       FROM hero_backpack_slots WHERE hero_id=$1`,
    [String(heroId)]
  );
  const taken = new Set(takenRows.map((r) => r.slotIndex));
  for (let i = 0; i < capacity; i++) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

/** Insere item/quantidade na mochila do herói (tenta empilhar, depois slots vazios) */
async function putInBackpack(heroId, itemKey, qty) {
  if (!heroId || !itemKey || qty <= 0) return 0;

  const { slots: capacity } = await getBackpackSpec(heroId);
  if (asInt(capacity, 0) <= 0) return 0;

  let left = qty;

  // 1) Empilhar
  const stacked = await _tryStack(heroId, itemKey, left);
  left -= stacked;

  // 2) Slots vazios
  while (left > 0) {
    const idx = await _firstEmptySlot(heroId, asInt(capacity, 0));
    if (idx < 0) break;

    await run(
      `INSERT INTO hero_backpack_slots (hero_id, slot_index, item_key, qty)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hero_id, slot_index) DO UPDATE
         SET item_key = EXCLUDED.item_key,
             qty      = COALESCE(hero_backpack_slots.qty,0) + EXCLUDED.qty`,
      [String(heroId), idx, String(itemKey), left]
    );

    left = 0; // sem limite por slot no momento
  }

  return qty - left; // quanto coube
}

/** Deposita uma lista de itens (ex.: loot) na mochila do herói */
async function putLootItemsForHero(heroId, items) {
  const placed = [];
  const leftover = [];

  for (const it of items || []) {
    const key = String(it.key || it.itemKey || '').trim();
    const amount = asInt(it.amount ?? it.qty, 0);
    if (!key || amount <= 0) continue;

    const ok = await putInBackpack(heroId, key, amount);
    if (ok > 0) placed.push({ key, amount: ok });
    if (ok < amount) leftover.push({ key, amount: amount - ok });
  }
  return { placed, leftover };
}

module.exports = {
  getBackpackSpec,
  listBackpack,
  putInBackpack,
  putLootItemsForHero,
};
