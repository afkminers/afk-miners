// POST /revive
router.post('/revive', requireAuth, requireCsrf, async (req, res) => {
  const { heroId } = req.body || {};
  if (!heroId) return res.status(400).json({ ok:false, error:'missing-hero-id' });

  const hero = await getHeroOwnedBy(req.user.id, heroId);
  if (!hero) return res.status(404).json({ ok:false, error:'hero-not-found' });
  if (hero.alive) return res.status(409).json({ ok:false, error:'hero-not-dead' });

  // decide o ponto de respawn:
  // 1) bind point salvo (hero_last_pos) para "house"/"temple", ou
  // 2) fallback: coordenadas padrão do teu hub (ex.: map_key='house', x=10,y=10).
  const { map_key, x, y } = await pickRespawnPointFor(hero) // implementa: lê hero_last_pos ou default

  // hp retorna com fração da vida (configurável)
  const hpOnRevive = Math.max(1, Math.floor(hero.max_hp * 0.3));

  await dbTx(async (db) => {
    await db.run(`
      UPDATE player_heroes
         SET alive = true,
             hp = $2,
             updated_at = NOW()
       WHERE id = $1
    `, [hero.id, hpOnRevive]);

    await db.run(`
      INSERT INTO hero_last_pos (hero_id, map_key, x, y, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (hero_id) DO UPDATE
        SET map_key = EXCLUDED.map_key,
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            updated_at = NOW()
    `, [hero.id, map_key, x, y]);

    // Opcional: limpa estados de combate/amenazas para não nascer "em combate"
    try { await require('../combat/autoloop').stop(hero.id); } catch {}
    try { await require('../combat/ai-mobs').removeHeroThreat(hero.id); } catch {}
  });

  return res.json({ ok:true, heroId: hero.id, hp: hpOnRevive, map_key, x, y });
});
