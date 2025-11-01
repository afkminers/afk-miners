# AFK Miners Mobile MVP

This build ships the first-pass mobile experience. Desktop behaviour is unchanged.

## Testing the mobile shell

1. Serve `/client/app.html` and open it on a phone or in devtools responsive mode.
2. The runtime auto-detects mobile devices (pointer coarse + touch + viewport heuristics) and toggles `window.IS_MOBILE`.
3. Verify the integer-scaled canvas is centred and letterboxed: no blur on sprites at 360×780 portrait or 780×360 landscape.
4. Rotate the device; the HUD should avoid the notch and stay visible.

## Touch input model

- Tap ground: move via existing pathfinder (`ClickToMove`).
- Tap monster: select the monster; overlays update as usual.
- Press-and-hold monster (≥350 ms): begins auto-attack while held; releasing stops attacking.
- HUD buttons (bottom bar):
  - **ATTACK** – press-and-hold to attack current target (mirrors hold behaviour).
  - **TARGET** – cycles to the next visible monster; disabled when nothing is on screen.
  - **BAG** – toggles the Backpack panel.
  - **MENU** – opens a quick sheet (Inventory, Settings, Close).

Events are throttled and mirrored into `window.MobileInputStats.events` for telemetry (`tap_move`, `tap_target`, `hold_attack`, `hud_attack`, `hud_target`, `hud_bag`, `hud_menu`, `menu_open`, `menu_close`, `orientation_change`).

## Performance and low FX

When `IS_MOBILE` is true:

- DPR is clamped to integers to keep the backbuffer pixel-perfect.
- Floating damage popups spawn fewer entries, fade faster, and render with cheaper shadows.
- Gestures that cause browser zooming are disabled on the canvas.

## PWA behaviour

- Manifest: `/manifest.json` with standalone display + theme colour.
- Icons live in `/img/icons/` (192 px + 512 px pixel-art pickaxe).
- Service Worker `/sw.js` precaches the shell (HTML, CSS, core JS, offline message).
- Offline visits load `/offline.html` with a reconnect CTA.
- Updating the cache: bump `CACHE_VERSION` inside `sw.js` when deploying new builds.
- Clearing the PWA cache manually: `navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()))` and clear storage from the browser settings.

## Manual regression checklist

- Pixel art remains crisp on desktop (WASD/mouse intact).
- Mobile: move, target, attack flows work with touch + HUD buttons.
- Safe areas respected (notch/home indicator).
- Menu sheet opens/closes and triggers backpack/settings.
- PWA installs to home screen and loads offline placeholder.
