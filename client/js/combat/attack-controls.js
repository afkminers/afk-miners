// /js/combat/attack-controls.js
// Clique no canvas para atacar. Robusto contra WS sem posição e diferenças
// de payload do backend. Também cuida de CSRF (header + query).

(() => {
  if (window.__AttackControlsInstalled) return;
  window.__AttackControlsInstalled = true;

  // ---------- utils ----------
  const log = (...a) => { try { console.log("[attack]", ...a); } catch {} };
  const now = () => Date.now();
  const mapKey = () => (window.GameScene?.mapKey || "house");

  // Lê cookie simples
  function readCookie(name) {
    const m = document.cookie.split("; ").find(r => r.startsWith(name + "="));
    return m ? decodeURIComponent(m.split("=")[1]) : "";
  }

  // Garante cookie/header de CSRF disponível
  let __csrfReady = false;
  async function ensureCsrf() {
    if (__csrfReady && readCookie("csrf")) return;
    try { await fetch("/api/csrf", { credentials: "include" }); } catch {}
    __csrfReady = true;
  }

  // POST com CSRF (header + query string)
  async function postWithCsrf(url, body) {
    await ensureCsrf();
    const token = readCookie("csrf") || "";
    const u = new URL(url, location.origin);
    if (token) u.searchParams.set("csrf", token);

    const res = await fetch(u.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Csrf-Token": token } : {}),
      },
      body: JSON.stringify(body || {}),
    });

    // Tenta decodificar JSON sempre que possível
    let data = null;
    const txt = await res.text().catch(() => "");
    try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }

    if (!res.ok) {
      const msg = `${res.status} ${res.statusText} @ ${url}`;
      throw new Error(data?.error ? `${msg} — ${data.error}` : msg);
    }
    return data ?? {};
  }

  function getPlayerPos() {
    const p = window.GameScene?.controller?.getPosition?.() || { x: 0, y: 0 };
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  // Estado exposto pelo módulo render-combat.js
  function listServerMonsters() {
    const C = window.CombatUI;
    try {
      if (C?.getState) {
        const st = C.getState();
        if (Array.isArray(st?.monsters)) {
          return st.monsters.map(m => ({
            id: String(m.id ?? m.sid ?? m.uuid ?? ""),
            key: String(m.key ?? m.monsterKey ?? "monster"),
            x: Number(m.x ?? 0),
            y: Number(m.y ?? 0),
          })).filter(m => m.id);
        }
      }
    } catch {}
    return [];
  }

  // Mobs locais (sem id) – só para achar posição clicada
  function listLocalMobs() {
    const arr = Array.isArray(window.GameScene?.mobs) ? window.GameScene.mobs : [];
    return arr.map(m => ({ x: m.x | 0, y: m.y | 0, key: m.kind || "monster" }));
  }

  function pickNearest(list, x, y, max = 96) {
    let best = null, bestD2 = max * max;
    for (const it of list) {
      const dx = x - (it.x | 0), dy = y - (it.y | 0);
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; best = it; }
    }
    return best;
  }

  function worldFromCanvas(ev, canvas, camera) {
    const r = canvas.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    return camera?.screenToWorld
      ? camera.screenToWorld(sx, sy)
      : { x: (camera?.x || 0) + sx, y: (camera?.y || 0) + sy };
  }

  // ---------- ciclo de ataque ----------
  const S = { attacking: false, targetSid: null, seq: 0, loop: null };

  async function doHit() {
    if (!S.attacking || !S.targetSid) return;
    S.seq++;
    try {
      await postWithCsrf("/api/combat/hit", {
        targetId: S.targetSid,
        mapKey: mapKey(),
        seq: S.seq,
        clientTs: now(),
      });
    } catch (e) {
      const msg = String(e?.message || "");
      console.warn("[attack] hit falhou:", msg);
      if (msg.includes("403")) stopAttack();
    }
  }

  function startLoop() { stopLoop(); S.loop = setInterval(doHit, 150); }
  function stopLoop() { if (S.loop) { clearInterval(S.loop); S.loop = null; } }

  async function stopAttack() {
    stopLoop();
    if (!S.attacking || !S.targetSid) { S.attacking = false; S.targetSid = null; return; }
    const sid = S.targetSid;
    S.attacking = false;
    S.targetSid = null;
    try {
      await postWithCsrf("/api/combat/attack/stop", {
        targetId: sid,
        mapKey: mapKey(),
        clientTs: now(),
      });
    } catch {}
  }

  // Tenta vários formatos de payload até um passar (evita 400 por chaves divergentes)
  async function startAttack(targetSid, clickX, clickY) {
    if (!targetSid) { console.warn("[attack] start: sem targetSid"); return; }

    await stopAttack();
    const p = getPlayerPos();
    const mk = mapKey();

    const candidates = [
      // formato mais completo
      { targetId: targetSid, mapKey: mk, playerX: p.x, playerY: p.y, clickX: Math.round(clickX), clickY: Math.round(clickY), clientTs: now() },
      // nomes alternativos comuns
      { monsterId: targetSid, mapKey: mk, x: Math.round(clickX), y: Math.round(clickY), clientTs: now() },
      { id: targetSid, map: mk, x: Math.round(clickX), y: Math.round(clickY), clientTs: now() },
      { target: targetSid, mapKey: mk, clientTs: now() },
      { targetId: targetSid, mapKey: mk },
      { monsterId: targetSid, mapKey: mk },
      { id: targetSid, mapKey: mk },
    ];

    let ok = false, lastErr = "";
    for (const body of candidates) {
      try {
        await postWithCsrf("/api/combat/attack/start", body);
        ok = true;
        break;
      } catch (e) {
        lastErr = String(e?.message || "");
        // Se for 403, tenta garantir CSRF e repetir a sequência do zero
        if (lastErr.includes("403")) { await ensureCsrf(); }
        // Continua tentando próximo formato
      }
    }

    if (!ok) {
      console.warn("[attack] start falhou:", lastErr || "sem resposta");
      return;
    }

    S.attacking = true;
    S.targetSid = targetSid;
    S.seq = 0;
    startLoop();
    log("start OK →", targetSid);
  }

  // ---------- input ----------
  function attach(canvas, camera) {
    if (!canvas || canvas.__attackBound) return;
    canvas.__attackBound = true;

    canvas.addEventListener("pointerdown", (ev) => {
      try { canvas.focus(); } catch {}
      const w = worldFromCanvas(ev, canvas, camera);
      log(`click @ ${Math.round(w.x)}, ${Math.round(w.y)}`);

      const server = listServerMonsters();
      let chosen = null;

      // 1) Se o WS trouxer x,y válidos, escolhe o mais perto
      const withPos = server.filter(m => (m.x || m.y));
      if (withPos.length) {
        const best = pickNearest(withPos, w.x, w.y, 96);
        if (best) chosen = { sid: best.id, x: best.x, y: best.y };
      }

      // 2) Fallback: usa posição do mob local + QUALQUER id do WS
      if (!chosen && server.length) {
        const local = pickNearest(listLocalMobs(), w.x, w.y, 96);
        if (local) chosen = { sid: server[0].id, x: local.x, y: local.y };
      }

      if (chosen) {
        startAttack(chosen.sid, chosen.x, chosen.y);
      } else {
        log("nenhum alvo — stop");
        stopAttack();
      }
    }, { capture: true });

    window.addEventListener("keydown", (e) => { if (e.key === "Escape") stopAttack(); });
    log("controls ready");
  }

  // Sinal “game:ready” da cena
  window.addEventListener("game:ready", (ev) => {
    const { canvas, camera } = ev?.detail || {};
    attach(canvas || window.GameScene?.canvas, camera || window.GameScene?.camera);
  });

  // Fallback: tentar anexar em 1s caso o evento não chegue
  setTimeout(() => {
    if (!window.GameScene) return;
    attach(window.GameScene.canvas, window.GameScene.camera);
  }, 1000);
})();
