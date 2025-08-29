// fix-sql-columns.js
// Uso:
//   node fix-sql-columns.js --check   (mostra problemas sem alterar)
//   node fix-sql-columns.js --write   (aplica correções com backup .bak)
//
// O que faz:
// - Percorre server/**/*.js
// - Dentro de strings com cara de SQL (SELECT/INSERT/UPDATE/DELETE), corrige
//   colunas minúsculas para as camelCase com aspas e corrige aliases.
// - Exemplos: hm.herokey -> hm."heroKey"; ph.isstarter -> ph."isStarter"
//             players.createdat -> players."createdAt"
//             INSERT (...) usa "playerId","heroKey","isStarter","createdAt","updatedAt"
// - Cria backup .bak antes de alterar.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, 'server');

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check') || !WRITE;

// mapeamentos de colunas minúsculas -> camelCase
const COLS = {
  createdat: '"createdAt"',
  updatedat: '"updatedAt"',
  playerid : '"playerId"',
  herokey  : '"heroKey"',
  isstarter: '"isStarter"',
};

// regex para detectar se uma string "parece SQL"
const SQL_HINT = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|RETURNING)\b/i;

// pega todos os .js em server/
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walk(p));
    else if (e.isFile() && p.endsWith('.js')) files.push(p);
  }
  return files;
}

// extrai blocos de string (`, ' ou ") e retorna offsets para edições locais
function extractStringBlocks(src) {
  const blocks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let escaped = false;
      while (j < src.length) {
        const c = src[j];
        if (!escaped && c === quote) { j++; break; }
        escaped = !escaped && c === '\\';
        j++;
      }
      const text = src.slice(i, j);
      blocks.push({ start: i, end: j, text });
      i = j;
    } else {
      i++;
    }
  }
  return blocks;
}

// aplica substituições somente dentro dos blocos que "parecem SQL"
function fixSqlInSource(src) {
  const blocks = extractStringBlocks(src);
  let changes = [];
  let out = src.split('');

  function applyReplace(start, end, newText) {
    changes.push({ start, end, newText });
  }

  for (const b of blocks) {
    const body = b.text.slice(1, -1); // remove aspas externas
    if (!SQL_HINT.test(body)) continue;

    let fixed = body;

    // 1) Corrigir padrões com alias "." + coluna minúscula
    //    Ex.: hm.herokey -> hm."heroKey"
    fixed = fixed.replace(
      /(\b[a-zA-Z_][a-zA-Z0-9_]*\b)\s*\.\s*(createdat|updatedat|playerid|herokey|isstarter)\b/gi,
      (_m, alias, col) => `${alias} . ${COLS[col.toLowerCase()] || col}`
    );

    // 2) Corrigir colunas “soltas” em listas de colunas/updates:
    //    (..., createdat, ...) -> (..., "createdAt", ...)
    fixed = fixed.replace(
      /\b(createdat|updatedat|playerid|herokey|isstarter)\b/gi,
      (m) => COLS[m.toLowerCase()] || m
    );

    if (fixed !== body) {
      const wrapped = b.text[0] + fixed + b.text[b.text.length - 1];
      applyReplace(b.start, b.end, wrapped);
    }
  }

  if (changes.length === 0) return null;

  // aplicar de trás pra frente pra não mexer offsets
  changes.sort((a, b) => b.start - a.start);
  for (const c of changes) {
    out.splice(c.start, c.end - c.start, c.newText);
  }
  return out.join('');
}

function run() {
  const files = walk(SERVER_DIR);
  let edited = 0;
  let flagged = 0;

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const fixed = fixSqlInSource(src);
    if (fixed === null) {
      // só para checagem, ainda podemos procurar ocorrências cruas
      if (CHECK) {
        const still = src.match(/\b(createdat|updatedat|playerid|herokey|isstarter)\b/gi);
        if (still && still.length) {
          const hint = still.slice(0, 6).join(', ');
          console.log(`[!] Possíveis ocorrências em: ${path.relative(ROOT, f)}  -> ${hint}`);
          flagged++;
        }
      }
      continue;
    }

    if (WRITE) {
      const bak = f + '.bak';
      fs.writeFileSync(bak, src, 'utf8');
      fs.writeFileSync(f, fixed, 'utf8');
      console.log(`[fix] ${path.relative(ROOT, f)}  (backup: ${path.basename(bak)})`);
      edited++;
    } else {
      console.log(`[would-fix] ${path.relative(ROOT, f)}`);
      flagged++;
    }
  }

  if (WRITE) {
    console.log(`\nFeito. Arquivos alterados: ${edited}`);
    console.log(`Backups .bak criados ao lado de cada arquivo.`);
  } else {
    console.log(`\nCheck concluído. Arquivos a corrigir (ou com suspeitas): ${flagged}`);
    console.log(`Para aplicar, rode: node fix-sql-columns.js --write`);
  }
}

run();
