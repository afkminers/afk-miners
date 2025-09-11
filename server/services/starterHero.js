// server/services/starterHero.js
const { pool } = require('../models/db');
const { randomUUID } = require('crypto');
const { computeMaxHp } = require('./heroStats');

/**
 * Cria um herói starter se o player ainda não tiver um.
 * Retorna o heroId (existente ou recém-criado).
 */
async function createStarterHeroIfMissing(playerId) {
  const p = pool();

  // Já existe?
  const existing = await p.query(
    `SELECT id FROM player_heroes WHERE "playerId" = $1 LIMIT 1`,
    [playerId]
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  // Stats iniciais
  const level = 1;
  const attack = 10;
  const defense = 5;
  const speed = 5;
  const heroObj = { level, defense };
  const baseHp = computeMaxHp(heroObj);

  const heroId = randomUUID();
  await p.query(`
    INSERT INTO player_heroes
      (id,"heroKey",name,rarity,attack,defense,speed,level,"isStarter",
       "createdAt","updatedAt","playerId",xp,hp,max_hp)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),$10,$11,$12,$13)
  `, [
    heroId,
    'starter_warrior',
    'Starter',
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

  return heroId;
}

module.exports = {
  createStarterHeroIfMissing
};