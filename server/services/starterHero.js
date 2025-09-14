// server/services/starterHero.js
const { pool } = require('../models/db');
const { randomUUID } = require('crypto');
const { computeHeroStats } = require('./heroStats'); // NOVO: cálculo dinâmico

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
  const heroKey = 'starter_warrior';
  const classe = 'KNIGHT'; // Starter padrão (ajuste se necessário!)

  // Cálculo dinâmico via classes
  let maxHp = null, maxMana = null, maxCap = null;
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
    console.warn('[starterHero] computeHeroStats falhou, usando fallback:', e?.message);
  }

  const heroId = randomUUID();
  await p.query(`
    INSERT INTO player_heroes
      (id,"heroKey",name,rarity,attack,defense,speed,level,"isStarter",
       "createdAt","updatedAt","playerId",xp,hp,max_hp,mana,max_mana)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),$10,$11,$12,$13,$14,$15)
  `, [
    heroId,
    heroKey,
    'Starter',
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

  return heroId;
}

module.exports = {
  createStarterHeroIfMissing
};