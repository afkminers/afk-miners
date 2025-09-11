// Uso: node scripts/generate-item-yaml-stubs.js outdir key1 key2 ...
// Gera YAMLs de item com campos padrão para edição manual depois.
const fs = require('fs');
const path = require('path');

function stubFor(key) {
  return `# Auto-generated stub. Complete os campos abaixo.\n` +
`key: ${key}\n` +
`name: ${key.replace(/_/g, ' ')}\n` +
`rarity: common # common|uncommon|rare|legendary|mythic\n` +
`type: misc     # weapon|shield|armor|helmet|legs|boots|accessory|resource|consumable|misc\n` +
`class: ""      # sword|axe|club|bow|spear|staff|wand|none\n` +
`oz: 0\n` +
`stackable: false\n` +
`stats:\n` +
`  atk: 0\n` +
`  def: 0\n` +
`  armor: 0\n` +
`  magic: 0\n` +
`  distance: 0\n` +
`  resists: {}\n` +
`icon: /assets/items/${key}.png\n` +
`description: ""\n`;
}

(async () => {
  const outdir = process.argv[2] || path.join(__dirname, '..', 'data', 'items');
  const keys = process.argv.slice(3);
  if (keys.length === 0) {
    console.error('Forneça ao menos 1 key. Ex: node scripts/generate-item-yaml-stubs.js ./data/items rusty_sword carrion_club');
    process.exit(2);
  }
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

  for (const k of keys) {
    const file = path.join(outdir, `${k}.yml`);
    if (fs.existsSync(file)) {
      console.log(`skip: ${file} já existe`);
      continue;
    }
    fs.writeFileSync(file, stubFor(k), 'utf8');
    console.log(`ok: ${file}`);
  }
})();