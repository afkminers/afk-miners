// server/content/loader.js  (exemplo de caminho)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");
const { MonsterYAML, ItemYAML, SpriteYAML, TiledMapJSON } = require("./schemas");

function sha1(buf) { return crypto.createHash("sha1").update(buf).digest("hex"); }
function read(file) { return fs.readFileSync(file, "utf-8"); }
function list(dir, ext) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith(ext))
        .map(f => path.join(dir, f))
    : [];
}

function upsert(db, sql, params) {
  return new Promise((res, rej) => db.run(sql, params, function (err) {
    if (err) rej(err); else res(this);
  }));
}
function get(db, sql, params) {
  return new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
}

async function loadMonsters(db, root) {
  const idx = path.join(root, "data/monsters/index.yml");
  if (!fs.existsSync(idx)) return;
  const index = YAML.parse(read(idx));
  const entries = Object.entries(index.monsters || {});
  for (const [key, rel] of entries) {
    const file = path.join(root, "data/monsters", rel);
    const src = read(file); const sum = sha1(src);
    const seen = await get(db, "SELECT checksum FROM content_files WHERE path=?", [file]).catch(() => null);
    if (seen && seen.checksum === sum) continue;

    const data = MonsterYAML.parse(YAML.parse(src));
    await upsert(db, `
      INSERT INTO monsters_master(key,name,xp,healthMax,speed,flagsJSON,elementsJSON,attacksJSON,defensesJSON,lootJSON,lookJSON,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        name=excluded.name,xp=excluded.xp,healthMax=excluded.healthMax,speed=excluded.speed,
        flagsJSON=excluded.flagsJSON,elementsJSON=excluded.elementsJSON,attacksJSON=excluded.attacksJSON,
        defensesJSON=excluded.defensesJSON,lootJSON=excluded.lootJSON,lookJSON=excluded.lookJSON,
        updated_at=CURRENT_TIMESTAMP
    `, [
      data.key, data.name, data.xp, data.health.max, data.speed,
      JSON.stringify(data.flags || {}), JSON.stringify(data.elements || {}),
      JSON.stringify(data.attacks || []), JSON.stringify(data.defenses || {}),
      JSON.stringify(data.loot || []), JSON.stringify(data.look || {})
    ]);

    await upsert(db, `
      INSERT INTO content_files(path,checksum,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP
    `, [file, sum]);
  }
}

async function loadItems(db, root) {
  const idx = path.join(root, "data/items/index.yml");
  if (!fs.existsSync(idx)) return;
  const index = YAML.parse(read(idx));
  for (const [key, rel] of Object.entries(index.items || {})) {
    const file = path.join(root, "data/items", rel);
    const src = read(file); const sum = sha1(src);
    const seen = await get(db, "SELECT checksum FROM content_files WHERE path=?", [file]).catch(() => null);
    if (seen && seen.checksum === sum) continue;

    const data = ItemYAML.parse(YAML.parse(src));
    await upsert(db, `
      INSERT INTO items_master(key,dataJSON,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET dataJSON=excluded.dataJSON, updated_at=CURRENT_TIMESTAMP
    `, [data.key, JSON.stringify(data)]);

    await upsert(db, `
      INSERT INTO content_files(path,checksum,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP
    `, [file, sum]);
  }
}

async function loadSprites(db, root) {
  const dir = path.join(root, "data/sprites/characters");
  if (!fs.existsSync(dir)) return;
  for (const file of list(dir, ".yml")) {
    const src = read(file); const sum = sha1(src);
    const seen = await get(db, "SELECT checksum FROM content_files WHERE path=?", [file]).catch(() => null);
    if (seen && seen.checksum === sum) continue;

    const data = SpriteYAML.parse(YAML.parse(src));
    await upsert(db, `
      INSERT INTO sprites_master(key,kind,dataJSON,updated_at) VALUES(?, "character", ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET kind="character", dataJSON=excluded.dataJSON, updated_at=CURRENT_TIMESTAMP
    `, [data.key, JSON.stringify(data)]);

    await upsert(db, `
      INSERT INTO content_files(path,checksum,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP
    `, [file, sum]);
  }
}

async function loadMap(db, root, mapKey) {
  const file = path.join(root, `data/maps/${mapKey}.json`);
  if (!fs.existsSync(file)) return;

  const src = read(file); const sum = sha1(src);
  const seen = await get(db, "SELECT checksum FROM content_files WHERE path=?", [file]).catch(() => null);
  if (seen && seen.checksum === sum) return;

  const json = JSON.parse(src);
  TiledMapJSON.parse(json);

  await upsert(db, `
    INSERT INTO maps(key,dataJSON,updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET dataJSON=excluded.dataJSON, updated_at=CURRENT_TIMESTAMP
  `, [mapKey, JSON.stringify(json)]);

  // reset objetos/spawns do mapa
  await upsert(db, `DELETE FROM map_objects WHERE mapKey=?`, [mapKey]);
  await upsert(db, `DELETE FROM spawns WHERE mapKey=?`, [mapKey]);

  for (const layer of (json.layers || [])) {
    if (layer.type !== "objectgroup" || !layer.objects) continue;

    const lname = (layer.name || "").toLowerCase();
    const isSpawnLayer = (lname === "spawn" || lname === "spawns");

    if (isSpawnLayer) {
      // grava somente objetos de spawn (type/class "spawn")
      for (const o of layer.objects) {
        const otype = ((o.class || o.type || "") + "").toLowerCase();
        if (otype && otype !== "spawn") continue;

        const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
        await upsert(db, `
          INSERT INTO spawns(mapKey,monsterKey,x,y,w,h,count,respawnSec,levelMin,levelMax)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `, [
          mapKey, props.monsterKey || "",
          Math.round(o.x || 0), Math.round(o.y || 0),
          Math.round(o.width  || 0), Math.round(o.height || 0),
          Number(props.count || 1), Number(props.respawnSec || 60),
          Number(props.levelMin || 1), Number(props.levelMax || 999)
        ]);
      }
    } else {
      // demais objetos (ex.: start)
      for (const o of layer.objects) {
        const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
        await upsert(db, `
          INSERT INTO map_objects(mapKey,type,x,y,w,h,propsJSON)
          VALUES(?,?,?,?,?,?,?)
        `, [
          mapKey, lname, // usamos o nome da camada como "type" (ex.: "start")
          Math.round(o.x || 0), Math.round(o.y || 0),
          Math.round(o.width || 0), Math.round(o.height || 0),
          JSON.stringify(props)
        ]);
      }
    }
  }

  await upsert(db, `
    INSERT INTO content_files(path,checksum,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP
  `, [file, sum]);
}

async function loadAll(db, root) {
  await loadMonsters(db, root);
  await loadItems(db, root);
  await loadSprites(db, root);
  await loadMap(db, root, "house"); // carrega house.json se existir

  // Logs rápidos (opcional)
  console.log("[content] Finished loadAll()");
  db.all("SELECT key,name,xp FROM monsters_master", (err, rows) => {
    if (err) console.error("[content] query error (monsters):", err.message);
    else console.log("[content] monsters:", rows);
  });
  db.all("SELECT key FROM items_master", (err, rows) => {
    if (err) console.error("[content] query error (items):", err.message);
    else console.log("[content] items:", rows);
  });
  db.all("SELECT key FROM sprites_master", (err, rows) => {
    if (err) console.error("[content] query error (sprites):", err.message);
    else console.log("[content] sprites:", rows);
  });
}

module.exports = { loadAll, loadMap };
