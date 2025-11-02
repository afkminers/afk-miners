// client/js/ui/emoji.js
// Lightweight emoji parser that converts :codes: into unicode characters
// while keeping the original message text untouched in storage.

const EMOJI_MAP = new Map([
  ['smile', '😄'],
  ['grin', '😁'],
  ['joy', '😂'],
  ['laugh', '😆'],
  ['wink', '😉'],
  ['blush', '😊'],
  ['slight_smile', '🙂'],
  ['hugging', '🤗'],
  ['thinking', '🤔'],
  ['cry', '😢'],
  ['sob', '😭'],
  ['angry', '😠'],
  ['rage', '😡'],
  ['astonished', '😲'],
  ['scream', '😱'],
  ['skull', '💀'],
  ['party', '🥳'],
  ['tada', '🎉'],
  ['star', '⭐'],
  ['sparkles', '✨'],
  ['fire', '🔥'],
  ['thumbsup', '👍'],
  ['thumbs_up', '👍'],
  ['thumbsdown', '👎'],
  ['thumbs_down', '👎'],
  ['clap', '👏'],
  ['pray', '🙏'],
  ['muscle', '💪'],
  ['ok_hand', '👌'],
  ['heart', '❤️'],
  ['blue_heart', '💙'],
  ['green_heart', '💚'],
  ['purple_heart', '💜'],
  ['yellow_heart', '💛'],
  ['black_heart', '🖤'],
  ['white_heart', '🤍'],
  ['broken_heart', '💔'],
  ['100', '💯'],
  ['eyes', '👀'],
  ['zzz', '💤'],
  ['sunglasses', '😎'],
  ['cool', '😎'],
  ['poop', '💩'],
]);

const CODE_PATTERN = /:([a-z0-9_+-]{2,}):/gi;

function resolveEmoji(code) {
  if (!code) return null;
  const normalized = code.toLowerCase();
  if (EMOJI_MAP.has(normalized)) {
    return EMOJI_MAP.get(normalized);
  }
  return null;
}

function appendTextNode(target, text) {
  if (!text) return;
  target.appendChild(document.createTextNode(text));
}

function appendEmojiTokens(target, value) {
  if (!value) return;
  let lastIndex = 0;
  let match;
  CODE_PATTERN.lastIndex = 0;
  while ((match = CODE_PATTERN.exec(value))) {
    const [raw, code] = match;
    const start = match.index;
    if (start > lastIndex) {
      appendTextNode(target, value.slice(lastIndex, start));
    }
    const emoji = resolveEmoji(code);
    if (emoji) {
      appendTextNode(target, emoji);
    } else {
      appendTextNode(target, raw);
    }
    lastIndex = start + raw.length;
  }
  if (lastIndex < value.length) {
    appendTextNode(target, value.slice(lastIndex));
  }
}

export function renderRichText(target, text) {
  if (!target) return;
  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
  const str = String(text ?? '');
  if (!str) return;
  const lines = str.split(/\r?\n|\r/g);
  for (let i = 0; i < lines.length; i += 1) {
    appendEmojiTokens(target, lines[i]);
    if (i < lines.length - 1) {
      target.appendChild(document.createElement('br'));
    }
  }
}

export function getEmojiFromCode(code) {
  return resolveEmoji(code);
}

