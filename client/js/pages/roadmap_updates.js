const updatesRoot = document.querySelector('[data-updates]');
const PAGE_KEY = 'roadmap';
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function formatDate(iso, lang) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const monthIndex = date.getMonth();
  const year = date.getFullYear();
  if (lang === 'pt-BR') {
    const month = MONTHS_PT[monthIndex] || '';
    return `${day} ${month} ${year}`;
  }
  const month = MONTHS_EN[monthIndex] || '';
  return `${month} ${day} ${year}`;
}

function render(posts, lang) {
  if (!updatesRoot) return;
  updatesRoot.dataset.cmsPage = PAGE_KEY;
  updatesRoot.dataset.cmsLocale = lang;
  updatesRoot.innerHTML = '';
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('news.tickerEmpty') : 'No updates yet.';
    updatesRoot.appendChild(empty);
    document.dispatchEvent(new CustomEvent('cms-posts-rendered', {
      detail: { page: PAGE_KEY, locale: lang, posts: [] },
    }));
    return;
  }

  posts.forEach((post) => {
    const article = document.createElement('article');
    article.className = 'home-news-article';
    article.dataset.cmsPostId = String(post.id);
    article.dataset.cmsPage = PAGE_KEY;
    article.dataset.cmsLocale = lang;

    const meta = document.createElement('div');
    meta.className = 'home-news-meta';

    const time = document.createElement('time');
    time.className = 'home-news-date';
    time.setAttribute('datetime', post.published_at || '');
    time.textContent = formatDate(post.published_at, lang);
    meta.appendChild(time);

    if (post.tag) {
      const badge = document.createElement('span');
      badge.className = 'home-news-badge';
      badge.textContent = post.tag;
      meta.appendChild(badge);
    }

    article.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'home-news-content';

    const title = document.createElement('h3');
    title.className = 'home-news-article-title';
    title.textContent = post.title;
    content.appendChild(title);

    const body = document.createElement('div');
    body.className = 'home-news-body';

    if (post.summary) {
      const summary = document.createElement('p');
      summary.textContent = post.summary;
      body.appendChild(summary);
    }

    if (post.body_html) {
      const extra = document.createElement('div');
      extra.innerHTML = post.body_html;
      body.appendChild(extra);
    }

    if (post.link_href) {
      const link = document.createElement('a');
      link.className = 'home-news-link';
      link.href = post.link_href;
      link.textContent = post.link_label || post.link_href;
      if (/^https?:/i.test(post.link_href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      body.appendChild(link);
    }

    content.appendChild(body);
    article.appendChild(content);
    updatesRoot.appendChild(article);
  });

  document.dispatchEvent(new CustomEvent('cms-posts-rendered', {
    detail: { page: PAGE_KEY, locale: lang, posts },
  }));
}

async function load(lang) {
  if (!updatesRoot) return;
  try {
    const res = await fetch(`/api/content/posts?page=${PAGE_KEY}&lang=${encodeURIComponent(lang)}`);
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    render(Array.isArray(data) ? data : [], lang);
  } catch (err) {
    console.warn('[roadmap-updates] failed to load posts', err);
    render([], lang);
  }
}

function currentLang() {
  if (window.i18n && typeof window.i18n.getLang === 'function') {
    return window.i18n.getLang();
  }
  const htmlLang = document.documentElement?.lang;
  return htmlLang === 'pt-BR' ? 'pt-BR' : 'en';
}

function init() {
  if (!updatesRoot) return;
  const lang = currentLang();
  load(lang);
  if (window.i18n) {
    window.i18n.onReady((readyLang) => load(readyLang));
    window.i18n.onChange((nextLang) => load(nextLang));
  }
  document.addEventListener('cms-posts-changed', (event) => {
    const detail = event?.detail || {};
    if (detail.page !== PAGE_KEY) return;
    const current = currentLang();
    if (!detail.locale || detail.locale === current) {
      load(current);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
