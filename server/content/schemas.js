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
});

/** YAML de Item */
const ItemYAML = z.object({
  key: z.string(),
  name: z.string(),
  slot: z.string().optional(),
  type: z.string().optional(),
  icon: z.string().optional(),
  value: z.any().optional(),
  stackMax: Int.optional(),
  effects: z.any().optional(),
  rarity: z.string().optional(),
});

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
});

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
});

module.exports = { MonsterYAML, ItemYAML, SpriteYAML, TiledMapJSON };
