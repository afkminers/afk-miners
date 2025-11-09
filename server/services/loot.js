// server/services/loot.js
// Persisted loot system: monster corpses + ground items (Phase 1 Tibia-like).
// Summary (Fase 1):
// - Persiste corpos e itens no chão usando Postgres (migrations 2025_02_20_loot_phase1.sql).
// - API utilitária para rotas /api/loot/* e para o gancho de morte em combat/service.js.
// - Emite eventos WebSocket para sincronizar corpos/itens com o front (Loot/Corpse layers).

const { getPool, get, all, run } = require('../models/db');
const { broadcastToMap } = require('../ws/bus');
const { getLivePlayerPosition } = require('../player/live_positions');
const { toTileCoords, chebyshevTiles, TILE } = require('../utils/tile-coords');

const CORPSE_DECAY_SECONDS = Math.max(30, Number(process.env.CORPSE_DECAY_SECONDS || 180));
const GROUND_ITEM_DECAY_SECONDS = Math.max(30, Number(process.env.GROUND_ITEM_DECAY_SECONDS || 300));
const CORPSE_LOOT_RANGE_TILES = Math.max(1, Number(process.env.CORPSE_LOOT_RANGE_TILES || 1));

function nowDate() { return new Date(); }
function futureDate(seconds) { return new Date(Date.now() + Math.max(0, seconds) * 1000); }

function pxToTile(px, py) {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { tx: NaN, ty: NaN };
  const t = toTileCoords({ x: px, y: py });
  return { tx: Number.isFinite(t.tx) ? t.tx : Math.floor(px / TILE), ty: Number.isFinite(t.ty) ? t.ty : Math.floor(py / TILE) };
}

function rollMonsterLoot(lootJson) {
  const drops = [];
  const arr = Array.isArray(lootJson) ? lootJson : [];
  for (const e of arr) {
    const item = e?.item;
    const min = Number(e?.min ?? 1);
    const max = Number(e?.max ?? 1);
    const chance = Number(e?.chance ?? 0);
    if (!item || chance <= 0) continue;
    const roll = Math.random() * 100;
    if (roll <= chance) {
      const low = Number.isFinite(min) ? Math.max(1, Math.floor(min)) : 1;
      const high = Number.isFinite(max) ? Math.max(low, Math.floor(max)) : low;
      const amount = low >= high ? low : (low + Math.floor(Math.random() * (high - low + 1)));
      if (amount > 0) drops.push({ item_key: String(item), amount });
    }
  }
  return drops;
}

async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function createCorpse({
  monsterInstanceId,
  monsterKey,
  monsterName = null,
  mapKey,
  x,
  y,
  ownerPlayerId = null,
  ownerHeroId = null,
  lootItems = [],
}) {
  const tile = pxToTile(x, y);
  const expiresAt = futureDate(CORPSE_DECAY_SECONDS);
  const inserted = await withClient(async (client) => {
    await client.query('BEGIN');
    const corpseRes = await client.query(
      `INSERT INTO monster_corpses (
         monster_instance_id, monster_key, monster_name,
         map_key, tile_x, tile_y, pos_x, pos_y,
         owner_player_id, owner_hero_id,
         created_at, expires_at, is_fully_looted
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11, $12)
       RETURNING id, map_key, tile_x, tile_y, pos_x, pos_y, owner_player_id, owner_hero_id, expires_at, is_fully_looted, monster_key, monster_name, monster_instance_id`,
      [
        monsterInstanceId || null,
        monsterKey || null,
        monsterName || null,
        String(mapKey || 'house'),
        Number.isInteger(tile.tx) ? tile.tx : 0,
        Number.isInteger(tile.ty) ? tile.ty : 0,
        Number.isFinite(x) ? Math.round(x) : null,
        Number.isFinite(y) ? Math.round(y) : null,
        ownerPlayerId || null,
        ownerHeroId || null,
        expiresAt,
        lootItems.length === 0,
      ],
    );
    const corpse = corpseRes.rows[0];

    if (lootItems.length > 0) {
      const values = [];
      const params = [];
      let idx = 1;
      for (const item of lootItems) {
        const key = String(item.item_key || item.itemKey || '').trim();
        const amount = Number(item.amount || item.qty || 0) | 0;
        if (!key || amount <= 0) continue;
        values.push(`(gen_random_uuid(), $${idx++}, $${idx++}, $${idx++})`);
        params.push(corpse.id, key, amount);
      }
      if (values.length) {
        await client.query(
          `INSERT INTO monster_corpse_items (id, corpse_id, item_key, amount)
           VALUES ${values.join(',')}`,
          params,
        );
      }
    }

    await client.query('COMMIT');
    return corpse;
  });

  try {
    broadcastToMap(inserted.map_key, {
      type: 'corpse:spawn',
      corpse: {
        id: inserted.id,
        monsterInstanceId: inserted.monster_instance_id,
        monsterKey: inserted.monster_key,
        monsterName: inserted.monster_name,
        mapKey: inserted.map_key,
        tileX: inserted.tile_x,
        tileY: inserted.tile_y,
        posX: inserted.pos_x,
        posY: inserted.pos_y,
        ownerPlayerId: inserted.owner_player_id,
        ownerHeroId: inserted.owner_hero_id,
        expiresAt: inserted.expires_at,
        isEmpty: inserted.is_fully_looted === true,
      },
    });
  } catch {}

  return inserted;
}

async function listCorpses(mapKey) {
  return await all(
    `SELECT id, monster_instance_id, monster_key, monster_name,
            map_key AS "mapKey", tile_x AS "tileX", tile_y AS "tileY",
            pos_x AS "posX", pos_y AS "posY",
            owner_player_id AS "ownerPlayerId",
            owner_hero_id AS "ownerHeroId",
            expires_at AS "expiresAt",
            is_fully_looted AS "isEmpty"
       FROM monster_corpses
      WHERE map_key = $1
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at`,
    [String(mapKey || 'house')],
  );
}

async function getCorpseWithItems(corpseId) {
  const corpse = await get(
    `SELECT id, monster_instance_id, monster_key, monster_name,
            map_key AS "mapKey", tile_x AS "tileX", tile_y AS "tileY",
            pos_x AS "posX", pos_y AS "posY",
            owner_player_id AS "ownerPlayerId",
            owner_hero_id AS "ownerHeroId",
            expires_at AS "expiresAt",
            is_fully_looted AS "isEmpty"
       FROM monster_corpses
      WHERE id = $1`,
    [String(corpseId)],
  );
  if (!corpse) return null;
  const items = await all(
    `SELECT id, corpse_id, item_key AS "itemKey", amount
       FROM monster_corpse_items
      WHERE corpse_id = $1
      ORDER BY created_at`,
    [String(corpseId)],
  );
  corpse.items = items;
  return corpse;
}

async function cleanupEmptyCorpse(client, corpseId, mapKey) {
  const left = await client.query(
    'SELECT COUNT(*)::int AS n FROM monster_corpse_items WHERE corpse_id=$1',
    [corpseId],
  );
  const remaining = left.rows[0]?.n || 0;
  if (remaining === 0) {
    await client.query(
      `UPDATE monster_corpses SET is_fully_looted = TRUE WHERE id = $1`,
      [corpseId],
    );
    try {
      broadcastToMap(mapKey, { type: 'corpse:updated', corpseId, isEmpty: true });
    } catch {}
  }
  return remaining;
}

async function takeCorpseItem({ corpseId, corpseItemId, amount, playerId }) {
  return await withClient(async (client) => {
    await client.query('BEGIN');
    const corpseRes = await client.query(
      `SELECT id, map_key, owner_player_id, owner_hero_id,
              tile_x, tile_y, expires_at, is_fully_looted
         FROM monster_corpses
        WHERE id=$1
        FOR UPDATE`,
      [String(corpseId)],
    );
    const corpse = corpseRes.rows[0];
    if (!corpse) { await client.query('ROLLBACK'); return { error: 'corpse-not-found' }; }
    if (corpse.expires_at && new Date(corpse.expires_at) <= nowDate()) {
      await client.query('ROLLBACK');
      return { error: 'corpse-expired' };
    }
    if (corpse.owner_player_id && corpse.owner_player_id !== String(playerId)) {
      await client.query('ROLLBACK');
      return { error: 'not-owner' };
    }

    const itemRes = await client.query(
      `SELECT id, corpse_id, item_key, amount
         FROM monster_corpse_items
        WHERE id=$1 AND corpse_id=$2
        FOR UPDATE`,
      [String(corpseItemId), String(corpseId)],
    );
    const item = itemRes.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return { error: 'item-not-found' };
    }

    const takeAmount = Math.max(1, Math.min(Number(amount) || item.amount, item.amount));
    const leftover = item.amount - takeAmount;
    if (leftover > 0) {
      await client.query(
        `UPDATE monster_corpse_items SET amount=$3 WHERE id=$1 AND corpse_id=$2`,
        [item.id, item.corpse_id, leftover],
      );
    } else {
      await client.query(
        `DELETE FROM monster_corpse_items WHERE id=$1`,
        [item.id],
      );
    }

    const remaining = await cleanupEmptyCorpse(client, corpse.id, corpse.map_key);
    await client.query('COMMIT');

    return {
      ok: true,
      removed: { id: item.id, itemKey: item.item_key, amount: takeAmount },
      corpse: {
        id: corpse.id,
        mapKey: corpse.map_key,
        tileX: corpse.tile_x,
        tileY: corpse.tile_y,
        isEmpty: remaining === 0,
      },
    };
  });
}

async function dropGroundItem({ mapKey, tileX, tileY, itemKey, amount, droppedByPlayerId = null, droppedByHeroId = null }) {
  const key = String(itemKey || '').trim();
  const amt = Math.max(1, Math.floor(Number(amount) || 0));
  if (!key || !Number.isInteger(Number(tileX)) || !Number.isInteger(Number(tileY)) || amt <= 0) {
    return null;
  }

  const expiresAt = futureDate(GROUND_ITEM_DECAY_SECONDS);
  const res = await get(
    `INSERT INTO ground_items (map_key, tile_x, tile_y, item_key, amount, dropped_by_player_id, dropped_by_hero_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, map_key, tile_x, tile_y, item_key, amount, expires_at`,
    [
      String(mapKey || 'house'),
      Number(tileX) | 0,
      Number(tileY) | 0,
      key,
      amt,
      droppedByPlayerId || null,
      droppedByHeroId || null,
      expiresAt,
    ],
  ).catch(() => null);

  if (res) {
    try {
      broadcastToMap(res.map_key, {
        type: 'ground-item:spawn',
        item: {
          id: res.id,
          mapKey: res.map_key,
          tileX: res.tile_x,
          tileY: res.tile_y,
          itemKey: res.item_key,
          amount: res.amount,
          expiresAt: res.expires_at,
        },
      });
    } catch {}
  }
  return res;
}

async function listGroundItems(mapKey) {
  return await all(
    `SELECT id, map_key, tile_x AS "tileX", tile_y AS "tileY",
            item_key AS "itemKey", amount, expires_at AS "expiresAt"
       FROM ground_items
      WHERE map_key = $1
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at`,
    [String(mapKey || 'house')],
  );
}

async function getGroundItem(groundItemId) {
  return await get(
    `SELECT id, map_key, tile_x AS "tileX", tile_y AS "tileY",
            item_key AS "itemKey", amount
       FROM ground_items
      WHERE id = $1`,
    [String(groundItemId)],
  ).catch(() => null);
}

async function pickupGroundItem({ groundItemId, amount }) {
  return await withClient(async (client) => {
    await client.query('BEGIN');
    const itemRes = await client.query(
      `SELECT id, map_key, tile_x, tile_y, item_key, amount
         FROM ground_items
        WHERE id=$1
        FOR UPDATE`,
      [String(groundItemId)],
    );
    const item = itemRes.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return { error: 'ground-item-not-found' };
    }
    const takeAmount = Math.max(1, Math.min(Number(amount) || item.amount, item.amount));
    const leftover = item.amount - takeAmount;
    if (leftover > 0) {
      await client.query(
        `UPDATE ground_items SET amount=$2 WHERE id=$1`,
        [item.id, leftover],
      );
    } else {
      await client.query(`DELETE FROM ground_items WHERE id=$1`, [item.id]);
    }
    await client.query('COMMIT');

    try {
      if (leftover > 0) {
        broadcastToMap(item.map_key, {
          type: 'ground-item:spawn',
          item: {
            id: item.id,
            mapKey: item.map_key,
            tileX: item.tile_x,
            tileY: item.tile_y,
            itemKey: item.item_key,
            amount: leftover,
          },
        });
      } else {
        broadcastToMap(item.map_key, { type: 'ground-item:removed', itemId: item.id });
      }
    } catch {}

    return {
      ok: true,
      removed: {
        id: item.id,
        itemKey: item.item_key,
        amount: takeAmount,
      },
      mapKey: item.map_key,
      tileX: item.tile_x,
      tileY: item.tile_y,
      remaining: Math.max(0, leftover),
    };
  });
}

async function openCorpse({ corpseId, playerId }) {
  const corpse = await getCorpseWithItems(corpseId);
  if (!corpse) return { error: 'corpse-not-found' };
  if (corpse.expiresAt && new Date(corpse.expiresAt) <= nowDate()) {
    return { error: 'corpse-expired' };
  }
  if (corpse.ownerPlayerId && corpse.ownerPlayerId !== String(playerId)) {
    return { error: 'not-owner' };
  }
  return { ok: true, corpse };
}

async function cleanupExpiredCorpses() {
  const rows = await all(
    `DELETE FROM monster_corpses
      WHERE expires_at IS NOT NULL
        AND expires_at <= now()
     RETURNING id, map_key`,
    [],
  );
  for (const row of rows) {
    try { broadcastToMap(row.map_key, { type: 'corpse:removed', corpseId: row.id }); } catch {}
  }
  return rows.length;
}

async function cleanupExpiredGroundItems() {
  const rows = await all(
    `DELETE FROM ground_items
      WHERE expires_at IS NOT NULL
        AND expires_at <= now()
     RETURNING id, map_key`,
    [],
  );
  for (const row of rows) {
    try { broadcastToMap(row.map_key, { type: 'ground-item:removed', itemId: row.id }); } catch {}
  }
  return rows.length;
}

let cleanupTimer = null;
function startCleanupLoop() {
  if (cleanupTimer) return cleanupTimer;
  const interval = Math.max(30_000, Number(process.env.LOOT_CLEANUP_INTERVAL_MS || 45_000));
  cleanupTimer = setInterval(() => {
    cleanupExpiredCorpses().catch(() => {});
    cleanupExpiredGroundItems().catch(() => {});
  }, interval);
  return cleanupTimer;
}

function stopCleanupLoop() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

async function getHeroTilePosition(playerId, fallbackHeroId = null) {
  const live = getLivePlayerPosition(playerId, { allowStale: true });
  if (live && live.mapKey) {
    const tile = pxToTile(live.x, live.y);
    if (Number.isInteger(tile.tx) && Number.isInteger(tile.ty)) {
      return {
        mapKey: String(live.mapKey).trim(),
        tileX: tile.tx,
        tileY: tile.ty,
        rawX: Number.isFinite(Number(live.x)) ? Number(live.x) : null,
        rawY: Number.isFinite(Number(live.y)) ? Number(live.y) : null,
        tileSource: 'live',
        heroId: live.heroId || fallbackHeroId,
      };
    }
  }
  if (fallbackHeroId) {
    const row = await get(
      `SELECT map_key, x, y FROM hero_last_pos WHERE hero_id = $1`,
      [String(fallbackHeroId)],
    ).catch(() => null);
    if (row) {
      const tile = pxToTile(row.x, row.y);
      return {
        mapKey: String(row.map_key || '').trim(),
        tileX: Number.isInteger(tile.tx) ? tile.tx : (Number(row.x) | 0),
        tileY: Number.isInteger(tile.ty) ? tile.ty : (Number(row.y) | 0),
        rawX: Number.isFinite(Number(row.x)) ? Number(row.x) : null,
        rawY: Number.isFinite(Number(row.y)) ? Number(row.y) : null,
        tileSource: Number.isInteger(tile.tx) && Number.isInteger(tile.ty) ? 'db-tile' : 'db-raw',
        heroId: fallbackHeroId,
      };
    }
  }
  return null;
}

function distanceTiles(a, b) {
  if (!a || !b) return Infinity;
  const at = { tx: a.tileX ?? a.tx, ty: a.tileY ?? a.ty };
  const bt = { tx: b.tileX ?? b.tx, ty: b.tileY ?? b.ty };
  if (!Number.isInteger(at.tx) || !Number.isInteger(at.ty)) return Infinity;
  if (!Number.isInteger(bt.tx) || !Number.isInteger(bt.ty)) return Infinity;
  return chebyshevTiles({ tx: at.tx, ty: at.ty }, { tx: bt.tx, ty: bt.ty });
}

module.exports = {
  // RNG helper
  rollMonsterLoot,

  // Corpses
  createCorpse,
  listCorpses,
  getCorpseWithItems,
  openCorpse,
  takeCorpseItem,

  // Ground items
  dropGroundItem,
  listGroundItems,
  getGroundItem,
  pickupGroundItem,

  // Cleanup
  startCleanupLoop,
  stopCleanupLoop,
  cleanupExpiredCorpses,
  cleanupExpiredGroundItems,

  // Helpers
  getHeroTilePosition,
  distanceTiles,

  // Legacy names kept for compatibility with callers expecting old API
  async createLootFromKill({ mapKey, x, y, items, droppedByPlayerId = null, droppedByHeroId = null }) {
    const tile = pxToTile(x, y);
    const results = [];
    for (const it of items || []) {
      const key = String(it.key || it.itemKey || '').trim();
      const amount = Number(it.amount || it.qty || 0) | 0;
      if (!key || amount <= 0) continue;
      const row = await dropGroundItem({
        mapKey,
        tileX: tile.tx,
        tileY: tile.ty,
        itemKey: key,
        amount,
        droppedByPlayerId,
        droppedByHeroId,
      });
      if (row) results.push(row);
    }
    return results;
  },
  async pickupLoot(groundItemId) {
    return pickupGroundItem({ groundItemId });
  },
  async getMapLoot(mapKey) {
    return listGroundItems(mapKey);
  },
};

// kick off cleanup loop immediately when the module is first required
try { startCleanupLoop(); } catch {}
