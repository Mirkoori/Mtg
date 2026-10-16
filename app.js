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
  const m = /^"?sep=(.)"?$/i.exec(text.split('\n', 1)[0].trim());
  if (m) { delim = m[1]; text = text.slice(text.indexOf('\n') + 1); }
  const rows = parseCSV(text, delim).filter(r => r.length > 1);
  const head = rows.shift() || [];
  const ix = n => head.findIndex(h => h.trim().toLowerCase() === n);
  const iName = ix('card name'), iSet = ix('set code'), iQty = ix('quantity');
  if (iName < 0) { state.owned = []; return say('msgCsv', 'Colonna "Card Name" non trovata nel file.', 'err'); }
  state.owned = rows.filter(r => r[iName]).map(r => ({
    name: r[iName], set: iSet >= 0 ? r[iSet] : '', qty: iQty >= 0 ? (parseInt(r[iQty]) || 1) : 1 }));
  const unique = new Set(state.owned.map(o => o.name.toLowerCase())).size;
  say('msgCsv', `Caricate ${state.owned.reduce((a, o) => a + o.qty, 0)} carte (${unique} nomi diversi).`, 'ok');
};

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
    if (state.plan.italian_names) say('msgPreview', ''); else say('msgPreview', 'Nomi italiani non disponibili: mostro quelli inglesi.', 'warn');
  } catch (e) { say('msgPreview', e.message, 'err'); }
  $('btnPreview').disabled = false;
};
function renderPlan() {
  const p = state.plan; $('previewBox').hidden = false;
  $('rows').innerHTML = p.items.map((it, i) => `<tr>
    <td><input type="checkbox" data-i="${i}" checked></td>
    <td>${esc(it.name_it)}${it.version ? ' <span class="en">(' + esc(it.version) + ')</span>' : ''}${it.name_it !== it.name_en ? '<div class="en">' + esc(it.name_en) + '</div>' : ''}</td>
    <td class="hide-sm">${esc(it.collector_number || '')}</td>
    <td class="hide-sm">${esc(it.condition)} \u00b7 ${esc((it.language || '').toUpperCase())}${it.foil ? ' \u00b7 foil' : ''}</td>
    <td class="num">${it.qty}</td><td class="num">${money(it.price_cents, it.currency)}</td></tr>`).join('');
  $('rows').querySelectorAll('input').forEach(c => c.onchange = updateSummary);
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

// ---- aggiunta al carrello
$('btnAdd').onclick = async () => {
  const sel = selected(); if (!sel.length) return;
  const cards = sel.reduce((a, i) => a + i.qty, 0);
  if (!confirm(`Aggiungo ${cards} carte al tuo carrello Cardtrader (CardTrader Zero).\nNon viene acquistato nulla: il pagamento lo fai tu dal sito.\n\nProcedo?`)) return;
  $('btnAdd').disabled = true; $('btnPreview').disabled = true;
  const prog = $('prog'); prog.hidden = false; prog.max = sel.length; prog.value = 0;
  $('result').innerHTML = '';
  let before = null; try { before = await Core.cart(token()); } catch (e) {}
  let ok = 0; const fails = [];
  for (let i = 0; i < sel.length; i++) {
    const it = sel[i];
    say('msgAdd', `Aggiungo ${i + 1}/${sel.length}: ${it.name_it}`);
    try { await Core.cartAdd(token(), it.product_id, it.qty); ok++; }
    catch (e) { fails.push({ it, msg: e.message }); }
    prog.value = i + 1; await sleep(150);
  }
  let after = null; try { after = await Core.cart(token()); } catch (e) {}
  say('msgAdd', '');
  let html = `<p class="msg ${fails.length ? 'warn' : 'ok'}" style="font-size:14px">Aggiunte ${ok} righe su ${sel.length}.` +
    (after ? ` Il carrello ora contiene ${after.items} carte${after.subtotal ? ' (' + money(after.subtotal.cents, after.subtotal.currency) + ')' : ''}${before && before.items ? `, di cui ${before.items} c'erano gi\u00e0` : ''}.` : '') + '</p>';
  if (fails.length) html += '<details open><summary>Non aggiunte</summary>' + fails.map(f => `<div>${esc(f.it.name_it)} <span class="en">\u2014 ${esc(f.msg)}</span></div>`).join('') + '</details>';
  html += '<p><a href="https://www.cardtrader.com/cart" target="_blank" rel="noopener">Apri il carrello su Cardtrader \u2192</a></p>';
  $('result').innerHTML = html;
  $('btnAdd').disabled = false; $('btnPreview').disabled = false;
};
