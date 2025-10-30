// client/js/pages/leaderboard.js
import { initPageChrome } from './common-nav.js';
import { apiGet } from '../api.js';

const SKILL_OPTIONS = [
  { value: 'SWORD', label: 'Sword Fighting' },
  { value: 'AXE', label: 'Axe Fighting' },
  { value: 'CLUB', label: 'Club Fighting' },
  { value: 'DISTANCE', label: 'Distance Fighting' },
  { value: 'MAGIC', label: 'Magic Level' },
  { value: 'SHIELD', label: 'Shielding' },
  { value: 'SPEAR', label: 'Spear Throwing' },
];

const state = {
  tab: 'players',
  limit: 25,
  offset: 0,
  period: 'all',
  skill: SKILL_OPTIONS[0].value,
  search: '',
  rows: [],
  loading: false,
  error: null,
  lastFetchCount: 0,
  requestToken: 0,
};

const elements = {
  panel: document.querySelector('.leaderboard-panel'),
  tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
  periodButtons: Array.from(document.querySelectorAll('.period-btn')),
  limitSelect: document.getElementById('lbLimit'),
  skillSelect: document.getElementById('lbSkill'),
  searchInput: document.getElementById('lbSearch'),
  table: document.getElementById('leaderboardTable'),
  tbody: document.getElementById('leaderboardBody'),
  status: document.getElementById('lbStatus'),
  prev: document.getElementById('lbPrev'),
  next: document.getElementById('lbNext'),
  range: document.getElementById('lbRange'),
};

let searchTimer = null;

function toTitle(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatClass(value) {
  const label = toTitle(value);
  return label || 'Unknown';
}

function formatRarity(value) {
  const label = toTitle(value);
  return label || '—';
}

function formatSkillLabel(type) {
  const option = SKILL_OPTIONS.find((opt) => opt.value === type);
  return option ? option.label : toTitle(type);
}

function formatUpdated(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) {
    const mins = Math.round(diff / minute);
    return `${mins}m ago`;
  }
  if (diff < day) {
    const hours = Math.round(diff / hour);
    return `${hours}h ago`;
  }
  const days = Math.round(diff / day);
  if (days <= 7) return `${days}d ago`;
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function populateSkillOptions() {
  if (!elements.skillSelect) return;
  elements.skillSelect.innerHTML = '';
  for (const option of SKILL_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    elements.skillSelect.appendChild(opt);
  }
}

function bindEvents() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTab = btn.getAttribute('data-tab');
      if (!nextTab || nextTab === state.tab) return;
      state.tab = nextTab;
      state.offset = 0;
      state.error = null;
      updateToolbar();
      renderTabs();
      fetchLeaderboard();
    });
  });

  elements.periodButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const period = btn.getAttribute('data-period') || 'all';
      if (period === state.period) return;
      state.period = period;
      state.offset = 0;
      renderPeriods();
      fetchLeaderboard();
    });
  });

  if (elements.limitSelect) {
    elements.limitSelect.addEventListener('change', () => {
      state.limit = Number(elements.limitSelect.value) || 25;
      state.offset = 0;
      fetchLeaderboard();
    });
  }

  if (elements.skillSelect) {
    elements.skillSelect.addEventListener('change', () => {
      state.skill = elements.skillSelect.value || SKILL_OPTIONS[0].value;
      state.offset = 0;
      fetchLeaderboard();
    });
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', () => {
      const value = elements.searchInput.value.trim().toLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = value;
        render();
      }, 180);
    });
  }

  if (elements.prev) {
    elements.prev.addEventListener('click', () => {
      if (state.offset === 0) return;
      state.offset = Math.max(0, state.offset - state.limit);
      fetchLeaderboard();
    });
  }

  if (elements.next) {
    elements.next.addEventListener('click', () => {
      if (state.lastFetchCount < state.limit) return;
      state.offset += state.limit;
      fetchLeaderboard();
    });
  }
}

function renderTabs() {
  elements.tabButtons.forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    const isActive = tab === state.tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  elements.panel?.classList.toggle('show-skill', state.tab === 'skills');
}

function renderPeriods() {
  elements.periodButtons.forEach((btn) => {
    const period = btn.getAttribute('data-period') || 'all';
    btn.classList.toggle('is-active', period === state.period);
  });
}

function updateToolbar() {
  if (elements.limitSelect) {
    elements.limitSelect.value = String(state.limit);
  }
  if (elements.skillSelect) {
    elements.skillSelect.value = state.skill;
  }
  if (elements.searchInput && elements.searchInput.value !== state.search) {
    elements.searchInput.value = state.search;
  }
}

function setLoadingRow(message) {
  if (!elements.tbody) return;
  const tr = document.createElement('tr');
  tr.className = 'loading';
  const td = document.createElement('td');
  td.colSpan = 8;
  td.textContent = message;
  tr.appendChild(td);
  elements.tbody.innerHTML = '';
  elements.tbody.appendChild(tr);
}

function getFilteredRows() {
  const query = state.search;
  if (!query) return state.rows.slice();
  return state.rows.filter((row) => {
    const player = String(row.playerName || '').toLowerCase();
    const hero = String(row.heroName || '').toLowerCase();
    return player.includes(query) || hero.includes(query);
  });
}

function renderTable() {
  if (!elements.tbody) return;

  if (state.loading) {
    setLoadingRow('Loading leaderboard…');
    return;
  }

  if (state.error) {
    setLoadingRow('Failed to load leaderboard.');
    return;
  }

  const rows = getFilteredRows();
  if (!rows.length) {
    setLoadingRow('No results found.');
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');

    const rankTd = document.createElement('td');
    rankTd.textContent = row.rank ? String(row.rank) : '—';
    rankTd.classList.add('col-rank');
    if (row.rank && row.rank <= 3) {
      rankTd.classList.add('rank-medal', `rank-${row.rank}`);
    }
    tr.appendChild(rankTd);

    const playerTd = document.createElement('td');
    playerTd.classList.add('col-player');
    const playerPrimary = document.createElement('span');
    playerPrimary.classList.add('primary');
    playerPrimary.textContent = row.playerName || 'Unknown';
    playerTd.appendChild(playerPrimary);
    if (row.guildName) {
      const secondary = document.createElement('span');
      secondary.classList.add('secondary');
      secondary.textContent = `Guild: ${row.guildName}`;
      playerTd.appendChild(secondary);
    }
    tr.appendChild(playerTd);

    const heroTd = document.createElement('td');
    heroTd.classList.add('col-hero');
    const heroPrimary = document.createElement('span');
    heroPrimary.classList.add('primary');
    heroPrimary.textContent = row.heroName || '—';
    heroTd.appendChild(heroPrimary);
    if (row.heroKey) {
      const secondary = document.createElement('span');
      secondary.classList.add('secondary');
      secondary.textContent = toTitle(row.heroKey);
      heroTd.appendChild(secondary);
    }
    tr.appendChild(heroTd);

    const classTd = document.createElement('td');
    const classBadge = document.createElement('span');
    classBadge.classList.add('class-badge');
    classBadge.textContent = formatClass(row.class);
    classTd.appendChild(classBadge);
    tr.appendChild(classTd);

    const rarityTd = document.createElement('td');
    const rarityBadge = document.createElement('span');
    rarityBadge.classList.add('rarity-badge');
    const rarityClass = String(row.rarity || '').toLowerCase();
    if (rarityClass) {
      rarityBadge.classList.add(`rarity-${rarityClass}`);
    }
    rarityBadge.textContent = formatRarity(row.rarity);
    rarityTd.appendChild(rarityBadge);
    tr.appendChild(rarityTd);

    const levelTd = document.createElement('td');
    levelTd.classList.add('col-level');
    levelTd.textContent = row.level != null ? String(row.level) : '—';
    tr.appendChild(levelTd);

    const skillTd = document.createElement('td');
    skillTd.classList.add('col-skill');
    if (state.tab === 'skills' && row.skillValue != null) {
      const label = formatSkillLabel(row.skillType);
      skillTd.textContent = `${label}: ${row.skillValue}`;
    } else {
      skillTd.textContent = '—';
    }
    tr.appendChild(skillTd);

    const updatedTd = document.createElement('td');
    updatedTd.textContent = formatUpdated(row.updatedAt);
    tr.appendChild(updatedTd);

    fragment.appendChild(tr);
  });

  elements.tbody.innerHTML = '';
  elements.tbody.appendChild(fragment);
}

function renderStatus() {
  if (!elements.status) return;
  elements.status.classList.remove('error', 'success');

  if (state.loading) {
    elements.status.textContent = 'Fetching latest rankings…';
    return;
  }

  if (state.error) {
    elements.status.textContent = 'Unable to load leaderboard data.';
    elements.status.classList.add('error');
    return;
  }

  const rows = getFilteredRows();
  if (!rows.length) {
    elements.status.textContent = 'No results for the current filters.';
    return;
  }

  elements.status.textContent = `Showing ${rows.length} entries`;
}

function renderRange() {
  if (!elements.range) return;
  const rows = getFilteredRows();
  if (!rows.length) {
    elements.range.textContent = '—';
    return;
  }
  const first = rows[0]?.rank;
  const last = rows[rows.length - 1]?.rank;
  if (!first || !last) {
    elements.range.textContent = '—';
    return;
  }
  elements.range.textContent = `Rank ${first} – ${last}`;
}

function renderPager() {
  if (elements.prev) {
    elements.prev.disabled = state.loading || state.offset === 0;
  }
  if (elements.next) {
    const noMore = state.lastFetchCount < state.limit;
    elements.next.disabled = state.loading || noMore;
  }
}

function render() {
  renderTabs();
  renderPeriods();
  updateToolbar();
  renderTable();
  renderStatus();
  renderRange();
  renderPager();
}

async function fetchLeaderboard() {
  state.requestToken += 1;
  const token = state.requestToken;
  state.loading = true;
  state.error = null;
  render();

  try {
    const params = new URLSearchParams();
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));
    params.set('metric', 'level');
    params.set('period', state.period);
    if (state.tab === 'skills') {
      params.set('skill', state.skill);
    }

    const url = `/api/leaderboard/${state.tab}?${params.toString()}`;
    const data = await apiGet(url);
    if (token !== state.requestToken) return; // stale response

    state.rows = Array.isArray(data) ? data.map((row) => ({
      ...row,
      rank: Number(row.rank || 0),
      level: Number(row.level || 0),
      skillValue: row.skillValue != null ? Number(row.skillValue) : null,
    })) : [];
    state.lastFetchCount = state.rows.length;
    state.loading = false;
    state.error = null;
    render();
  } catch (err) {
    if (token !== state.requestToken) return;
    console.error('[leaderboard] fetch failed:', err);
    state.rows = [];
    state.lastFetchCount = 0;
    state.loading = false;
    state.error = 'fetch-failed';
    render();
  }
}

function focusMain() {
  const main = document.getElementById('content');
  if (!main) return;
  try {
    main.focus({ preventScroll: true });
  } catch (_) {
    main.focus();
  }
}

function init() {
  initPageChrome('/leaderboard');
  populateSkillOptions();
  updateToolbar();
  bindEvents();
  renderTabs();
  renderPeriods();
  focusMain();
  fetchLeaderboard();
}

document.addEventListener('DOMContentLoaded', init);
