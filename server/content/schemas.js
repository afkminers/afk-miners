// server/content/schemas.js
const { z } = require("zod");

/** Coerções utilitárias */
const Int  = z.coerce.number().int();
const Num  = z.coerce.number();
const Bool = z.coerce.boolean();

/** Flags do monstro */
const Flags = z.object({
  hostile: Bool.optional(),
  pushable: Bool.optional(),
  summons: Int.nonnegative().optional(),
  targetChange: z.object({
    intervalMs: Int,
    chancePercent: Int
  }).optional(),
});

/** Elements/resistências (qualquer chave -> number) */
const Elements = z.object({}).catchall(Num);

/** Ataques */
const AttackMelee = z.object({
  type: z.literal("melee"),
  intervalMs: Int,
  min: Int,
  max: Int,
});

const AttackSpell = z.object({
  type: z.literal("spell"),
  key: z.string(),
  intervalMs: Int,
  chancePercent: Int,
});

/** YAML de Monstro */
const MonsterYAML = z.object({
  key: z.string(),
  name: z.string(),
  xp: Int,
  health: z.object({
    max: Int,
    regenPerSec: Int.optional(),
  }),
  speed: Int,
  look: z.object({
    sprite: z.string().optional(),
    corpse: z.string().optional(),
    spriteKey: z.string().optional(),
  }).optional(),
  flags: Flags.optional(),
  elements: Elements.optional(),
  attacks: z.array(z.union([AttackMelee, AttackSpell])).default([]),
  defenses: z.object({
    armor: Int.optional(),
    defense: Int.optional(),
    behaviors: z.object({}).catchall(z.any()).optional(),
  }).optional(),
  loot: z.array(z.union([
    z.object({
      item: z.string(),
      min: Int.default(1),
      max: Int.default(1),
      chance: Int,
    }),
    z.object({ table: z.string() }),
  ])).default([]),
  attack_range: Int.optional(),
  aggro_range: Int.optional(),
  attack_ms: Int.optional(),
}).catchall(z.any());

/** YAML de Item
 *  Tornado flexível para aceitar campos usados pelo jogo:
 *  - slot (BACK/WEAPON/...)
 *  - kind (bag/weapon/consumable/...)
 *  - icon (ícone estático), sprite (fallback)
 *  - weapon_type, atk, def
 *  - slots (capacidade de bag), stackable
 *  - description, rarity, effects, stackMax, value
 */
const ItemYAML = z.object({
  key: z.string(),
  name: z.string(),

  // classificação/uso
  slot: z.string().optional(),       // ex.: "BACK", "WEAPON"
  kind: z.string().optional(),       // ex.: "bag", "weapon", "consumable"

  // arte
  icon: z.string().optional(),       // caminho do ícone (preferido)
  sprite: z.string().optional(),     // fallback se houver

  description: z.string().optional(),
  rarity: z.string().optional(),

  // atributos de item de combate
  weapon_type: z.string().optional(),
  atk: Int.optional(),
  def: Int.optional(),

  // mochila / empilhamento
  slots: Int.optional(),             // capacidade de bag/backpack
  stackable: Bool.optional(),        // se empilha
  stackMax: Int.optional(),

  // qualquer payload extra
  value: z.any().optional(),
  effects: z.any().optional(),
}).catchall(z.any());

/** YAML de Sprite */
const SpriteYAML = z.object({
  key: z.string(),
  image: z.string(),

  // opcionais (indexação/fallback)
  kind: z.string().optional(),
  aliases: z.array(z.string()).optional(),

  frame: z.object({
    width: Int,
    height: Int,
    margin: Int.optional().default(0),
    spacing: Int.optional().default(0),
    bleedFix: Num.optional(), // usado no drawMob para anti-bleed
  }),

  grid: z.object({
    cols: Int,
    rows: Int,
  }),

  directions: z.array(z.string()).optional(),

  // animações com overrides por direção e sequências explícitas
  anims: z.object({}).catchall(
    z.object({
      fps: Num.optional(),
      frames: Int.optional(),
      row: Int.optional(),

      rowByDir: z.object({}).catchall(Int).optional(),
      framesByDir: z.record(Int).optional(),
      startCol: Int.optional().default(0),
      startColByDir: z.record(Int).optional(),

      seq: z.array(Int).optional(),                 // ex.: [0,1]
      seqByDir: z.record(z.array(Int)).optional(),  // ex.: { south:[0,1], ... }

      loop: Bool.optional(),                         // default tratado no cliente
    })
  ),

  anchor: z.object({
    x: Num,
    y: Num,
  }).optional(),

  shadow: z.string().optional(),
  collision: z.object({
    w: Int,
    h: Int,
  }).optional(),
}).catchall(z.any());

/** JSON exportado do Tiled */
const TiledMapJSON = z.object({
  height: Int,
  width: Int,
  tilewidth: Int,
  tileheight: Int,
  layers: z.array(z.object({
    name: z.string(),
    type: z.string(),
    objects: z.array(z.any()).optional(),
  })),
}).catchall(z.any());

module.exports = { MonsterYAML, ItemYAML, SpriteYAML, TiledMapJSON };
