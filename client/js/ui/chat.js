const CHANNELS = [
  { id: 'local', label: 'Local' },
  { id: 'global', label: 'Global' },
  { id: 'comercio', label: 'Comércio' },
  { id: 'guild', label: 'Guild' },
  { id: 'ajuda', label: 'Ajuda' },
];

const ACTIVE_STORAGE_KEY = 'chatActiveChannel';
const MAX_BUFFER = 200;

const chatState = {
  active: 'local',
  buffers: Object.fromEntries(CHANNELS.map(({ id }) => [id, []])),
  logElement: null,
  input: null,
  form: null,
  root: null,
};

function formatTime(date) {
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function getLabel(channel) {
  const found = CHANNELS.find((c) => c.id === channel);
  return found ? found.label : channel;
}

function renderChannel(channel) {
  if (!chatState.logElement) return;
  const buffer = chatState.buffers[channel] || [];
  chatState.logElement.innerHTML = '';
  buffer.forEach((entry) => {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.dataset.channel = entry.channel;
    if (entry.system) line.dataset.system = 'true';
    const label = getLabel(entry.channel);
    const timestamp = formatTime(new Date(entry.timestamp));
    const author = entry.author ? ` <strong>${entry.author}</strong>` : '';
    line.innerHTML = `[${timestamp}][${label}]${author} ${entry.message}`;
    chatState.logElement.appendChild(line);
  });
  chatState.logElement.scrollTop = chatState.logElement.scrollHeight;
}

function setActiveChannel(channel) {
  if (!CHANNELS.some((c) => c.id === channel)) return;
  chatState.active = channel;
  if (chatState.root) {
    chatState.root.querySelectorAll('.chat-tab').forEach((tab) => {
      const isActive = tab.dataset.channel === channel;
      tab.dataset.active = isActive ? 'true' : 'false';
      tab.setAttribute('aria-selected', String(isActive));
    });
  }
  if (chatState.input) {
    chatState.input.placeholder = `[#${getLabel(channel)}] Digite uma mensagem...`;
  }
  renderChannel(channel);
  try { localStorage.setItem(ACTIVE_STORAGE_KEY, channel); } catch (_) {}
}

function pushMessage(channel, message, { author = null, system = false } = {}) {
  if (!CHANNELS.some((c) => c.id === channel)) channel = 'local';
  const buffer = chatState.buffers[channel];
  const entry = {
    channel,
    message,
    author,
    system,
    timestamp: Date.now(),
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (chatState.active === channel) {
    renderChannel(channel);
  }
}

function handleSubmit(event) {
  event.preventDefault();
  if (!chatState.input) return;
  const text = chatState.input.value.trim();
  if (!text) return;
  const channel = chatState.active;
  pushMessage(channel, text, { author: 'Você' });
  if (typeof window.sendChat === 'function') {
    try { window.sendChat(channel, text); } catch (_) {}
  } else {
    console.log(`[chat:${channel}] ${text}`);
  }
  chatState.input.value = '';
}

function initChat(root) {
  if (!root) return;
  chatState.root = root;
  chatState.logElement = root.querySelector('.chat-log');
  chatState.input = root.querySelector('#chatInput');
  chatState.form = root.querySelector('#chatForm');
  if (chatState.form) chatState.form.addEventListener('submit', handleSubmit);
  root.querySelectorAll('.chat-tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      const channel = tab.dataset.channel;
      setActiveChannel(channel);
    });
  });
  const stored = (() => {
    try { return localStorage.getItem(ACTIVE_STORAGE_KEY); } catch (_) { return null; }
  })();
  const initial = CHANNELS.some((c) => c.id === stored) ? stored : 'local';
  setActiveChannel(initial);
  renderChannel(initial);
}

if (typeof window.sendChat !== 'function') {
  window.sendChat = function sendChat(channel, message) {
    console.log('[chat:stub]', channel, message);
  };
}

window.Chat = {
  init: initChat,
  pushMessage,
  pushLog(message, channel = chatState.active) {
    pushMessage(channel || chatState.active, message, { system: true });
  },
  switchTo: setActiveChannel,
  getState: () => ({ ...chatState, buffers: { ...chatState.buffers } }),
};

document.addEventListener('DOMContentLoaded', () => {
  const chatRoot = document.getElementById('chat');
  if (chatRoot) initChat(chatRoot);
});

export { initChat, pushMessage, setActiveChannel };
