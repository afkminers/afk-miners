// client/js/starter.js  (substitua TUDO por este conteúdo)

/* ===================== CSRF ===================== */
let CSRF_TOKEN = null;

async function fetchCsrf() {
  if (CSRF_TOKEN) return CSRF_TOKEN;

  const r = await fetch('/api/csrf', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  const headerTok =
    r.headers.get('x-csrf-token') ||
    r.headers.get('X-CSRF-Token');

  let bodyTok = null;
  try {
    const data = await r.json();
    bodyTok = data.token || data.csrf || data.csrfToken || null;
  } catch { /* pode não ser JSON, ok */ }

  CSRF_TOKEN = headerTok || bodyTok;
  if (!CSRF_TOKEN) throw new Error('Não foi possível obter CSRF');
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
    // Não autenticado → volta para login
    location.href = '/index.html';
    throw new Error('Não autenticado');
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function jpost(url, body, _retry) {
  const token = await fetchCsrf();
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-csrf-token': token, // mesmo header aceito no middleware
    },
    body: JSON.stringify(body || {}),
  });

  if (r.status === 401) {
    location.href = '/index.html';
    throw new Error('Não autenticado');
  }
  if (r.status === 403 && !_retry) {
    // CSRF inválido/expirado: refaz handshake e tenta mais 1 vez
    CSRF_TOKEN = null;
    await fetchCsrf();
    return jpost(url, body, true);
  }

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ===================== UI ===================== */
const grid    = document.getElementById('grid');
const errBox  = document.getElementById('err');
const btnSkip = document.getElementById('btnSkip');

function spriteUrlFrom(h) {
  // PRIORIDADE: caminho do YAML vindo do servidor (ex.: "sprites/characters/knight.png")
  if (h.image) return '/' + String(h.image).replace(/^\/+/, '');
  // ALTERNATIVA: spriteKey (ex.: "knight" -> /sprites/characters/knight.png)
  if (h.spriteKey) return `/sprites/characters/${h.spriteKey}.png`;
  // FALLBACK: placeholder genérico (certifique-se de ter esse arquivo)
  return '/img/placeholder.png';
}

async function main() {
  try {
    // Garante cookie + token CSRF antes de qualquer POST
    await fetchCsrf();

    // Se não estiver autenticado, jget redireciona para /index.html
    const status    = await jget('/api/starter/status');
    const canSelect = !!status.canSelect;

    const list = await jget('/api/starter/list');
    grid.innerHTML = '';

    for (const h of list) {
      const card = document.createElement('div');
      card.className = 'card';

      const imgSrc = spriteUrlFrom(h);

      card.innerHTML = [
        '<div class="sprite">',
          '<img alt="">',
        '</div>',
        `<h3>${h.name || h.heroKey}</h3>`,
        `<div class="meta">${(h.rarity||'').toUpperCase()} • ${(h.class||'').toUpperCase()} • ${(h.role||'').toUpperCase()}</div>`,
        `<button class="btn" ${canSelect ? '' : 'disabled'}>Escolher</button>`
      ].join('');

      const img = card.querySelector('img');
      img.src = imgSrc;
      img.onerror = () => { img.src = '/img/placeholder.png'; };

      const btn = card.querySelector('button');
      btn.onclick = async () => {
        if (!canSelect) return;
        try {
          await jpost('/api/starter/select', { heroKey: h.heroKey });
          // levou o starter → vai para a casa (ou lobby.html se preferir)
          window.location.href = '/house.html';
        } catch (e) {
          console.error(e);
          let msg = e.message || 'falha ao selecionar';
          try { msg = JSON.parse(msg).error || msg; } catch {}
          errBox.textContent = 'Erro: ' + msg;
        }
      };

      grid.appendChild(card);
    }

    if (btnSkip) {
      btnSkip.onclick = () => { window.location.href = '/house.html'; };
    }
  } catch (e) {
    console.error(e);
    let msg = e.message || 'falha';
    try { msg = JSON.parse(msg).error || msg; } catch {}
    errBox.textContent = 'Erro ao carregar: ' + msg;
  }
}

main();
