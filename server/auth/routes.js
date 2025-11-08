// REMOVIDO createStarterHeroIfMissing para restaurar fluxo original de seleção
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const { get, run } = require('../models/db');
const {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} = require('./middleware');
const { isAdminName } = require('../middleware/requireAdmin');

const router = express.Router();

/* validações (mesmo conteúdo de antes) */
function validateName(raw) {
  const name = (raw || '').trim();
  if (name.length < 3 || name.length > 20) return { ok: false, msg: 'Nome deve ter entre 3 e 20 caracteres.' };
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return { ok: false, msg: 'Use apenas letras, números, espaço, _ e -.' };
  const reserved = ['admin', 'moderador', 'gm', 'support'];
  if (reserved.includes(name.toLowerCase())) return { ok: false, msg: 'Este nome é reservado.' };
  return { ok: true, name };
}
function validatePassword(raw) {
  const p = raw || '';
  if (p.length < 6) return { ok: false, msg: 'Senha deve ter pelo menos 6 caracteres.' };
  return { ok: true, p };
}
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

router.post('/register', async (req, res) => {
  try {
    noStore(res);
    const v = validateName(req.body?.name);
    if (!v.ok) return res.status(400).json({ error: v.msg });
    const vp = validatePassword(req.body?.password);
    if (!vp.ok) return res.status(400).json({ error: vp.msg });

    const exists = await get(
      `SELECT id FROM players WHERE lower(name) = lower($1)`,
      [v.name]
    );
    if (exists) return res.status(409).json({ error: 'Nome já está em uso.' });

    const id = randomUUID();
    const hash = await bcrypt.hash(vp.p, 10);

    const ins = await run(
      `INSERT INTO players (id, name, password_hash, coins, gems, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       RETURNING id, name, coins, gems, "createdAt"`,
      [id, v.name, hash, 500, 0]
    );
    const row = ins.rows[0];

    setAuthCookie(res, { id: row.id, name: row.name });
    return res.json(row);
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Nome já está em uso.' });
    }
    console.error('[auth/register] error:', e);
    return res.status(500).json({ error: 'Falha ao registrar' });
  }
});

router.post('/login', async (req, res) => {
  try {
    noStore(res);
    const name = (req.body?.name || '').trim();
    const pass = (req.body?.password || '');
    const user = await get(`SELECT * FROM players WHERE lower(name)=lower($1)`, [name]);
    if (!user?.password_hash) return res.status(401).json({ error: 'Credenciais inválidas' });
    const ok = await bcrypt.compare(pass, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
    setAuthCookie(res, { id: user.id, name: user.name });
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/login] error:', e);
    res.status(500).json({ error: 'Falha ao autenticar' });
  }
});

router.post('/logout', (_req, res) => {
  noStore(res);
  clearAuthCookie(res);
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    noStore(res);
    const profile = await get(
      `SELECT id, name, coins, gems, "createdAt", "updatedAt"
         FROM players
        WHERE id=$1`,
      [req.user.id]
    );
    if (!profile) return res.status(404).json({ error: 'Jogador não encontrado' });
    res.json({ profile, isAdmin: isAdminName(profile.name) });
  } catch (e) {
    console.error('[auth/me] error:', e);
    res.status(500).json({ error: 'Falha ao obter perfil' });
  }
});

module.exports = router;