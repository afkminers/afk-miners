// server/routes/loot.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { run, all, get } = require('../models/db');
const { listBackpack, getBackpackSpec, putLootItemsForHero } = require('../services/backpack');
const lootSvc = require('../services/loot');
const lootCache = require('../services/lootCache');
const { TILE } = require('../utils/tile-coords');

const CORPSE_RANGE = Math.max(1, Number(process.env.CORPSE_LOOT_RANGE_TILES || 1));
const GROUND_RANGE = Math.max(1, Number(process.env.GROUND_ITEM_RANGE_TILES || CORPSE_RANGE));

function normalizeMapKey(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase();
}

function resolveTileCoord(tileValue, rawValue, sourceHint = null) {
  const tileNum = Number(tileValue);
  if (Number.isInteger(tileNum) && sourceHint !== 'db-raw') {
    return tileNum;
  }
  const rawNum = Number(rawValue);
  if (sourceHint === 'db-raw' && Number.isFinite(rawNum)) {
    return Math.floor(rawNum / TILE);
  }
  if (Number.isFinite(rawNum)) {
    return Math.floor(rawNum / TILE);
  }
  if (Number.isFinite(tileNum)) {
    return Math.floor(tileNum);
  }
  return NaN;
}

router.use(requireAuth);

/* =========================================================================
   Guardião: ownership + alive=true
   ========================================================================= */
async function assertHeroAliveOwned(playerId, heroId) {
  const row = await get(
    `SELECT alive FROM player_heroes WHERE id=$1 AND "playerId"=$2`,
    [String(heroId), String(playerId)]
  );
  if (!row) return { ok: false, code: 404, error: 'hero-not-found' };
  if (row.alive === false) return { ok: false, code: 409, error: 'hero-dead' };
  return { ok: true };
}

// Remoção de itens da mochila (distribui entre slots)
async function takeFromBackpack(heroId, itemKey, qty) {
  const H = String(heroId);
  const K = String(itemKey);
  let left = Number(qty) | 0;
  if (!H || !K || left <= 0) return 0;

  const rows = await all(
    `SELECT slot_index AS "slotIndex", qty
       FROM hero_backpack_slots
      WHERE hero_id=$1 AND item_key=$2 AND qty > 0
      ORDER BY slot_index`,
    [H, K]
  );

  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(r.qty) || 0);
    const newQty = (Number(r.qty) || 0) - take;

    if (newQty > 0) {
      await run(
        `UPDATE hero_backpack_slots
            SET qty=$3
          WHERE hero_id=$1 AND slot_index=$2`,
        [H, Number(r.slotIndex), newQty]
      );
    } else {
      await run(
        `UPDATE hero_backpack_slots
            SET item_key=NULL, qty=0
          WHERE hero_id=$1 AND slot_index=$2`,
        [H, Number(r.slotIndex)]
      );
    }
    left -= take;
  }

  return (Number(qty) | 0) - left; // quanto foi removido
}

async function ensureHeroProximity({ playerId, heroId, mapKey, tileX, tileY, posX = null, posY = null, range }) {
  const pos = await lootSvc.getHeroTilePosition(playerId, heroId);
  if (!pos || pos.mapKey == null) {
    return { ok: false, code: 409, error: 'hero-pos-unavailable' };
  }
  const heroMapKey = normalizeMapKey(pos.mapKey);
  const targetMapKey = normalizeMapKey(mapKey) || heroMapKey;
  if (heroMapKey && targetMapKey && heroMapKey !== targetMapKey) {
    console.warn('[loot] wrong-map', {
      playerId: String(playerId),
      heroId: String(heroId),
      heroMapKey,
      corpseMapKey: targetMapKey,
    });
    return { ok: false, code: 409, error: 'wrong-map' };
  }
  const heroTile = {
    tileX: resolveTileCoord(pos.tileX, pos.rawX, pos.tileSource),
    tileY: resolveTileCoord(pos.tileY, pos.rawY, pos.tileSource),
  };
  const corpseTile = {
    tileX: resolveTileCoord(tileX, posX, null),
    tileY: resolveTileCoord(tileY, posY, null),
  };
  const dist = lootSvc.distanceTiles(heroTile, corpseTile);
  if (!Number.isFinite(dist) || dist > range) {
    return { ok: false, code: 409, error: 'too-far', distance: dist };
  }
  return { ok: true, pos, distance: dist };
}

// Lista loots do mapa (com cache TTL)
router.get('/map/:mapKey/loot', async (req, res) => {
  try {
    const mapKey = String(req.params.mapKey);
    const rows = await lootCache.getMapLoot(mapKey);
    res.json(rows);
  } catch (e) {
    console.error('[loot] list', e.message);
    res.status(500).json({ error: 'loot-list-failed' });
  }
});

// Lista corpos ativos do mapa
router.get('/map/:mapKey/corpses', async (req, res) => {
  try {
    const mapKey = String(req.params.mapKey);
    const rows = await lootSvc.listCorpses(mapKey);
    res.json(rows);
  } catch (e) {
    console.error('[loot] corpses list', e.message);
    res.status(500).json({ error: 'corpse-list-failed' });
  }
});

// Abrir corpse
router.post('/loot/corpse/open', express.json(), async (req, res) => {
  try {
    const corpseId = String(req.body?.corpseId || '').trim();
    const heroId = String(req.body?.heroId || '').trim();
    if (!corpseId || !heroId) return res.status(400).json({ error: 'bad-args' });

    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok: false, error: chk.error });

    const corpse = await lootSvc.getCorpseWithItems(corpseId);
    if (!corpse) return res.status(404).json({ error: 'corpse-not-found' });
    if (corpse.ownerPlayerId && corpse.ownerPlayerId !== String(req.user.id)) {
      return res.status(403).json({ error: 'not-owner' });
    }
    if (corpse.expiresAt && new Date(corpse.expiresAt) <= new Date()) {
      return res.status(410).json({ error: 'corpse-expired' });
    }

    const corpseMapKey = corpse.mapKey || corpse.map_key || null;

    const near = await ensureHeroProximity({
      playerId: req.user.id,
      heroId,
      mapKey: corpseMapKey,
      tileX: corpse.tileX,
      tileY: corpse.tileY,
      posX: corpse.posX,
      posY: corpse.posY,
      range: CORPSE_RANGE,
    });
    if (!near.ok) return res.status(near.code).json({ ok: false, error: near.error });

    res.json({ ok: true, corpse });
  } catch (e) {
    console.error('[loot] corpse open', e.message);
    res.status(500).json({ error: 'corpse-open-failed' });
  }
});

// Pegar item do corpse
router.post('/loot/corpse/take', express.json(), async (req, res) => {
  try {
    const heroId = String(req.body?.heroId || '').trim();
    const corpseId = String(req.body?.corpseId || '').trim();
    const corpseItemId = String(req.body?.corpseItemId || '').trim();
    const amount = Number(req.body?.amount || 0) | 0;

    if (!heroId || !corpseId || !corpseItemId) {
      return res.status(400).json({ error: 'bad-args' });
    }

    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok: false, error: chk.error });

    const corpse = await lootSvc.getCorpseWithItems(corpseId);
    if (!corpse) return res.status(404).json({ error: 'corpse-not-found' });
    if (corpse.ownerPlayerId && corpse.ownerPlayerId !== String(req.user.id)) {
      return res.status(403).json({ error: 'not-owner' });
    }
    if (corpse.expiresAt && new Date(corpse.expiresAt) <= new Date()) {
      return res.status(410).json({ error: 'corpse-expired' });
    }

    const corpseMapKey = corpse.mapKey || corpse.map_key || null;

    const near = await ensureHeroProximity({
      playerId: req.user.id,
      heroId,
      mapKey: corpseMapKey,
      tileX: corpse.tileX,
      tileY: corpse.tileY,
      posX: corpse.posX,
      posY: corpse.posY,
      range: CORPSE_RANGE,
    });
    if (!near.ok) return res.status(near.code).json({ ok: false, error: near.error });

    const dropTarget = req.body?.drop || null;
    const wantsDrop = dropTarget && (dropTarget.tileX != null || dropTarget.tileY != null || dropTarget.x != null || dropTarget.y != null);
    let dropTileX = null;
    let dropTileY = null;
    let dropMapKey = corpseMapKey;
    if (wantsDrop) {
      dropTileX = Number.isInteger(dropTarget.tileX) ? dropTarget.tileX : Number.isInteger(dropTarget.x) ? dropTarget.x : null;
      dropTileY = Number.isInteger(dropTarget.tileY) ? dropTarget.tileY : Number.isInteger(dropTarget.y) ? dropTarget.y : null;
      dropMapKey = dropTarget.mapKey ? String(dropTarget.mapKey) : corpseMapKey;
      if (!Number.isInteger(dropTileX) || !Number.isInteger(dropTileY)) {
        return res.status(400).json({ error: 'bad-drop-target' });
      }
      const dropCheck = await ensureHeroProximity({
        playerId: req.user.id,
        heroId,
        mapKey: dropMapKey,
        tileX: dropTileX,
        tileY: dropTileY,
        range: GROUND_RANGE,
      });
      if (!dropCheck.ok) return res.status(dropCheck.code).json({ ok: false, error: dropCheck.error });
    }

    const takeRes = await lootSvc.takeCorpseItem({
      corpseId,
      corpseItemId,
      amount,
      playerId: req.user.id,
    });
    if (!takeRes?.ok) {
      const status = takeRes?.error === 'corpse-not-found' ? 404 : 409;
      return res.status(status).json({ ok: false, error: takeRes?.error || 'corpse-take-failed' });
    }

    const removed = takeRes.removed;
    let placed = [];
    let leftover = [];
    const droppedList = [];

    if (wantsDrop) {
      const dropRow = await lootSvc.dropGroundItem({
        mapKey: dropMapKey,
        tileX: dropTileX,
        tileY: dropTileY,
        itemKey: removed.itemKey,
        amount: removed.amount,
        droppedByPlayerId: req.user.id,
        droppedByHeroId: heroId,
      });
      if (dropRow) droppedList.push(dropRow);
      lootCache.invalidateMap(dropMapKey);
    } else {
      const putResult = await putLootItemsForHero(heroId, [
        { key: removed.itemKey, amount: removed.amount },
      ]);
      placed = putResult.placed || [];
      leftover = putResult.leftover || [];

      if (Array.isArray(leftover) && leftover.length > 0) {
        for (const spill of leftover) {
          const dropRow = await lootSvc.dropGroundItem({
            mapKey: corpse.mapKey,
            tileX: corpse.tileX,
            tileY: corpse.tileY,
            itemKey: spill.key,
            amount: spill.amount,
            droppedByPlayerId: req.user.id,
            droppedByHeroId: heroId,
          });
          if (dropRow) droppedList.push(dropRow);
        }
        lootCache.invalidateMap(corpse.mapKey);
      }
    }

    const snapshot = await listBackpack(heroId);
    const spec = await getBackpackSpec(heroId);
    const updatedCorpse = await lootSvc.getCorpseWithItems(corpseId);

    const backpackSnapshot = {
      heroId: String(heroId),
      capacity: snapshot.capacity,
      used: snapshot.used,
      items: snapshot.items,
      backpackKey: spec.key,
    };

    res.json({
      ok: true,
      removed,
      corpse: updatedCorpse || takeRes.corpse,
      placed,
      leftover,
      dropped: droppedList,
      snapshot: backpackSnapshot,
      backpack: backpackSnapshot,
    });
  } catch (e) {
    console.error('[loot] corpse take', e.message);
    res.status(500).json({ error: 'corpse-take-failed' });
  }
});

// Pickup ground item
router.post('/loot/pickup', express.json(), async (req, res) => {
  try {
    const heroId = String(req.body?.heroId || '').trim();
    const lootId = String(req.body?.lootId || '').trim();
    const amount = Number(req.body?.amount || 0) | 0;
    if (!heroId || !lootId) return res.status(400).json({ error: 'bad-args' });

    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok: false, error: chk.error });

    const spec = await getBackpackSpec(heroId);
    const capacity = Number(spec?.slots || 0);
    if (!capacity) return res.status(400).json({ error: 'no-backpack' });

    const item = await lootSvc.getGroundItem(lootId);
    if (!item) return res.status(404).json({ error: 'loot-not-found' });

    const near = await ensureHeroProximity({
      playerId: req.user.id,
      heroId,
      mapKey: item.mapKey,
      tileX: item.tileX,
      tileY: item.tileY,
      range: GROUND_RANGE,
    });
    if (!near.ok) return res.status(near.code).json({ ok: false, error: near.error });

    const picked = await lootSvc.pickupGroundItem({ groundItemId: lootId, amount });
    if (!picked?.ok) {
      return res.status(409).json({ ok: false, error: picked?.error || 'loot-pickup-failed' });
    }

    lootCache.invalidateMap(item.mapKey);

    const { placed, leftover } = await putLootItemsForHero(heroId, [
      { key: picked.removed.itemKey, amount: picked.removed.amount },
    ]);

    const droppedLeftover = [];
    if (Array.isArray(leftover) && leftover.length > 0) {
      for (const spill of leftover) {
        const dropRow = await lootSvc.dropGroundItem({
          mapKey: item.mapKey,
          tileX: item.tileX,
          tileY: item.tileY,
          itemKey: spill.key,
          amount: spill.amount,
          droppedByPlayerId: req.user.id,
          droppedByHeroId: heroId,
        });
        if (dropRow) droppedLeftover.push(dropRow);
      }
      lootCache.invalidateMap(item.mapKey);
    }

    const data = await listBackpack(heroId);
    const spec2 = await getBackpackSpec(heroId);

    const backpackSnapshot = {
      heroId: String(heroId),
      capacity: data.capacity,
      used: data.used,
      items: data.items,
      backpackKey: spec2.key,
    };

    res.json({
      ok: true,
      removed: picked.removed,
      placed,
      leftover,
      dropped: droppedLeftover,
      snapshot: backpackSnapshot,
      backpack: backpackSnapshot,
    });
  } catch (e) {
    console.error('[loot] pickup', e.message);
    res.status(500).json({ error: 'loot-pickup-failed' });
  }
});

// Drop item on ground
router.post('/loot/drop', express.json(), async (req, res) => {
  try {
    const heroId = String(req.body?.heroId || '').trim();
    const itemKey = String(req.body?.itemKey || '').trim();
    const qty = Number(req.body?.qty || 0) | 0;
    const mapKey = String(req.body?.mapKey || '').trim();
    const tileX = Number(req.body?.x);
    const tileY = Number(req.body?.y);

    if (!heroId || !itemKey || !mapKey || !Number.isInteger(tileX) || !Number.isInteger(tileY) || qty <= 0) {
      return res.status(400).json({ error: 'bad-args' });
    }

    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok: false, error: chk.error });

    const near = await ensureHeroProximity({
      playerId: req.user.id,
      heroId,
      mapKey,
      tileX,
      tileY,
      range: GROUND_RANGE,
    });
    if (!near.ok) return res.status(near.code).json({ ok: false, error: near.error });

    const removed = await takeFromBackpack(heroId, itemKey, qty);
    if (removed < qty) return res.status(400).json({ error: 'not-enough-qty' });

    await lootSvc.dropGroundItem({
      mapKey,
      tileX,
      tileY,
      itemKey,
      amount: qty,
      droppedByPlayerId: req.user.id,
      droppedByHeroId: heroId,
    });

    lootCache.invalidateMap(mapKey);

    const data = await listBackpack(heroId);
    const spec = await getBackpackSpec(heroId);

    const backpackSnapshot = {
      heroId,
      capacity: data.capacity,
      used: data.used,
      items: data.items,
      backpackKey: spec.key,
    };

    res.json({
      ok: true,
      snapshot: backpackSnapshot,
      backpack: backpackSnapshot,
    });
  } catch (e) {
    console.error('[loot] drop', e.message);
    res.status(500).json({ error: 'drop-failed' });
  }
});

// Debug endpoint to check cache stats (development only)
router.get('/cache/stats', async (_req, res) => {
  try {
    const stats = lootCache.getStats();
    res.json(stats);
  } catch (e) {
    console.error('[loot] cache stats', e.message);
    res.status(500).json({ error: 'cache-stats-failed' });
  }
});

module.exports = router;
