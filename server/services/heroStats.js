// server/services/heroStats.js
// Centraliza fórmulas de atributos derivados do herói, agora usando a tabela de classes (e gains).

const { get, all } = require('../models/db'); // Supondo que usa "get" para queries SQL

/**
 * Calcula HP/Mana/Capacidade máximos dinâmicos do herói via classe + level.
 * @param {object|string} hero Herói (objeto com .level, .heroKey, .class, etc) ou apenas heroId
 * @param {object} [opts] Opções (usarGains: usar class_level_gains detalhado)
 * @returns {Promise<{maxHp: number, maxMana: number, maxCap: number, classe: string}>}
 */
async function computeHeroStats(hero, opts = {}) {
  let heroObj = hero;
  // Se veio só heroId, faz lookup do herói + catálogo
  if (typeof hero === 'string') {
    const row = await get(`
      SELECT ph.level, ph.attack, ph.defense, ph.speed, ph."heroKey", hm.class
        FROM player_heroes ph
   LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
       WHERE ph.id = $1
       LIMIT 1
    `, [hero]);
    if (!row) throw new Error('herói não encontrado');
    heroObj = row;
  }

  const level = Number(heroObj.level || 1);
  let classe = heroObj.class;
  // Se não veio a classe, busca do catálogo
  if (!classe && heroObj.heroKey) {
    const row = await get(
      `SELECT class FROM heroes_master WHERE "heroKey" = $1 LIMIT 1`,
      [heroObj.heroKey]
    );
    classe = row?.class || null;
  }
  if (!classe) throw new Error('classe do herói não encontrada');

  // Busca dados da classe
  const classData = await get(
    `SELECT hp_base, mana_base, cap_base, hp_per_level, mana_per_level, cap_per_level
       FROM classes WHERE UPPER(name) = UPPER($1) LIMIT 1`,
    [classe]
  );
  if (!classData) throw new Error(`Classe não encontrada na tabela classes: ${classe}`);

  // Se usar class_level_gains detalhado
  if (opts.usarGains) {
    // Soma os ganhos de cada nível até o atual
    const rows = await all(
      `SELECT hp_gain, mana_gain, cap_gain FROM class_level_gains WHERE class = $1 AND level <= $2`,
      [classe, level]
    );
    const sum = rows.reduce(
      (acc, r) => {
        acc.hp += Number(r.hp_gain || 0);
        acc.mana += Number(r.mana_gain || 0);
        acc.cap += Number(r.cap_gain || 0);
        return acc;
      },
      { hp: 0, mana: 0, cap: 0 }
    );
    return {
      maxHp: Number(classData.hp_base) + sum.hp,
      maxMana: Number(classData.mana_base) + sum.mana,
      maxCap: Number(classData.cap_base) + sum.cap,
      classe
    };
  } else {
    // Progressão linear (base + per_level * (level-1))
    return {
      maxHp: Number(classData.hp_base) + Number(classData.hp_per_level) * (level - 1),
      maxMana: Number(classData.mana_base) + Number(classData.mana_per_level) * (level - 1),
      maxCap: Number(classData.cap_base) + Number(classData.cap_per_level) * (level - 1),
      classe
    };
  }
}

// Função legacy (só HP, sem classe) - DEPRECATED
function computeMaxHp(hero) {
  const level = hero.level || 1;
  const defense = hero.defense || 0;
  const baseHp = 100;
  const lvlBonus = Math.max(0, level - 1) * 5;
  const defBonus = defense * 2;
  return baseHp + lvlBonus + defBonus;
}

module.exports = {
  computeHeroStats,
  computeMaxHp // manter para compatibilidade, mas descontinuar uso!
};