// /js/combat/attack-controls.js
// Ataque por clique, integrado ao WS de combate e tolerante a overlay sem posição.

(() => {
  if (window.__AttackControlsInstalled) return;
  window.__AttackControlsInstalled = true;

  // --- deps obrigatórios (vêm de csrf.js e play.js) ---
  function need(func, name) {
    if (typeof func !== "function") {
      console.error(`[attack] ${name} indisponível. Garanta <script src="/js/csrf.js"> antes de attack-controls.js`);
      throw new Error(`${name} indisponível`);
    }
    return func;
  }
  const jpost = (...args) => need(window.jpost, "jpost")(...args);

  const nowMs = () => Date.now();
  const mapKey = () => (window.GameScene?.mapKey || "house");

  // --- estado ---
  const state = { attacking: false, target: null, loop: null, seq: 0 };

  function log(...a) { try { console.log(...a); } catch {} }

  function getPlayerPos() {
    const p = window.GameScene?.controller?.getPosition?.();
    return { x: Math.round(p?.x || 0), y: Math.round(p?.y || 0) };
  }

  // --- WS → pegar monstros do servidor ---
  function getCombatState() {
    const C = window.CombatUI;
    if (!C) return null;
    if (typeof C.getState === "function") return C.getState();
    return C.state || C;
  }

  function listServerMonsters() {
    const st = getCombatState();
    if (!st) return [];
    let arr = [];
    if (Array.isArray(st.monsters)) arr = st.monsters;
    else if (Array.isArray(st.mobs)) arr = st.mobs;
    else if (st.entities && typeof st.entities === "object") arr = Object.values(st.entities);
    // normaliza
    return (arr || []).map(m => ({
      sid: String(m.id ?? m.uuid ?? ""),
      key: String(m.monsterKey ?? m.key ?? "monster"),
      x: Number(m.x ?? 0),
      y: Number(m.y ?? 0),
    })).filter(m => m.sid);
  }

  function pickNearest(list, x, y, max = 64) {
    let best = null, bd2 = max * max;
    for (const m of list) {
      const dx = x - m.x, dy = y - m.y;
      const d2 = dx*dx + dy*dy;
      if (d2 <= bd2) { bd2 = d2; best = m; }
    }
    return best;
  }

  // fallback: usar mob local só para “onde cliquei” e casar com um id do WS
  function guessTargetFromLocal(x, y) {
    const locals = Array.isArray(window.GameScene?.mobs) ? window.GameScene.mobs : [];
    const nearLocal = pickNearest(locals, x, y, 64);
    if (!nearLocal) return null;
    const server = listServerMonsters();
    if (!server.length) return null; // sem id de servidor não dá pra começar
    // pega qualquer id do servidor (como stub) — servidor valida o id
    const sid = server[0].sid;
    return { sid, key: nearLocal.kind || "monster", x: nearLocal.x, y: nearLocal.y };
  }

  // === ciclo de hits ===
  async function doHit() {
    if (!state.attacking || !state.target) return;
    const { sid } = state.target;
    state.seq += 1;
    try {
      await jpost("/api/combat/hit", {
        targetId: sid, id: sid, monsterId: sid, mobId: sid,
        mapKey: mapKey(),
        seq: state.seq,
        clientTs: nowMs(),
      });
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("403")) {
        console.warn("[attack] hit 403 — parando.");
        stopAttack();
      } else {
        console.warn("[attack] hit falhou:", msg);
      }
    }
  }
  function startHitLoop(){ stopHitLoop(); state.loop = setInterval(doHit, 150); }
  function stopHitLoop(){ if (state.loop) { clearInterval(state.loop); state.loop = null; } }

  async function startAttack(target) {
    if (!target?.sid) { console.warn("[attack] alvo sem sid — abortado."); return; }
    if (state.attacking && state.target?.sid === target.sid) return;

    await stopAttack(); // limpa anterior

    const { x: px, y: py } = getPlayerPos();
    const body = {
      targetId: target.sid, id: target.sid, monsterId: target.sid, mobId: target.sid,
      mapKey: mapKey(),
      playerX: px, playerY: py,
      clickX: Math.round(target.x), clickY: Math.round(target.y),
      clientTs: nowMs(),
    };

    try {
      const res = await jpost("/api/combat/attack/start", body);
      if (res && res.ok === false && res.error) {
        console.warn("[attack] start -> erro:", res.error);
        return;
      }
      state.attacking = true;
      state.target = target;
      state.seq = 0;
      startHitLoop();
      log("[attack] iniciou em", target.sid, target.key);
    } catch (e) {
      console.warn("[attack] start falhou:", e?.message || e);
    }
  }

  async function stopAttack() {
    stopHitLoop();
    if (!state.attacking || !state.target) { state.attacking = false; state.target = null; return; }
    const sid = state.target.sid;
    state.attacking = false;
    state.target = null;
    try {
      await jpost("/api/combat/attack/stop", {
        targetId: sid, id: sid, monsterId: sid, mobId: sid,
        mapKey: mapKey(),
        clientTs: nowMs(),
      });
    } catch {}
  }

  // === input no canvas (prioridade alta) ===
  function worldFromCanvas(ev, canvas, camera) {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    return (typeof camera?.screenToWorld === "function")
      ? camera.screenToWorld(sx, sy)
      : { x: (camera?.x || 0) + sx, y: (camera?.y || 0) + sy };
  }

  function attach(canvas, camera) {
    if (!canvas) return;

    function onPointerDown(ev) {
      // garante foco de WASD como o play.js faz
      try { canvas.focus(); } catch {}
      const w = worldFromCanvas(ev, canvas, camera);
      log(`[attack] click @ ${Math.round(w.x)}, ${Math.round(w.y)}`);

      // 1) tenta pelo WS (se tiver posição)
      let tgt = pickNearest(listServerMonsters(), w.x, w.y, 72);

      // 2) fallback: usa mob local + 1º id do WS
      if (!tgt) tgt = guessTargetFromLocal(w.x, w.y);

      if (tgt) {
        log("[attack] alvo:", tgt.key, "sid:", tgt.sid);
        startAttack(tgt);
      } else {
        log("[attack] nenhum alvo — stop");
        stopAttack();
      }
    }

    // capture:true garante que dispare mesmo se outro listener der stopPropagation
    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") stopAttack(); });

    log("[attack] controls ready");
  }

  // aguarda a cena
  window.addEventListener("game:ready", (ev) => {
    const { canvas, camera } = ev?.detail || {};
    attach(canvas || window.GameScene?.canvas, camera || window.GameScene?.camera);
  });
})();
