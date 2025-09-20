// client/js/ui/chat-log.js
(function () {
  const MAX_LINES = 200;
  let logBox = null;
  let tabBtn = null;

  function ensureContainer() {
    // tenta achar área de chat existente
    let shell = document.querySelector('#chat') || document.querySelector('#chatbox') || null;

    // se não existir, cria um bloco básico flutuante
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'chat';
      Object.assign(shell.style, {
        position: 'absolute',
        left: '8px', bottom: '8px', width: '340px', height: '180px',
        background: 'rgba(12,12,16,0.75)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px', padding: '6px', fontFamily: 'monospace',
        color: '#ddd', zIndex: 1000, overflow: 'hidden', backdropFilter: 'blur(2px)'
      });
      document.body.appendChild(shell);
    }

    // barra de abas mínima (Default / Global / Log)
    let tabs = shell.querySelector('.tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'tabs';
      Object.assign(tabs.style, { display: 'flex', gap: '6px', marginBottom: '6px' });
      shell.prepend(tabs);

      const makeBtn = (label, id) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.tab = id;
        Object.assign(b.style, {
          background: 'rgba(255,255,255,0.08)', color: '#eee', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px'
        });
        b.addEventListener('click', () => showTab(id));
        return b;
      };

      tabs.appendChild(makeBtn('Default', 'default'));
      tabs.appendChild(makeBtn('Global',  'global'));
      tabBtn = makeBtn('Log',     'log');
      Object.assign(tabBtn.style, { background: '#1f2937', borderColor: '#374151' });
      tabs.appendChild(tabBtn);
    }

    // área de linhas do Log
    logBox = shell.querySelector('#chat-log');
    if (!logBox) {
      logBox = document.createElement('div');
      logBox.id = 'chat-log';
      Object.assign(logBox.style, {
        position: 'absolute',
        left: '6px', right: '6px', top: '36px', bottom: '6px',
        overflowY: 'auto', fontSize: '12px', lineHeight: '1.35'
      });
      shell.appendChild(logBox);
    }
  }

  function showTab(id) {
    // neste snippet, apenas garantimos que o Log fica visível;
    // se você já tiver múltiplos painéis, ajuste aqui.
    if (id === 'log') {
      if (logBox) logBox.style.display = 'block';
    } else {
      if (logBox) logBox.style.display = 'none';
    }
  }

  function push(line, { color = '#d1fae5' } = {}) {
    ensureContainer();
    const row = document.createElement('div');
    row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
    row.style.color = color;
    logBox.appendChild(row);

    while (logBox.children.length > MAX_LINES) logBox.firstChild.remove();
    logBox.scrollTop = logBox.scrollHeight;

    // feedback visual: “pisca” o botão da aba
    if (tabBtn) {
      tabBtn.style.boxShadow = '0 0 0 2px rgba(34,197,94,0.6)';
      setTimeout(() => { tabBtn.style.boxShadow = ''; }, 400);
    }
  }

  // API pública
  window.Chat = window.Chat || {};
  window.Chat.pushLog = push;

  // inicia mostrando a aba Log
  ensureContainer();
  showTab('log');
})();
