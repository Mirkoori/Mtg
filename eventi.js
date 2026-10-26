'use strict';
/* Eventi (inseriti a mano) e negozi vicini (OpenStreetMap). */
const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
let toastT = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2400); }
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dayDiff = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
const safeUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { return new URL(u).href; } catch (e) { return ''; } };

const RECS = [
  { title: 'Modena Nerd', place: 'ModenaFiere, Modena', type: 'Fiera', note: 'Di solito a settembre. Da verificare.', link: 'https://www.google.com/search?q=Modena+Nerd' },
];

// ---------- eventi
let EV = jget('mtg_events', []);
const saveEv = () => store.set('mtg_events', JSON.stringify(EV));
function evHtml(e) {
  const d = new Date(e.date + 'T12:00:00'), diff = dayDiff(e.date);
  const cd = diff === 0 ? 'oggi' : diff === 1 ? 'domani' : diff > 1 ? 'tra ' + diff + ' giorni' : '';
  const link = safeUrl(e.link);
  return '<div class="ev"><div class="dt"><b>' + d.getDate() + '</b><span>' + d.toLocaleDateString('it-IT', { month: 'short' }) + '</span></div><div><div class="t">' + esc(e.title) + (cd ? '<span class="cd">' + cd + '</span>' : '') + '</div>' +
    '<div class="s"><span class="tag">' + esc(e.type || 'Altro') + '</span>' + (e.time ? esc(e.time) + ' · ' : '') + esc(e.place || '') + (link ? ' · <a href="' + esc(link) + '" target="_blank" rel="noopener" style="color:#e6bd6a">link</a>' : '') + '</div></div>' +
    '<button class="secondary" data-del="' + esc(e.id) + '" style="background:transparent;color:#e6bd6a;padding:4px 10px" aria-label="Elimina">&times;</button></div>';
}
function renderEv() {
  const up = EV.filter(e => dayDiff(e.date) >= 0).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const past = EV.filter(e => dayDiff(e.date) < 0).sort((a, b) => b.date.localeCompare(a.date));
  $('evList').innerHTML = up.map(evHtml).join('') || '<div class="msg">Nessun evento in programma. Aggiungine uno qui sotto.</div>';
  $('pastBox').hidden = !past.length; $('pastSum').textContent = 'Eventi passati (' + past.length + ')'; $('pastList').innerHTML = past.map(evHtml).join('');
}
$('eSave').onclick = () => {
  const title = $('eTitle').value.trim(), date = $('eDate').value;
  if (!title || !date) { $('eMsg').className = 'msg err'; $('eMsg').textContent = 'Servono almeno nome e data.'; return; }
  EV.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: title, date: date, time: $('eTime').value, type: $('eType').value, place: $('ePlace').value.trim(), link: safeUrl($('eLink').value) });
  saveEv(); ['eTitle', 'eDate', 'eTime', 'ePlace', 'eLink'].forEach(i => { $(i).value = ''; }); $('eMsg').className = 'msg'; $('eMsg').textContent = ''; $('addBox').open = false; renderEv(); toast('Evento salvato');
};
document.addEventListener('click', e => {
  const del = e.target.closest('[data-del]'); if (del) { if (!confirm('Eliminare questo evento?')) return; EV = EV.filter(x => x.id !== del.dataset.del); saveEv(); renderEv(); return; }
  const rec = e.target.closest('[data-rec]'); if (rec) {
    const r = RECS[+rec.dataset.rec]; $('addBox').open = true; $('eTitle').value = r.title; $('ePlace').value = r.place; $('eType').value = r.type; $('eLink').value = r.link; $('eDate').focus(); $('addBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Scegli la data e salva');
  }
});
$('recs').innerHTML = RECS.map((r, i) => '<div class="rec"><div><b>' + esc(r.title) + '</b><div class="msg">' + esc(r.place) + ' · ' + esc(r.note) + ' <a href="' + esc(r.link) + '" target="_blank" rel="noopener" style="color:#e6bd6a">cerca</a></div></div><button data-rec="' + i + '">Aggiungi</button></div>').join('');

// ---------- negozi vicini
const km = (a, b) => { const R = 6371, rad = x => x * Math.PI / 180, dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
async function getJson(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error('errore ' + r.status); return r.json(); }
async function geocode(q) {
  const d = await getJson('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=it&q=' + encodeURIComponent(q));
  if (!d.length) return null; return { lat: +d[0].lat, lon: +d[0].lon, name: String(d[0].display_name || q).split(',').slice(0, 2).join(',') };
}
async function findShops(place, radiusKm) {
  const key = 'mtg_shops_' + place.lat.toFixed(2) + '_' + place.lon.toFixed(2) + '_' + radiusKm, c = jget(key, null);
  if (c && Date.now() - c.t < 24 * 3600 * 1000) return c.v;
  const r = radiusKm * 1000, a = '(around:' + r + ',' + place.lat + ',' + place.lon + ')';
  const q = '[out:json][timeout:25];(nwr["shop"~"^(games|collector|trade|hobby)$"]' + a + ';nwr["shop"~"^(books|toys|video_games)$"]["name"~"magic|fumett|comic|nerd|game|gioc|card|carte|hobby|tcg",i]' + a + ';);out center 120;';
  const d = await getJson('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const seen = new Set(), list = [];
  (d.elements || []).forEach(e => {
    const t = e.tags || {}, lat = e.lat || (e.center && e.center.lat), lon = e.lon || (e.center && e.center.lon); if (!t.name || lat == null) return;
    const k = t.name.toLowerCase() + '|' + lat.toFixed(3); if (seen.has(k)) return; seen.add(k);
    const addr = [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
    list.push({ n: t.name, lat: lat, lon: lon, addr: addr, web: t.website || t['contact:website'] || '', oh: t.opening_hours || '', km: km(place, { lat: lat, lon: lon }) });
  });
  list.sort((x, y) => x.km - y.km);
  store.set(key, JSON.stringify({ t: Date.now(), v: list })); return list;
}
function renderShops(list, place) {
  $('pMsg').className = 'msg'; $('pMsg').textContent = list.length ? list.length + ' negozi trovati vicino a ' + place.name + '.' : 'Nessun negozio trovato in questo raggio: prova ad allargarlo.';
  $('shops').innerHTML = list.slice(0, 30).map(s => { const w = safeUrl(s.web);
    return '<div class="shop"><div class="km">' + (s.km < 10 ? s.km.toFixed(1) : Math.round(s.km)) + '<small>km</small></div><div><b>' + esc(s.n) + '</b><div class="msg">' + esc(s.addr || '') + '</div>' + (s.oh ? '<div class="msg">Orari: ' + esc(s.oh) + '</div>' : '') +
      '<div class="msg"><a href="https://www.google.com/maps/dir/?api=1&destination=' + s.lat + ',' + s.lon + '" target="_blank" rel="noopener">Indicazioni</a>' + (w ? ' · <a href="' + esc(w) + '" target="_blank" rel="noopener">Sito</a>' : '') + '</div></div></div>'; }).join('');
}
async function search(place) {
  store.set('mtg_place', JSON.stringify(place)); $('pCity').value = place.name.split(',')[0];
  $('pMsg').className = 'msg'; $('pMsg').textContent = 'Cerco i negozi…'; $('shops').innerHTML = ''; $('pFind').disabled = true; $('pGeo').disabled = true;
  try { renderShops(await findShops(place, +$('pKm').value), place); }
  catch (e) { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Non riesco a cercare ora (' + (e.message || e) + '). Riprova tra poco.'; }
  finally { $('pFind').disabled = false; $('pGeo').disabled = false; }
}
$('pFind').onclick = async () => {
  const q = $('pCity').value.trim(); if (!q) { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Scrivi una città.'; return; }
  $('pMsg').className = 'msg'; $('pMsg').textContent = 'Cerco il luogo…';
  try { const p = await geocode(q); if (!p) { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Luogo non trovato.'; return; } await search(p); }
  catch (e) { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Non riesco a cercare il luogo ora. Riprova tra poco.'; }
};
$('pGeo').onclick = () => {
  if (!navigator.geolocation) { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Il tuo browser non dà la posizione: scrivi la città.'; return; }
  $('pMsg').className = 'msg'; $('pMsg').textContent = 'Chiedo la posizione…';
  navigator.geolocation.getCurrentPosition(p => search({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'la tua posizione' }), () => { $('pMsg').className = 'msg err'; $('pMsg').textContent = 'Posizione non disponibile: scrivi la città.'; }, { timeout: 10000 });
};
$('pKm').onchange = () => { const p = jget('mtg_place', null); if (p) search(p); };
renderEv();
const saved = jget('mtg_place', null); if (saved) { $('pCity').value = saved.name.split(',')[0]; search(saved); }
