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
  if (name.length < 3 || name.length > 20) {
    return { ok: false, msg: 'Nome deve ter entre 3 e 20 caracteres.' };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return { ok: false, msg: 'Use apenas letras, números, espaço, _ e -.' };
  }
  const reserved = ['admin', 'moderador', 'gm', 'support'];
  if (reserved.includes(name.toLowerCase())) {
    return { ok: false, msg: 'Este nome é reservado.' };
  }
  return { ok: true, name };
}

function validatePassword(raw) {
  const p = raw || '';
  if (p.length < 6) return { ok: false, msg: 'Senha deve ter pelo menos 6 caracteres.' };
  return { ok: true, p };
}

/* util: headers anti-cache */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

/* ---------------- rotas ---------------- */

/**
 * POST /api/auth/register
 * - Checa existência case-insensitive via lower(name)
 * - Insere e, se houver corrida, captura 23505 e retorna 409
 */
router.post('/register', async (req, res) => {
  try {
    noStore(res);

    const v = validateName(req.body?.name);
    if (!v.ok) return res.status(400).json({ error: v.msg });

    const vp = validatePassword(req.body?.password);
    if (!vp.ok) return res.status(400).json({ error: vp.msg });

    // 1) checa se já existe (case-insensitive)
    const exists = await get(
      `SELECT id FROM players WHERE lower(name) = lower($1)`,
      [v.name]
    );
    if (exists) return res.status(409).json({ error: 'Nome já está em uso.' });

    // 2) tenta inserir
    const id = randomUUID();
    const hash = await bcrypt.hash(vp.p, 10);

    const ins = await run(
      `INSERT INTO players (id, name, password_hash, coins, gems, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, name, coins, gems, "createdAt"`,
      [id, v.name, hash, 500, 0]
    );
    const row = ins.rows[0];

    // 3) cria sessão
    setAuthCookie(res, { id: row.id, name: row.name });
    return res.json(row);
  } catch (e) {
    // corrida: índice único em lower(name) disparou
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Nome já está em uso.' });
    }
    console.error('[auth/register] error:', e);
    return res.status(500).json({ error: 'Falha ao registrar' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    noStore(res);

    const name = (req.body?.name || '').trim();
    const pass = req.body?.password || '';

    // busca case-insensitive
    const user = await get(
      `SELECT * FROM players WHERE lower(name) = lower($1)`,
      [name]
    );
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const ok = await bcrypt.compare(pass, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    setAuthCookie(res, { id: user.id, name: user.name });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[auth/login] error:', e);
    return res.status(500).json({ error: 'Falha ao autenticar' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  noStore(res);
  clearAuthCookie(res);
  res.clearCookie('token', { path: '/' }); // legado
  return res.json({ ok: true });
});

// GET /api/auth/me  (protegido)
router.get('/me', requireAuth, async (req, res) => {
  try {
    noStore(res);
    const profile = await get(
      `SELECT id, name, coins, gems, "createdAt", "updatedAt"
         FROM players
        WHERE id = $1`,
      [req.user.id]
    );
    if (!profile) return res.status(404).json({ error: 'Jogador não encontrado' });
    return res.json({ profile });
  } catch (e) {
    console.error('[auth/me] error:', e);
    return res.status(500).json({ error: 'Falha ao obter perfil' });
  }
});

module.exports = router;
