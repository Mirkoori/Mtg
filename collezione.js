'use strict';
/* Collezione: legge il CSV, recupera immagini e dati da Scryfall, filtra e raggruppa. */
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const idb = (() => {
  const mem = {};
  const ready = new Promise(res => {
    try {
      const r = indexedDB.open('mtgcol', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return {
    async get(k) {
      const d = await ready; if (!d) return mem[k];
      return new Promise(res => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } });
    },
    async set(k, v) {
      const d = await ready; if (!d) { mem[k] = v; return; }
      return new Promise(res => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); } catch (e) { res(); } });
    },
  };
})();

const C = { entries: [], cards: {}, it: {}, itSets: [], notFound: [], view: store.get('mtg_col_view') || 'grid', limit: 120, enriching: false };
const SELL = (function () { try { return JSON.parse(localStorage.getItem('mtg_sell_list')) || {}; } catch (e) { return {}; } })();
const sellN = x => { const s = SELL[x.key]; return s ? (s.n || 0) + (s.f || 0) : 0; };
function sellSave() { Object.keys(SELL).forEach(k => { const s = SELL[k]; if (!(s.n > 0) && !(s.f > 0)) delete SELL[k]; }); store.set('mtg_sell_list', JSON.stringify(SELL)); }
let TOT = {};
const MAXC = 4;
const totOf = x => TOT[cardOf(x).id] || 0;
const F = { many: false, sell: false, q: '', colors: new Set(), type: '', set: '', rar: '', foil: false, sort: 'name', group: 'none' };

const COLOR_IT = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde', M: 'Multicolore', C: 'Incolore' };
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const TYPES = [['land', /\bLand\b/, 'Terra', 'Terre'], ['creature', /\bCreature\b/, 'Creatura', 'Creature'], ['planeswalker', /Planeswalker/, 'Planeswalker', 'Planeswalker'],
  ['battle', /\bBattle\b/, 'Battaglia', 'Battaglie'], ['artifact', /\bArtifact\b/, 'Artefatto', 'Artefatti'], ['enchantment', /\bEnchantment\b/, 'Incantesimo', 'Incantesimi'],
  ['instant', /\bInstant\b/, 'Istantaneo', 'Istantanei'], ['sorcery', /\bSorcery\b/, 'Stregoneria', 'Stregonerie'], ['other', /./, 'Altro', 'Altro']];
const RARITIES = [['mythic', 'Mitica'], ['rare', 'Rara'], ['uncommon', 'Non comune'], ['common', 'Comune'], ['special', 'Speciale'], ['bonus', 'Bonus']];

let toastTimer = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200); }
const say = (id, t) => { $(id).textContent = t; };
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const cnNorm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/^0+(?=\d)/, '');
const money = v => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

// ---------- dati di una carta
const cardOf = x => C.cards[x.key];
function nameOf(x) { const c = cardOf(x); const t = C.it[c.id]; return (t && t[0]) || c.name_it || c.name; }
function typeLineOf(x) { const c = cardOf(x); const t = C.it[c.id]; return (t && t[1]) || c.type_it || c.type; }
function colorCat(c) { const n = (c.colors || []).length; return n === 0 ? 'C' : n === 1 ? c.colors[0] : 'M'; }
function typeCat(c) { const front = String(c.type || '').split('//')[0]; for (const t of TYPES) if (t[1].test(front)) return t[0]; return 'other'; }
const typeLabel = (k, plural) => { const t = TYPES.find(x => x[0] === k); return t ? t[plural ? 3 : 2] : k; };
function priceOf(x) { const c = cardOf(x); const nf = x.qty - x.foilQty; return nf * c.eur + x.foilQty * (c.eurFoil || c.eur); }

// ---------- CSV
function parseCSV(text, delim) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const COND_MAP = { mint: 'Mint', m: 'Mint', near_mint: 'Near Mint', 'near mint': 'Near Mint', nm: 'Near Mint', excellent: 'Near Mint', lightly_played: 'Slightly Played', 'lightly played': 'Slightly Played', slightly_played: 'Slightly Played', 'slightly played': 'Slightly Played', lp: 'Slightly Played', sp: 'Slightly Played', good: 'Slightly Played', moderately_played: 'Moderately Played', 'moderately played': 'Moderately Played', mp: 'Moderately Played', played: 'Played', pl: 'Played', heavily_played: 'Heavily Played', 'heavily played': 'Heavily Played', hp: 'Heavily Played', damaged: 'Poor', poor: 'Poor', dmg: 'Poor' };
const LANG_MAP = { en: 'en', english: 'en', inglese: 'en', it: 'it', italian: 'it', italiano: 'it', fr: 'fr', french: 'fr', de: 'de', german: 'de', es: 'es', spanish: 'es', pt: 'pt', portuguese: 'pt', ja: 'jp', jp: 'jp', japanese: 'jp', ko: 'kr', kr: 'kr', korean: 'kr', ru: 'ru', russian: 'ru', zhs: 'zhs', 'zh-cn': 'zhs', zht: 'zht', 'zh-tw': 'zht' };
const COND_LIST = ['Mint', 'Near Mint', 'Slightly Played', 'Moderately Played', 'Played', 'Heavily Played', 'Poor'];
const LANG_LIST = [['en', 'Inglese'], ['it', 'Italiano'], ['fr', 'Francese'], ['de', 'Tedesco'], ['es', 'Spagnolo'], ['pt', 'Portoghese'], ['jp', 'Giapponese'], ['kr', 'Coreano'], ['ru', 'Russo'], ['zhs', 'Cinese semplificato'], ['zht', 'Cinese tradizionale']];
function readEntries(text) {
  text = text.replace(/^\ufeff/, '');
  let delim = ',';
  const first = text.split('\n', 1)[0];
  if (!first.includes(',')) { if (first.includes(';')) delim = ';'; else if (first.includes('\t')) delim = '\t'; }
  const m = /^"?sep=(.)"?$/i.exec(first.trim());
  if (m) { delim = m[1]; text = text.slice(text.indexOf('\n') + 1); }
  const rows = parseCSV(text, delim).filter(r => r.length > 1);
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const ix = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iName = ix(['name', 'card name', 'nome', 'nome carta']), iSet = ix(['set code', 'set', 'edition', 'edizione']),
    iCn = ix(['collector number', 'card number', 'numero', 'number']), iSid = ix(['scryfall id', 'scryfall_id']),
    iQty = ix(['quantity', 'qty', 'count', 'quantita']), iFoil = ix(['foil', 'printing', 'finish']), iCond = ix(['condition', 'condizione']), iLang = ix(['language', 'lingua']);
  if (iName < 0 && iSid < 0) throw new Error('Colonna del nome non trovata. Colonne del file: ' + head.join(', '));
  const map = new Map();
  rows.forEach(r => {
    const name = iName >= 0 ? (r[iName] || '').trim() : '';
    const sid = iSid >= 0 ? (r[iSid] || '').trim() : '';
    if (!name && !sid) return;
    const set = iSet >= 0 ? (r[iSet] || '').trim().toLowerCase() : '';
    const cn = iCn >= 0 ? (r[iCn] || '').trim() : '';
    const qty = iQty >= 0 ? (parseInt(r[iQty]) || 1) : 1;
    const fv = iFoil >= 0 ? (r[iFoil] || '').trim() : '';
    const foil = /foil|etched/i.test(fv) && !/^(non-?foil|normal|no|false|0)$/i.test(fv);
    const key = sid || (set && cn ? set + '/' + cnNorm(cn) : 'n:' + name.toLowerCase());
    const e = map.get(key) || { key, name, set, cn, sid, qty: 0, foilQty: 0 };
    const cv = iCond >= 0 ? COND_MAP[String(r[iCond] || '').trim().toLowerCase()] : '', lv = iLang >= 0 ? LANG_MAP[String(r[iLang] || '').trim().toLowerCase()] : '';
    if (cv) e.cond = e.cond === undefined || e.cond === cv ? cv : '*';
    if (lv) e.lang = e.lang === undefined || e.lang === lv ? lv : '*';
    e.qty += qty; if (foil) e.foilQty += qty;
    map.set(key, e);
  });
  return [...map.values()];
}

// ---------- Scryfall
const identOf = e => e.sid ? { id: e.sid } : (e.set && e.cn ? { set: e.set, collector_number: e.cn } : { name: e.name });
function indexCards(list) {
  const byId = {}, bySet = {}, byName = {};
  list.forEach(c => {
    byId[c.id] = c; bySet[(c.set || '') + '/' + cnNorm(c.collector_number)] = c;
    const names = [c.name].concat((c.card_faces || []).map(f => f.name)).filter(Boolean);
    names.forEach(n => { if (!byName[n.toLowerCase()]) byName[n.toLowerCase()] = c; });
  });
  return { byId, bySet, byName };
}
async function resolveCards(entries, onProg) {
  const need = entries.filter(e => !C.cards[e.key]);
  let retry = [], done = 0;
  const apply = (chunk, data, byNameOnly) => {
    const ix = indexCards(data);
    chunk.forEach(e => {
      const c = byNameOnly ? ix.byName[e.name.toLowerCase()] : (ix.byId[e.sid] || ix.bySet[e.set + '/' + cnNorm(e.cn)] || ix.byName[e.name.toLowerCase()]);
      if (c) C.cards[e.key] = slim(c); else if (!byNameOnly && e.name) retry.push(e);
    });
  };
  for (let i = 0; i < need.length; i += 75) {
    const chunk = need.slice(i, i + 75);
    const r = await scry('/cards/collection', { identifiers: chunk.map(identOf) });
    apply(chunk, r.data || [], false);
    done += chunk.length; onProg(done, need.length);
  }
  const again = retry; retry = [];
  for (let i = 0; i < again.length; i += 75) {
    const chunk = again.slice(i, i + 75);
    const r = await scry('/cards/collection', { identifiers: chunk.map(e => ({ name: e.name })) });
    apply(chunk, r.data || [], true);
  }
  C.notFound = entries.filter(e => !C.cards[e.key]);
}

async function enrichItalian() {
  if (C.enriching) return;
  C.enriching = true;
  const sets = [...new Set(Object.values(C.cards).map(c => (c.set || '').toLowerCase()).filter(Boolean))].filter(s => !C.itSets.includes(s));
  let n = 0;
  for (const s of sets) {
    n++; say('itMsg', `Cerco i nomi italiani: espansione ${n} di ${sets.length}\u2026`);
    try {
      let r = await scry('/cards/search?' + new URLSearchParams({ q: 'e:' + s + ' lang:it', unique: 'prints', order: 'set' }).toString());
      let pages = 1;
      for (;;) {
        (r.data || []).forEach(x => { const c = slim(x); if (c.name_it) C.it[c.id] = [c.name_it, c.type_it || '']; });
        if (r.has_more && r.next_page && pages < 8) { r = await scry(r.next_page); pages++; } else break;
      }
      C.itSets.push(s);
    } catch (e) { say('itMsg', 'Nomi italiani non disponibili in questo momento: mostro quelli inglesi.'); C.enriching = false; return; }
    if (n % 6 === 0) { await saveIt(); render(); }
  }
  await saveIt(); C.enriching = false; say('itMsg', ''); render();
}
const saveIt = async () => { await idb.set('it', C.it); await idb.set('itsets', C.itSets); };

// ---------- caricamento
async function loadText(text) {
  let entries;
  try { entries = readEntries(text); } catch (e) { return say('loadMsg', e.message); }
  if (!entries.length) return say('loadMsg', 'Nessuna carta trovata nel file.');
  const prevE = new Map((C.entries || []).map(x => [x.key, x]));
  entries.forEach(x => { const o = prevE.get(x.key); if (o) { if (x.cond === undefined && o.cond) x.cond = o.cond; if (x.lang === undefined && o.lang) x.lang = o.lang; } });
  C.entries = entries;
  try {
    store.set('mtg_owned_rows', JSON.stringify(entries.map(e => [e.name, e.set, e.qty])));
    const om = {};
    entries.forEach(e => { const k = (e.name || '').toLowerCase(); if (k) { om[k] = (om[k] || 0) + e.qty; if (k.includes('//')) k.split('//').forEach(p => { om[p.trim()] = (om[p.trim()] || 0) + e.qty; }); } });
    store.set('mtg_owned', JSON.stringify(om));
  } catch (e) {}
  await idb.set('entries', entries);
  store.set('mtg_entries', JSON.stringify(entries));
  const prog = $('prog'); prog.hidden = false;
  const unknown = entries.filter(e => !C.cards[e.key]).length;
  say('loadMsg', unknown ? 'Scarico le immagini e i dati delle carte\u2026' : 'Preparo la collezione\u2026');
  try {
    await resolveCards(entries, (d, t) => { prog.max = t; prog.value = d; say('loadMsg', `Scarico dati delle carte: ${d} di ${t}\u2026`); });
  } catch (e) { say('loadMsg', e.message + ' Riprova tra poco: le carte gi\u00e0 scaricate restano salvate.'); }
  prog.hidden = true;
  await idb.set('cards', C.cards);
  afterLoad();
  enrichItalian();
}
function afterLoad() {
  const have = C.entries.filter(e => C.cards[e.key]);
  const copies = C.entries.reduce((a, e) => a + e.qty, 0);
  say('loadMsg', `${copies} carte nel file (${C.entries.length} righe diverse), ${have.length} riconosciute.`);
  $('missBox').hidden = !C.notFound.length;
  $('missSum').textContent = `${C.notFound.length} righe non riconosciute`;
  $('missList').innerHTML = C.notFound.slice(0, 100).map(e => esc(`${e.qty} ${e.name || e.sid}${e.set ? ' (' + e.set.toUpperCase() + ')' : ''}`)).join('<br>');
  $('loadTools').hidden = false; $('empty').hidden = true; $('app').hidden = false;
  buildFilters(); render();
}

// ---------- filtri e visualizzazione
function items() { return C.entries.map(e => Object.assign({}, e)).filter(x => C.cards[x.key]); }

function buildFilters() {
  const its = items();
  const types = {}, sets = {}, rars = {};
  its.forEach(x => { const c = cardOf(x); const t = typeCat(c); types[t] = (types[t] || 0) + x.qty; sets[c.set] = sets[c.set] || { n: 0, name: c.setName, rel: c.released }; sets[c.set].n += x.qty; rars[c.rarity] = (rars[c.rarity] || 0) + x.qty; });
  $('fType').innerHTML = '<option value="">Tutti i tipi</option>' + TYPES.filter(t => types[t[0]]).map(t => `<option value="${t[0]}">${esc(t[3])} (${types[t[0]]})</option>`).join('');
  $('fSet').innerHTML = '<option value="">Tutte le espansioni</option>' + Object.entries(sets).sort((a, b) => (b[1].rel || '').localeCompare(a[1].rel || '')).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name)} (${esc(k)}) - ${v.n}</option>`).join('');
  $('fRar').innerHTML = '<option value="">Tutte le rarit\u00e0</option>' + RARITIES.filter(r => rars[r[0]]).map(r => `<option value="${r[0]}">${esc(r[1])} (${rars[r[0]]})</option>`).join('');
  $('colors').innerHTML = COLOR_ORDER.map(k => `<span class="chip" data-c="${k}" title="${esc(COLOR_IT[k])}" aria-label="${esc(COLOR_IT[k])}"><span class="pip p${k}">${k}</span></span>`).join('');
  $('fType').value = F.type; $('fSet').value = F.set; $('fRar').value = F.rar;
  $('colors').querySelectorAll('.chip').forEach(ch => ch.classList.toggle('on', F.colors.has(ch.dataset.c)));
}

function matches(x) {
  const c = cardOf(x);
  if (F.foil && !x.foilQty) return false;
  if (F.sell && !sellN(x)) return false;
  if (F.many && (totOf(x) <= MAXC || /Basic Land/.test(cardOf(x).type || ''))) return false;
  if (F.set && c.set !== F.set) return false;
  if (F.rar && c.rarity !== F.rar) return false;
  if (F.type && typeCat(c) !== F.type) return false;
  if (F.colors.size) {
    const cat = colorCat(c);
    const ok = cat === 'M' ? (F.colors.has('M') || (c.colors || []).some(k => F.colors.has(k))) : F.colors.has(cat);
    if (!ok) return false;
  }
  if (F.q) {
    const hay = norm([nameOf(x), c.name, typeLineOf(x), c.type].join(' '));
    if (!norm(F.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
  }
  return true;
}
const cmpName = (a, b) => norm(nameOf(a)).localeCompare(norm(nameOf(b)));
const SORTS = {
  name: cmpName,
  cmc: (a, b) => (cardOf(a).cmc - cardOf(b).cmc) || cmpName(a, b),
  set: (a, b) => (cardOf(b).released || '').localeCompare(cardOf(a).released || '') || (cardOf(a).set.localeCompare(cardOf(b).set)) || (parseInt(cardOf(a).cn) || 0) - (parseInt(cardOf(b).cn) || 0) || cmpName(a, b),
  price: (a, b) => (priceOf(b) / b.qty - priceOf(a) / a.qty) || cmpName(a, b),
  qty: (a, b) => (b.qty - a.qty) || cmpName(a, b),
};
function groupKey(x) {
  const c = cardOf(x);
  if (F.group === 'color') { const k = colorCat(c); return [COLOR_ORDER.indexOf(k), COLOR_IT[k]]; }
  if (F.group === 'type') { const k = typeCat(c); return [TYPES.findIndex(t => t[0] === k), typeLabel(k, true)]; }
  if (F.group === 'set') return ['' + (9e9 - (Date.parse(c.released) || 0)), `${c.setName} (${c.set})`];
  if (F.group === 'rarity') { const i = RARITIES.findIndex(r => r[0] === c.rarity); return [i < 0 ? 99 : i, (RARITIES[i] || [0, c.rarity])[1]]; }
  return [0, ''];
}

function tileHtml(x, i) {
  const c = cardOf(x), nm = esc(nameOf(x));
  if (C.view === 'list') {
    return `<div class="lrow" data-i="${i}"><span class="q">${x.qty}${x.foilQty ? '<small title="foil"> \u2605</small>' : ''}${sellN(x) ? '<small title="in vendita"> \u20ac' + sellN(x) + '</small>' : ''}</span><span class="n">${nm}</span><span class="m">${manaHtml(c.mana)}</span><span class="s">${esc(c.set)}</span><span class="p">${c.eur ? money(priceOf(x) / x.qty) : ''}</span></div>`;
  }
  return `<div class="tile" data-i="${i}">${c.img ? `<img loading="lazy" src="${esc(c.img)}" alt="${nm}">` : `<div class="noimg">${nm}</div>`}
    ${x.qty > 1 ? `<span class="qb">&times;${x.qty}</span>` : ''}${x.foilQty ? '<span class="fb">foil</span>' : ''}${totOf(x) > MAXC && !/Basic Land/.test(c.type || '') ? '<span class="xb">tot ' + totOf(x) + '</span>' : ''}${sellN(x) ? '<span class="sb">in vendita &times;' + sellN(x) + '</span>' : ''}<div class="cap">${nm} <small>${esc(c.set)}</small></div>${c.eur || c.eurFoil ? '<div class="pz">' + money(priceOf(x) / x.qty) + (x.qty > 1 ? ' <small>cad.</small>' : '') + '</div>' : '<div class="pz"><small>prezzo n.d.</small></div>'}</div>`;
}

let view = [];
function render() {
  if (!C.entries.length) return;
  const all = items();
  TOT = {}; all.forEach(x => { const id = cardOf(x).id; TOT[id] = (TOT[id] || 0) + x.qty; });
  // statistiche
  const copies = all.reduce((a, x) => a + x.qty, 0), uniq = new Set(all.map(x => cardOf(x).id)).size;
  const value = all.reduce((a, x) => a + priceOf(x), 0), nsets = new Set(all.map(x => cardOf(x).set)).size;
  $('stats').innerHTML = `<div><b>${copies}</b><span>carte</span></div><div><b>${uniq}</b><span>carte diverse</span></div><div><b>${nsets}</b><span>espansioni</span></div>${value ? `<div><b>${money(value)}</b><span>valore indicativo (Cardmarket, tramite Scryfall)</span></div>` : ''}`;
  // filtro, ordinamento, gruppi
  view = all.filter(matches).sort(SORTS[F.sort] || SORTS.name);
  const groups = new Map();
  view.forEach((x, i) => { x._i = i; const [o, label] = groupKey(x); if (!groups.has(label)) groups.set(label, { o, items: [] }); groups.get(label).items.push(x); });
  const ordered = [...groups.entries()].sort((a, b) => (a[1].o > b[1].o ? 1 : a[1].o < b[1].o ? -1 : 0));
  let shown = 0, html = '';
  const shownCopies = view.reduce((a, x) => a + x.qty, 0);
  for (const [label, g] of ordered) {
    if (shown >= C.limit) break;
    const part = g.items.slice(0, C.limit - shown); shown += part.length;
    const n = g.items.reduce((a, x) => a + x.qty, 0);
    if (F.group !== 'none') html += `<div class="ghead">${esc(label)} <small>${n} carte</small></div>`;
    html += `<div class="${C.view === 'list' ? 'list' : 'grid'}">${part.map(x => tileHtml(x, x._i)).join('')}</div>`;
  }
  if (!view.length) html = '<div id="empty">Nessuna carta con questi filtri.</div>';
  else if (F.group === 'none') html = `<div class="msg" style="margin:0 2px 8px">${shownCopies} carte (${view.length} diverse)</div>` + html;
  $('result').innerHTML = html;
  $('more').hidden = shown >= view.length; $('more').textContent = `Mostra altre (${view.length - shown})`;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === C.view));
  $('foilChip').classList.toggle('on', F.foil);
  if (typeof renderSetBox === 'function') renderSetBox();
}

// ---------- modale
let openX = null;
function openModal(i) { showModal(view[i]); }
function showModal(x) {
  if (!x) return; openX = x;
  const c = cardOf(x);
  const same = items().filter(y => cardOf(y).id === c.id);
  const step = (y, f, max) => { const s = SELL[y.key] || {}; const n = s[f] || 0; return `<span class="st"><button class="secondary" data-sell="${esc(y.key)}" data-f="${f}" data-d="-1"${n <= 0 ? ' disabled' : ''}>&minus;</button><b>${n}</b><button class="secondary" data-sell="${esc(y.key)}" data-f="${f}" data-d="1"${n >= max ? ' disabled' : ''}>+</button></span>`; };
  const prints = same.map(y => { const cc = cardOf(y), nf = y.qty - (y.foilQty || 0);
    const sel = (kind, list, cur) => `<select data-ent="${esc(y.key)}" data-k="${kind}" style="padding:4px 6px;font-size:13px;border-radius:6px"><option value="">${kind === 'cond' ? 'Predefinita (impostata in Vendi)' : 'Predefinita (impostata in Vendi)'}</option>${list.map(o => `<option value="${esc(o[0])}"${o[0] === cur ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    const cl = COND_LIST.map(c => [c, c]);
    return `<div class="sellrow"><span>${y.qty} \u00d7 ${esc(cc.setName)} (${esc(cc.set)}${cc.cn ? ' #' + esc(cc.cn) : ''})${y.foilQty ? ' - di cui ' + y.foilQty + ' foil' : ''}</span>` +
      (nf > 0 ? `<span class="st-l">Da vendere ${step(y, 'n', nf)}</span>` : '') + (y.foilQty ? `<span class="st-l">Foil da vendere ${step(y, 'f', y.foilQty)}</span>` : '') + `</div><details class="sub2" style="margin:0 0 4px"><summary style="cursor:pointer;font-size:12.5px;color:var(--muted)">Stato e lingua${y.cond && y.cond !== '*' ? ': ' + esc(y.cond) : ''}${y.lang && y.lang !== '*' ? ', ' + esc(y.lang) : ''}</summary><div class="row" style="margin-top:4px"><label class="msg">Condizione ${sel('cond', cl, y.cond)}</label><label class="msg">Lingua ${sel('lang', LANG_LIST, y.lang)}</label></div></details>`; }).join('');
  const it = C.it[c.id];
  const textIt = c.text_it, textEn = c.text;
  $('mBody').innerHTML = `
    <div class="mimg">${c.imgBig ? `<img src="${esc(c.imgBig)}" alt="">` : ''}${c.back ? `<img src="${esc(c.back)}" alt="">` : ''}</div>
    <div class="minfo">
      <h3>${esc(nameOf(x))}</h3>${nameOf(x) !== c.name ? `<div class="en">${esc(c.name)}</div>` : ''}
      <div class="mm">${manaHtml(c.mana)}</div>
      <div>${esc(typeLineOf(x))}${typeLineOf(x) !== c.type ? `<div class="en">${esc(c.type)}</div>` : ''}</div>
      ${c.pt ? `<div><b>${esc(c.pt)}</b></div>` : ''}
      <p class="otext">${esc(textIt || textEn).replace(/\n/g, '<br>')}</p>
      ${textIt && textEn ? `<details><summary>Testo inglese</summary><p class="otext">${esc(textEn).replace(/\n/g, '<br>')}</p></details>` : ''}
      <div class="meta">${esc(c.rarity)}${c.eur ? ' &middot; ' + money(c.eur) : ''}${c.eurFoil ? ' (foil ' + money(c.eurFoil) + ')' : ''}</div>
      <div class="meta"><b>Ne hai ${same.reduce((a, y) => a + y.qty, 0)}</b></div>${prints}<div class="meta"><a href="vendi.html">Vai alla pagina Vendi</a>${Object.keys(SELL).length ? ' (' + Object.keys(SELL).length + ' righe in lista)' : ''}</div>
    </div>`;
  $('modal').hidden = false; document.body.classList.add('noscroll');
}
const closeModal = () => { $('modal').hidden = true; document.body.classList.remove('noscroll'); };

// ---------- eventi
$('csv').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; loadText(await f.text()); };
$('result').addEventListener('click', ev => { const t = ev.target.closest('[data-i]'); if (t) openModal(+t.dataset.i); });
$('modal').addEventListener('change', async ev => {
  const s = ev.target.closest('[data-ent]'); if (!s) return;
  const e = C.entries.find(z => z.key === s.dataset.ent); if (!e) return;
  if (s.value) e[s.dataset.k] = s.value; else delete e[s.dataset.k];
  await idb.set('entries', C.entries); store.set('mtg_entries', JSON.stringify(C.entries));
  toast('Salvato'); showModal(openX);
});
$('modal').addEventListener('click', ev => {
  const sb = ev.target.closest('[data-sell]');
  if (sb) { const k = sb.dataset.sell, f = sb.dataset.f, e = C.entries.find(z => z.key === k); if (!e) return; const s = SELL[k] = SELL[k] || {}; const max = f === 'f' ? (e.foilQty || 0) : e.qty - (e.foilQty || 0); s[f] = Math.max(0, Math.min(max, (s[f] || 0) + (+sb.dataset.d))); sellSave(); showModal(openX); render(); return; } if (ev.target === $('modal') || ev.target.id === 'mClose') closeModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });
(function () { const q = new URLSearchParams(location.search); if (q.get('sell')) { F.sell = true; $('fSell').checked = true; } if (q.get('many')) { F.many = true; $('fMany').checked = true; } })();
let qTimer = null;
$('q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = $('q').value.trim(); C.limit = 120; render(); }, 200); };
$('colors').addEventListener('click', ev => { const ch = ev.target.closest('.chip'); if (!ch) return; const k = ch.dataset.c; F.colors.has(k) ? F.colors.delete(k) : F.colors.add(k); ch.classList.toggle('on'); C.limit = 120; render(); });
[['fType', 'type'], ['fSet', 'set'], ['fRar', 'rar'], ['fSort', 'sort'], ['fGroup', 'group']].forEach(([id, k]) => { $(id).onchange = () => { F[k] = $(id).value; C.limit = 120; render(); }; });
$('fMany').onchange = () => { F.many = $('fMany').checked; C.limit = 120; render(); };
$('fSell').onchange = () => { F.sell = $('fSell').checked; C.limit = 120; render(); };
$('fFoil').onchange = () => { F.foil = $('fFoil').checked; C.limit = 120; render(); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { C.view = b.dataset.view; store.set('mtg_col_view', C.view); render(); });
$('more').onclick = () => { C.limit += 120; render(); };
$('btnReset').onclick = () => {
  Object.assign(F, { many: false, sell: false, q: '', type: '', set: '', rar: '', foil: false, sort: 'name', group: 'none' }); F.colors.clear();
  $('q').value = ''; $('fFoil').checked = false; $('fSell').checked = false; $('fMany').checked = false; $('fSort').value = 'name'; $('fGroup').value = 'none'; C.limit = 120; buildFilters(); render();
};
$('btnClear').onclick = async () => {
  if (!confirm('Rimuovere la collezione salvata su questo dispositivo? Il file CSV resta dov\u2019\u00e8.')) return;
  C.entries = []; C.cards = {}; C.notFound = [];
  await idb.set('entries', []); await idb.set('cards', {});
  store.set('mtg_owned_rows', '[]'); store.set('mtg_owned', '{}'); store.set('mtg_entries', '[]');
  $('app').hidden = true; $('empty').hidden = false; $('loadTools').hidden = true; $('missBox').hidden = true; say('loadMsg', 'Collezione rimossa.');
};

// ---------- avvio: ripristina la collezione salvata
(async () => {
  let [entries, cards, it, itSets] = await Promise.all([idb.get('entries'), idb.get('cards'), idb.get('it'), idb.get('itsets')]);
  C.cards = cards || {}; C.it = it || {}; C.itSets = itSets || [];
  // La collezione completa viaggia con l'account (mtg_entries): se e diversa da quella locale, vince quella dell'account.
  let saved = null; try { saved = JSON.parse(store.get('mtg_entries')); } catch (e) { saved = null; }
  if (Array.isArray(saved)) {
    if (JSON.stringify(saved) !== JSON.stringify(entries || [])) { entries = saved; await idb.set('entries', entries); }
  } else if (entries && entries.length) { store.set('mtg_entries', JSON.stringify(entries)); }
  if (entries && entries.length) {
    C.entries = entries;
    C.notFound = entries.filter(e => !C.cards[e.key]);
    afterLoad();
    if (C.notFound.length) { say('loadMsg', 'Completo i dati delle carte rimaste\u2026'); try { await resolveCards(entries, () => {}); await idb.set('cards', C.cards); } catch (e) {} afterLoad(); }
    enrichItalian();
  }
})();
