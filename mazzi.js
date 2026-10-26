'use strict';
/* Costruttore di mazzi: dati carte da Scryfall, mazzi salvati sul dispositivo (localStorage). */
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { toast('Memoria piena: non riesco a salvare'); } },
};
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };

const S = {
  decks: jget('mtg_decks', []), cards: jget('mtg_cards', {}), cur: store.get('mtg_cur'),
  view: store.get('mtg_view') || 'grid', owned: jget('mtg_owned', {}),
  results: [], searchSeq: 0, shown: 60, target: 'auto', modalId: null,
};

S.strat = { open: store.get('mtg_strat_open') !== '0', deckId: null, colors: new Set(), sel: null, type: '', onlyOwned: false, results: [], shown: 24, msg: '', seq: 0 };
function save() { store.set('mtg_decks', JSON.stringify(S.decks)); store.set('mtg_cards', JSON.stringify(S.cards)); store.set('mtg_cur', S.cur || ''); }
const deck = () => S.decks.find(d => d.id === S.cur) || null;
const fmtOf = d => Deck.FORMATS[d.format] || Deck.FORMATS.pioneer;
const nameOf = c => c.name_it || c.name;

let toastTimer = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200); }

async function searchPages(q, maxPages, order, dir) {
  const p = { q, unique: 'cards', order: order || 'name' }; if (dir) p.dir = dir;
  const params = '?' + new URLSearchParams(p).toString();
  let r = await scry('/cards/search' + params);
  const data = (r.data || []).slice();
  let pages = 1;
  while (r.has_more && r.next_page && pages < maxPages) { r = await scry(r.next_page); data.push(...(r.data || [])); pages++; }
  return data;
}

async function searchCards(q, onlyLegal, fmtScry, extra, order, dir) {
  const base = q.trim();
  if (!base && !extra) return [];
  const legal = (onlyLegal && fmtScry ? ' f:' + fmtScry : '') + (extra ? ' ' + extra : '');
  const out = [], seen = new Set();
  const add = list => list.forEach(c => { const s = slim(c); if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } });
  const queries = [];
  const typeEn = !base || /[:=<>!"]/.test(base) ? [] : Deck.typeWordsEn(base);
  if (typeEn.length) queries.push(typeEn.map(t => 't:' + t).join(' ') + legal); // per tipo (es. chierico -> t:cleric)
  queries.push((base + legal).trim());                                          // per nome
  for (const qq of queries) {
    add(await searchPages(qq + ' lang:it', 4, order, dir));  // stampe italiane (nomi e testi in italiano)
    add(await searchPages(qq, 4, order, dir));               // tutte le altre carte, anche senza stampa italiana
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
  renderStrategy(d);
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
  if (hasOwned) h += `<div class="sub2">Hai gi\u00e0 ${ownedHave} carte su ${ownedTot} (escluse le terre base). <button class="link" id="btnMissing">Copia le mancanti</button>${missing > 0 ? ` \u00b7 <button class="link" id="btnBuy">Compra le mancanti (${missing})</button>` : ''}</div>`;
  else h += `<div class="sub2">Carica il tuo file CSV nella pagina Collezione per vedere quali carte hai gi\u00e0.</div>`;
  const cf = Deck.conflicts(S.decks, S.cards, S.owned).filter(o => o.decks.some(x => x.id === d.id));
  if (cf.length) h += `<details class="sub2" style="margin-top:6px"><summary style="cursor:pointer;color:var(--warn)">${cf.length} ${cf.length === 1 ? 'carta serve' : 'carte servono'} anche in altri mazzi ma non ne hai abbastanza</summary>` +
    cf.map(o => `<div class="msg">${esc(o.name)}: ne servono ${o.need} (${o.decks.map(x => esc(x.name) + ' ' + x.qty).join(', ')}), ne hai ${o.have}</div>`).join('') + '</details>';
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
  const bb = $('btnBuy'); if (bb) bb.onclick = () => { store.set('mtg_cart_prefill', missingText(d)); location.href = 'carrello.html'; };
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
    <div class="rn">${esc(nameOf(c))}<div>${manaHtml(c.mana)}</div></div><button data-act="radd" data-i="${i}">+ Aggiungi</button></div>`).join('');
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


// ---------- strategia e consigli
function deckColors(d) {
  const set = new Set();
  const cm = d.cards.filter(e => e.section === 'commander');
  (cm.length ? cm : d.cards.filter(e => e.section !== 'side')).forEach(e => { const c = S.cards[e.id]; if (c) (c.ci || []).forEach(x => set.add(x)); });
  return set;
}
function stratPool(d) {
  const a = Strategy.analyze(d, S.cards);
  const pool = [];
  a.tribes.forEach(t => pool.push(t.theme));
  Strategy.THEMES.forEach(t => pool.push(t));
  return { a, pool };
}
function coachHtml(co) {
  let h = '<div class="coach"><div class="steps">' + co.steps.map((x, i) => `<span class="stp ${x.done ? 'done' : ''} ${x.cur ? 'cur' : ''}">${x.done ? '\u2713' : i + 1} ${esc(x.name)}</span>`).join('') + '</div>';
  h += `<div class="ctitle">Passo ${co.idx + 1} di ${co.steps.length}: ${esc(co.title)}</div>`;
  if (co.id === 'tema' && co.quote) h += `<div class="cquote">${esc(co.quote.length > 260 ? co.quote.slice(0, 260) + '\u2026' : co.quote).replace(/\n/g, '<br>')}</div>`;
  h += `<div class="msg">${esc(co.text)}</div>`;
  if (co.progress) h += `<div class="prog"><span class="bt"><span class="bf ${co.progress.n >= co.progress.of ? 'ok' : 'warn'}" style="width:${Math.min(100, co.progress.n / co.progress.of * 100)}%"></span></span><small>${co.progress.n}/${co.progress.of}</small></div>`;
  if (co.id === 'tema' && co.themes.length > 1) h += '<div class="thm">' + co.themes.map(t => `<span class="chip ${co.chosen && co.chosen.id === t.id ? 'on' : ''}" data-act="stpick" data-t="${esc(t.id)}" title="${esc(t.desc)}">${esc(t.name)}</span>`).join('') + '</div>';
  const acts = [];
  if (co.basics) acts.push('<button data-act="stbasics">Completa con terre base</button>');
  if (co.id === 'fine') acts.push('<a href="prova.html"><button class="secondary" type="button">Prova il mazzo</button></a>');
  if (co.canSkip) acts.push(`<button class="link" data-act="stskip" data-s="${esc(co.id === 'base' ? 'base:' + co.gaps[0].role : co.id)}">Salta questo passo</button>`);
  if (acts.length) h += '<div class="row">' + acts.join('') + '</div>';
  return h + '</div>';
}
async function addBasics() {
  const d = deck(); if (!d) return;
  const { a } = stratPool(d), co = Strategy.coach(d, S.cards, a);
  const need = co.ideal - co.lands; if (need <= 0) return toast('Le terre sono gi\u00e0 sufficienti');
  const st = Deck.stats(d, S.cards), ident = [...deckColors(d)].filter(x => 'WUBRG'.includes(x));
  let cols = ident.length ? ident : Object.keys(st.pips).filter(k => st.pips[k] > 0);
  if (!cols.length) return toast('Servono carte colorate per sapere quali terre base aggiungere');
  const w = cols.map(k => Math.max(1, st.pips[k] || 0)), tot = w.reduce((x, y) => x + y, 0);
  const n = w.map(x => Math.floor(need * x / tot)); let left = need - n.reduce((x, y) => x + y, 0);
  for (let i = 0; left > 0; i = (i + 1) % cols.length, left--) n[i]++;
  const NAME = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  try {
    const r = await scry('/cards/collection', { identifiers: cols.map(k => ({ name: NAME[k] })) });
    const added = [];
    (r.data || []).forEach(x => {
      const k = cols.find(c => NAME[c] === x.name); const q = n[cols.indexOf(k)]; if (!q) return;
      const s2 = slim(x); S.cards[s2.id] = Object.assign(S.cards[s2.id] || {}, s2); Deck.addCard(d, s2.id, 'lands', q); added.push(s2.id);
    });
    save(); render(); toast('Aggiunte ' + need + ' terre base');
    await stratItalian(added.map(id => S.cards[id])); save(); render();
  } catch (e) { toast(e.message); }
}
function renderStrategy(d) {
  const st = S.strat, el = $('stratBox');
  if (st.deckId !== d.id) { st.deckId = d.id; st.colors = deckColors(d); st.sel = null; st.results = []; st.msg = ''; st.shown = 24; }
  const { a, pool } = stratPool(d);
  const co = Strategy.coach(d, S.cards, a);
  let h = `<details id="stratDet" ${st.open ? 'open' : ''}><summary>Strategia e consigli <span class="msg">\u2014 passo ${co.idx + 1}: ${esc(co.title)}</span></summary>`;
  h += coachHtml(co);
  const akey = d.id + ':' + (co.search ? co.search.id : co.id);
  if (co.search && st.open && st.autoKey !== akey) { st.autoKey = akey; st.sel = co.search; setTimeout(stratSearch, 0); }
  let an = '';
  if (a.nSpell >= 10) {
    an += `<div class="arch">Stile di gioco: <b>${esc(a.archetype.name)}</b> <span class="msg">(costo medio ${a.avg.toFixed(1)})</span><div class="msg">${esc(a.archetype.text)}</div></div>`;
    const top = a.tribes.concat(a.themes.filter(x => x.n >= 3).slice(0, 5));
    if (top.length) {
      an += '<div class="stsub">Meccaniche che gi\u00e0 emergono dal mazzo</div><div class="thm">' +
        top.map(x => `<span class="chip" data-act="sttheme" data-t="${esc(x.theme.id)}" title="${esc(x.theme.desc)}">${esc(x.theme.name)} <small>${x.n}</small></span>`).join('') + '</div>';
      an += '<div class="msg" style="margin-top:4px">Tocca una meccanica per vedere altre carte che la rafforzano. I numeri sono le copie nel mazzo che la usano.</div>';
      const best = a.themes[0];
      if (best && best.n >= 3) an += `<details style="margin-top:6px"><summary>Quali carte fanno \u00ab${esc(best.theme.name)}\u00bb</summary><div class="stcards">${esc([...new Set(best.cards.map(nameOf))].join(', '))}</div></details>`;
    } else {
      an += '<div class="msg" style="margin-top:8px">Per ora le carte non puntano a una meccanica precisa. Sceglierne una (qui sotto) rende il mazzo pi\u00f9 coerente: pi\u00f9 carte che si aiutano tra loro, meno carte "sole".</div>';
    }
    if (a.landAdvice && Math.abs(a.landAdvice.diff) >= 2) {
      const l = a.landAdvice;
      an += `<div class="gap">\u26a0 Terre: ne hai ${l.have}, per questa curva ne servirebbero circa ${l.ideal} (${l.diff > 0 ? 'qualcuna in meno' : 'qualcuna in pi\u00f9'}).</div>`;
    }
    if (a.gaps.length) {
      an += '<div class="stsub">Cosa manca</div>' + a.gaps.map(g => {
        const r = Strategy.ROLES[g.role];
        return `<div class="gap"><span>${esc(r.name)}: ne hai ${g.have}, meglio averne ${g.want}.</span><button data-act="strole" data-r="${g.role}">Suggerisci</button></div>`;
      }).join('');
    }
    if (fmtOf(d).commander === false && !a.gaps.length && a.landAdvice && Math.abs(a.landAdvice.diff) < 2) an += '<div class="gap">\u2713 Le proporzioni tra terre, rampa, pesca e rimozioni sembrano a posto.</div>';
  }
  let pk = '<details id="stPick" ' + (st.pickOpen || !co.search ? 'open' : '') + ' style="margin-top:12px"><summary>Cerca per un\'altra strategia, colori o tipo</summary><div class="thm" style="margin-top:6px">' +
    pool.map(t => `<span class="chip ${st.sel && st.sel.id === t.id ? 'on' : ''}" data-act="sttheme" data-t="${esc(t.id)}" title="${esc(t.desc)}">${esc(t.name)}</span>`).join('') + '</div>';
  pk += '<div class="thm" style="margin-top:8px">' + Object.values(Strategy.ROLES).map(r => `<span class="chip ${st.sel && st.sel.id === r.id ? 'on' : ''}" data-act="strole" data-r="${esc(r.id.split(':')[1])}">${esc(r.name)}</span>`).join('') + '</div>';
  pk += '<div class="row"><span class="msg">Colori:</span><span class="chips">' + ['W', 'U', 'B', 'R', 'G'].map(c => `<span class="chip ${st.colors.has(c) ? 'on' : ''}" data-act="stcol" data-c="${c}"><span class="pip p${c}">${c}</span></span>`).join('') + '</span>' +
    `<select id="stType" aria-label="Tipo"><option value="">Tutti i tipi</option>${[['creature', 'Creature'], ['instant', 'Istantanei'], ['sorcery', 'Stregonerie'], ['artifact', 'Artefatti'], ['enchantment', 'Incantesimi'], ['planeswalker', 'Planeswalker']].map(([v, l]) => `<option value="${v}" ${st.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` +
    `<label class="chk"><input type="checkbox" id="stOwned" ${st.onlyOwned ? 'checked' : ''}> Solo carte che ho</label></div>`;
  pk += '</details>';
  let rs = '<div class="msg" style="margin-top:8px">' + esc(st.msg) + '</div>';
  const inDeck = new Set(d.cards.map(e => S.cards[e.id] && S.cards[e.id].name).filter(Boolean));
  const view = st.results.map((c, i) => ({ c, i })).filter(x => !inDeck.has(x.c.name));
  const shown = view.slice(0, st.shown);
  if (shown.length) {
    rs += '<div class="rgrid">' + shown.map(({ c, i }) => {
      const own = ownedQty(c);
      return `<div class="rtile"><a data-act="stopen" data-i="${i}">${c.img ? `<img loading="lazy" src="${esc(c.img)}" alt="${esc(nameOf(c))}">` : `<div class="noimg">${esc(nameOf(c))}</div>`}</a>
        <div class="rn">${esc(nameOf(c))}<div>${manaHtml(c.mana)}</div></div>${Object.keys(S.owned).length ? `<div class="why">${own ? 'Ce l\'hai (' + own + ')' : ''}</div>` : ''}<button data-act="stadd" data-i="${i}">+ Aggiungi</button></div>`;
    }).join('') + '</div>';
    if (view.length > st.shown) rs += `<div class="row"><button class="secondary" data-act="stmore">Mostra altre (${view.length - st.shown})</button></div>`;
  }
  h += rs + an + pk;
  h += '</details>';
  el.innerHTML = h;
}
async function stratItalian(list) {
  const todo = list.filter(c => !c.name_it && !c.itTried);
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15); chunk.forEach(c => { c.itTried = true; });
    try {
      const q = '(' + chunk.map(c => `!"${c.name.split(' // ')[0].replace(/["\\]/g, '')}"`).join(' or ') + ') lang:it';
      const r = await scry('/cards/search?' + new URLSearchParams({ q, unique: 'cards' }).toString());
      (r.data || []).forEach(x => {
        const s = slim(x); const c = chunk.find(k => k.name.split(' // ')[0].toLowerCase() === (x.name || '').split(' // ')[0].toLowerCase());
        if (c && s.name_it) Object.assign(c, { name_it: s.name_it, type_it: s.type_it, text_it: s.text_it, img: s.img || c.img, imgBig: s.imgBig || c.imgBig });
      });
    } catch (e) { /* restano i nomi inglesi */ }
  }
}
async function stratSearch() {
  const st = S.strat, d = deck(); if (!d || !st.sel) return;
  const seq = ++st.seq, f = fmtOf(d);
  st.msg = `Cerco carte per \u00ab${st.sel.name}\u00bb\u2026`; st.results = []; st.shown = 24; renderStrategy(d);
  const cols = [...st.colors].join('').toLowerCase();
  let q = st.sel.q + ' game:paper' + (f.scry ? ' f:' + f.scry : '') + (cols ? ' id<=' + cols : '');
  const ty = st.type || st.sel.type;
  q += ty ? ' t:' + ty : ' -t:land';
  try {
    const data = await searchPages(q, 3, 'edhrec');
    if (seq !== st.seq) return;
    const seen = new Set(); let res = [];
    data.forEach(x => { const s = slim(x); if (!seen.has(s.id)) { seen.add(s.id); res.push(s); } });
    if (st.onlyOwned) res = res.filter(c => ownedQty(c) > 0);
    else if (Object.keys(S.owned).length) res = res.slice(0, 120); // l'ordine per popolarita' resta
    st.results = res;
    st.msg = res.length ? `${res.length} carte trovate, dalle pi\u00f9 usate.${f.scry ? ' Solo legali in ' + f.name + '.' : ''}` : 'Nessuna carta trovata con questi colori e filtri. Prova ad aggiungere un colore o togliere il tipo.';
    renderStrategy(d);
    await stratItalian(res.slice(0, st.shown)); if (seq === st.seq) renderStrategy(d);
  } catch (e) { if (seq === st.seq) { st.msg = e.message; renderStrategy(d); } }
}

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
    ev.preventDefault(); const was = S.target; S.target = t.dataset.sec; renderTargetSelect(d); openSearch();
    if ($('q').value.trim() && (was === 'commander' || S.target === 'commander')) doSearch();
  } else if (act === 'ropen') { const c = S.results[+t.dataset.i]; S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c); openModal(c.id, null); }
  else if (act === 'sttheme' || act === 'strole') {
    const st = S.strat; const pool = stratPool(d).pool;
    st.sel = act === 'strole' ? Strategy.ROLES[t.dataset.r] : pool.find(x => x.id === t.dataset.t);
    const co = Strategy.coach(d, S.cards, Strategy.analyze(d, S.cards));
    if (st.sel && co.id === 'cmd' && co.search) st.sel = { id: st.sel.id, name: 'Comandanti: ' + st.sel.name, q: co.search.q + ' ' + st.sel.q, section: 'commander' };
    if (st.sel) stratSearch();
  } else if (act === 'stcol') {
    const st = S.strat, c = t.dataset.c; st.colors.has(c) ? st.colors.delete(c) : st.colors.add(c);
    if (st.sel) stratSearch(); else renderStrategy(d);
  } else if (act === 'stopen') { const c = S.strat.results[+t.dataset.i]; if (c) { S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c); openModal(c.id, null); } }
  else if (act === 'stadd') { const c = S.strat.results[+t.dataset.i]; if (c) addToDeck(c, (S.strat.sel && S.strat.sel.section) || 'auto'); }
  else if (act === 'stpick') { d.strat = d.strat || {}; d.strat.theme = t.dataset.t; save(); render(); }
  else if (act === 'stskip') { d.strat = d.strat || {}; d.strat.skip = d.strat.skip || {}; d.strat.skip[t.dataset.s] = true; save(); render(); }
  else if (act === 'stbasics') addBasics();
  else if (act === 'stmore') { const st = S.strat; st.shown += 24; renderStrategy(d); stratItalian(st.results.slice(0, st.shown)).then(() => renderStrategy(d)); }
  else if (act === 'radd') { addToDeck(S.results[+t.dataset.i], $('target').value); }
});
$('modal').addEventListener('click', ev => { if (ev.target === $('modal') || ev.target.id === 'mClose') closeModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

function openSearch() { $('searchPanel').hidden = false; $('q').focus(); $('searchPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
$('btnSearch').onclick = () => { $('searchPanel').hidden ? openSearch() : ($('searchPanel').hidden = true); };
$('closeSearch').onclick = () => { $('searchPanel').hidden = true; };
$('target').onchange = () => {
  const was = S.target; S.target = $('target').value;
  if (($('q').value.trim()) && (was === 'commander' || S.target === 'commander')) doSearch(); // il comandante ha una ricerca a parte
};


// ---------- filtri della ricerca
const ADV = { colors: new Set(), rars: new Set() };
const ORDERS = { name: ['name', 'asc'], cmc: ['cmc', 'asc'], rarity: ['rarity', 'desc'], price: ['eur', 'desc'], released: ['released', 'desc'] };
function filterQuery() {
  const parts = [];
  const cols = [...ADV.colors], mode = $('fColMode').value;
  if (cols.length) {
    const real = cols.filter(c => c !== 'C').join('').toLowerCase();
    if (mode === 'any') parts.push('(' + cols.map(c => 'c:' + c.toLowerCase()).join(' or ') + ')');
    else if (mode === 'all') parts.push(real ? 'c:' + real : 'c:c');
    else if (mode === 'exact') parts.push(real ? 'c=' + real : 'c=c');
    else parts.push(real ? 'c<=' + real : 'c=c');
  }
  const mn = $('fMvMin').value.trim(), mx = $('fMvMax').value.trim();
  if (mn !== '' && mx !== '' && mn === mx) parts.push('mv=' + mn);
  else { if (mn !== '') parts.push('mv>=' + mn); if (mx !== '') parts.push('mv<=' + mx); }
  const t = $('fType').value; if (t) parts.push('t:' + t);
  if (ADV.rars.size) parts.push('(' + [...ADV.rars].map(r => 'r:' + r).join(' or ') + ')');
  const set = $('fSet').value.trim().replace(/[^A-Za-z0-9]/g, ''); if (set) parts.push('e:' + set);
  const tx = $('fText').value.trim().replace(/"/g, ''); if (tx) parts.push('o:"' + tx + '"');
  return parts.join(' ');
}
function updateFilterBadge() {
  const n = (ADV.colors.size ? 1 : 0) + ($('fMvMin').value !== '' || $('fMvMax').value !== '' ? 1 : 0) + ($('fType').value ? 1 : 0) + (ADV.rars.size ? 1 : 0) + ($('fSet').value.trim() ? 1 : 0) + ($('fText').value.trim() ? 1 : 0) + ($('fOwned').checked ? 1 : 0);
  $('filtBadge').textContent = n ? ` (${n} attivi)` : '';
}
let filtTimer = null;
function filtersChanged() { updateFilterBadge(); clearTimeout(filtTimer); filtTimer = setTimeout(() => { if ($('q').value.trim() || filterQuery()) doSearch(); }, 450); }
$('fColors').addEventListener('click', ev => { const ch = ev.target.closest('.chip'); if (!ch) return; const k = ch.dataset.c; ADV.colors.has(k) ? ADV.colors.delete(k) : ADV.colors.add(k); ch.classList.toggle('on'); filtersChanged(); });
$('fRars').addEventListener('click', ev => { const ch = ev.target.closest('.chip'); if (!ch) return; const k = ch.dataset.r; ADV.rars.has(k) ? ADV.rars.delete(k) : ADV.rars.add(k); ch.classList.toggle('on'); filtersChanged(); });
['fColMode', 'fMvMin', 'fMvMax', 'fType', 'fOrder', 'fOwned'].forEach(id => { $(id).onchange = filtersChanged; });
['fSet', 'fText'].forEach(id => { $(id).oninput = filtersChanged; });
$('fReset').onclick = () => {
  ADV.colors.clear(); ADV.rars.clear(); document.querySelectorAll('#fColors .chip, #fRars .chip').forEach(c => c.classList.remove('on'));
  ['fMvMin', 'fMvMax', 'fSet', 'fText'].forEach(id => { $(id).value = ''; }); $('fType').value = ''; $('fColMode').value = 'any'; $('fOwned').checked = false;
  updateFilterBadge(); if ($('q').value.trim()) doSearch(); else { S.results = []; renderResults(); say('searchMsg', ''); }
};

async function doSearch() {
  const d = deck(); if (!d) return;
  const q = $('q').value.trim(); const fq = filterQuery();
  if (!q && !fq) return say('searchMsg', 'Scrivi un nome o scegli almeno un filtro.');
  const seq = ++S.searchSeq;
  say('searchMsg', 'Cerco\u2026'); $('results').innerHTML = '';
  try {
    const cmdr = $('target').value === 'commander' ? (fmtOf(d).scry === 'brawl' ? 'is:brawler' : 'is:commander') : '';
    const [ord, dir] = ORDERS[$('fOrder').value] || ORDERS.name;
    let res = await searchCards(q, $('onlyLegal').checked, fmtOf(d).scry, [cmdr, fq].filter(Boolean).join(' '), ord, dir);
    if ($('fOwned').checked) res = res.filter(c => (S.owned[(c.name || '').toLowerCase()] || 0) > 0);
    if (seq !== S.searchSeq) return;
    S.results = res; S.shown = 60;
    say('searchMsg', res.length ? `${res.length} carte trovate${cmdr ? ' (solo possibili comandanti)' : ''}` : (cmdr ? 'Nessun possibile comandante trovato (solo creature leggendarie e simili).' : 'Nessuna carta trovata. Prova con parole diverse o la sintassi di Scryfall.'));
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
$('btnExport').onclick = () => {
  const d = deck(); if (!d) return; const txt = Deck.exportText(d, S.cards);
  const canShare = !!navigator.share;
  $('mBody').innerHTML = `<div class="minfo" style="flex:1 1 100%"><h3>Esporta &laquo;${esc(d.name)}&raquo;</h3>
    <div class="msg">Lista con i nomi inglesi, nel formato di Arena, Moxfield, Archidekt e simili.</div>
    <textarea id="exTxt" readonly rows="12" style="width:100%;margin-top:8px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:8px;border-radius:8px">${esc(txt)}</textarea>
    <div class="row" style="margin-top:8px"><button id="exCopy">Copia</button><button id="exFile" class="secondary">Scarica .txt</button>${canShare ? '<button id="exShare" class="secondary">Condividi</button>' : ''}</div>
    <details style="margin-top:10px"><summary>Come importarla in Arena</summary><div class="msg" style="margin-top:6px">Copia la lista, poi in Arena apri <b>Mazzi</b> e premi <b>Importa</b> (in basso a sinistra): il mazzo compare come &laquo;Imported Deck&raquo;.<br>Questo passaggio &egrave; descritto per la versione per computer; non ho trovato conferma che ci sia anche da telefono. Se da telefono non vedi il pulsante Importa, usa Arena sul computer.<br>Arena accetta solo carte che esistono su Arena: quelle assenti vengono segnalate o ignorate.</div></details></div>`;
  $('modal').hidden = false; document.body.classList.add('noscroll');
  const ta = $('exTxt'); ta.onfocus = () => ta.select();
  $('exCopy').onclick = () => copyText(txt, 'Lista copiata');
  $('exFile').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = (d.name || 'mazzo').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  if ($('exShare')) $('exShare').onclick = () => { navigator.share({ title: d.name, text: txt }).catch(() => {}); };
};
$('btnImport').onclick = () => { $('importBox').hidden = !$('importBox').hidden; };
$('doImport').onclick = () => importList($('importText').value, $('importReplace').checked);

for (const [k, f] of Object.entries(Deck.FORMATS)) $('newFmt').insertAdjacentHTML('beforeend', `<option value="${k}" ${k === 'pioneer' ? 'selected' : ''}>${esc(f.name)}</option>`);
if (!S.cur || !deck()) S.cur = S.decks.length ? S.decks[0].id : '';
render();

document.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'stPick') S.strat.pickOpen = ev.target.open; if (ev.target && ev.target.id === 'stratDet') { S.strat.open = ev.target.open; store.set('mtg_strat_open', ev.target.open ? '1' : '0'); } }, true);
document.addEventListener('change', ev => {
  if (ev.target.id === 'stType') { S.strat.type = ev.target.value; if (S.strat.sel) stratSearch(); }
  else if (ev.target.id === 'stOwned') { S.strat.onlyOwned = ev.target.checked; if (S.strat.sel) stratSearch(); }
});
