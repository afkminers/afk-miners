# Combat Flags Documentation

This document describes the environment flags that control the new Tibia-like combat system.

## Environment Variables

### Client Behavior

#### `ATTACK_USE_RMB` (default: `true`)
Controls mouse input behavior for combat:
- `true`: Right mouse button (RMB) starts attacks, left-click and RMB on empty space cancels
- `false`: Legacy mode - left-click starts attacks

### Server Validation

#### `ATTACK_STRICT_MODE` (default: `true`)
Enables server-authoritative validation for combat:
- `true`: Enforces range, line-of-sight, and weapon type validations on both `/attack/start` and `/hit`
- `false`: Permissive mode for debugging (legacy behavior)

### Targeting Configuration

#### `CLICK_REQUIRE_INTERSECT` (default: `true`)
Controls targeting strictness:
- `true`: Only accept clicks that intersect the monster's bounding rectangle
- `false`: Allow fallback radius-based selection when no intersection

#### `CLICK_PICK_RADIUS_PX` (default: `96`)
Fallback radius in pixels when `CLICK_REQUIRE_INTERSECT` is false:
- Used when click doesn't directly intersect any monster
- Default of 96px = 3 tiles (32px each)

#### `CLICK_MAX_DIST_PX` (default: `160`)
Maximum allowed distance between click and player position:
- Prevents accidental targeting of monsters far from the player
- Default of 160px = 5 tiles
- Only applies when player position (px, py) is provided

## Weapon Range Configuration

The following environment variables control weapon ranges (existing system):

- `SWORD_RANGE_TILES` (default: `1`) - Melee weapon range
- `AXE_RANGE_TILES` (default: `1`) - Melee weapon range  
- `CLUB_RANGE_TILES` (default: `1`) - Melee weapon range
- `BOW_RANGE_TILES` (default: `5`) - Ranged weapon range
- `DISTANCE_RANGE_TILES` (default: `5`) - Alias for BOW_RANGE_TILES
- `MAGIC_RANGE_TILES` (default: `8`) - Magic weapon range

## Usage Examples

### Development (Strict Mode)
```bash
# Default strict behavior - all validations enabled
ATTACK_USE_RMB=1
ATTACK_STRICT_MODE=1
CLICK_REQUIRE_INTERSECT=1
npm run dev
```

### Testing/Debugging (Permissive Mode)
```bash
# Disable strict validations for debugging
ATTACK_STRICT_MODE=0
CLICK_REQUIRE_INTERSECT=0
CLICK_PICK_RADIUS_PX=192  # Larger radius
npm run dev
```

### Custom Targeting
```bash
# Tighter targeting controls
CLICK_REQUIRE_INTERSECT=1
CLICK_PICK_RADIUS_PX=64   # 2 tiles
CLICK_MAX_DIST_PX=128     # 4 tiles
npm run dev
```

## Combat Flow

1. **Client**: Right-click on monster or empty space
2. **Client**: Local sprite hit-test using `pickMobAtWorld()`
3. **Client**: If local pick fails, fallback to `/api/combat/nearest`
4. **Server**: Validate click distance and intersection based on flags
5. **Client**: Call `/api/combat/attack/start` with target ID
6. **Server**: Validate range, LOS, and weapon type (if `ATTACK_STRICT_MODE=true`)
7. **Client**: Start attack loop with `/api/combat/hit` calls
8. **Server**: Validate each hit and apply damage via `applyHit()` service

## Debugging

Enable debug logging:
```bash
COMBAT_DEBUG=1 npm run dev
```

This will log detailed information about targeting decisions, validations, and combat flow.