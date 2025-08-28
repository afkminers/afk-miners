// server/routes/assets.js
const express = require("express");
const { all } = require("../models/db");

const router = express.Router();

// GET /api/assets/sprites
router.get("/assets/sprites", async (_req, res) => {
  try {
    const rows = await all(
      `SELECT key, kind, dataJSON
         FROM sprites_master
        ORDER BY key`
    );
    res.json(
      rows.map(r => ({
        key: r.key,
        kind: r.kind,
        data: JSON.parse(r.datajson || r.dataJSON) // pg tende a vir em minúsculo
      }))
    );
  } catch (e) {
    console.error("[assets/sprites] error:", e);
    res.status(500).json({ error: "Falha ao listar sprites" });
  }
});

// GET /api/assets/items
router.get("/assets/items", async (_req, res) => {
  try {
    const rows = await all(
      `SELECT key, dataJSON
         FROM items_master
        ORDER BY key`
    );
    res.json(
      rows.map(r => ({
        key: r.key,
        data: JSON.parse(r.datajson || r.dataJSON)
      }))
    );
  } catch (e) {
    console.error("[assets/items] error:", e);
    res.status(500).json({ error: "Falha ao listar items" });
  }
});

module.exports = router;