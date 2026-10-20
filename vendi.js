'use strict';
/* Vendi: dalla collezione all'inventario CardTrader (con prezzi calcolati e carta di prova). */
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const idb = (() => {
  const ready = new Promise(res => { try { const r = indexedDB.open('mtgcol', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); } });
  return { async get(k) { const d = await ready; if (!d) return undefined; return new Promise(res => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } }); } };
})();
let toastT = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
const money = v => (v || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const cnNorm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/^0+(?=\d)/, '');
const token = () => $('token').value.trim();

const COND_IT = { 'Mint': 'Mint', 'Near Mint': 'Near Mint (come nuova)', 'Slightly Played': 'Slightly Played (leggermente giocata)', 'Moderately Played': 'Moderately Played', 'Played': 'Played', 'Heavily Played': 'Heavily Played', 'Poor': 'Poor' };
$('cond').innerHTML = Core.SELL_COND.map(c => '<option value="' + c + '"' + (c === 'Near Mint' ? ' selected' : '') + '>' + COND_IT[c] + '</option>').join('');
if (store.get('ct_token')) $('token').value = store.get('ct_token');
['what', 'keep', 'basics', 'cond', 'lang', 'rule', 'floor'].forEach(id => { const v = store.get('mtg_sell_' + id); if (v != null && $(id)) $(id).value = v; });

let ROWS = [], CARDS = {}, IT = {};
const sentMap = () => jget('mtg_sell_sent', {});
const rowKey = r => [r.key, r.foil ? 'f' : 'n', r.lang, r.cond].join('|');

async function loadCollection() {
  let entries = await idb.get('entries'); const cards = await idb.get('cards'); IT = (await idb.get('it')) || {};
  const saved = jget('mtg_entries', null);
  if (saved && saved.length && (!entries || !entries.length)) entries = saved;
  CARDS = cards || {};
  if (!entries || !entries.length) return null;
  const miss = entries.filter(e => !CARDS[e.key]);
  for (let i = 0; i < miss.length; i += 75) { // carte non ancora scaricate su questo dispositivo
    const chunk = miss.slice(i, i + 75);
    const r = await scry('/cards/collection', { identifiers: chunk.map(e => e.sid ? { id: e.sid } : (e.set && e.cn ? { set: e.set, collector_number: e.cn } : { name: e.name })) });
    (r.data || []).forEach((c, j) => { const e = chunk.find(x => (x.sid && x.sid === c.id) || (x.set === c.set && cnNorm(x.cn) === cnNorm(c.collector_number)) || (x.name && x.name.toLowerCase() === c.name.toLowerCase())); if (e) CARDS[e.key] = slim(c); });
  }
  return entries.filter(e => CARDS[e.key]);
}
function deckNeed() { // copie usate nei mazzi, per nome inglese
  const cards = jget('mtg_cards', {}), need = {};
  jget('mtg_decks', []).forEach(d => (d.cards || []).forEach(e => { const c = cards[e.id]; if (!c) return; const k = String(c.name).toLowerCase(); need[k] = (need[k] || 0) + (e.qty || 1); }));
  return need;
}
function buildFromList(entries) {
  const list = jget('mtg_sell_list', {}), lang = $('lang').value, cond = $('cond').value, sent = sentMap(), rows = [];
  entries.forEach(e => {
    const s = list[e.key]; if (!s) return; const c = CARDS[e.key];
    [[false, Math.min(s.n || 0, e.qty - (e.foilQty || 0))], [true, Math.min(s.f || 0, e.foilQty || 0)]].forEach(([foil, n]) => {
      if (n <= 0) return;
      const r = { key: e.key, name: c.name, nameIt: (IT[c.id] && IT[c.id][0]) || c.name_it || c.name, set: String(c.set || e.set || '').toLowerCase(), setName: c.setName, cn: c.cn || e.cn, img: c.img, qty: n, maxQty: n, foil: foil, lang: lang, cond: cond, eur: c.eur || 0, eurFoil: c.eurFoil || 0, on: true };
      rows.push(r);
    });
  });
  rows.sort((a, b) => a.nameIt.localeCompare(b.nameIt, 'it'));
  return rows;
}
function buildRows(entries) {
  if ($('what').value === 'list') return buildFromList(entries);
  const what = $('what').value, keepN = Math.max(0, parseInt($('keep').value) || 0), basics = $('basics').value === 'yes';
  const q = $('q').value.trim().toLowerCase(), need = what === 'extra' ? deckNeed() : {};
  const lang = $('lang').value, cond = $('cond').value, sent = sentMap();
  const groups = new Map();
  entries.forEach(e => { const c = CARDS[e.key]; const k = c.name.toLowerCase(); (groups.get(k) || groups.set(k, []).get(k)).push(e); });
  const rows = [];
  groups.forEach((list, k) => {
    const c0 = CARDS[list[0].key];
    if (!basics && /Basic Land/.test(c0.type || '')) return;
    if (q && !(k.includes(q) || String(IT[c0.id] && IT[c0.id][0] || c0.name_it || '').toLowerCase().includes(q))) return;
    let keep = (need[k] || 0) + keepN;
    list.slice().sort((a, b) => (CARDS[b.key].eur || 0) - (CARDS[a.key].eur || 0)).forEach(e => {
      const c = CARDS[e.key], kept = Math.min(keep, e.qty); keep -= kept;
      let sell = e.qty - kept; if (sell <= 0) return;
      const foilQ = Math.min(e.foilQty || 0, sell);
      [[false, sell - foilQ], [true, foilQ]].forEach(([foil, n]) => {
        if (n <= 0) return;
        const r = { key: e.key, name: c.name, nameIt: (IT[c.id] && IT[c.id][0]) || c.name_it || c.name, set: String(c.set || e.set || '').toLowerCase(), setName: c.setName, cn: c.cn || e.cn, img: c.img, qty: n, maxQty: n, foil: foil, lang: lang, cond: cond, eur: c.eur || 0, eurFoil: c.eurFoil || 0, on: true };
        r.sent = !!sent[rowKey(r)]; if (r.sent) r.on = false;
        rows.push(r);
      });
    });
  });
  rows.sort((a, b) => a.nameIt.localeCompare(b.nameIt, 'it'));
  return rows;
}
function render() {
  $('resBox').hidden = !ROWS.length; $('bar').hidden = !ROWS.length; $('btnAll').hidden = !ROWS.length;
  $('list').innerHTML = ROWS.map((r, i) => {
    const bad = !!r.err || r.price == null, cls = 'it' + (bad ? ' bad' : '') + (r.sent ? ' sent' : '');
    const info = r.sent ? 'gi\u00e0 inviata' : (r.err ? r.err : (r.src === 'cardtrader' ? 'pi\u00f9 basso ora: ' + money(r.ref / 100) + ' (' + r.nOffers + ' offerte)' : (r.src === 'altra lingua' ? 'pi\u00f9 basso in altra lingua: ' + money(r.ref / 100) : (r.src === 'Scryfall' ? 'nessuna offerta: prezzo da Scryfall ' + money(r.ref / 100) : 'nessun prezzo trovato: inseriscilo tu'))));
    return '<div class="' + cls + '" data-i="' + i + '"><input type="checkbox" data-on="' + i + '"' + (r.on ? ' checked' : '') + (r.err || r.sent ? ' disabled' : '') + '>' +
      (r.img ? '<img loading="lazy" src="' + esc(r.img) + '" alt="">' : '<span></span>') +
      '<div><div class="nm">' + esc(r.nameIt) + (r.foil ? ' <span class="tag foil">foil</span>' : '') + '</div><div class="sub">' + esc(r.setName || r.set.toUpperCase()) + ' #' + esc(r.cn) + (r.version ? ' \u00b7 ' + esc(r.version) : '') + '</div><div class="sub' + (r.err ? ' err' : '') + '">' + esc(info) + '</div></div>' +
      '<div class="pr"><label class="sub">q.t\u00e0 <input type="number" min="1" max="' + r.maxQty + '" value="' + r.qty + '" data-q="' + i + '"' + (r.sent ? ' disabled' : '') + '></label>' +
      '<label class="sub">\u20ac <input type="number" min="0.02" step="0.01" value="' + (r.price == null ? '' : r.price.toFixed(2)) + '" data-p="' + i + '"' + (r.err || r.sent ? ' disabled' : '') + '></label></div></div>';
  }).join('');
  summary();
}
const sendable = () => ROWS.filter(r => r.on && !r.err && !r.sent && r.bp && r.price > 0 && r.qty > 0);
function summary() {
  const s = sendable(), cop = s.reduce((a, r) => a + r.qty, 0), tot = s.reduce((a, r) => a + r.qty * r.price, 0);
  const bad = ROWS.filter(r => r.err).length;
  $('sumTop').textContent = ROWS.length + ' righe preparate' + (bad ? ', ' + bad + ' non inseribili (in grigio)' : '') + '. Puoi cambiare quantit\u00e0 e prezzo di ogni riga o togliere la spunta.';
  $('sumBar').textContent = 'Da inviare: ' + s.length + ' righe, ' + cop + ' carte, valore totale ' + money(tot) + '.';
  $('btnTest').disabled = !s.length;
}
$('list').addEventListener('input', e => {
  const t = e.target; const r = i => ROWS[+i];
  if (t.dataset.on !== undefined) r(t.dataset.on).on = t.checked;
  else if (t.dataset.q !== undefined) r(t.dataset.q).qty = Math.max(1, Math.min(r(t.dataset.q).maxQty, parseInt(t.value) || 1));
  else if (t.dataset.p !== undefined) { const v = parseFloat(String(t.value).replace(',', '.')); r(t.dataset.p).price = v > 0 ? Math.round(v * 100) / 100 : null; }
  summary();
});
$('btnAll').onclick = () => { const all = ROWS.filter(r => !r.err && !r.sent).every(r => r.on); ROWS.forEach(r => { if (!r.err && !r.sent) r.on = !all; }); render(); };
['what', 'keep', 'basics', 'cond', 'lang', 'rule', 'floor'].forEach(id => $(id).addEventListener('change', () => store.set('mtg_sell_' + id, $(id).value)));

$('btnPlan').onclick = async () => {
  if (!token()) { $('msgPlan').className = 'msg err'; $('msgPlan').textContent = 'Incolla il token CardTrader.'; return; }
  store.set('ct_token', token());
  const msg = $('msgPlan'); msg.className = 'msg'; $('btnPlan').disabled = true; $('prog').hidden = false;
  try {
    msg.textContent = 'Leggo la collezione\u2026';
    const entries = await loadCollection();
    if (!entries) { msg.className = 'msg err'; msg.textContent = 'Non c\'\u00e8 nessuna collezione su questo dispositivo: caricala prima nella pagina Collezione.'; return; }
    ROWS = buildRows(entries);
    if (!ROWS.length) { msg.textContent = 'Non c\'\u00e8 niente da vendere con questa scelta. Nella Collezione apri una carta e usa "Da vendere", oppure scegli un\'altra opzione in "Cosa vendere".'; render(); return; }
    const planned = await Core.sellPlan(token(), ROWS, { floor: $('floor').value, rule: $('rule').value }, t => { msg.textContent = t; });
    planned.forEach((p, i) => { Object.assign(ROWS[i], p, { on: ROWS[i].on && !p.err }); });
    msg.textContent = 'Fatto. Controlla l\'elenco qui sotto.';
    render();
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Errore: ' + (e.message || e); }
  finally { $('btnPlan').disabled = false; $('prog').hidden = true; }
};

let tested = false;
function mark(r, res) { const m = sentMap(); if (res.ok) { m[rowKey(r)] = { id: res.product_id, t: Date.now() }; r.sent = true; r.on = false; const L = jget('mtg_sell_list', {}); if (L[r.key]) { const f = r.foil ? 'f' : 'n'; L[r.key][f] = Math.max(0, (L[r.key][f] || 0) - r.qty); if (!(L[r.key].n > 0) && !(L[r.key].f > 0)) delete L[r.key]; store.set('mtg_sell_list', JSON.stringify(L)); } } else { r.err = 'non inviata: ' + res.error; r.on = false; } store.set('mtg_sell_sent', JSON.stringify(m)); }
async function send(rows) {
  const items = rows.map(r => ({ blueprint_id: r.bp, price: r.price, quantity: r.qty, properties: r.props }));
  const res = await Core.sellSend(token(), items, t => { $('msgSend').textContent = t; });
  rows.forEach((r, i) => mark(r, res[i] || { ok: false, error: 'nessuna risposta' }));
  return res;
}
function explain(e) {
  const m = e.message || String(e);
  if (e.status === 401 || e.status === 403) return 'CardTrader ha rifiutato il token: per inserire carte serve un token con permesso di scrittura. (' + m + ')';
  return m;
}
$('btnTest').onclick = async () => {
  const s = sendable(); if (!s.length) return; const r = s[0];
  if (!confirm('Invio UNA carta di prova a CardTrader:\n\n' + r.qty + ' x ' + r.nameIt + (r.foil ? ' (foil)' : '') + '\n' + r.cond + ', ' + r.lang + ', ' + money(r.price) + '\n\nVa bene?')) return;
  $('btnTest').disabled = true; $('msgSend').className = 'msg';
  try {
    const res = await send([r]);
    if (res[0].ok) { tested = true; $('msgSend').className = 'msg okc'; $('msgSend').textContent = 'Carta di prova inserita (id ' + res[0].product_id + '). Controllala in "I miei oggetti" su CardTrader; se \u00e8 tutto a posto puoi inviare le altre.'; }
    else { $('msgSend').className = 'msg err'; $('msgSend').textContent = 'La carta di prova non \u00e8 stata inserita: ' + res[0].error; }
  } catch (e) { $('msgSend').className = 'msg err'; $('msgSend').textContent = explain(e); }
  render(); $('btnRest').disabled = !tested || !sendable().length; $('btnTest').disabled = !sendable().length;
};
$('btnRest').onclick = async () => {
  const s = sendable(); if (!s.length) return; const cop = s.reduce((a, r) => a + r.qty, 0), tot = s.reduce((a, r) => a + r.qty * r.price, 0);
  if (!confirm('Invio a CardTrader ' + s.length + ' righe (' + cop + ' carte, valore ' + money(tot) + ').\nPotrai poi cambiare tutto da "I miei oggetti". Procedo?')) return;
  $('btnRest').disabled = true; $('btnTest').disabled = true; $('msgSend').className = 'msg';
  try {
    const res = await send(s); const ok = res.filter(x => x.ok).length;
    $('msgSend').className = ok === res.length ? 'msg okc' : 'msg err';
    $('msgSend').textContent = ok + ' righe inserite su ' + res.length + (ok < res.length ? '. Quelle non inserite sono in grigio con il motivo.' : '. Ora vai su CardTrader, "I miei oggetti".');
  } catch (e) { $('msgSend').className = 'msg err'; $('msgSend').textContent = explain(e); }
  render(); $('btnRest').disabled = !sendable().length;
};
