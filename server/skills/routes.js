// server/skills/routes.js
const express = require('express');
const { all, get, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

const router = express.Router();
router.use(requireAuth);

/* --------- Helpers de progressão (tunáveis depois) --------- */
function triesNeedFor(level){              // curva estilo Tibia p/ skills
  const A = 20, B = 1.18;
  return Math.round(A * Math.pow(B, Math.max(0, level-1)));
}
function xpNext(level){                    // curva de level do jogador
  const base=100, exp=1.45, lin=10;
  return Math.floor(base*Math.pow(level,exp)+lin*level);
}

/* --------- [A] Skills por Herói (catálogo) --------- */
// GET /api/skills/by-hero?heroKey=elara&rarity=SUPER_RARE
router.get('/by-hero', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const heroKey = (req.query.heroKey || '').trim();
    const rarity  = (req.query.rarity  || 'COMMON').trim().toUpperCase();
    if (!heroKey) return res.status(400).json({ error: 'heroKey é obrigatório' });

    const rows = await all(`
      SELECT
        hsm.slot,
        sm.skillKey,
        sm.name,
        sm.description,
        sm.type,
        sm.power,
        sm.cooldown,
        sm.element,
        sm.icon,
        hsm.unlock_at
      FROM hero_skill_map hsm
      JOIN skills_master sm ON sm.id = hsm.skillKey
      WHERE hsm.heroKey = ?
      ORDER BY hsm.slot ASC
    `, [heroKey]);

    const order = ['COMMON','RARE','SUPER_RARE','LEGENDARY','MYTHIC','ULTIMATE'];
    const gate  = order.indexOf(rarity);
    const can   = (min) => order.indexOf(String(min||'COMMON').toUpperCase()) <= gate;

    const skills = rows
      .filter(r => can(r.unlock_at))
      .map(r => ({
        slot: r.slot,
        key: r.skillKey,
        name: r.name,
        description: r.description,
        type: r.type,
        power: r.power,
        cooldown: r.cooldown,
        element: r.element,
        icon: r.icon
      }));

    res.json({ heroKey, rarity, skills });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao carregar skills' });
  }
});

/* --------- [B] Treino por hit (Tibia-like) --------- */
// POST /api/skills/hit  { skillType:'SWORD', damage?:number }
router.post('/hit', async (req, res) => {
  try {
    const playerId  = req.user.id;
    const skillType = String(req.body?.skillType||'').toUpperCase();
    if (!skillType) return res.status(400).json({ error: 'skillType obrigatório' });

    await run(`
      INSERT OR IGNORE INTO player_skills (playerId, skillType, level, tries)
      VALUES (?, ?, 10, 0)
    `,[playerId, skillType]);

    const row = await get(`SELECT level, tries FROM player_skills WHERE playerId=? AND skillType=?`,
                          [playerId, skillType]);

    const dmg = Number(req.body?.damage)||0;
    const add = Math.max(0.5, 1.0 * (1 + 0.02*dmg));      // mínimo 0.5; peso do dano 0.02

    let level = row.level;
    let tries = row.tries + Math.floor(add);

    while (tries >= triesNeedFor(level)){
      tries -= triesNeedFor(level);
      level++;
    }

    await run(`
      UPDATE player_skills SET level=?, tries=?, updatedAt=strftime('%s','now')*1000
      WHERE playerId=? AND skillType=?
    `,[level, tries, playerId, skillType]);

    res.json({ skillType, level, tries, need: triesNeedFor(level), progress: tries/triesNeedFor(level) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao aplicar ganho de skill' });
  }
});

/* (Opcional) GET /api/skills/my — retorna skills + level do jogador */
router.get('/my', async (req,res)=>{
  try{
    const playerId = req.user.id;
    const skills = await all(
      `SELECT skillType, level, tries FROM player_skills WHERE playerId=?`, [playerId]
    );
    const lvl = await get(
      `SELECT level, xp FROM player_levels WHERE playerId=?`, [playerId]
    ) || { level:1, xp:0 };

    const outSkills = skills.map(s => ({
      ...s, need: triesNeedFor(s.level), progress: s.tries / triesNeedFor(s.level)
    }));
    res.json({
      skills: outSkills,
      level: { ...lvl, next: xpNext(lvl.level), progress: lvl.xp / xpNext(lvl.level) }
    });
  }catch(e){
    console.error(e);
    res.status(500).json({ error:'Falha ao carregar minhas skills' });
  }
});

module.exports = router;
