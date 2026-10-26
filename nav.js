'use strict';
/* Barra di navigazione comune: in basso su telefono, in alto su PC. */
(function () {
  var I = {
    home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M6 10v9.5h4.5v-5.5h3v5.5H18V10"/>',
    col: '<rect x="4" y="5" width="11" height="15" rx="1.8"/><path d="M9 3.2h8.6A1.9 1.9 0 0 1 19.5 5v12.5"/><path d="M7 10h5M7 13h3"/>',
    deck: '<path d="M12 3.5 20 8l-8 4.5L4 8z"/><path d="M4 12l8 4.5 8-4.5"/><path d="M4 16l8 4.5 8-4.5"/>',
    play: '<path d="M7 5l10 14M17 5 7 19"/><path d="M5.5 6.5 4 5M18.5 6.5 20 5"/>',
    shop: '<path d="M4 6h2.2l2 9.5h9.3L19 9H7.2"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>'
  };
  var T = [
    { h: 'index.html', l: 'Home', i: 'home', m: ['index.html', '', 'eventi.html'] },
    { h: 'collezione.html', l: 'Collezione', i: 'col', m: ['collezione.html'] },
    { h: 'mazzi.html', l: 'Mazzi', i: 'deck', m: ['mazzi.html'] },
    { h: 'prova.html', l: 'Gioca', i: 'play', m: ['prova.html', 'segnapunti.html'] },
    { h: 'carrello.html', l: 'Mercato', i: 'shop', m: ['carrello.html', 'vendi.html'] }
  ];
  var cur = (location.pathname.split('/').pop() || 'index.html');
  Array.prototype.forEach.call(document.querySelectorAll('main nav, body > nav'), function (n) { n.parentNode.removeChild(n); });
  var nav = document.createElement('nav');
  nav.className = 'tabbar'; nav.setAttribute('aria-label', 'Navigazione');
  nav.innerHTML = T.map(function (t) {
    var on = t.m.indexOf(cur) >= 0;
    return '<a href="' + t.h + '"' + (on ? ' class="on" aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + I[t.i] + '</svg><span>' + t.l + '</span></a>';
  }).join('');
  document.body.insertBefore(nav, document.body.firstChild);
  if (cur === 'prova.html' || cur === 'segnapunti.html') {
    var mp = document.querySelector('main');
    if (mp) {
      var sp = document.createElement('div'); sp.className = 'subnav';
      sp.innerHTML = '<a href="prova.html"' + (cur === 'prova.html' ? ' class="on"' : '') + '>Prova mazzo</a><a href="segnapunti.html"' + (cur === 'segnapunti.html' ? ' class="on"' : '') + '>Segnapunti</a>';
      mp.insertBefore(sp, mp.firstChild);
    }
  }
  if (cur === 'carrello.html' || cur === 'vendi.html') {
    var main = document.querySelector('main');
    if (main) {
      var s = document.createElement('div'); s.className = 'subnav';
      s.innerHTML = '<a href="carrello.html"' + (cur === 'carrello.html' ? ' class="on"' : '') + '>Compra (Carrello)</a><a href="vendi.html"' + (cur === 'vendi.html' ? ' class="on"' : '') + '>Vendi</a>';
      main.insertBefore(s, main.firstChild);
    }
  }
  // ---- app installabile
  var head = document.head;
  function add(tag, attrs) { var el = document.createElement(tag); Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); }); head.appendChild(el); }
  if (!document.querySelector('link[rel=manifest]')) {
    add('link', { rel: 'manifest', href: 'manifest.webmanifest' });
    add('link', { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' });
    add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'apple-mobile-web-app-title', content: 'myMTG' });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__inst = e; document.dispatchEvent(new Event('mtg-install')); });
  window.addEventListener('appinstalled', function () { window.__inst = null; document.dispatchEvent(new Event('mtg-install')); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
