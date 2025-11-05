// client/js/ui/presence-controls.js
import { apiGet, apiPost } from '../api.js';
import { i18n } from '../i18n/core.js';

const STATUS = ['ONLINE', 'AFK', 'BUSY', 'APPEAR_OFFLINE'];
const ACTIVITY = ['HOUSE', 'ADVENTURE', 'TRAINING', 'DUNGEON'];

// estado global da minha presença (pra outros módulos, ex.: dm-chat)
let CURRENT = { status: 'ONLINE', activity: 'HOUSE' };

export function getMyPresence() {
  return { ...CURRENT };
}

// estado do AFK automático (controlado no cliente)
let afkInitialized = false;
let manualStatus = CURRENT.status;
let autoAfkActive = false;
let lastInputAt = Date.now();
let lastAutoToggleAt = 0;

function labelForStatus(k) {
  const map = {
    ONLINE: i18n.t('status.online'),
    AFK: i18n.t('status.afk'),
    BUSY: i18n.t('status.busy'),
    APPEAR_OFFLINE: i18n.t('status.appearOffline'),
  };
  return map[k] || k;
}

function labelForActivity(k) {
  const map = {
    HOUSE: i18n.t('activity.house'),
    ADVENTURE: i18n.t('activity.adventure'),
    TRAINING: i18n.t('activity.training'),
    DUNGEON: i18n.t('activity.dungeon'),
  };
  return map[k] || k;
}

export async function mountPresenceControls() {
  // montar dentro do header do painel de amigos
  const header = document.querySelector('.friend-panel__header');
  if (!header) return;

  let current = { status: 'ONLINE', activity: 'HOUSE' };
  try {
    const r = await apiGet('/api/presence/me');
    if (r?.ok) {
      current = {
        status: (r.status || 'ONLINE').toUpperCase(),
        activity: (r.activity || 'HOUSE').toUpperCase(),
      };
    }
  } catch {}

  // sincroniza estado global e base do AFK
  CURRENT = { ...current };
  manualStatus = CURRENT.status;
  lastInputAt = Date.now();

  // --- AFK automático (só inicializa uma vez por página) ---
  if (typeof window !== 'undefined' && !afkInitialized) {
    afkInitialized = true;

    const AUTO_AFK_MINUTES = 5;       // timeout em minutos
    const CHECK_EVERY_MS = 10_000;    // checagem a cada 10s
    const DEBOUNCE_RESUME_MS = 5_000; // evita ficar indo/voltando rápido

    function markActivity() {
      lastInputAt = Date.now();
      if (autoAfkActive && (lastInputAt - lastAutoToggleAt) > DEBOUNCE_RESUME_MS) {
        autoAfkActive = false;
        lastAutoToggleAt = Date.now();
        // volta ao status manual anterior
        apiPost('/api/presence', { status: manualStatus }).catch(() => {});
      }
    }

    ['mousemove', 'keydown', 'click', 'touchstart', 'wheel', 'visibilitychange'].forEach((ev) => {
      window.addEventListener(ev, markActivity, { passive: true });
    });

    setInterval(async () => {
      // só auto-afk se a escolha manual for ONLINE
      if (manualStatus !== 'ONLINE') return;
      const idleMs = Date.now() - lastInputAt;
      if (!autoAfkActive && idleMs >= AUTO_AFK_MINUTES * 60_000) {
        autoAfkActive = true;
        lastAutoToggleAt = Date.now();
        try {
          await apiPost('/api/presence', { status: 'AFK' });
        } catch {}
      }
    }, CHECK_EVERY_MS);
  }

  // --- UI dos selects ---
  const wrap = document.createElement('div');
  wrap.className = 'presence-controls';
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';
  wrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:6px">
      <span style="opacity:.8">${i18n.t('presence.status.label')}</span>
      <select data-role="status"></select>
    </label>
    <label style="display:flex;align-items:center;gap:6px">
      <span style="opacity:.8">${i18n.t('presence.activity.label')}</span>
      <select data-role="activity"></select>
    </label>
  `;
  header.appendChild(wrap);

  const selStatus = wrap.querySelector('select[data-role="status"]');
  const selActivity = wrap.querySelector('select[data-role="activity"]');

  // popular selects
  for (const k of STATUS) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = labelForStatus(k);
    if (k === current.status) opt.selected = true;
    selStatus.appendChild(opt);
  }
  for (const k of ACTIVITY) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = labelForActivity(k);
    if (k === current.activity) opt.selected = true;
    selActivity.appendChild(opt);
  }

  // --- selo local "invisível" (Aparecer Offline) ---
  const invisibleNoteEl = document.createElement('span');
  invisibleNoteEl.className = 'presence-invisible-note';
  invisibleNoteEl.style.marginLeft = '8px';
  invisibleNoteEl.style.opacity = '.75';
  invisibleNoteEl.textContent = i18n.t('presence.invisible.note');
  invisibleNoteEl.hidden = current.status !== 'APPEAR_OFFLINE';
  wrap.appendChild(invisibleNoteEl);

  async function applyChange(part) {
    try {
      const body = part === 'status'
        ? { status: selStatus.value }
        : { activity: selActivity.value };

      const res = await apiPost('/api/presence', body);
      if (res?.ok) {
        if (part === 'status') {
          // atualiza status em memória (sempre em maiúsculas)
          current.status = String(res.status || selStatus.value).toUpperCase();
          manualStatus = current.status;
        } else {
          current.activity = String(res.activity || selActivity.value).toUpperCase();
        }

        CURRENT = { ...current };
        invisibleNoteEl.hidden = current.status !== 'APPEAR_OFFLINE';

        const msg = part === 'status'
          ? i18n.t('presence.changed.status', { status: labelForStatus(res.status || current.status) })
          : i18n.t('presence.changed.activity', { activity: labelForActivity(res.activity || current.activity) });

        showMiniToast(msg);
      }
    } catch (err) {
      showMiniToast('Falha ao atualizar presença.', 'warn');
    }
  }

  selStatus.addEventListener('change', () => applyChange('status'));
  selActivity.addEventListener('change', () => applyChange('activity'));
}

function showMiniToast(text, tone = 'info') {
  const el = document.createElement('div');
  el.className = 'presence-toast';
  el.textContent = text;
  el.style.position = 'fixed';
  el.style.left = '16px';
  el.style.bottom = '16px';
  el.style.padding = '8px 12px';
  el.style.background = tone === 'warn' ? 'rgba(255,99,71,.9)' : 'rgba(0,0,0,.8)';
  el.style.color = '#fff';
  el.style.borderRadius = '8px';
  el.style.fontSize = '12px';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);
  setTimeout(() => {
    try {
      el.remove();
    } catch {}
  }, 1600);
}
