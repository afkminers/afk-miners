// server/models/heroes.js
const { randomUUID } = require('crypto');
const { all, get, run } = require('./db');

/**
 * Cria/atualiza o schema de heroes_master no Postgres.
 * - id: UUID PK
 * - "heroKey": TEXT UNIQUE
 * - Campos base_* inteiros
 * - Campos extras (class, role, attack_type, element, weapon_pref)
 * - created_at / updated_at para auditoria
 */
async function ensureHeroesSchema() {
  // Tabela base
  await run(`
    CREATE TABLE IF NOT EXISTS heroes_master (
      id UUID PRIMARY KEY,
      "heroKey"   TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      rarity      TEXT NOT NULL,
      base_attack INTEGER NOT NULL,
      base_defense INTEGER NOT NULL,
      base_speed  INTEGER NOT NULL,
      class       TEXT NOT NULL DEFAULT '',
      role        TEXT NOT NULL DEFAULT '',
      attack_type TEXT NOT NULL DEFAULT '',
      element     TEXT NOT NULL DEFAULT '',
      weapon_pref TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Índices úteis
  await run(`CREATE INDEX IF NOT EXISTS idx_heroes_master_key ON heroes_master("heroKey")`);
  await run(`CREATE INDEX IF NOT EXISTS idx_heroes_master_class ON heroes_master(class)`);

  // Colunas opcionais (garantia defensiva caso a tabela já existisse antiga)
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS class TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS attack_type TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS element TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS weapon_pref TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`);
  await run(`ALTER TABLE heroes_master ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`);
}

/**
 * Insere seed de heróis, caso a tabela esteja vazia.
 * Mantém o mesmo conteúdo que você já tinha, com upsert seguro.
 */
async function seedHeroesIfEmpty() {
  const row = await get(`SELECT COUNT(*)::int AS c FROM heroes_master`);
  if (Number(row?.c || 0) > 0) return;

  const seed = [
    { key:'aric',   name:'Aric, the Swordsman',      rarity:'COMMON',     atk:2, def:1, spd:1, class:'warrior',   role:'dps',          attack_type:'melee',  element:'neutral', weapon_pref:'sword' },
    { key:'lyria',  name:'Lyria, the Archer',        rarity:'COMMON',     atk:1, def:1, spd:2, class:'ranger',    role:'dps',          attack_type:'ranged', element:'nature',  weapon_pref:'bow' },
    { key:'brokk',  name:'Brokk, the Dwarf',         rarity:'COMMON',     atk:1, def:2, spd:1, class:'guardian',  role:'tank',         attack_type:'melee',  element:'earth',   weapon_pref:'hammer_shield' },
    { key:'seraph', name:'Seraph, the Cleric',       rarity:'RARE',       atk:2, def:2, spd:2, class:'cleric',    role:'support',      attack_type:'magic',  element:'light',   weapon_pref:'staff' },
    { key:'kaelen', name:'Kaelen, the Assassin',     rarity:'RARE',       atk:3, def:1, spd:3, class:'rogue',     role:'dps',          attack_type:'melee',  element:'dark',    weapon_pref:'daggers' },
    { key:'morrin', name:'Morrin, the Guardian',     rarity:'RARE',       atk:1, def:3, spd:2, class:'guardian',  role:'tank',         attack_type:'melee',  element:'earth',   weapon_pref:'mace_shield' },
    { key:'elara',  name:'Elara, the Sorceress',     rarity:'SUPER_RARE', atk:4, def:2, spd:2, class:'mage',      role:'dps',          attack_type:'magic',  element:'arcane',  weapon_pref:'staff' },
    { key:'darrion',name:'Darrion, the Warrior',     rarity:'SUPER_RARE', atk:4, def:3, spd:1, class:'warrior',   role:'bruiser',      attack_type:'melee',  element:'fire',    weapon_pref:'greatsword' },
    { key:'sylva',  name:'Sylva, the Druid',         rarity:'SUPER_RARE', atk:3, def:3, spd:2, class:'druid',     role:'support',      attack_type:'magic',  element:'nature',  weapon_pref:'staff' },
    { key:'ragnar', name:'Ragnar, the Barbarian',    rarity:'LEGENDARY',  atk:6, def:3, spd:2, class:'barbarian', role:'dps',          attack_type:'melee',  element:'fire',    weapon_pref:'axe' },
    { key:'selene', name:'Selene, the Huntress',     rarity:'LEGENDARY',  atk:5, def:2, spd:4, class:'ranger',    role:'dps',          attack_type:'ranged', element:'light',   weapon_pref:'bow' },
    { key:'tharion',name:'Tharion, the Necromancer', rarity:'LEGENDARY',  atk:5, def:3, spd:3, class:'necromancer', role:'control',     attack_type:'magic',  element:'dark',    weapon_pref:'staff' },
    { key:'auriel', name:'Auriel, the Guardian Angel', rarity:'MYTHIC',   atk:7, def:5, spd:3, class:'angel',     role:'support_tank', attack_type:'magic',  element:'light',   weapon_pref:'spear_shield' },
    { key:'zephyr', name:'Zephyr, the Dragonmaster', rarity:'ULTIMATE',   atk:7, def:3, spd:5, class:'summoner',  role:'dps_control',  attack_type:'magic',  element:'wind',    weapon_pref:'tome' },
    { key:'arkan',  name:'Arkan, the Arcane Master', rarity:'ULTIMATE',   atk:8, def:4, spd:4, class:'archmage',  role:'dps',          attack_type:'magic',  element:'arcane',  weapon_pref:'staff' },
  ];

  await run('BEGIN');
  try {
    for (const h of seed) {
      await run(
        `
        INSERT INTO heroes_master
          (id, "heroKey", name, rarity,
           base_attack, base_defense, base_speed,
           class, role, attack_type, element, weapon_pref, created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
        ON CONFLICT ("heroKey") DO UPDATE
          SET name=$3,
              rarity=$4,
              base_attack=$5,
              base_defense=$6,
              base_speed=$7,
              class=$8,
              role=$9,
              attack_type=$10,
              element=$11,
              weapon_pref=$12,
              updated_at=now()
        `,
        [
          randomUUID(), h.key, h.name, h.rarity,
          h.atk, h.def, h.spd,
          h.class, h.role, h.attack_type, h.element, h.weapon_pref
        ]
      );
    }
    await run('COMMIT');
    console.log('> heroes_master seed OK');
  } catch (e) {
    await run('ROLLBACK');
    throw e;
  }
}

/**
 * Utilitários simples (podem ser úteis em outros pontos do projeto)
 */
async function getHeroByKey(heroKey) {
  return get(`SELECT * FROM heroes_master WHERE "heroKey" = $1`, [String(heroKey)]);
}

async function getHeroClassById(heroId) {
  // via player_heroes -> heroes_master
  const row = await get(
    `SELECT hm.class
       FROM player_heroes ph
       JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [String(heroId)]
  );
  return row?.class || '';
}

module.exports = {
  ensureHeroesSchema,
  seedHeroesIfEmpty,
  getHeroByKey,
  getHeroClassById
};
