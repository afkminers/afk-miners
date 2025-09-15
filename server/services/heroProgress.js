//server/services/heroProgress.js
const { get, run } = require('../models/db');

// Busca o XP necessário para um determinado level
async function xpNeededForLevel(level) {
  const row = await get('SELECT xp_needed FROM level_curve WHERE level = $1', [level]);
  // fallback seguro: se não achar, calcula na hora
  return row ? Number(row.xp_needed) : 200 * Math.pow(level, 3);
}

// Dá XP ao herói e executa o level up se necessário
async function giveXp(heroId, xpGained) {
  if (!xpGained || xpGained <= 0) return;
  await run(`
    UPDATE player_heroes
       SET xp = COALESCE(xp, 0) + $2
     WHERE id = $1
  `, [heroId, xpGained]);
  await applyLevelUp(heroId);
}

// Checa se pode upar de level (pode upar múltiplos níveis de uma vez)
async function applyLevelUp(heroId) {
  const hero = await get('SELECT id, name, level, xp FROM player_heroes WHERE id = $1', [heroId]);
  if (!hero) return;
  let { xp, level, name, id } = hero;
  let leveledUp = false;

  // Loop para múltiplos ups se tiver XP suficiente
  while (true) {
    const nextLevel = level + 1;
    const xpNeed = await xpNeededForLevel(nextLevel);
    if (xp < xpNeed) break;
    xp -= xpNeed;
    level++;
    leveledUp = true;
  }
  if (leveledUp) {
    await run('UPDATE player_heroes SET level = $1, xp = $2 WHERE id = $3', [level, xp, id]);
    // Notifica o frontend (ajuste para sua infra, websocket, etc)
    notifyLevelUpClient({ id, name, level });
  }
}

// Retorna o XP necessário para o próximo level de um herói
async function getXpNeededForHero(hero) {
  const nextLevel = Number(hero.level || 1) + 1;
  return xpNeededForLevel(nextLevel);
}

// Notifica o frontend sobre level up (ajuste para o seu sistema de eventos/websocket)
function notifyLevelUpClient(hero) {
  // Exemplo para socket.io global: io.emit('hero:levelup', { hero });
  // Adapte se for REST ou outro sistema!
  if (global.io) global.io.emit('hero:levelup', { hero });
}

module.exports = {
  xpNeededForLevel,
  giveXp,
  applyLevelUp,
  getXpNeededForHero
};