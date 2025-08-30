// server/scripts/verify-context.mjs (v8 — PG-only, diagnóstico rico)
// Objetivo: validar o pacote em docs/context/* com foco em Postgres
// - Exige artefatos core e PG quando apropriado
// - Verifica JSON parseável, tamanhos, datas de modificação e "staleness"
// - Flags de CLI:
//    --strict            → falha se qualquer opcional PG ausente quando DATABASE_URL existir
//    --require-pg        → força que artefatos PG estejam presentes (mesmo sem DATABASE_URL)
//    --max-age-min=N     → falha se arquivos tiverem mais de N minutos de idade (default: 0 = ignora)
//    --quiet             → reduz verbosidade (apenas erros)
//    --print-summary     → imprime resumo ao final (default on)
//    --no-summary        → desliga resumo
//
// Códigos de saída: 0 ok, 1 erro de verificação

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// ---------- Paths
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');           // repo raiz
const CTX_DIR = path.join(ROOT, 'docs', 'context');          // artefatos ficam em RAIZ/docs/context

// ---------- CLI flags
const argv = process.argv.slice(2);
const HAS = (f) => argv.includes(f);
const GET_NUM = (key, def) => {
  const pfx = `${key}=`;
  const found = argv.find(a => a.startsWith(pfx));
  if (!found) return def;
  const v = parseFloat(found.slice(pfx.length));
  return Number.isFinite(v) ? v : def;
};

const STRICT = HAS('--strict');
const REQUIRE_PG = HAS('--require-pg');
const QUIET = HAS('--quiet');
const PRINT_SUMMARY = HAS('--no-summary') ? false : (HAS('--print-summary') || true);
const MAX_AGE_MIN = GET_NUM('--max-age-min', 0); // 0 = não checa idade

const HAVE_DB_URL = !!process.env.DATABASE_URL;

// ---------- Log helpers
const log = {
  ok: (m) => QUIET ? undefined : console.log(m),
  info: (m) => QUIET ? undefined : console.log(m),
  warn: (m) => QUIET ? undefined : console.warn(m),
  err: (m) => console.error(m),
};

// ---------- Utils
function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error(`Arquivo obrigatório ausente: ${path.relative(ROOT, p)}`);
}
function mustBeJsonParseable(p) {
  const txt = fs.readFileSync(p, 'utf8');
  try { JSON.parse(txt); }
  catch (e) { throw new Error(`JSON inválido: ${path.relative(ROOT, p)} :: ${e.message}`); }
}
function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function ageMinutes(stat) {
  if (!stat) return Infinity;
  const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : new Date(stat.mtime).getTime();
  return (Date.now() - mtime) / 60000;
}
function prettyAge(mins) {
  if (!Number.isFinite(mins)) return 'n/a';
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}
function bytes(n) {
  if (!Number.isFinite(n)) return 'n/a';
  const u = ['B','KB','MB','GB','TB']; let i = 0; let x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}

// ---------- Spec
const requiredText = [
  'context-pack.txt',
  'API.md',
  'changes-since.txt',
  'db-schema.sql'                   // PG obrigatório
];

const requiredJson = [
  'data-summary.json',
  'endpoints-contracts.json',
  'env-usage.json',
  'error-map.json',
  'function-signatures.json',
  'responses-sample.json',
  'deps-graph.json',
  'route-history.json',
  'todos.json',
  'openapi.json',
  'db-tables.json'                  // PG obrigatório
];

// Opcionais gerais
const optionalAny = [
  'symbol-index.json',
  'deps.txt'
];

// Opcionais PG extras (bônus)
const optionalPg = [
  'db-indexes.json',
  'db-views.json',
  'db-enums.json',
  'db-extensions.json',
  'db-stats.json',
  'db-counts.txt'
];

// ---------- Core
function checkListExist(list, ctxDir, parseJson = false) {
  const missing = [];
  for (const f of list) {
    const p = path.join(ctxDir, f);
    if (!fs.existsSync(p)) {
      missing.push(f);
    } else if (parseJson && f.toLowerCase().endsWith('.json')) {
      mustBeJsonParseable(p);
    }
  }
  return missing;
}

function checkAges(allFiles) {
  if (!MAX_AGE_MIN || MAX_AGE_MIN <= 0) return { stale: [] };
  const stale = [];
  for (const rel of allFiles) {
    const p = path.join(CTX_DIR, rel);
    const st = safeStat(p);
    const m = ageMinutes(st);
    if (m > MAX_AGE_MIN) stale.push({ file: rel, ageMin: m });
  }
  return { stale };
}

function collectStats(files) {
  const out = [];
  for (const f of files) {
    const p = path.join(CTX_DIR, f);
    const st = safeStat(p);
    out.push({
      file: f,
      exists: !!st,
      size: st ? st.size : 0,
      mtime: st ? st.mtime : null,
      ageMin: st ? ageMinutes(st) : Infinity,
    });
  }
  return out;
}

function summarize(stats) {
  const existing = stats.filter(s => s.exists);
  const sz = existing.reduce((a, s) => a + s.size, 0);
  const newest = existing.reduce((a, s) => !a || s.mtime > a ? s.mtime : a, null);
  const oldest = existing.reduce((a, s) => !a || s.mtime < a ? s.mtime : a, null);
  return {
    count: existing.length,
    totalSize: sz,
    sizeHuman: bytes(sz),
    newest,
    oldest,
  };
}

function printTable(title, stats) {
  if (QUIET) return;
  console.log(`\n== ${title} ==`);
  const rows = stats
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(s => {
      const age = Number.isFinite(s.ageMin) ? prettyAge(s.ageMin) : 'n/a';
      return `${s.exists ? '✓' : '✗'}  ${s.file.padEnd(28)}  ${String(bytes(s.size)).padStart(9)}  ${age.padStart(8)}`;
    });
  console.log('    Arquivo                      Tamanho     Idade');
  console.log('    ---------------------------  ---------   --------');
  for (const r of rows) console.log('    ' + r);
}

// ---------- PG sanity (conteúdo mínimo)
function validatePgJsonShapes() {
  const problems = [];

  // db-tables.json deve ter { tables: string[], tablesInfo: object }
  const tablesP = path.join(CTX_DIR, 'db-tables.json');
  if (fs.existsSync(tablesP)) {
    try {
      const j = JSON.parse(fs.readFileSync(tablesP, 'utf8'));
      if (!j || !Array.isArray(j.tables)) problems.push('db-tables.json → faltando array "tables".');
      if (!j || typeof j.tablesInfo !== 'object') problems.push('db-tables.json → faltando objeto "tablesInfo".');
    } catch (e) {
      problems.push('db-tables.json → JSON inválido (capturado anteriormente).');
    }
  }

  // db-stats.json lista de objetos com table_name e size_total_bytes
  const statsP = path.join(CTX_DIR, 'db-stats.json');
  if (fs.existsSync(statsP)) {
    try {
      const j = JSON.parse(fs.readFileSync(statsP, 'utf8'));
      if (!Array.isArray(j)) problems.push('db-stats.json → deveria ser array.');
      else if (j.length && (!('table_name' in j[0]) || !('size_total_bytes' in j[0]))) {
        problems.push('db-stats.json → itens devem ter "table_name" e "size_total_bytes".');
      }
    } catch {/* noop */}
  }

  // db-indexes.json array com index_name
  const idxP = path.join(CTX_DIR, 'db-indexes.json');
  if (fs.existsSync(idxP)) {
    try {
      const j = JSON.parse(fs.readFileSync(idxP, 'utf8'));
      if (!Array.isArray(j)) problems.push('db-indexes.json → deveria ser array.');
    } catch {/* noop */}
  }

  return problems;
}

// ---------- MAIN
function main() {
  if (!fs.existsSync(CTX_DIR)) {
    log.err(`❌ Pasta não existe: ${CTX_DIR}\nDica: rode primeiro "npm run ctx:pack" (em server/)`);
    process.exit(1);
  }

  // 1) Core obrigatórios
  const missText = checkListExist(requiredText, CTX_DIR, false);
  const missJson = checkListExist(requiredJson, CTX_DIR, true);

  // 2) Opcionais (gerais e PG)
  //    - Se STRICT ou REQUIRE_PG ou HAVE_DB_URL → tratamos opcionais PG como "devem existir" (soft→hard no STRICT)
  const needPg = REQUIRE_PG || HAVE_DB_URL;
  const missOptAny = checkListExist(optionalAny, CTX_DIR, true);
  const missOptPg = checkListExist(optionalPg, CTX_DIR, true);

  // 3) Tabelas de status/idade/tamanho
  const allLists = [...requiredText, ...requiredJson, ...optionalAny, ...optionalPg];
  const stats = collectStats(allLists);
  const sum = summarize(stats);

  // 4) Idade máxima (se configurada)
  const { stale } = checkAges(allLists);
  const staleMsg = stale.length
    ? `Arquivos desatualizados (> ${MAX_AGE_MIN}min): ${stale.map(s => `${s.file} (${prettyAge(s.ageMin)})`).join(', ')}`
    : '';

  // 5) Impressões
  printTable('Obrigatórios (texto)', collectStats(requiredText));
  printTable('Obrigatórios (JSON)', collectStats(requiredJson));
  if (!QUIET) {
    printTable('Opcionais (gerais)', collectStats(optionalAny));
    if (needPg) printTable('Opcionais PG (bônus)', collectStats(optionalPg));
  }

  // 6) Checagens finais
  const problems = [
    ...missText.map(f => `Faltando: ${f}`),
    ...missJson.map(f => `Faltando: ${f}`),
  ];

  if (needPg) {
    // db-schema.sql e db-tables.json já são obrigatórios acima
    // aqui avaliamos "bônus" PG
    if (STRICT) {
      for (const f of missOptPg) problems.push(`PG opcional ausente (STRICT): ${f}`);
    } else {
      for (const f of missOptPg) log.warn(`⚠️  Opcional PG ausente: ${f}`);
    }
  }

  // Validação básica de shape de alguns JSONs PG
  const shapeIssues = validatePgJsonShapes();
  for (const s of shapeIssues) problems.push(`Formato PG: ${s}`);

  if (staleMsg) {
    if (MAX_AGE_MIN > 0) {
      problems.push(staleMsg);
    } else {
      log.warn(`⚠️  ${staleMsg}`);
    }
  }

  // 7) Resumo final
  if (PRINT_SUMMARY && !QUIET) {
    console.log('\n== Resumo ==');
    console.log(`  Dir:       ${path.relative(ROOT, CTX_DIR)}`);
    console.log(`  Arquivos:  ${sum.count}`);
    console.log(`  Tamanho:   ${sum.sizeHuman}`);
    if (sum.oldest) console.log(`  Mais antigo: ${sum.oldest.toISOString()}`);
    if (sum.newest) console.log(`  Mais novo  : ${sum.newest.toISOString()}`);
    console.log(`  DB_URL?   : ${HAVE_DB_URL ? 'sim' : 'não'}${REQUIRE_PG ? ' (require-pg)' : ''}${STRICT ? ' (strict)' : ''}`);
    if (MAX_AGE_MIN > 0) console.log(`  MaxAge    : ${MAX_AGE_MIN} min`);
  }

  // 8) Resultado
  if (problems.length) {
    log.err('\n❌ Falha na verificação:');
    for (const p of problems) log.err(' - ' + p);
    // Dicas
    log.err('\nDicas:');
    log.err(' - Rode: npm run ctx:pack  (em /server)  — requer DATABASE_URL para artefatos PG');
    log.err(' - Para exigir todos bônus PG: use --strict ou set DATABASE_URL antes de gerar');
    log.err(' - Para verificar idade: adicione --max-age-min=15 (exemplo)');
    process.exit(1);
  }

  log.ok('\n✅ Context verificado com sucesso (PG-only).');
}

// ---------- Exec
try {
  main();
} catch (e) {
  console.error('❌ Erro inesperado:', e?.message || e);
  process.exit(1);
}
