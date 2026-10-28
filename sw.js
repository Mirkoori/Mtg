'use strict';
/* Service worker: i file dell'app si prendono SEMPRE dalla rete (cosi' gli aggiornamenti arrivano subito)
   e restano in cache solo come riserva quando non c'e' connessione. Le immagini delle carte vengono tenute in cache. */
const APP = 'mtg-app-v1', IMG = 'mtg-img-v1', IMG_MAX = 400;
const SHELL = ['./', 'index.html', 'collezione.html', 'mazzi.html', 'prova.html', 'carrello.html', 'vendi.html', 'desideri.html', 'eventi.html', 'segnapunti.html', 'theme.css', 'nav.js', 'zoom.js', 'manifest.webmanifest', 'config.js', 'sync.js', 'scry.js', 'core.js', 'deckcore.js', 'strategy.js', 'app.js', 'home.js', 'collezione.js', 'setcomp.js', 'mazzi.js', 'autodeck.js', 'prova.js', 'vendi.js', 'desideri.js', 'refresh.js', 'eventi.js', 'segnapunti.js', 'icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(cache) { const ks = await cache.keys(); if (ks.length > IMG_MAX) await Promise.all(ks.slice(0, ks.length - IMG_MAX).map(k => cache.delete(k))); }
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(APP).then(ca => ca.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: false }).then(m => m || caches.match(req, { ignoreSearch: true })).then(m => m || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
    return;
  }
  if (u.host === 'cards.scryfall.io' || u.host === 'svgs.scryfall.io') {
    e.respondWith(caches.open(IMG).then(async ca => { const m = await ca.match(req); if (m) return m; try { const r = await fetch(req); if (r.ok || r.type === 'opaque') { ca.put(req, r.clone()); trim(ca); } return r; } catch (err) { return Response.error(); } }));
  }
});
