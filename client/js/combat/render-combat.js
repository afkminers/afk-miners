// /js/combat/render-combat.js
// Conecta no WS e expõe estado legível por outros módulos (ids dos monstros).

export default function installCombatOverlay() {
  if (window.__CombatOverlayInstalled) return;
  window.__CombatOverlayInstalled = true;

  const state = {
    monsters: new Map(), // id -> { id, x, y, key }
    lastTs: 0,
  };

  // Expor API estável para outros módulos
  window.CombatUI = {
    // Sempre devolve um snapshot simples (sem Map) para consumo externo
    getState() {
      return {
        ts: state.lastTs,
        monsters: Array.from(state.monsters.values()),
      };
    },
    // Render opcional (placeholder). Mantido para compat com play.js
    render(ctx, camera, dt) {
      // nada obrigatório aqui – overlay visual é opcional
    },
  };

  // --- WS ---
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    try {
      // Handshake básico (mesmo que o app.js faz)
      const me = window.__ME__ || {};
      const hello = { id: me.id, name: me.name };
      ws.send(JSON.stringify({ type: "auth", ...hello }));
    } catch {}
    console.log("[combat] ws module loaded");
  });

  ws.addEventListener("message", (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (!m || typeof m !== "object") return;

    // Normaliza eventos que trazem id de monstro
    if (m.type === "monster_respawned" || m.type === "monster_update" || m.type === "monster_spawn") {
      const id = String(m.id || m.monsterId || "");
      if (!id) return;
      const key = String(m.monsterKey || m.key || "monster");
      const x = Number.isFinite(m.x) ? Number(m.x) : 0;
      const y = Number.isFinite(m.y) ? Number(m.y) : 0;
      state.monsters.set(id, { id, key, x, y });
      state.lastTs = Date.now();
    }

    if (m.type === "monster_died" || m.type === "monster_removed") {
      const id = String(m.id || m.monsterId || "");
      if (id) state.monsters.delete(id);
      state.lastTs = Date.now();
    }

    // Opcional: repassa estado via evento
    try {
      const snap = window.CombatUI.getState();
      window.dispatchEvent(new CustomEvent("combat:state", { detail: snap }));
    } catch {}
  });

  ws.addEventListener("close", () => {
    // Mantém API viva mesmo sem WS
    console.warn("[combat] ws closed");
  });
}
