// server/routes/game_tick.js
// Aggregated game tick endpoint to reduce polling overhead

const express = require('express');
const router = express.Router();
const { all, get, run } = require('../models/db');
const catalogCache = require('../services/catalogCache');

/**
 * GET /api/game/tick
 * Aggregated endpoint that returns combined game state to reduce multiple API calls
 * Query params:
 * - sinceChatId: only return chat messages after this ID
 * - includeLoot: include loot data (default: true)
 * - includeCombat: include combat data (default: true)
 */
router.get('/tick', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const sinceChatId = req.query.sinceChatId ? Number(req.query.sinceChatId) : 0;
    const includeLoot = req.query.includeLoot !== 'false';
    const includeCombat = req.query.includeCombat !== 'false';
    
    const response = {
      now: Date.now(),
      pos: null,
      hero: null,
      chat: [],
      loot: null,
      combat: null,
      backpack: null
    };

    // Get player position
    try {
      const posRow = await get(
        `SELECT map_key, x, y, last_seq FROM player_last_pos 
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
    } catch (error) {
      console.warn('[game-tick] pos query failed:', error.message);
    }

    // Get hero data (basic info)
    try {
      const heroRow = await get(
        `SELECT id, name, level, xp, hp, max_hp, class 
         FROM player_heroes 
         WHERE player_id = $1 
         ORDER BY created_at ASC 
         LIMIT 1`,
        [playerId]
      );
      if (heroRow) {
        response.hero = {
          id: heroRow.id,
          name: heroRow.name,
          level: heroRow.level,
          xp: heroRow.xp,
          hp: heroRow.hp,
          maxHp: heroRow.max_hp,
          class: heroRow.class
        };
      }
    } catch (error) {
      console.warn('[game-tick] hero query failed:', error.message);
    }

    // Get recent chat messages
    try {
      const chatQuery = sinceChatId > 0 
        ? `SELECT id, scope, fromid AS "fromId", fromname AS "fromName", text, created_at AS "createdAt"
           FROM chat_messages 
           WHERE scope = 'global' AND id > $1 
           ORDER BY id DESC 
           LIMIT 20`
        : `SELECT id, scope, fromid AS "fromId", fromname AS "fromName", text, created_at AS "createdAt"
           FROM chat_messages 
           WHERE scope = 'global' 
           ORDER BY id DESC 
           LIMIT 10`;
      
      const chatParams = sinceChatId > 0 ? [sinceChatId] : [];
      const chatRows = await all(chatQuery, chatParams);
      response.chat = chatRows.reverse(); // chronological order
    } catch (error) {
      console.warn('[game-tick] chat query failed:', error.message);
    }

    // Get loot data if requested
    if (includeLoot && response.pos?.mapKey) {
      try {
        const lootRows = await all(
          `SELECT id, item_key, qty, x, y, created_at 
           FROM map_loot 
           WHERE map_key = $1 AND expires_at > now() 
           ORDER BY created_at DESC 
           LIMIT 50`,
          [response.pos.mapKey]
        );
        
        response.loot = lootRows.map(row => ({
          id: row.id,
          itemKey: row.item_key,
          qty: row.qty,
          x: row.x,
          y: row.y,
          createdAt: row.created_at
        }));
      } catch (error) {
        console.warn('[game-tick] loot query failed:', error.message);
      }
    }

    // Get combat data if requested
    if (includeCombat && response.pos?.mapKey) {
      try {
        const combatRows = await all(
          `SELECT mi.id, mi.monster_key, mi.x, mi.y, mi.hp, mi.max_hp, mi.alive
           FROM monster_instances mi
           WHERE mi.map_key = $1 AND mi.alive = true
           ORDER BY mi.id
           LIMIT 100`,
          [response.pos.mapKey]
        );
        
        response.combat = combatRows.map(row => ({
          id: row.id,
          monsterKey: row.monster_key,
          x: row.x,
          y: row.y,
          hp: row.hp,
          maxHp: row.max_hp,
          alive: row.alive
        }));
      } catch (error) {
        console.warn('[game-tick] combat query failed:', error.message);
      }
    }

    // Get backpack data
    try {
      const backpackRows = await all(
        `SELECT slot_index, item_key, qty 
         FROM hero_backpack_slots 
         WHERE hero_id = $1 AND item_key IS NOT NULL 
         ORDER BY slot_index`,
        [response.hero?.id || '']
      );
      
      response.backpack = backpackRows.map(row => ({
        slot: row.slot_index,
        itemKey: row.item_key,
        qty: row.qty
      }));
    } catch (error) {
      console.warn('[game-tick] backpack query failed:', error.message);
    }

    res.json(response);
  } catch (error) {
    console.error('[game-tick] error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;