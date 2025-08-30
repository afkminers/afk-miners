// server/scripts/verify-context.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const CTX_DIR = path.join(ROOT, 'docs', 'context');

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error(`Arquivo obrigatório ausente: ${path.relative(ROOT, p)}`);
}
function mustBeJsonParseable(p) {
  const txt = fs.readFileSync(p, 'utf8');
  try { JSON.parse(txt); }
  catch (e) { throw new Error(`JSON inválido: ${path.relative(ROOT, p)} :: ${e.message}`); }
}

function main() {
  if (!fs.existsSync(CTX_DIR)) {
    console.error(`❌ Pasta não existe: ${CTX_DIR}\nDica: rode primeiro "npm run ctx:pack" (em server/)`);
    process.exit(1);
  }

  const requiredText = ['context-pack.txt','API.md','changes-since.txt'];
  const requiredJson = [
    'data-summary.json','endpoints-contracts.json','env-usage.json','error-map.json',
    'function-signatures.json','responses-sample.json','deps-graph.json','route-history.json',
    'todos.json','openapi.json'
  ];

  const optional = [
    'symbol-index.json','deps.txt',
    // Snapshot de banco (PG)
    'db-schema.sql','db-tables.txt','db-counts.txt','db-tables.json'
  ];

  for (const f of requiredText)  mustExist(path.join(CTX_DIR, f));
  for (const f of requiredJson)  { const p = path.join(CTX_DIR, f); mustExist(p); mustBeJsonParseable(p); }

  for (const f of optional) {
    const p = path.join(CTX_DIR, f);
    if (fs.existsSync(p) && p.endsWith('.json')) mustBeJsonParseable(p);
  }

  console.log('✅ Context verificado com sucesso.');
  console.log(`Dir: ${path.relative(ROOT, CTX_DIR)}`);
  console.log(`- OK textos: ${requiredText.length}`);
  console.log(`- OK JSONs : ${requiredJson.length} + opcionais válidos (se presentes)`);
}

try { main(); } catch (e) {
  console.error('❌ Falha na verificação:', e.message);
  process.exit(1);
}
