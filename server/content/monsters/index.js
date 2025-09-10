// server/content/monsters/index.js
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const MON_PATH = path.resolve(process.cwd(), 'data/sprites/monsters');

let cache = null;

function loadAll() {
  const out = {};
  if (!fs.existsSync(MON_PATH)) return out;
  const files = fs.readdirSync(MON_PATH).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(MON_PATH, file), 'utf8');
    const doc = YAML.parse(raw);
    if (!doc || !doc.key) continue;
    out[String(doc.key)] = doc;
  }
  return out;
}

function getAll() {
  if (!cache) cache = loadAll();
  return cache;
}

function getByKey(key) {
  return getAll()[String(key)] || null;
}

function reload() { cache = loadAll(); }

module.exports = {
  monstersYaml: getAll(),
  getMonsterDef: getByKey,
  reloadMonsters: reload,
};
