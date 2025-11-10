// server/content/loader.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');
const { MonsterYAML, ItemYAML, SpriteYAML, TiledMapJSON } = require('./schemas');

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }
function read(file) { return fs.readFileSync(file, 'utf-8'); }

/* ---------------- helpers de listagem ---------------- */
function listRecursive(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listRecursive(p, ext));
    else if (name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}

function inferSpriteKind(filePath, data) {
  if (data && typeof data.kind === 'string' && data.kind.trim()) {
    return data.kind.trim();
  }
  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  if (fp.includes('/monsters/'))   return 'monster';
  if (fp.includes('/characters/')) return 'character';
  return 'sprite';
}

/** Retorna o 1º caminho existente entre as opções */
function firstExistingPath(paths) {
  for (const p of paths) if (fs.existsSync(p)) return p;
  return null;
}

/* ---------------- resolutores de caminhos ---------------- */
function resolveMonstersIndex(root) {
  return firstExistingPath([
    path.join(root, 'data/monsters/index.yml'),
    path.join(root, 'server/content/data/monsters/index.yml'),
    path.join(root, 'content/data/monsters/index.yml'),
  ]);
}
function resolveItemsIndex(root) {
  return firstExistingPath([
    path.join(root, 'data/items/index.yml'),
    path.join(root, 'server/content/data/items/index.yml'),
    path.join(root, 'content/data/items/index.yml'),
  ]);
}
function resolveSpritesBase(root) {
  return firstExistingPath([
    path.join(root, 'data/sprites'),
    path.join(root, 'server/content/data/sprites'),
    path.join(root, 'content/data/sprites'),
  ]);
}
function resolveMapFile(root, mapKey) {
  return firstExistingPath([
    path.join(root, `data/maps/${mapKey}.json`),               // preferido
    path.join(root, `server/content/data/maps/${mapKey}.json`),
    path.join(root, `content/data/maps/${mapKey}.json`),
    path.join(root, `content/maps/${mapKey}.json`),
  ]);
}

/* ---------------- garantias de esquema (idempotentes) ---------------- */
async function ensureItemColumns(db) {
  const { run } = db;
  // As migrações para jsonb já ficaram no SQL manual; aqui só garantimos colunas planas.
  await run(`
    ALTER TABLE items_master
      ADD COLUMN IF NOT EXISTS name         TEXT,
      ADD COLUMN IF NOT EXISTS slot         TEXT,
      ADD COLUMN IF NOT EXISTS kind         TEXT,
      ADD COLUMN IF NOT EXISTS weapon_type  TEXT,
      ADD COLUMN IF NOT EXISTS sprite       TEXT,
      ADD COLUMN IF NOT EXISTS atk          INTEGER,
      ADD COLUMN IF NOT EXISTS def          INTEGER,
      ADD COLUMN IF NOT EXISTS slots        INTEGER,
      ADD COLUMN IF NOT EXISTS stackable    BOOLEAN
  `);
}

/* ============================== LOADERS =============================== */
async function ensureMonsterColumns(db) {
  const { run } = db;
  await run(`
    ALTER TABLE monsters_master
      ADD COLUMN IF NOT EXISTS attack_range INTEGER,
      ADD COLUMN IF NOT EXISTS aggro_range INTEGER,
      ADD COLUMN IF NOT EXISTS attack_ms   INTEGER,
      ADD COLUMN IF NOT EXISTS leash_px    INTEGER
  `);
}


async function loadMonsters(db, root) {
  const { get, run } = db;
  const idx = resolveMonstersIndex(root);
  if (!idx) return;

  await ensureMonsterColumns(db);

  const index = YAML.parse(read(idx));
  const entries = Object.entries(index.monsters || {});
  
  let skippedCount = 0;
  let updatedCount = 0;
  
  for (const [key, rel] of entries) {
    const file = firstExistingPath([
      path.join(root, 'data/monsters', rel),
      path.join(root, 'server/content/data/monsters', rel),
      path.join(root, 'content/data/monsters', rel),
    ]);
    if (!file) { console.warn('[monsters] não achei arquivo para', key, rel); continue; }

    const src = read(file);
    const sum = sha1(src);

    // Check existing checksum to skip unchanged files
    const existing = await get(`SELECT checksum FROM content_files WHERE path=$1`, [file]).catch(() => null);
    if (existing && existing.checksum === sum) {
      skippedCount++;
      continue; // Skip if checksum unchanged
    }

    const data = MonsterYAML.parse(YAML.parse(src));

    const attackRange = Number.isFinite(data.attack_range) ? data.attack_range : null;
    const aggroRange  = Number.isFinite(data.aggro_range)  ? data.aggro_range  : null;
    const attackMs    = Number.isFinite(data.attack_ms)    ? data.attack_ms    : null;
    const leashPx     = Number.isFinite(data.leash_px)     ? Math.round(data.leash_px) : null;

    await run(`
      INSERT INTO monsters_master
        (key, name, xp, "healthMax", speed,
         "flagsJSON","elementsJSON","attacksJSON","defensesJSON","lootJSON","lookJSON",
         attack_range, aggro_range, attack_ms, leash_px, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
      ON CONFLICT (key) DO UPDATE SET
        name=EXCLUDED.name,
        xp=EXCLUDED.xp,
        "healthMax"=EXCLUDED."healthMax",
        speed=EXCLUDED.speed,
        "flagsJSON"=EXCLUDED."flagsJSON",
        "elementsJSON"=EXCLUDED."elementsJSON",
        "attacksJSON"=EXCLUDED."attacksJSON",
        "defensesJSON"=EXCLUDED."defensesJSON",
        "lootJSON"=EXCLUDED."lootJSON",
        "lookJSON"=EXCLUDED."lookJSON",
        attack_range=EXCLUDED.attack_range,
        aggro_range=EXCLUDED.aggro_range,
        attack_ms=EXCLUDED.attack_ms,
        leash_px=EXCLUDED.leash_px,
        updated_at=now()
    `, [
      data.key,
      data.name,
      data.xp,
      data.health.max,
      data.speed,
      JSON.stringify(data.flags || {}),
      JSON.stringify(data.elements || {}),
      JSON.stringify(data.attacks || []),
      JSON.stringify(data.defenses || {}),
      JSON.stringify(data.loot || []),
      JSON.stringify(data.look || {}),
      attackRange,
      aggroRange,
      attackMs,
      leashPx
    ]);

    await run(`
      INSERT INTO content_files(path, checksum, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (path) DO UPDATE SET
        checksum=EXCLUDED.checksum,
        updated_at=now()
    `, [file, sum]);
    
    updatedCount++;
  }
  
  if (skippedCount > 0 || updatedCount > 0) {
    console.log(`[monsters] processed: ${updatedCount} updated, ${skippedCount} skipped (unchanged)`);
  }
}


function toNumber(val) {
  if (val == null) return null;
  if (typeof val === 'string' && val.trim() === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function parseLeashPx(props) {
  if (!props || typeof props !== 'object') return null;
  const pxCandidates = [
    props.leashPx,
    props.leash_px,
    props.leashDistancePx,
    props.leash_distance_px,
    props.leash_range_px,
    props.followPx,
  ];
  for (const raw of pxCandidates) {
    const num = toNumber(raw);
    if (num != null) return Math.max(0, Math.round(num));
  }

  const tileCandidates = [
    props.leashTiles,
    props.leash_tiles,
    props.leash,
    props.range,
    props.radius,
    props.maxDistance,
    props.max_distance,
    props.maxRange,
    props.max_range,
    props.followRange,
  ];
  for (const raw of tileCandidates) {
    const num = toNumber(raw);
    if (num != null) return Math.max(0, Math.round(num * 32));
  }

  return null;
}

async function loadItems(db, root) {
  const { get, run } = db;

  await ensureItemColumns(db); // garante colunas planas

  const idx = resolveItemsIndex(root);
  if (!idx) return;

  const index = YAML.parse(read(idx));
  for (const [key, rel] of Object.entries(index.items || {})) {
    const file = firstExistingPath([
      path.join(root, 'data/items', rel),
      path.join(root, 'server/content/data/items', rel),
      path.join(root, 'content/data/items', rel),
    ]);
    if (!file) { console.warn('[items] não achei arquivo para', key, rel); continue; }

    const src = read(file);
    const sum = sha1(src);

    // Consulta o checksum, mas NÃO fazemos early-continue
    await get(`SELECT checksum FROM content_files WHERE path=$1`, [file]).catch(() => null);

    // valida pelo schema; se falhar, segue permissivo
    let raw = null, data = null;
    try {
      raw = YAML.parse(src);
      data = ItemYAML.parse(raw);
    } catch (e) {
      console.warn('[items] schema warning (fallback permissivo):', file, e.message);
      raw = raw || YAML.parse(src);
      data = Object.assign({}, raw);
      if (!data.key) data.key = String(key);
    }

    // denormalizações p/ front
    const name        = String(data.name || data.key || key);
    const slot        = (data.slot || data.kind || '').toString().toUpperCase() || null; // p/ bag: BACK
    const weapon_type = data.weapon_type ? String(data.weapon_type) : null;
    const sprite      = data.icon ? String(data.icon) : (data.sprite ? String(data.sprite) : null);
    const atk         = Number.isFinite(+data.atk) ? +data.atk : null;
    const def         = Number.isFinite(+data.def) ? +data.def : null;
    const kind        = data.kind ? String(data.kind) : null;
    const slots       = Number.isFinite(+data.slots) ? +data.slots : null;
    const stackable   = (typeof data.stackable === 'boolean') ? data.stackable : null;

    await run(`
      INSERT INTO items_master(
        key, "dataJSON", name, slot, kind, weapon_type, sprite, atk, def, slots, stackable, updated_at
      )
      VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      ON CONFLICT (key) DO UPDATE SET
        "dataJSON"  = EXCLUDED."dataJSON",
        name        = EXCLUDED.name,
        slot        = EXCLUDED.slot,
        kind        = EXCLUDED.kind,
        weapon_type = EXCLUDED.weapon_type,
        sprite      = EXCLUDED.sprite,
        atk         = EXCLUDED.atk,
        def         = EXCLUDED.def,
        slots       = EXCLUDED.slots,
        stackable   = EXCLUDED.stackable,
        updated_at  = now()
    `, [
      data.key, JSON.stringify(data),
      name, slot, kind, weapon_type, sprite, atk, def, slots, stackable
    ]);

    await run(`
      INSERT INTO content_files(path, checksum, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (path) DO UPDATE SET
        checksum=EXCLUDED.checksum,
        updated_at=now()
    `, [file, sum]);
  }
}

async function loadSprites(db, root) {
  const { get, run } = db;
  const base = resolveSpritesBase(root);
  if (!base) return;

  // 1) tenta índice
  let indexEntries = null;
  const idxFiles = [
    path.join(root, 'data/sprites.yml'),
    path.join(base, 'index.yml')
  ].filter(fs.existsSync);

  for (const idx of idxFiles) {
    try {
      const idxObj = YAML.parse(read(idx));
      const entries = Object.entries((idxObj && idxObj.sprites) || {});
      if (entries.length) {
        indexEntries = entries.map(([key, rel]) => ({
          key,
          file: firstExistingPath([
            path.join(base, rel),
            path.join(root, 'server/content/data/sprites', rel),
            path.join(root, 'content/data/sprites', rel),
          ])
        })).filter(e => !!e.file);
        break;
      }
    } catch (e) {
      console.warn('[sprites] índice inválido:', idx, e.message);
    }
  }

  // 2) sem índice, varre tudo
  let filesToLoad = [];
  if (indexEntries) {
    filesToLoad = indexEntries;
  } else {
    const yamlFiles = listRecursive(base, '.yml');
    filesToLoad = yamlFiles.map(f => ({ key: null, file: f }));
  }

  for (const ent of filesToLoad) {
    const file = ent.file;
    if (!file || !fs.existsSync(file)) {
      console.warn('[sprites] arquivo ausente (índice?):', file);
      continue;
    }

    const src = read(file);
    const sum = sha1(src);

    // Consulta o checksum, mas NÃO fazemos early-continue
    await get(`SELECT checksum FROM content_files WHERE path=$1`, [file]).catch(() => null);

    const parsed = YAML.parse(src);
    const data = SpriteYAML.parse(parsed);

    const key = (ent.key && String(ent.key)) || String(data.key);
    if (!key) { console.warn('[sprites] ignorado (sem key):', file); continue; }

    const kind = inferSpriteKind(file, data);

    await run(`
      INSERT INTO sprites_master(key, kind, "dataJSON", updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        kind=EXCLUDED.kind,
        "dataJSON"=EXCLUDED."dataJSON",
        updated_at=now()
    `, [key, kind, JSON.stringify(data)]);

    await run(`
      INSERT INTO content_files(path, checksum, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (path) DO UPDATE SET
        checksum=EXCLUDED.checksum,
        updated_at=now()
    `, [file, sum]);
  }
}

async function loadMap(db, root, mapKey) {
  const { get, run } = db;
  const file = resolveMapFile(root, mapKey);
  if (!file) return;

  const src = read(file);
  const sum = sha1(src);

  // Para mapas, manter o early-return (custoso reprocessar e não temos denormalizações aqui)
  const seen = await get(`SELECT checksum FROM content_files WHERE path=$1`, [file]).catch(() => null);
  if (seen && seen.checksum === sum) return;

  const json = JSON.parse(src);
  TiledMapJSON.parse(json);

  await run(`
    INSERT INTO maps(key, "dataJSON", updated_at)
    VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET
      "dataJSON"=EXCLUDED."dataJSON",
      updated_at=now()
  `, [mapKey, JSON.stringify(json)]);

  // reseta objetos/spawns daquele mapa
  await run(`DELETE FROM map_objects WHERE "mapKey"=$1`, [mapKey]);
  await run(`DELETE FROM spawns      WHERE "mapKey"=$1`, [mapKey]);

  for (const layer of (json.layers || [])) {
    if (layer.type !== 'objectgroup' || !layer.objects) continue;

    const lname = (layer.name || '').toLowerCase();
    const isSpawnLayer = (lname === 'spawn' || lname === 'spawns');

    if (isSpawnLayer) {
      for (const o of layer.objects) {
        const otype = ((o.class || o.type || '') + '').toLowerCase();
        if (otype && otype !== 'spawn') continue;

        const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
        const leashPx = parseLeashPx(props);
        await run(`
          INSERT INTO spawns(
            "mapKey","monsterKey", x, y, w, h,
            count, "respawnSec", "levelMin", "levelMax", "leashPx"
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          mapKey, props.monsterKey || '',
          Math.round(o.x || 0), Math.round(o.y || 0),
          Math.round(o.width  || 0), Math.round(o.height || 0),
          Number(props.count || 1), Number(props.respawnSec || 60),
          Number(props.levelMin || 1), Number(props.levelMax || 999),
          leashPx
        ]);
      }
    } else {
      for (const o of layer.objects) {
        const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
        const objectTypeRaw = ((o.class || o.type || '') + '').trim();
        const type = objectTypeRaw ? objectTypeRaw.toLowerCase() : lname;
        await run(`
          INSERT INTO map_objects("mapKey", type, x, y, w, h, "propsJSON")
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [
          mapKey, type,
          Math.round(o.x || 0), Math.round(o.y || 0),
          Math.round(o.width || 0), Math.round(o.height || 0),
          JSON.stringify(props)
        ]);
      }
    }
  }

  await run(`
    INSERT INTO content_files(path, checksum, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (path) DO UPDATE SET
      checksum=EXCLUDED.checksum,
      updated_at=now()
  `, [file, sum]);
}

async function loadAll(db, root) {
  await loadMonsters(db, root);
  await loadItems(db, root);
  await loadSprites(db, root);
  await loadMap(db, root, 'house');

  console.log('[content] Finished loadAll()');

  try {
    const monsters = await db.all(`SELECT key,name,xp FROM monsters_master ORDER BY id LIMIT 10`);
    console.log('[content] monsters:', monsters);
  } catch (e) { console.error('[content] query error (monsters):', e.message); }

  try {
    const items = await db.all(`SELECT key FROM items_master ORDER BY key LIMIT 10`);
    console.log('[content] items:', items);
  } catch (e) { console.error('[content] query error (items):', e.message); }

  try {
    const sprites = await db.all(`SELECT key FROM sprites_master ORDER BY key LIMIT 10`);
    console.log('[content] sprites:', sprites);
  } catch (e) { console.error('[content] query error (sprites):', e.message); }
}

module.exports = { loadAll, loadMap };
