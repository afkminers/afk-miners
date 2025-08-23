// server/scripts/gen-context.js (v3)
// Gera docs/context/* com visão completa do repo:
// - context-pack.txt
// - data-summary.json
// - changes-since.txt
// - symbol-index.json               (quando CTX_SYMBOLS=1 ou --full)
// - deps.txt                        (quando CTX_IMPORTS=1 ou --full)
// - function-signatures.json        (NOVO)
// - env-usage.json                  (NOVO)
// - endpoints-contracts.json        (NOVO)
// - error-map.json                  (NOVO)
// Execução padrão: npm run ctx:pack  (a partir de /server)

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const glob = require('glob');
const yaml = require('js-yaml');

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, '..', '..'); // repo raiz
process.chdir(ROOT);

const DOCS_DIR = path.join(ROOT, 'docs');
const CTX_DIR = path.join(DOCS_DIR, 'context');

const args = process.argv.slice(2);
const isFull = args.includes('--full');
const ENV = process.env;

const CTX_DEPTH = parseInt(ENV.CTX_DEPTH || '4', 10);
const MAX_JSON_BYTES_TO_PARSE = 1024 * 300;
const MAX_HTML_BYTES_TO_PARSE = 1024 * 300;
const SHOW_TOP_LARGEST = 20;

const WANT_SYMBOLS = isFull || ENV.CTX_SYMBOLS === '1';
const WANT_IMPORTS = isFull || ENV.CTX_IMPORTS === '1';

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
    return fs.readdirSync(ROOT,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name).sort();
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

// -------- Rotas Express
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

// -------- Migrações / Seeds
function listMigSeed(){
  const mig = glob.sync('server/**/*{migrat*,schema*}*', { nodir:true, ignore: GLOB_IGNORE });
  const seed = glob.sync('server/**/*seed*', { nodir:true, ignore: GLOB_IGNORE });
  return { migrations: mig.sort(), seeds: seed.sort() };
}

// -------- Resumos de YAML/JSON/HTML
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
      const raw = fs.readFileSync(f, 'utf8');
      const text = typeof raw==='string'? raw : raw.toString('utf8');
      const title = (text.match(titleRx) || [,''])[1].trim();
      const scripts=(text.match(scrRx)||[]).length;
      const styles=(text.match(cssRx)||[]).length;
      out.push({ file:f, title, scripts, styles, bytes: st.size });
    }catch(e){ out.push({ file:f, error:String(e) }); }
  }
  return out;
}

// -------- Índice de símbolos (funções/classes exportadas e nomeadas)
function buildSymbolIndex(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const idx = [];
  const rxExport = /^\s*export\s+(?:default\s+)?(class|function|const|let|var|async function)\s+([A-Za-z0-9_$]+)/m;
  const rxNamed = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^\s*class\s+([A-Za-z0-9_$]+)/m;
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const symbols = new Set();
    const m1 = src.match(rxExport); if(m1 && m1[2]) symbols.add(m1[2]);
    const lines = src.split(/\r?\n/);
    for(const line of lines){
      const m2 = line.match(rxNamed);
      if(m2){ const name = m2[1] || m2[2]; if(name) symbols.add(name); }
    }
    const rxReExport = /export\s*{\s*([^}]+)\s*}/g;
    let r;
    while((r = rxReExport.exec(src)) !== null){
      r[1].split(',').map(s => s.trim().split(/\s+as\s+/i)[1] || s.trim().split(/\s+as\s+/i)[0]).forEach(n => n && symbols.add(n));
    }
    if(symbols.size) idx.push({ file:f, symbols: Array.from(symbols).sort() });
  }
  return idx.sort((a,b)=> a.file.localeCompare(b.file));
}

// -------- Grafo de imports
function buildImportGraph(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const edges = [];
  const rx1 = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/;
  const rx2 = /^\s*import\s+['"]([^'"]+)['"]/;
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    for(const line of lines){
      const m = line.match(rx1) || line.match(rx2);
      if(m && m[1]) edges.push({ from:f, to:m[1] });
    }
  }
  return edges;
}

// ======== V3 EXTRAS ========

// --- Assinaturas de funções (parâmetros)
function extractFunctionSignatures(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const sigs = [];
  // function foo(a,b) { ... }
  const rxFnDecl = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/m;
  // const foo = (a,b) => { ... }  |  let foo = async (a,b)=> ...
  const rxFnExpr = /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/m;
  // class C { method(a,b) { } }
  const rxClassMethod = /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*{/m;

  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);

    // varrer por blocos pequenos para captar várias ocorrências
    for(let i=0;i<lines.length;i++){
      const chunk = lines.slice(i, Math.min(i+4, lines.length)).join('\n');

      let m = chunk.match(rxFnDecl);
      if(m){
        const params = m[2].split(',').map(s=>s.trim()).filter(Boolean);
        sigs.push({ file:f, line:i+1, kind:'function', name:m[1], params });
        continue;
      }
      m = chunk.match(rxFnExpr);
      if(m){
        const params = m[2].split(',').map(s=>s.trim()).filter(Boolean);
        sigs.push({ file:f, line:i+1, kind:'arrow', name:m[1], params });
        continue;
      }

      // Heurística limitada para métodos de classe
      // (só registra se estivermos dentro de um "class X {" nas 20 linhas acima)
      if(chunk.match(rxClassMethod)){
        const m2 = chunk.match(rxClassMethod);
        if(m2){
          const params = m2[2].split(',').map(s=>s.trim()).filter(Boolean);
          // procurar nome da classe algumas linhas acima
          let cls = '';
          for(let j=Math.max(0,i-20); j<i+1; j++){
            const mc = lines[j].match(/^\s*class\s+([A-Za-z0-9_$]+)/);
            if(mc){ cls = mc[1]; break; }
          }
          sigs.push({ file:f, line:i+1, kind:'method', class:cls || undefined, name:m2[1], params });
        }
      }
    }
  }
  return sigs.sort((a,b)=> a.file.localeCompare(b.file) || a.line-b.line);
}

// --- Uso de variáveis de ambiente
function extractEnvUsage(){
  const files = glob.sync('**/*.{js,ts,jsx,tsx}', { nodir:true, ignore: GLOB_IGNORE });
  const out = {};
  for(const f of files){
    let src=''; try{ src = fs.readFileSync(f,'utf8'); }catch{ continue; }
    const lines = src.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      const line = lines[i];
      // process.env.KEY
      const re = /process\.env\.([A-Z0-9_]+)/g;
      let m;
      while((m=re.exec(line))!==null){
        const key = m[1];
        // tentar default por || ou ??
        let def = null;
        const tail = line.slice(m.index);
        const orMatch = tail.match(/process\.env\.[A-Z0-9_]+\s*(?:\|\||\?\?)\s*(['"`]?)([^'"`\s)]+)\1/);
        if(orMatch){
          def = orMatch[2];
        }
        out[key] = out[key] || { key, locations: [], defaults: new Set() };
        out[key].locations.push({ file:f, line:i+1, snippet: line.trim().slice(0,200) });
        if(def) out[key].defaults.add(def);
      }
    }
  }
  // normalizar sets
  return Object.values(out).map(e=> ({ key:e.key, locations:e.locations, defaults: Array.from(e.defaults) })).sort((a,b)=> a.key.localeCompare(b.key));
}

// --- Contratos por rota (params/query/body) + Mapa de erros
function buildRouteContractsAndErrors(routes){
  const contracts = [];
  const errors = [];

  // indexar arquivos -> linhas para scans locais
  const fileCache = new Map();
  function getLines(file){
    if(!fileCache.has(file)){
      try { fileCache.set(file, fs.readFileSync(file,'utf8').split(/\r?\n/)); }
      catch { fileCache.set(file, []); }
    }
    return fileCache.get(file);
  }

  routes.forEach(r=>{
    const lines = getLines(r.file);
    if(!lines.length){ contracts.push({ ...r, params:[], query:[], body:[] }); return; }

    const radius = 50; // vasculhar 50 linhas abaixo a partir da definição
    const start = Math.max(0, r.line-1);
    const end = Math.min(lines.length-1, start+radius);
    const slice = lines.slice(start, end+1);

    const params = new Set();
    const query = new Set();
    const body  = new Set();

    slice.forEach(L=>{
      // req.params.x
      let m; const rp = /req\.params\.([A-Za-z0-9_]+)/g;
      while((m=rp.exec(L))!==null) params.add(m[1]);

      // req.query.x
      const rq = /req\.query\.([A-Za-z0-9_]+)/g;
      while((m=rq.exec(L))!==null) query.add(m[1]);

      // req.body.x
      const rb = /req\.body\.([A-Za-z0-9_]+)/g;
      while((m=rb.exec(L))!==null) body.add(m[1]);
    });

    contracts.push({
      method: r.method,
      path:   r.path,
      file:   r.file,
      line:   r.line,
      params: Array.from(params).sort(),
      query:  Array.from(query).sort(),
      body:   Array.from(body).sort()
    });

    // Erros/respostas
    const errs = [];
    slice.forEach(L=>{
      // res.status(401).json({ message: '...' }) | res.status(404).send('...')
      let sm = L.match(/res\.status\((\d{3})\)\.(json|send)\s*\((.+?)\)\s*;?/);
      if(sm){
        errs.push({ status: sm[1], via:`res.${sm[2]}`, payload: sm[3].slice(0,200) });
      }
      // throw new Error('msg')
      let tm = L.match(/throw\s+new\s+Error\s*\(\s*(['"`])(.+?)\1\s*\)/);
      if(tm){
        errs.push({ status: 'throw', via:'throw', payload: tm[2].slice(0,200) });
      }
    });
    if(errs.length){
      errors.push({
        method: r.method, path: r.path, file: r.file, line: r.line, errors: errs
      });
    }
  });

  return { contracts, errors };
}

function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

// Cria um ctx.yml inicial se não existir
function genCtxYmlIfMissing(info, routes){
  const p = path.join(CTX_DIR,'ctx.yml'); if(fs.existsSync(p)) return;
  const y = `# Context Manifest — preencha conforme o projeto evoluir\n\nrepo: AFK Miners\ncommit: ${info.hash}\nbranch: ${info.branch}\nlast_tag: ${info.lastTag || 'n/a'}\n\nmodules:\n  server:\n    entry: server/index.js\n    notes: Express 5; JWT HttpOnly; CSRF; worker; SQLite dev\n  client:\n    entry: client/index.html\n    notes: SPA (gacha, inventory, profile)\n  data:\n    path: data/\n    notes: YAML/JSON de catálogo/config; ver data-summary.json\n\nendpoints:\n${routes.slice(0,20).map(r=>`  - [${r.method}] ${r.path}  # ${r.file}`).join('\n')}\n\nimportant_env:\n  - NODE_ENV\n  - PORT\n  - WORKER_TICK_SECONDS\n\nnotes:\n  - Ajuste este arquivo com ADRs, decisões de schema, etc.\n`;
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

  // v2/antigo
  let sym = []; let deps = [];
  if(WANT_SYMBOLS){ sym = buildSymbolIndex(); writeJSON(path.join(CTX_DIR,'symbol-index.json'), sym); }
  if(WANT_IMPORTS){ deps = buildImportGraph(); fs.writeFileSync(path.join(CTX_DIR,'deps.txt'), deps.map(e=> `${e.from} -> ${e.to}`).join('\n') || '(sem imports)'); }

  writeJSON(path.join(CTX_DIR,'data-summary.json'), yml);
  const changes = info.lastTag ? sh(`git diff --name-status ${info.lastTag}..HEAD`) : '(sem tag anterior)';
  fs.writeFileSync(path.join(CTX_DIR,'changes-since.txt'), changes || '(sem mudanças)');

  // v3/novos artefatos
  const sigs = extractFunctionSignatures();
  writeJSON(path.join(CTX_DIR,'function-signatures.json'), sigs);

  const envs = extractEnvUsage();
  writeJSON(path.join(CTX_DIR,'env-usage.json'), envs);

  const { contracts, errors } = buildRouteContractsAndErrors(routes);
  writeJSON(path.join(CTX_DIR,'endpoints-contracts.json'), contracts);
  writeJSON(path.join(CTX_DIR,'error-map.json'), errors);

  // ---- context-pack.txt (inclui amostras dos novos artefatos)
  const lines = [];
  lines.push('AFK Miners — Context Pack');
  lines.push(`Commit: ${info.hash} | Branch: ${info.branch} | Last Tag: ${info.lastTag || info.hash}`);
  lines.push('');
  lines.push(`== Estrutura (nível ${CTX_DEPTH}) ==`); lines.push(...tree); lines.push('');
  lines.push('== Arquivos na raiz =='); lines.push(...(rootFiles.length? rootFiles : ['(nenhum arquivo na raiz)'])); lines.push('');
  lines.push('== Inventário por extensão =='); lines.push(...inv); lines.push('');
  lines.push(`== Top ${SHOW_TOP_LARGEST} maiores arquivos ==`); lines.push(...big); lines.push('');
  lines.push('== Rotas detectadas (server) =='); lines.push(...routes.map(r=>`[${r.method}] ${r.path}  (${r.file}:${r.line})`)); lines.push('');
  lines.push('== Migrations/Seeds ==');
  lines.push('Migrations:'); lines.push(...(migseed.migrations.length? migseed.migrations.map(m=>`  - ${m}`):['  - (nenhuma)']));
  lines.push('Seeds:');      lines.push(...(migseed.seeds.length? migseed.seeds.map(s=>`  - ${s}`):['  - (nenhuma)']));
  lines.push('');

  lines.push('== HTML (title/scripts/styles) ==');
  lines.push(...(htm.length? htm.map(h=> h.error? `ERR ${h.file} :: ${h.error}` : `${h.file} :: title="${h.title}" | scripts=${h.scripts} | styles=${h.styles} | ${h.bytes} bytes`):['(nenhum .html)']));
  lines.push('');

  lines.push('== YAML — sumário (repo inteiro) ==');
  lines.push(...(yml.length? yml.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')}`):['(nenhum .yml/.yaml)']));
  lines.push('');

  lines.push('== JSON — sumário (repo inteiro) ==');
  lines.push(...(jsn.length? jsn.map(e=> e.error? `ERR ${e.file} :: ${e.error}` : (e.note==='too-large'? `${e.file} :: ${e.bytes} bytes (grande; não analisado)` : `${e.file} :: ${(e.kind==='array'? e.size+' itens' : e.size+' chaves')}${(e.topKeys && e.topKeys.length? ' | keys: '+e.topKeys.join(', ') : '')} | ${e.bytes} bytes`)):['(nenhum .json)']));
  lines.push('');

  // v3 – amostras
  lines.push('== Assinaturas (amostra) ==');
  const sigSample = sigs.slice(0,20).map(s=>{
    const where = `${s.file}:${s.line}`;
    const name = s.class ? `${s.class}.${s.name}` : s.name;
    return `- ${s.kind} ${name}(${s.params.join(', ')})  @ ${where}`;
  });
  lines.push(...(sigSample.length? sigSample : ['(nenhuma assinatura detectada)']));
  if(sigs.length>20) lines.push(`(+${sigs.length-20} em docs/context/function-signatures.json)`);
  lines.push('');

  lines.push('== Variáveis de ambiente (amostra) ==');
  const envSample = envs.slice(0,20).map(e=>{
    const defs = e.defaults && e.defaults.length? ` | defaults: ${e.defaults.join(', ')}` : '';
    return `- ${e.key}  (usos: ${e.locations.length})${defs}`;
  });
  lines.push(...(envSample.length? envSample : ['(nenhum process.env detectado)']));
  if(envs.length>20) lines.push(`(+${envs.length-20} em docs/context/env-usage.json)`);
  lines.push('');

  lines.push('== Contratos de endpoints (amostra) ==');
  const ctSample = contracts.slice(0,20).map(c=>{
    const p = c.params.length? ` params: ${c.params.join(',')}` : '';
    const q = c.query.length?  ` query: ${c.query.join(',')}` : '';
    const b = c.body.length?   ` body: ${c.body.join(',')}`   : '';
    const extras = [p,q,b].filter(Boolean).join(' | ');
    return `- [${c.method}] ${c.path}${extras? ' |'+extras:''}`;
  });
  lines.push(...(ctSample.length? ctSample : ['(nenhum contrato inferido)']));
  if(contracts.length>20) lines.push(`(+${contracts.length-20} em docs/context/endpoints-contracts.json)`);
  lines.push('');

  lines.push('== Mapa de erros (amostra) ==');
  const errSample = errors.slice(0,20).map(e=>{
    const desc = e.errors.map(x=>`${x.via}:${x.status}`).join(', ');
    return `- [${e.method}] ${e.path} -> ${desc}`;
  });
  lines.push(...(errSample.length? errSample : ['(nenhum erro/res.status inferido)']));
  if(errors.length>20) lines.push(`(+${errors.length-20} em docs/context/error-map.json)`);
  lines.push('');

  lines.push('== Changes since last tag ==');
  lines.push(changes || '(n/a)');

  ensureDir(DOCS_DIR); ensureDir(CTX_DIR);
  fs.writeFileSync(path.join(CTX_DIR,'context-pack.txt'), lines.join('\n'), 'utf8');
  genCtxYmlIfMissing(info, routes);
  console.log('OK: docs/context/context-pack.txt + data-summary.json + changes-since.txt');
}

main();
