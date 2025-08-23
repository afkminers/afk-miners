// server/scripts/gen-context.js (v5)
// Gera (em docs/context/):
// - context-pack.txt
// - data-summary.json
// - changes-since.txt
// - symbol-index.json              (se CTX_SYMBOLS=1)
// - deps.txt                       (se CTX_IMPORTS=1)
// - endpoints-contracts.json       (rotas + payload inferido)
// - env-usage.json                 (todas as process.env, com possíveis defaults)
// - error-map.json                 (status/mensagens associados a rotas)
// - function-signatures.json       (assinaturas estáticas simples)
// - API.md                         (documento legível das rotas)
//
// Execução: npm run ctx:pack  (de dentro de /server)
//
// Observação: este scanner é "best effort" (regex/heurísticas) – cobre 90% dos casos comuns.
// Não executa o código, apenas lê arquivos.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { globSync } = require('glob');         // ✅ compatível com glob v11 (ESM)
const yaml = require('js-yaml');

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, '..', '..'); // repo raiz
process.chdir(ROOT);

const DOCS_DIR = path.join(ROOT, 'docs');
const CTX_DIR = path.join(DOCS_DIR, 'context');

const CTX_DEPTH = parseInt(process.env.CTX_DEPTH || '4', 10);
const MAX_JSON_BYTES_TO_PARSE = 1024 * 300;
const MAX_HTML_BYTES_TO_PARSE = 1024 * 300;
const SHOW_TOP_LARGEST = 20;

const GLOB_IGNORE = [
  '**/node_modules/**','**/.git/**','**/dist/**','**/build/**','**/.next/**','**/coverage/**',
  '**/tmp/**','**/temp/**','**/.cache/**','**/.vercel/**','**/.turbo/**','**/.vscode/**','**/.idea/**'
];

function sh(cmd){
  try { return cp.execSync(cmd,{encoding:'utf8'}).trim(); }
  catch { return ''; }
}
function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }

function gitInfo(){
  const hash = sh('git rev-parse --short HEAD');
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  const lastTag = sh('git describe --tags --abbrev=0');
  return { hash, branch, lastTag };
}

function walkDir(dir, depth, out){
  if(depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, {withFileTypes:true}); } catch { return; }
  for(const e of entries){
    if(e.name.startsWith('.git')) continue;
    if(['node_modules','dist','build','.next','coverage','tmp','temp','.cache','.vercel','.turbo','.vscode','.idea'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    const rel = p.replace(ROOT + path.sep, '');
    out.push(rel);
    if(e.isDirectory()) walkDir(p, depth - 1, out);
  }
}

function dirTree(depth = CTX_DEPTH){
  const out=[]; walkDir(ROOT, depth, out);
  return out.filter(p => p.split(path.sep).length <= depth + 1).sort();
}

function listRootFiles(){
  try {
    return fs.readdirSync(ROOT,{withFileTypes:true})
      .filter(e=>e.isFile())
      .map(e=>e.name).sort();
  } catch { return []; }
}

function inventoryByExt(){
  const all = globSync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const counts = new Map();
  for(const f of all){
    const ext = (path.extname(f) || '').toLowerCase() || '<noext>';
    counts.set(ext, (counts.get(ext)||0)+1);
  }
  return Array.from(counts.entries()).sort((a,b)=> b[1]-a[1])
    .map(([ext,n])=>`${ext} : ${n}`);
}

function largestFiles(n = SHOW_TOP_LARGEST){
  const all = globSync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const sizes = [];
  for(const f of all){ try { const st = fs.statSync(f); sizes.push({f, b: st.size}); } catch {} }
  sizes.sort((a,b)=> b.b - a.b);
  return sizes.slice(0,n).map(x=> `${(x.b/1024).toFixed(1)} KB\t${x.f}`);
}

function scanRoutes(){
  const files = globSync('server/**/*.{js,ts}', { nodir:true, ignore: GLOB_IGNORE });
  const routes = [];
  const rx = /\b(router|app)\.(get|post|put|delete|patch|options|head)\s*\(\s*([`'"])(.*?)\3/ig;
  for(const file of files){
    let src=''; try { src = fs.readFileSync(file,'utf8'); } catch { continue; }
    const lines = src.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      let m; while((m=rx.exec(lines[i]))!==null){
        routes.push({ method:m[2].toUpperCase(), path:m[4], file, line:i+1 });
      }
    }
  }
  routes.sort((a,b)=>(a.path+a.method).localeCompare(b.path+b.method));
  return routes;
}

function listMigSeed(){
  const mig = globSync('server/**/*{migrat*,schema*}*', { nodir:true, ignore: GLOB_IGNORE });
  const seed = globSync('server/**/*seed*', { nodir:true, ignore: GLOB_IGNORE });
  return { migrations: mig.sort(), seeds: seed.sort() };
}

function summarizeYAML(){
  const files = globSync('**/*.{yml,yaml}', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  for(const f of files){
    try{
      const raw = fs.readFileSync(f,'utf8');
      const doc = yaml.load(raw);
      let kind = typeof doc, size=0, topKeys=[];
      if(Array.isArray(doc)){ kind='array'; size=doc.length; }
      else if(doc && typeof doc==='object'){ kind='object'; topKeys=Object.keys(doc).slice(0,20); size=topKeys.length; }
      out.push({ file:f, kind, size, topKeys });
    }catch(e){ out.push({ file:f, error:String(e) }); }
  }
  return out;
}

function summarizeJSON(){
  const files = globSync('**/*.json', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  for(const f of files){
    try{
      const st = fs.statSync(f);
      if(st.size > MAX_JSON_BYTES_TO_PARSE){
        out.push({ file:f, bytes:st.size, note:'too-large' });
        continue;
      }
      const raw = fs.readFileSync(f,'utf8');
      const doc = JSON.parse(raw);
      let kind = typeof doc, size=0, topKeys=[];
      if(Array.isArray(doc)){ kind='array'; size=doc.length; }
      else if(doc && typeof doc==='object'){ kind='object'; topKeys=Object.keys(doc).slice(0,20); size=topKeys.length; }
      out.push({ file:f, kind, size, topKeys, bytes: st.size });
    }catch(e){ out.push({ file:f, error:String(e) }); }
  }
  return out;
}

function summarizeHTML(){
  const files = globSync('**/*.html', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  const titleRx=/<title>([^<]*)<\/title>/i;
  const scrRx=/<script\b[^>]*src=/gi;
  const cssRx=/<link\b[^>]*rel=["']stylesheet["']/gi;
  for(const f of files){
    try{
      const st = fs.statSync(f);
      const raw = fs.readFileSync(f, st.size > MAX_HTML_BYTES_TO_PARSE ? {encoding:'utf8', flag:'r'} : 'utf8');
      const text = typeof raw==='string'? raw : raw.toString('utf8');
      const title = (text.match(titleRx) || [,''])[1].trim();
      const scripts=(text.match(scrRx)||[]).length;
      const styles=(text.match(cssRx)||[]).length;
      out.push({ file:f, title, scripts, styles, bytes: st.size });
    }catch(e){ out.push({ file:f, error:String(e) }); }
  }
  return out;
}

// === v5: Índice de símbolos, imports, assinaturas de funções, ENV, contratos, erros ===
function buildSymbolIndex(){
  const files = globSync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const idx = [];
  const rxExport = /^\s*export\s+(?:default\s+)?(class|function|const|let|var|async function)\s+([A-Za-z0-9_$]+)/m;
  const rxNamed  = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^\s*class\s+([A-Za-z0-9_$]+)/m;
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const symbols = new Set();
    const m1 = src.match(rxExport);
    if(m1 && m1[2]) symbols.add(m1[2]);
    const lines = src.split(/\r?\n/);
    for(const line of lines){
      const m2 = line.match(rxNamed);
      if(m2){
        const name = m2[1] || m2[2];
        if(name) symbols.add(name);
      }
    }
    const rxReExport = /export\s*{\s*([^}]+)\s*}/g;
    let r;
    while((r = rxReExport.exec(src)) !== null){
      r[1].split(',').map(s => s.trim().split(/\s+as\s+/i)[1] || s.trim().split(/\s+as\s+/i)[0])
        .forEach(n => n && symbols.add(n));
    }
    if(symbols.size) idx.push({ file:f, symbols: Array.from(symbols).sort() });
  }
  return idx.sort((a,b)=> a.file.localeCompare(b.file));
}

function buildImportGraph(){
  const files = globSync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const edges = [];
  const rxImport1 = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/;
  const rxImport2 = /^\s*import\s+['"]([^'"]+)['"]/;
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    for(const line of lines){
      let m = line.match(rxImport1) || line.match(rxImport2);
      if(m && m[1]) edges.push({ from:f, to:m[1] });
    }
  }
  return edges;
}

function buildFunctionSignatures(){
  const files = globSync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  const rxFnDecl   = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;
  const rxArrow    = /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
  const rxClass    = /^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/;
  const rxMethod   = /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*{/;

  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    let currentClass=null;
    for(let i=0;i<lines.length;i++){
      let ln = lines[i];
      let m;
      if((m=ln.match(rxFnDecl))){
        out.push({ file:f, line:i+1, kind:'function', name:m[1], params: splitParams(m[2]) });
      } else if((m=ln.match(rxArrow))){
        out.push({ file:f, line:i+1, kind:'arrow', name:m[1], params: splitParams(m[2]) });
      } else if((m=ln.match(rxClass))){
        currentClass = m[1];
      } else if(currentClass && (m=ln.match(rxMethod))){
        out.push({ file:f, line:i+1, kind:'method', class: currentClass, name:m[1], params: splitParams(m[2]) });
      }
    }
  }
  return out;
}
function splitParams(s){ return s.split(',').map(x=>x.trim()).filter(Boolean); }

// ENV usage + defaults
function buildEnvUsage(){
  const files = globSync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const all = {};
  const rxEnv     = /process\.env\.([A-Z0-9_]+)/g;
  // defaults mais comuns:   process.env.X || 'foo'   |   ?? 'foo'   |   ?? 123   |  || 0
  const rxDefault = /process\.env\.([A-Z0-9_]+)\s*(?:\|\||\?\?)\s*([^\s);]+)/g;

  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    let m;
    while((m=rxEnv.exec(src))!==null){
      const key = m[1];
      all[key] = all[key] || { key, occurrences: [] , defaults: []};
      all[key].occurrences.push({ file:f, index: m.index });
    }
    while((m=rxDefault.exec(src))!==null){
      const key = m[1], defRaw = m[2];
      all[key] = all[key] || { key, occurrences: [] , defaults: []};
      all[key].defaults.push(cleanDefault(defRaw));
    }
  }
  return Object.values(all).sort((a,b)=> a.key.localeCompare(b.key));
}
function cleanDefault(t){
  const s = String(t).replace(/[,;)]$/,'').trim();
  if(/^['"].*['"]$/.test(s)) return s.slice(1,-1);
  return s;
}

// Rota -> payload inferido + erros
function buildEndpointContracts(routes){
  const CONTRACT_LINES_LOOKAHEAD = 120;
  const out = [];

  for(const r of routes){
    let src=''; try{ src = fs.readFileSync(r.file,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    const start = Math.max(0, r.line-1);
    const end   = Math.min(lines.length-1, start + CONTRACT_LINES_LOOKAHEAD);
    const slice = lines.slice(start, end+1).join('\n');

    const params = inferParamsFromPath(r.path);
    const query  = inferQuery(slice);
    const body   = inferBody(slice);
    const errors = inferErrors(slice);

    out.push({
      method: r.method,
      path: r.path,
      file: r.file,
      line: r.line,
      sample: {
        params: params.length ? objFromKeys(params) : undefined,
        query:  query.length  ? objFromKeys(query)  : undefined,
        body:   body.length   ? objFromKeys(body)   : undefined
      },
      errors
    });
  }

  return out;
}

function inferParamsFromPath(p){
  const rx = /:([A-Za-z0-9_]+)/g; const out=[];
  let m; while((m=rx.exec(p))!==null) out.push(m[1]);
  return out;
}
function inferQuery(text){
  const keys = new Set();
  const rxDot = /req\.query\.([A-Za-z0-9_]+)/g;
  let m; while((m=rxDot.exec(text))!==null) keys.add(m[1]);

  const rxDestr = /{([^}]+)}\s*=\s*req\.query/g;
  while((m=rxDestr.exec(text))!==null){
    m[1].split(',').map(s=>s.split(':')[0].trim()).forEach(k => k && keys.add(k));
  }
  return Array.from(keys);
}
function inferBody(text){
  const keys = new Set();
  const rxDot = /req\.body\.([A-Za-z0-9_]+)/g;
  let m; while((m=rxDot.exec(text))!==null) keys.add(m[1]);

  const rxDestr = /{([^}]+)}\s*=\s*req\.body/g;
  while((m=rxDestr.exec(text))!==null){
    m[1].split(',').map(s=>s.split(':')[0].trim()).forEach(k => k && keys.add(k));
  }
  return Array.from(keys);
}
function inferErrors(text){
  const out = [];
  const rx = /res\.status\(\s*(\d{3})\s*\)\s*\.json\(\s*({[\s\S]*?})\s*\)/g;
  let m;
  while((m=rx.exec(text))!==null){
    const code = parseInt(m[1],10);
    const body = compactJsonLike(m[2]);
    out.push({ status: code, body });
  }
  const rxThrow = /throw\s+new\s+Error\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  while((m=rxThrow.exec(text))!==null){
    out.push({ throw: true, message: m[2] });
  }
  return out;
}
function compactJsonLike(s){
  return s
    .replace(/\s+/g,' ')
    .replace(/\s*([{:,\[\]])\s*/g,'$1')
    .trim();
}
function objFromKeys(keys){
  const o={}; for(const k of keys){ o[k] = exampleForKey(k); } return o;
}
function exampleForKey(k){
  if(/id|count|page|limit|offset|qty|amount|price/i.test(k)) return 1;
  if(/email/i.test(k)) return "user@example.com";
  if(/pass|password/i.test(k)) return "secret";
  if(/name|user|login/i.test(k)) return "demo";
  if(/token|auth/i.test(k)) return "jwt_token_here";
  return "value";
}

// Escreve JSON helper
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

// ctx.yml auto-semente
function genCtxYmlIfMissing(info, routes){
  const p = path.join(CTX_DIR,'ctx.yml');
  if(fs.existsSync(p)) return;
  const y = `# Context Manifest — edite manualmente quando necessário

repo: AFK Miners
commit: ${info.hash}
branch: ${info.branch}
last_tag: ${info.lastTag || 'n/a'}

modules:
  server:
    entry: server/index.js
    notes: Express 5; JWT HttpOnly; CSRF; worker; SQLite dev
  client:
    entry: client/index.html
    notes: SPA gacha + inventário + perfil
  data:
    path: data/
    notes: YAML/JSON de catálogo/config; ver data-summary.json

endpoints:
${routes.slice(0,20).map(r=>`  - [${r.method}] ${r.path}  # ${r.file}`).join('\n')}

important_env:
  - JWT_SECRET
  - CSRF_SECRET
  - WORKER_TICK_SECONDS
  - TRIES_PER_MINUTE_BASE
  - NODE_ENV

notes:
  - Ajuste este arquivo conforme o projeto evoluir.
`;
  fs.writeFileSync(p, y, 'utf8');
}

// API.md legível
function buildAPIMarkdown(contracts, errorMap, envUsage){
  const lines = [];
  lines.push('# AFK Miners — API');
  lines.push('');
  lines.push('## Variáveis de ambiente');
  lines.push('');
  if(envUsage.length){
    for(const e of envUsage){
      const defs = (e.defaults||[]).length ? ` (defaults: ${Array.from(new Set(e.defaults)).join(', ')})` : '';
      lines.push(`- \`${e.key}\`${defs}`);
    }
  } else lines.push('- (nenhuma detectada)');
  lines.push('');

  lines.push('## Endpoints');
  lines.push('');
  const group = {};
  for(const c of contracts){
    const k = `${c.method} ${c.path}`;
    group[k] = group[k] || [];
    group[k].push(c);
  }
  const keys = Object.keys(group).sort();
  for(const k of keys){
    const samples = group[k];
    const any = samples[0];
    lines.push(`### ${k}`);
    lines.push('');
    lines.push(`Arquivo: \`${any.file}:${any.line}\``);
    if(any.sample && (any.sample.params || any.sample.query || any.sample.body)){
      lines.push('');
      lines.push('**Payloads (exemplos inferidos):**');
      if(any.sample.params){ lines.push('- params:'); lines.push('```json'); lines.push(JSON.stringify(any.sample.params, null, 2)); lines.push('```'); }
      if(any.sample.query){  lines.push('- query:');  lines.push('```json'); lines.push(JSON.stringify(any.sample.query,  null, 2)); lines.push('```'); }
      if(any.sample.body){   lines.push('- body:');   lines.push('```json'); lines.push(JSON.stringify(any.sample.body,   null, 2)); lines.push('```'); }
    } else {
      lines.push('');
      lines.push('_Sem payload inferido_');
    }

    const errs = (any.errors||[]);
    if(errs.length){
      lines.push('');
      lines.push('**Erros conhecidos:**');
      for(const e of errs){
        if(e.status){
          lines.push(`- \`HTTP ${e.status}\` → ${e.body}`);
        } else if(e.throw){
          lines.push(`- throw Error("${e.message}")`);
        }
      }
    }
    lines.push('');
  }

  lines.push('## Tabela sintética de erros por rota');
  lines.push('');
  if(Object.keys(errorMap).length){
    for(const k of Object.keys(errorMap).sort()){
      lines.push(`- **${k}**`);
      for(const e of errorMap[k]){
        if(e.status) lines.push(`  - HTTP ${e.status}: ${e.body}`);
        else if(e.throw) lines.push(`  - throw: ${e.message}`);
      }
    }
  } else {
    lines.push('- (nenhum erro mapeado)');
  }
  lines.push('');
  return lines.join('\n');
}

function buildErrorMap(contracts){
  const map = {};
  for(const c of contracts){
    const k = `${c.method} ${c.path}`;
    map[k] = map[k] || [];
    (c.errors||[]).forEach(e => map[k].push(e));
  }
  return map;
}

// MAIN
function main(){
  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  const info = gitInfo();

  // Resumo do repo
  const tree = dirTree(CTX_DEPTH);
  const rootFiles = listRootFiles();
  const inv = inventoryByExt();
  const big = largestFiles(SHOW_TOP_LARGEST);
  const routes = scanRoutes();
  const migseed = listMigSeed();
  const yml = summarizeYAML();
  const jsn = summarizeJSON();
  const htm = summarizeHTML();

  // v5 extras
  const fnSigs = buildFunctionSignatures();
  const envUsage = buildEnvUsage();
  const contracts = buildEndpointContracts(routes);
  const errorMap = buildErrorMap(contracts);

  // opcionais
  let sym = []; let deps = [];
  if(process.env.CTX_SYMBOLS === '1'){
    sym = buildSymbolIndex();
    writeJSON(path.join(CTX_DIR,'symbol-index.json'), sym);
  }
  if(process.env.CTX_IMPORTS === '1'){
    deps = buildImportGraph();
    fs.writeFileSync(
      path.join(CTX_DIR,'deps.txt'),
      deps.map(e=> `${e.from} -> ${e.to}`).join('\n') || '(sem imports)'
    );
  }

  // grava JSONs principais
  writeJSON(path.join(CTX_DIR,'data-summary.json'), yml);
  writeJSON(path.join(CTX_DIR,'function-signatures.json'), fnSigs);
  writeJSON(path.join(CTX_DIR,'env-usage.json'), envUsage);
  writeJSON(path.join(CTX_DIR,'endpoints-contracts.json'), contracts);
  writeJSON(path.join(CTX_DIR,'error-map.json'), errorMap);

  const changes = info.lastTag ? sh(`git diff --name-status ${info.lastTag}..HEAD`) : '(sem tag anterior)';
  fs.writeFileSync(path.join(CTX_DIR,'changes-since.txt'), changes || '(sem mudanças)');

  // context-pack.txt
  const lines = [];
  lines.push('AFK Miners — Context Pack');
  lines.push(`Commit: ${info.hash} | Branch: ${info.branch} | Last Tag: ${info.lastTag || 'n/a'}`);
  lines.push('');
  lines.push(`== Estrutura (nível ${CTX_DEPTH}) ==`); lines.push(...tree); lines.push('');
  lines.push('== Arquivos na raiz =='); lines.push(...(rootFiles.length? rootFiles : ['(nenhum arquivo na raiz)'])); lines.push('');
  lines.push('== Inventário por extensão =='); lines.push(...inv); lines.push('');
  lines.push(`== Top ${SHOW_TOP_LARGEST} maiores arquivos ==`); lines.push(...big); lines.push('');
  lines.push('== Rotas detectadas (server) =='); lines.push(...routes.map(r=>`[${r.method}] ${r.path}  (${r.file}:${r.line})`)); lines.push('');
  lines.push('== Migrations/Seeds ==');
  lines.push('Migrations:'); lines.push(...(migseed.migrations.length? migseed.migrations.map(m=>`  - ${m}`):['  - (nenhuma)']));
  lines.push('Seeds:'); lines.push(...(migseed.seeds.length? migseed.seeds.map(s=>`  - ${s}`):['  - (nenhuma)'])); lines.push('');
  lines.push('== HTML (title/scripts/styles) ==');
  lines.push(...(htm.length? htm.map(h=> h.error? `ERR ${h.file} :: ${h.error}` : `${h.file} :: title="${h.title}" | scripts=${h.scripts} | styles=${h.styles} | ${h.bytes} bytes`):['(nenhum .html)'])); lines.push('');
  lines.push('== YAML — sumário (repo inteiro) ==');
  lines.push(...(yml.length? yml.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')}`):['(nenhum .yml/.yaml)'])); lines.push('');
  lines.push('== JSON — sumário (repo inteiro) ==');
  lines.push(...(jsn.length? jsn.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : (e.note==='too-large'? `${e.file} :: ${e.bytes} bytes (grande; não analisado)` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')} | ${e.bytes} bytes`)):['(nenhum .json)']));
  lines.push('');
  if(process.env.CTX_SYMBOLS === '1'){
    lines.push('== Symbol Index (amostra) ==');
    lines.push(...(sym.slice(0,30).map(s=> `${s.file} :: ${s.symbols.join(', ')}`)));
    if(sym.length>30) lines.push(`(+${sym.length-30} arquivos em symbol-index.json)`);
    lines.push('');
  }
  if(process.env.CTX_IMPORTS === '1'){
    lines.push('== Import Graph (amostra) ==');
    const sample = deps.slice(0,50).map(d=> `${d.from} -> ${d.to}`);
    lines.push(...(sample.length? sample : ['(sem imports)']));
    if(deps.length>50) lines.push(`(+${deps.length-50} arestas em docs/context/deps.txt)`);
    lines.push('');
  }
  lines.push('== Changes since last tag =='); lines.push(changes || '(n/a)');

  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  fs.writeFileSync(path.join(CTX_DIR,'context-pack.txt'), lines.join('\n'), 'utf8');

  // API.md
  const apiMd = buildAPIMarkdown(contracts, errorMap, envUsage);
  fs.writeFileSync(path.join(CTX_DIR,'API.md'), apiMd, 'utf8');

  genCtxYmlIfMissing(info, routes);
  console.log('OK: v5 — context + api + contracts + env + errors + signatures');
}

main();
