// server/scripts/gen-context.js (v6.2)
// Gera (em docs/context/):
// - context-pack.txt
// - API.md
// - data-summary.json
// - changes-since.txt
// - endpoints-contracts.json
// - env-usage.json
// - error-map.json
// - function-signatures.json
// - responses-sample.json
// - deps-graph.json
// - route-history.json
// - todos.json
// - openapi.json
// - symbol-index.json          (se CTX_SYMBOLS=1)
// - deps.txt                   (se CTX_IMPORTS=1)
// - db-tables.json             (Postgres)
// - db-schema.sql              (Postgres; pg_dump se disponível, senão reconstruído)
// - db-counts.txt              (Postgres)
// - db-indexes.json            (Postgres)        ← NOVO
// - db-fks.json                (Postgres)        ← NOVO
// - db-enums.json              (Postgres)        ← NOVO
// - db-views.sql               (Postgres)        ← NOVO
// - db-triggers.sql            (Postgres)        ← NOVO
// - db-functions.sql           (Postgres)        ← NOVO
// - db-sequences.json          (Postgres)        ← NOVO
// - db-extensions.txt          (Postgres)        ← NOVO
// - db-sizes.txt               (Postgres)        ← NOVO

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const glob = require('glob');
const yaml = require('js-yaml');
const dotenv = require('dotenv');

// carrega o .env do /server
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, '..', '..'); // repo raiz
process.chdir(ROOT);

const DOCS_DIR = path.join(ROOT, 'docs');
const CTX_DIR  = path.join(DOCS_DIR, 'context');

const CTX_DEPTH = parseInt(process.env.CTX_DEPTH || '4', 10);
const MAX_JSON_BYTES_TO_PARSE = 1024 * 300;
const MAX_HTML_BYTES_TO_PARSE = 1024 * 300;
const SHOW_TOP_LARGEST = 20;

const GLOB_IGNORE = [
  '**/node_modules/**','**/.git/**','**/dist/**','**/build/**','**/.next/**','**/coverage/**',
  '**/tmp/**','**/temp/**','**/.cache/**','**/.vercel/**','**/.turbo/**','**/.vscode/**','**/.idea/**'
];

function sh(cmd){
  try {
    const quiet = process.platform === 'win32' ? `${cmd} 2> NUL` : `${cmd} 2>/dev/null`;
    return cp.execSync(quiet, { encoding:'utf8' }).trim();
  } catch { 
    return ''; 
  }
}
function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }

function gitInfo(){
  const hash = sh('git rev-parse --short HEAD');
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  let lastTag = sh('git describe --tags --abbrev=0');
  if (!lastTag) lastTag = '';
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
      .filter(e=>e.isFile()).map(e=>e.name).sort();
  } catch { return []; }
}
function inventoryByExt(){
  const all = glob.sync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const counts = new Map();
  for(const f of all){
    const ext = (path.extname(f) || '').toLowerCase() || '<noext>';
    counts.set(ext, (counts.get(ext)||0)+1);
  }
  return Array.from(counts.entries()).sort((a,b)=> b[1]-a[1]).map(([ext,n])=>`${ext} : ${n}`);
}
function largestFiles(n = SHOW_TOP_LARGEST){
  const all = glob.sync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const sizes = [];
  for(const f of all){ try { const st = fs.statSync(f); sizes.push({f, b: st.size}); } catch {} }
  sizes.sort((a,b)=> b.b - a.b);
  return sizes.slice(0,n).map(x=> `${(x.b/1024).toFixed(1)} KB\t${x.f}`);
}

function scanRoutes(){
  const files = glob.sync('server/**/*.{js,ts}', { nodir:true, ignore: GLOB_IGNORE });
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
  const mig  = glob.sync('server/**/*{migrat*,schema*}*', { nodir:true, ignore: GLOB_IGNORE }).sort();
  const seed = glob.sync('server/**/*seed*',             { nodir:true, ignore: GLOB_IGNORE }).sort();
  return { migrations: mig, seeds: seed };
}
function summarizeYAML(){
  const files = glob.sync('**/*.{yml,yaml}', { nodir:true, ignore: GLOB_IGNORE });
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
  const files = glob.sync('**/*.json', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  for(const f of files){
    try{
      const st = fs.statSync(f);
      if(st.size > MAX_JSON_BYTES_TO_PARSE){ out.push({ file:f, bytes:st.size, note:'too-large' }); continue; }
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
  const files = glob.sync('**/*.html', { nodir:true, ignore: GLOB_IGNORE });
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

// ===== v6 extras =====
function buildSymbolIndex(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const idx = [];
  const rxExport = /^\s*export\s+(?:default\s+)?(class|function|const|let|var|async function)\s+([A-Za-z0-9_$]+)/m;
  const rxNamed  = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^\s*class\s+([A-Za-z0-9_$]+)/m;
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const symbols = new Set();
    const m1 = src.match(rxExport); if(m1 && m1[2]) symbols.add(m1[2]);
    const lines = src.split(/\r?\n/);
    for(const line of lines){ const m2=line.match(rxNamed); if(m2){ const name=m2[1]||m2[2]; if(name) symbols.add(name); } }
    const rxReExport = /export\s*{\s*([^}]+)\s*}/g; let r;
    while((r=rxReExport.exec(src))!==null){ r[1].split(',').map(s=>s.trim().split(/\s+as\s+/i)[1]||s.trim().split(/\s+as\s+/i)[0]).forEach(n=>n && symbols.add(n)); }
    if(symbols.size) idx.push({ file:f, symbols: Array.from(symbols).sort() });
  }
  return idx.sort((a,b)=> a.file.localeCompare(b.file));
}

function buildImportGraph(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
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
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const out = [];
  const rxFnDecl = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;
  const rxArrow  = /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
  const rxClass  = /^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/;
  const rxMethod = /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*{/;

  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    let currentClass=null;
    for(let i=0;i<lines.length;i++){
      const ln = lines[i];
      let m;
      if((m=ln.match(rxFnDecl))) out.push({ file:f, line:i+1, kind:'function', name:m[1], params: splitParams(m[2]) });
      else if((m=ln.match(rxArrow))) out.push({ file:f, line:i+1, kind:'arrow', name:m[1], params: splitParams(m[2]) });
      else if((m=ln.match(rxClass))) currentClass = m[1];
      else if(currentClass && (m=ln.match(rxMethod))) out.push({ file:f, line:i+1, kind:'method', class:currentClass, name:m[1], params: splitParams(m[2]) });
    }
  }
  return out;
}
function splitParams(s){ return (s||'').split(',').map(x=>x.trim()).filter(Boolean); }

// ENV
function buildEnvUsage(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const all = {};
  const rxEnv     = /process\.env\.([A-Z0-9_]+)/g;
  const rxDefault = /process\.env\.([A-Z0-9_]+)\s*(?:\|\||\?\?)\s*([^\s);]+)/g;

  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    let m;
    while((m=rxEnv.exec(src))!==null){
      const key=m[1]; all[key]=all[key]||{ key, occurrences:[], defaults:[] }; all[key].occurrences.push({ file:f, index:m.index });
    }
    while((m=rxDefault.exec(src))!==null){
      const key=m[1], defRaw=m[2]; all[key]=all[key]||{ key, occurrences:[], defaults:[] }; all[key].defaults.push(cleanDefault(defRaw));
    }
  }
  return Object.values(all).sort((a,b)=> a.key.localeCompare(b.key));
}
function cleanDefault(t){
  const s=String(t).replace(/[,;)]$/,'').trim();
  if(/^['"].*['"]$/.test(s)) return s.slice(1,-1);
  return s;
}

// Contracts/Erros/OK/OpenAPI
function buildEndpointContracts(routes){
  const LOOK = 160;
  const out = [];
  for(const r of routes){
    let src=''; try{ src = fs.readFileSync(r.file,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    const start = Math.max(0, r.line-1);
    const end   = Math.min(lines.length-1, start + LOOK);
    const slice = lines.slice(start, end+1).join('\n');

    const params = inferParamsFromPath(r.path);
    const query  = inferKeys(slice, 'query');
    const body   = inferKeys(slice, 'body');

    const errors = inferErrors(slice);
    const okResp = inferOkResponses(slice);

    out.push({
      method: r.method, path: r.path, file: r.file, line: r.line,
      sample: {
        params: params.length ? objFromKeys(params) : undefined,
        query:  query.length  ? objFromKeys(query)  : undefined,
        body:   body.length   ? objFromKeys(body)   : undefined
      },
      errors,
      ok: okResp.length ? okResp : undefined
    });
  }
  return out;
}
function inferParamsFromPath(p){ const rx=/:([A-Za-z0-9_]+)/g; const out=[]; let m; while((m=rx.exec(p))!==null) out.push(m[1]); return out; }
function inferKeys(text, which){
  const keys = new Set();
  const rxDot = new RegExp(`req\\.${which}\\.([A-Za-z0-9_]+)`,'g');
  let m; while((m=rxDot.exec(text))!==null) keys.add(m[1]);
  const rxDestr = new RegExp(`{([^}]+)}\\s*=\\s*req\\.${which}`,'g');
  while((m=rxDestr.exec(text))!==null){ m[1].split(',').map(s=>s.split(':')[0].trim()).forEach(k=>k && keys.add(k)); }
  return Array.from(keys);
}
function inferErrors(text){
  const out=[]; let m;
  const rx = /res\.status\(\s*(\d{3})\s*\)\s*\.json\(\s*({[\s\S]*?})\s*\)/g;
  while((m=rx.exec(text))!==null){ out.push({ status: parseInt(m[1],10), body: compactJsonLike(m[2]) }); }
  const rxThrow = /throw\s+new\s+Error\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
  while((m=rxThrow.exec(text))!==null){ out.push({ throw:true, message:m[2] }); }
  return out;
}
function inferOkResponses(text){
  const out=[]; let m;
  const rxJson = /(?:return\s+)?res\.json\(\s*({[\s\S]*?})\s*\)/g;
  while((m=rxJson.exec(text))!==null){ out.push({ status:200, body: compactJsonLike(m[1]) }); }
  const rxSend = /(?:return\s+)?res\.send\(\s*({[\s\S]*?})\s*\)/g;
  while((m=rxSend.exec(text))!==null){ out.push({ status:200, body: compactJsonLike(m[1]) }); }
  return out;
}
function compactJsonLike(s){ return s.replace(/\s+/g,' ').replace(/\s*([{:,\[\]])\s*/g,'$1').trim(); }
function objFromKeys(keys){ const o={}; for(const k of keys){ o[k]=exampleForKey(k); } return o; }
function exampleForKey(k){
  if(/id|count|page|limit|offset|qty|amount|price/i.test(k)) return 1;
  if(/email/i.test(k)) return "user@example.com";
  if(/pass|password/i.test(k)) return "secret";
  if(/name|user|login/i.test(k)) return "demo";
  if(/token|auth/i.test(k)) return "jwt_token_here";
  return "value";
}
function buildErrorMap(contracts){
  const map={};
  for(const c of contracts){
    const k = `${c.method} ${c.path}`;
    map[k] = map[k] || [];
    (c.errors||[]).forEach(e => map[k].push(e));
  }
  return map;
}
function buildOpenAPI(contracts){
  const doc = {
    openapi: "3.0.3",
    info: { title: "AFK Miners API (inferred)", version: "0.0.1" },
    paths: {}
  };
  for(const c of contracts){
    const p = doc.paths[c.path] = doc.paths[c.path] || {};
    const mm = c.method.toLowerCase();
    const item = p[mm] = p[mm] || { responses: {} };

    if(c.sample?.body){
      item.requestBody = {
        required: true,
        content: { "application/json": { schema: schemaFromSample(c.sample.body) } }
      };
    }
    const params = [];
    if(c.sample?.params){
      for(const k of Object.keys(c.sample.params)){
        params.push({ name:k, in:"path", required:true, schema: schemaType(c.sample.params[k]) });
      }
    }
    if(c.sample?.query){
      for(const k of Object.keys(c.sample.query)){
        params.push({ name:k, in:"query", required:false, schema: schemaType(c.sample.query[k]) });
      }
    }
    if(params.length) item.parameters = params;

    if(c.ok?.length){
      const ok = c.ok[0];
      item.responses["200"] = {
        description: "OK (inferred)",
        content: { "application/json": { schema: schemaFromJsonLike(ok.body) } }
      };
    } else {
      item.responses["200"] = { description: "OK" };
    }
    if(c.errors?.length){
      for(const e of c.errors){
        if(e.status){
          item.responses[String(e.status)] = {
            description: `Error ${e.status} (inferred)`,
            content: { "application/json": { schema: schemaFromJsonLike(e.body) } }
          };
        }
      }
    }
  }
  return doc;
}
function schemaType(v){
  if(typeof v === 'number') return { type: 'number' };
  if(typeof v === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}
function schemaFromSample(obj){
  return { type:'object', properties: Object.fromEntries(Object.entries(obj).map(([k,v])=> [k, schemaType(v)])) };
}
function schemaFromJsonLike(str){
  try{
    const fixed = str.replace(/([{,])(\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$3":');
    return schemaFromSample(JSON.parse(fixed));
  }catch{ return { type:'object' }; }
}

// ctx.yml (se faltar)
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
    notes: Express; JWT HttpOnly; CSRF; worker; Postgres (Neon)
  client:
    entry: client/index.html
    notes: SPA gacha + inventário + perfil
  data:
    path: data/
    notes: YAML/JSON de catálogo/config; ver data-summary.json

endpoints:
${scanRoutes().slice(0,20).map(r=>`  - [${r.method}] ${r.path}  # ${r.file}`).join('\n')}

important_env:
  - JWT_SECRET
  - CSRF_SECRET
  - WORKER_TICK_SECONDS
  - TRIES_PER_MINUTE_BASE
  - NODE_ENV
  - DATABASE_URL

notes:
  - Ajuste este arquivo conforme o projeto evoluir.
`;
  fs.writeFileSync(p, y, 'utf8');
}

function prettyJsonLike(s){
  try{
    const fixed = s.replace(/([{,])(\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$3":');
    return JSON.stringify(JSON.parse(fixed), null, 2);
  }catch{ return s; }
}

function buildRouteHistory(routes, lastTag) {
  if (!lastTag) return [];
  const files = Array.from(new Set(routes.map(r => r.file)));
  const changed = [];
  for (const f of files) {
    try {
      const diff = sh(`git diff --name-status ${lastTag}..HEAD -- "${f}"`);
      if (diff && diff.trim()) {
        changed.push({ file: f, changed: true });
      }
    } catch {}
  }
  return changed.sort((a, b) => a.file.localeCompare(b.file));
}

function scanTodos() {
  const files = glob.sync('**/*.{js,ts,jsx,tsx,md}', { nodir: true, ignore: GLOB_IGNORE });
  const todos = [];
  const rx = /\b(TODO|FIXME|NOTE)\b[:\s-]*(.*)/i;

  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const lines = src.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(rx);
      if (m) {
        todos.push({
          file: f,
          line: i + 1,
          tag: m[1].toUpperCase(),
          text: m[2].trim()
        });
      }
    }
  }
  return todos.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ===== Snapshot Postgres (schema + tabelas + counts + ++ metadados) =====
async function dumpPostgresSnapshot() {
  if (!process.env.DATABASE_URL) return;

  // Helpers para pg_dump (suporta PG_DUMP_PATH no .env) — versão com spawnSync (sem shell)
  function resolvePgDumpExe() {
    return process.env.PG_DUMP_PATH && process.env.PG_DUMP_PATH.trim()
      ? process.env.PG_DUMP_PATH.trim()
      : 'pg_dump';
  }

  function hasPgDump() {
    const exe = resolvePgDumpExe();
    try {
      const r = cp.spawnSync(exe, ['--version'], { encoding: 'utf8' });
      return r.status === 0 && /pg_dump\s+\(PostgreSQL\)\s+\d+/i.test(r.stdout || r.stderr || '');
    } catch {
      return false;
    }
  }

  function runPgDump(uri) {
    const exe = resolvePgDumpExe();
    const args = [
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      '--dbname', uri
    ];
    try {
      const r = cp.spawnSync(exe, args, { encoding: 'utf8' });
      if (r.status === 0) {
        console.log('INFO: db-schema.sql via pg_dump.');
        return r.stdout || '';
      } else {
        fs.writeFileSync(
          path.join(CTX_DIR, '_pgdump.log'),
          `cmd: ${exe} ${args.join(' ')}\nexit: ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}\n`,
          'utf8'
        );
        console.warn('WARN: pg_dump retornou código', r.status, '— veja docs/context/_pgdump.log');
        return '';
      }
    } catch (e) {
      fs.writeFileSync(
        path.join(CTX_DIR, '_pgdump.log'),
        `exception: ${e && e.stack ? e.stack : String(e)}`,
        'utf8'
      );
      console.warn('WARN: pg_dump lançou exceção — veja docs/context/_pgdump.log');
      return '';
    }
  }


  let pg;
  try { pg = require('pg'); } catch {
    console.warn('WARN: pacote "pg" não instalado — pulando snapshot Postgres.');
    return;
  }
  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // --- Tabelas base ---
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);

    // --- Colunas por tabela ---
    const tablesInfo = {};
    for (const t of tables) {
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
        ORDER BY ordinal_position;
      `, [t]);
      tablesInfo[t] = cols.rows;
    }

    // --- Constraints (todas) ---
    const constraints = await client.query(`
      SELECT tc.constraint_name, tc.constraint_type, tc.table_name,
             kcu.column_name, kcu.ordinal_position,
             ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema='public'
      ORDER BY tc.table_name, tc.constraint_type, kcu.ordinal_position NULLS LAST;
    `);

    // --- PKs agregadas por tabela ---
    const pks = await client.query(`
      SELECT kcu.table_name, array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY'
      GROUP BY kcu.table_name;
    `);
    const pkMap = new Map(pks.rows.map(r => [r.table_name, r.cols || []]));

    // --- UNIQUE por constraint ---
    const uniques = await client.query(`
      SELECT kcu.table_name, tc.constraint_name,
             array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema='public' AND tc.constraint_type='UNIQUE'
      GROUP BY kcu.table_name, tc.constraint_name;
    `);
    const uniqByTable = new Map();
    for (const r of uniques.rows) {
      const arr = uniqByTable.get(r.table_name) || [];
      arr.push({ name: r.constraint_name, cols: r.cols || [] });
      uniqByTable.set(r.table_name, arr);
    }

    // --- FKs detalhadas (inclui ações) ---
    const fks = await client.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column,
        rc.update_rule AS on_update,
        rc.delete_rule AS on_delete,
        kcu.ordinal_position
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
    `);
    const fkByTable = new Map();
    for (const r of fks.rows) {
      const arr = fkByTable.get(r.table_name) || [];
      let c = arr.find(x => x.name === r.constraint_name);
      if (!c) {
        c = { name: r.constraint_name, cols: [], refTable: r.foreign_table, refCols: [], onUpdate: r.on_update, onDelete: r.on_delete };
        arr.push(c);
      }
      c.cols.push(r.column_name);
      c.refCols.push(r.foreign_column);
      fkByTable.set(r.table_name, arr);
    }

    // --- Índices (inclui únicos)
    const indexes = await client.query(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        pg_get_indexdef(ix.indexrelid) AS indexdef
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      WHERE n.nspname='public' AND t.relkind='r'
      ORDER BY t.relname, i.relname;
    `);

    // --- Views (DDL)
    const views = await client.query(`
      SELECT table_name AS view_name,
             view_definition
      FROM information_schema.views
      WHERE table_schema='public'
      ORDER BY table_name;
    `);
    const viewsDDL = views.rows
      .map(v => `CREATE OR REPLACE VIEW "public"."${v.view_name}" AS\n${v.view_definition.trim().replace(/;?$/, ';')}`)
      .join('\n\n');

    // --- Triggers (DDL)
    const triggers = await client.query(`
      SELECT tg.tgname AS trigger_name,
             tbl.relname AS table_name,
             pg_get_triggerdef(tg.oid, true) AS triggerdef
      FROM pg_trigger tg
      JOIN pg_class tbl ON tbl.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      WHERE n.nspname='public' AND NOT tg.tgisinternal
      ORDER BY tbl.relname, tg.tgname;
    `);
    const triggersDDL = triggers.rows
      .map(t => `${t.triggerdef}; -- ON "${t.table_name}"`)
      .join('\n');

    // --- Funções (DDL)
    const funcs = await client.query(`
      SELECT n.nspname AS schema, p.proname AS name, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY 1,2;
    `);
    const functionsSQL = funcs.rows.map(f => (f.definition || '').trim().replace(/;?$/, ';')).filter(Boolean).join('\n\n');

    // --- Tipos ENUM
    const enums = await client.query(`
      SELECT t.typname AS enum_name, e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder;
    `);
    const enumsGrouped = {};
    for (const r of enums.rows) {
      enumsGrouped[r.enum_name] = enumsGrouped[r.enum_name] || [];
      enumsGrouped[r.enum_name].push(r.enum_value);
    }

    // --- Sequências
    const sequences = await client.query(`
      SELECT
        s.relname AS sequence_name,
        pg_get_serial_sequence(format('%I.%I','public', t.relname), a.attname) AS owned_by,
        n.nspname AS schema
      FROM pg_class s
      JOIN pg_namespace n ON n.oid = s.relnamespace
      LEFT JOIN pg_depend d ON d.objid = s.oid AND d.deptype='a'
      LEFT JOIN pg_class t ON d.refobjid = t.oid
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE n.nspname='public' AND s.relkind='S'
      ORDER BY s.relname;
    `);

    // --- Extensões
    const extensions = await client.query(`
      SELECT extname, extversion
      FROM pg_extension
      ORDER BY extname;
    `);

    // --- Tamanhos (tabelas/índices)
    const sizes = await client.query(`
      SELECT c.relname AS relation,
             pg_relation_size(c.oid) AS rel_bytes,
             pg_total_relation_size(c.oid) AS total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','i')
      ORDER BY total_bytes DESC;
    `);

    // --- Counts de linhas
    const counts = [];
    for (const t of tables) {
      try {
        const r = await client.query(`SELECT COUNT(*)::bigint AS c FROM "public"."${t}"`);
        counts.push({ table: t, count: Number(r.rows[0].c) });
      } catch {
        counts.push({ table: t, count: null });
      }
    }

    // --- Persistência dos artefatos
    ensureDir(CTX_DIR);

    fs.writeFileSync(path.join(CTX_DIR, 'db-tables.json'),
      JSON.stringify({ tables, tablesInfo, constraints: constraints.rows }, null, 2));

    fs.writeFileSync(path.join(CTX_DIR, 'db-counts.txt'),
      counts.map(x => `${x.table}\t${x.count ?? 'n/a'}`).join('\n'), 'utf8');

    fs.writeFileSync(path.join(CTX_DIR, 'db-indexes.json'),
      JSON.stringify(indexes.rows, null, 2));

    fs.writeFileSync(path.join(CTX_DIR, 'db-fks.json'),
      JSON.stringify(Object.fromEntries(Array.from(fkByTable.entries())), null, 2));

    fs.writeFileSync(path.join(CTX_DIR, 'db-enums.json'),
      JSON.stringify(enumsGrouped, null, 2));

    fs.writeFileSync(path.join(CTX_DIR, 'db-sequences.json'),
      JSON.stringify(sequences.rows, null, 2));

    fs.writeFileSync(path.join(CTX_DIR, 'db-extensions.txt'),
      (extensions.rows.map(e => `${e.extname}\t${e.extversion}`).join('\n')) || '-- (sem extensões)', 'utf8');

    fs.writeFileSync(path.join(CTX_DIR, 'db-sizes.txt'),
      sizes.rows.map(r => {
        const kb = (n) => (n/1024).toFixed(1);
        return `${r.relation}\trel=${kb(r.rel_bytes)}KB\ttotal=${kb(r.total_bytes)}KB`;
      }).join('\n'), 'utf8');

    // --- db-schema.sql: pg_dump (preferido) OU reconstrução
    let ddlText = '';
    if (hasPgDump()) ddlText = runPgDump(process.env.DATABASE_URL);

    if (!ddlText) {
      const pieces = [];
      for (const t of tables) {
        const cols = tablesInfo[t] || [];
        const colDefs = cols.map(c => {
          const typ = c.data_type;
          const notnull = (c.is_nullable === 'NO') ? ' NOT NULL' : '';
          const def = (c.column_default != null) ? ` DEFAULT ${c.column_default}` : '';
          return `  "${c.column_name}" ${typ}${notnull}${def}`;
        });

        const tablePks = pkMap.get(t) || [];
        if (Array.isArray(tablePks) && tablePks.length) {
          colDefs.push(`  CONSTRAINT "${t}_pkey" PRIMARY KEY (${tablePks.map(c => `"${c}"`).join(', ')})`);
        }

        const tableUniques = uniqByTable.get(t) || [];
        for (const u of tableUniques) {
          const colsU = Array.isArray(u.cols) ? u.cols : [];
          if (colsU.length) {
            colDefs.push(`  CONSTRAINT "${u.name}" UNIQUE (${colsU.map(c => `"${c}"`).join(', ')})`);
          }
        }

        const tableFks = fkByTable.get(t) || [];
        for (const fk of tableFks) {
          const colsFK = Array.isArray(fk.cols) ? fk.cols : [];
          const refFK  = Array.isArray(fk.refCols) ? fk.refCols : [];
          const onUpd = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
          const onDel = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
          colDefs.push(`  CONSTRAINT "${fk.name}" FOREIGN KEY (${colsFK.map(c => `"${c}"`).join(', ')}) REFERENCES "${fk.refTable}" (${refFK.map(c => `"${c}"`).join(', ')})${onUpd}${onDel}`);
        }

        pieces.push(`CREATE TABLE "public"."${t}" (\n${colDefs.join(',\n')}\n);`);
      }

      // Adiciona DDL de views, triggers e functions ao final
      if (viewsDDL) pieces.push(viewsDDL);
      if (triggersDDL) pieces.push(triggersDDL);
      if (functionsSQL) pieces.push(functionsSQL);

      ddlText = pieces.join('\n\n');
    }

    fs.writeFileSync(path.join(CTX_DIR, 'db-views.sql'), viewsDDL || '-- (sem views)', 'utf8');
    fs.writeFileSync(path.join(CTX_DIR, 'db-triggers.sql'), triggersDDL || '-- (sem triggers)', 'utf8');
    fs.writeFileSync(path.join(CTX_DIR, 'db-functions.sql'), functionsSQL || '-- (sem funções)', 'utf8');
    fs.writeFileSync(path.join(CTX_DIR, 'db-schema.sql'), ddlText || '-- (sem DDL gerado)', 'utf8');

    console.log('OK: snapshot PG (schema, counts, indexes, fks, enums, views, triggers, functions, sequences, extensions, sizes).');
  } catch (e) {
    console.warn('WARN: dumpPostgresSnapshot falhou:', e.message);
  } finally {
    try { await client.end(); } catch {}
  }
}

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
  const byKey={};
  for(const c of contracts){
    const k = `${c.method} ${c.path}`;
    byKey[k] = byKey[k] || c;
  }
  for(const k of Object.keys(byKey).sort()){
    const c = byKey[k];
    lines.push(`### ${k}`);
    lines.push('');
    lines.push(`Arquivo: \`${c.file}:${c.line}\``);

    if(c.sample?.params || c.sample?.query || c.sample?.body){
      lines.push('');
      lines.push('**Payloads (exemplos inferidos):**');
      if(c.sample.params){ lines.push('- params:'); lines.push('```json'); lines.push(JSON.stringify(c.sample.params,null,2)); lines.push('```'); }
      if(c.sample.query){  lines.push('- query:');  lines.push('```json'); lines.push(JSON.stringify(c.sample.query, null,2)); lines.push('```'); }
      if(c.sample.body){   lines.push('- body:');   lines.push('```json'); lines.push(JSON.stringify(c.sample.body,  null,2)); lines.push('```'); }
    } else {
      lines.push('');
      lines.push('_Sem payload inferido_');
    }

    const ok = (c.ok||[])[0];
    if(ok){
      lines.push('');
      lines.push('**Resposta de sucesso (amostra):**');
      lines.push('```json'); lines.push(prettyJsonLike(ok.body)); lines.push('```');
    }

    const errs = (c.errors||[]);
    if(errs.length){
      lines.push('');
      lines.push('**Erros conhecidos:**');
      for(const e of errs){
        if(e.status) lines.push(`- \`HTTP ${e.status}\` → ${e.body}`);
        else if(e.throw) lines.push(`- throw Error("${e.message}")`);
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
  } else lines.push('- (nenhum erro mapeado)');
  lines.push('');
  return lines.join('\n');
}

async function main(){
  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  const info = gitInfo();

  const tree = dirTree(CTX_DEPTH);
  const rootFiles = listRootFiles();
  const inv  = inventoryByExt();
  const big  = largestFiles(SHOW_TOP_LARGEST);
  const routes = scanRoutes();
  const migseed = listMigSeed();
  const yml = summarizeYAML();
  const jsn = summarizeJSON();
  const htm = summarizeHTML();

  const fnSigs = buildFunctionSignatures();
  const envUsage = buildEnvUsage();
  const contracts = buildEndpointContracts(routes);
  const errorMap  = buildErrorMap(contracts);

  const responses = {};
  for(const c of contracts){
    const k = `${c.method} ${c.path}`;
    responses[k] = (c.ok||[]).map(o => o.body);
  }

  const depsGraph = buildImportGraph();
  const todos = scanTodos();
  const routeHistory = buildRouteHistory(routes, info.lastTag);
  const openapi = buildOpenAPI(contracts);

  let sym = []; let depsTxtEdges = [];
  if(process.env.CTX_SYMBOLS === '1'){
    sym = buildSymbolIndex();
    fs.writeFileSync(path.join(CTX_DIR,'symbol-index.json'), JSON.stringify(sym,null,2));
  }
  if(process.env.CTX_IMPORTS === '1'){
    depsTxtEdges = depsGraph;
    fs.writeFileSync(path.join(CTX_DIR,'deps.txt'), depsTxtEdges.map(e=> `${e.from} -> ${e.to}`).join('\n') || '(sem imports)');
  }

  fs.writeFileSync(path.join(CTX_DIR,'data-summary.json'),        JSON.stringify(yml,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'function-signatures.json'), JSON.stringify(fnSigs,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'env-usage.json'),           JSON.stringify(envUsage,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'endpoints-contracts.json'), JSON.stringify(contracts,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'error-map.json'),           JSON.stringify(errorMap,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'responses-sample.json'),    JSON.stringify(responses,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'deps-graph.json'),          JSON.stringify(depsGraph,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'route-history.json'),       JSON.stringify(routeHistory,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'todos.json'),               JSON.stringify(todos,null,2));
  fs.writeFileSync(path.join(CTX_DIR,'openapi.json'),             JSON.stringify(openapi,null,2));

  const changes = info.lastTag ? sh(`git diff --name-status ${info.lastTag}..HEAD`) : '(sem tag anterior)';
  fs.writeFileSync(path.join(CTX_DIR,'changes-since.txt'), changes || '(sem mudanças)');

  const lines = [];
  lines.push('AFK Miners — Context Pack');
  lines.push(`Commit: ${info.hash} | Branch: ${info.branch} | Last Tag: ${info.lastTag || 'n/a'}`);
  lines.push('');
  lines.push(`== Estrutura (nível ${CTX_DEPTH}) ==`); lines.push(...tree); lines.push('');
  lines.push('== Arquivos na raiz ==');               lines.push(...(rootFiles.length? rootFiles : ['(nenhum arquivo na raiz)'])); lines.push('');
  lines.push('== Inventário por extensão ==');        lines.push(...inv); lines.push('');
  lines.push(`== Top ${SHOW_TOP_LARGEST} maiores arquivos ==`); lines.push(...big); lines.push('');
  lines.push('== Rotas detectadas (server) ==');      lines.push(...routes.map(r=>`[${r.method}] ${r.path}  (${r.file}:${r.line})`)); lines.push('');
  lines.push('== Migrations/Seeds ==');
  lines.push('Migrations:'); lines.push(...(migseed.migrations.length? migseed.migrations.map(m=>`  - ${m}`):['  - (nenhuma)']));
  lines.push('Seeds:');      lines.push(...(migseed.seeds.length?      migseed.seeds.map(s=>`  - ${s}`):['  - (nenhuma)'])); lines.push('');
  lines.push('== HTML (title/scripts/styles) ==');
  lines.push(...(htm.length? htm.map(h=> h.error? `ERR ${h.file} :: ${h.error}` : `${h.file} :: title="${h.title}" | scripts=${h.scripts} | styles=${h.styles} | ${h.bytes} bytes`):['(nenhum .html)'])); lines.push('');
  lines.push('== YAML — sumário (repo inteiro) ==');
  lines.push(...(yml.length? yml.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')}`):['(nenhum .yml/.yaml)'])); lines.push('');
  lines.push('== JSON — sumário (repo inteiro) ==');
  lines.push(...(jsn.length? jsn.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : (e.note==='too-large'? `${e.file} :: ${e.bytes} bytes (grande; não analisado)` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')} | ${e.bytes} bytes`)):['(nenhum .json)'])); lines.push('');
  if(process.env.CTX_SYMBOLS === '1'){
    lines.push('== Symbol Index (amostra) ==');
    const symAm = JSON.parse(fs.readFileSync(path.join(CTX_DIR,'symbol-index.json'),'utf8'));
    lines.push(...(symAm.slice(0,30).map(s=> `${s.file} :: ${s.symbols.join(', ')}`)));
    if(symAm.length>30) lines.push(`(+${symAm.length-30} arquivos em symbol-index.json)`);
    lines.push('');
  }
  if(process.env.CTX_IMPORTS === '1'){
    lines.push('== Import Graph (amostra) ==');
    const deps = depsTxtEdges.length ? depsTxtEdges : depsGraph;
    const sample = deps.slice(0,50).map(d=> `${d.from} -> ${d.to}`);
    lines.push(...(sample.length? sample : ['(sem imports)']));
    if(deps.length>50) lines.push(`(+${deps.length-50} arestas em docs/context/deps.txt)`);
    lines.push('');
  }
  lines.push('== Changes since last tag =='); lines.push(changes || '(n/a)');

  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  fs.writeFileSync(path.join(CTX_DIR,'context-pack.txt'), lines.join('\n'), 'utf8');

  const apiMd = buildAPIMarkdown(contracts, errorMap, envUsage);
  fs.writeFileSync(path.join(CTX_DIR,'API.md'), apiMd, 'utf8');

  genCtxYmlIfMissing(info, routes);

  // Snapshot PG (se DATABASE_URL disponível)
  await dumpPostgresSnapshot();

  console.log('OK: v6.2 — context + api + contracts + env + errors + signatures + responses + deps-graph + route-history + todos + openapi + snapshot PG (++ metadados)');
}

main().catch(err => {
  console.error('FATAL gen-context:', err);
  process.exit(1);
});
