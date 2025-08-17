export function cap(s){ if(!s) return '—'; return s.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()); }
export function play(el){ if(el&&el.src){ el.currentTime=0; el.play().catch(()=>{}); } }
export function flash(flashEl){ flashEl.classList.add('show'); setTimeout(()=>flashEl.classList.remove('show'),140); }
