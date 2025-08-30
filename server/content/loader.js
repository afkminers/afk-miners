  // server/content/loader.js
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const YAML = require('yaml');
  const { MonsterYAML, ItemYAML, SpriteYAML, TiledMapJSON } = require('./schemas');

  function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }
  function read(file) { return fs.readFileSync(file, 'utf-8'); }
  function list(dir, ext) {
    return fs.existsSync(dir)
      ? fs.readdirSync(dir)
          .filter(f => f.toLowerCase().endsWith(ext))
          .map(f => path.join(dir, f))
      : [];
  }

  // --- helpers extras ---
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

  /**
   * OBS: Este loader usa um adaptador com as funções { all, get, run } — não o objeto sqlite.
   * Passe { all, get, run } em index.js: await loadAll({ all, get, run }, root)
   */

  async function loadMonsters(db, root) {
    const { get, run } = db;
    const idx = path.join(root, 'data/monsters/index.yml');
    if (!fs.existsSync(idx)) return;

    const index = YAML.parse(read(idx));
    const entries = Object.entries(index.monsters || {});
    for (const [key, rel] of entries) {
      const file = path.join(root, 'data/monsters', rel);
      const src = read(file);
      const sum = sha1(src);

      const seen = await get(
        `SELECT checksum FROM content_files WHERE path=$1`,
        [file]
      ).catch(() => null);
      if (seen && seen.checksum === sum) continue;

      const data = MonsterYAML.parse(YAML.parse(src));

      await run(
        `
        INSERT INTO monsters_master
          (key, name, xp, "healthMax", speed,
          "flagsJSON", "elementsJSON", "attacksJSON", "defensesJSON", "lootJSON", "lookJSON",
          updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
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
          updated_at=now()
        `,
        [
          data.key, data.name, data.xp, data.health.max, data.speed,
          JSON.stringify(data.flags || {}),
          JSON.stringify(data.elements || {}),
          JSON.stringify(data.attacks || []),
          JSON.stringify(data.defenses || {}),
          JSON.stringify(data.loot || []),
          JSON.stringify(data.look || {})
        ]
      );

      await run(
        `
        INSERT INTO content_files(path, checksum, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (path) DO UPDATE SET
          checksum=EXCLUDED.checksum,
          updated_at=now()
        `,
        [file, sum]
      );
    }
  }

  async function loadItems(db, root) {
    const { get, run } = db;
    const idx = path.join(root, 'data/items/index.yml');
    if (!fs.existsSync(idx)) return;

    const index = YAML.parse(read(idx));
    for (const [key, rel] of Object.entries(index.items || {})) {
      const file = path.join(root, 'data/items', rel);
      const src = read(file);
      const sum = sha1(src);

      const seen = await get(
        `SELECT checksum FROM content_files WHERE path=$1`,
        [file]
      ).catch(() => null);
      if (seen && seen.checksum === sum) continue;

      const data = ItemYAML.parse(YAML.parse(src)); // contém .key

      await run(
        `
        INSERT INTO items_master(key, "dataJSON", updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET
          "dataJSON"=EXCLUDED."dataJSON",
          updated_at=now()
        `,
        [data.key, JSON.stringify(data)]
      );

      await run(
        `
        INSERT INTO content_files(path, checksum, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (path) DO UPDATE SET
          checksum=EXCLUDED.checksum,
          updated_at=now()
        `,
        [file, sum]
      );
    }
  }

  async function loadSprites(db, root) {
    const { get, run } = db;
    const base = path.join(root, 'data/sprites');
    if (!fs.existsSync(base)) return;

    // 1) Tenta índice (data/sprites.yml ou data/sprites/index.yml)
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
            file: path.join(base, rel)
          }));
          break;
        }
      } catch (e) {
        console.warn('[sprites] índice inválido:', idx, e.message);
      }
    }

    // 2) Se não houver índice, varre recursivamente todos os .yml
    let filesToLoad = [];
    if (indexEntries) {
      filesToLoad = indexEntries;
    } else {
      const yamlFiles = listRecursive(base, '.yml');
      filesToLoad = yamlFiles.map(f => ({ key: null, file: f }));
    }

    for (const ent of filesToLoad) {
      const file = ent.file;
      if (!fs.existsSync(file)) {
        console.warn('[sprites] arquivo não existe (índice aponta para):', file);
        continue;
      }

      const src = read(file);
      const sum = sha1(src);

      const seen = await get(
        `SELECT checksum FROM content_files WHERE path=$1`,
        [file]
      ).catch(() => null);
      if (seen && seen.checksum === sum) continue;

      // Parse e validação
      const parsed = YAML.parse(src);
      const data = SpriteYAML.parse(parsed);

      // key pode vir do índice ou do próprio YAML
      const key = (ent.key && String(ent.key)) || String(data.key);
      if (!key) {
        console.warn('[sprites] ignorado (sem key):', file);
        continue;
      }

      // kind dinâmico
      const kind = inferSpriteKind(file, data);

      await run(
        `
        INSERT INTO sprites_master(key, kind, "dataJSON", updated_at)
        VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET
          kind=EXCLUDED.kind,
          "dataJSON"=EXCLUDED."dataJSON",
          updated_at=now()
        `,
        [key, kind, JSON.stringify(data)]
      );

      await run(
        `
        INSERT INTO content_files(path, checksum, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (path) DO UPDATE SET
          checksum=EXCLUDED.checksum,
          updated_at=now()
        `,
        [file, sum]
      );
    }
  }

  async function loadMap(db, root, mapKey) {
    const { get, run } = db;
    const file = path.join(root, `data/maps/${mapKey}.json`);
    if (!fs.existsSync(file)) return;

    const src = read(file);
    const sum = sha1(src);

    const seen = await get(
      `SELECT checksum FROM content_files WHERE path=$1`,
      [file]
    ).catch(() => null);
    if (seen && seen.checksum === sum) return;

    const json = JSON.parse(src);
    TiledMapJSON.parse(json);

    await run(
      `
      INSERT INTO maps(key, "dataJSON", updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        "dataJSON"=EXCLUDED."dataJSON",
        updated_at=now()
      `,
      [mapKey, JSON.stringify(json)]
    );

    // reset objetos/spawns do mapa
    await run(`DELETE FROM map_objects WHERE "mapKey"=$1`, [mapKey]);
    await run(`DELETE FROM spawns      WHERE "mapKey"=$1`, [mapKey]);

    for (const layer of (json.layers || [])) {
      if (layer.type !== 'objectgroup' || !layer.objects) continue;

      const lname = (layer.name || '').toLowerCase();
      const isSpawnLayer = (lname === 'spawn' || lname === 'spawns');

      if (isSpawnLayer) {
        // grava somente objetos de spawn (type/class "spawn")
        for (const o of layer.objects) {
          const otype = ((o.class || o.type || '') + '').toLowerCase();
          if (otype && otype !== 'spawn') continue;

          const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
          await run(
            `
            INSERT INTO spawns(
              "mapKey","monsterKey", x, y, w, h,
              count, "respawnSec", "levelMin", "levelMax"
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            `,
            [
              mapKey, props.monsterKey || '',
              Math.round(o.x || 0), Math.round(o.y || 0),
              Math.round(o.width  || 0), Math.round(o.height || 0),
              Number(props.count || 1), Number(props.respawnSec || 60),
              Number(props.levelMin || 1), Number(props.levelMax || 999)
            ]
          );
        }
      } else {
        // demais objetos (ex.: start)
        for (const o of layer.objects) {
          const props = Object.fromEntries((o.properties || []).map(p => [p.name, p.value]));
          await run(
            `
            INSERT INTO map_objects(
              "mapKey", type, x, y, w, h, "propsJSON"
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            `,
            [
              mapKey, lname,
              Math.round(o.x || 0), Math.round(o.y || 0),
              Math.round(o.width || 0), Math.round(o.height || 0),
              JSON.stringify(props)
            ]
          );
        }
      }
    }

    await run(
      `
      INSERT INTO content_files(path, checksum, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (path) DO UPDATE SET
        checksum=EXCLUDED.checksum,
        updated_at=now()
      `,
      [file, sum]
    );
  }

  async function loadAll(db, root) {
    await loadMonsters(db, root);
    await loadItems(db, root);
    await loadSprites(db, root);
    await loadMap(db, root, 'house'); // carrega house.json se existir

    console.log('[content] Finished loadAll()');

    try {
      const monsters = await db.all(`SELECT key,name,xp FROM monsters_master ORDER BY id LIMIT 10`);
      console.log('[content] monsters:', monsters);
    } catch (e) {
      console.error('[content] query error (monsters):', e.message);
    }

    try {
      const items = await db.all(`SELECT key FROM items_master ORDER BY key LIMIT 10`);
      console.log('[content] items:', items);
    } catch (e) {
      console.error('[content] query error (items):', e.message);
    }

    try {
      const sprites = await db.all(`SELECT key FROM sprites_master ORDER BY key LIMIT 10`);
      console.log('[content] sprites:', sprites);
    } catch (e) {
      console.error('[content] query error (sprites):', e.message);
    }
  }

  module.exports = { loadAll, loadMap };
