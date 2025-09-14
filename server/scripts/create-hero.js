//server/scripts/create-hero.js
const { pool } = require('../models/db');
const { randomUUID } = require('crypto');
const { computeHeroStats } = require('../services/heroStats'); // NOVO: cálculo dinâmico

(async () => {
  const playerId = process.argv[2];
  const heroName = process.argv[3] || 'HeroTemp';
  const heroKey  = process.argv[4] || 'starter_warrior';

  if (!playerId) {
    console.error('Uso: node scripts/create-hero.js <PLAYER_ID> [HeroName] [heroKey]');
    process.exit(1);
  }

  try {
    const p = pool();
    const heroId = randomUUID();
    const attack = 10;
    const defense = 5;
    const speed = 5;
    const level = 1;
    let maxHp = null, maxMana = null, maxCap = null;

    // Determina a classe padrão para heroKey do starter (ajuste se necessário)
    let classe = 'KNIGHT';
    if (heroKey.toLowerCase() === 'lyria') classe = 'PALADIN';
    if (heroKey.toLowerCase() === 'brokk') classe = 'KNIGHT';
    if (heroKey.toLowerCase() === 'aric') classe = 'KNIGHT';

    // Cálculo dinâmico via classes
    try {
      const stats = await computeHeroStats({
        level,
        heroKey,
        class: classe
      });
      maxHp = stats.maxHp;
      maxMana = stats.maxMana;
      maxCap = stats.maxCap;
    } catch (e) {
      // fallback seguro
      maxHp = 100 + (level - 1) * 5 + defense * 2;
      maxMana = 50;
      maxCap = 470;
      console.warn('[create-hero] computeHeroStats falhou, usando fallback:', e?.message);
    }

    await p.query(`
      INSERT INTO player_heroes
        (id,"heroKey",name,rarity,attack,defense,speed,level,"isStarter","createdAt","updatedAt","playerId",xp,hp,max_hp,mana,max_mana)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10,$11,$12,$13,$14,$15)
    `, [
      heroId,
      heroKey,
      heroName,
      'common',
      attack,
      defense,
      speed,
      level,
      true,
      playerId,
      0,
      maxHp,
      maxHp,
      maxMana,
      maxMana
    ]);
    console.log('Hero created with hp/max_hp:', heroId, maxHp);
  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    process.exit(0);
  }
})();