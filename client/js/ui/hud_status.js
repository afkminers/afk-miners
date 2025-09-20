// client/js/ui/hud_status.js
// HUD in-game: barras HP/Mana/Cap/Xp do herói ativo
// Minimalista, sincronizado com o servidor, sem recalcular HP/Mana localmente.

const HUD_CONTAINER_ID = "hud";

/* =====================================================================================
   UTIL: herói ativo + cache /api/player/me com dedupe e throttle
===================================================================================== */

function getActiveHeroId() {
  return (
    window.ActiveHeroId ||
    (window.Team && typeof Team.getActiveHeroId === "function" && Team.getActiveHeroId()) ||
    (window.GameScene && window.GameScene.activeHeroId) ||
    (window.Player && window.Player.activeHeroId) ||
    window.CurrentHeroId ||
    null
  );
}

// Cache simples e dedupe para /api/player/me
const MeCache = {
  data: null,
  ts: 0,
  inflight: null,
  ttlMsVisible: 10_000, // 10s com a aba visível
  ttlMsHidden: 25_000,  // 25s com a aba oculta
};

function cacheTTL() {
  return document.visibilityState === "visible"
    ? MeCache.ttlMsVisible
    : MeCache.ttlMsHidden;
}

async function getMe(force = false, signal) {
  const now = Date.now();
  const fresh = now - MeCache.ts < cacheTTL();

  if (!force && fresh && MeCache.data) return MeCache.data;
  if (MeCache.inflight) return MeCache.inflight;

  const controller = new AbortController();
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  MeCache.inflight = fetch("/api/player/me", {
    credentials: "include",
    cache: "no-store",
    signal: controller.signal,
  })
    .then((r) => r.json())
    .then((data) => {
      MeCache.data = data || null;
      MeCache.ts = Date.now();
      return MeCache.data;
    })
    .catch((err) => {
      if (err && err.name === "AbortError") return MeCache.data;
      return MeCache.data; // mantém último snapshot
    })
    .finally(() => {
      MeCache.inflight = null;
    });

  return MeCache.inflight;
}

/* =====================================================================================
   Fallback opcional para vitais (HP/Mana/Cap) — só usado se /me não trouxer hp
   Tenta endpoints comuns; se não existir, ignora silenciosamente.
===================================================================================== */
const VitalsCache = new Map(); // heroId -> { hp, mana, cap, ts }

async function fetchHeroVitals(heroId, signal) {
  if (!heroId) return null;

  // cache leve de 5s
  const cached = VitalsCache.get(String(heroId));
  if (cached && Date.now() - cached.ts < 5000) return cached;

  const controller = new AbortController();
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  // tenta alguns caminhos comuns sem quebrar se não existirem
  const candidates = [
    `/api/hero/vitals/${encodeURIComponent(heroId)}`,
    `/api/hero/vitals?id=${encodeURIComponent(heroId)}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!res.ok) continue;
      const v = await res.json();
      const vitals = {
        hp: Number(v.hp ?? v.currentHp ?? v.curHp ?? NaN),
        mana: Number(v.mana ?? v.currentMana ?? NaN),
        cap: Number(v.cap ?? v.capacity ?? NaN),
        maxHp: Number(v.maxHp ?? NaN),
        maxMana: Number(v.maxMana ?? NaN),
        maxCap: Number(v.maxCap ?? NaN),
        ts: Date.now(),
      };
      VitalsCache.set(String(heroId), vitals);
      return vitals;
    } catch {
      // ignora e tenta o próximo
    }
  }
  return null;
}

async function fetchActiveHeroData(options = {}) {
  const { force = false, signal } = options;
  const data = await getMe(force, signal);
  if (!data || !Array.isArray(data.heroes)) return null;

  const heroId = getActiveHeroId();
  if (!heroId) return null;

  const hero = data.heroes.find((h) => String(h.id) === String(heroId)) || null;
  if (!hero) return null;

  // Se a rota /me já trouxer hp/mana/cap, usamos como fonte única da verdade.
  const hasHpFromServer = typeof hero.hp === "number";

  // Caso não venha hp: tenta fallback opcional de vitais (se backend expor).
  if (!hasHpFromServer) {
    const v = await fetchHeroVitals(hero.id, signal);
    if (v) {
      // mescla de forma não-destrutiva
      return {
        ...hero,
        hp: Number.isFinite(v.hp) ? v.hp : hero.hp,
        mana: Number.isFinite(v.mana) ? v.mana : hero.mana,
        cap: Number.isFinite(v.cap) ? v.cap : hero.cap,
        maxHp: Number.isFinite(v.maxHp) ? v.maxHp : hero.maxHp,
        maxMana: Number.isFinite(v.maxMana) ? v.maxMana : hero.maxMana,
        maxCap: Number.isFinite(v.maxCap) ? v.maxCap : hero.maxCap,
      };
    }
  }
  return hero;
}

/* =====================================================================================
   RENDER
===================================================================================== */

function pct(cur, max) {
  const v = max > 0 ? (cur / max) * 100 : 0;
  return Math.max(0, Math.min(100, v)).toFixed(1);
}

// Minimalista com toggle para ocultar/mostrar HUD detalhado
function renderHudBars(hero, minimized = false) {
  if (!hero) return "";

  // >>> NÃO recalcular nada localmente. Sempre usar o que veio do servidor (ou fallback de vitais).
  const maxHp = Number(hero.maxHp ?? hero.hp ?? 0);
  const curHp = Number(hero.hp ?? maxHp);

  const maxMana = Number(hero.maxMana ?? hero.mana ?? 0);
  const curMana = Number(hero.mana ?? maxMana);

  const maxCap = Number(hero.maxCap ?? hero.cap ?? 0);
  const curCap = Number(hero.cap ?? maxCap);

  const xpAtual = Number(hero.xp ?? 0);
  const xpParaProximo = Number(hero.xp_needed_next_level ?? 1);
  const pctXp = pct(xpAtual, xpParaProximo);

  if (minimized) {
    return `
      <div id="hud-minimalbar" style="
        display:flex;align-items:center;gap:10px;background:#181c24e6;
        border-radius:9px;padding:5px 12px 4px 8px;box-shadow:0 2px 16px #0006;
        font-family:'Press Start 2P',monospace;font-size:10px;">
        <span title="HP" style="color:#f87171">♥ ${curHp}/${maxHp}</span>
        <span title="Mana" style="color:#60a5fa">◆ ${curMana}/${maxMana}</span>
        <span title="Capacidade" style="color:#facc15">⛃ ${curCap}/${maxCap}</span>
        <span title="XP" style="color:#fbbf24">⬤ ${pctXp}%</span>
        <span style="color:#ffe8c0;font-weight:bold;">${hero.name}</span>
        <span style="color:#ffe8c0;">Lv.${hero.level}</span>
        <button id="hud-expand-btn" title="Expandir HUD" style="background:none;border:none;color:#bbb;font-size:13px;cursor:pointer;margin-left:8px;">⯈</button>
      </div>
    `;
  }

  return `
    <div id="hud-detailedbar" style="
      display:flex;align-items:center;gap:9px;background:#181c24e6;
      border-radius:9px;padding:8px 16px 6px 12px;box-shadow:0 2px 16px #0006;
      font-family:'Press Start 2P',monospace;font-size:10px;position:relative;">
      
      <!-- HP -->
      <div style="width:74px">
        <div style="height:7px;background:#222;border-radius:4px;overflow:hidden;">
          <div style="width:${pct(curHp,maxHp)}%;height:100%;background:linear-gradient(90deg,#dc2626,#fca5a5);"></div>
        </div>
        <div style="margin-top:1px;text-align:center;color:#f87171;font-size:9px;">
          ♥ ${curHp}/${maxHp}
        </div>
      </div>
      <!-- Mana -->
      <div style="width:60px">
        <div style="height:7px;background:#222;border-radius:4px;overflow:hidden;">
          <div style="width:${pct(curMana,maxMana)}%;height:100%;background:linear-gradient(90deg,#2563eb,#bae6fd);"></div>
        </div>
        <div style="margin-top:1px;text-align:center;color:#60a5fa;font-size:9px;">
          ◆ ${curMana}/${maxMana}
        </div>
      </div>
      <!-- Cap -->
      <div style="width:44px">
        <div style="height:7px;background:#222;border-radius:4px;overflow:hidden;">
          <div style="width:${pct(curCap,maxCap)}%;height:100%;background:linear-gradient(90deg,#facc15,#fef08a);"></div>
        </div>
        <div style="margin-top:1px;text-align:center;color:#facc15;font-size:9px;">
          ⛃ ${curCap}/${maxCap}
        </div>
      </div>
      <!-- XP barra -->
      <div style="width:110px">
        <div style="height:7px;background:#222;border-radius:4px;overflow:hidden;">
          <div style="width:${pctXp}%;height:100%;background:linear-gradient(90deg,#fbbf24,#f59e42);"></div>
        </div>
        <div style="margin-top:1px;text-align:center;color:#fbbf24;font-size:9px;">
          ⬤ ${xpAtual}/${xpParaProximo} XP
        </div>
      </div>
      <!-- Nome, level, classe -->
      <div style="margin-left:16px;font-size:11px;color:#ffe8c0;">
        <span style="font-weight:bold;">${hero.name}</span>
        <span style="margin:0 6px;">Lv.${hero.level}</span>
        <span style="text-transform:capitalize;">${(hero.class||"").toLowerCase()}</span>
      </div>
      <!-- Stats -->
      <div style="margin-left:auto;font-size:10px;color:#ccc;opacity:.7;">
        <span style="margin-right:8px;">ATK <b>${hero.attack ?? "-"}</b></span>
        <span style="margin-right:8px;">DEF <b>${hero.defense ?? "-"}</b></span>
        <span>SPD <b>${hero.speed ?? "-"}</b></span>
      </div>
      <button id="hud-minimize-btn" title="Minimizar HUD" style="background:none;border:none;color:#bbb;font-size:13px;cursor:pointer;margin-left:14px;">⯆</button>
    </div>
  `;
}

/* =====================================================================================
   STATE + UPDATE LOOP
===================================================================================== */

let HUD_MINIMIZED = false;
let lastHeroId = null;
let lastHeroLevel = null;

// Proteção para não rodar render em paralelo
let updating = false;
// Reaproveita um AbortController para cancelar consultas anteriores
let updateController = null;

async function updateHudBars(force = false) {
  if (updating) return;
  updating = true;

  if (updateController) {
    try { updateController.abort(); } catch {}
  }
  updateController = new AbortController();

  try {
    const container = document.getElementById(HUD_CONTAINER_ID);
    if (!container) return;

    const hero = await fetchActiveHeroData({ force, signal: updateController.signal });

    if (!hero) {
      container.innerHTML = `<div style="color:#f87171;font-size:13px;">Nenhum herói ativo.</div>`;
      lastHeroId = null;
      lastHeroLevel = null;
      return;
    }

    container.innerHTML = renderHudBars(hero, HUD_MINIMIZED);
    wireToggles(hero, container);

    // Evento de level up (apenas efeito local — servidor é a fonte da verdade)
    if (force || lastHeroId !== hero.id || hero.level !== lastHeroLevel) {
      if (lastHeroLevel !== null && hero.level > lastHeroLevel) {
        window.dispatchEvent(new CustomEvent("hero:levelup", { detail: { hero } }));
      }
      lastHeroId = hero.id;
      lastHeroLevel = hero.level;
    }
  } finally {
    updating = false;
  }
}

// reconecta listeners de toggle após re-render
function wireToggles(hero, container) {
  const minimizeBtn = document.getElementById("hud-minimize-btn");
  if (minimizeBtn) {
    minimizeBtn.onclick = () => {
      HUD_MINIMIZED = true;
      container.innerHTML = renderHudBars(hero, HUD_MINIMIZED);
      wireToggles(hero, container);
    };
  }
  const expandBtn = document.getElementById("hud-expand-btn");
  if (expandBtn) {
    expandBtn.onclick = () => {
      HUD_MINIMIZED = false;
      container.innerHTML = renderHudBars(hero, HUD_MINIMIZED);
      wireToggles(hero, container);
    };
  }
}

/* =====================================================================================
   POLL: suave e consciente de visibilidade
===================================================================================== */

let pollTimer = null;

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  const ms = document.visibilityState === "visible" ? 10_000 : 25_000;
  pollTimer = setTimeout(() => updateHudBars(false).then(scheduleNextPoll), ms);
}

// Eventos que realmente merecem atualizar “na hora”
window.addEventListener("DOMContentLoaded", () => {
  updateHudBars(true).then(scheduleNextPoll);
});
window.addEventListener("hero:active-changed", () => updateHudBars(true));
window.addEventListener("tick:hero", () => updateHudBars(false)); // usa cache TTL
window.addEventListener("player-updated", () => updateHudBars(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateHudBars(true).then(scheduleNextPoll);
  } else {
    scheduleNextPoll();
  }
});

/* =====================================================================================
   (Opcional futuro) Hook para WS hero_hp -> atualizar instantaneamente
   Quando você tiver um bus de mensagens, chame applyHeroHpUpdate(heroId, hp, maxHp).
===================================================================================== */

function applyHeroHpUpdate(heroId, hp, maxHp) {
  if (!heroId) return;
  const cur = VitalsCache.get(String(heroId)) || { ts: 0 };
  const merged = {
    ...cur,
    hp: typeof hp === 'number' ? hp : cur.hp,
    maxHp: typeof maxHp === 'number' ? maxHp : cur.maxHp,
    ts: Date.now(),
  };
  VitalsCache.set(String(heroId), merged);
  // força refresh leve (respeita dedupe do /me)
  updateHudBars(false);
}

// Exponha no global para fácil integração com o seu listener de WS
window.HUD_ApplyHeroHpUpdate = applyHeroHpUpdate;
  
// Sem setInterval agressivo — o loop acima já cuida do refresh
export {};
