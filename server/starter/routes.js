// server/starter/routes.js
const express = require("express");
const { randomUUID } = require("crypto"); // ⬅️ substitui 'uuid'

function buildStarterRouter(db) {
  const router = express.Router();

  // Lista os starters (ideal: puxar do BD; por ora mantém como está/ajuste quando quiser)
  router.get("/list", async (req, res) => {
    try {
      const starters = [
        {
          heroKey: "aric",
          name: "Aric, the Swordsman",
          rarity: "COMMON",
          class: "KNIGHT",
          role: "DPS",
          element: "NEUTRAL",
          attack_type: "MELEE",
          weapon_pref: "sword",
          spriteKey: "knight_v1",
        },
        {
          heroKey: "brokk",
          name: "Brokk, the Dwarf",
          rarity: "COMMON",
          class: "KNIGHT",
          role: "TANK",
          element: "EARTH",
          attack_type: "MELEE",
          weapon_pref: "hammer_shield",
          spriteKey: "dwarf_v1",
        },
        {
          heroKey: "lyria",
          name: "Lyria, the Archer",
          rarity: "COMMON",
          class: "PALADIN",
          role: "DPS",
          element: "NATURE",
          attack_type: "RANGED",
          weapon_pref: "bow",
          spriteKey: "archer_v1",
        },
      ];
      res.json(starters);
    } catch (err) {
      console.error("[starter] list error:", err);
      res.status(500).json({ error: "erro ao listar starters" });
    }
  });

  // Status: pode escolher starter?
  router.get("/status", async (req, res) => {
    try {
      const playerId = req.user.id;
      const row = await new Promise((resolve, reject) => {
        db.get(
          `SELECT 1 FROM player_heroes WHERE playerId=? AND isStarter=1 LIMIT 1`,
          [playerId],
          (err, r) => (err ? reject(err) : resolve(r))
        );
      });
      res.json({ canSelect: !row });
    } catch (err) {
      console.error("[starter] status error:", err);
      res.status(500).json({ error: "erro ao checar status do starter" });
    }
  });

  // Escolher starter
  router.post("/select", async (req, res) => {
    try {
      const playerId = req.user.id;
      const { heroKey } = req.body || {};
      if (!heroKey) {
        return res.status(400).json({ error: "heroKey é obrigatório" });
      }

      // já tem starter?
      const exists = await new Promise((resolve, reject) => {
        db.get(
          `SELECT 1 FROM player_heroes WHERE playerId=? AND isStarter=1 LIMIT 1`,
          [playerId],
          (err, r) => (err ? reject(err) : resolve(r))
        );
      });
      if (exists) {
        return res.status(400).json({ error: "starter já escolhido" });
      }

      const id = randomUUID(); // ⬅️ agora usa crypto
      const createdAt = Date.now();

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO player_heroes
            (id, playerId, heroKey, name, rarity, attack, defense, speed, level, createdAt, isStarter)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            id,
            playerId,
            heroKey,
            heroKey.toUpperCase(),
            "COMMON",
            1, 1, 1, 1,
            createdAt,
          ],
          function (err) {
            if (err) reject(err);
            else resolve(this);
          }
        );
      });

      res.json({ ok: true, heroKey, id });
    } catch (err) {
      if (String(err.message).includes("UNIQUE constraint")) {
        return res.status(400).json({ error: "starter já escolhido" });
      }
      console.error("[starter] select error:", err);
      res.status(500).json({ error: "erro ao selecionar starter" });
    }
  });

  return router;
}

module.exports = { buildStarterRouter };
