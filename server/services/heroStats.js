// server/services/heroStats.js
// Centraliza fórmulas de atributos derivados do herói.

function computeMaxHp(hero) {
  const level = hero.level || 1;
  const defense = hero.defense || 0;
  const baseHp = 100;
  const lvlBonus = Math.max(0, level - 1) * 5;
  const defBonus = defense * 2;
  return baseHp + lvlBonus + defBonus;
}

module.exports = {
  computeMaxHp
};