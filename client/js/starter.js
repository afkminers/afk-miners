/* client/js/starter.js */

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
  } catch {}
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

/* ===================== Helpers de imagem e lore ===================== */
function spriteUrlFrom(h, dbHero) {
  // 1º: card grandão 400x600 (starter)
  if (h?.cardImage) return '/' + String(h.cardImage).replace(/^\/+/, '');

  // 2º: qualquer caminho de imagem explícito vindo da API
  if (h?.image) return '/' + String(h.image).replace(/^\/+/, '');

  // 3º: imagem padrão do catálogo de heróis (do /api/heroes/master)
  if (dbHero?.imageUrl) return dbHero.imageUrl;

  // 4º: fallback para spriteKey (pixel art in-game)
  if (h?.spriteKey) return `/sprites/characters/${h.spriteKey}.png`;

  return '/img/placeholder.png';
}

function getStarterStory(key) {
  const k = String(key || '').toLowerCase();
  switch (k) {
    case 'aric':
      return 'Aric começou como guarda das entradas das minas. É o cavaleiro mais simples e seguro pra iniciar sua jornada.';
    case 'brokk':
      return 'Brokk prefere sentir o peso dos golpes no escudo. Ele não liga de apanhar, desde que ninguém encoste na party.';
    case 'lyria':
      return 'Lyria aprendeu a caçar na floresta e nunca erra o alvo. Causa muito dano de longe, mas odeia lutar corpo a corpo.';
    default:
      return '';
  }
}

/* ===================== Fluxo principal ===================== */
async function main() {
  try {
    // garante que está logado
    await jget('/api/auth/me');
    await fetchCsrf().catch(() => null);

    const status = await jget('/api/starter/status'); // { canSelect: boolean }
    if (!status?.canSelect) {
      location.href = '/app.html';
      return;
    }

    // === NOVO: carregar heróis do banco para mostrar stats base ===
    let masterByKey = new Map();
    try {
      const masters = await jget('/api/heroes/master');
      masterByKey = new Map(
        (masters || []).map((m) => [
          String(m.heroKey || m.herokey || '').toLowerCase(),
          m,
        ]),
      );
    } catch (e) {
      console.warn('[starter] falha ao carregar /api/heroes/master', e);
    }

    const list = await jget('/api/starter/list');
    grid.innerHTML = '';

    for (const h of list) {
      const key = String(h.heroKey || h.herokey || '').toLowerCase();
      const dbHero = masterByKey.get(key) || null;

      const rarity    = (h.rarity || dbHero?.rarity || '').toUpperCase();
      const heroClass = (h.class  || dbHero?.class  || '').toUpperCase();
      const role      = (h.role   || dbHero?.role   || '').toUpperCase();

      const atk = Number.isFinite(dbHero?.base_attack)  ? dbHero.base_attack  : null;
      const def = Number.isFinite(dbHero?.base_defense) ? dbHero.base_defense : null;
      const spd = Number.isFinite(dbHero?.base_speed)   ? dbHero.base_speed   : null;

      const statsLine = atk != null && def != null && spd != null
        ? `ATK ${atk} • DEF ${def} • SPD ${spd}`
        : '';

      const story = h.story || getStarterStory(key);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = [
        '<div class="sprite"><img alt=""></div>',
        `<h3>${h.name || h.heroKey}</h3>`,
        `<div class="meta">${rarity} • ${heroClass} • ${role}</div>`,
        statsLine ? `<div class="stats">${statsLine}</div>` : '',
        story ? `<p class="story">${story}</p>` : '',
        `<button class="btn">Escolher</button>`,
      ].join('');

      const img = card.querySelector('img');
      img.src = spriteUrlFrom(h, dbHero);
      img.onerror = () => { img.src = '/img/placeholder.png'; };

      const btn = card.querySelector('button');
      btn.onclick = async () => {
        try {
          await jpost('/api/starter/select', { heroKey: h.heroKey });
          location.href = '/app.html';
        } catch (e) {
          console.error(e);
          let msg = e?.message || 'falha ao selecionar';
          try { msg = JSON.parse(msg).error || msg; } catch {}
          errBox.textContent = 'Erro: ' + msg;
        }
      };

      grid.appendChild(card);
    }

    if (btnSkip) btnSkip.onclick = () => { location.href = '/app.html'; };

  } catch (e) {
    console.error(e);
    let msg = e?.message || 'falha';
    try { msg = JSON.parse(msg).error || msg; } catch {}
    errBox.textContent = 'Erro ao carregar: ' + msg;
  }
}

main();
