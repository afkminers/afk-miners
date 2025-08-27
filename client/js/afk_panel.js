// client/js/afk_panel.js
(function () {
  // ---- helpers HTTP ----
  async function getCsrf() {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    const h = new Map(r.headers.entries());
    const tok =
      h.get('x-csrf-token') ||
      h.get('x-xsrf-token') ||
      h.get('csrf-token') ||
      h.get('x-csrf');
    if (tok) return tok;
    try {
      const j = await r.clone().json();
      if (j?.token || j?.csrf || j?.csrfToken) return j.token || j.csrf || j.csrfToken;
    } catch (_) {}
    throw new Error('CSRF não encontrado');
  }

  async function jget(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function jpost(url, body) {
    const tok = await getCsrf();
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': tok },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ---- view helpers ----
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function pretty(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  // ---- painel ----
  let panel = null;

  async function openAFK() {
    if (!panel) {
      panel = el('div', { id: 'afkPanel' }, [
        el('div', { class: 'afk-card' }, [
          el('div', { class: 'afk-header' }, [
            el('h3', { class: 'afk-title' }, 'AFK Workers'),
            el('div', { class: 'afk-status-wrap' }, [
              el('span', { id: 'afkStatus', class: 'afk-status' }, 'Last refresh: —')
            ]),
            el('div', { class: 'afk-actions' }, [
              el('button', { id: 'afkRefresh', class: 'afk-btn' }, 'Refresh'),
              el('button', { id: 'afkCollect', class: 'afk-btn' }, 'Collect'),
              el('button', { id: 'afkAddWorker', class: 'afk-btn' }, '+ Worker (debug)'),
              el('button', { id: 'afkClose', class: 'afk-btn' }, 'Fechar')
            ])
          ]),
          el('div', { class: 'afk-grid' }, [
            el('div', { class: 'afk-col' }, [
              el('h4', {}, 'Workers'),
              el('pre', { id: 'afkWorkers', class: 'afk-pre' })
            ]),
            el('div', { class: 'afk-col' }, [
              el('h4', {}, 'Boxes'),
              el('pre', { id: 'afkBoxes', class: 'afk-pre' })
            ]),
            el('div', { class: 'afk-col' }, [
              el('h4', {}, 'Inventory'),
              el('pre', { id: 'afkInv', class: 'afk-pre' })
            ])
          ])
        ]),
        el(
          'style',
          {},
          `
#afkPanel{position:fixed;inset:auto 12px 12px auto;z-index:9999;max-width:720px;font-family:monospace}
.afk-card{background:#111;color:#eee;border:1px solid #333;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);overflow:hidden}
.afk-header{display:flex;align-items:center;gap:12px;background:#191919;padding:10px 12px;border-bottom:1px solid #333}
.afk-title{margin:0;font-size:14px;letter-spacing:.5px}
.afk-status-wrap{margin-right:auto;color:#9aa;font-size:11px}
.afk-status{opacity:.85}
.afk-actions{display:flex;gap:8px}
.afk-btn{background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:8px;padding:6px 10px;cursor:pointer}
.afk-btn[disabled]{opacity:.5;cursor:not-allowed}
.afk-btn:hover{background:#333}
.afk-btn.pulse{animation:afkPulse .25s ease}
@keyframes afkPulse{from{transform:scale(1)}50%{transform:scale(1.05)}to{transform:scale(1)}}
.afk-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:10px}
.afk-col h4{margin:0 0 4px 0;font-size:12px;color:#aaa}
.afk-pre{margin:0;background:#0e0e0e;border:1px solid #222;border-radius:8px;padding:8px;max-height:240px;overflow:auto;font-size:12px}
          `
        )
      ]);
      document.body.appendChild(panel);

      // eventos
      panel.querySelector('#afkClose').addEventListener('click', () => {
        panel.remove();
        panel = null;
      });

      panel.querySelector('#afkRefresh').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        try {
          btn.disabled = true;
          btn.classList.add('pulse');
          await renderState();
          console.log('[AFK] refresh ok');
        } catch (e) {
          console.warn('[AFK] refresh error', e);
          alert('Erro ao atualizar: ' + e.message);
        } finally {
          setTimeout(() => btn.classList.remove('pulse'), 250);
          btn.disabled = false;
        }
      });

      panel.querySelector('#afkCollect').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        try {
          btn.disabled = true;
          const r = await jpost('/api/afk/collect');
          await renderState();
          alert('Coletado: ' + pretty(r.added || r));
        } catch (e) {
          alert('Erro: ' + e.message);
        } finally {
          btn.disabled = false;
        }
      });

      panel.querySelector('#afkAddWorker').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        try {
          btn.disabled = true;
          const r = await jpost('/api/afk/create-worker', {
            name: 'Worker',
            produce_type: 'stone',
            produce_amount: 1,
            rate_sec: 10
          });
          await renderState();
          alert('Worker criado: ' + (r.id || 'ok'));
        } catch (e) {
          alert('Erro: ' + e.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
    await renderState();
  }

  async function renderState() {
    const statusEl = panel.querySelector('#afkStatus');
    const workersEl = panel.querySelector('#afkWorkers');
    const boxesEl = panel.querySelector('#afkBoxes');
    const invEl = panel.querySelector('#afkInv');

    try {
      const s = await jget('/api/afk/state');
      workersEl.textContent = pretty(s.workers || []);
      boxesEl.textContent = pretty(s.boxes || []);
      invEl.textContent = pretty(s.inventory || []);
      statusEl.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      workersEl.textContent = 'Erro: ' + e.message;
      statusEl.textContent = 'Last refresh: erro';
      throw e;
    }
  }

  // botão do dock
  function attachButton() {
    const btn = document.getElementById('btnAFK');
    if (!btn) return;
    btn.addEventListener('click', openAFK);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachButton);
  } else {
    attachButton();
  }
})();
