'use strict';
const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const eur = v => v == null ? '-' : v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
let WISH = []; try { WISH = JSON.parse(store.get('mtg_wish')) || []; } catch (e) { WISH = []; }
const save = () => store.set('mtg_wish', JSON.stringify(WISH));
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; setTimeout(() => { el.hidden = true; }, 2200); }
const imgOf = c => { const f = (c.card_faces || [])[0] || {}; const iu = c.image_uris || f.image_uris || {}; return iu.small || iu.normal || ''; };
const q = s => s.replace(/"/g, '');

async function find() {
  const t = $('q').value.trim(); if (t.length < 2) return;
  $('res').innerHTML = '<div class="msg">Cerco…</div>';
  try {
    let r = await scry('/cards/search?unique=cards&order=name&q=' + encodeURIComponent('lang:it name:"' + q(t) + '"'));
    let items = (r.data || []).map(c => ({ name: c.name, nameIt: c.printed_name || null, img: imgOf(c), enName: null }));
    if (!items.length) { r = await scry('/cards/search?unique=cards&order=name&q=' + encodeURIComponent('name:"' + q(t) + '"')); items = (r.data || []).map(c => ({ name: c.name, nameIt: null, img: imgOf(c) })); }
    // le ricerche in italiano restituiscono la stampa italiana: ricavo il nome inglese da oracle_id
    if (r.data && r.data.length && r.data[0].lang === 'it') items = (r.data || []).map(c => ({ name: c.name, nameIt: c.printed_name || c.name, img: imgOf(c) }));
    items = items.slice(0, 8);
    $('res').innerHTML = items.length ? items.map((x, i) => '<div class="res"><img loading="lazy" src="' + esc(x.img) + '" alt=""><div><b>' + esc(x.nameIt || x.name) + '</b>' + (x.nameIt && x.nameIt !== x.name ? '<div class="msg">' + esc(x.name) + '</div>' : '') + '</div><button data-add="' + i + '">Aggiungi</button></div>').join('') : '<div class="msg">Nessuna carta trovata.</div>';
    $('res').querySelectorAll('[data-add]').forEach(b => { b.onclick = () => add(items[+b.dataset.add]); });
  } catch (e) { $('res').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
}
function add(x) {
  const ex = WISH.find(w => w.name === x.name);
  if (ex) { ex.qty++; } else WISH.push({ name: x.name, nameIt: x.nameIt, img: x.img, qty: 1, max: null, price: null, set: null, t: 0 });
  save(); render(); toast('Aggiunta alla lista'); checkOne(WISH.find(w => w.name === x.name)).then(() => { save(); render(); });
}
async function checkOne(w) {
  try {
    const r = await scry('/cards/search?unique=prints&order=eur&dir=asc&q=' + encodeURIComponent('!"' + q(w.name) + '" game:paper'));
    const p = (r.data || []).map(c => ({ v: parseFloat(c.prices && c.prices.eur), s: c.set_name })).filter(x => x.v > 0)[0];
    w.price = p ? p.v : null; w.set = p ? p.s : null; w.t = Date.now();
  } catch (e) { /* resta il valore precedente */ }
}
async function checkAll() {
  $('btnCheck').disabled = true;
  for (let i = 0; i < WISH.length; i++) { $('stat').textContent = 'Controllo ' + (i + 1) + '/' + WISH.length + '…'; await checkOne(WISH[i]); save(); render(); }
  $('stat').textContent = 'Prezzi aggiornati alle ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + '.'; $('btnCheck').disabled = false;
}
const isDeal = w => w.price != null && w.max != null && w.max > 0 && w.price <= w.max;
function render() {
  $('cnt').textContent = WISH.length + (WISH.length === 1 ? ' carta' : ' carte');
  $('btnCart').disabled = !WISH.length;
  const sorted = WISH.map((w, i) => [w, i]).sort((a, b) => (isDeal(b[0]) - isDeal(a[0])));
  $('list').innerHTML = WISH.length ? sorted.map(([w, i]) => '<div class="w' + (isDeal(w) ? ' deal' : '') + '"><span></span><img loading="lazy" src="' + esc(w.img) + '" alt=""><div><div class="nm">' + esc(w.nameIt || w.name) + (w.qty > 1 ? ' ×' + w.qty : '') + '</div><div class="sub">' + (w.price != null ? '<span class="pz">Da ' + eur(w.price) + '</span> · ' + esc(w.set) : 'Prezzo non ancora controllato') + (isDeal(w) ? ' · <b class="pz">Occasione!</b>' : '') + '</div></div><div class="ctl"><label>Max € <input type="number" step="0.05" min="0" data-max="' + i + '" value="' + (w.max == null ? '' : w.max) + '"></label><label>Copie <input type="number" min="1" max="99" data-qty="' + i + '" value="' + w.qty + '"></label><button class="secondary" data-del="' + i + '">Togli</button></div></div>').join('') : '<div class="msg" style="padding:8px 0">La lista è vuota: cerca una carta qui sopra.</div>';
  $('list').querySelectorAll('[data-max]').forEach(el => { el.onchange = () => { const v = parseFloat(el.value.replace(',', '.')); WISH[+el.dataset.max].max = v > 0 ? v : null; save(); setTimeout(render, 0); }; });
  $('list').querySelectorAll('[data-qty]').forEach(el => { el.onchange = () => { WISH[+el.dataset.qty].qty = Math.max(1, parseInt(el.value, 10) || 1); save(); setTimeout(render, 0); }; });
  $('list').querySelectorAll('[data-del]').forEach(el => { el.onclick = () => { WISH.splice(+el.dataset.del, 1); save(); setTimeout(render, 0); }; });
}
$('btnFind').onclick = find; $('q').onkeydown = e => { if (e.key === 'Enter') find(); };
$('btnCheck').onclick = checkAll;
$('btnCart').onclick = () => { store.set('mtg_cart_prefill', WISH.map(w => w.qty + ' ' + w.name).join('\n')); location.href = 'carrello.html'; };
render();
if (WISH.some(w => Date.now() - (w.t || 0) > 12 * 3600 * 1000)) checkAll();
