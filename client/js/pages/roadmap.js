// client/js/pages/roadmap.js
import { initPageChrome } from './common-nav.js';

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
}

function setupForm() {
  const form = document.getElementById('roadmapForm');
  const feedback = document.querySelector('.form-feedback');
  if (!form || !feedback) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = new FormData(form).get('email');
    feedback.classList.remove('success', 'error');
    if (!validateEmail(email)) {
      feedback.textContent = 'Please enter a valid email address to subscribe.';
      feedback.classList.add('error');
      return;
    }

    feedback.textContent = 'Thanks! We will keep you posted with the next roadmap update.';
    feedback.classList.add('success');
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
  initPageChrome('/roadmap');
  setupForm();
  focusMain();
});
