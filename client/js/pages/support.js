// client/js/pages/support.js
import { initPageChrome } from './common-nav.js';
import { apiPost } from '../api.js';
import { i18n } from '../i18n/core.js';

function collectFormPayload(form) {
  const fd = new FormData(form);
  return {
    name: String(fd.get('name') || '').trim(),
    email: String(fd.get('email') || '').trim(),
    subject: String(fd.get('subject') || '').trim(),
    message: String(fd.get('message') || '').trim(),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setupSupportForm() {
  const form = document.getElementById('supportForm');
  const feedback = form?.querySelector('.form-feedback');
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !feedback || !submit) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = collectFormPayload(form);

    feedback.textContent = '';
    feedback.classList.remove('success', 'error');

    if (!payload.name || !payload.email || !payload.subject || !payload.message) {
      feedback.textContent = i18n.t('support.fillAll');
      feedback.classList.add('error');
      return;
    }

    if (!isValidEmail(payload.email)) {
      feedback.textContent = i18n.t('support.invalidEmail');
      feedback.classList.add('error');
      return;
    }

    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');

    try {
      const res = await apiPost('/api/support/ticket', payload);
      if (res?.ok) {
        feedback.textContent = i18n.t('support.created');
        feedback.classList.add('success');
        form.reset();
      } else {
        throw new Error(res?.error || 'ticket-failed');
      }
    } catch (err) {
      console.error('[support] ticket error', err);
      feedback.textContent = i18n.t('support.error');
      feedback.classList.add('error');
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
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
    initPageChrome('/support');
    setupSupportForm();
    focusMain();
  });
});
