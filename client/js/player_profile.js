// client/js/player_profile.js
import { API, apiPost } from './api.js';

/* =========================
   Caches leves (com TTL)
   ========================= */
const cache = {
  playerSkills: null,   // [{ skillType, level, tries, need, progress }]
  playerLevel:  null,   // { level, xp, next, progress }
  lastFetch:    0,

  equip:        null,   // { equipment:{slot->itemKey}, equipped:[{itemKey,name,slot,icon,sprite}], bag:[...] }
  lastEquip:    0
};
const TTL_ME = 15_000; // 15s
const TTL_EQ = 10_000; // 10s

/* Controla buscas concorrentes quando reabre o modal rapidamente */
let openState = {
  controller: null,      // AbortController para /me e /skills
  currentHero: null      // referência do herói atualmente aberto
};

/* =========================
   Helpers utilitários
   ========================= */
const cap = (s) => !s ? '—' : String(s).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

function animateProgressBars(container){
  if (!container) return;
  const spans = container.querySelectorAll('.pf-skill-bar span[data-pct]');
  requestAnimationFrame(()=>{
    spans.forEach(sp => {
      const pct = Number(sp.getAttribute('data-pct')) || 0;
      sp.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    });
  });
}

/** Resolve o heroId ativo a partir das fontes conhecidas (Team → ActiveHeroId → GameScene → Player → fallback) */
function getActiveHeroId(fallbackId = null){
  try{
    if (window.Team && typeof window.Team.getActiveHeroId === 'function') {
      const hid = window.Team.getActiveHeroId();
      if (hid) return hid;
    }
  }catch{}
  try{ if (window.ActiveHeroId) return window.ActiveHeroId; }catch{}
  try{ if (window.GameScene && window.GameScene.activeHeroId) return window.GameScene.activeHeroId; }catch{}
  try{ if (window.Player && window.Player.activeHeroId) return window.Player.activeHeroId; }catch{}
  return fallbackId;
}

/* =========================
   EQUIP: leitura + pintura
   ========================= */
async function fetchEquip(force=false){
  if (!force && cache.equip && Date.now()-cache.lastEquip < TTL_EQ) return cache.equip;
  try{
    const r = await fetch(`${API}/api/equip/my`, { credentials:'include', cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cache.equip = await r.json(); // { equipment, equipped:[...], bag:[...] }
  }catch(_e){
    // Backend ainda não tem /api/equip/my? ok — seguimos com vazio sem poluir console.
    cache.equip = { equipment:{}, equipped:[], bag:[] };
  }
  cache.lastEquip = Date.now();
  return cache.equip;
}

/** Resolve URL da sprite do item.
 *  - Se vier absoluta (/algo… ou http…), usa como está
 *  - Se vier relativa (ex.: 'items/backpack_brown.png'), prefixa /sprites/
 */
function spriteUrlFromMeta(meta){
  const sprite = meta?.sprite || meta?.icon || ''; // compat
  if (!sprite) return '';
  if (sprite.startsWith('/') || sprite.startsWith('http')) return sprite;
  return `/sprites/${sprite}`;
}

function paintEquipGrid(data){
  const slots = ['helmet','amulet','back','armor','weapon','shield','legs','ring1','ring2','boots','belt'];
  const byKey = Object.fromEntries((data?.equipped||[]).map(x => [x.itemKey, x]));

  for (const s of slots){
    const el = document.querySelector(`.pf-equip .slot[data-slot="${s}"]`);
    if (!el) continue;

    el.classList.remove('has-item');
    el.style.removeProperty('background-image');

    const key  = data?.equipment?.[s];
    const meta = key && byKey[key];

    const url = meta ? spriteUrlFromMeta(meta) : '';

    if (meta && url){
      el.style.backgroundImage    = `url(${url})`;
      el.style.backgroundSize     = 'contain';
      el.style.backgroundRepeat   = 'no-repeat';
      el.style.backgroundPosition = 'center';
      el.title = `${meta.name} (${meta.slot})`;
      el.classList.add('has-item');
    } else {
      el.title = s.toUpperCase();
    }
  }
}

/* =========================
   API player/me + skills (globais)
   ========================= */
async function fetchPlayerMeOnce(signal){
  if (cache.playerSkills && Date.now() - cache.lastFetch < TTL_ME) return;
  try{
    const r = await fetch(`${API}/api/player/me`, { credentials:'include', cache:'no-store', signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (Array.isArray(data?.skills)) cache.playerSkills = data.skills;
    if (data?.level) cache.playerLevel = data.level;
    cache.lastFetch = Date.now();
  }catch(e){
    if (e?.name === 'AbortError') return;
    console.error('Falha ao buscar /api/player/me', e);
  }
}

/* =========================
   Skills do herói (NOVO endpoint)
   ========================= */
async function loadHeroSkills(hero, signal){
  // Agora o backend expõe: GET /api/skills/me?heroId=...
  if (!hero?.id) return [];
  try{
    const r = await fetch(
      `${API}/api/skills/me?heroId=${encodeURIComponent(hero.id)}`,
      { credentials:'include', cache:'no-store', signal }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    // Espera-se: [{ skill_type, level, tries_progress }]
    // Normaliza para o renderer
    return (Array.isArray(rows) ? rows : []).map(s => {
      const need = Number(s.need ?? 0);
      const tries = Number(s.tries_progress ?? s.tries ?? 0);
      const pct = (s.progress_pct != null)
        ? Number(s.progress_pct)
        : (need > 0 ? (tries / need) : 0);

      return {
        skillType: String(s.skill_type || s.skillType || '').toUpperCase(),
        level: Number(s.level ?? 1),
        progress: Math.max(0, Math.min(1, pct)), // 0..1
        need,
        tries
      };
    });

  }catch(e){
    if (e?.name === 'AbortError') return [];
    console.error('Falha ao buscar /api/skills/me', e);
    return [];
  }
}

/* =========================
   Render helpers
   ========================= */
const niceLabel = {
  SWORD:    'Sword Fighting',
  AXE:      'Axe Fighting',
  CLUB:     'Club Fighting',
  DISTANCE: 'Distance Fighting',
  SHIELD:   'Shielding',
  MAGIC:    'Magic Level'
};

function renderTrainBars(skills){
  return (skills || []).map(s => {
    const rawType = String(s.skillType || s.skill_type || '').toUpperCase();
    const nice    = niceLabel[rawType] || cap(rawType);

    const pct  = Math.max(0, Math.min(100, Math.round((s.progress || 0) * 100)));
    const tip  = `${pct}% — You are ${pct}% to the next level.`; // <- sem “faltam X tries”

    return `
      <div class="pf-skill">
        <div class="pf-skill-name">${nice} <b>${s.level ?? 1}</b></div>
        <div class="pf-skill-bar"><span data-pct="${pct}"></span></div>
        <div class="pf-skill-tip">You are ${pct}% to the next level.</div>
      </div>
    `;

  }).join('');
}

function renderHeroSkills(list){
  if (!list?.length) return `<div class="pf-skill-null">No hero skills</div>`;

  return list.map(s => {
    const label = niceLabel[s.skillType] || cap(s.skillType);

    const need  = Number(s.need ?? 0);
    const tries = Number(s.tries ?? 0);
    const frac  = Number.isFinite(s.progress) ? s.progress : (need > 0 ? tries/need : 0);

    const pct   = Math.max(0, Math.min(100, Math.round(frac * 100)));
    const tip   = `You are ${pct}% to the next level.`; // frase estilo Tibia

    return `
      <div class="pf-skill">
        <div class="pf-skill-name">${label} <b>${s.level}</b></div>
        <div class="pf-skill-bar"><span data-pct="${pct}"></span></div>
        <div class="pf-skill-tip">${tip}</div>
      </div>
    `;
  }).join('');
}

/* =========================
   Equip actions (opcional)
   ========================= */
// === troque APENAS esta função ===
let equipHandlersBound = false;
function ensureEquipHandlers(){
  if (equipHandlersBound) return;
  const grid = document.querySelector('.pf-equip');
  if (!grid) return;

  // Unequip (como já estava, mas usando o resolvedor de heroId)
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="unequip"]');
    if (!btn) return;

    const slotEl = btn.closest('.slot[data-slot]');
    if (!slotEl) return;

    e.preventDefault();

    const slot = (slotEl.getAttribute('data-slot') || '').toUpperCase();
    const heroId = getActiveHeroId(openState.currentHero?.id);
    if (!heroId) return;

    const currentKey = cache.equip?.equipment?.[slot.toLowerCase()] || null;

    try {
      await apiPost('/api/equipment/equip', {
        heroId,
        slot,
        // seu backend aceita itemKey nulo => unequip
        itemKey: currentKey || null
      });
      await fetchEquip(true);
      paintEquipGrid(cache.equip);
      document.dispatchEvent(new CustomEvent('equip-updated'));
    } catch (err) {
      console.error('equip error', err);
    }
  });

  // *** NOVO: clique direito no slot BACK abre a mochila ***
  grid.addEventListener('contextmenu', (e) => {
    const slotEl = e.target.closest('.pf-equip .slot[data-slot]');
    if (!slotEl) return;

    const slot = String(slotEl.getAttribute('data-slot') || '').toUpperCase();
    if (slot !== 'BACK') return; // só interessa o slot da mochila

    e.preventDefault(); // impede o menu do navegador

    // Resolve heroId “vivo” na tela
    const heroId = getActiveHeroId(openState.currentHero?.id);
    if (!heroId) return;

    try {
      // Abre a UI da mochila (qualquer uma das duas APIs, conforme o que existir)
      if (window.BackpackUI?.open) window.BackpackUI.open(heroId);
      else if (window.BackpackUI?.render) window.BackpackUI.render(heroId);
    } catch (err) {
      console.warn('[backpack] open/render falhou:', err?.message || err);
    }
  });

  // Opcional: evita seleção de texto acidental nos slots
  grid.addEventListener('mousedown', (e) => {
    if (e.target.closest('.pf-equip .slot')) {
      e.target.closest('.pf-equip .slot').style.userSelect = 'none';
    }
  });

  equipHandlersBound = true;
}


/* =========================
   Modal / Perfil
   ========================= */
export function bindProfileModal() {
  const overlay = document.getElementById('profileModal');
  if (!overlay) {
    console.warn('[profile] #profileModal não encontrado');
    return { open() {}, close() {}, refreshEquip(){}, refreshAll(){} };
  }

  const closeBtn = overlay.querySelector('.pf-close');
  const okBtn    = document.getElementById('pf-ok');

  const el = {
    img:        document.getElementById('pf-img'),
    rarity:     document.getElementById('pf-rarity'),
    miniMeta:   document.getElementById('pf-mini-meta'),
    atk:        document.getElementById('pf-atk'),
    def:        document.getElementById('pf-def'),
    spd:        document.getElementById('pf-spd'),
    skillsBox:  document.getElementById('pf-skills-placeholder'),
    levelBadge: document.getElementById('pf-level') // “Lvl X (Y%)”
  };

  function fillHeader(hero){
    const rarity=(hero.rarity||'COMMON').toUpperCase();
    if (el.img){
      el.img.src = hero.imageUrl || `img/heroes/${hero.heroKey}.png`;
      el.img.alt = hero.name || 'hero portrait';
      el.img.onerror = () => { el.img.onerror=null; el.img.src = `img/heroes/${hero.heroKey}.png`; };
    }
    if (el.rarity){
      el.rarity.textContent = rarity.replace('_',' ');
      el.rarity.className = 'pf-rarity rar-'+rarity;
    }
    if (el.miniMeta){
      el.miniMeta.textContent = [hero.class,hero.role,hero.attack_type,hero.element,hero.weapon_pref]
        .filter(Boolean).map(cap).join(' • ');
    }
    if (el.atk) el.atk.textContent = hero.attack ?? 0;
    if (el.def) el.def.textContent = hero.defense ?? 0;
    if (el.spd) el.spd.textContent = hero.speed ?? 0;
  }

  async function fillSkillsArea(hero, signal){
    if (!el.skillsBox) return;
    el.skillsBox.innerHTML = `
      <div class="pf-loading">
        <div class="spinner"></div>
        <span>Loading skills…</span>
      </div>
    `;

    // Busca as skills do herói + level do player (para o badge)
    const [heroSkillsRaw] = await Promise.all([ loadHeroSkills(hero, signal) ]);
    await fetchPlayerMeOnce(signal);

    // Atualiza badge "Lvl X (Y%)"
    if (cache.playerLevel && el.levelBadge){
      const pct = Math.round((cache.playerLevel.progress||0)*100);
      el.levelBadge.textContent = `Lvl ${cache.playerLevel.level} (${pct}%)`;
    }

    // ORDEM desejada: Sword → Axe → Club → Distance → Magic → Shield
    const ORDER = ['SWORD','AXE','CLUB','DISTANCE','MAGIC','SHIELD'];
    const heroSkills = [...(heroSkillsRaw||[])].sort((a,b) => {
      const ia = ORDER.indexOf(String(a.skillType||'').toUpperCase());
      const ib = ORDER.indexOf(String(b.skillType||'').toUpperCase());
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });

    // Renderiza SOMENTE "Hero Skills" (sem a seção Training Skills)
    el.skillsBox.innerHTML = `
      <div class="pf-skill-block">
        <div class="pf-skill-block-title pf-skill-block-title--primary">Hero Skills</div>
        ${renderHeroSkills(heroSkills)}
      </div>
    `;

    // anima as barras (usa data-pct já calculado em renderHeroSkills)
    animateProgressBars(el.skillsBox);
  }

  async function fillEquip(){
    const eq = await fetchEquip(); // cache + TTL
    paintEquipGrid(eq);
    ensureEquipHandlers(); // garante handler dos botões (se existirem)
  }

  async function open(hero){
    if (!hero) return;

    // Cancela buscas anteriores se ainda estiverem ativas
    if (openState.controller) { try{ openState.controller.abort(); }catch{} }
    openState.controller = new AbortController();
    openState.currentHero = hero;

    fillHeader(hero);
    await Promise.all([
      fillSkillsArea(hero, openState.controller.signal),
      fillEquip()
    ]);

    // ===== Integra Backpack UI + marca herói ativo (pickup/equip usam isso) =====
    try { 
      if (typeof window.setActiveHero === 'function') {
        window.setActiveHero(hero.id); // setter centralizado (emite eventos e atualiza GameScene/ActiveHeroId)
      } else {
        // fallback: manter compat se o setter ainda não existir
        window.ActiveHeroId = hero.id;
        if (window.GameScene) window.GameScene.activeHeroId = hero.id;
      }
    } catch {}

    try {
      if (window.BackpackUI) {
        const hid = getActiveHeroId(hero.id);
        window.BackpackUI.render(hid);
        // Sempre que abrir fora de hora, consulta o herói ativo atual
        window.BackpackUI.bindContextOpen(() => getActiveHeroId(hid));
      }
    } catch {}
    // =====================================================================

    overlay.style.display = '';
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden','false');
    setTimeout(()=> document.getElementById('pf-ok')?.focus(), 0);
  }

  function close(){
    if (openState.controller) { try{ openState.controller.abort(); }catch{} }
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden','true');
    overlay.style.display = 'none';

    // ⚠️ Não limpamos o ActiveHeroId aqui para manter o herói ativo globalmente.
    // Se quiser forçar limpar ao fechar, descomente abaixo:
    // try { delete window.ActiveHeroId; } catch {}
  }

  // Expor uma forma fácil de atualizar equipamentos externamente
  async function refreshEquip(force=false){
    await fetchEquip(force);
    paintEquipGrid(cache.equip);
  }

  // Recarrega tudo (skills + equip). Útil após ganhos ou trocar item.
  async function refreshAll(){
    const hero = openState.currentHero;
    if (!hero) return;
    if (openState.controller) { try{ openState.controller.abort(); }catch{} }
    openState.controller = new AbortController();
    await fetchPlayerMeOnce(openState.controller.signal);
    await fillSkillsArea(hero, openState.controller.signal);
    await refreshEquip(true);
  }

  // Eventos opcionais para integrar com outras telas
  document.addEventListener('equip-updated', () => refreshEquip(true));
  document.addEventListener('player-updated', () => refreshAll());

  closeBtn && (closeBtn.onclick = close);
  okBtn && (okBtn.onclick = close);
  overlay.addEventListener('click',(e)=>{ if(e.target===overlay) close(); });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && overlay.classList.contains('show')) close(); });

  return { open, close, refreshEquip, refreshAll };
}

/* Inventory → abre modal */
export function setupInventoryOpen(invContainer, getInventory, openFn){
  function resolveCard(target){
    const card = target.closest('.card'); if(!card) return null;
    const id = card.getAttribute('data-id'); if(!id) return null;
    const inv = getInventory?.() || [];
    return inv.find?.(x => String(x.id)===String(id)) || null;
  }
  invContainer.addEventListener('click', e=>{
    const hero = resolveCard(e.target); if(hero) openFn(hero);
  });
  invContainer.addEventListener('keydown', e=>{
    if(e.key==='Enter'||e.key===' '){
      const hero = resolveCard(e.target);
      if(hero){ e.preventDefault(); openFn(hero); }
    }
  });
}
