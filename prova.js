'use strict';
/* Campo di prova: pesca e gioca le carte di un mazzo salvato. Nessun controllo delle regole. */
const $ = id => document.getElementById(id);
const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const DECKS = jget('mtg_decks', []);
const CARDS = jget('mtg_cards', {});
const G = { lib: [], hand: [], bf: [], gy: [], ex: [], cmd: [], life: 20, pois: 0, turn: 1, log: [], hist: [], uid: 0, deck: null, mulls: 0 };
const nm = c => (c.token ? c.name : ((CARDS[c.id] && (CARDS[c.id].name_it || CARDS[c.id].name)) || '?'));
const data = c => CARDS[c.id] || {};
let toastT = null;
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { e.hidden = true; }, 2200); }
function say(t) { G.log.unshift('T' + G.turn + ': ' + t); G.log = G.log.slice(0, 80); }
function snap() { G.hist.push(JSON.stringify({ lib: G.lib, hand: G.hand, bf: G.bf, gy: G.gy, ex: G.ex, cmd: G.cmd, life: G.life, pois: G.pois, turn: G.turn, uid: G.uid, mulls: G.mulls })); if (G.hist.length > 60) G.hist.shift(); }
function undo() { const s = G.hist.pop(); if (!s) { toast('Niente da annullare'); return; } Object.assign(G, JSON.parse(s)); render(); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
const mk = id => ({ uid: ++G.uid, id: id, tapped: false, cnt: 0 });

function fillDecks() {
  const sel = $('deckSel');
  if (!DECKS.length) { sel.innerHTML = '<option>Nessun mazzo salvato</option>'; $('btnStart').disabled = true; $('setupMsg').innerHTML = 'Crea prima un mazzo nella pagina <a href="mazzi.html">Mazzi</a>.'; return; }
  const cur = localStorage.getItem('mtg_cur');
  sel.innerHTML = DECKS.map(d => '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + ' (' + esc((Deck.FORMATS[d.format] || {}).name || d.format) + ')</option>').join('');
}

function start() {
  const d = DECKS.find(x => x.id === $('deckSel').value); if (!d) return;
  G.deck = d; G.hist = []; G.log = []; G.uid = 0; G.mulls = 0;
  G.lib = []; G.hand = []; G.bf = []; G.gy = []; G.ex = []; G.cmd = [];
  d.cards.forEach(e => {
    if (e.section === 'side') return;
    for (let i = 0; i < e.qty; i++) (e.section === 'commander' ? G.cmd : G.lib).push(mk(e.id));
  });
  if (!G.lib.length) { $('setupMsg').textContent = 'Il mazzo e vuoto.'; return; }
  const fm = Deck.FORMATS[d.format] || {};
  G.life = fm.commander ? 40 : 20; G.pois = 0; G.turn = 1;
  shuffle(G.lib); draw(7, true);
  $('setupMsg').textContent = ''; $('game').hidden = false; $('hand').hidden = false;
  say('Nuova partita con ' + d.name); render();
}
function draw(n, quiet) {
  for (let i = 0; i < n; i++) { const c = G.lib.shift(); if (!c) { toast('Grimorio finito'); break; } G.hand.push(c); }
  if (!quiet) say('pesca ' + n);
}
function mulligan() {
  snap(); G.lib = G.lib.concat(G.hand); G.hand = []; shuffle(G.lib); G.mulls++;
  draw(7, true); say('mulligan ' + G.mulls + ' (tieni 7, poi metti ' + G.mulls + ' in fondo)');
  toast('Mulligan: metti in fondo ' + G.mulls + ' carte dal menu della carta'); render();
}
function nextTurn() { snap(); G.turn++; G.bf.forEach(c => { c.tapped = false; }); draw(1, true); say('nuovo turno, stacca e pesca'); render(); }

function find(zone, uid) { const a = G[zone]; const i = a.findIndex(c => c.uid === uid); return { a: a, i: i, c: a[i] }; }
function moveTo(zone, uid, dest, where) {
  const f = find(zone, uid); if (!f.c) return; snap();
  f.a.splice(f.i, 1);
  if (f.c.token && dest !== 'bf') { say('gettone ' + f.c.name + ' rimosso'); render(); return; }
  f.c.tapped = false; if (dest !== 'bf') f.c.cnt = 0;
  if (where === 'top') G[dest].unshift(f.c); else G[dest].push(f.c);
  say(nm(f.c) + ' -> ' + ({ bf: 'campo', hand: 'mano', gy: 'cimitero', ex: 'esilio', lib: 'grimorio', cmd: 'comando' })[dest]);
  render();
}
function cardHtml(c, zone) {
  const d = data(c); const cls = 'card' + (c.tapped ? ' tapped' : '') + (c.token ? ' token' : '');
  const img = c.token ? '<div class="noimg">' + esc(c.name) + (c.pt ? '<br>' + esc(c.pt) : '') + '</div>' : (d.img ? '<img loading="lazy" src="' + esc(d.img) + '" alt="' + esc(nm(c)) + '">' : '<div class="noimg">' + esc(nm(c)) + '</div>');
  return '<div class="' + cls + '" data-z="' + zone + '" data-u="' + c.uid + '">' + img + (c.cnt ? '<span class="cb">' + (c.cnt > 0 ? '+' : '') + c.cnt + '</span>' : '') + '</div>';
}
function render() {
  const lane = { laneOther: [], laneCreature: [], laneLand: [] };
  G.bf.forEach(c => {
    const d = data(c); const t = c.token ? (c.isCre ? 'c' : 'o') : (Deck.isLand(d) ? 'l' : (/Creature/.test(d.type || '') ? 'c' : 'o'));
    lane[t === 'l' ? 'laneLand' : t === 'c' ? 'laneCreature' : 'laneOther'].push(c);
  });
  Object.keys(lane).forEach(k => { $(k).innerHTML = lane[k].map(c => cardHtml(c, 'bf')).join('') || '<span class="msg">vuoto</span>'; });
  $('handStrip').innerHTML = G.hand.map(c => cardHtml(c, 'hand')).join('');
  $('handCount').textContent = G.hand.length + (G.hand.length === 1 ? ' carta' : ' carte');
  $('nLib').textContent = G.lib.length; $('nGy').textContent = G.gy.length; $('nEx').textContent = G.ex.length; $('nCmd').textContent = G.cmd.length;
  $('zCmd').hidden = !G.cmd.length;
  $('turn').textContent = G.turn; $('life').textContent = G.life; $('pois').textContent = G.pois;
  $('log').innerHTML = G.log.map(esc).join('<br>');
}

function openSheet(html) { $('sBody').innerHTML = html; $('sheet').hidden = false; document.body.classList.add('noscroll'); }
function closeSheet() { $('sheet').hidden = true; document.body.classList.remove('noscroll'); }
function cardMenu(zone, uid) {
  const f = find(zone, uid); const c = f.c; if (!c) return;
  const d = data(c); const big = d.imgBig || d.img;
  const b = (a, t, cls) => '<button class="' + (cls || '') + '" data-a="' + a + '">' + t + '</button>';
  let acts = '';
  if (zone === 'hand') acts = b('play', 'Gioca sul campo') + b('gy', 'Cimitero', 'secondary') + b('ex', 'Esilio', 'secondary') + b('top', 'In cima al grimorio', 'secondary') + b('bot', 'In fondo al grimorio', 'secondary');
  else if (zone === 'bf') acts = b('tap', c.tapped ? 'Stacca' : 'Tappa') + b('p1', '+1 segnalino', 'secondary') + b('m1', '-1 segnalino', 'secondary') + b('gy', 'Cimitero', 'secondary') + b('ex', 'Esilio', 'secondary') + b('hand', 'In mano', 'secondary') + b('top', 'In cima al grimorio', 'secondary') + b('bot', 'In fondo al grimorio', 'secondary') + (c.token ? '' : b('copy', 'Crea copia (gettone)', 'secondary'));
  else acts = b('play', 'Gioca sul campo') + b('hand', 'In mano', 'secondary') + b('gy', 'Cimitero', 'secondary') + b('ex', 'Esilio', 'secondary') + b('top', 'In cima al grimorio', 'secondary') + b('bot', 'In fondo al grimorio', 'secondary');
  openSheet('<div class="big">' + (c.token ? '<div class="noimg" style="width:220px">' + esc(c.name) + '</div>' : (big ? '<img src="' + esc(big) + '" alt="">' : '')) + '<div style="flex:1;min-width:200px"><h3 style="margin:0">' + esc(nm(c)) + '</h3><div class="msg">' + esc(d.type_it || d.type || '') + ' ' + (d.mana ? manaHtml(d.mana) : '') + '</div><div class="otext">' + esc(d.text_it || d.text || '').replace(/\n/g, '<br>') + '</div><div class="acts">' + acts + '</div></div></div>');
  $('sBody').dataset.z = zone; $('sBody').dataset.u = uid;
}
function cardAct(a) {
  const zone = $('sBody').dataset.z, uid = +$('sBody').dataset.u; const f = find(zone, uid); if (!f.c) return;
  if (a === 'tap') { snap(); f.c.tapped = !f.c.tapped; render(); closeSheet(); return; }
  if (a === 'p1' || a === 'm1') { snap(); f.c.cnt += a === 'p1' ? 1 : -1; render(); cardMenu(zone, uid); return; }
  if (a === 'copy') { snap(); const t = { uid: ++G.uid, id: f.c.id, token: true, name: 'Copia di ' + nm(f.c), tapped: false, cnt: 0, isCre: /Creature/.test(data(f.c).type || '') }; G.bf.push(t); say('copia di ' + nm(f.c)); render(); closeSheet(); return; }
  const map = { play: ['bf'], gy: ['gy'], ex: ['ex'], hand: ['hand'], top: ['lib', 'top'], bot: ['lib', 'bot'] };
  const m = map[a]; moveTo(zone, uid, m[0], m[1] === 'top' ? 'top' : undefined); closeSheet();
}
function zoneView(z) {
  const names = { library: 'Grimorio', graveyard: 'Cimitero', exile: 'Esilio', command: 'Zona di comando' };
  const key = { library: 'lib', graveyard: 'gy', exile: 'ex', command: 'cmd' }[z];
  let arr = G[key].slice();
  if (z === 'library') { arr = arr.map(c => c); arr.sort((a, b) => nm(a).localeCompare(nm(b), 'it')); }
  const note = z === 'library' ? '<div class="msg">Elenco in ordine alfabetico (non e l\'ordine reale). Tocca una carta per metterla in mano o sul campo.</div>' : '';
  openSheet('<h3 style="margin:0">' + names[z] + ' (' + arr.length + ')</h3>' + note + '<div class="sgrid">' + (arr.map(c => cardHtml(c, key)).join('') || '<span class="msg">vuoto</span>') + '</div>');
  $('sBody').dataset.view = z;
}
function scryTop() {
  const n = parseInt(prompt('Quante carte guardare dalla cima?', '3'), 10); if (!n || n < 1) return;
  const top = G.lib.slice(0, n);
  openSheet('<h3 style="margin:0">Prime ' + top.length + ' carte</h3><div class="msg">Tocca una carta per scegliere dove metterla.</div><div class="sgrid">' + top.map(c => cardHtml(c, 'lib')).join('') + '</div>');
}
function addToken() {
  const name = prompt('Nome del gettone', 'Gettone'); if (!name) return;
  const pt = prompt('Forza/Costituzione (lascia vuoto se non e una creatura)', '1/1');
  snap(); G.bf.push({ uid: ++G.uid, id: '', token: true, name: name, pt: pt || '', tapped: false, cnt: 0, isCre: !!pt }); say('gettone ' + name); render();
}
function binom(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
function probs() {
  const N = G.lib.length; const lands = G.lib.filter(c => Deck.isLand(data(c))).length;
  if (!N) { toast('Grimorio vuoto'); return; }
  const atLeast = n => { n = Math.min(n, N); return 1 - binom(N - lands, n) / binom(N, n); };
  const pc = x => Math.round(x * 100) + '%';
  openSheet('<h3 style="margin:0">Probabilit&#224;</h3><div class="otext">Nel grimorio: ' + N + ' carte, di cui ' + lands + ' terre.<br>Terra alla prossima pescata: <b>' + pc(lands / N) + '</b><br>Almeno una terra nelle prossime 2: <b>' + pc(atLeast(2)) + '</b><br>Almeno una terra nelle prossime 4: <b>' + pc(atLeast(4)) + '</b></div><div class="msg">Calcolo sulle carte rimaste, non conosce l\'ordine del mazzo.</div>');
}

document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#sClose')) { closeSheet(); return; }
  if (t.id === 'sheet') { closeSheet(); return; }
  const act = t.closest('#sBody .acts button'); if (act) { cardAct(act.dataset.a); return; }
  const card = t.closest('.card[data-u]');
  if (card) {
    const z = card.dataset.z, uid = +card.dataset.u;
    if (z === 'lib' || z === 'gy' || z === 'ex' || z === 'cmd') { $('sBody').dataset.z = z; $('sBody').dataset.u = uid; cardMenu(z, uid); return; }
    if (z === 'bf' && !$('sheet').hidden) { cardMenu(z, uid); return; }
    cardMenu(z, uid); return;
  }
  const zb = t.closest('[data-zone]'); if (zb) { zoneView(zb.dataset.zone); return; }
  const li = t.closest('[data-life]'); if (li) { snap(); G.life += +li.dataset.life; say('vita ' + G.life); render(); return; }
  const po = t.closest('[data-pois]'); if (po) { snap(); G.pois = Math.max(0, G.pois + +po.dataset.pois); render(); return; }
});
document.addEventListener('dblclick', e => {
  const card = e.target.closest('.card[data-z="bf"]'); if (!card) return;
  const f = find('bf', +card.dataset.u); if (f.c) { snap(); f.c.tapped = !f.c.tapped; render(); closeSheet(); }
});
$('btnStart').onclick = start;
$('btnDraw').onclick = () => { snap(); draw(1); render(); };
$('btnShuffle').onclick = () => { snap(); shuffle(G.lib); say('rimescola'); toast('Grimorio rimescolato'); render(); };
$('btnMull').onclick = mulligan;
$('btnScry').onclick = scryTop;
$('btnToken').onclick = addToken;
$('btnProb').onclick = probs;
$('btnTurn').onclick = nextTurn;
$('btnUndo').onclick = undo;
fillDecks();
