'use strict';
/* Ingrandimento carta: tocca una miniatura per vederla grande. Tocca ancora (o Esc) per chiudere. */
(function () {
  const SEL = '.it img, .res img, .w img, .szc img, .cardx img, .zoomable';
  let ov = null;
  function big(src) { return String(src).replace('/small/', '/normal/').replace('/art_crop/', '/normal/').replace('/large/', '/normal/'); }
  function close() { if (ov) { ov.remove(); ov = null; document.body.style.overflow = ''; } }
  function open(img) {
    close();
    ov = document.createElement('div');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Carta ingrandita');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:10px;cursor:zoom-out';
    const im = document.createElement('img'); im.alt = img.alt || '';
    im.style.cssText = 'max-width:min(92vw,520px);max-height:80vh;border-radius:5%/3.6%;box-shadow:0 8px 40px rgba(0,0,0,.7);background:#222;aspect-ratio:488/680';
    im.src = img.currentSrc || img.src; // subito la miniatura, poi la versione grande
    const hi = new Image(); hi.onload = () => { if (ov && im.isConnected) im.src = hi.src; }; hi.src = big(img.currentSrc || img.src);
    ov.appendChild(im);
    if (img.alt) { const t = document.createElement('div'); t.textContent = img.alt; t.style.cssText = 'color:#f2e8d0;font:600 15px/1.3 system-ui,sans-serif;text-align:center'; ov.appendChild(t); }
    ov.onclick = close; document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  }
  document.addEventListener('click', ev => {
    let img = ev.target.closest && ev.target.closest(SEL); if (!img && ev.target.closest) { const w = ev.target.closest('.szc'); if (w) img = w.querySelector('img'); } if (!img || img.tagName !== 'IMG' || !img.src || img.hidden) return;
    if (/\.svg(\?|$)/.test(img.src) || img.closest('.set')) return; // icone, non carte
    ev.preventDefault(); ev.stopPropagation(); open(img);
  }, true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
})();
