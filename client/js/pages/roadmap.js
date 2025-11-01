// client/js/pages/roadmap.js
import { initPageChrome } from './common-nav.js';
import { i18n } from '../i18n/core.js';

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
}

function setupForm() {
  const form = document.getElementById('roadmapForm');
  const feedback = document.querySelector('.form-feedback');
  if (!form || !feedback) return;

  function setFeedback(key, type) {
    feedback.dataset.i18nKey = key || '';
    if (key) {
      feedback.textContent = i18n.t(key);
    } else {
      feedback.textContent = '';
    }
    feedback.classList.remove('success', 'error');
    if (type) {
      feedback.classList.add(type);
    }
  }

  function refreshFeedback() {
    const key = feedback.dataset.i18nKey;
    if (!key) return;
    feedback.textContent = i18n.t(key);
  }

  i18n.onChange(refreshFeedback);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = new FormData(form).get('email');
    feedback.classList.remove('success', 'error');
    if (!validateEmail(email)) {
      setFeedback('roadmap.subscribeInvalid', 'error');
      return;
    }

    setFeedback('roadmap.subscribeSuccess', 'success');
    form.reset();
  });
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

document.addEventListener('DOMContentLoaded', () => {
  i18n.onReady(() => {
    initPageChrome('/roadmap');
    setupForm();
    focusMain();
  });
});
