# Combat Configuration Flags

This document describes the environment variables that control combat behavior in the AFK Miners game.

## Core Combat Variables

### `CLICK_REQUIRE_INTERSECT`
- **Default**: `1` (enabled)
- **Values**: `0` or `1`
- **Description**: When enabled, requires the click point to intersect with the sprite rectangle for target selection. When disabled, falls back to radius-based selection.
- **Use case**: Set to `0` for immediate testing if sprite rectangle metadata is missing.

### `CLICK_PICK_RADIUS_PX`
- **Default**: `192` (6 tiles × 32px)
- **Values**: Number (pixels)
- **Description**: Maximum radius for monster selection when `CLICK_REQUIRE_INTERSECT=0` or when no sprite intersects.

### `COMBAT_DEBUG`
- **Default**: `0` (disabled)
- **Values**: `0` or `1`
- **Description**: Enables detailed logging of combat operations including target selection, sprite rectangles, and hit calculations.

## Sprite Intersection Logic

The combat system uses a sophisticated sprite intersection algorithm that:

1. **Mirrors client logic**: Uses sprite metadata with anchor positioning (ax≈0.5, ay≈0.9) to create accurate hit boxes
2. **Provides fallbacks**: Detects sprite sizes from monster keys (32px, 48px, 64px) when metadata is missing
3. **Adds tolerance**: Inflates hit rectangles by 2px for better user experience
4. **Supports strict mode**: Can require exact intersection or fall back to radius-based selection

## Weapon Type Resolution

Combat requires an equipped weapon in the WEAPON slot. The system performs strict weapon validation:

- Range/LOS and skill mapping come from `hero_equipment` → `items_master.weapon_type` → `weapon_skill_map`
- If no weapon is equipped, both `/attack/start` and `/hit` will reject with `{ error: 'no-weapon-equipped' }`
- **NO class-based fallback** is provided during combat
- Skill gain only occurs when damage > 0

This ensures proper game balance and equipment requirements.

## Testing Configurations

### Development Testing
```bash
# Relaxed intersection for testing with incomplete sprite data
CLICK_REQUIRE_INTERSECT=0
CLICK_PICK_RADIUS_PX=256
COMBAT_DEBUG=1
```

### Production Setup
```bash
# Strict intersection with good sprite metadata
CLICK_REQUIRE_INTERSECT=1
CLICK_PICK_RADIUS_PX=192
COMBAT_DEBUG=0
```

## Troubleshooting

### "no-intersect" errors for small sprites
1. Check if sprite metadata exists in `sprites_master` table
2. Set `CLICK_REQUIRE_INTERSECT=0` as temporary workaround
3. Verify monster key patterns include size hints (e.g., "rat32", "deer48")

### Weapon fallback not working
1. Ensure the hero has a weapon equipped in the WEAPON slot via `hero_equipment` table
2. Check that the equipped weapon has a valid `weapon_type` in `items_master`
3. Verify `weapon_skill_map` table has entries for the equipped weapon type
4. Note: There is NO class-based fallback - a weapon must be equipped to attack

### Range/LOS issues
1. Set `PERMISSIVE_START=true` in combat routes for testing
2. Check weapon range configuration in balance files
3. Verify line-of-sight grid data is properly loaded