// server/scripts/verify-context.mjs
// Verifica se a v6 gerou tudo corretamente, sem alterar nada.
// Uso: node server/scripts/verify-context.mjs

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.join(process.cwd()));
const CTX  = path.join(ROOT, 'docs', 'context');

const expected = [
  'context-pack.txt',
  'API.md',
  'data-summary.json',
  'changes-since.txt',
  'endpoints-contracts.json',
  'env-usage.json',
  'error-map.json',
  'function-signatures.json',
  'responses-sample.json',
  'deps-graph.json',
  'route-history.json',
  'todos.json',
  'openapi.json',
  // opcionais
  'symbol-index.json', // se CTX_SYMBOLS=1
  'deps.txt'           // se CTX_IMPORTS=1
];

function ok(msg){ console.log('✅ ' + msg); }
function warn(msg){ console.warn('⚠️  ' + msg); }
function err(msg){ console.error('❌ ' + msg); }

function mustExist(file){
  const p = path.join(CTX, file);
  return fs.existsSync(p) ? (ok(`${file} existe`), true) : (err(`${file} NÃO encontrado`), false);
}

function tryParseJSON(file){
  const p = path.join(CTX, file);
  if(!fs.existsSync(p)) return;
  try{
    JSON.parse(fs.readFileSync(p,'utf8'));
    ok(`${file} JSON OK`);
  }catch(e){
    err(`${file} JSON inválido: ${e.message}`);
  }
}

function run(){
  if(!fs.existsSync(CTX)){
    err(`Pasta não existe: ${CTX}`);
    process.exit(1);
  }

  console.log('--- Verificando artefatos docs/context ---');

  // Base obrigatória
  const required = expected.slice(0, expected.indexOf('symbol-index.json'));
  let allOk = true;
  for(const f of required) allOk &= mustExist(f);

  // Opcionais: avisa se ausente, mas não falha
  const opt = ['symbol-index.json','deps.txt'];
  for(const f of opt){
    const p = path.join(CTX,f);
    if(fs.existsSync(p)) ok(`${f} presente (opcional)`); else warn(`${f} ausente (ok se não habilitado)`);
  }

  // Sanidade de JSON
  [
    'data-summary.json',
    'endpoints-contracts.json',
    'env-usage.json',
    'error-map.json',
    'function-signatures.json',
    'responses-sample.json',
    'deps-graph.json',
    'route-history.json',
    'todos.json',
    'openapi.json'
  ].forEach(tryParseJSON);

  // Info útil
  try {
    const routes = JSON.parse(fs.readFileSync(path.join(CTX,'endpoints-contracts.json'),'utf8'));
    console.log(`\n📚 Rotas detectadas: ${routes.length}`);
    const envs = JSON.parse(fs.readFileSync(path.join(CTX,'env-usage.json'),'utf8'));
    console.log(`🔑 Variáveis de ambiente detectadas: ${envs.length}`);
  } catch { /* ignore */ }

  console.log('\n--- Resultado ---');
  if(allOk) ok('Tudo certo com a saída v6.');
  else err('Faltam arquivos obrigatórios. Rode `npm run ctx:pack` e/ou `npm run ctx:zip` novamente.');
}

run();
