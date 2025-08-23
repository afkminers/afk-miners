// server/starter/routes.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");

// helpers sqlite (promises)
function qget(db, sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
}
function qall(db, sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
}
function qrun(db, sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
}

// garante uma tabela simples com a pool de starters (apenas heroKey)
async function ensureStarterPool(db) {
  await qrun(db, `
    CREATE TABLE IF NOT EXISTS starters_pool (
      heroKey TEXT PRIMARY KEY
    );
  `);

  // se estiver vazia, seed com os 3 comuns (pode mudar depois direto no BD)
  const count = await qget(db, `SELECT COUNT(*) AS c FROM starters_pool`, []);
  if (!count || count.c === 0) {
    await qrun(db, `INSERT OR IGNORE INTO starters_pool(heroKey) VALUES (?), (?), (?)`, [
      'aric', 'brokk', 'lyria'
    ]);
  }

  const keys = await qall(db, `SELECT heroKey FROM starters_pool ORDER BY heroKey`, []);
  return keys.map(k => k.heroKey);
}

// monta payload do starter juntando heroes_master + sprites_master (dataJSON.image)
async function loadStarters(db) {
  const pool = await ensureStarterPool(db);
  if (pool.length === 0) return [];

  const placeholders = pool.map(() => '?').join(',');
  const rows = await qall(db, `
    SELECT
      h.heroKey, h.name, h.rarity, h.class, h.role, h.element,
      h.attack_type, h.weapon_pref, h.spriteKey,
      h.base_attack, h.base_defense, h.base_speed,
      s.dataJSON AS spriteJSON
    FROM heroes_master h
    LEFT JOIN sprites_master s
      ON s.key = h.spriteKey AND s.kind = 'character'
    WHERE h.heroKey IN (${placeholders})
    ORDER BY h.heroKey
  `, pool);

  return rows.map(r => {
    let imagePath = null;
    try {
      const sj = r.spriteJSON ? JSON.parse(r.spriteJSON) : {};
      // YAML costuma ter "image": "sprites/characters/knight.png"
      if (sj && sj.image) imagePath = sj.image;
    } catch { /* ignore */ }

    return {
      heroKey: r.heroKey,
      name: r.name,
      rarity: r.rarity,
      class: r.class,
      role: r.role,
      element: r.element,
      attack_type: r.attack_type,
      weapon_pref: r.weapon_pref,
      spriteKey: r.spriteKey,
      image: imagePath // usado pelo cliente
    };
  });
}

module.exports = function buildStarterRouter(db) {
  const router = express.Router();

  // GET /api/starter/list  -> lista vinda do BD
  router.get("/list", async (req, res) => {
    try {
      const list = await loadStarters(db);
      res.json(list);
    } catch (err) {
      console.error("[starter] list error:", err);
      res.status(500).json({ error: "erro ao listar starters" });
    }
  });

  // GET /api/starter/status -> se já tem starter marcado
  router.get("/status", async (req, res) => {
    try {
      const playerId = req.user.id;
      const row = await qget(db,
        `SELECT 1 FROM player_heroes WHERE playerId=? AND isStarter=1 LIMIT 1`,
        [playerId]
      );
      res.json({ canSelect: !row });
    } catch (err) {
      console.error("[starter] status error:", err);
      res.status(500).json({ error: "erro ao checar status do starter" });
    }
  });

  // POST /api/starter/select { heroKey }
  router.post("/select", async (req, res) => {
    try {
      const playerId = req.user.id;
      const heroKey = (req.body?.heroKey || '').toString().trim();
      if (!heroKey) {
        return res.status(400).json({ error: "heroKey é obrigatório" });
      }

      // 1) já tem starter?
      const exists = await qget(db,
        `SELECT 1 FROM player_heroes WHERE playerId=? AND isStarter=1 LIMIT 1`,
        [playerId]
      );
      if (exists) {
        return res.status(400).json({ error: "starter já escolhido" });
      }

      // 2) validar se heroKey está na pool
      const pool = await ensureStarterPool(db);
      if (!pool.includes(heroKey)) {
        return res.status(400).json({ error: "heroKey inválido para starter" });
      }

      // 3) buscar dados do herói (nome e stats base) no BD
      const h = await qget(db, `
        SELECT name, rarity, base_attack, base_defense, base_speed
        FROM heroes_master
        WHERE heroKey = ?
        LIMIT 1
      `, [heroKey]);

      if (!h) {
        return res.status(404).json({ error: "herói não encontrado no catálogo" });
      }

      const id = uuidv4();
      const createdAt = Date.now();

      await qrun(db, `
        INSERT INTO player_heroes
          (id, playerId, heroKey, name, rarity, attack, defense, speed, level, createdAt, isStarter)
        VALUES
          (?,  ?,        ?,       ?,    ?,      ?,      ?,       ?,     1,      ?,        1)
      `, [
        id, playerId, heroKey,
        h.name || heroKey.toUpperCase(),
        h.rarity || "COMMON",
        Number(h.base_attack ?? 1),
        Number(h.base_defense ?? 1),
        Number(h.base_speed ?? 1),
        createdAt
      ]);

      res.json({ ok: true, heroKey, id });
    } catch (err) {
      if (String(err?.message || '').includes("UNIQUE constraint")) {
        return res.status(400).json({ error: "starter já escolhido" });
      }
      console.error("[starter] select error:", err);
      res.status(500).json({ error: "erro ao selecionar starter" });
    }
  });

  return router;
};
