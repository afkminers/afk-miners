// client/js/shell_resize.js
(function(){
  const shell = document.getElementById('clientShell') || document.querySelector('.stage') || document.body;
  if (!shell) return;

  const grip = document.createElement('div');
  grip.style.cssText = `
    position:absolute; left:0; right:0; bottom:-6px; height:10px; cursor:ns-resize;
    background:transparent;
  `;
  shell.style.position = shell.style.position || 'relative';
  shell.appendChild(grip);

  let dragging = false, startY=0, startH=0;
  grip.addEventListener('pointerdown', (e)=>{
    dragging = true; startY = e.clientY; startH = shell.clientHeight;
    grip.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    const dy = e.clientY - startY;
    const nh = Math.max(280, Math.min(window.innerHeight - 140, startH + dy));
    shell.style.height = nh + 'px';
    document.dispatchEvent(new Event('shell-resize'));
    if (typeof window.resizeViewport === 'function'){
      window.resizeViewport(); // deixa app.js recalcular canvas
    }
  });
  window.addEventListener('pointerup', ()=> dragging=false);
})();
