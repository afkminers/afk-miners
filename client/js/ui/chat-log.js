// client/js/ui/chat-log.js
(function () {
  const MAX_LINES = 200;
  let logBox = null;
  let tabBtn = null;

  function ensureRefs() {
    if (logBox && logBox.isConnected) return true;
    logBox = document.getElementById('chatLogBox');
    tabBtn = document.getElementById('btnLog');

    if (tabBtn && !tabBtn.dataset.logClickBound) {
      tabBtn.addEventListener('click', clearHighlight);
      tabBtn.dataset.logClickBound = '1';
    }

    if (!logBox) {
      console.warn('[chat-log] Área de log não encontrada.');
      return false;
    }
    return true;
  }

  function clearHighlight() {
    if (!tabBtn) return;
    tabBtn.classList.remove('log-alert');
  }

  function push(line, { color = '#d1fae5' } = {}) {
    if (!ensureRefs()) return;

    const row = document.createElement('div');
    row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
    row.style.color = color;
    logBox.appendChild(row);

    while (logBox.children.length > MAX_LINES) {
      const first = logBox.firstChild;
      if (!first) break;
      first.remove();
    }
    logBox.scrollTop = logBox.scrollHeight;

    if (tabBtn && !tabBtn.classList.contains('active')) {
      tabBtn.classList.add('log-alert');
    }
  }

  window.Chat = window.Chat || {};
  window.Chat.pushLog = push;
  window.Chat.clearLogHighlight = clearHighlight;

  ensureRefs();
})();
