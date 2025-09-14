// HUD in-game: barras HP/Mana/Cap do herói ativo
// Modular, não interfere em skills nem overlays de combate
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

function renderHudBars(hero) {
  if (!hero) return "";
  const maxHp = hero.maxHp ?? hero.hp ?? 0;
  const curHp = hero.hp ?? maxHp;
  const maxMana = hero.maxMana ?? hero.mana ?? 0;
  const curMana = hero.mana ?? maxMana;
  const maxCap = hero.maxCap ?? hero.cap ?? 0;
  const curCap = hero.cap ?? maxCap;

  function pct(cur, max) {
    return max > 0 ? Math.round((cur / max) * 100) : 0;
  }

  return `
    <div style="display: flex; gap: 18px; margin-bottom: 8px; align-items: flex-end;">
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div style="font-family:'Press Start 2P',monospace;font-size:10px;color:#f87171;margin-bottom:2px;">HP</div>
        <div style="background:#191d29;border-radius:7px;overflow:hidden;width:150px;height:15px;position:relative;">
          <div style="height:100%;width:${pct(curHp,maxHp)}%;background:linear-gradient(90deg,#f87171,#fecaca);transition:width .3s;" ></div>
          <div style="position:absolute;left:0;top:0;width:100%;height:100%;text-align:center;font-size:11px;color:#fff;text-shadow:0 1px 1px #000;">${curHp} / ${maxHp}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div style="font-family:'Press Start 2P',monospace;font-size:10px;color:#60a5fa;margin-bottom:2px;">Mana</div>
        <div style="background:#191d29;border-radius:7px;overflow:hidden;width:110px;height:15px;position:relative;">
          <div style="height:100%;width:${pct(curMana,maxMana)}%;background:linear-gradient(90deg,#60a5fa,#bae6fd);transition:width .3s;" ></div>
          <div style="position:absolute;left:0;top:0;width:100%;height:100%;text-align:center;font-size:11px;color:#fff;text-shadow:0 1px 1px #000;">${curMana} / ${maxMana}</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div style="font-family:'Press Start 2P',monospace;font-size:10px;color:#facc15;margin-bottom:2px;">Cap</div>
        <div style="background:#191d29;border-radius:7px;overflow:hidden;width:80px;height:15px;position:relative;">
          <div style="height:100%;width:${pct(curCap,maxCap)}%;background:linear-gradient(90deg,#facc15,#fef08a);transition:width .3s;" ></div>
          <div style="position:absolute;left:0;top:0;width:100%;height:100%;text-align:center;font-size:11px;color:#fff;text-shadow:0 1px 1px #000;">${curCap} / ${maxCap}</div>
        </div>
      </div>
      <div style="margin-left:20px;font-family:'Press Start 2P',monospace;font-size:11px;color:#ffe8c0;">
        <span style="font-weight:bold;">${hero.name}</span> · Lvl ${hero.level} · <span style="text-transform:capitalize;">${(hero.class||"").toLowerCase()}</span>
      </div>
      <div style="margin-left:auto;font-size:10px;color:#ccc;opacity:.7;">
        <span style="margin-right:8px;">ATK <b>${hero.attack ?? "-"}</b></span>
        <span style="margin-right:8px;">DEF <b>${hero.defense ?? "-"}</b></span>
        <span>SPD <b>${hero.speed ?? "-"}</b></span>
      </div>
    </div>
  `;
}

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
  container.innerHTML = renderHudBars(hero);

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