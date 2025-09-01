// client/js/combat/render-combat.js
// Pintor do combate: mantém sprites por id, acompanha monster_move/respawn/dead,
// desenha barra de HP, floaters e a sprite. Sem módulos; expõe window.CombatUI.

(function () {
  const TILE = 32;

  // --- dependência leve: combatState do ws-combat.js ---
  const state = window.combatState || {
    monsters: new Map(),
    floaters: [],
    selectedTargetId: null
  };

  // cache de imagens por caminho e por "monsterKey" normalizado
  const IMG_CACHE = new Map();
  const MONSTER_IMG_BY_KEY = new Map(); // keyNorm -> HTMLImageElement

  function normKey(s) {
    return String(s || '')
      .replace(/\\/g, '/')
      .replace(/^.*\//, '')
      .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .trim();
  }

  function loadImg(src) {
    if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
    const img = new Image();
    img.src = src;
    IMG_CACHE.set(src, img);
    return img;
  }

  function imgReady(img) {
    return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  }

  async function ensureLoaded(img) {
    if (imgReady(img)) return true;
    try { await img.decode(); } catch {}
    return imgReady(img);
  }

  // Onde procurar a sprite do monstro (ajuste se tua arte estiver noutro lugar)
  function candidatePathsFor(keyNorm) {
    const base = keyNorm;
    return [
      `/sprites/monsters/${base}.png`,
      `/sprites/${base}.png`,
      `/img/monsters/${base}.png`,
      `/img/${base}.png`,
      `/${base}.png`,
    ];
  }

  async function resolveMonsterImage(monsterKey) {
    const nk = normKey(monsterKey || 'goblin');
    if (MONSTER_IMG_BY_KEY.has(nk)) return MONSTER_IMG_BY_KEY.get(nk);

    // tenta o que veio de sprites_master, se estiver disponível no window
    if (window.SPRITES_META && window.SPRITES_META[nk]?.image) {
      const p = window.SPRITES_META[nk].image;
      const img = loadImg(p);
      if (await ensureLoaded(img)) {
        MONSTER_IMG_BY_KEY.set(nk, img);
        return img;
      }
    }

    // tenta heurísticas de pasta
    const candidates = candidatePathsFor(nk);
    for (const c of candidates) {
      const img = loadImg(c);
      if (await ensureLoaded(img)) {
        MONSTER_IMG_BY_KEY.set(nk, img);
        return img;
      }
    }

    // falhou — deixa sem sprite (fallback: desenho simples)
    MONSTER_IMG_BY_KEY.set(nk, null);
    return null;
  }

  // ---------------- HUD / UI ----------------
  function drawHpBar(ctx, m) {
    if (!m || m.hp == null || m.maxHp == null) return;
    if (typeof m.x !== 'number' || typeof m.y !== 'number') return;

    const w = TILE - 4;
    const h = 4;
    const x = Math.round(m.x + 2);
    const y = Math.round(m.y - 6);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, w, h);

    const pct = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
    const wHp = Math.round(w * pct);
    ctx.fillStyle = 'lime';
    ctx.fillRect(x, y, wHp, h);

    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  function drawTargetBox(ctx) {
    const id = state.selectedTargetId;
    if (!id) return;
    const m = state.monsters.get(id);
    if (!m || typeof m.x !== 'number' || typeof m.y !== 'number') return;

    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(m.x), Math.round(m.y), TILE, TILE);
  }

  function updateAndDrawFloaters(ctx, dtMs) {
    const list = state.floaters;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      f.ttl -= dtMs;
      if (f.ttl <= 0) { list.splice(i, 1); continue; }
      f.y += f.vy * dtMs;

      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,0,0,0.9)';
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
  }

  // ---------------- Sprites no mundo ----------------
  // (para simplicidade, 1 frame por criatura; animação fica pra depois)
  function drawMonster(ctx, m) {
    const img = m.__img || null;
    if (img && imgReady(img)) {
      // âncora: centro-baixo, estilo Tibia
      const dw = TILE, dh = TILE;
      const ox = Math.round(m.x - dw * 0.5);
      const oy = Math.round(m.y - dh * 0.9);
      ctx.drawImage(img, ox, oy, dw, dh);
    } else {
      // fallback
      ctx.fillStyle = '#8b5cf6';
      ctx.fillRect(Math.round(m.x), Math.round(m.y), TILE, TILE);
    }
  }

  // ---------------- Eventos vindos do ws-combat ----------------
  window.addEventListener('combat:monster_respawned', async (ev) => {
    const { id, monsterKey, x, y } = ev.detail || {};
    const m = state.monsters.get(id);
    if (!m) return; // ws-combat já registrou no state; aqui só garantimos sprite

    // Garante imagem
    m.__img = await resolveMonsterImage(monsterKey);
    // Posição inicial
    if (Number.isFinite(x)) m.x = x;
    if (Number.isFinite(y)) m.y = y;
  });

  window.addEventListener('combat:monster_move', (ev) => {
    const { id, x, y } = ev.detail || {};
    const m = state.monsters.get(id);
    if (!m) return;
    if (Number.isFinite(x)) m.x = x;
    if (Number.isFinite(y)) m.y = y;
  });

  window.addEventListener('combat:monster_dead', (ev) => {
    const { id } = ev.detail || {};
    const m = state.monsters.get(id);
    if (!m) return;
    // Opcional: esconder sprite marcando hp=0 (barra some)
    // A UI do mundo pode optar por não desenhar quando hp<=0.
  });

  // ---------------- Renderer público ----------------
  // Pode ser chamado fora de camera.apply; aplicamos transformação aqui
  function render(ctx, camera, dt) {
    if (!ctx || !camera) return;

    ctx.save();
    const zoom = (typeof camera.getZoom === 'function') ? (Number(camera.getZoom()) || 1) : (camera.zoom || 1) || 1;
    if (zoom !== 1) ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);

    const now = performance.now();
    // desenha todos os monstros vivos
    state.monsters.forEach((m) => {
      if (m && (m.hp == null || m.hp > 0)) {
        drawMonster(ctx, m);
        drawHpBar(ctx, m);
      }
    });

    drawTargetBox(ctx);

    // floaters: calcula dt em ms (chamador envia dt em segundos)
    updateAndDrawFloaters(ctx, (dt || 0) * 1000);

    ctx.restore();
  }

  // expõe no window para o play.js chamar por frame
  window.CombatUI = { render };
})();
