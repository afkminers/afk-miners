// client/js/pages/leaderboard.js
import { initPageChrome } from './common-nav.js';
import { apiGet } from '../api.js';

const SKILL_ORDER = ['distance', 'magic', 'shielding', 'sword', 'axe', 'club', 'spear'];
const SKILL_LABELS = {
  distance: 'Distance Fighting',
  magic: 'Magic Level',
  shielding: 'Shielding',
  sword: 'Sword Fighting',
  axe: 'Axe Fighting',
  club: 'Club Fighting',
  spear: 'Spear Throwing',
};

const state = {
  tab: 'players',
  limit: 25,
  offset: 0,
  period: 'all',
  skill: SKILL_ORDER[0],
  search: '',
  rows: [],
  loading: false,
  error: false,
  errorMessage: '',
  lastFetchCount: 0,
  requestToken: 0,
  nextOffset: null,
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
  const key = String(type || '').toLowerCase();
  return SKILL_LABELS[key] || toTitle(type);
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
  for (const key of SKILL_ORDER) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = SKILL_LABELS[key] || toTitle(key);
    elements.skillSelect.appendChild(opt);
  }
}

function disableSkillOption(skill) {
  if (!elements.skillSelect) return;
  const option = Array.from(elements.skillSelect.options).find((opt) => opt.value === skill);
  if (option) {
    option.disabled = true;
    option.selected = false;
  }
}

function pickFirstEnabledSkill() {
  if (!elements.skillSelect) return null;
  const option = Array.from(elements.skillSelect.options).find((opt) => !opt.disabled);
  return option ? option.value : null;
}

function bindEvents() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTab = btn.getAttribute('data-tab');
      if (!nextTab || nextTab === state.tab) return;
      state.tab = nextTab;
      state.offset = 0;
      state.error = false;
      state.errorMessage = '';
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
      const next = Number(elements.limitSelect.value) || 25;
      state.limit = next;
      state.offset = 0;
      fetchLeaderboard();
    });
  }

  if (elements.skillSelect) {
    elements.skillSelect.addEventListener('change', () => {
      const value = elements.skillSelect.value || SKILL_ORDER[0];
      state.skill = value;
      state.offset = 0;
      fetchLeaderboard();
    });
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', () => {
      const value = elements.searchInput.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = value;
        state.offset = 0;
        fetchLeaderboard();
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
      if (state.nextOffset == null) return;
      state.offset = state.nextOffset;
      fetchLeaderboard();
    });
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

function renderTable() {
  if (!elements.tbody) return;

  if (state.loading) {
    setLoadingRow('Loading leaderboard…');
    return;
  }

  if (state.error) {
    setLoadingRow(state.errorMessage || 'Leaderboard data is unavailable right now.');
    return;
  }

  const rows = state.rows;
  if (!rows.length) {
    setLoadingRow('No results found.');
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');

    const rankTd = document.createElement('td');
    const rank = row.rank != null ? row.rank : state.offset + index + 1;
    rankTd.textContent = Number.isFinite(rank) ? String(rank) : '—';
    rankTd.classList.add('col-rank');
    if (Number.isFinite(rank) && rank <= 3) {
      rankTd.classList.add('rank-medal', `rank-${rank}`);
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
      const parts = [`${label}: ${row.skillValue}`];
      if (row.triesProgress != null && row.triesProgress !== '') {
        parts.push(`Progress ${row.triesProgress}`);
      }
      skillTd.textContent = parts.join(' • ');
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
    elements.status.textContent = state.errorMessage || 'Leaderboard data is unavailable right now.';
    elements.status.classList.add('error');
    return;
  }

  const rows = state.rows;
  if (!rows.length) {
    elements.status.textContent = 'No results for the current filters.';
    return;
  }

  const firstRank = state.offset + 1;
  const lastRank = state.offset + rows.length;
  elements.status.textContent = `Showing ranks ${firstRank} – ${lastRank}`;
}

function renderRange() {
  if (!elements.range) return;
  const rows = state.rows;
  if (!rows.length) {
    elements.range.textContent = '—';
    return;
  }
  const first = state.offset + 1;
  const last = state.offset + rows.length;
  elements.range.textContent = `Rank ${first} – ${last}`;
}

function renderPager() {
  if (elements.prev) {
    elements.prev.disabled = state.loading || state.offset === 0;
  }
  if (elements.next) {
    const noMore = state.nextOffset == null;
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

function renderTabs() {
  elements.tabButtons.forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    const isActive = tab === state.tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  elements.panel?.classList.toggle('show-skill', state.tab === 'skills');

  if (state.tab === 'skills' && elements.skillSelect) {
    const current = Array.from(elements.skillSelect.options).find(
      (opt) => opt.value === state.skill && !opt.disabled
    );
    if (!current) {
      const fallback = pickFirstEnabledSkill();
      if (fallback) {
        state.skill = fallback;
        updateToolbar();
      }
    }
  }
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

async function fetchLeaderboard() {
  state.requestToken += 1;
  const token = state.requestToken;
  state.loading = true;
  state.error = false;
  state.errorMessage = '';
  render();

  try {
    const params = new URLSearchParams();
    const limit = Number(state.limit);
    state.limit = [25, 50, 100].includes(limit) ? limit : 25;
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));
    if (state.search) {
      params.set('query', state.search);
    }
    if (state.tab === 'skills') {
      params.set('skill', state.skill);
    }

    const url = `/api/leaderboard/${state.tab}?${params.toString()}`;
    const data = await apiGet(url);
    if (token !== state.requestToken) return; // stale response

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const responseLimit = Number(data?.limit);
    const responseOffset = Number(data?.offset);
    const nextOffset = data?.nextOffset;

    state.limit = [25, 50, 100].includes(responseLimit) ? responseLimit : state.limit;
    state.offset = Number.isFinite(responseOffset) && responseOffset >= 0 ? responseOffset : state.offset;
    state.nextOffset = typeof nextOffset === 'number' && Number.isFinite(nextOffset) ? nextOffset : null;
    state.rows = rows.map((row, index) => ({
      ...row,
      rank: state.offset + index + 1,
      level: row.level != null ? Number(row.level) : null,
      skillValue:
        row.skillValue != null
          ? Number(row.skillValue)
          : row.value != null
          ? Number(row.value)
          : null,
      triesProgress:
        row.triesProgress != null ? row.triesProgress : row.tries_progress ?? null,
      updatedAt: row.updatedAt || row.updated_at || null,
    }));
    state.lastFetchCount = state.rows.length;
    state.loading = false;
    state.error = false;
    state.errorMessage = '';
    render();
  } catch (err) {
    if (token !== state.requestToken) return;
    console.error('[leaderboard] fetch failed:', err);
    const isSkillUnavailable =
      state.tab === 'skills' && err?.status === 400 && err?.payload?.error === 'skill not available';

    if (isSkillUnavailable) {
      disableSkillOption(state.skill);
      const next = pickFirstEnabledSkill();
      if (next) {
        state.skill = next;
        state.offset = 0;
        updateToolbar();
        state.loading = false;
        fetchLeaderboard();
        return;
      }
    }

    state.rows = [];
    state.lastFetchCount = 0;
    state.loading = false;
    state.error = true;
    const payloadError = err?.payload?.error;
    state.errorMessage =
      payloadError === 'skill not available'
        ? 'This skill leaderboard is not available yet.'
        : payloadError || err?.message || 'Leaderboard data is unavailable right now.';
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
