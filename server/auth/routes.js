// server/auth/routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const { get, run } = require('../models/db');
const {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} = require('./middleware');

const router = express.Router();

/* ---------------- validações ---------------- */
function validateName(raw) {
  const name = (raw || '').trim();
  if (name.length < 3 || name.length > 20) return { ok: false, msg: 'Nome deve ter entre 3 e 20 caracteres.' };
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return { ok: false, msg: 'Use apenas letras, números, espaço, _ e -.' };
  const reserved = ['admin', 'moderador', 'gm', 'support'];
  if (reserved.includes(name.toLowerCase())) return { ok: false, msg: 'Este nome é reservado.' };
  return { ok: true, name };
}
function validatePassword(raw) {
  const p = (raw || '');
  if (p.length < 6) return { ok: false, msg: 'Senha deve ter pelo menos 6 caracteres.' };
  return { ok: true, p };
}

/* util: headers anti-cache */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

/* ---------------- rotas ---------------- */

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    noStore(res);

    const v = validateName(req.body?.name);
    if (!v.ok) return res.status(400).json({ error: v.msg });

    const vp = validatePassword(req.body?.password);
    if (!vp.ok) return res.status(400).json({ error: vp.msg });

    const exist = await get(`SELECT id FROM players WHERE name=?`, [v.name]);
    if (exist) return res.status(409).json({ error: 'Nome já está em uso.' });

    const id = randomUUID();
    const createdAt = Date.now();
    const hash = await bcrypt.hash(vp.p, 10);

    await run(
      `INSERT INTO players (id,name,password_hash,coins,gems,createdAt)
       VALUES (?,?,?,?,?,?)`,
      [id, v.name, hash, 500, 0, createdAt]
    );

    // Starter: primeiro COMMON do catálogo
    const starter = await get(
      `SELECT * FROM heroes_master WHERE rarity='COMMON' ORDER BY heroKey LIMIT 1`
    );
    if (starter) {
      await run(
        `INSERT INTO player_heroes
           (id, playerId, heroKey, name, rarity, attack, defense, speed, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          randomUUID(), id, starter.heroKey, starter.name, starter.rarity,
          starter.base_attack, starter.base_defense, starter.base_speed, Date.now()
        ]
      );
    }

    setAuthCookie(res, { id, name: v.name });
    return res.json({ id, name: v.name, coins: 500, gems: 0, createdAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao registrar' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    noStore(res);

    const name = (req.body?.name || '').trim();
    const pass = (req.body?.password || '');
    const user = await get(`SELECT * FROM players WHERE name=?`, [name]);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Credenciais inválidas' });

    const ok = await bcrypt.compare(pass, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    setAuthCookie(res, { id: user.id, name: user.name });
    return res.json({ id: user.id, name: user.name, coins: user.coins, gems: user.gems });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao autenticar' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  noStore(res);
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// GET /api/auth/me  (protegido)
router.get('/me', requireAuth, (req, res) => {
  noStore(res);
  return res.json({ profile: req.user });
});

module.exports = router;
