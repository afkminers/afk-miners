// Feedback visual/sonoro de level up do herói (separado de skills)
// Modular: só observa eventos de level up do herói ("hero:levelup")
// client/js/ui/levelup_notify.js

(function () {
  // Evita instalar duas vezes
  if (window.LevelUpNotify?.__installed) return;

  const SOUND_SRC = "/sfx/levelup.mp3";
  let audio = null;
  function playSound() {
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(()=>{});
      return;
    }
    try {
      audio = new Audio(SOUND_SRC);
      audio.volume = 0.9;
      audio.preload = "auto";
      audio.play().catch(()=>{});
    } catch {}
  }

  function ensureContainer() {
    let el = document.getElementById("levelUpContainer");
    if (el) return el;
    el = document.createElement("div");
    el.id = "levelUpContainer";
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      top: "15%",
      transform: "translate(-50%, 0)",
      zIndex: 99999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      pointerEvents: "none"
    });
    document.body.appendChild(el);
    return el;
  }

  function showLevelUp(hero) {
    const container = ensureContainer();
    const msg = document.createElement("div");
    msg.className = "levelup-toast";
    msg.innerHTML = `
      <div style="
        background: linear-gradient(90deg, #facc15 60%, #fef08a 100%);
        color: #222;
        border: 4px solid #d1a700;
        border-radius: 16px;
        font-family: 'Press Start 2P', monospace;
        font-size: 17px;
        font-weight: bold;
        box-shadow: 0 8px 38px #0009, 0 2px 0 #fff7;
        padding: 22px 44px 18px 44px;
        margin-bottom: 6px;
        margin-top: 12px;
        text-shadow: 0 2px 2px #fff8, 0 1px 0 #0002;
        letter-spacing: 1px;
        opacity: 0;
        transition: opacity .22s cubic-bezier(.6,1.7,.7,1.1);
        text-align: center;
      ">
        <span style="font-size:18px;vertical-align:middle;filter:drop-shadow(0 1px 0 #fff9);">★</span>
        Level Up! <b>${hero.name}</b> agora é <span style="color:#b45309">Lv ${hero.level}</span>
      </div>
    `;
    container.appendChild(msg);
    playSound();
    setTimeout(() => { msg.style.opacity = "1"; }, 80);
    setTimeout(() => {
      msg.style.opacity = "0";
      setTimeout(() => { try { msg.remove(); } catch {} }, 400);
    }, 3900);
  }

  window.addEventListener("hero:levelup", ev => {
    if (!ev.detail || !ev.detail.hero) return;
    showLevelUp(ev.detail.hero);
  });

  window.LevelUpNotify = { __installed: true };
})();