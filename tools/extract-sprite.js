// tools/extract-sprite.js
// Extrai frames de um mob a partir das folhas do opentibia_sprite_pack
// e gera: PNG (grid 1xN) + YAML compatível com teu pipeline (animação por linha).
//
// ✨ Recursos:
// - Range contíguo (start/count) OU lista explícita (--list=...)
// - Remove magenta (#FF00FF) -> transparência (--transparent)
// - CLI simples: node tools/extract-sprite.js goblin 79 12 otsp_creatures_01.png --transparent
//
// Requisitos:
//   npm i canvas js-yaml
//
// Observação: este script está em CommonJS para rodar sem "type: module".

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const yaml = require('js-yaml');

// =============== Config padrão (pode sobrescrever via CLI) ===================
const DEFAULTS = {
  TILE: 32,           // tamanho de cada célula (px)
  COLS: 16,           // colunas na folha
  OUT_SPRITES_DIR: path.join('client', 'sprites', 'characters'),
  OUT_YAML_DIR: path.join('data', 'sprites', 'characters'),
  SHEETS_DIR: path.join('client', 'sprites', 'otsp'),
  FPS: 8,             // fps default da animação "walk"
  TRANSPARENT: false, // se true, remove magenta (#FF00FF)
};

// ============================= Parse de CLI ==================================
// Formatos aceitos:
//   node tools/extract-sprite.js <key> <startIndex> <count> <sheetPng> [--tile=32] [--cols=16] [--fps=8] [--transparent]
//   node tools/extract-sprite.js <key> <sheetPng> --list=79,80,81,... [--tile=32] [--cols=16] [--fps=8] [--transparent]
//
// Exemplos:
//   node tools/extract-sprite.js goblin 79 12 otsp_creatures_01.png --transparent
//   node tools/extract-sprite.js goblin otsp_creatures_01.png --list=79,80,81,82 --fps=10

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    usageAndExit();
  }

  const opts = {
    key: null,
    sheetPng: null,
    indices: null,
    range: null,
    tile: DEFAULTS.TILE,
    cols: DEFAULTS.COLS,
    fps: DEFAULTS.FPS,
    transparent: DEFAULTS.TRANSPARENT,
  };

  // flags
  for (const a of args.filter(a => a.startsWith('--'))) {
    if (a.startsWith('--tile=')) opts.tile = Number(a.split('=')[1]);
    else if (a.startsWith('--cols=')) opts.cols = Number(a.split('=')[1]);
    else if (a.startsWith('--fps=')) opts.fps = Number(a.split('=')[1]);
    else if (a === '--transparent') opts.transparent = true;
    else if (a.startsWith('--list=')) {
      const listStr = a.split('=')[1] || '';
      opts.indices = listStr.split(',').map(x => Number(x.trim())).filter(n => Number.isFinite(n));
    }
  }

  // sem flags
  const bare = args.filter(a => !a.startsWith('--'));

  // modos:
  // 1) key, start, count, sheet
  // 2) key, sheet + --list
  if (bare.length === 4) {
    opts.key = bare[0];
    const start = Number(bare[1]);
    const count = Number(bare[2]);
    if (!Number.isFinite(start) || !Number.isFinite(count)) usageAndExit('Start/Count inválidos.');
    opts.range = { start, count };
    opts.sheetPng = bare[3];
  } else if (bare.length === 2 && Array.isArray(opts.indices) && opts.indices.length > 0) {
    opts.key = bare[0];
    opts.sheetPng = bare[1];
  } else if (bare.length === 4 && Array.isArray(opts.indices) && opts.indices.length > 0) {
    // Se o usuário passar key sheet + --list, mas também start/count por engano, priorizamos list
    opts.key = bare[0];
    opts.sheetPng = bare[3]; // tolera "key start count sheet --list"
  } else {
    usageAndExit();
  }

  return opts;
}

function usageAndExit(msg) {
  if (msg) console.error('\nErro:', msg);
  console.log(`
Uso:
  node tools/extract-sprite.js <key> <startIndex> <count> <sheetPng> [--tile=32] [--cols=16] [--fps=8] [--transparent]
  node tools/extract-sprite.js <key> <sheetPng> --list=79,80,81,... [--tile=32] [--cols=16] [--fps=8] [--transparent]

Exemplos:
  node tools/extract-sprite.js goblin 79 12 otsp_creatures_01.png --transparent
  node tools/extract-sprite.js goblin otsp_creatures_01.png --list=79,80,81,82 --fps=10
`);
  process.exit(1);
}

// ============================== Main =========================================
(async function main() {
  const opts = parseArgs(process.argv);

  const SHEET_PATH = path.isAbsolute(opts.sheetPng)
    ? opts.sheetPng
    : path.join(DEFAULTS.SHEETS_DIR, opts.sheetPng);

  // Descobrir a lista final de índices
  let indices = [];
  if (Array.isArray(opts.indices) && opts.indices.length > 0) {
    indices = opts.indices.slice();
  } else if (opts.range && Number.isFinite(opts.range.start) && Number.isFinite(opts.range.count)) {
    for (let i = 0; i < opts.range.count; i++) indices.push(opts.range.start + i);
  } else {
    usageAndExit('Forneça RANGE (start/count) ou --list.');
  }

  if (indices.length === 0) usageAndExit('Nenhum índice informado.');
  console.log(`> Extraindo ${indices.length} frames de "${SHEET_PATH}" (tile=${opts.tile}, cols=${opts.cols})`);

  // Carregar a folha
  const sheet = await loadImage(SHEET_PATH);

  // Canvas destino: 1 linha x N colunas
  const canvas = createCanvas(opts.tile * indices.length, opts.tile);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Desenhar frames selecionados lado a lado
  for (let f = 0; f < indices.length; f++) {
    const index = indices[f];
    const col = index % opts.cols;
    const row = Math.floor(index / opts.cols);
    ctx.drawImage(
      sheet,
      col * opts.tile, row * opts.tile, opts.tile, opts.tile,
      f * opts.tile, 0, opts.tile, opts.tile
    );
  }

  // Remover magenta (#FF00FF) => alpha 0
  if (opts.transparent) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r === 255 && g === 0 && b === 255) d[i + 3] = 0;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // Salvar PNG
  const outPng = path.join(DEFAULTS.OUT_SPRITES_DIR, `${opts.key}.png`);
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, canvas.toBuffer('image/png'));
  console.log('✔ PNG gerado:', outPng);

  // Gerar YAML (animação única "walk" na linha 0)
  const yamlData = {
    key: opts.key,
    image: `sprites/characters/${opts.key}.png`,
    frame: { width: opts.tile, height: opts.tile },
    grid: { cols: indices.length, rows: 1 },
    anims: {
      walk: { fps: opts.fps, frames: indices.length, row: 0, startCol: 0 }
    },
    anchor: { x: 0.5, y: 0.9 }
  };

  const outYaml = path.join(DEFAULTS.OUT_YAML_DIR, `${opts.key}.yml`);
  fs.mkdirSync(path.dirname(outYaml), { recursive: true });
  fs.writeFileSync(outYaml, yaml.dump(yamlData));
  console.log('✔ YAML gerado:', outYaml);

  console.log('\nTudo certo! Agora garanta no monster YAML:');
  console.log(`  look:\n    spriteKey: ${opts.key}`);
  console.log('Reinicie o server com CONTENT_PIPELINE=on e teste no mapa. 🚀');
})().catch(err => {
  console.error('Falhou:', err);
  process.exit(1);
});
