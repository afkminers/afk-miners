// server/scripts/gen-context.js
// Escaneia o repositório inteiro e gera:
// - docs/context/context-pack.txt
// - docs/context/data-summary.json
// - docs/context/changes-since.txt
// - (opcional) docs/context/symbol-index.json [CTX_SYMBOLS=1]
// - (opcional) docs/context/deps.txt          [CTX_IMPORTS=1]
// Execução: npm run ctx:pack (rodando dentro de /server)

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const glob = require('glob');
const yaml = require('js-yaml');

const SCRIPT_DIR = __dirname;                     
const ROOT = path.resolve(SCRIPT_DIR, '..', '..'); 
process.chdir(ROOT);

const DOCS_DIR = path.join(ROOT, 'docs');
const CTX_DIR = path.join(DOCS_DIR, 'context');

const CTX_DEPTH = parseInt(process.env.CTX_DEPTH || '3', 10);
const MAX_JSON_BYTES_TO_PARSE = 1024 * 300;
const MAX_HTML_BYTES_TO_PARSE = 1024 * 300;
const SHOW_TOP_LARGEST = 20;

const GLOB_IGNORE = [
  '**/node_modules/**','**/.git/**','**/dist/**','**/build/**','**/.next/**','**/coverage/**',
  '**/tmp/**','**/temp/**','**/.cache/**','**/.vercel/**','**/.turbo/**','**/.vscode/**','**/.idea/**'
];

function sh(cmd){ try { return cp.execSync(cmd,{encoding:'utf8'}).trim(); } catch { return ''; } }
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

function dirTree(depth = CTX_DEPTH){ const out=[]; walkDir(ROOT, depth, out); return out.filter(p => p.split(path.sep).length <= depth + 1).sort(); }
function listRootFiles(){ try { return fs.readdirSync(ROOT,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name).sort(); } catch { return []; } }

function inventoryByExt(){
  const all = glob.sync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const counts = new Map();
  for(const f of all){ const ext = (path.extname(f) || '').toLowerCase() || '<noext>'; counts.set(ext, (counts.get(ext)||0)+1); }
  return Array.from(counts.entries()).sort((a,b)=> b[1]-a[1]).map(([ext,n])=>`${ext} : ${n}`);
}

function largestFiles(n = SHOW_TOP_LARGEST){
  const all = glob.sync('**/*', { nodir:true, ignore: GLOB_IGNORE });
  const sizes = [];
  for(const f of all){ try { const st = fs.statSync(f); sizes.push({f, b: st.size}); } catch {} }
  sizes.sort((a,b)=> b.b - a.b); return sizes.slice(0,n).map(x=> `${(x.b/1024).toFixed(1)} KB\t${x.f}`);
}

function scanRoutes(){
  const files = glob.sync('server/**/*.{js,ts}', { nodir:true, ignore: GLOB_IGNORE });
  const routes = []; const rx = /\b(router|app)\.(get|post|put|delete|patch|options|head)\s*\(\s*([`'"])(.*?)\3/ig;
  for(const file of files){ let src=''; try { src = fs.readFileSync(file,'utf8'); } catch { continue; }
    const lines = src.split(/\r?\n/); for(let i=0;i<lines.length;i++){ let m; while((m=rx.exec(lines[i]))!==null){ routes.push({ method:m[2].toUpperCase(), path:m[4], file, line:i+1 }); } }
  }
  routes.sort((a,b)=>(a.path+a.method).localeCompare(b.path+b.method)); return routes;
}

function listMigSeed(){
  const mig = glob.sync('server/**/*{migrat*,schema*}*', { nodir:true, ignore: GLOB_IGNORE });
  const seed = glob.sync('server/**/*seed*', { nodir:true, ignore: GLOB_IGNORE });
  return { migrations: mig.sort(), seeds: seed.sort() };
}

function summarizeYAML(){
  const files = glob.sync('**/*.{yml,yaml}', { nodir:true, ignore: GLOB_IGNORE });
  const out = []; for(const f of files){ try{ const raw = fs.readFileSync(f,'utf8'); const doc = yaml.load(raw);
      let kind = typeof doc, size=0, topKeys=[]; if(Array.isArray(doc)){ kind='array'; size=doc.length; } else if(doc && typeof doc==='object'){ kind='object'; topKeys=Object.keys(doc).slice(0,20); size=topKeys.length; }
      out.push({ file:f, kind, size, topKeys }); }catch(e){ out.push({ file:f, error:String(e) }); } }
  return out;
}

function summarizeJSON(){
  const files = glob.sync('**/*.json', { nodir:true, ignore: GLOB_IGNORE });
  const out = []; for(const f of files){ try{ const st = fs.statSync(f); if(st.size > MAX_JSON_BYTES_TO_PARSE){ out.push({ file:f, bytes:st.size, note:'too-large' }); continue; }
      const raw = fs.readFileSync(f,'utf8'); const doc = JSON.parse(raw);
      let kind = typeof doc, size=0, topKeys=[]; if(Array.isArray(doc)){ kind='array'; size=doc.length; } else if(doc && typeof doc==='object'){ kind='object'; topKeys=Object.keys(doc).slice(0,20); size=topKeys.length; }
      out.push({ file:f, kind, size, topKeys, bytes: st.size }); }catch(e){ out.push({ file:f, error:String(e) }); } }
  return out;
}

function summarizeHTML(){
  const files = glob.sync('**/*.html', { nodir:true, ignore: GLOB_IGNORE });
  const out = []; const titleRx=/<title>([^<]*)<\/title>/i; const scrRx=/<script\b[^>]*src=/gi; const cssRx=/<link\b[^>]*rel=["']stylesheet["']/gi;
  for(const f of files){ try{ const st = fs.statSync(f); const raw = fs.readFileSync(f, st.size > MAX_HTML_BYTES_TO_PARSE ? {encoding:'utf8', flag:'r'} : 'utf8'); const text = typeof raw==='string'? raw : raw.toString('utf8');
      const title = (text.match(titleRx) || [,''])[1].trim(); const scripts=(text.match(scrRx)||[]).length; const styles=(text.match(cssRx)||[]).length; out.push({ file:f, title, scripts, styles, bytes: st.size });
    }catch(e){ out.push({ file:f, error:String(e) }); } }
  return out;
}

// === Opcional: Índice de símbolos (JS/TS) e grafo de imports ===
function buildSymbolIndex(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const idx = []; const rxExport = /^\s*export\s+(?:default\s+)?(class|function|const|let|var|async function)\s+([A-Za-z0-9_$]+)/m; const rxNamed = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^\s*class\s+([A-Za-z0-9_$]+)/m;
  for(const f of files){ let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const symbols = new Set(); const m1 = src.match(rxExport); if(m1 && m1[2]) symbols.add(m1[2]);
    const lines = src.split(/\r?\n/); for(const line of lines){ const m2 = line.match(rxNamed); if(m2){ const name = m2[1] || m2[2]; if(name) symbols.add(name); } }
    const rxReExport = /export\s*{\s*([^}]+)\s*}/g; let r; while((r = rxReExport.exec(src)) !== null){ r[1].split(',').map(s => s.trim().split(/\s+as\s+/i)[1] || s.trim().split(/\s+as\s+/i)[0]).forEach(n => n && symbols.add(n)); }
    if(symbols.size) idx.push({ file:f, symbols: Array.from(symbols).sort() });
  }
  return idx.sort((a,b)=> a.file.localeCompare(b.file));
}

function buildImportGraph(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const edges = []; const rxImport1 = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/m; const rxImport2 = /^\s*import\s+['"]([^'"]+)['"]/m;
  for(const f of files){ let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/); for(const line of lines){ let m = line.match(rxImport1) || line.match(rxImport2); if(m && m[1]) edges.push({ from:f, to:m[1] }); }
  }
  return edges;
}

function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

function genCtxYmlIfMissing(info, routes){
  const p = path.join(CTX_DIR,'ctx.yml'); if(fs.existsSync(p)) return;
  const y = `# Context Manifest — complete manual quando necessário\n\nrepo: AFK Miners\ncommit: ${info.hash}\nbranch: ${info.branch}\nlast_tag: ${info.lastTag || 'n/a'}\n\nmodules:\n  server:\n    entry: server/index.js\n    notes: Express 5; JWT HttpOnly; CSRF; worker de treino; SQLite dev\n  client:\n    entry: client/index.html\n    notes: SPA gacha + inventário + overlay perfil (openProfileView)\n  data:\n    path: data/\n    notes: YAML/JSON de catálogo/config; ver data-summary.json\n\nendpoints:\n${scanRoutes().slice(0,20).map(r=>`  - [${r.method}] ${r.path}  # ${r.file}`).join('\\n')}\n\nimportant_env:\n  - TRIES_PER_MINUTE_BASE\n  - WORKER_TICK_SECONDS\n  - NODE_ENV\n\nnotes:\n  - Ajuste este arquivo conforme o projeto evoluir (DB, schemas, ADRs).\n`;
  fs.writeFileSync(p, y, 'utf8');
}

function main(){
  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  const info = gitInfo();
  const tree = dirTree(CTX_DEPTH);
  const rootFiles = listRootFiles();
  const inv = inventoryByExt();
  const big = largestFiles(SHOW_TOP_LARGEST);
  const routes = scanRoutes();
  const migseed = listMigSeed();
  const yml = summarizeYAML();
  const jsn = summarizeJSON();
  const htm = summarizeHTML();

  // opcionais
  let sym = []; let deps = [];
  if(process.env.CTX_SYMBOLS === '1'){ sym = buildSymbolIndex(); writeJSON(path.join(CTX_DIR,'symbol-index.json'), sym); }
  if(process.env.CTX_IMPORTS === '1'){ deps = buildImportGraph(); fs.writeFileSync(path.join(CTX_DIR,'deps.txt'), deps.map(e=> `${e.from} -> ${e.to}`).join('\\n') || '(sem imports)'); }

  writeJSON(path.join(CTX_DIR,'data-summary.json'), yml);
  const changes = info.lastTag ? sh(`git diff --name-status ${info.lastTag}..HEAD`) : '(sem tag anterior)';
  fs.writeFileSync(path.join(CTX_DIR,'changes-since.txt'), changes || '(sem mudanças)');

  const lines = [];
  lines.push('AFK Miners — Context Pack');
  lines.push(`Commit: ${info.hash} | Branch: ${info.branch} | Last Tag: ${info.lastTag || 'n/a'}`);
  lines.push('');
  lines.push(`== Estrutura (nível ${CTX_DEPTH}) ==`); lines.push(...tree); lines.push('');
  lines.push('== Arquivos na raiz =='); lines.push(...(rootFiles.length? rootFiles : ['(nenhum arquivo na raiz)'])); lines.push('');
  lines.push('== Inventário por extensão =='); lines.push(...inv); lines.push('');
  lines.push(`== Top ${SHOW_TOP_LARGEST} maiores arquivos ==`); lines.push(...big); lines.push('');
  lines.push('== Rotas detectadas (server) =='); lines.push(...routes.map(r=>`[${r.method}] ${r.path}  (${r.file}:${r.line})`)); lines.push('');
  lines.push('== Migrations/Seeds =='); lines.push('Migrations:'); lines.push(...(migseed.migrations.length? migseed.migrations.map(m=>`  - ${m}`):['  - (nenhuma)'])); lines.push('Seeds:'); lines.push(...(migseed.seeds.length? migseed.seeds.map(s=>`  - ${s}`):['  - (nenhuma)'])); lines.push('');
  lines.push('== HTML (title/scripts/styles) =='); lines.push(...(htm.length? htm.map(h=> h.error? `ERR ${h.file} :: ${h.error}` : `${h.file} :: title=\"${h.title}\" | scripts=${h.scripts} | styles=${h.styles} | ${h.bytes} bytes`):['(nenhum .html)'])); lines.push('');
  lines.push('== YAML — sumário (repo inteiro) =='); lines.push(...(yml.length? yml.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')}`):['(nenhum .yml/.yaml)'])); lines.push('');
  lines.push('== JSON — sumário (repo inteiro) =='); lines.push(...(jsn.length? jsn.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : (e.note==='too-large'? `${e.file} :: ${e.bytes} bytes (grande; não analisado)` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')} | ${e.bytes} bytes`)):['(nenhum .json)'])); lines.push('');
  if(process.env.CTX_SYMBOLS === '1'){ lines.push('== Symbol Index (amostra) =='); lines.push(...(sym.slice(0,30).map(s=> `${s.file} :: ${s.symbols.join(', ')}`))); if(sym.length>30) lines.push(`(+${sym.length-30} arquivos em symbol-index.json)`); lines.push(''); }
  if(process.env.CTX_IMPORTS === '1'){ lines.push('== Import Graph (amostra) =='); const sample = deps.slice(0,50).map(d=> `${d.from} -> ${d.to}`); lines.push(...(sample.length? sample : ['(sem imports)'])); if(deps.length>50) lines.push(`(+${deps.length-50} arestas em docs/context/deps.txt)`); lines.push(''); }
  lines.push('== Changes since last tag =='); lines.push(changes || '(n/a)');

  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  fs.writeFileSync(path.join(CTX_DIR,'context-pack.txt'), lines.join('\n'), 'utf8');
  genCtxYmlIfMissing(info, routes);
  console.log('OK: docs/context/context-pack.txt + data-summary.json + changes-since.txt');
}

main();
