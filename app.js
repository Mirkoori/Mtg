const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = { expansions: [], expansion: null, owned: [], plan: null, planOpts: null };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

function say(id, text, kind) { const el = $(id); el.textContent = text; el.className = 'msg ' + (kind || ''); }
const token = () => $('token').value.trim();
const money = (cents, cur) => (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: cur || 'EUR' });

function applyProxy() {
  const p = $('proxy').value.trim().replace(/\/+$/, '');
  Core.config.ctBase = p ? p + '/api/v2' : 'https://api.cardtrader.com/api/v2';
  return p;
}

// ---- 1. connessione
if (store.get('ct_token')) { $('token').value = store.get('ct_token'); $('remember').checked = true; }
if (store.get('ct_proxy')) { $('proxy').value = store.get('ct_proxy'); }
$('btnConnect').onclick = async () => {
  if (!token()) return say('msgConnect', 'Incolla il token.', 'err');
  const proxy = applyProxy();
  say('msgConnect', 'Verifico\u2026');
  try {
    const info = await Core.info(token());
    state.expansions = await Core.expansions(token());
    $('expList').innerHTML = state.expansions.map(e => `<option value="${esc(e.name)} (${esc(e.code.toUpperCase())})"></option>`).join('');
    $('exp').disabled = false; $('btnExp').disabled = false;
    if ($('remember').checked) store.set('ct_token', token()); else store.del('ct_token');
    if (proxy) store.set('ct_proxy', proxy); else store.del('ct_proxy');
    say('msgConnect', `Connesso (${info.name || 'app'}). ${state.expansions.length} espansioni Magic caricate.`, 'ok');
  } catch (e) { say('msgConnect', e.message, 'err'); }
};

// ---- 2. CSV
function nameKeysSafe(n) {
  const full = String(n || '').trim().toLowerCase();
  const out = new Set([full]);
  if (full.includes('//')) full.split('//').forEach(p => out.add(p.trim()));
  out.delete('');
  return [...out];
}
function parseCSV(text, delim) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
$('csv').onchange = async ev => {
  const file = ev.target.files[0]; if (!file) return;
  let text = (await file.text()).replace(/^\ufeff/, '');
  let delim = ',';
  const first = text.split('\n', 1)[0];
  if (!first.includes(',')) { if (first.includes(';')) delim = ';'; else if (first.includes('\t')) delim = '\t'; }
  const m = /^"?sep=(.)"?$/i.exec(text.split('\n', 1)[0].trim());
  if (m) { delim = m[1]; text = text.slice(text.indexOf('\n') + 1); }
  const rows = parseCSV(text, delim).filter(r => r.length > 1);
  const head = rows.shift() || [];
  const ix = n => head.findIndex(h => h.trim().toLowerCase() === n);
  const ixAny = names => { for (const n of names) { const i = ix(n); if (i >= 0) return i; } return -1; };
  const iName = ixAny(['card name', 'name', 'nome', 'nome carta']), iSet = ixAny(['set code', 'set', 'edition', 'edizione']),
    iQty = ixAny(['quantity', 'qty', 'count', 'quantita']);
  if (iName < 0) { state.owned = []; return say('msgCsv', 'Colonna del nome non trovata (cerco "Card Name" o "Name"). Colonne trovate: ' + head.map(h => h.trim()).join(', ') + '', 'err'); }
  state.owned = rows.filter(r => r[iName]).map(r => ({
    name: r[iName], set: iSet >= 0 ? r[iSet] : '', qty: iQty >= 0 ? (parseInt(r[iQty]) || 1) : 1 }));
  try { // salva l'elenco delle carte possedute per la pagina Mazzi
    const om = {};
    state.owned.forEach(o => nameKeysSafe(o.name).forEach(k => { om[k] = (om[k] || 0) + o.qty; }));
    store.set('mtg_owned', JSON.stringify(om));
  } catch (e) {}
  const unique = new Set(state.owned.map(o => o.name.toLowerCase())).size;
  say('msgCsv', `Caricate ${state.owned.reduce((a, o) => a + o.qty, 0)} carte (${unique} nomi diversi).`, 'ok');
};

// collezione gia' caricata dalla pagina Collezione
(function restoreOwned() {
  try {
    const rows = JSON.parse(store.get('mtg_owned_rows') || '[]');
    if (!rows.length) return;
    state.owned = rows.map(r => ({ name: r[0], set: r[1], qty: r[2] }));
    say('msgCsv', 'Uso la collezione salvata dalla pagina Collezione: ' + state.owned.reduce((a, o) => a + o.qty, 0) + ' carte. Puoi caricare un altro file per sostituirla.', 'ok');
  } catch (e) {}
})();

// ---- 3. espansione
function findExpansion() {
  const v = $('exp').value.trim().toLowerCase();
  return state.expansions.find(e => `${e.name} (${e.code})`.toLowerCase() === v)
      || state.expansions.find(e => e.name.toLowerCase() === v || e.code.toLowerCase() === v);
}
$('btnExp').onclick = async () => {
  const e = findExpansion();
  if (!e) return say('msgExp', 'Scegli un\'espansione dalla lista.', 'err');
  say('msgExp', 'Carico le carte dell\'espansione\u2026');
  try {
    const d = await Core.expansionInfo(token(), e.id);
    state.expansion = e;
    const order = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Special'];
    let names = Object.keys(d.rarities);
    if (!d.rarity_known) names = ['Common', 'Uncommon', 'Rare', 'Mythic'];
    const pos = n => { const i = order.indexOf(n); return i < 0 ? 99 : i; };
    names.sort((a, b) => pos(a) - pos(b));
    $('rarities').innerHTML = names.map(n =>
      `<label class="chip"><input type="checkbox" value="${esc(n)}" ${n === 'Common' ? 'checked' : ''}>${esc(n)}${d.rarities[n] ? ' (' + d.rarities[n] + ')' : ''}</label>`).join('');
    say('msgExp', `${e.name}: ${d.cards} carte diverse.`, 'ok');
    $('btnPreview').disabled = false;
  } catch (err) { say('msgExp', err.message, 'err'); }
};

// ---- 5. anteprima
function collect() {
  const e = state.expansion;
  return {
    expansion_id: e.id, expansion_code: e.code,
    rarities: [...document.querySelectorAll('#rarities input:checked')].map(i => i.value),
    copies: parseInt($('copies').value) || 1, owned_mode: $('ownedMode').value, owned: state.owned,
    language_mode: $('langMode').value, min_condition: $('cond').value, foil: $('foil').value,
    text_filter: $('textFilter').value, text_mode: $('textMode').value,
    colors: [...document.querySelectorAll('#colors input:checked')].map(i => i.value),
    max_price: parseFloat($('maxPrice').value) || 0, dedupe: $('dedupe').checked,
  };
}
$('btnPreview').onclick = async () => {
  if (!state.expansion) return;
  const req = collect();
  if (!req.rarities.length) return say('msgPreview', 'Seleziona almeno una rarit\u00e0.', 'err');
  applyProxy();
  $('btnPreview').disabled = true; say('msgPreview', 'Cerco le offerte migliori\u2026');
  try {
    state.plan = await Core.buildPlan(token(), req, t => say('msgPreview', t));
    state.planOpts = req;
    renderPlan();
    if (state.plan.color_unavailable || state.plan.text_unavailable) say('msgPreview', 'Per alcune carte non ho trovato colore o tipo: il filtro potrebbe aver escluso o lasciato qualche carta di troppo.', 'warn');
    else if (!state.plan.italian_names) say('msgPreview', 'Nomi italiani non disponibili: mostro quelli inglesi.', 'warn');
    else say('msgPreview', '');
  } catch (e) { say('msgPreview', e.message, 'err'); }
  $('btnPreview').disabled = false;
};
const COLOR_IT = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde', C: 'Incolore' };
function colorLabel(c) {
  if (!c) return '';
  if (c.startsWith('M:')) return [...c.slice(2)].map(x => COLOR_IT[x] || x).join('/');
  return COLOR_IT[c] || c;
}
function colorIcons(c) {
  if (!c) return '';
  const ks = c.startsWith('M:') ? [...c.slice(2)] : [c];
  return ks.map(x => '<span class="pip p' + esc(x) + '" title="' + esc(COLOR_IT[x] || x) + '">' + esc(x) + '</span>').join('');
}
function renderPlan() {
  const p = state.plan; $('previewBox').hidden = false;
  $('rows').innerHTML = p.items.map((it, i) => `<tr>
    <td><input type="checkbox" data-i="${i}" checked></td>
    <td><img class="thumb" data-img="${i}" alt="" hidden></td>
    <td>${esc(it.name_it)}${it.version ? ' <span class="en">(' + esc(it.version) + ')</span>' : ''}${it.name_it !== it.name_en ? '<div class="en">' + esc(it.name_en) + '</div>' : ''}<div class="show-sm">${colorIcons(it.color)}</div></td>
    <td class="hide-sm">${esc(it.collector_number || '')}</td>
    <td class="hide-sm">${colorIcons(it.color)}</td>
    <td class="hide-sm">${esc(it.condition)} \u00b7 ${esc((it.language || '').toUpperCase())}${it.foil ? ' \u00b7 foil' : ''}</td>
    <td class="num">${it.qty}</td><td class="num">${money(it.price_cents, it.currency)}</td></tr>`).join('');
  $('rows').querySelectorAll('input').forEach(c => c.onchange = updateSummary);
  loadImages(p.items);
  const miss = p.missing;
  $('missingBox').hidden = !miss.length;
  $('missingSum').textContent = `${miss.length} carte non trovate con questi filtri`;
  $('missingList').innerHTML = miss.map(m => `<div>${esc(m.name_it)} <span class="en">\u2014 ${esc(m.reason)}</span></div>`).join('');
  const ow = p.skipped_owned;
  $('ownedBox').hidden = !ow.length;
  $('ownedSum').textContent = `${ow.length} carte escluse perch\u00e9 le hai gi\u00e0`;
  $('ownedList').innerHTML = ow.map(m => `<div>${esc(m.name_it)} <span class="en">(ne hai ${m.owned})</span></div>`).join('');
  updateSummary();
}
function selected() {
  const boxes = [...$('rows').querySelectorAll('input')];
  return state.plan.items.filter((_, i) => boxes[i] && boxes[i].checked);
}
function updateSummary() {
  const sel = selected(), cur = state.plan.currency;
  const total = sel.reduce((a, i) => a + i.price_cents * i.qty, 0);
  const cards = sel.reduce((a, i) => a + i.qty, 0);
  $('summary').innerHTML = `<div><b>${cards}</b><span>carte</span></div><div><b>${money(total, cur)}</b><span>totale carte (commissioni e spedizione escluse)</span></div>`;
  $('btnAdd').disabled = !sel.length;
  $('btnAdd').textContent = `Aggiungi ${cards} carte al carrello`;
}

// ---- immagini delle carte (Scryfall)
const imgCache = {};
function cardImgs(c) {
  const u = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || null;
  return u ? { s: u.small, l: u.normal } : null;
}
async function scryCollection(ids) {
  const out = [], nf = [];
  for (let i = 0; i < ids.length; i += 75) {
    const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: ids.slice(i, i + 75) }) });
    if (!r.ok) throw new Error('scryfall ' + r.status);
    const d = await r.json(); out.push(...(d.data || [])); nf.push(...(d.not_found || []));
    await new Promise(res => setTimeout(res, 120));
  }
  return { data: out, notFound: nf };
}
async function loadImages(items) {
  const code = ((state.expansion && state.expansion.code) || '').toLowerCase();
  const keyOf = it => code + '|' + (it.collector_number || '') + '|' + it.name_en;
  const apply = () => $('rows').querySelectorAll('img[data-img]').forEach(im => {
    const it = items[+im.dataset.img]; const x = it && imgCache[keyOf(it)];
    if (x && im.hidden) { im.src = x.s; im.hidden = false; }
  });
  try {
    const need = items.filter(it => !imgCache[keyOf(it)]);
    if (!need.length) return apply();
    const ids = need.filter(it => it.collector_number).map(it => ({ set: code, collector_number: String(it.collector_number) }));
    if (ids.length) {
      const r = await scryCollection(ids);
      r.data.forEach(c => { const im = cardImgs(c); if (im) imgCache[code + '|' + c.collector_number + '|' + c.name.split(' // ')[0]] = im; if (im) imgCache['n|' + c.collector_number] = im; });
      need.forEach(it => { const im = imgCache['n|' + it.collector_number]; if (im && !imgCache[keyOf(it)]) imgCache[keyOf(it)] = im; });
    }
    const left = need.filter(it => !imgCache[keyOf(it)]);
    if (left.length) {
      const r2 = await scryCollection(left.map(it => ({ name: it.name_en.split(' // ')[0], set: code })));
      r2.data.forEach(c => { const im = cardImgs(c); if (!im) return; left.forEach(it => { if (it.name_en.split(' // ')[0].toLowerCase() === c.name.split(' // ')[0].toLowerCase()) imgCache[keyOf(it)] = im; }); });
    }
    apply();
  } catch (e) { apply(); }
}
document.addEventListener('click', e => {
  const im = e.target.closest('img[data-img]');
  if (im && state.plan) {
    const it = state.plan.items[+im.dataset.img]; const code = ((state.expansion && state.expansion.code) || '').toLowerCase();
    const x = it && imgCache[code + '|' + (it.collector_number || '') + '|' + it.name_en];
    if (x) { $('zoom').innerHTML = '<img src="' + x.l + '" alt="">'; $('zoom').hidden = false; }
    return;
  }
  if (e.target.closest('#zoom')) $('zoom').hidden = true;
});

// ---- esportazione CSV (per chiedere le carte a un amico prima di comprarle)
function csvCell(v) { v = String(v == null ? '' : v); return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCsv() {
  const sel = selected(); if (!sel.length) return say('msgAdd', 'Nessuna carta selezionata da esportare.', 'err');
  const e = state.expansion || {};
  const head = ['Name', 'Nome italiano', 'Set code', 'Set name', 'Collector number', 'Rarity', 'Colore', 'Quantity', 'Language', 'Condition', 'Foil', 'Prezzo CardTrader'];
  const lines = [head.join(';')].concat(sel.map(it => [
    it.name_en, it.name_it, (e.code || '').toLowerCase(), e.name || '', it.collector_number || '', it.rarity || '', colorLabel(it.color),
    it.qty, it.language || '', it.condition || '', it.foil ? 'foil' : 'normal', (it.price_cents / 100).toFixed(2).replace('.', ',') + ' ' + (it.currency || 'EUR'),
  ].map(csvCell).join(';')));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  const slug = String(e.name || 'carte').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url; a.download = 'carte-da-prendere-' + slug + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  say('msgAdd', 'File con ' + sel.length + ' carte esportato.', 'ok');
}
$('btnCsv').onclick = exportCsv;

// ---- aggiunta al carrello
let addTotals = { ok: 0, rows: 0 };
async function runAdd(sel, isRetry) {
  $('btnAdd').disabled = true; $('btnPreview').disabled = true;
  const prog = $('prog'); prog.hidden = false; prog.max = sel.length; prog.value = 0;
  $('result').innerHTML = '';
  let before = null; try { before = await Core.cart(token()); } catch (e) {}
  let ok = 0; const fails = [];
  for (let i = 0; i < sel.length; i++) {
    const it = sel[i];
    say('msgAdd', `${isRetry ? 'Riprovo' : 'Aggiungo'} ${i + 1}/${sel.length}: ${it.name_it}`);
    try { await Core.cartAdd(token(), it.product_id, it.qty); ok++; }
    catch (e) { fails.push({ it, msg: e.message }); }
    prog.value = i + 1; await sleep(isRetry ? 400 : 150);
  }
  let after = null; try { after = await Core.cart(token()); } catch (e) {}
  say('msgAdd', '');
  addTotals.ok += ok;
  let html = `<p class="msg ${fails.length ? 'warn' : 'ok'}" style="font-size:14px">Aggiunte ${addTotals.ok} righe su ${addTotals.rows}.` +
    (after ? ` Il carrello ora contiene ${after.items} carte${after.subtotal ? ' (' + money(after.subtotal.cents, after.subtotal.currency) + ')' : ''}${before && before.items && !isRetry ? `, di cui ${before.items} c'erano gi\u00e0` : ''}.` : '') + '</p>';
  if (fails.length) {
    html += '<details open><summary>Non aggiunte (' + fails.length + ')</summary>' + fails.map(f => `<div>${esc(f.it.name_it)} <span class="en">\u2014 ${esc(f.msg)}</span></div>`).join('') + '</details>';
    html += '<div class="actions"><button id="btnRetry" class="secondary">Riprova solo le ' + fails.length + ' non aggiunte</button></div>';
  }
  html += '<p><a href="https://www.cardtrader.com/cart" target="_blank" rel="noopener">Apri il carrello su Cardtrader \u2192</a></p>';
  $('result').innerHTML = html;
  const rb = $('btnRetry');
  if (rb) rb.onclick = () => runAdd(fails.map(f => f.it), true);
  $('btnAdd').disabled = false; $('btnPreview').disabled = false;
}
$('btnAdd').onclick = async () => {
  const sel = selected(); if (!sel.length) return;
  const cards = sel.reduce((a, i) => a + i.qty, 0);
  if (!confirm(`Aggiungo ${cards} carte al tuo carrello Cardtrader (CardTrader Zero).\nNon viene acquistato nulla: il pagamento lo fai tu dal sito.\n\nProcedo?`)) return;
  addTotals = { ok: 0, rows: sel.length };
  runAdd(sel, false);
};
