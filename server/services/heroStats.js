// server/services/heroStats.js
// Centraliza fórmulas de atributos do herói e garante que o banco fique coerente
// com o cálculo (classe/nível). Inclui sincronização de HP/MaxHP.

const { get, all, run } = require('../models/db');

/**
 * Calcula os máximos do herói (HP/Mana/Cap) a partir da classe + level.
 * Pode receber o objeto do herói (com .level e .heroKey/.class) ou o heroId (string).
 *
 * @param {object|string} heroOrId - objeto do herói ou heroId
 * @param {object} [opts] - { usarGains?: boolean } se true usa class_level_gains
 * @returns {Promise<{maxHp:number, maxMana:number, maxCap:number, classe:string}>}
 */
async function computeHeroStats(heroOrId, opts = {}) {
  let hero = heroOrId;

  // Se veio só o ID, buscar informações essenciais do herói
  if (typeof heroOrId === 'string') {
    const row = await get(
      `
      SELECT ph.id, ph.level, ph.attack, ph.defense, ph.speed, ph."heroKey",
             hm.class
        FROM player_heroes ph
   LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
       WHERE ph.id = $1
       LIMIT 1
      `,
      [heroOrId]
    );
    if (!row) throw new Error('herói não encontrado');
    hero = row;
  }

  const level = Number(hero.level || 1);

  // obter classe: direto do objeto ou via catálogo por heroKey
  let classe = hero.class || null;
  if (!classe && hero.heroKey) {
    const r = await get(
      `SELECT class FROM heroes_master WHERE "heroKey" = $1 LIMIT 1`,
      [hero.heroKey]
    );
    classe = r?.class || null;
  }
  if (!classe) throw new Error('classe do herói não encontrada');

  // Dados básicos da classe
  const cls = await get(
    `
    SELECT hp_base, mana_base, cap_base,
           hp_per_level, mana_per_level, cap_per_level
      FROM classes
     WHERE UPPER(name) = UPPER($1)
     LIMIT 1
    `,
    [classe]
  );
  if (!cls) throw new Error(`Classe não encontrada em 'classes': ${classe}`);

  // Modo 1: tabela de ganhos por nível (class_level_gains)
  if (opts.usarGains) {
    const gains = await all(
      `SELECT hp_gain, mana_gain, cap_gain
         FROM class_level_gains
        WHERE class = $1 AND level <= $2`,
      [classe, level]
    );

    const sum = gains.reduce(
      (acc, g) => {
        acc.hp += Number(g.hp_gain || 0);
        acc.mana += Number(g.mana_gain || 0);
        acc.cap += Number(g.cap_gain || 0);
        return acc;
      },
      { hp: 0, mana: 0, cap: 0 }
    );

    return {
      maxHp: Number(cls.hp_base) + sum.hp,
      maxMana: Number(cls.mana_base) + sum.mana,
      maxCap: Number(cls.cap_base) + sum.cap,
      classe
    };
  }

  // Modo 2: progressão linear base + per_level * (level-1)
  return {
    maxHp:
      Number(cls.hp_base) + Number(cls.hp_per_level) * Math.max(0, level - 1),
    maxMana:
      Number(cls.mana_base) + Number(cls.mana_per_level) * Math.max(0, level - 1),
    maxCap:
      Number(cls.cap_base) + Number(cls.cap_per_level) * Math.max(0, level - 1),
    classe
  };
}

/**
 * SINCRONIZA hp/max_hp do herói no banco com a fórmula atual.
 * - Se max_hp mudou, ajusta hp mantendo a mesma % (se max_hp antigo > 0).
 * - Se max_hp antigo era 0/null, cura cheio (hp = newMax).
 * - Atualiza "updatedAt" (camelCase).
 *
 * Retorna { hp, maxHp, changed }.
 */
async function syncVitalsIfOutdated(heroId, opts = {}) {
  const row = await get(
    `
    SELECT id,
           COALESCE(level,1)    AS level,
           COALESCE(hp,0)       AS hp,
           COALESCE(max_hp,0)   AS max_hp,
           "heroKey"
      FROM player_heroes
     WHERE id = $1
    `,
    [heroId]
  );
  if (!row) return { hp: 0, maxHp: 0, changed: false };

  // calcula máximos a partir da classe/nível (mesma função usada pelo resto do sistema)
  const stats = await computeHeroStats(
    { level: row.level, heroKey: row.heroKey },
    opts
  );
  const newMax = Number(stats.maxHp || 0);

  if (newMax <= 0) {
    return { hp: row.hp, maxHp: row.max_hp, changed: false };
  }

  // Se o max_hp armazenado difere do calculado, normaliza e ajusta hp
  if (Number(row.max_hp) !== newMax) {
    const pct =
      row.max_hp > 0
        ? Math.max(0, Math.min(1, row.hp / row.max_hp))
        : 1; // sem max antigo -> cura cheio
    const newHp = Math.max(0, Math.round(pct * newMax));

    await run(
      `
      UPDATE player_heroes
         SET max_hp    = $2,
             hp        = $3,
             "updatedAt" = now()
       WHERE id = $1
      `,
      [heroId, newMax, newHp]
    );

    return { hp: newHp, maxHp: newMax, changed: true };
  }

  // nada a fazer
  return { hp: row.hp, maxHp: row.max_hp, changed: false };
}

/**
 * (Legacy) Apenas para compatibilidade antiga. Evite usar.
 */
function computeMaxHpLegacy(hero) {
  const level = Number(hero.level || 1);
  const defense = Number(hero.defense || 0);
  const baseHp = 100;
  const lvlBonus = Math.max(0, level - 1) * 5;
  const defBonus = defense * 2;
  return baseHp + lvlBonus + defBonus;
}

module.exports = {
  computeHeroStats,
  syncVitalsIfOutdated,
  // manter export legacy se algum código antigo ainda chamar
  computeMaxHp: computeMaxHpLegacy
};
