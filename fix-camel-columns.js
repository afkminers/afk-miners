#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIRS = ['server'];
const EXTS = ['.js', '.mjs', '.cjs'];

const REPLACEMENTS = [
  // player_heroes
  { from: /\.herokey\b/g, to: '."heroKey"' },
  { from: /\.playerid\b/g, to: '."playerId"' },
  { from: /\.isstarter\b/g, to: '."isStarter"' },
  { from: /\.createdat\b/g, to: '."createdAt"' },
  { from: /\.updatedat\b/g, to: '."updatedAt"' },

  // também em aliases diferentes (ph., hm., etc. — já coberto pelo ponto genérico)
  // player_positions
  { from: /player_positions\s*\(\s*playerId\b/g, to: 'player_positions ("playerId"' },
  { from: /ON CONFLICT\s*\(\s*playerId\s*\)/g, to: 'ON CONFLICT ("playerId")' },
  { from: /\.playerid\b/g, to: '."playerId"' }, // redundante, mas seguro

  // players
  { from: /\.createdat\b/g, to: '."createdAt"' },
  { from: /\.updatedat\b/g, to: '."updatedAt"' },

  // limpa algum "" perdido
  { from: /,\s*""\s*(FROM|AS|WHERE|GROUP|ORDER)/g, to: ' $1' },
];

const mode = process.argv.includes('--write') ? 'write' : 'check';
let changedCount = 0;
let changedFiles = [];

function shouldTouch(file) {
  return EXTS.includes(path.extname(file));
}

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, files);
    } else if (shouldTouch(full)) {
      files.push(full);
    }
  }
  return files;
}

function applyReplacements(text) {
  let out = text;
  for (const rep of REPLACEMENTS) {
    out = out.replace(rep.from, rep.to);
  }
  return out;
}

function run() {
  const files = TARGET_DIRS.flatMap(d => walk(path.join(ROOT, d)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const out = applyReplacements(src);
    if (out !== src) {
      changedCount++;
      changedFiles.push(f);
      if (mode === 'write') {
        fs.writeFileSync(f + '.bak', src, 'utf8');
        fs.writeFileSync(f, out, 'utf8');
      }
    }
  }
  if (mode === 'check') {
    if (changedCount === 0) {
      console.log('Verificado: 0 arquivo(s) com mudanças.');
    } else {
      console.log('[would-fix]', changedFiles.join('\n'));
      console.log(`\nVerificado: ${changedCount} arquivo(s) com mudanças.`);
      console.log('Execute: node fix-camel-columns.js --write');
    }
  } else {
    console.log(`[fix] ${changedFiles.join('\n')}\n\nAplicado: ${changedCount} arquivo(s) com mudanças.`);
  }
}

run();