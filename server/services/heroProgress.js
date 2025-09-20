// server/services/heroProgress.js
const { get, run } = require('../models/db');
const { syncVitalsIfOutdated } = require('./heroStats');
// (Opcional) se você tiver bus WS local, descomente e use:
// const { broadcast } = require('../ws/bus');

// --- XP curve ---------------------------------------------------------------

// Busca o XP necessário para um determinado level
async function xpNeededForLevel(level) {
  const row = await get(
    'SELECT xp_needed FROM level_curve WHERE level = $1',
    [level]
  );
  // Fallback seguro caso a tabela não tenha o nível pedido:
  return row ? Number(row.xp_needed) : 200 * Math.pow(Number(level || 1), 3);
}

// --- Ganho de XP + Level Up -------------------------------------------------

// Dá XP ao herói e executa o level up se necessário
async function giveXp(heroId, xpGained) {
  if (!xpGained || xpGained <= 0) return;

  await run(
    `
    UPDATE player_heroes
       SET xp = COALESCE(xp, 0) + $2
     WHERE id = $1
    `,
    [heroId, xpGained]
  );

  await applyLevelUp(heroId);
}

// Checa se pode upar de level (pode upar múltiplos níveis de uma vez)
async function applyLevelUp(heroId) {
  const hero = await get(
    'SELECT id, name, level, xp FROM player_heroes WHERE id = $1',
    [heroId]
  );
  if (!hero) return;

  let { xp, level, name, id } = hero;
  let leveledUp = false;

  // Loop para múltiplos ups se tiver XP suficiente
  while (true) {
    const nextLevel = level + 1;
    const need = await xpNeededForLevel(nextLevel);
    if (xp < need) break;
    xp -= need;
    level++;
    leveledUp = true;
  }

  if (!leveledUp) return;

  // Persiste novo level/xp
  await run(
    `
    UPDATE player_heroes
       SET level = $1,
           xp    = $2,
           "updatedAt" = now()
     WHERE id = $3
    `,
    [level, xp, id]
  );

  // >>> IMPORTANTE: após subir de nível, alinhar HP/MaxHP com a fórmula atual
  try {
    await syncVitalsIfOutdated(heroId);
  } catch (e) {
    // não deixa o fluxo falhar por causa do ajuste de vitais
    console.warn('[heroProgress] syncVitalsIfOutdated falhou:', e?.message);
  }

  // Notifica o frontend (ajuste para sua infra, websocket, etc)
  notifyLevelUpClient({ id, name, level });

  // (Opcional) broadcast WS nativo do seu servidor
  // try {
  //   broadcast({ type: 'hero_levelup', heroId: id, name, level });
  // } catch {}
}

// --- Utilidades -------------------------------------------------------------

// Retorna o XP necessário para o próximo level de um herói
async function getXpNeededForHero(hero) {
  const nextLevel = Number(hero.level || 1) + 1;
  return xpNeededForLevel(nextLevel);
}

// Notifica o frontend sobre level up (ajuste conforme seu sistema de eventos/WS)
function notifyLevelUpClient(hero) {
  // Exemplo com socket.io global:
  // if (global.io) global.io.emit('hero:levelup', { hero });

  // Se você usa outro bus, adapte aqui.
}

module.exports = {
  xpNeededForLevel,
  giveXp,
  applyLevelUp,
  getXpNeededForHero
};
