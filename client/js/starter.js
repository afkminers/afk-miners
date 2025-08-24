// client/js/starter.js

/* ===================== CSRF ===================== */
let CSRF_TOKEN = null;

async function fetchCsrf() {
  if (CSRF_TOKEN) return CSRF_TOKEN;

  const r = await fetch('/api/csrf', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  const headerTok = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');

  let bodyTok = null;
  try {
    const data = await r.json();
    bodyTok = data?.token || data?.csrf || data?.csrfToken || null;
  } catch { /* ok se não for json */ }

  CSRF_TOKEN = headerTok || bodyTok || null;
  return CSRF_TOKEN;
}

/* ===================== HTTP helpers ===================== */
async function jget(url) {
  const r = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (r.status === 401) {
    // não logado -> volta para login
    location.href = '/index.html';
    throw new Error('Não autenticado');
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function jpost(url, body, _retry) {
  const token = await fetchCsrf().catch(() => null);

  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { 'x-csrf-token': token } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  if (r.status === 401) {
    location.href = '/index.html';
    throw new Error('Não autenticado');
  }
  if (r.status === 403 && !_retry) {
    // token inválido/expirado? tenta renovar uma vez
    CSRF_TOKEN = null;
    await fetchCsrf().catch(() => null);
    return jpost(url, body, true);
  }

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ===================== UI refs ===================== */
const grid    = document.getElementById('grid');
const errBox  = document.getElementById('err');
const btnSkip = document.getElementById('btnSkip');

function spriteUrlFrom(h) {
  if (h?.image)     return '/' + String(h.image).replace(/^\/+/, '');
  if (h?.spriteKey) return `/sprites/characters/${h.spriteKey}.png`;
  return '/img/placeholder.png';
}

/* ===================== Fluxo principal ===================== */
async function main() {
  try {
    // 1) Confere sessão; se não estiver logado, jget redireciona
    await jget('/api/auth/me');

    // 2) opcional: pega CSRF pra próximos POSTs
    await fetchCsrf().catch(() => null);

    // 3) Já tem starter? vai direto para a UI (index)
    const status = await jget('/api/starter/status'); // { canSelect: boolean }
    if (!status?.canSelect) {
      location.href = '/'; // index.html (shell com UI)
      return;
    }

    // 4) Monta a lista para escolher
    const list = await jget('/api/starter/list');
    grid.innerHTML = '';

    for (const h of list) {
      const card = document.createElement('div');
      card.className = 'card';

      card.innerHTML = [
        '<div class="sprite"><img alt=""></div>',
        `<h3>${h.name || h.heroKey}</h3>`,
        `<div class="meta">${(h.rarity||'').toUpperCase()} • ${(h.class||'').toUpperCase()} • ${(h.role||'').toUpperCase()}</div>`,
        `<button class="btn">Escolher</button>`
      ].join('');

      const img = card.querySelector('img');
      img.src = spriteUrlFrom(h);
      img.onerror = () => { img.src = '/img/placeholder.png'; };

      const btn = card.querySelector('button');
      btn.onclick = async () => {
        try {
          await jpost('/api/starter/select', { heroKey: h.heroKey });
          // Depois de escolher, abre a UI; House pode ser aberta pelo card/lobby
          location.href = '/';
        } catch (e) {
          console.error(e);
          let msg = e?.message || 'falha ao selecionar';
          try { msg = JSON.parse(msg).error || msg; } catch {}
          errBox.textContent = 'Erro: ' + msg;
        }
      };

      grid.appendChild(card);
    }

    // Botão "Ir para o Lobby" (pular)
    if (btnSkip) btnSkip.onclick = () => { location.href = '/'; };

  } catch (e) {
    console.error(e);
    let msg = e?.message || 'falha';
    try { msg = JSON.parse(msg).error || msg; } catch {}
    errBox.textContent = 'Erro ao carregar: ' + msg;
  }
}

main();
