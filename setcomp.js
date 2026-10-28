'use strict';
/* Completamento espansione: quante carte hai, quali mancano e quanto costa completarla, diviso per rarita'. */
(function () {
  const RAR = [['mythic', 'Mitiche'], ['rare', 'Rare'], ['uncommon', 'Non comuni'], ['common', 'Comuni'], ['special', 'Speciali'], ['bonus', 'Bonus']];
  const SING = { mythic: 'Mitica', rare: 'Rara', uncommon: 'Non comune', common: 'Comune', special: 'Speciale', bonus: 'Bonus' };
  let ANY = (function () { try { return localStorage.getItem('mtg_setany') !== '0'; } catch (e) { return true; } })();
  const Z = { code: '', data: null, loading: false, err: '', shown: 60, seq: 0 };
  const ttl = 7 * 86400000;

  async function fetchSet(code, seq) {
    const cached = await idb.get('setdata:' + code);
    if (cached && Date.now() - cached.t < ttl) return cached;
    const all = [];
    const run = async q => { let r = await scry('/cards/search?' + new URLSearchParams({ q, unique: 'cards', order: 'set' }).toString()), n = 0; (r.data || []).forEach(x => all.push(x)); while (r.has_more && r.next_page && n++ < 8) { r = await scry(r.next_page); (r.data || []).forEach(x => all.push(x)); } };
    await run('e:' + code + ' -t:basic');
    const cards = all.map(slim).map(c => ({ n: c.name, r: c.rarity, img: c.img, eur: c.eur, cn: c.cn, id: c.id }));
    const d = { t: Date.now(), cards, it: {} };
    if (seq === Z.seq) { await idb.set('setdata:' + code, d); }
    return d;
  }
  async function loadIt(code, seq) {
    const d = Z.data; if (!d || d.itDone) return;
    try {
      let r = await scry('/cards/search?' + new URLSearchParams({ q: 'e:' + code + ' lang:it -t:basic', unique: 'cards' }).toString()), n = 0;
      const put = rs => (rs || []).forEach(x => { const s = slim(x); if (s.name_it) d.it[s.name.toLowerCase()] = s.name_it; });
      put(r.data); while (r.has_more && r.next_page && n++ < 8) { r = await scry(r.next_page); put(r.data); }
      d.itDone = true; await idb.set('setdata:' + code, d);
      if (seq === Z.seq) paint();
    } catch (e) { /* restano i nomi inglesi */ }
  }
  async function load(code) {
    const seq = ++Z.seq; Z.loading = true; Z.err = ''; Z.data = null; paint();
    try {
      const d = await fetchSet(code, seq); if (seq !== Z.seq) return;
      Z.data = d; Z.loading = false; paint(); loadIt(code, seq);
    } catch (e) { if (seq === Z.seq) { Z.loading = false; Z.err = e.message || 'Errore di rete'; paint(); } }
  }

  function paint() {
    const box = document.getElementById('setBox'); if (!box || box.hidden) return;
    const code = Z.code, sn = (C.cards && Object.values(C.cards).find(c => (c.set || '').toLowerCase() === code)) || {};
    let h = '<div class="sbh"><b>Completamento: ' + esc(sn.setName || code.toUpperCase()) + ' <small>(' + esc(code.toUpperCase()) + ')</small></b></div>';
    if (Z.loading) { box.innerHTML = h + '<div class="msg">Carico l\'elenco delle carte dell\'espansione…</div>'; return; }
    if (Z.err) { box.innerHTML = h + '<div class="msg" style="color:var(--bad)">' + esc(Z.err) + ' <button class="link" id="szRetry">Riprova</button></div>'; document.getElementById('szRetry').onclick = () => load(code); return; }
    const d = Z.data; if (!d || !d.cards.length) { box.innerHTML = h + '<div class="msg">Scryfall non ha carte per questa espansione.</div>'; return; }
    const own = new Set(), other = new Set(); C.entries.forEach(e => { const c = C.cards[e.key]; if (!c) return; const nm = String(c.name).toLowerCase(); if ((c.set || '').toLowerCase() === code) own.add(nm); else other.add(nm); });
    const has = n => own.has(n) || (ANY && other.has(n));
    const by = {}; d.cards.forEach(c => { const k = by[c.r] = by[c.r] || { tot: 0, have: 0, miss: [] }; k.tot++; if (has(c.n.toLowerCase())) k.have++; else k.miss.push(c); });
    const keys = RAR.map(r => r[0]).filter(k => by[k]);
    const T = keys.reduce((a, k) => ({ tot: a.tot + by[k].tot, have: a.have + by[k].have }), { tot: 0, have: 0 });
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const bar = (a, b, on) => '<span class="szbar"><span style="width:' + pct(a, b) + '%' + (a >= b ? ';background:var(--ok,#6cd09c)' : '') + '"></span></span>';
    h += '<div class="szrow tot"><span>Totale</span>' + bar(T.have, T.tot) + '<b>' + T.have + '/' + T.tot + '</b><small>' + pct(T.have, T.tot) + '%</small></div>';
    keys.forEach(k => { const x = by[k]; h += '<div class="szrow' + (F.rar === k ? ' on' : '') + '" data-rar="' + k + '"><span>' + esc(RAR.find(r => r[0] === k)[1]) + '</span>' + bar(x.have, x.tot) + '<b>' + x.have + '/' + x.tot + '</b><small>' + (x.tot - x.have ? 'mancano ' + (x.tot - x.have) : '✓') + '</small></div>'; });
    h += '<label class="chip" style="margin-top:6px;display:inline-flex"><input type="checkbox" id="szAny" ' + (ANY ? 'checked' : '') + '> Conta anche le carte che ho in un\'altra espansione</label>';
    h += '<div class="msg" style="margin-top:4px">Conto le carte diverse (non le copie), senza terre base. Tocca una rarità per vedere solo quelle mancanti.</div>';
    const keysShow = F.rar ? keys.filter(k => k === F.rar) : keys;
    let miss = []; keysShow.forEach(k => by[k].miss.forEach(c => miss.push(c)));
    const cost = miss.reduce((a, c) => a + (c.eur || 0), 0);
    h += '<details id="szDet" ' + (Z.open ? 'open' : '') + ' style="margin-top:8px"><summary><b>' + miss.length + ' carte mancanti' + (F.rar ? ' (' + esc(RAR.find(r => r[0] === F.rar)[1].toLowerCase()) + ')' : '') + '</b>' + (cost ? ' · circa ' + money(cost) + ' per averle tutte' : '') + '</summary>';
    if (!miss.length) h += '<div class="msg">Niente da completare: le hai tutte!</div>';
    else {
      h += '<div class="row" style="margin:6px 0"><button id="szCart">Cerca le mancanti su CardTrader</button><button class="secondary" id="szCopy">Copia l\'elenco</button></div>';
      h += '<div class="szgrid">' + miss.slice(0, Z.shown).map(c => '<div class="szc"><img loading="lazy" src="' + esc(c.img) + '" alt=""><div class="szn">' + esc(d.it[c.n.toLowerCase()] || c.n) + '</div>' + (other.has(c.n.toLowerCase()) ? '<small style="color:var(--warn)">hai un\'altra stampa</small><br>' : '') + '<small>' + (c.eur ? money(c.eur) : '-') + ' · ' + esc(SING[c.r] || c.r)+'</small></div>').join('') + '</div>';
      if (miss.length > Z.shown) h += '<div class="row" style="justify-content:center"><button class="secondary" id="szMore">Mostra altre (' + (miss.length - Z.shown) + ')</button></div>';
    }
    h += '</details>';
    box.innerHTML = h;
    box.querySelectorAll('[data-rar]').forEach(r => { r.onclick = () => { F.rar = F.rar === r.dataset.rar ? '' : r.dataset.rar; $('fRar').value = F.rar; C.limit = 120; render(); }; });
    const an = document.getElementById('szAny'); if (an) an.onchange = () => { ANY = an.checked; try { localStorage.setItem('mtg_setany', ANY ? '1' : '0'); } catch (e) { /* ok */ } paint(); };
    const det = document.getElementById('szDet'); if (det) det.ontoggle = () => { Z.open = det.open; };
    const mo = document.getElementById('szMore'); if (mo) mo.onclick = () => { Z.shown += 60; paint(); };
    const lines = miss.map(c => '1 ' + c.n).join('\n');
    const ca = document.getElementById('szCart'); if (ca) ca.onclick = () => { store.set('mtg_cart_prefill', lines); location.href = 'carrello.html'; };
    const cp = document.getElementById('szCopy'); if (cp) cp.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(lines) : Promise.reject()).then(() => toast('Elenco copiato'), () => toast('Copia non riuscita')); };
  }

  window.renderSetBox = function () {
    const box = document.getElementById('setBox'); if (!box) return;
    if (!F.set) { box.hidden = true; Z.code = ''; return; }
    box.hidden = false;
    const cd = String(F.set).toLowerCase(); if (Z.code !== cd) { Z.code = cd; Z.shown = 60; load(cd); } else paint();
  };
})();
