const { all, run } = require('./db');
const { ensureHeroesSchema, seedHeroesIfEmpty } = require('./heroes');

async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS players(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT DEFAULT '',
      coins INTEGER NOT NULL DEFAULT 500,
      gems  INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq ON players(name COLLATE NOCASE)`);

  await ensureHeroesSchema();

  await run(`
    CREATE TABLE IF NOT EXISTS inventory(
      id TEXT PRIMARY KEY,
      playerId TEXT NOT NULL,
      heroKey TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      attack INTEGER NOT NULL,
      defense INTEGER NOT NULL,
      speed INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(playerId) REFERENCES players(id)
    )
  `);

  // retrocompat: garantir password_hash
  const pCols = new Set((await all(`PRAGMA table_info(players)`)).map(c => c.name));
  if (!pCols.has('password_hash')) await run(`ALTER TABLE players ADD COLUMN password_hash TEXT DEFAULT ''`);

  await seedHeroesIfEmpty();
}

module.exports = { migrate };
