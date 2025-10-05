// server/utils/loadSpriteMetaFromDisk.js
// Helper to load sprite metadata directly from YAML files on disk.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const SPRITE_BASE_PATHS = [
  path.resolve(process.cwd(), 'data/sprites'),
  path.resolve(process.cwd(), 'server/content/data/sprites'),
  path.resolve(process.cwd(), 'content/data/sprites'),
];

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function listYamlFilesRecursive(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listYamlFilesRecursive(full));
    else if (entry.toLowerCase().endsWith('.yml') || entry.toLowerCase().endsWith('.yaml')) out.push(full);
  }
  return out;
}

function inferKindFromPath(filePath, data) {
  if (data && typeof data.kind === 'string' && data.kind.trim()) {
    return data.kind.trim();
  }
  const fp = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (fp.includes('/monsters/')) return 'monster';
  if (fp.includes('/characters/')) return 'character';
  return 'sprite';
}

function normalizeKey(rawKey, fallbackFile) {
  if (rawKey && String(rawKey).trim()) return String(rawKey).trim();
  if (!fallbackFile) return null;
  const base = path.basename(fallbackFile).replace(/\.(yml|yaml)$/i, '');
  return base;
}

function loadFromIndex(baseDir) {
  const idx = firstExisting([
    path.join(baseDir, 'index.yml'),
    path.join(baseDir, 'index.yaml'),
  ]);
  if (!idx) return null;
  try {
    const parsed = YAML.parse(fs.readFileSync(idx, 'utf8'));
    const entries = Object.entries((parsed && parsed.sprites) || {});
    return entries.map(([key, rel]) => ({
      key: String(key),
      file: path.join(baseDir, rel),
    }));
  } catch (err) {
    console.warn('[sprites] falha ao ler index YAML:', idx, err?.message);
    return null;
  }
}

function uniqueByKey(entries) {
  const map = new Map();
  for (const ent of entries) {
    if (!ent || !ent.key) continue;
    const k = String(ent.key);
    if (!map.has(k)) map.set(k, ent);
  }
  return Array.from(map.values());
}

function loadSpriteMetaFromBase(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const entries = loadFromIndex(baseDir) || listYamlFilesRecursive(baseDir).map((file) => ({ key: null, file }));
  const out = [];
  for (const ent of entries) {
    const file = ent.file;
    if (!file || !fs.existsSync(file)) continue;
    let data;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      data = YAML.parse(raw);
    } catch (err) {
      console.warn('[sprites] falha ao ler YAML:', file, err?.message);
      continue;
    }
    if (!data || typeof data !== 'object') continue;
    const key = normalizeKey(data.key || ent.key, file);
    if (!key) continue;
    const kind = inferKindFromPath(file, data);
    out.push({ key, kind, data });
  }
  return uniqueByKey(out);
}

function loadSpriteMetaFromDisk() {
  const collected = [];
  for (const base of SPRITE_BASE_PATHS) {
    collected.push(...loadSpriteMetaFromBase(base));
  }
  const deduped = new Map();
  for (const entry of collected) {
    if (!entry || !entry.key) continue;
    const key = String(entry.key);
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }
  return Array.from(deduped.values());
}

module.exports = {
  loadSpriteMetaFromDisk,
};
