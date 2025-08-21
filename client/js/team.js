import { API, apiGet, apiPost } from './api.js';

export function bindTeamUI() {
  const openBtn = document.getElementById('openTeam');
  const modal = document.getElementById('teamModal');
  const slotsEl = document.getElementById('teamSlots');
  const heroesEl = document.getElementById('teamHeroes');
  const saveBtn = document.getElementById('teamSave');
  const closeBtn = document.getElementById('teamClose');
  const listEl = document.getElementById('teamList');

  let heroes = [];
  const team = { 1: null, 2: null, 3: null };
  let currentSlot = 1;

  async function refresh() {
    const me = await apiGet(`${API}/api/player/me`);
    heroes = me?.heroes || [];
    const t = await apiGet(`${API}/api/team`);
    team[1] = team[2] = team[3] = null;
    for (const row of t.team || []) team[row.slot] = row.heroId;
    renderTeamList();
  }

  function renderTeamList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    for (let s = 1; s <= 3; s++) {
      const hero = heroes.find(h => h.id === team[s]);
      const div = document.createElement('div');
      div.textContent = `Slot ${s}: ${hero ? hero.name : '-'}`;
      listEl.appendChild(div);
    }
  }

  function renderModal() {
    if (!slotsEl || !heroesEl) return;
    slotsEl.innerHTML = '';
    for (let s = 1; s <= 3; s++) {
      const hero = heroes.find(h => h.id === team[s]);
      const btn = document.createElement('button');
      btn.className = 'pf-btn';
      btn.textContent = hero ? `Slot ${s}: ${hero.name}` : `Slot ${s}: —`;
      btn.onclick = () => { currentSlot = s; };
      slotsEl.appendChild(btn);
    }
    heroesEl.innerHTML = '';
    heroes.forEach(h => {
      const b = document.createElement('button');
      b.className = 'pf-btn';
      b.textContent = h.name;
      b.onclick = () => {
        if (currentSlot) {
          team[currentSlot] = h.id;
          renderModal();
        }
      };
      heroesEl.appendChild(b);
    });
  }

  async function save() {
    const payload = { team: [] };
    for (let s = 1; s <= 3; s++) {
      if (team[s]) payload.team.push({ slot: s, heroId: team[s] });
    }
    await apiPost(`${API}/api/team`, payload);
    renderTeamList();
    close();
  }

  function open() {
    modal.style.display = 'block';
    renderModal();
  }

  function close() {
    modal.style.display = 'none';
  }

  openBtn?.addEventListener('click', async () => { await refresh(); open(); });
  saveBtn?.addEventListener('click', save);
  closeBtn?.addEventListener('click', close);

  return { refresh, renderTeamList };
}
