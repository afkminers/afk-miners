PRAGMA foreign_keys = ON;

-- Arquivos fonte e seus checksums (para evitar reprocessar)
CREATE TABLE IF NOT EXISTS content_files (
    path TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monsters_master (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT,
    xp INTEGER,
    healthMax INTEGER,
    speed INTEGER,
    flagsJSON TEXT,
    elementsJSON TEXT,
    attacksJSON TEXT,
    defensesJSON TEXT,
    lootJSON TEXT,
    lookJSON TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items_master (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    dataJSON TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sprites_master (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    kind TEXT,
    dataJSON TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maps (
    key TEXT PRIMARY KEY,
    dataJSON TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_objects (
    id INTEGER PRIMARY KEY,
    mapKey TEXT,
    type TEXT,
    x INTEGER,
    y INTEGER,
    w INTEGER,
    h INTEGER,
    propsJSON TEXT,
    FOREIGN KEY(mapKey) REFERENCES maps(key)
);

CREATE TABLE IF NOT EXISTS spawns (
    id INTEGER PRIMARY KEY,
    mapKey TEXT,
    monsterKey TEXT,
    x INTEGER,
    y INTEGER,
    w INTEGER,
    h INTEGER,
    count INTEGER,
    respawnSec INTEGER,
    levelMin INTEGER,
    levelMax INTEGER,
    FOREIGN KEY(mapKey) REFERENCES maps(key)
);