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

/* ===================== Áudio (SFX + BGM) ===================== */

let clickSfx = null;
let bgmAudio = null;
let bgmStarted = false;

function setupAudio() {
  try {
    // som de clique de UI
    clickSfx = new Audio('/sfx/ui-click-01.mp3');
    clickSfx.volume = 0.6;
  } catch (e) {
    console.warn('[starter] falha ao criar clickSfx', e);
  }

  try {
    // música de fundo suave/loop
    bgmAudio = new Audio('/sfx/starter-bgm-loop.mp3');
    bgmAudio.loop = true;
    bgmAudio.volume = 0.35;
  } catch (e) {
    console.warn('[starter] falha ao criar bgmAudio', e);
  }

  // Por causa das regras de autoplay, só podemos dar play após interação do usuário.
  function handleFirstInteraction() {
    if (bgmStarted || !bgmAudio) return;
    bgmStarted = true;
    bgmAudio.play().catch((err) => {
      console.warn('[starter] não conseguiu tocar BGM:', err?.message || err);
    });
    window.removeEventListener('pointerdown', handleFirstInteraction);
    window.removeEventListener('keydown', handleFirstInteraction);
  }

  window.addEventListener('pointerdown', handleFirstInteraction);
  window.addEventListener('keydown', handleFirstInteraction);
}

function playClick() {
  if (!clickSfx) return;
  try {
    // reseta pro começo pra vários cliques seguidos
    clickSfx.currentTime = 0;
    clickSfx.play().catch(() => {});
  } catch {}
}

function stopBgm() {
  if (!bgmAudio) return;
  try {
    bgmAudio.pause();
  } catch {}
}

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
      return 'Aric cresceu defendendo as entradas das minas. É um espadachim equilibrado, ótimo para quem está começando.';
    case 'brokk':
      return 'Brokk é um anão teimoso que não recua. Ele segura a linha de frente enquanto o resto da party faz o estrago.';
    case 'lyria':
      return 'Lyria aprendeu a atirar em alvos nas florestas ao redor das minas. Causa muito dano à distância, mas precisa se manter segura.';
    default:
      return '';
  }
}

function showError(msg) {
  if (!errBox) return;
  errBox.textContent = msg;
  errBox.classList.remove('shake');
  // força reflow pra animação reiniciar
  void errBox.offsetWidth;
  errBox.classList.add('shake');
  setTimeout(() => errBox.classList.remove('shake'), 450);
}

/* ===================== Fluxo principal ===================== */
async function main() {
  try {
    await jget('/api/auth/me');
    await fetchCsrf().catch(() => null);

    // inicializa áudio (mas só toca após interação)
    setupAudio();

    const status = await jget('/api/starter/status'); // { canSelect: boolean }
    if (!status?.canSelect) {
      stopBgm();
      location.href = '/app.html';
      return;
    }

    // carrega heróis do banco pra puxar stats base
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
        playClick();
        try {
          await jpost('/api/starter/select', { heroKey: h.heroKey });
          stopBgm();
          location.href = '/app.html';
        } catch (e) {
          console.error(e);
          let msg = e?.message || 'falha ao selecionar';
          try { msg = JSON.parse(msg).error || msg; } catch {}
          showError('Erro: ' + msg);
        }
      };

      grid.appendChild(card);
    }

    if (btnSkip) {
      btnSkip.onclick = () => {
        playClick();
        stopBgm();
        location.href = '/app.html';
      };
    }

  } catch (e) {
    console.error(e);
    let msg = e?.message || 'falha';
    try { msg = JSON.parse(msg).error || msg; } catch {}
    showError('Erro ao carregar: ' + msg);
  }
}

main();
