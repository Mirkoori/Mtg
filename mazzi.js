'use strict';
/* Costruttore di mazzi: dati carte da Scryfall, mazzi salvati sul dispositivo (localStorage). */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { toast('Memoria piena: non riesco a salvare'); } },
};
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };

const SCRY = 'https://api.scryfall.com';
const LEGAL_KEYS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'brawl'];
const S = {
  decks: jget('mtg_decks', []), cards: jget('mtg_cards', {}), cur: store.get('mtg_cur'),
  view: store.get('mtg_view') || 'grid', owned: jget('mtg_owned', {}),
  results: [], searchSeq: 0, shown: 60, target: 'auto', modalId: null,
};

function save() { store.set('mtg_decks', JSON.stringify(S.decks)); store.set('mtg_cards', JSON.stringify(S.cards)); store.set('mtg_cur', S.cur || ''); }
const deck = () => S.decks.find(d => d.id === S.cur) || null;
const fmtOf = d => Deck.FORMATS[d.format] || Deck.FORMATS.pioneer;
const nameOf = c => c.name_it || c.name;

let toastTimer = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200); }

// ---------- Scryfall
let lastReq = 0;
async function scry(path, body) {
  const gap = 110 - (Date.now() - lastReq); if (gap > 0) await sleep(gap);
  lastReq = Date.now();
  let r;
  try {
    r = await fetch(path.startsWith('http') ? path : SCRY + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
      : { headers: { Accept: 'application/json' } });
  } catch (e) { throw new Error('Connessione a Scryfall non riuscita.'); }
  if (r.status === 404) return { data: [], not_found: [] };
  if (!r.ok) throw new Error('Scryfall: errore ' + r.status);
  return r.json();
}

function slim(c) {
  const faces = c.card_faces || [];
  const f0 = faces[0] || {};
  const iu = c.image_uris || f0.image_uris || {};
  const it = c.lang === 'it';
  const join = k => faces.length ? faces.map(f => f[k] || '').filter(Boolean).join('\n//\n') : (c[k] || '');
  const pn = it ? (c.printed_name || faces.map(f => f.printed_name || f.name).join(' // ')) : null;
  const legal = {}; LEGAL_KEYS.forEach(k => { if (c.legalities && c.legalities[k]) legal[k] = c.legalities[k]; });
  return {
    id: c.oracle_id || f0.oracle_id || c.id, name: c.name, name_it: pn && pn !== c.name ? pn : null,
    type: c.type_line || join('type_line'), type_it: it ? (c.printed_type_line || join('printed_type_line') || null) : null,
    mana: c.mana_cost || faces.map(f => f.mana_cost || '').filter(Boolean).join(' // '), cmc: c.cmc || 0,
    colors: c.colors || f0.colors || [], ci: c.color_identity || [],
    text: c.oracle_text || join('oracle_text'), text_it: it ? (c.printed_text || join('printed_text') || null) : null,
    pt: c.power != null ? c.power + '/' + c.toughness : (f0.power != null ? f0.power + '/' + f0.toughness : (c.loyalty ? 'Lealt\u00e0 ' + c.loyalty : '')),
    img: iu.small || iu.normal || '', imgBig: iu.normal || iu.small || '',
    back: faces[1] && faces[1].image_uris ? faces[1].image_uris.normal : '',
    rarity: c.rarity || '', set: (c.set || '').toUpperCase(), setName: c.set_name || '', eur: parseFloat(c.prices && c.prices.eur) || 0,
    legal, produced: c.produced_mana || [], lang: c.lang || 'en',
  };
}

async function searchPages(q, maxPages) {
  const params = '?' + new URLSearchParams({ q, unique: 'cards', order: 'name' }).toString();
  let r = await scry('/cards/search' + params);
  const data = (r.data || []).slice();
  let pages = 1;
  while (r.has_more && r.next_page && pages < maxPages) { r = await scry(r.next_page); data.push(...(r.data || [])); pages++; }
  return data;
}

async function searchCards(q, onlyLegal, fmtScry) {
  const base = q.trim();
  if (!base) return [];
  const legal = onlyLegal && fmtScry ? ' f:' + fmtScry : '';
  const out = [], seen = new Set();
  const add = list => list.forEach(c => { const s = slim(c); if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } });
  const queries = [];
  const typeEn = /[:=<>!"]/.test(base) ? [] : Deck.typeWordsEn(base);
  if (typeEn.length) queries.push(typeEn.map(t => 't:' + t).join(' ') + legal); // per tipo (es. chierico -> t:cleric)
  queries.push(base + legal);                                                   // per nome
  for (const qq of queries) {
    add(await searchPages(qq + ' lang:it', 4));  // stampe italiane (nomi e testi in italiano)
    add(await searchPages(qq, 4));               // tutte le altre carte, anche senza stampa italiana
  }
  return out;
}

async function enrichItalian(ids) {
  const todo = ids.filter(id => S.cards[id] && !S.cards[id].name_it && !S.cards[id].itTried);
  for (let i = 0; i < todo.length; i++) {
    const c = S.cards[todo[i]]; c.itTried = true;
    $('importMsg').textContent = `Cerco i nomi italiani ${i + 1}/${todo.length}\u2026`;
    try {
      const d = await scry('/cards/search?' + new URLSearchParams({ q: `!"${c.name.split(' // ')[0]}" lang:it`, unique: 'cards' }).toString());
      if (d.data && d.data[0]) {
        const s = slim(d.data[0]);
        if (s.name_it) { Object.assign(c, { name_it: s.name_it, type_it: s.type_it, text_it: s.text_it, img: s.img || c.img, imgBig: s.imgBig || c.imgBig }); }
      }
    } catch (e) { /* si resta con i dati inglesi */ }
    if (i % 5 === 4) { save(); render(); }
  }
  save(); render(); $('importMsg').textContent = S.importDone || '';
}

// ---------- mana
function manaHtml(cost) {
  return String(cost || '').replace(/\{([^}]+)\}/g, (_, s) => {
    const k = s.replace('/', '');
    const col = 'WUBRG'.includes(s) && s.length === 1 ? s : (s === 'C' ? 'C' : (/^\d+$/.test(s) ? 'N' : 'X'));
    return `<span class="pip p${col}">${esc(s.replace('/', ''))}</span>`;
  }).replace(/\/\//g, '<span class="sep">//</span>');
}

// ---------- rendering
const SEC_ORDER = ['commander', 'lands', 'creatures', 'ramp', 'draw', 'removal', 'other', 'side'];
function visibleSections(d) {
  const f = fmtOf(d);
  return SEC_ORDER.filter(s => (s !== 'commander' || f.commander) && (s !== 'side' || f.side > 0));
}

function ownedQty(c) { return S.owned[(c.name || '').toLowerCase()] || 0; }

function render() {
  renderDeckBar();
  const d = deck();
  $('empty').hidden = !!d; $('deckArea').hidden = !d;
  if (!d) return;
  renderSummary(d);
  renderSections(d);
  renderTargetSelect(d);
}

function renderDeckBar() {
  $('deckSel').innerHTML = S.decks.map(d => `<option value="${esc(d.id)}" ${d.id === S.cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  $('deckSel').hidden = !S.decks.length;
  const d = deck();
  $('fmtSel').innerHTML = Object.entries(Deck.FORMATS).map(([k, f]) => `<option value="${k}" ${d && d.format === k ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  $('deckTools').hidden = !d;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
}

function renderSummary(d) {
  const f = fmtOf(d), st = Deck.stats(d, S.cards);
  const cmdr = f.commander ? ` + comandante (${st.commander}/1)` : '';
  let ownedHave = 0, ownedTot = 0, missing = 0;
  d.cards.forEach(e => { const c = S.cards[e.id]; if (!c) return; if (Deck.isBasic(c)) return; ownedTot += e.qty; const h = Math.min(ownedQty(c), e.qty); ownedHave += h; missing += e.qty - h; });
  const hasOwned = Object.keys(S.owned).length > 0;
  let h = `<div class="big"><b>${st.main}</b> / ${st.mainTarget} carte${esc(cmdr)}${f.side ? ` &middot; sideboard ${st.side}/${f.side}` : ''}</div>`;
  h += `<div class="sub2">${esc(f.name)} &middot; costo medio ${st.avgCmc.toFixed(1)}${st.value ? ' &middot; circa ' + st.value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : ''}</div>`;
  if (hasOwned) h += `<div class="sub2">Hai gi\u00e0 ${ownedHave} carte su ${ownedTot} (escluse le terre base). <button class="link" id="btnMissing">Copia le mancanti</button></div>`;
  else h += `<div class="sub2">Carica il tuo file CSV nella pagina Carrello per vedere quali carte hai gi\u00e0.</div>`;
  h += '<div class="bars">';
  Deck.MAIN.forEach(s => {
    const x = st.sections[s], [mn, id, mx] = x.range;
    const scale = Math.max(mx, x.n, 1);
    h += `<div class="barrow"><span class="bl">${esc(Deck.SECTIONS[s])}</span>
      <span class="bt"><span class="bf ${x.status}" style="width:${Math.min(100, x.n / scale * 100)}%"></span><span class="bi" style="left:${id / scale * 100}%"></span></span>
      <span class="bn ${x.status}">${x.n}</span><span class="br">${mn}-${mx}</span></div>`;
  });
  h += '</div>';
  // curva
  const cmax = Math.max(1, ...st.curve);
  h += '<div class="curve">' + st.curve.map((n, i) => `<div class="cc"><span class="cn">${n || ''}</span><span class="cb" style="height:${n / cmax * 100}%"></span><span class="cl">${i === 7 ? '7+' : i}</span></div>`).join('') + '</div>';
  const pk = Object.entries(st.pips).filter(([, n]) => n > 0);
  if (pk.length) h += '<div class="pipsrow">' + pk.map(([k, n]) => `<span class="pip p${k}">${k}</span>${n}`).join(' ') + '</div>';
  const warns = Deck.check(d, S.cards);
  if (warns.length) h += '<ul class="warns">' + warns.slice(0, 8).map(w => `<li class="${w.lvl}">${esc(w.msg)}</li>`).join('') + (warns.length > 8 ? `<li class="info">e altri ${warns.length - 8} avvisi</li>` : '') + '</ul>';
  else if (st.main === st.mainTarget) h += '<ul class="warns"><li class="ok">Nessun problema trovato.</li></ul>';
  $('summary').innerHTML = h;
  const bm = $('btnMissing'); if (bm) bm.onclick = () => copyText(missingText(d), 'Elenco copiato');
}

function missingText(d) {
  const lines = [];
  d.cards.forEach(e => { const c = S.cards[e.id]; if (!c || Deck.isBasic(c)) return; const n = e.qty - Math.min(ownedQty(c), e.qty); if (n > 0) lines.push(`${n} ${c.name}`); });
  return lines.join('\n');
}

function tileHtml(d, e, c) {
  const own = ownedQty(c), basic = Deck.isBasic(c);
  const badge = Object.keys(S.owned).length && !basic ? `<span class="own ${own >= e.qty ? 'y' : own ? 'p' : 'n'}">${own >= e.qty ? '\u2713' : own ? own + '/' + e.qty : '\u2717'}</span>` : '';
  const qty = `<span class="qctl"><button data-act="dec" data-id="${esc(e.id)}" data-sec="${e.section}">&minus;</button><b>${e.qty}</b><button data-act="inc" data-id="${esc(e.id)}" data-sec="${e.section}">+</button></span>`;
  if (S.view === 'list') {
    return `<div class="lrow"><span class="lq">${qty}</span><a class="lname" data-act="open" data-id="${esc(e.id)}" data-sec="${e.section}">${esc(nameOf(c))}</a><span class="lmana">${manaHtml(c.mana)}</span>${badge}</div>`;
  }
  return `<div class="tile"><a data-act="open" data-id="${esc(e.id)}" data-sec="${e.section}">${c.img ? `<img loading="lazy" src="${esc(c.img)}" alt="${esc(nameOf(c))}">` : `<div class="noimg">${esc(nameOf(c))}</div>`}</a>${badge}${qty}</div>`;
}

function renderSections(d) {
  const f = fmtOf(d), st = Deck.stats(d, S.cards);
  $('sections').innerHTML = visibleSections(d).map(s => {
    const list = Deck.entries(d, s).filter(e => S.cards[e.id]).sort((a, b) => (S.cards[a.id].cmc - S.cards[b.id].cmc) || nameOf(S.cards[a.id]).localeCompare(nameOf(S.cards[b.id]), 'it'));
    const n = Deck.count(d, s);
    let info = '';
    if (s === 'commander') info = `${n}/1`;
    else if (s === 'side') info = `${n}/${f.side}`;
    else { const x = st.sections[s]; info = `<span class="dot ${x.status}"></span>${n} <small>(consigliate ${x.range[0]}-${x.range[2]})</small>`; }
    return `<details class="sec" open data-s="${s}"><summary><span>${esc(Deck.SECTIONS[s])}</span><span class="si">${info}</span><button class="addbtn" data-act="addto" data-sec="${s}">+ Aggiungi</button></summary>
      <div class="${S.view === 'list' ? 'list' : 'grid'}">${list.map(e => tileHtml(d, e, S.cards[e.id])).join('') || '<div class="none">Nessuna carta</div>'}</div></details>`;
  }).join('');
}

function renderTargetSelect(d) {
  const opts = [['auto', 'Automatico (in base alla carta)']].concat(visibleSections(d).map(s => [s, Deck.SECTIONS[s]]));
  if (!opts.some(o => o[0] === S.target)) S.target = 'auto';
  $('target').innerHTML = opts.map(([k, l]) => `<option value="${k}" ${k === S.target ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function renderResults() {
  const d = deck(); if (!d) return;
  const part = S.results.slice(0, S.shown);
  $('results').innerHTML = part.map((c, i) => `<div class="rtile"><a data-act="ropen" data-i="${i}">${c.img ? `<img loading="lazy" src="${esc(c.img)}" alt="${esc(nameOf(c))}">` : `<div class="noimg">${esc(nameOf(c))}</div>`}</a>
    <div class="rn">${esc(nameOf(c))}</div><button data-act="radd" data-i="${i}">+ Aggiungi</button></div>`).join('');
  $('more').hidden = S.results.length <= S.shown;
  $('more').textContent = `Mostra altre (${S.results.length - S.shown})`;
}

// ---------- azioni sul mazzo
function addToDeck(c, section) {
  const d = deck(); if (!d) return;
  S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c);
  let sec = section && section !== 'auto' ? section : Deck.classify(c);
  if (sec === 'side' && !fmtOf(d).side) sec = Deck.classify(c);
  if (sec === 'commander' && !fmtOf(d).commander) sec = Deck.classify(c);
  const limit = fmtOf(d).copies;
  if (sec === 'commander') {
    if (Deck.count(d, 'commander') >= 2) return toast('Hai gi\u00e0 il comandante');
    if (d.cards.some(e => e.section === 'commander' && e.id === c.id)) return toast('Gi\u00e0 comandante');
  }
  Deck.addCard(d, c.id, sec, 1);
  const tot = d.cards.filter(e => e.id === c.id && e.section !== 'commander').reduce((a, e) => a + e.qty, 0);
  save(); render();
  toast(`${nameOf(c)} \u2192 ${Deck.SECTIONS[sec]}` + (limit && !Deck.isBasic(c) && tot > limit ? ' (oltre il limite)' : ''));
}

function copyText(t, msg) {
  const done = () => toast(msg || 'Copiato');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done));
  else fallbackCopy(t, done);
}
function fallbackCopy(t, done) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done(); }

// ---------- modale dettagli
function openModal(id, sec) {
  const c = S.cards[id]; if (!c) return;
  const d = deck(), f = fmtOf(d);
  S.modalId = id;
  const l = f.scry && c.legal ? c.legal[f.scry] : null;
  const legalTxt = l ? ({ legal: 'Legale', not_legal: 'Non legale', banned: 'Bandita', restricted: 'Ristretta' }[l] || l) : '';
  const entry = d.cards.filter(e => e.id === id);
  const inDeck = entry.map(e => `${e.qty} in ${Deck.SECTIONS[e.section]}`).join(', ');
  const own = ownedQty(c);
  $('mBody').innerHTML = `
    <div class="mimg">${c.imgBig ? `<img src="${esc(c.imgBig)}" alt="">` : ''}${c.back ? `<img src="${esc(c.back)}" alt="">` : ''}</div>
    <div class="minfo">
      <h3>${esc(nameOf(c))}</h3>
      ${c.name_it ? `<div class="en">${esc(c.name)}</div>` : ''}
      <div class="mm">${manaHtml(c.mana)} <span class="cmc">costo ${c.cmc}</span></div>
      <div>${esc(c.type_it || c.type)}${c.type_it ? `<div class="en">${esc(c.type)}</div>` : ''}</div>
      ${c.pt ? `<div><b>${esc(c.pt)}</b></div>` : ''}
      <p class="otext">${esc(c.text_it || c.text).replace(/\n/g, '<br>')}</p>
      ${c.text_it && c.text ? `<details><summary>Testo inglese</summary><p class="otext">${esc(c.text).replace(/\n/g, '<br>')}</p></details>` : ''}
      <div class="meta">${esc(c.setName)} (${esc(c.set)}) &middot; ${esc(c.rarity)}${c.eur ? ' &middot; ' + c.eur.toFixed(2).replace('.', ',') + ' \u20ac' : ''}</div>
      ${legalTxt ? `<div class="meta">${esc(f.name)}: <b class="${l === 'legal' ? 'okc' : 'badc'}">${legalTxt}</b></div>` : ''}
      ${Object.keys(S.owned).length ? `<div class="meta">${own ? 'Ne hai ' + own : 'Non ce l\'hai'}</div>` : ''}
      ${inDeck ? `<div class="meta">Nel mazzo: ${esc(inDeck)}</div>` : ''}
      <div class="mact">
        <select id="mSec">${visibleSections(d).map(s => `<option value="${s}" ${s === (sec || Deck.classify(c)) ? 'selected' : ''}>${esc(Deck.SECTIONS[s])}</option>`).join('')}</select>
        <button id="mAdd">+ Aggiungi</button>
        ${sec ? '<button id="mMove" class="secondary">Sposta qui</button><button id="mDel" class="secondary">Rimuovi</button>' : ''}
      </div>
    </div>`;
  $('modal').hidden = false; document.body.classList.add('noscroll');
  $('mAdd').onclick = () => { addToDeck(c, $('mSec').value); };
  if (sec) {
    $('mMove').onclick = () => { Deck.moveCard(d, id, sec, $('mSec').value); save(); render(); closeModal(); };
    $('mDel').onclick = () => { Deck.setQty(d, id, sec, 0); save(); render(); closeModal(); };
  }
}
function closeModal() { $('modal').hidden = true; document.body.classList.remove('noscroll'); }

// ---------- import
async function importList(text, replace) {
  const d = deck(); if (!d) return;
  const items = Deck.parseList(text);
  if (!items.length) return say('importMsg', 'Nessuna carta riconosciuta nel testo.');
  const names = [...new Set(items.map(i => i.name))];
  const found = {};
  say('importMsg', 'Cerco le carte\u2026');
  try {
    for (let i = 0; i < names.length; i += 75) {
      const chunk = names.slice(i, i + 75);
      const r = await scry('/cards/collection', { identifiers: chunk.map(n => ({ name: n })) });
      (r.data || []).forEach(c => {
        const s = slim(c);
        found[c.name.toLowerCase()] = s;
        (c.card_faces || []).forEach(fc => { if (fc.name) found[fc.name.toLowerCase()] = found[fc.name.toLowerCase()] || s; });
      });
    }
  } catch (e) { return say('importMsg', e.message); }
  if (replace) d.cards = [];
  const miss = []; const ids = [];
  items.forEach(it => {
    const c = found[it.name.toLowerCase()];
    if (!c) { miss.push(it.name); return; }
    S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c);
    const f = fmtOf(d);
    let sec = it.mode === 'commander' && f.commander ? 'commander' : it.mode === 'side' && f.side ? 'side' : Deck.classify(c);
    Deck.addCard(d, c.id, sec, it.qty); ids.push(c.id);
  });
  save(); render();
  S.importDone = `Importate ${items.length - miss.length} righe.` + (miss.length ? ` Non trovate: ${miss.slice(0, 8).join(', ')}${miss.length > 8 ? '\u2026' : ''}` : '');
  say('importMsg', S.importDone);
  enrichItalian([...new Set(ids)]);
}
function say(id, t) { $(id).textContent = t; }

// ---------- eventi
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, d = deck();
  if (act === 'inc' || act === 'dec') {
    ev.preventDefault(); if (!d) return;
    const e = d.cards.find(x => x.id === t.dataset.id && x.section === t.dataset.sec); if (!e) return;
    Deck.setQty(d, e.id, e.section, e.qty + (act === 'inc' ? 1 : -1)); save(); render();
  } else if (act === 'open') { ev.preventDefault(); openModal(t.dataset.id, t.dataset.sec); }
  else if (act === 'addto') {
    ev.preventDefault(); S.target = t.dataset.sec; renderTargetSelect(d); openSearch();
  } else if (act === 'ropen') { const c = S.results[+t.dataset.i]; S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c); openModal(c.id, null); }
  else if (act === 'radd') { addToDeck(S.results[+t.dataset.i], $('target').value); }
});
$('modal').addEventListener('click', ev => { if (ev.target === $('modal') || ev.target.id === 'mClose') closeModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

function openSearch() { $('searchPanel').hidden = false; $('q').focus(); $('searchPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
$('btnSearch').onclick = () => { $('searchPanel').hidden ? openSearch() : ($('searchPanel').hidden = true); };
$('closeSearch').onclick = () => { $('searchPanel').hidden = true; };
$('target').onchange = () => { S.target = $('target').value; };

async function doSearch() {
  const d = deck(); if (!d) return;
  const q = $('q').value.trim(); if (!q) return;
  const seq = ++S.searchSeq;
  say('searchMsg', 'Cerco\u2026'); $('results').innerHTML = '';
  try {
    const res = await searchCards(q, $('onlyLegal').checked, fmtOf(d).scry);
    if (seq !== S.searchSeq) return;
    S.results = res; S.shown = 60;
    say('searchMsg', res.length ? `${res.length} carte trovate` : 'Nessuna carta trovata. Prova con parole diverse o la sintassi di Scryfall.');
    renderResults();
  } catch (e) { if (seq === S.searchSeq) say('searchMsg', e.message); }
}
$('searchForm').onsubmit = ev => { ev.preventDefault(); doSearch(); };
$('more').onclick = () => { S.shown += 60; renderResults(); };

$('deckSel').onchange = () => { S.cur = $('deckSel').value; save(); render(); };
$('fmtSel').onchange = () => { const d = deck(); if (!d) return; d.format = $('fmtSel').value; const f = fmtOf(d);
  if (!f.commander) d.cards.forEach(e => { if (e.section === 'commander') e.section = Deck.classify(S.cards[e.id] || {}); });
  if (!f.side) d.cards.forEach(e => { if (e.section === 'side') e.section = Deck.classify(S.cards[e.id] || {}); });
  save(); render(); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; store.set('mtg_view', S.view); render(); });

function newDeck(name, format) {
  const d = Deck.emptyDeck(name, format); S.decks.push(d); S.cur = d.id; save(); render();
}
$('createForm').onsubmit = ev => { ev.preventDefault(); newDeck($('newName').value.trim() || 'Nuovo mazzo', $('newFmt').value); $('newName').value = ''; $('newBox').open = false; };
$('btnRename').onclick = () => { const d = deck(); if (!d) return; const n = prompt('Nuovo nome del mazzo', d.name); if (n && n.trim()) { d.name = n.trim(); save(); render(); } };
$('btnDup').onclick = () => { const d = deck(); if (!d) return; const c = JSON.parse(JSON.stringify(d)); c.id = 'd' + Date.now().toString(36); c.name = d.name + ' (copia)'; S.decks.push(c); S.cur = c.id; save(); render(); };
$('btnDel').onclick = () => { const d = deck(); if (!d) return; if (!confirm(`Eliminare il mazzo "${d.name}"?`)) return; S.decks = S.decks.filter(x => x.id !== d.id); S.cur = S.decks.length ? S.decks[0].id : ''; save(); render(); };
$('btnExport').onclick = () => { const d = deck(); if (d) copyText(Deck.exportText(d, S.cards), 'Lista copiata (nomi inglesi, pronta per Moxfield)'); };
$('btnImport').onclick = () => { $('importBox').hidden = !$('importBox').hidden; };
$('doImport').onclick = () => importList($('importText').value, $('importReplace').checked);

for (const [k, f] of Object.entries(Deck.FORMATS)) $('newFmt').insertAdjacentHTML('beforeend', `<option value="${k}" ${k === 'pioneer' ? 'selected' : ''}>${esc(f.name)}</option>`);
if (!S.cur || !deck()) S.cur = S.decks.length ? S.decks[0].id : '';
render();
