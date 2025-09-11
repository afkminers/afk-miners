// Node 18+
// Uso: node scripts/audit-db-vs-files.js
// Lê items_master e sprites_master no DB e compara com a árvore de arquivos.
const fs = require('fs');
const path = require('path');

// Tente primeiro a factory nova; se não existir, cai para models/db.
let db;
try { db = require('../server/db'); } catch {
  db = require('../server/models/db');
}
const { all } = db;

function listFilesRec(root, exts) {
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else {
        const ext = path.extname(name.name).toLowerCase();
        if (!exts || exts.includes(ext)) out.push(p);
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out;
}

function baseKeyFromPath(p, root) {
  const rel = path.relative(root, p).replace(/\\/g, '/');
  const b = path.basename(rel, path.extname(rel));
  return b;
}

(async () => {
  const itemsRows = await all(`SELECT key FROM items_master ORDER BY key`, []);
  const spritesRows = await all(`SELECT key, kind FROM sprites_master ORDER BY key`, []);

  const itemRoot = path.join(__dirname, '..', 'data', 'items');
  const monsterRoot = path.join(__dirname, '..', 'data', 'sprites', 'monsters');

  const itemFiles = listFilesRec(itemRoot, ['.yml', '.yaml']);
  const monsterFiles = listFilesRec(monsterRoot, ['.yml', '.yaml']);

  const itemKeysFS = new Set(itemFiles.map(f => baseKeyFromPath(f, itemRoot)));
  const monsterKeysFS = new Set(monsterFiles.map(f => baseKeyFromPath(f, monsterRoot)));

  const itemsDB = itemsRows.map(r => String(r.key));
  const monstersDB = spritesRows
    .filter(r => String(r.kind).toLowerCase() === 'monster')
    .map(r => String(r.key));

  const itemsMissingFiles = itemsDB.filter(k => !itemKeysFS.has(k));
  const monstersMissingYaml = monstersDB.filter(k => !monsterKeysFS.has(k));

  const report = {
    counts: {
      itemsDB: itemsDB.length,
      itemFiles: itemFiles.length,
      monstersDB: monstersDB.length,
      monsterFiles: monsterFiles.length
    },
    itemsMissingFiles,
    monstersMissingYaml
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});