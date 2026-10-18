'use strict';
/* Strumenti di strategia per il costruttore di mazzi: riconosce temi e meccaniche, giudica lo stile di gioco,
   segnala cosa manca e prepara le ricerche Scryfall per trovare carte adatte. Logica pura (browser e Node). */
const Strategy = (() => {
  // Ogni tema: re = come riconoscerlo nel testo inglese delle carte; q = ricerca Scryfall per trovare altre carte adatte.
  const THEMES = [
    { id: 'counters', name: 'Segnalini +1/+1', desc: 'Creature che crescono con i segnalini e carte che li moltiplicano.',
      re: /\+1\/\+1 counter|proliferate|\bbolster\b|\bevolve\b|\bmentor\b|\bmodular\b|\bundying\b|\boutlast\b|\bsupport\b|\badapt\b|\bgraft\b|\bsoulbond\b/i,
      q: '(o:"+1/+1 counter" or o:proliferate or o:bolster or o:adapt or o:evolve)' },
    { id: 'tokens', name: 'Gettoni', desc: 'Molte creature piccole da potenziare tutte insieme.',
      re: /create (a|an|one|two|three|four|five|x|\d+) [^.]{0,60}token|\bpopulate\b|\bamass\b|\bfabricate\b|creatures you control get|for each creature you control|tokens? you control/i,
      q: '(o:"create" o:"token" or o:populate or o:amass or o:"creatures you control get")' },
    { id: 'graveyard', name: 'Cimitero e recupero', desc: 'Usare il cimitero come seconda mano: riportare carte in gioco e rilanciare.',
      re: /from your graveyard|return [^.]{0,50}(card|creature)[^.]{0,30}from (your|a) graveyard|\bflashback\b|\bescape\b|\bunearth\b|\bdredge\b|\bdelirium\b|\bthreshold\b|\bembalm\b|\beternalize\b|\bdelve\b/i,
      q: '(o:"from your graveyard" or o:flashback or o:escape or o:unearth or o:dredge or o:embalm)' },
    { id: 'sacrifice', name: 'Sacrificio', desc: 'Sacrificare creature per avere vantaggi, e ricavare valore quando muoiono.',
      re: /sacrifice (a|an|another|target|two|three|x|up to)|whenever [^.]{0,40}\bdies\b|\bexploit\b|\bdevour\b|\bafterlife\b|\bundying\b|aristocrat/i,
      q: '(o:"sacrifice a creature" or o:"sacrifice another" or o:"whenever a creature you control dies" or o:exploit or o:afterlife)' },
    { id: 'lifegain', name: 'Guadagno di vita', desc: 'Legame vitale e carte che premiano chi guadagna punti vita.',
      re: /gain (\d+|x|that much|twice)? ?life|\blifelink\b|whenever you gain life|life total/i,
      q: '(o:lifelink or o:"whenever you gain life" or o:"you gain" o:life)' },
    { id: 'artifacts', name: 'Artefatti', desc: 'Artefatti, tesori, indizi ed equipaggiamenti come motore del mazzo.',
      re: /artifacts? (you control|spell|card)|\btreasure\b|\bclue\b|\bfood\b|\bimprovise\b|\baffinity\b|\bmetalcraft\b|\bthopter\b|\bservo\b|\bconstruct\b|\bblood token\b/i,
      q: '(o:"artifact you control" or o:"artifact spell" or o:treasure or o:improvise or o:affinity)' },
    { id: 'enchantments', name: 'Incantesimi e aure', desc: 'Incantesimi permanenti e carte che si attivano quando ne giochi uno.',
      re: /enchantment|\bconstellation\b|\bsaga\b|\baura\b|enchant creature/i,
      q: '(o:constellation or o:"enchantment spell" or o:"enchantment you control" or t:saga)' },
    { id: 'spells', name: 'Magie (istantanei e stregonerie)', desc: 'Lanciare tante magie e ottenere bonus a ogni lancio.',
      re: /whenever you cast (an? )?(instant|sorcery|noncreature|spell)|\bmagecraft\b|\bprowess\b|instant or sorcery|\bstorm\b|copy target (instant|sorcery)|\bcast [^.]{0,30}instant/i,
      q: '(o:"instant or sorcery" or o:prowess or o:magecraft or o:"whenever you cast a noncreature")' },
    { id: 'evasion', name: 'Evasione (volare e simili)', desc: 'Creature difficili da bloccare per finire la partita in fretta.',
      re: /\bflying\b|\bmenace\b|\btrample\b|can'?t be blocked|\bshadow\b|\bskulk\b|\bhorsemanship\b|\bintimidate\b/i,
      q: '(kw:flying or kw:menace or kw:trample or o:"can\'t be blocked")' },
    { id: 'flicker', name: 'Rivalsa e rientro (flicker)', desc: 'Far uscire e rientrare le creature per riusare i loro effetti di ingresso.',
      re: /exile (target|another|up to \w+|any number of) [^.]{0,70}(then )?return (it|that card|them|those cards) to the battlefield|\bblink\b|\bflicker\b|when [^.]{0,40} enters the battlefield/i,
      q: '(o:"return it to the battlefield" or o:"return that card to the battlefield" or o:"enters the battlefield" o:"exile another")' },
    { id: 'mill', name: 'Cimitero dal grimorio (mill)', desc: 'Riempire il cimitero, il tuo o quello dell\'avversario.',
      re: /\bmill\b|mills? (\d+|x|that many)|into (their|your|a) graveyard from (their|your) library|\bsurveil\b/i,
      q: '(o:mill or o:surveil or o:"from the top of your library into your graveyard")' },
    { id: 'burn', name: 'Danni diretti', desc: 'Bruciare l\'avversario con magie e abilit\u00e0 che fanno danno.',
      re: /deals? (x |\d+ )?damage to (any target|each opponent|target (player|opponent))|each opponent loses|whenever [^.]{0,40} deals? damage/i,
      q: '(o:"damage to any target" or o:"damage to each opponent" or o:"each opponent loses")' },
    { id: 'voltron', name: 'Equipaggiamenti e aure', desc: 'Potenziare una sola creatura con equipaggiamenti e aure.',
      re: /\bequip\b|equipped creature|\breconfigure\b|enchanted creature (gets|has)|\battach\b/i,
      q: '(t:equipment or o:"equipped creature" or o:reconfigure or (t:aura o:"enchanted creature gets"))' },
    { id: 'landfall', name: 'Terre e landfall', desc: 'Giocare molte terre e ottenere vantaggi ogni volta che ne entra una.',
      re: /\blandfall\b|land enters the battlefield under your control|play an additional land|play lands from|put (a|up to \w+) [^.]{0,30}land cards? [^.]{0,30}onto the battlefield/i,
      q: '(o:landfall or o:"additional land" or o:"land enters the battlefield under your control")' },
    { id: 'aggro', name: 'Attacco rapido', desc: 'Creature veloci e bonus quando attacchi.',
      re: /\bhaste\b|whenever [^.]{0,30} attacks|\bbattle cry\b|\bdash\b|additional combat|\bmyriad\b|\bexert\b|\bfirst strike\b|\bdouble strike\b/i,
      q: '(kw:haste or o:"battle cry" or o:"whenever" o:"attacks" or o:"additional combat")' },
    { id: 'control', name: 'Controllo', desc: 'Annullare magie e spazzare via le creature avversarie.',
      re: /counter target (spell|noncreature|creature|activated)|destroy all|exile all|all creatures get -|each creature|can'?t cast/i,
      q: '(o:"counter target spell" or o:"destroy all creatures" or o:"exile all creatures" or o:"all creatures get -")' },
  ];

  // Ruoli base: servono a riempire i buchi segnalati dal riepilogo (rampa, pesca, rimozioni).
  const ROLES = {
    ramp: { id: 'role:ramp', name: 'Rampa di mana', q: '(((t:artifact or t:creature) o:"add {") or (o:"search your library" o:"basic land" o:"onto the battlefield"))' },
    draw: { id: 'role:draw', name: 'Pescare carte', q: '(o:"draw a card" or o:"draw two cards" or o:"draw three cards" or o:"look at the top" o:"into your hand")' },
    removal: { id: 'role:removal', name: 'Rimozioni', q: '(o:"destroy target" or o:"exile target" or o:"damage to target creature" or o:"damage to any target" or o:"gets -")' },
    wipe: { id: 'role:wipe', name: 'Spazzare il campo', q: '(o:"destroy all creatures" or o:"exile all creatures" or o:"all creatures get -")' },
  };

  const ARCH = {
    aggro: { name: 'Aggro (attacco veloce)', text: 'Costo medio basso e tante creature: punta a vincere in fretta. Tieni la curva bassa (molte carte da 1-2 mana), poche terre (20-22) e carte che infliggono danni diretti per chiudere.' },
    control: { name: 'Controllo', text: 'Poche creature e tante magie: rispondi alle mosse dell\'avversario e vinci a lungo termine. Servono rimozioni, annullamenti, pesca di carte e poche (ma forti) condizioni di vittoria.' },
    ramp: { name: 'Rampa e creature grosse', text: 'Costo medio alto: accelera il mana per giocare carte potenti prima del previsto. Servono molte fonti di mana (rampa) e carte che pescano per non restare senza risorse.' },
    midrange: { name: 'Midrange (equilibrato)', text: 'Un po\' di tutto: creature solide, qualche rimozione e carte che danno vantaggio. Funziona bene se la curva \u00e8 regolare: scegli un tema e rafforzalo con carte che si aiutano tra loro.' },
  };

  const lc = s => String(s || '');
  const faceTypes = c => lc(c.type).split('//').map(x => x.trim());

  function tribes(list) {
    const n = {};
    list.forEach(({ c, qty }) => {
      if (/changeling/i.test(lc(c.text))) return;
      faceTypes(c).forEach((t, i) => {
        if (i > 0 && !/\bCreature\b|\bKindred\b|\bTribal\b/.test(t)) return;
        if (!/\bCreature\b|\bKindred\b|\bTribal\b/.test(t)) return;
        const sub = t.split(/\u2014|-/)[1]; if (!sub) return;
        sub.trim().split(/\s+/).forEach(w => { if (/^[A-Z][a-z]+$/.test(w)) n[w] = (n[w] || 0) + qty; });
      });
    });
    return n;
  }
  function tribeTheme(sub) {
    const w = sub.toLowerCase();
    return { id: 'tribe:' + sub, name: 'Tribale: ' + Deck.typeIt(w), desc: 'Creature dello stesso tipo (' + sub + ') che si potenziano a vicenda.', q: `(t:${w} or o:${w})`, tribe: true, sub: sub };
  }

  function analyze(deck, cards) {
    const fmt = Deck.FORMATS[deck.format] || Deck.FORMATS.pioneer;
    const list = [];
    deck.cards.forEach(e => { if (e.section === 'side') return; const c = cards[e.id]; if (c) list.push({ c, qty: e.qty, sec: e.section }); });
    const spells = list.filter(x => !Deck.isLand(x.c));
    const sum = a => a.reduce((s, x) => s + x.qty, 0);
    const nSpell = sum(spells);
    const lands = sum(list.filter(x => Deck.isLand(x.c) && x.sec !== 'commander'));
    const out = { fmt, nSpell, lands, themes: [], tribes: [], archetype: null, landAdvice: null, gaps: [] };
    // temi
    THEMES.forEach(t => {
      const hit = spells.filter(x => t.re.test(lc(x.c.text)));
      const n = sum(hit);
      if (n > 0) out.themes.push({ theme: t, n, cards: hit.map(x => x.c) });
    });
    out.themes.sort((a, b) => b.n - a.n);
    const tr = tribes(spells.filter(x => /\bCreature\b|\bKindred\b/.test(lc(x.c.type))));
    const cre = sum(spells.filter(x => /\bCreature\b/.test(lc(x.c.type))));
    out.tribes = Object.entries(tr).filter(([k, n]) => n >= 4 && n >= cre * 0.25 && k !== 'Human').sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([k, n]) => ({ theme: tribeTheme(k), n }));
    out.strong = out.themes.filter(x => x.n >= Math.max(4, nSpell * 0.12));
    // stile di gioco
    if (nSpell >= 10) {
      let cmc = 0; spells.forEach(x => { if (x.sec !== 'commander') cmc += (x.c.cmc || 0) * x.qty; });
      const avg = cmc / Math.max(1, sum(spells.filter(x => x.sec !== 'commander')));
      const inst = sum(spells.filter(x => /\b(Instant|Sorcery)\b/.test(lc(x.c.type))));
      const ramp = sum(spells.filter(x => Deck.classify(x.c) === 'ramp'));
      out.avg = avg; out.ramp = ramp;
      let id = 'midrange';
      if (avg <= 2.4 && cre / nSpell >= 0.4) id = 'aggro';
      else if (inst / nSpell >= 0.45 && cre / nSpell < 0.3) id = 'control';
      else if (ramp >= 6 || avg >= 3.6) id = 'ramp';
      out.archetype = Object.assign({ id }, ARCH[id]);
      // quante terre servono
      let ideal;
      if (fmt.commander) ideal = fmt.targets.lands[1] - Math.floor(Math.max(0, ramp - 8) / 2);
      else if (fmt.size === 40) ideal = 17;
      else ideal = Math.max(20, Math.min(26, Math.round(17.5 + avg * 2.2)));
      out.landAdvice = { ideal, have: lands, diff: lands - ideal };
    }
    // buchi
    ['ramp', 'draw', 'removal'].forEach(s => {
      const n = Deck.count(deck, s), mn = fmt.targets[s][0], id = fmt.targets[s][1];
      if (n < mn || (n < id && nSpell >= 20)) out.gaps.push({ role: s, have: n, want: n < mn ? mn : id, need: (n < mn ? mn : id) - n });
    });
    return out;
  }


  // la carta c appartiene al tema? (tribale: tipo o testo; altrimenti testo)
  function matches(theme, c) {
    if (theme.tribe) { const w = theme.sub.toLowerCase(); return lc(c.type).toLowerCase().includes(w) || lc(c.text).toLowerCase().includes(w) || /changeling/i.test(lc(c.text)); }
    return theme.re.test(lc(c.text));
  }
  // temi suggeriti dal comandante: meccaniche del suo testo e tipo di creatura
  function cmdThemes(cmds) {
    const first = [], mech = [], tribe = [], seen = new Set();
    cmds.forEach(c => {
      const txt = lc(c.text);
      faceTypes(c).forEach(t => {
        if (!/\bCreature\b/.test(t)) return;
        const sub = t.split(/—|-/)[1]; if (!sub) return;
        sub.trim().split(/\s+/).forEach(w => {
          if (!/^[A-Z][a-z]+$/.test(w) || w === 'Human' || seen.has('tribe:' + w)) return;
          seen.add('tribe:' + w);
          // se il testo del comandante parla del suo tipo (es. "Elves you control") il tema tribale viene per primo
          (new RegExp('\\b' + w.toLowerCase().replace(/f$/, '(f|ve)') + '(s|es)?\\b', 'i').test(txt) ? first : tribe).push(tribeTheme(w));
        });
      });
      THEMES.forEach(th => { if (!seen.has(th.id) && th.re.test(txt)) { seen.add(th.id); mech.push(th); } });
    });
    return first.concat(mech, tribe).slice(0, 5);
  }

  // Guida a passi: dice a che punto sei e cosa fare adesso.
  function coach(deck, cards, a) {
    const fmt = a.fmt, isC = !!fmt.commander, pref = deck.strat || {}, skip = pref.skip || {};
    const cmds = deck.cards.filter(e => e.section === 'commander').map(e => cards[e.id]).filter(Boolean);
    const body = deck.cards.filter(e => e.section !== 'commander' && e.section !== 'side' && cards[e.id]).map(e => ({ c: cards[e.id], qty: e.qty }));
    const sum = arr => arr.reduce((x, y) => x + y.qty, 0);
    const nl = sum(body.filter(x => !Deck.isLand(x.c)));
    const lands = sum(body.filter(x => Deck.isLand(x.c)));
    const spellTarget = fmt.size - (isC ? fmt.targets.lands[1] : fmt.targets.lands[1]) - (isC ? 0 : 0);
    const themes = isC ? cmdThemes(cmds) : a.tribes.map(t => t.theme).concat(a.themes.filter(x => x.n >= 3).slice(0, 4).map(x => x.theme));
    const chosen = themes.find(t => t.id === pref.theme) || (pref.theme ? (a.tribes.map(t => t.theme).concat(THEMES).find(t => t.id === pref.theme)) : null) || themes[0] || null;
    const syn = chosen ? sum(body.filter(x => !Deck.isLand(x.c) && matches(chosen, x.c))) : 0;
    const synTarget = isC ? 10 : 8;
    const ideal = a.landAdvice ? a.landAdvice.ideal : fmt.targets.lands[1];
    const gaps = a.gaps.filter(g => g.have < fmt.targets[g.role][0] && !skip['base:' + g.role]);
    const steps = (isC ? [{ id: 'cmd', name: 'Comandante' }] : []).concat([
      { id: 'tema', name: 'Tema' }, { id: 'base', name: 'Fondamenta' }, { id: 'fill', name: 'Completa' }, { id: 'terre', name: 'Terre' }, { id: 'fine', name: 'Rifinitura' }]);
    let id;
    if (isC && !cmds.length && !skip.cmd) id = 'cmd';
    else if (!skip.tema && (!chosen ? nl < 8 : (syn < synTarget && nl < spellTarget * 0.5))) id = 'tema';
    else if (gaps.length && !skip.base) id = 'base';
    else if (!skip.fill && nl < spellTarget - 2) id = 'fill';
    else if (!skip.terre && lands < ideal - 1) id = 'terre';
    else id = 'fine';
    const idx = steps.findIndex(x => x.id === id);
    steps.forEach((x, i) => { x.done = i < idx; x.cur = i === idx; });
    const r = { id, idx, steps, themes, chosen, syn, synTarget, nl, spellTarget, lands, ideal, cmds, gaps, search: null, title: '', text: '', canSkip: id !== 'fine' };
    const cmdName = cmds.map(c => c.name_it || c.name).join(' e ');
    if (id === 'cmd') {
      r.title = 'Scegli il comandante';
      r.text = 'Il comandante decide colori e stile del mazzo, quindi si parte da qui. Ti mostro i pi\u00f9 usati: filtra per colore o per meccanica qui sotto e tocca \u00ab+ Aggiungi\u00bb sul tuo preferito.';
      r.search = { id: 'coach:cmd', name: 'Possibili comandanti', q: fmt.scry === 'brawl' ? 'is:brawler' : 'is:commander', section: 'commander', cmdSearch: true };
    } else if (id === 'tema') {
      r.title = isC ? 'Costruisci attorno a ' + cmdName : 'Scegli la strategia';
      if (chosen) {
        r.text = (isC ? cmdName + ' punta su: ' : 'Il mazzo sta andando verso: ') + themes.map(t => t.name).join(', ') + '. Segui \u00ab' + chosen.name + '\u00bb: ' + chosen.desc + ' Prendi circa ' + synTarget + ' carte che lavorano con questo tema (ne hai ' + syn + '). Puoi cambiare tema toccando un\'altra scelta.';
        r.search = { id: 'coach:tema:' + chosen.id, name: chosen.name, q: chosen.q, theme: chosen };
      } else r.text = (isC ? 'Non riconosco una meccanica precisa nel testo del comandante. ' : '') + 'Scegli tu una meccanica o un tipo di creatura dall\'elenco qui sotto: ti propongo le carte pi\u00f9 usate nei tuoi colori.';
    } else if (id === 'base') {
      const g = gaps[0];
      r.title = 'Metti le fondamenta';
      r.text = 'Un mazzo solido ha rampa (per giocare le carte prima), pesca (per non restare senza carte) e rimozioni (per rispondere all\'avversario). Mancano: ' + gaps.map(x => Strategy_roleName(x.role) + ' (' + x.have + '/' + x.want + ')').join(', ') + '. Parto da: ' + Strategy_roleName(g.role) + '.';
      r.search = Object.assign({}, ROLES[g.role], { id: 'coach:base:' + g.role, role: g.role });
    } else if (id === 'fill') {
      r.title = 'Completa il mazzo';
      r.text = 'Mancano circa ' + Math.max(0, spellTarget - nl) + ' carte non terra. Aggiungi creature e carte che fanno vincere' + (chosen ? ', restando sul tema \u00ab' + chosen.name + '\u00bb' : '') + '. Controlla la curva di mana: poche carte molto costose.';
      r.search = chosen ? { id: 'coach:fill:' + chosen.id, name: chosen.name, q: chosen.q, theme: chosen } : null;
    } else if (id === 'terre') {
      r.title = 'Sistema le terre';
      r.text = 'Per questo mazzo servono circa ' + ideal + ' terre, ne hai ' + lands + '. Prima aggiungi le terre speciali che producono pi\u00f9 colori (sotto), poi completa con le terre base in proporzione ai simboli di mana.';
      r.search = { id: 'coach:terre', name: 'Terre utili', q: 't:land -t:basic', type: 'land', land: true };
      r.basics = true;
    } else {
      r.title = 'Rifinitura';
      r.text = 'Il mazzo \u00e8 quasi completo. Controlla gli avvisi qui sopra (copie, legalit\u00e0, identit\u00e0 di colore), sistema la curva e poi provalo nella pagina Prova contro un secondo mazzo.';
    }
    return r;
  }
  function Strategy_roleName(r) { return (ROLES[r] || {}).name || r; }

  return { THEMES, ROLES, ARCH, analyze, tribeTheme, matches, cmdThemes, coach };
})();
if (typeof module !== 'undefined') module.exports = Strategy;
