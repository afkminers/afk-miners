const docEl = typeof document !== 'undefined' ? document.documentElement : null;
const bodyEl = typeof document !== 'undefined' ? document.body : null;

function computeFlags() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const touchCap = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const hoverNone = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
  const smallViewport = typeof window !== 'undefined'
    ? Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 900
    : false;
  const uaMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

  const isMobile = !!(coarse || hoverNone || touchCap) || uaMobile || smallViewport;
  return { isMobile, coarse, hoverNone, touchCap, smallViewport };
}

export const RuntimeFlags = computeFlags();
export const IS_MOBILE = RuntimeFlags.isMobile;

if (RuntimeFlags.isMobile) {
  if (docEl) docEl.classList.add('is-mobile');
  if (bodyEl) bodyEl.classList.add('is-mobile');
}

if (!bodyEl && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (RuntimeFlags.isMobile && document.body) {
      document.body.classList.add('is-mobile');
    }
  }, { once: true });
}

if (typeof window !== 'undefined') {
  window.RuntimeFlags = Object.assign({}, window.RuntimeFlags || {}, RuntimeFlags);
  window.IS_MOBILE = RuntimeFlags.isMobile;
}

export function refreshRuntimeFlags() {
  const flags = computeFlags();
  Object.assign(RuntimeFlags, flags);
  if (docEl) {
    if (flags.isMobile) docEl.classList.add('is-mobile');
    else docEl.classList.remove('is-mobile');
  }
  const currentBody = typeof document !== 'undefined' ? document.body : bodyEl;
  if (currentBody) {
    if (flags.isMobile) currentBody.classList.add('is-mobile');
    else currentBody.classList.remove('is-mobile');
  }
  if (!currentBody && flags.isMobile && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) document.body.classList.add('is-mobile');
    }, { once: true });
  }
  if (typeof window !== 'undefined') {
    window.RuntimeFlags = Object.assign({}, window.RuntimeFlags || {}, flags);
    window.IS_MOBILE = flags.isMobile;
  }
  return RuntimeFlags;
}
