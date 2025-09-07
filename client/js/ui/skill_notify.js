// /js/ui/skill_notify.js
(() => {
  // Evita instalar duas vezes
  if (window.SkillAdvance?.__installed) return;

  const MAP = {
    SWORD:    { label: "sword fighting" },
    AXE:      { label: "axe fighting" },
    CLUB:     { label: "club fighting" },
    DISTANCE: { label: "distance fighting" },
    SHIELD:   { label: "shielding" },
    MAGIC:    { label: "magic level" },
  };

  // ======= Config padrão (ajustável em runtime por SkillAdvance.config) =====
  const CFG = {
    aliveMs: 5000,                 // duração da mensagem (ms) — agora 5s
    pollMs:  1500,                 // intervalo do polling de skills (ms)
    sound: {
      enabled: true,
      src: "/sfx/levelup.mp3",     // seu arquivo (ex.: /public/sfx/levelup.mp3)
      volume: 0.75,
      useWebAudio: true            // WebAudio = menor latência; cai p/ <audio> se não der
    }
  };

  // ===== Motor de áudio (WebAudio com fallback) =============================
  const AudioEngine = (() => {
    let ctx = null;
    let gain = null;
    let buffer = null;
    let htmlFallback = null; // <audio> fallback pré-carregado

    async function ensureContext() {
      if (ctx) return ctx;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error("no AudioContext");
        ctx  = new Ctx({ latencyHint: "interactive" });
        gain = ctx.createGain();
        gain.gain.value = CFG.sound.volume;
        gain.connect(ctx.destination);
      } catch {
        ctx = null;
      }
      return ctx;
    }

    function setVolume(v) {
      const vol = Math.max(0, Math.min(1, v));
      if (gain) gain.gain.value = vol;
      if (htmlFallback) htmlFallback.volume = vol;
    }

    async function loadBuffer(url) {
      const c = await ensureContext();
      if (!c) return null;
      const res = await fetch(url, { cache: "force-cache" });
      const arr = await res.arrayBuffer();
      buffer = await c.decodeAudioData(arr); // pré-decodifica (latência ~0)
      return buffer;
    }

    function primeSilent() {
      if (!ctx) return;
      try {
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(gain);
        s.start(0);
      } catch {}
    }

    function unlockOnGesture() {
      const handler = async () => {
        try {
          if (ctx && ctx.state === "suspended") await ctx.resume();
          primeSilent();
        } catch {}
        window.removeEventListener("pointerdown", handler, true);
        window.removeEventListener("keydown",   handler, true);
      };
      window.addEventListener("pointerdown", handler, true);
      window.addEventListener("keydown",   handler, true);
    }

    async function init(url) {
      if (CFG.sound.useWebAudio) {
        await ensureContext();
        if (ctx) {
          unlockOnGesture();
          try { await loadBuffer(url); } catch {}
        }
      }
      if (!htmlFallback) {
        try {
          htmlFallback = new Audio(url);
          htmlFallback.preload = "auto";
          htmlFallback.load();
          htmlFallback.volume = CFG.sound.volume;
        } catch { htmlFallback = null; }
      }
    }

    function play() {
      if (!CFG.sound.enabled) return;
      if (CFG.sound.useWebAudio && ctx && buffer) {
        try {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(gain);
          src.start(ctx.currentTime);
          return;
        } catch {}
      }
      if (htmlFallback) {
        try {
          htmlFallback.currentTime = 0;
          htmlFallback.play().catch(() => {});
          return;
        } catch {}
      }
      try {
        const a = new Audio(CFG.sound.src);
        a.volume = CFG.sound.volume;
        a.play().catch(() => {});
      } catch {}
    }

    return {
      init,
      play,
      setVolume,
      reload: async (url) => { buffer = null; await init(url); },
      hasWebAudio: () => !!ctx
    };
  })();

  // inicializa áudio cedo (pré-decodifica)
  AudioEngine.init(CFG.sound.src).catch(() => {});

  // ===== DOM / estilos (CENTRO exato da área do jogo) =======================
  function getGameRoot() {
    // Prioriza a área do jogo; se não existir, cai pro body
    return (
      document.getElementById("clientShell") ||
      document.getElementById("centerStage") ||
      document.body
    );
  }

  function ensureContainer() {
    let el = document.getElementById("sysMsgContainer");
    if (el) return el;

    const root = getGameRoot();
    el = document.createElement("div");
    el.id = "sysMsgContainer";
    Object.assign(el.style, {
      position: "absolute",          // relativo ao clientShell
      left: "50%",
      top:  "50%",
      transform: "translate(-50%, -50%)",
      zIndex:  10000,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "10px",
      pointerEvents: "none",
      width: "auto",
      maxWidth: "90%",               // limita dentro da tela do jogo
    });
    root.appendChild(el);

    // CSS embutido (look Tibia-ish + glow/pulse + badge "Advanced!")
    const s = document.createElement("style");
    s.textContent = `
      #sysMsgContainer .sys-msg {
        min-width: 260px;
        max-width: 700px;
        padding: 12px 16px;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(9,12,20,.92);
        color: #e6eef6;
        font: 800 18px/1.35 "Trebuchet MS", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        border-radius: 12px;
        box-shadow: 0 10px 28px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05);
        opacity: 0; transform: translateY(-6px) scale(0.98);
        transition: opacity .2s ease, transform .2s ease, filter .15s ease, box-shadow .25s ease;
        text-align: center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: 0 0 6px rgba(167,139,250,.28), 0 1px 2px rgba(0,0,0,.6);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        animation: glowPulse 1.1s ease-in-out 0s 2 alternate;
      }
      #sysMsgContainer .sys-msg.show { opacity: 1; transform: translateY(0) scale(1); }
      #sysMsgContainer .sys-msg:hover { filter: brightness(1.06); }

      #sysMsgContainer .sys-hero  { color:#93c5fd; font-weight:900; margin-right:4px; }
      #sysMsgContainer .sys-skill { color:#c4b5fd; font-weight:900; }
      #sysMsgContainer .sys-lvl   { color:#facc15; font-weight:900; }

      @keyframes glowPulse {
        0%   { box-shadow: 0 10px 28px rgba(0,0,0,.45), 0 0 0 rgba(167,139,250,0); }
        100% { box-shadow: 0 10px 28px rgba(0,0,0,.45), 0 0 22px rgba(167,139,250,.38); }
      }

      /* Badge que pisca atrás da mensagem por ~200ms */
      #sys-adv-badge {
        position: absolute;
        left: 50%;
        top:  50%;
        transform: translate(-50%, -50%) scale(0.85);
        z-index: 9999; /* atrás do .sys-msg (que tem 10000) */
        pointer-events: none;
        padding: 6px 10px;
        border-radius: 999px;
        background: radial-gradient(closest-side, rgba(196,181,253,.22), rgba(196,181,253,0));
        box-shadow: 0 0 36px rgba(196,181,253,.45);
        color: #e9d5ff;
        font: 900 14px/1 "Trebuchet MS", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        text-shadow: 0 0 10px rgba(196,181,253,.8);
        opacity: 0;
        animation: advPop .22s ease-out forwards;
      }
      @keyframes advPop {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.75); }
        60%  { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.00); }
      }
    `;
    document.head.appendChild(s);
    return el;
  }

  const container = ensureContainer();
  const queue = [];
  let showing = false;

  // Pisca o badge "Advanced!" atrás do card por ~200ms
  function flashBadge(text = "Advanced!") {
    try {
      const root = getGameRoot();
      const b = document.createElement("div");
      b.id = "sys-adv-badge";
      b.textContent = text;
      root.appendChild(b);
      setTimeout(() => { try { b.remove(); } catch {} }, 220);
    } catch {}
  }

  // ——— SINCRONIA: som e animação no MESMO frame do .show ———
  function showNext() {
    if (showing) return;
    const job = queue.shift();
    if (!job) return;
    showing = true;

    const el = document.createElement("div");
    el.className = "sys-msg";
    el.innerHTML = job.html;
    container.appendChild(el);

    // Próximo frame: badge + som + classe .show juntos
    requestAnimationFrame(() => {
      flashBadge("Advanced!");
      AudioEngine.play();
      el.classList.add("show");
    });

    const aliveMs = Number.isFinite(job.aliveMs) ? job.aliveMs : CFG.aliveMs;
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => {
        el.remove();
        showing = false;
        showNext();
      }, 260);
    }, aliveMs);
  }

  function push(htmlOrText, aliveMs) {
    const safe = String(htmlOrText);
    queue.push({ html: safe, aliveMs });
    showNext();
  }

  function skillLabel(skillType) {
    const key = String(skillType || "").toUpperCase();
    return MAP[key]?.label || key.toLowerCase();
  }

  // "Aric advanced to sword fighting level 3."
  function notifySkill(heroName, skillType, newLevel) {
    const label = skillLabel(skillType);
    const html = `<span class="sys-hero">${escapeHtml(heroName || "Hero")}</span>
                  advanced to <span class="sys-skill">${escapeHtml(label)}</span>
                  level <span class="sys-lvl">${Number(newLevel)||0}</span>.`;
    push(html, CFG.aliveMs);
    // Som é disparado dentro de showNext() no mesmo rAF da animação
  }

  // ===== Estado + detecção de avanço ========================================
  const last = new Map();        // heroId -> Map(skill -> level)
  const initialized = new Set(); // 1º snapshot não notifica

  function monitorUpdate(heroId, heroName, rows) {
    const hid = String(heroId);
    let m = last.get(hid);
    if (!m) { m = new Map(); last.set(hid, m); }

    const firstTime = !initialized.has(hid);

    (rows || []).forEach(r => {
      const st = String(r.skill_type || r.type || r.name || "").toUpperCase();
      if (!st) return;
      const lvl = Number(r.level ?? r.lvl ?? 1);
      const prev = m.get(st);
      if (!firstTime && typeof prev === "number" && lvl > prev) {
        notifySkill(heroName, st, lvl);
      }
      m.set(st, lvl);
    });

    if (firstTime) initialized.add(hid);
  }

  // utils
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  // ===== Monitor Global (até 3 heróis) ======================================
  let pollTimer = null;
  let busy = false;

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
    return r.json();
  }
  function normalizeSkillsPayload(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.skills)) return data.skills;
    if (Array.isArray(data.rows)) return data.rows;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }
  async function fetchSkillsForHero(hero) {
    if (typeof window.SKILLS_ENDPOINT === "function") {
      const url = window.SKILLS_ENDPOINT(hero.id);
      const r = await fetch(url, { credentials: "include" });
      if (r.ok) return normalizeSkillsPayload(await r.json());
    }
    const builds = [
      (id) => '/api/skills/hero/' + id,
      (id) => '/api/skills?heroId=' + encodeURIComponent(id),
      (id) => '/api/hero/' + id + '/skills',
      (id) => '/api/heroes/' + id + '/skills',
      (id) => '/api/player/hero/' + id + '/skills',
    ];
    for (const b of builds) {
      const url = b(hero.id);
      const r = await fetch(url, { credentials: "include" });
      if (r.status === 404) continue;
      if (r.ok) return normalizeSkillsPayload(await r.json());
      throw new Error(`GET ${url} -> ${r.status}`);
    }
    const url = '/api/skills/me?heroId=' + encodeURIComponent(hero.id);
    const r = await fetch(url, { credentials: "include" });
    if (r.ok) return normalizeSkillsPayload(await r.json());
    return [];
  }
  async function pollOnce() {
    if (busy) return; busy = true;
    try {
      const me = await getJSON('/api/player/me');
      const heroes = (me?.heroes || []).slice(0, 3);
      for (const h of heroes) {
        try {
          const rows = await fetchSkillsForHero(h);
          monitorUpdate(h.id, h.name || `Hero ${h.id}`, rows);
        } catch {}
      }
    } catch {} finally { busy = false; }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, CFG.pollMs);
    pollOnce(); // baseline
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ===== API pública =========================================================
  window.SkillAdvance = {
    __installed: true,
    push,
    notifySkill,
    monitor: { update: monitorUpdate, start: startPolling, stop: stopPolling },
    config: {
      set(options = {}) {
        if (Number.isFinite(options.aliveMs)) CFG.aliveMs = Math.max(800, options.aliveMs|0);
        if (Number.isFinite(options.pollMs))  CFG.pollMs  = Math.max(500, options.pollMs|0);

        if (options.sound) {
          const s = options.sound;
          if (typeof s.enabled === "boolean") CFG.sound.enabled = s.enabled;
          if (typeof s.src === "string" && s.src) {
            CFG.sound.src = s.src;
            AudioEngine.reload(CFG.sound.src).catch(() => {});
          }
          if (Number.isFinite(s.volume)) {
            CFG.sound.volume = Math.max(0, Math.min(1, s.volume));
            AudioEngine.setVolume(CFG.sound.volume);
          }
          if (typeof s.useWebAudio === "boolean") CFG.sound.useWebAudio = s.useWebAudio;
        }

        // reinicia o polling se mudou o intervalo
        if (pollTimer) { stopPolling(); startPolling(); }
      },
      get() { return JSON.parse(JSON.stringify(CFG)); }
    }
  };

  // Reposiciona se o jogo reinicializar o shell/canvas
  window.addEventListener('game:ready', () => {
    const root = getGameRoot();
    const el = document.getElementById("sysMsgContainer");
    if (el && el.parentElement !== root) root.appendChild(el);
  });

  // Inicia automaticamente
  startPolling();
})();
