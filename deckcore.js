'use strict';
/* Logica pura dei mazzi (formati, categorie, statistiche, controlli). Gira nel browser e in Node. */
const Deck = (() => {
  // Sezioni del mazzo. "side" e "commander" sono speciali.
  const SECTIONS = {
    commander: 'Comandante',
    lands: 'Terre',
    creatures: 'Creature',
    ramp: 'Rampa',
    draw: 'Pescare',
    removal: 'Rimozioni e controllo',
    other: 'Altri incantesimi',
    side: 'Sideboard',
  };
  const MAIN = ['lands', 'creatures', 'ramp', 'draw', 'removal', 'other'];

  // Obiettivi indicativi: [minimo, ideale, massimo]
  const T60 = { lands: [22, 24, 26], creatures: [12, 16, 22], ramp: [0, 2, 6], draw: [0, 3, 6], removal: [4, 6, 10], other: [4, 9, 16] };
  const FORMATS = {
    standard: { name: 'Standard', size: 60, copies: 4, side: 15, commander: false, scry: 'standard', targets: T60 },
    pioneer: { name: 'Pioneer', size: 60, copies: 4, side: 15, commander: false, scry: 'pioneer', targets: T60 },
    modern: { name: 'Modern', size: 60, copies: 4, side: 15, commander: false, scry: 'modern', targets: T60 },
    legacy: { name: 'Legacy', size: 60, copies: 4, side: 15, commander: false, scry: 'legacy', targets: T60 },
    vintage: { name: 'Vintage', size: 60, copies: 4, side: 15, commander: false, scry: 'vintage', targets: T60 },
    pauper: { name: 'Pauper', size: 60, copies: 4, side: 15, commander: false, scry: 'pauper', targets: T60 },
    commander: {
      name: 'Commander', size: 99, copies: 1, side: 0, commander: true, scry: 'commander',
      targets: { lands: [34, 37, 39], creatures: [15, 25, 30], ramp: [8, 10, 12], draw: [8, 10, 12], removal: [6, 10, 12], other: [3, 7, 14] },
    },
    brawl: {
      name: 'Brawl', size: 59, copies: 1, side: 0, commander: true, scry: 'brawl',
      targets: { lands: [23, 25, 26], creatures: [12, 15, 20], ramp: [1, 3, 5], draw: [2, 4, 6], removal: [4, 6, 8], other: [3, 6, 12] },
    },
    limited: {
      name: 'Limited (40 carte)', size: 40, copies: 0, side: 99, commander: false, scry: null,
      targets: { lands: [16, 17, 18], creatures: [13, 15, 17], ramp: [0, 0, 2], draw: [0, 1, 3], removal: [2, 3, 6], other: [2, 4, 8] },
    },
  };

  const RAMP_RE = /add (one|two|three|\{|an additional|x|that much)|adds? .{0,40}mana of|search your library for (a|up to \w+|two|three) (basic )?(land|forest|plains|island|swamp|mountain)|put (a|up to \w+) .{0,40}land cards? .{0,40}onto the battlefield|you may play an additional land|untap target land/i;
  const DRAW_RE = /draw (a|an|two|three|four|x|\d+|that many|cards?)\b|look at the top .{0,60}put .{0,60}into your hand|reveal .{0,60}put .{0,40}into your hand|exile the top .{0,60}you may (play|cast)|search your library for a card|investigate|you may (play|cast) .{0,30}from your graveyard/i;
  const REMOVAL_RE = /destroy (target|up to|all|each)|exile (target|up to|all|each)|deals? (x |\d+ )?damage to (any target|target|each|up to)|counter target|return target .{0,40}to (its|their) owner'?s? hand|gets? -\d+\/-\d+|gets? -x\/-x|fights? |target creature (or planeswalker )?gets? -|each (creature|opponent) .{0,30}sacrifice|sacrifice (a|an|target) (creature|permanent)|tap target|can'?t (attack|block)|bounce/i;

  const typeOf = c => String(c.type || '');
  const textOf = c => String(c.text || '');
  const isLand = c => /\bLand\b/.test(typeOf(c).split('//')[0]);
  const isCreature = c => /\bCreature\b/.test(typeOf(c));
  const isBasic = c => /\bBasic\b/.test(typeOf(c));

  // Categoria suggerita per una carta
  function classify(c) {
    if (isLand(c)) return 'lands';
    const t = textOf(c);
    if (isCreature(c)) return 'creatures';
    if (/\bPlaneswalker\b/.test(typeOf(c))) return 'other';
    if (REMOVAL_RE.test(t)) return 'removal';
    if (RAMP_RE.test(t) || (/\bArtifact\b/.test(typeOf(c)) && (c.produced || []).length)) return 'ramp';
    if (DRAW_RE.test(t)) return 'draw';
    return 'other';
  }

  function emptyDeck(name, format) {
    return { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || 'Nuovo mazzo', format: format in FORMATS ? format : 'pioneer', created: Date.now(), cards: [] };
  }
  const entries = (deck, section) => deck.cards.filter(e => e.section === section);
  const count = (deck, section) => entries(deck, section).reduce((a, e) => a + e.qty, 0);
  const mainCount = (deck) => MAIN.reduce((a, s) => a + count(deck, s), 0);

  function addCard(deck, id, section, qty) {
    qty = qty || 1;
    const e = deck.cards.find(x => x.id === id && x.section === section);
    if (e) e.qty += qty; else deck.cards.push({ id, section, qty });
  }
  function setQty(deck, id, section, qty) {
    const i = deck.cards.findIndex(x => x.id === id && x.section === section);
    if (i < 0) return;
    if (qty <= 0) deck.cards.splice(i, 1); else deck.cards[i].qty = qty;
  }
  function moveCard(deck, id, from, to) {
    if (from === to) return;
    const i = deck.cards.findIndex(x => x.id === id && x.section === from);
    if (i < 0) return;
    const q = deck.cards[i].qty;
    deck.cards.splice(i, 1);
    addCard(deck, id, to, q);
  }

  function statusFor(n, range) { // verde / giallo / rosso
    const [mn, , mx] = range;
    if (n >= mn && n <= mx) return 'ok';
    const slack = Math.max(2, Math.round((mx - mn) / 3));
    return (n < mn - slack || n > mx + slack) ? 'bad' : 'warn';
  }

  function colorPips(cost) {
    const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    String(cost || '').replace(/\{([^}]+)\}/g, (_, s) => { s.split('/').forEach(p => { if (p in out) out[p]++; }); return ''; });
    return out;
  }

  function stats(deck, cards) { // cards: id -> dati carta
    const fmt = FORMATS[deck.format] || FORMATS.pioneer;
    const sec = {};
    MAIN.forEach(s => { sec[s] = { n: count(deck, s), range: fmt.targets[s], status: statusFor(count(deck, s), fmt.targets[s]) }; });
    const curve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..6, 7+
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let cmcSum = 0, nonLand = 0, value = 0;
    deck.cards.forEach(e => {
      const c = cards[e.id]; if (!c) return;
      if (e.section === 'side') return;
      if (e.section !== 'commander' && !isLand(c)) {
        const v = Math.min(7, Math.max(0, Math.floor(c.cmc || 0)));
        curve[v] += e.qty; cmcSum += (c.cmc || 0) * e.qty; nonLand += e.qty;
      }
      const p = colorPips(c.mana); Object.keys(pips).forEach(k => { pips[k] += p[k] * e.qty; });
      if (c.eur) value += c.eur * e.qty;
    });
    return {
      sections: sec, main: mainCount(deck), mainTarget: fmt.size,
      commander: count(deck, 'commander'), side: count(deck, 'side'),
      curve, pips, avgCmc: nonLand ? cmcSum / nonLand : 0, value,
    };
  }

  // Avvisi sul mazzo
  function check(deck, cards) {
    const fmt = FORMATS[deck.format] || FORMATS.pioneer;
    const w = [];
    const name = c => c.name_it || c.name;
    const main = mainCount(deck);
    if (main < fmt.size) w.push({ lvl: 'info', msg: `Mancano ${fmt.size - main} carte per arrivare a ${fmt.size}.` });
    if (main > fmt.size) w.push({ lvl: 'warn', msg: `Hai ${main - fmt.size} carte in pi\u00f9 (servono ${fmt.size}).` });
    if (fmt.commander) {
      const nc = count(deck, 'commander');
      if (nc === 0) w.push({ lvl: 'warn', msg: 'Scegli il comandante nella sezione Comandante.' });
      if (nc > 2) w.push({ lvl: 'warn', msg: 'Hai pi\u00f9 di due comandanti.' });
    }
    if (fmt.side && count(deck, 'side') > fmt.side) w.push({ lvl: 'warn', msg: `La sideboard supera le ${fmt.side} carte.` });
    // copie
    const totals = {};
    deck.cards.forEach(e => { if (e.section === 'commander') return; const c = cards[e.id]; if (!c) return; const k = c.name; totals[k] = (totals[k] || { n: 0, c }); totals[k].n += e.qty; });
    if (fmt.copies > 0) {
      Object.values(totals).forEach(({ n, c }) => {
        if (isBasic(c) || /any number of cards named/i.test(textOf(c))) return;
        if (n > fmt.copies) w.push({ lvl: 'warn', msg: `${name(c)}: ${n} copie (massimo ${fmt.copies}).` });
      });
    }
    // legalita'
    if (fmt.scry) {
      deck.cards.forEach(e => {
        const c = cards[e.id]; if (!c || !c.legal) return;
        const l = c.legal[fmt.scry];
        if (l === 'not_legal') w.push({ lvl: 'warn', msg: `${name(c)} non \u00e8 legale in ${fmt.name}.` });
        else if (l === 'banned') w.push({ lvl: 'warn', msg: `${name(c)} \u00e8 bandita in ${fmt.name}.` });
        else if (l === 'restricted' && totals[c.name] && totals[c.name].n > 1) w.push({ lvl: 'warn', msg: `${name(c)} \u00e8 ristretta in ${fmt.name} (una sola copia).` });
      });
    }
    // identita' di colore
    if (fmt.commander) {
      const id = new Set();
      entries(deck, 'commander').forEach(e => { const c = cards[e.id]; if (c) (c.ci || []).forEach(x => id.add(x)); });
      if (id.size || entries(deck, 'commander').length) {
        deck.cards.forEach(e => {
          if (e.section === 'commander') return;
          const c = cards[e.id]; if (!c) return;
          if ((c.ci || []).some(x => !id.has(x))) w.push({ lvl: 'warn', msg: `${name(c)} \u00e8 fuori dall'identit\u00e0 di colore del comandante.` });
        });
      }
    }
    const seen = new Set();
    return w.filter(x => !seen.has(x.msg) && seen.add(x.msg));
  }

  // Esporta in testo (nomi inglesi, accettato da Moxfield, Archidekt, ecc.)
  function exportText(deck, cards) {
    const line = e => { const c = cards[e.id]; return c ? `${e.qty} ${c.name}` : null; };
    const out = [];
    const cm = entries(deck, 'commander').map(line).filter(Boolean);
    if (cm.length) { out.push('Commander'); out.push(...cm); out.push(''); }
    out.push('Deck');
    MAIN.forEach(s => entries(deck, s).map(line).filter(Boolean).forEach(l => out.push(l)));
    const sd = entries(deck, 'side').map(line).filter(Boolean);
    if (sd.length) { out.push(''); out.push('Sideboard'); out.push(...sd); }
    return out.join('\n');
  }

  // Legge un elenco testuale: "4 Nome", "4x Nome", "Nome", "Nome (SET) 12", con sezioni Commander/Sideboard
  function parseList(text) {
    const res = []; let mode = 'main';
    String(text || '').split(/\r?\n/).forEach(raw => {
      let s = raw.trim(); if (!s || s.startsWith('//') || s.startsWith('#')) return;
      const low = s.toLowerCase().replace(/[:]/g, '');
      if (low === 'commander' || low === 'comandante') { mode = 'commander'; return; }
      if (low === 'sideboard' || low === 'side' || low === 'plancia') { mode = 'side'; return; }
      if (low === 'deck' || low === 'mainboard' || low === 'maindeck' || low === 'mazzo') { mode = 'main'; return; }
      if (/^sb:\s*/i.test(s)) { s = s.replace(/^sb:\s*/i, ''); res.push(...parseLine(s, 'side')); return; }
      res.push(...parseLine(s, mode));
    });
    return res;
  }
  function parseLine(s, mode) {
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(s);
    let qty = 1, name = s;
    if (m) { qty = parseInt(m[1]); name = m[2]; }
    name = name.replace(/\s+\([A-Za-z0-9]{2,6}\)\s*\S*\s*$/, '').replace(/\s+\*[A-Za-z]\*$/, '').trim();
    return name ? [{ qty, name, mode }] : [];
  }

  return { SECTIONS, MAIN, FORMATS, classify, emptyDeck, entries, count, mainCount, addCard, setQty, moveCard, stats, check, exportText, parseList, colorPips, isLand, isBasic };
})();
if (typeof module !== 'undefined') module.exports = Deck;
