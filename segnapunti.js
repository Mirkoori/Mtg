'use strict';
/* Segnapunti per il tavolo: vita, veleno, danno da comandante, dadi e moneta. */
const $ = id => document.getElementById(id);
const KEY = 'mtg_score';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const rnd = n => { const a = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(a); return a[0] % n; };
let G = null, HIST = [], opt = { n: 4, life: 40, cmd: true, flip: true };
try { Object.assign(opt, JSON.parse(store.get(KEY + '_opt')) || {}); } catch (e) {}
try { G = JSON.parse(store.get(KEY)); } catch (e) { G = null; }
const timers = {};

function seg(id, vals, cur, fn) {
  $(id).innerHTML = vals.map(v => '<button data-v="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + v + '</button>').join('');
  $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; fn(+b.dataset.v); seg(id, vals, +b.dataset.v, fn); };
}
function drawSetup() {
  seg('segN', [2, 3, 4, 5, 6], opt.n, v => { opt.n = v; opt.flip = v === 2 || v === 4; $('optFlip').checked = opt.flip; });
  seg('segL', [20, 30, 40], opt.life, v => { opt.life = v; $('optCmd').checked = v === 40; opt.cmd = v === 40; });
  $('optCmd').checked = !!opt.cmd; $('optFlip').checked = !!opt.flip;
}
function newGame() {
  opt.cmd = $('optCmd').checked; opt.flip = $('optFlip').checked; store.set(KEY + '_opt', JSON.stringify(opt));
  G = { n: opt.n, start: opt.life, cmd: opt.cmd, flip: opt.flip, p: [] };
  for (let i = 0; i < G.n; i++) G.p.push({ name: 'Giocatore ' + (i + 1), life: G.start, poison: 0, dmg: new Array(G.n).fill(0) });
  HIST = []; save(); show();
}
function save() { store.set(KEY, JSON.stringify(G)); }
function snap() { HIST.push(JSON.stringify(G)); if (HIST.length > 80) HIST.shift(); }
function undo() { if (!HIST.length) return; G = JSON.parse(HIST.pop()); save(); render(); }
const isDead = p => p.life <= 0 || p.poison >= 10 || (G.cmd && p.dmg.some(x => x >= 21));

function layout() {
  const n = G.n, b = $('board');
  const cols = n === 2 ? 1 : 2; b.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
  b.style.gridTemplateRows = 'repeat(' + Math.ceil(n / cols) + ',1fr)';
}
function render() {
  const b = $('board'); layout();
  const n = G.n, cols = n === 2 ? 1 : 2, rows = Math.ceil(n / cols);
  b.innerHTML = G.p.map((p, i) => {
    const row = Math.floor(i / cols), flip = G.flip && (n === 2 ? i === 0 : row < rows / 2 - (rows % 2 ? 0.5 : 0));
    const cm = G.cmd ? Math.max.apply(null, p.dmg) : 0;
    return '<div class="pl c' + (i % 6) + (flip ? ' flip' : '') + (isDead(p) ? ' dead' : '') + '" data-i="' + i + '"><div class="top"><input class="nm" value="' + esc(p.name) + '" data-name="' + i + '" aria-label="Nome" maxlength="18">' +
      '<span class="msg" style="color:#fff;opacity:.8">' + (isDead(p) ? 'eliminato' : '') + '</span></div>' +
      '<button class="hit m" data-d="-1" aria-label="Meno uno">&minus;</button><button class="hit p" data-d="1" aria-label="Pi&ugrave; uno">+</button>' +
      '<div class="life">' + p.life + '</div><div class="dlt" id="dlt' + i + '"></div>' +
      '<div class="bot"><button data-d="-5">&minus;5</button><button data-d="5">+5</button><button data-poi="1" class="' + (p.poison >= 10 ? 'alert' : '') + '">Veleno ' + p.poison + '</button>' + (G.cmd ? '<button data-cmd="1" class="' + (cm >= 21 ? 'alert' : '') + '">Comandante' + (cm ? ' ' + cm : '') + '</button>' : '') + '</div></div>';
  }).join('');
}
function show() { $('setup').hidden = true; $('board').hidden = false; $('tools').hidden = false; render(); wake(); }
const deltaAcc = {};
function bump(i, d) {
  snap(); G.p[i].life += d; save();
  deltaAcc[i] = (deltaAcc[i] || 0) + d; render();
  const el = $('dlt' + i); if (el) el.textContent = (deltaAcc[i] > 0 ? '+' : '') + deltaAcc[i];
  clearTimeout(timers[i]); timers[i] = setTimeout(() => { deltaAcc[i] = 0; const e = $('dlt' + i); if (e) e.textContent = ''; }, 1600);
}
$('board').addEventListener('click', e => {
  const tile = e.target.closest('.pl'); if (!tile) return; const i = +tile.dataset.i;
  const dBtn = e.target.closest('[data-d]'); if (dBtn) { bump(i, +dBtn.dataset.d); return; }
  if (e.target.closest('[data-poi]')) { openPoison(i); return; }
  if (e.target.closest('[data-cmd]')) { openCmd(i); return; }
});
$('board').addEventListener('change', e => { const n = e.target.closest('[data-name]'); if (n) { G.p[+n.dataset.name].name = n.value.trim() || 'Giocatore ' + (+n.dataset.name + 1); save(); } });

function openSheet(html) { $('shB').innerHTML = html; $('sheet').hidden = false; }
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true; });
function openPoison(i) {
  const p = G.p[i];
  openSheet('<b>Veleno di ' + esc(p.name) + '</b><div class="crow"><b>Segnalini veleno</b><button data-pa="-1" data-i="' + i + '">&minus;</button><span class="n' + (p.poison >= 10 ? ' lethal' : '') + '" id="pn">' + p.poison + '</span><button data-pa="1" data-i="' + i + '">+</button></div><div class="msg">Con 10 segnalini il giocatore &egrave; eliminato.</div>');
}
function openCmd(i) {
  const p = G.p[i];
  openSheet('<b>Danno da comandante subito da ' + esc(p.name) + '</b>' + G.p.map((q, j) => j === i ? '' : '<div class="crow"><b>da ' + esc(q.name) + '</b><button data-ca="-1" data-i="' + i + '" data-j="' + j + '">&minus;</button><span class="n' + (p.dmg[j] >= 21 ? ' lethal' : '') + '">' + p.dmg[j] + '</span><button data-ca="1" data-i="' + i + '" data-j="' + j + '">+</button></div>').join('') +
    '<div class="msg">Ogni punto toglie anche un punto vita. Con 21 danni dallo stesso comandante il giocatore &egrave; eliminato.</div>');
}
$('shB').addEventListener('click', e => {
  const pa = e.target.closest('[data-pa]'), ca = e.target.closest('[data-ca]');
  if (pa) { const i = +pa.dataset.i; snap(); G.p[i].poison = Math.max(0, G.p[i].poison + +pa.dataset.pa); save(); render(); openPoison(i); }
  if (ca) { const i = +ca.dataset.i, j = +ca.dataset.j, d = +ca.dataset.ca; if (d < 0 && G.p[i].dmg[j] <= 0) return; snap(); G.p[i].dmg[j] += d; G.p[i].life -= d; save(); render(); openCmd(i); }
});

function overlay(big, small) { $('ovB').textContent = big; $('ovS').textContent = small || ''; $('over').hidden = false; }
$('over').onclick = () => { $('over').hidden = true; };
$('bD6').onclick = () => overlay(String(rnd(6) + 1), 'dado a 6 facce');
$('bD20').onclick = () => overlay(String(rnd(20) + 1), 'dado a 20 facce');
$('bCoin').onclick = () => overlay(rnd(2) ? 'Testa' : 'Croce', 'moneta');
$('bFirst').onclick = () => { const i = rnd(G.n); overlay(G.p[i].name, 'inizia per primo'); };
$('bUndo').onclick = undo;
$('bMenu').onclick = () => { if (!confirm('Tornare alla scelta della nuova partita? La partita in corso resta salvata finché non ne inizi un’altra.')) return; $('setup').hidden = false; $('board').hidden = true; $('tools').hidden = true; };
$('btnGo').onclick = () => { if (G && !$('board').hidden && !confirm('Iniziare una nuova partita?')) return; newGame(); };

let lock = null;
async function wake() { try { if (navigator.wakeLock && !document.hidden) lock = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden && G && !$('board').hidden) wake(); });

drawSetup();
if (G && G.p && G.p.length) show();
