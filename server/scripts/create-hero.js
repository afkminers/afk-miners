//server/scripts/create-hero.js
const { pool } = require('../models/db');
const { randomUUID } = require('crypto');

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
    const baseHp = 100 + (level - 1) * 5 + defense * 2;

    await p.query(`
      INSERT INTO player_heroes
        (id,"heroKey",name,rarity,attack,defense,speed,level,"isStarter","createdAt","updatedAt","playerId",xp,hp,max_hp)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10,$11,$12,$13)
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
      baseHp,
      baseHp
    ]);
    console.log('Hero created with hp/max_hp:', heroId, baseHp);
  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    process.exit(0);
  }
})();