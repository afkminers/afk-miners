const express = require("express");
const router = express.Router();

module.exports = (db) => {
  router.get("/assets/sprites", (req, res) => {
    db.all("SELECT key, kind, dataJSON FROM sprites_master ORDER BY key", (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows.map(r => ({ key: r.key, kind: r.kind, data: JSON.parse(r.dataJSON) })));
    });
  });

  router.get("/assets/items", (req, res) => {
    db.all("SELECT key, dataJSON FROM items_master ORDER BY key", (e, rows) => {
      if (e) return res.status(500).json({ error: e.message });
      res.json(rows.map(r => ({ key: r.key, data: JSON.parse(r.dataJSON) })));
    });
  });

  return router;
};
