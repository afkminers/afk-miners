// server/routes/game_tick.js
const express = require('express');
const router = express.Router();
const { all, get, run } = require('../models/db');
const catalogCache = require('../services/catalogCache');
const { computeMaxHp } = require('../services/heroStats');

console.log('[route-load] game_tick PATCH v4 (chatCursor + safer)');

router.get('/tick', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const sinceChatId = req.query.sinceChatId ? Number(req.query.sinceChatId) : 0;
    const includeLoot = req.query.includeLoot === 'true';
    const includeCombat = req.query.includeCombat === 'true';

    const response = {
      now: Date.now(),
      nowServer: Date.now(),
      pos: null,
      hero: null,
      chat: [],
      chatCursor: sinceChatId || 0,
      loot: null,
      combat: null,
      backpack: null
    };

    // --- Position
    try {
      const posRow = await get(
        `SELECT map_key, x, y, last_seq
           FROM player_last_pos
          WHERE player_id = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [playerId]
      );
      if (posRow) {
        response.pos = {
          mapKey: posRow.map_key,
          x: posRow.x,
          y: posRow.y,
          lastSeq: posRow.last_seq
        };
      }
    } catch (e) {
      console.warn('[game-tick] pos query failed:', e.message);
    }

    // --- Hero
    try {
      const heroRow = await get(
        `SELECT
           id,
           "heroKey",
           name,
           rarity,
           attack,
           defense,
           speed,
           level,
           "isStarter",
           "createdAt",
           "updatedAt",
           "playerId",
           xp,
           hp,
           max_hp
         FROM player_heroes
         WHERE "playerId" = $1
         ORDER BY "createdAt" ASC
         LIMIT 1`,
        [playerId]
      );

      if (heroRow) {
        let { hp, max_hp } = heroRow;
        if (hp == null || max_hp == null) {
          max_hp = computeMaxHp(heroRow);
          hp = max_hp;
          try {
            await run(
              `UPDATE player_heroes
                 SET hp=$1, max_hp=$2, "updatedAt"=NOW()
               WHERE id=$3`,
              [hp, max_hp, heroRow.id]
            );
          } catch (upErr) {
            console.warn('[game-tick] backfill hp/max_hp falhou:', upErr.message);
          }
        }
        response.hero = {
          id: heroRow.id,
          heroKey: heroRow.heroKey,
          name: heroRow.name,
          level: heroRow.level,
          xp: heroRow.xp || 0,
          attack: heroRow.attack,
          defense: heroRow.defense,
          speed: heroRow.speed,
          rarity: heroRow.rarity,
          isStarter: heroRow.isStarter,
          createdAt: heroRow.createdAt,
          updatedAt: heroRow.updatedAt,
          hp,
            maxHp: max_hp,
          class: null
        };
      }
    } catch (e) {
      console.warn('[game-tick] hero query failed:', e.message);
    }

    // --- Chat (incremental)
    try {
      const chatQuery = sinceChatId > 0
        ? `SELECT id, scope, fromid AS "fromId", fromname AS "fromName", text, created_at AS "createdAt"
             FROM chat_messages
            WHERE scope = 'global' AND id > $1
            ORDER BY id ASC
            LIMIT 50`
        : `SELECT id, scope, fromid AS "fromId", fromname AS "fromName", text, created_at AS "createdAt"
             FROM chat_messages
            WHERE scope = 'global'
            ORDER BY id DESC
            LIMIT 10`;

      const params = sinceChatId > 0 ? [sinceChatId] : [];
      let chatRows = await all(chatQuery, params);

      // Se era a primeira chamada (sinceChatId=0), invertido porque pedimos DESC
      if (sinceChatId === 0) chatRows = chatRows.reverse();

      response.chat = chatRows;
      if (chatRows.length > 0) {
        const last = chatRows[chatRows.length - 1].id;
        response.chatCursor = last;
      } else {
        // se não voltou nada e já tínhamos sinceChatId > 0, mantém cursor como estava
        response.chatCursor = response.chatCursor || sinceChatId;
      }
    } catch (e) {
      console.warn('[game-tick] chat query failed:', e.message);
    }

    // --- Loot
    if (includeLoot && response.pos?.mapKey) {
      try {
        const lootRows = await all(
          `SELECT id, item_key, qty, x, y, created_at
             FROM map_loot
            WHERE map_key = $1
              AND expires_at > now()
            ORDER BY created_at DESC
            LIMIT 50`,
          [response.pos.mapKey]
        );
        response.loot = lootRows.map(r => ({
          id: r.id,
          itemKey: r.item_key,
          qty: r.qty,
          x: r.x,
          y: r.y,
          createdAt: r.created_at
        }));
      } catch (e) {
        console.warn('[game-tick] loot query failed:', e.message);
      }
    }

    // --- Combat
    if (includeCombat && response.pos?.mapKey) {
      try {
        const combatRows = await all(
          `SELECT mi.id, mi.monster_key, mi.x, mi.y, mi.hp, mi.max_hp, mi.alive
             FROM monster_instances mi
        LEFT JOIN spawns s ON s.id = mi.spawn_id
            WHERE COALESCE(mi.map_key, s."mapKey") = $1
              AND mi.alive = true
            ORDER BY mi.id
            LIMIT 100`,
          [response.pos.mapKey]
        );
        response.combat = combatRows.map(r => ({
          id: r.id,
          monsterKey: r.monster_key,
          x: r.x,
          y: r.y,
          hp: r.hp,
          maxHp: r.max_hp,
          alive: r.alive
        }));
      } catch (e) {
        console.warn('[game-tick] combat query failed:', e.message);
      }
    }

    // --- Backpack
    try {
      const heroId = response.hero?.id || null;
      if (heroId) {
        const backpackRows = await all(
          `SELECT slot_index, item_key, qty
             FROM hero_backpack_slots
            WHERE hero_id = $1 AND item_key IS NOT NULL
            ORDER BY slot_index`,
          [heroId]
        );
        response.backpack = backpackRows.map(r => ({
          slot: r.slot_index,
          itemKey: r.item_key,
          qty: r.qty
        }));
      } else {
        response.backpack = [];
      }
    } catch (e) {
      console.warn('[game-tick] backpack query failed:', e.message);
    }

    return res.json(response);
  } catch (err) {
    console.error('[game-tick] fatal error:', err.message);
    return res.status(500).json({ error: 'internal-error' });
  }
});

module.exports = router;