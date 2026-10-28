'use strict';
/* Creatore automatico di mazzi: formato, colori, tema e stile -> mazzo completo da rifinire a mano. */
(function () {
  const COLS = [['W', 'Bianco'], ['U', 'Blu'], ['B', 'Nero'], ['R', 'Rosso'], ['G', 'Verde']];
  const STYLES = {
    midrange: { name: 'Equilibrato', lands: 0, creatures: 0, ramp: 0, draw: 0, removal: 0 },
    aggro: { name: 'Attacco veloce', lands: -2, creatures: 3, ramp: -1, draw: -1, removal: 0 },
    control: { name: 'Controllo', lands: 1, creatures: -5, ramp: 0, draw: 2, removal: 3 },
    ramp: { name: 'Rampa e creature grosse', lands: 0, creatures: -1, ramp: 4, draw: 1, removal: -1 },
  };
  const st = { cols: new Set(), busy: false };
  const el = id => document.getElementById(id);

  function ui() {
    const nb = el('newBox'); if (!nb || el('autoBox')) return;
    const fm = Object.entries(Deck.FORMATS).map(([k, f]) => '<option value="' + k + '"' + (k === 'pioneer' ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    const th = Strategy.THEMES.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
    const sty = Object.entries(STYLES).map(([k, s]) => '<option value="' + k + '">' + esc(s.name) + '</option>').join('');
    const d = document.createElement('details'); d.id = 'autoBox'; d.style.marginTop = '10px';
    d.innerHTML = '<summary>Crea un mazzo in automatico</summary>' +
      '<div class="msg" style="margin:6px 0">Scegli i filtri e l\'app compone un mazzo completo. Poi lo rifinisci a mano come qualsiasi altro mazzo.</div>' +
      '<div class="row"><label class="f" style="flex:1 1 150px">Formato<select id="auFmt">' + fm + '</select></label>' +
      '<label class="f" style="flex:1 1 150px">Tema<select id="auTheme"><option value="">Nessuno (carte più usate)</option>' + th + '</select></label>' +
      '<label class="f" style="flex:1 1 150px">Stile<select id="auStyle">' + sty + '</select></label></div>' +
      '<div class="msg" style="margin-top:8px">Colori <span id="auColHint"></span></div><div class="thm" id="auCols">' + COLS.map(c => '<span class="chip" data-au="' + c[0] + '">' + c[1] + '</span>').join('') + '</div>' +
      '<div class="row"><label class="f" id="auCmdW" style="flex:2 1 200px" hidden>Comandante (facoltativo)<input id="auCmd" type="text" placeholder="Lascia vuoto per sceglierlo io" autocomplete="off"></label>' +
      '<label class="f" style="flex:1 1 150px">Carte<select id="auOwn"><option value="prefer">Preferisci le mie</option><option value="only">Solo le mie</option><option value="any">Le più usate, anche da comprare</option></select></label>' +
      '<label class="f" style="flex:1 1 120px">Prezzo max per carta (€)<input id="auBudget" style="width:100%" type="number" min="0" step="0.5" placeholder="nessun limite"></label></div>' +
      '<div class="row"><button id="auGo">Crea il mazzo</button><span class="msg" id="auMsg"></span></div>';
    nb.insertAdjacentElement('afterend', d);
    const sync = () => { const f = Deck.FORMATS[el('auFmt').value]; el('auCmdW').hidden = !f.commander; el('auColHint').textContent = f.commander ? '(con un comandante scelto da te vengono ignorati)' : '(da 1 a 3)'; };
    el('auFmt').onchange = sync; sync();
    el('auCols').onclick = ev => { const c = ev.target.closest('[data-au]'); if (!c) return; const k = c.dataset.au; st.cols.has(k) ? st.cols.delete(k) : st.cols.add(k); c.classList.toggle('on', st.cols.has(k)); };
    el('auGo').onclick = go;
  }

  const msg = t => { const m = el('auMsg'); if (m) m.textContent = t || ''; };
  const colStr = set => [...set].join('').toLowerCase();

  async function pool(q, o, order) {
    const raw = await searchPages(q, 2, order || 'edhrec');
    const seen = new Set(), out = [];
    raw.forEach(x => { const s = slim(x); if (!seen.has(s.id) && !o.used.has(s.id)) { seen.add(s.id); out.push(s); } });
    let res = out;
    if (o.own === 'only') res = out.filter(c => ownedQty(c) > 0);
    else if (o.own === 'prefer') res = out.filter(c => ownedQty(c) > 0).concat(out.filter(c => ownedQty(c) <= 0));
    return res;
  }
  function copiesFor(c, f, o, role) {
    let n = f.copies > 1 ? (/Legendary/.test(c.type) ? 1 : role === 'creatures' || role === 'theme' ? (c.cmc <= 3 ? 4 : c.cmc <= 5 ? 3 : 2) : 3) : 1;
    if (o.own === 'only') n = Math.min(n, ownedQty(c));
    return Math.max(0, n);
  }

  async function go() {
    if (st.busy) return; const fk = el('auFmt').value, f = Deck.FORMATS[fk], style = STYLES[el('auStyle').value];
    const theme = Strategy.THEMES.find(t => t.id === el('auTheme').value) || null;
    const o = { own: el('auOwn').value, budget: parseFloat(el('auBudget').value) || 0, used: new Set() };
    const cmdName = f.commander ? el('auCmd').value.trim() : '';
    if (!cmdName && !st.cols.size) return msg('Scegli almeno un colore' + (f.commander ? ' oppure indica un comandante.' : '.'));
    if (!f.commander && st.cols.size > 3) return msg('Con più di 3 colori il mazzo diventa poco affidabile: scegline al massimo 3.');
    st.busy = true; el('auGo').disabled = true;
    try {
      let cols = new Set(st.cols), cmdr = null;
      const bud = o.budget ? ' eur<=' + o.budget : '';
      if (f.commander) {
        msg('Scelgo il comandante…');
        if (cmdName) {
          const r = await scry('/cards/named?' + new URLSearchParams({ fuzzy: cmdName }).toString());
          if (!r || !r.name) throw new Error('Comandante non trovato: controlla il nome.');
          cmdr = slim(r);
        } else {
          const cs = colStr(cols);
          const q = 'is:commander game:paper f:' + f.scry + (cs ? ' id<=' + cs : '') + (theme ? ' ' + theme.q : '');
          const list = await pool(q, o, 'edhrec');
          // il comandante deve usare tutti i colori scelti
          cmdr = list.find(c => [...cols].every(k => c.ci.indexOf(k) >= 0)) || list[0];
          if (!cmdr) throw new Error('Non trovo un comandante con questi colori e questo tema: prova a cambiare tema o colori.');
        }
        cols = new Set(cmdr.ci); o.used.add(cmdr.id);
      }
      const cs = colStr(cols);
      const base = ' game:paper f:' + f.scry + (cs ? ' id<=' + cs : (f.commander ? ' id<=c' : '')) + bud;
      const tg = f.targets, pick = k => tg[k][1];
      const want = { lands: pick('lands') + style.lands, creatures: pick('creatures') + style.creatures, ramp: Math.max(0, pick('ramp') + style.ramp), draw: Math.max(0, pick('draw') + style.draw), removal: pick('removal') + style.removal };
      const size = f.size; let spells = size - want.lands;
      const chosen = []; // { c, qty, role }
      const take = (list, n, role) => { let got = 0; for (const c of list) { if (got >= n) break; if (o.used.has(c.id)) continue; const q = Math.min(copiesFor(c, f, o, role), n - got); if (q <= 0) continue; o.used.add(c.id); chosen.push({ c, qty: q }); got += q; } return got; };
      msg('Cerco le carte…');
      const nonland = ' -t:land';
      let left = spells;
      const themeQ = theme ? theme.q : null;
      // 1) carte del tema: creature e non creature
      if (themeQ) {
        const wc = Math.round(want.creatures * 0.6), wo = Math.round(want.creatures * 0.4) + 4;
        left -= take(await pool(themeQ + base + ' t:creature', o), Math.min(wc, left), 'theme');
        left -= take(await pool(themeQ + base + nonland + ' -t:creature', o), Math.min(wo, left), 'theme');
      }
      // 2) ruoli: rimozioni, pescare, rampa
      for (const r of ['removal', 'draw', 'ramp']) {
        const have = chosen.filter(x => Deck.classify(x.c) === r).reduce((a, x) => a + x.qty, 0), need = Math.min(Math.max(0, want[r] - have), left);
        if (need > 0) left -= take(await pool(Strategy.ROLES[r].q + base + nonland, o), need, r);
      }
      // 3) creature per arrivare al numero voluto
      const haveCr = chosen.filter(x => /Creature/.test(x.c.type)).reduce((a, x) => a + x.qty, 0);
      if (left > 0 && haveCr < want.creatures) left -= take(await pool('t:creature' + base, o), Math.min(want.creatures - haveCr, left), 'creatures');
      // 4) il resto: le carte piu' usate nei colori scelti
      if (left > 0) left -= take(await pool(base.trim() + nonland, o), left, 'other');
      if (left > 0) left -= take(await pool(base.trim() + nonland + ' -t:creature', o), left, 'other');
      // 5) terre: base (in proporzione ai simboli di mana) + qualche terra utile nel Commander
      msg('Aggiungo le terre…');
      const lands = [];
      let nBasic = want.lands + left; // se mancano carte, le terre coprono il resto
      if (f.commander && cs) {
        const nl = await pool('t:land -t:basic game:paper f:' + f.scry + ' id<=' + cs + ' (o:"add {" or o:"search your library") -o:"enters the battlefield tapped unless" -o:"doesn\'t untap"' + bud, o);
        const used = nl.filter(c => ownedQty(c) > 0 || o.own !== 'only').slice(0, Math.min(8, nBasic - 20));
        used.forEach(c => { o.used.add(c.id); lands.push({ c, qty: 1 }); }); nBasic -= used.length;
      }
      const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      chosen.forEach(x => { (x.c.mana || '').replace(/\{([WUBRG])\}/g, (_, k) => { pips[k] += x.qty; }); });
      const bc = [...cols].filter(k => 'WUBRG'.indexOf(k) >= 0); if (!bc.length) bc.push('W');
      const w = bc.map(k => Math.max(1, pips[k])), tot = w.reduce((a, b) => a + b, 0), nb = w.map(x => Math.floor(nBasic * x / tot));
      let rest = nBasic - nb.reduce((a, b) => a + b, 0); for (let i = 0; rest > 0; i = (i + 1) % bc.length, rest--) nb[i]++;
      const NAME = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
      const br = await scry('/cards/collection', { identifiers: bc.map(k => ({ name: NAME[k] })) });
      (br.data || []).forEach(x => { const k = bc.find(c => NAME[c] === x.name), q = nb[bc.indexOf(k)]; if (q > 0) lands.push({ c: slim(x), qty: q }); });
      // 6) crea il mazzo
      const nm = (theme ? theme.name : 'Mazzo') + ' ' + (cmdr ? (cmdr.name_it || cmdr.name).split(',')[0] : bc.join('')) ;
      const d = Deck.emptyDeck('Auto: ' + nm, fk);
      const reg = c => { S.cards[c.id] = Object.assign(S.cards[c.id] || {}, c); return c.id; };
      if (cmdr) Deck.addCard(d, reg(cmdr), 'commander', 1);
      chosen.concat(lands).forEach(x => Deck.addCard(d, reg(x.c), Deck.classify(S.cards[x.c.id]), x.qty));
      S.decks.push(d); S.cur = d.id; save(); render();
      let missN = 0, missEur = 0, haveN = 0;
      chosen.concat(lands).forEach(x => { if (Deck.isBasic(x.c)) return; const ow = Math.min(x.qty, ownedQty(x.c)); haveN += ow; const m = x.qty - ow; missN += m; missEur += m * (x.c.eur || 0); });
      const cnt = Deck.mainCount(d);
      const hasOwned = Object.keys(S.owned).length > 0;
      const t = 'Mazzo creato: ' + cnt + (f.commander ? '/' + size : '/' + size) + ' carte.' + (hasOwned ? ' Ne hai già ' + haveN + ', ne mancano ' + missN + (missEur ? ' (circa ' + missEur.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) + ')' : '') + '.' : '');
      msg(t); toast('Mazzo creato: rifiniscilo a tuo gusto');
      const li = chosen.concat(lands).map(x => x.c).concat(cmdr ? [cmdr] : []);
      await stratItalian(li.map(c => S.cards[c.id])); save(); render();
    } catch (e) { msg(e.message || 'Qualcosa è andato storto.'); }
    st.busy = false; el('auGo').disabled = false;
  }
  ui();
})();
