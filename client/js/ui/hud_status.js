// HUD in-game: barras HP/Mana/Cap/Xp do herói ativo
// Modular, minimalista, ocupa pouco espaço mas mostra tudo essencial
// client/js/ui/hud_status.js

const HUD_CONTAINER_ID = "hud";

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

function fetchActiveHeroData() {
  // Busca o herói ativo do /api/player/me
  return fetch("/api/player/me", { credentials: "include", cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      const heroId = getActiveHeroId();
      if (!heroId) return null;
      if (!data.heroes) return null;
      return data.heroes.find((h) => String(h.id) === String(heroId));
    })
    .catch(() => null);
}

function pct(cur, max) {
  return max > 0 ? ((cur / max) * 100).toFixed(1) : "0.0";
}

// Minimalista com toggle para ocultar/mostrar HUD detalhado
function renderHudBars(hero, minimized = false) {
  if (!hero) return "";

  const maxHp = hero.maxHp ?? hero.hp ?? 0;
  const curHp = hero.hp ?? maxHp;
  const maxMana = hero.maxMana ?? hero.mana ?? 0;
  const curMana = hero.mana ?? maxMana;
  const maxCap = hero.maxCap ?? hero.cap ?? 0;
  const curCap = hero.cap ?? maxCap;

  const xpAtual = hero.xp ?? 0;
  const xpParaProximo = hero.xp_needed_next_level ?? 1;
  const pctXp = pct(xpAtual, xpParaProximo);

  // Minimal, horizontal, compact bars with icons and a toggle
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

  // HUD detalhado porém compacto
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

// Estado do toggle
let HUD_MINIMIZED = false;
let lastHeroId = null;
let lastHeroLevel = null;

async function updateHudBars(force=false) {
  const container = document.getElementById(HUD_CONTAINER_ID);
  if (!container) return;
  const hero = await fetchActiveHeroData();
  if (!hero) {
    container.innerHTML = `<div style="color:#f87171;font-size:13px;">Nenhum herói ativo.</div>`;
    lastHeroId = null;
    lastHeroLevel = null;
    return;
  }
  container.innerHTML = renderHudBars(hero, HUD_MINIMIZED);

  // Toggle listeners
  setTimeout(() => {
    const minimizeBtn = document.getElementById("hud-minimize-btn");
    if (minimizeBtn) {
      minimizeBtn.onclick = () => {
        HUD_MINIMIZED = true;
        updateHudBars(true);
      };
    }
    const expandBtn = document.getElementById("hud-expand-btn");
    if (expandBtn) {
      expandBtn.onclick = () => {
        HUD_MINIMIZED = false;
        updateHudBars(true);
      };
    }
  }, 10);

  // Se mudou de herói ou subiu de level, dispara evento para LevelUpNotify
  if (force || lastHeroId !== hero.id || hero.level !== lastHeroLevel) {
    if (lastHeroLevel !== null && hero.level > lastHeroLevel) {
      window.dispatchEvent(new CustomEvent('hero:levelup', { detail: { hero } }));
    }
    lastHeroId = hero.id;
    lastHeroLevel = hero.level;
  }
}

// Atualiza ao iniciar, trocar de herói, tick:hero, level up, etc
window.addEventListener("DOMContentLoaded", () => updateHudBars(true));
window.addEventListener("hero:active-changed", () => updateHudBars(true));
window.addEventListener("tick:hero", () => updateHudBars());
window.addEventListener("player-updated", () => updateHudBars(true));

setInterval(() => updateHudBars(), 2200);

export {};