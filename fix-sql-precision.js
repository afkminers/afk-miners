// fix-sql-precision.js
// Uso:
//   node fix-sql-precision.js --check   -> só mostra o que mudaria
//   node fix-sql-precision.js --write   -> aplica mudanças (gera .bak seguro)
//
// Troca APENAS dentro de strings SQL padrões:
//   alias.herokey   -> alias."heroKey"
//   alias.isstarter -> alias."isStarter"
//   alias.playerid  -> alias."playerId"
//   alias.createdat -> alias."createdAt"
//   alias.updatedat -> alias."updatedAt"

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, 'server');

const WRITE = process.argv.includes('--write');
const SQL_HINT = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|RETURNING|VALUES)\b/i;

const SUFFIX_MAP = {
  herokey: '"heroKey"',
  isstarter: '"isStarter"',
  playerid: '"playerId"',
  createdat: '"createdAt"',
  updatedat: '"updatedAt"',
};

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

function extractQuotedBlocks(src) {
  const blocks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      let j = i + 1, esc = false;
      while (j < src.length) {
        const c = src[j];
        if (!esc && c === q) { j++; break; }
        esc = !esc && c === '\\';
        j++;
      }
      blocks.push({ start: i, end: j, text: src.slice(i, j) });
      i = j;
    } else i++;
  }
  return blocks;
}

function fixBlockText(txt) {
  const q = txt[0];
  const inner = txt.slice(1, -1);
  if (!SQL_HINT.test(inner)) return null;

  const fixed = inner.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*(herokey|isstarter|playerid|createdat|updatedat)\b/g,
    (_, alias, suf) => `${alias}.${SUFFIX_MAP[suf.toLowerCase()]}`
  );
  if (fixed === inner) return null;
  return q + fixed + q;
}

function processFile(p) {
  const src = fs.readFileSync(p, 'utf8');
  const blocks = extractQuotedBlocks(src);
  const edits = [];
  for (const b of blocks) {
    const fixed = fixBlockText(b.text);
    if (fixed) edits.push({ ...b, fixed });
  }
  if (!edits.length) return false;

  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.fixed + out.slice(e.end);
  }

  if (WRITE) {
    const bak = p + '.bak';
    fs.writeFileSync(bak, src, 'utf8');
    fs.writeFileSync(p, out, 'utf8');
    console.log(`[fix] ${path.relative(ROOT, p)} (bak: ${path.basename(bak)})`);
  } else {
    console.log(`[would-fix] ${path.relative(ROOT, p)}`);
  }
  return true;
}

(function run() {
  const files = walk(SERVER_DIR);
  let touched = 0;
  for (const f of files) if (processFile(f)) touched++;
  console.log(`\n${WRITE ? 'Aplicado' : 'Verificado'}: ${touched} arquivo(s) com mudanças.`);
})();