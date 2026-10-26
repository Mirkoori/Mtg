'use strict';
/* Home: riepilogo personale, mazzi, carte preziose e novita' da Scryfall. */
const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
const money = v => (v || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: v >= 100 ? 0 : 2 });
const idb = (() => {
  const ready = new Promise(res => { try { const r = indexedDB.open('mtgcol', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); } });
  return { async get(k) { const d = await ready; if (!d) return undefined; return new Promise(res => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } }); } };
})();
const art = u => u ? String(u).replace(/\/(small|normal|large|png|border_crop)\//, '/art_crop/') : '';
const IMG_FALL = "this.onerror=null;this.src=this.dataset.f";

function greeting() {
  const h = new Date().getHours();
  $('hello').textContent = h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 19 ? 'Buon pomeriggio' : 'Buonasera';
}
function renderDecks() {
  const decks = jget('mtg_decks', []), cards = jget('mtg_cards', {});
  const html = decks.map(d => {
    const list = d.cards || [], n = list.filter(e => e.section !== 'side').reduce((a, e) => a + (e.qty || 1), 0);
    const pick = list.find(e => e.section === 'commander' && cards[e.id]) || list.filter(e => cards[e.id] && !/Land/.test(cards[e.id].type || '')).sort((a, b) => (cards[b.id].cmc || 0) - (cards[a.id].cmc || 0))[0];
    const c = pick && cards[pick.id], full = c && (c.imgBig || c.img || '');
    const fmt = (d.format || '').charAt(0).toUpperCase() + (d.format || '').slice(1);
    return '<a class="deck" href="mazzi.html">' + (full ? '<img loading="lazy" src="' + esc(art(full)) + '" data-f="' + esc(full) + '" onerror="' + IMG_FALL + '" alt="">' : '') +
      '<div class="t"><b>' + esc(d.name || 'Mazzo') + '</b><span>' + esc(fmt) + ' · ' + n + ' carte</span></div></a>';
  });
  html.push('<a class="deck new" href="mazzi.html"><div>+ Nuovo mazzo<br><small style="font-weight:400;color:#c3aa80">con il coach che ti guida</small></div></a>');
  $('decks').innerHTML = html.join('');
}
async function renderCollection() {
  let entries = await idb.get('entries'), cards = (await idb.get('cards')) || {}, it = (await idb.get('it')) || {};
  if (!entries || !entries.length) entries = jget('mtg_entries', []);
  const have = (entries || []).filter(e => cards[e.key]);
  const sell = jget('mtg_sell_list', {}), nSell = Object.keys(sell).reduce((a, k) => a + (sell[k].n || 0) + (sell[k].f || 0), 0);
  const decks = jget('mtg_decks', []);
  if (nSell) { $('nSell').hidden = false; $('nSell').textContent = nSell; }
  if (!have.length) {
    $('stats').innerHTML = '<div class="stat"><b>' + decks.length + '</b><span>mazzi</span></div>';
    $('lead').innerHTML = 'Carica il file della tua collezione per vedere qui carte e valore.';
    $('top').parentNode.hidden = true;
    return;
  }
  const copies = have.reduce((a, e) => a + e.qty, 0), val = have.reduce((a, e) => { const c = cards[e.key]; return a + (e.qty - (e.foilQty || 0)) * (c.eur || 0) + (e.foilQty || 0) * (c.eurFoil || c.eur || 0); }, 0);
  $('stats').innerHTML = [[copies, 'carte'], [money(val), 'valore'], [decks.length, 'mazzi'], [nSell, 'da vendere']].map(x => '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>').join('');
  const best = have.map(e => { const c = cards[e.key]; return { c: c, p: (e.foilQty && c.eurFoil > c.eur) ? c.eurFoil : (c.eur || 0) }; }).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 12);
  $('topBlk').hidden = !best.length;
  $('top').innerHTML = best.map(x => { const t = it[x.c.id]; const nm = (t && t[0]) || x.c.name_it || x.c.name;
    return '<a class="cardx" href="collezione.html"><img loading="lazy" src="' + esc(x.c.imgBig || x.c.img) + '" alt="' + esc(nm) + '"><div class="c">' + esc(nm) + '<b>' + money(x.p) + '</b></div></a>'; }).join('');
}
const dayDiff = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 86400000);
const SET_OK = ['core', 'expansion', 'commander', 'masters', 'draft_innovation', 'starter', 'funny'];
function renderNews(n) {
  const sets = (n.sets || []).filter(s => !s.digital && SET_OK.indexOf(s.set_type) >= 0 && s.released_at);
  const up = sets.filter(s => dayDiff(s.released_at) >= 0).sort((a, b) => a.released_at.localeCompare(b.released_at)).slice(0, 6);
  const past = sets.filter(s => dayDiff(s.released_at) < 0).sort((a, b) => b.released_at.localeCompare(a.released_at)).slice(0, 3);
  const card = (s, isUp) => { const d = dayDiff(s.released_at); const dt = new Date(s.released_at + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    return '<a class="set" href="' + esc(s.scryfall_uri || '#') + '" target="_blank" rel="noopener"><img src="' + esc(s.icon_svg_uri || '') + '" alt="">' +
      '<b>' + esc(s.name) + '</b><div class="d">' + dt + '</div><span class="cd' + (isUp ? '' : ' past') + '">' + (isUp ? (d === 0 ? 'esce oggi' : d === 1 ? 'domani' : 'tra ' + d + ' giorni') : 'uscita') + '</span></a>'; };
  $('sets').innerHTML = up.map(s => card(s, true)).concat(past.map(s => card(s, false))).join('') || '<div class="empty">Nessuna novit&agrave; al momento.</div>';
  const sp = (n.spoil || []).filter(c => c.image_uris || (c.card_faces && c.card_faces[0].image_uris)).slice(0, 14);
  $('spoil').innerHTML = sp.map(c => { const iu = c.image_uris || c.card_faces[0].image_uris;
    return '<a class="cardx" href="' + esc(c.scryfall_uri || '#') + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(iu.normal || iu.small) + '" alt="' + esc(c.name) + '"><div class="c">' + esc(c.name) + '<span style="color:#9c8460;font-size:12px">' + esc(c.set_name || '') + '</span></div></a>'; }).join('') || '<div class="empty">Nessuna carta da mostrare.</div>';
}
async function loadNews() {
  const c = jget('mtg_home_news', null);
  if (c && c.sets) renderNews(c);
  if (c && Date.now() - c.t < 6 * 3600 * 1000) return;
  try {
    const [s, sp] = await Promise.all([scry('/sets'), scry('/cards/search?q=' + encodeURIComponent('game:paper -is:digital') + '&order=spoiled&dir=desc&unique=cards')]);
    const n = { t: Date.now(), sets: (s.data || []).map(x => ({ name: x.name, code: x.code, released_at: x.released_at, set_type: x.set_type, digital: x.digital, icon_svg_uri: x.icon_svg_uri, scryfall_uri: x.scryfall_uri })), spoil: (sp.data || []).slice(0, 16).map(x => ({ name: x.name, set_name: x.set_name, scryfall_uri: x.scryfall_uri, image_uris: x.image_uris && { small: x.image_uris.small, normal: x.image_uris.normal }, card_faces: x.card_faces && x.card_faces[0] && x.card_faces[0].image_uris ? [{ image_uris: { small: x.card_faces[0].image_uris.small, normal: x.card_faces[0].image_uris.normal } }] : undefined })) };
    store.set('mtg_home_news', JSON.stringify(n)); renderNews(n);
  } catch (e) {
    if (!c) { $('sets').innerHTML = '<div class="empty">Novit&agrave; non disponibili ora. Riprova pi&ugrave; tardi.</div>'; $('spoil').innerHTML = ''; $('spoilBlk').hidden = true; }
  }
}
function renderEvents() {
  const today = new Date().toISOString().slice(0, 10), now = new Date(today + 'T12:00:00');
  const up = jget('mtg_events', []).filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const card = e => { const d = Math.round((new Date(e.date + 'T12:00:00') - now) / 86400000), dt = new Date(e.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
    return '<a class="evc" href="eventi.html"><div class="dd">' + dt + '</div><b>' + esc(e.title) + '</b><div class="pl">' + esc(e.place || e.type || '') + '</div><span class="cd">' + (d === 0 ? 'oggi' : d === 1 ? 'domani' : 'tra ' + d + ' giorni') + '</span></a>'; };
  $('evRail').innerHTML = up.map(card).join('') + '<a class="evc cta" href="eventi.html"><div>' + (up.length ? '+ Aggiungi evento' : 'Aggiungi una fiera<br>o trova i negozi<br>vicino a te') + '</div></a>';
}
function renderConflicts() {
  const cf = Deck.conflicts(jget('mtg_decks', []), jget('mtg_cards', {}), jget('mtg_owned', {}));
  if (!cf.length) return; const b = $('conflBar'); b.hidden = false;
  b.textContent = cf.length + (cf.length === 1 ? ' carta serve' : ' carte servono') + ' in pi\u00f9 mazzi ma non ne hai abbastanza (es. ' + cf[0].name + '). Tocca per vedere.';
}
greeting(); renderConflicts(); renderEvents(); renderDecks(); renderCollection(); loadNews();
