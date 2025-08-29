// undo-fix-baks.js
// Restaura todos os arquivos server/**/*.js a partir de seus backups .bak
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, 'server');

function walk(dir) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walk(p));
    else if (e.isFile() && p.endsWith('.js.bak')) files.push(p);
  }
  return files;
}

const baks = walk(SERVER_DIR);
if (!baks.length) {
  console.log('Nenhum .bak encontrado em server/. Nada a desfazer.');
  process.exit(0);
}
for (const bak of baks) {
  const target = bak.slice(0, -4); // remove .bak
  fs.copyFileSync(bak, target);
  console.log(`[restored] ${path.relative(ROOT, target)}  <-  ${path.basename(bak)}`);
}
console.log(`\nRestauração concluída. (Os .bak continuam lá, caso precise.)`);
