'use strict';
/* Logica di Cardtrader Cart Filler (gira nel browser, e in Node per i test). */
const Core = (() => {
  const config = {
    ctBase: 'https://api.cardtrader.com/api/v2',
    scryBase: 'https://api.scryfall.com',
  };
  const MAGIC_GAME_ID = 1;
  const COND = { 'Mint': 0, 'Near Mint': 1, 'Slightly Played': 2, 'Moderately Played': 3, 'Played': 4, 'Heavily Played': 5, 'Poor': 6 };
  const LANG_PASSES = { it: ['it'], en: ['en'], it_en: ['it', 'en'], en_it: ['en', 'it'], any: [null] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  function describeError(p) {
    if (p && typeof p === 'object') {
      if (p.extra && p.extra.message) return String(p.extra.message);
      if (p.error) return String(p.error);
      if (p.errors && (Array.isArray(p.errors) ? p.errors.length : Object.keys(p.errors).length))
        return `${p.error_code || 'errore'}: ${JSON.stringify(p.errors)}`;
      if (p.error_code) return String(p.error_code);
      if (p.raw) return String(p.raw);
    }
    return 'Errore sconosciuto';
  }

  async function httpJson(method, url, { headers = {}, body, retries = 3 } = {}) {
    for (let a = 0; a <= retries; a++) {
      let r;
      try {
        r = await fetch(url, {
          method,
          headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new ApiError(0, 'Connessione non riuscita (rete oppure blocco del browser). Se succede sempre, imposta il proxy nelle opzioni avanzate.');
      }
      const text = await r.text();
      let data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text.slice(0, 300) }; }
      if (r.ok) return data;
      if (r.status === 429 && a < retries) { await sleep(2000 * (a + 1)); continue; }
      throw new ApiError(r.status, describeError(data));
    }
    throw new ApiError(429, 'Troppe richieste, riprova tra poco');
  }

  async function ct(method, path, token, params, body) {
    if (!token) throw new ApiError(401, 'Token mancante');
    let url = config.ctBase + path;
    if (params) url += '?' + new URLSearchParams(params).toString();
    return httpJson(method, url, { headers: { Authorization: 'Bearer ' + token }, body });
  }

  let mpLast = 0;
  async function mpWait() { // il listino marketplace ha un limite di 1 chiamata al secondo
    const gap = 1100 - (Date.now() - mpLast);
    if (gap > 0) await sleep(gap);
    mpLast = Date.now();
  }

  // ---- nomi
  function norm(s) {
    s = (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\u2019/g, "'");
    return s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function nameKeys(name) {
    const keys = new Set([norm(name)]);
    if ((name || '').includes('//')) name.split('//').forEach(p => keys.add(norm(p)));
    keys.delete('');
    return keys;
  }

  // ---- cache
  const cache = new Map();
  async function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttlMs) return hit.v;
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  }

  async function getBlueprints(token, expId) {
    return cached('bp' + expId, 600000, async () => {
      const d = await ct('GET', '/blueprints/export', token, { expansion_id: expId });
      return Array.isArray(d) ? d : [];
    });
  }
  const bpProps = b => b.fixed_properties || b.properties_hash || b.properties || {};
  const bpRarity = b => { const r = bpProps(b).mtg_rarity; return r ? String(r) : null; };
  function singleCards(bps) {
    const s = bps.filter(b => b.category_id === 1);
    return s.length ? s : bps.slice();
  }

  async function fetchProducts(token, expId, language, foil) {
    const params = { expansion_id: expId };
    if (language) params.language = language;
    if (foil !== null && foil !== undefined) params.foil = foil ? 'true' : 'false';
    await mpWait();
    const d = await ct('GET', '/marketplace/products', token, params);
    const out = {};
    if (Array.isArray(d)) { d.forEach(p => { (out[String(p.blueprint_id)] = out[String(p.blueprint_id)] || []).push(p); }); return out; }
    Object.entries(d || {}).forEach(([k, v]) => { if (Array.isArray(v)) out[String(k)] = v; });
    return out;
  }

  // ---- nomi italiani (Scryfall)
  async function itData(setCode) {
    const code = (setCode || '').toLowerCase();
    if (!code) return { names: {}, types: {} };
    return cached('it' + code, 3600000, async () => {
      const names = {}, types = {};
      let url = config.scryBase + '/cards/search?' + new URLSearchParams({ q: `set:${code} lang:it`, unique: 'prints', order: 'set' });
      let pages = 0;
      try {
        while (url && pages < 25) {
          const d = await httpJson('GET', url, { retries: 1 });
          for (const c of d.data || []) {
            let pn = c.printed_name;
            if (!pn && c.card_faces) pn = c.card_faces.map(f => f.printed_name || f.name || '').join(' // ');
            let pt = c.printed_type_line;
            if (!pt && c.card_faces) pt = c.card_faces.map(f => f.printed_type_line || '').join(' // ');
            if (pn && c.name) for (const k of nameKeys(c.name)) { if (!(k in names)) names[k] = pn; if (pt && !(k in types)) types[k] = pt; }
          }
          url = d.has_more ? d.next_page : null;
          pages++;
          await sleep(120);
        }
      } catch (e) { /* senza nomi italiani si usano quelli inglesi */ }
      return { names, types };
    });
  }
  const italianNames = async setCode => (await itData(setCode)).names;

  // ---- colori (Scryfall, inglese: copre tutte le carte del set)
  function colorCode(cols) {
    cols = (cols || []).filter(Boolean);
    return cols.length === 0 ? 'C' : cols.length === 1 ? cols[0] : 'M:' + cols.join('');
  }
  async function enData(setCode) {
    const code = (setCode || '').toLowerCase();
    if (!code) return { colors: {}, types: {} };
    return cached('col' + code, 3600000, async () => {
      const colors = {}, types = {};
      let url = config.scryBase + '/cards/search?' + new URLSearchParams({ q: `set:${code}`, unique: 'cards', order: 'set' });
      let pages = 0;
      try {
        while (url && pages < 25) {
          const d = await httpJson('GET', url, { retries: 1 });
          for (const c of d.data || []) {
            let cols = c.colors;
            if (!cols && c.card_faces && c.card_faces[0]) cols = c.card_faces[0].colors;
            let tl = c.type_line;
            if (!tl && c.card_faces) tl = c.card_faces.map(f => f.type_line || '').join(' // ');
            if (c.name) for (const k of nameKeys(c.name)) { if (!(k in colors)) colors[k] = colorCode(cols); if (tl && !(k in types)) types[k] = tl; }
          }
          url = d.has_more ? d.next_page : null;
          pages++;
          await sleep(120);
        }
      } catch (e) { /* senza questi dati i filtri vengono ignorati */ }
      return { colors, types };
    });
  }
  const colorMap = async setCode => (await enData(setCode)).colors;
  // italiano -> inglese per i tipi piu' comuni (il filtro cerca in entrambe le lingue)
  const TYPE_IT = {
    angelo: 'angel', soldato: 'soldier', chierico: 'cleric', guerriero: 'warrior', mago: 'wizard', stregone: 'sorcerer',
    ladro: 'rogue', 'ladro di': 'rogue', elfo: 'elf', nano: 'dwarf', goblin: 'goblin', umano: 'human', drago: 'dragon',
    demone: 'demon', vampiro: 'vampire', zombie: 'zombie', spirito: 'spirit', bestia: 'beast', uccello: 'bird',
    gatto: 'cat', cane: 'dog', lupo: 'wolf', 'lupo mannaro': 'werewolf', cavaliere: 'knight', arciere: 'archer',
    monaco: 'monk', chierici: 'cleric', pirata: 'pirate', dinosauro: 'dinosaur', tritone: 'merfolk', sirena: 'merfolk',
    elementale: 'elemental', gigante: 'giant', orco: 'orc', hobbit: 'halfling', mezzuomo: 'halfling', scheletro: 'skeleton',
    serpente: 'snake', ragno: 'spider', insetto: 'insect', pesce: 'fish', rettile: 'lizard', topo: 'rat', cavallo: 'horse',
    creatura: 'creature', artefatto: 'artifact', incantesimo: 'enchantment', istantaneo: 'instant', stregoneria: 'sorcery',
    terra: 'land', planeswalker: 'planeswalker', leggendario: 'legendary', equipaggiamento: 'equipment', aura: 'aura',
    eroe: 'hero', assassino: 'assassin', druido: 'druid', sacerdote: 'cleric', samurai: 'samurai', ninja: 'ninja',
  };
  function textFilter(raw) {
    return String(raw || '').split(/[,;]+/).map(t => norm(t)).filter(Boolean)
      .map(t => ({ words: t.split(' ').filter(Boolean) }));
  }
  function textMatches(terms, mode, hay) { // hay: testo gia' normalizzato
    if (!terms.length) return true;
    const test = t => t.words.every(w => hay.includes(w) || (TYPE_IT[w] && hay.includes(TYPE_IT[w])));
    return mode === 'all' ? terms.every(test) : terms.some(test);
  }
  function bpColor(b) {
    let v = bpProps(b).mtg_card_colors;
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string') v = v.split(/[,\s]+/);
    v = v.map(x => String(x).trim().toUpperCase()).filter(x => 'WUBRG'.includes(x) && x);
    return colorCode(v);
  }
  function colorMatches(code, wanted) {
    if (!code) return false;
    if (code === 'C') return wanted.has('C');
    if (code.startsWith('M:')) return wanted.has('M') || [...code.slice(2)].some(x => wanted.has(x));
    return wanted.has(code);
  }

  function italianFor(nameEn, map) {
    for (const k of nameKeys(nameEn)) if (k in map) return map[k];
    return null;
  }

  // ---- funzioni pubbliche
  async function info(token) { const d = await ct('GET', '/info', token); return { name: d.name, id: d.id }; }

  async function expansions(token) {
    const d = await ct('GET', '/expansions', token);
    return d.filter(e => e.game_id === MAGIC_GAME_ID)
      .map(e => ({ id: e.id, code: e.code || '', name: e.name || '' }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  async function expansionInfo(token, expId) {
    const bps = singleCards(await getBlueprints(token, expId));
    const rarities = {};
    bps.forEach(b => { const r = bpRarity(b); if (r) rarities[r] = (rarities[r] || 0) + 1; });
    return {
      cards: new Set(bps.map(b => norm(b.name || ''))).size,
      blueprints: bps.length, rarities, rarity_known: Object.keys(rarities).length > 0,
    };
  }

  function parseOwned(rows) {
    const parsed = [], index = new Map();
    (rows || []).forEach((r, i) => {
      const keys = nameKeys(r.name || '');
      parsed.push({ keys, set: (r.set || '').toLowerCase(), qty: parseInt(r.qty) || 1 });
      keys.forEach(k => { if (!index.has(k)) index.set(k, []); index.get(k).push(i); });
    });
    return { parsed, index };
  }
  function ownedCount(groupKeys, own, setCode, mode) {
    if (mode === 'none') return 0;
    const ids = new Set();
    groupKeys.forEach(k => (own.index.get(k) || []).forEach(i => ids.add(i)));
    let total = 0;
    ids.forEach(i => {
      const row = own.parsed[i];
      if (mode === 'same_set' && row.set !== (setCode || '').toLowerCase()) return;
      total += row.qty;
    });
    return total;
  }

  function productOk(prod, o, lang, need) {
    const ph = prod.properties_hash || {}, user = prod.user || {};
    if (prod.on_vacation || prod.graded) return false;
    if ((prod.bundle_size || 1) !== 1) return false;
    if (ph.signed || ph.altered) return false;
    const foil = !!ph.mtg_foil;
    if (o.foil === 'no' && foil) return false;
    if (o.foil === 'yes' && !foil) return false;
    if ((COND[ph.condition] ?? 99) > o.maxCondRank) return false;
    if (lang && ph.mtg_language !== lang) return false;
    if (!user.can_sell_via_hub) return false; // solo CardTrader Zero
    if ((prod.quantity || 0) < need) return false;
    const cents = prod.price && prod.price.cents;
    if (cents === undefined || cents === null) return false;
    if (o.maxPriceCents && cents > o.maxPriceCents) return false;
    return true;
  }

  async function buildPlan(token, p, progress = () => {}) {
    const expId = parseInt(p.expansion_id);
    const code = p.expansion_code || '';
    const rarities = new Set((p.rarities || []).map(r => r.toLowerCase()));
    const copies = Math.max(1, parseInt(p.copies) || 1);
    const ownedMode = p.owned_mode || 'any';
    const dedupe = p.dedupe !== false;
    const mode = LANG_PASSES[p.language_mode] ? p.language_mode : 'it_en';
    const foilOpt = p.foil || 'no';
    const o = {
      foil: foilOpt,
      maxCondRank: COND[p.min_condition || 'Near Mint'] ?? 1,
      maxPriceCents: Math.round((parseFloat(p.max_price) || 0) * 100),
    };

    progress('Scarico la lista delle carte\u2026');
    const bps = singleCards(await getBlueprints(token, expId));
    const foilParam = foilOpt === 'no' ? false : foilOpt === 'yes' ? true : null;
    const products = {};
    for (const lang of LANG_PASSES[mode]) {
      progress(`Scarico le offerte${lang ? ' in ' + (lang === 'it' ? 'italiano' : 'inglese') : ''}\u2026`);
      products[lang] = await fetchProducts(token, expId, lang, foilParam);
    }

    const rarFallback = {};
    Object.values(products).forEach(perLang => Object.entries(perLang).forEach(([bid, list]) => {
      for (const pr of list) { const r = (pr.properties_hash || {}).mtg_rarity; if (r) { rarFallback[bid] = r; break; } }
    }));
    const rarityOf = b => bpRarity(b) || rarFallback[String(b.id)] || null;

    const groups = new Map();
    for (const b of bps) {
      if (rarities.size) { const r = rarityOf(b); if (!r || !rarities.has(r.toLowerCase())) continue; }
      const key = dedupe ? norm((b.name || '').split('//')[0]) : String(b.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }

    const wantedColors = new Set((p.colors || []).map(x => String(x).toUpperCase()));
    const terms = textFilter(p.text_filter);
    const textMode = p.text_mode === 'all' ? 'all' : 'any';
    let colorUnavailable = false, textUnavailable = false;

    progress('Scarico i nomi italiani\u2026');
    const own = parseOwned(p.owned);
    const it = await itData(code);
    const itMap = it.names;
    let en = { colors: {}, types: {} };
    if (wantedColors.size || terms.length) { progress('Scarico colori e tipi delle carte\u2026'); en = await enData(code); }

    if (wantedColors.size || terms.length) {
      for (const [key, list] of [...groups.entries()]) {
        const nm = list[0].name || '';
        if (wantedColors.size) {
          const known = list.map(bpColor).find(Boolean) || italianFor(nm, en.colors);
          if (!known) colorUnavailable = true;
          else if (!colorMatches(known, wantedColors)) { groups.delete(key); continue; }
          else list.forEach(b => { b._color = known; });
        }
        if (terms.length) {
          const tEn = italianFor(nm, en.types), tIt = italianFor(nm, it.types);
          const nIt = italianFor(nm, itMap) || '';
          if (!tEn && !tIt) textUnavailable = true;
          const hay = norm([nm, nIt, tEn || '', tIt || ''].join(' '));
          if (!textMatches(terms, textMode, hay)) groups.delete(key);
        }
      }
    }

    progress('Scelgo le offerte migliori\u2026');
    const items = [], missing = [], skippedOwned = [];
    for (const gbps of groups.values()) {
      const nameEn = gbps[0].name || '';
      const keys = new Set();
      gbps.forEach(b => nameKeys(b.name || '').forEach(k => keys.add(k)));
      const have = ownedCount(keys, own, code, ownedMode);
      const need = Math.max(0, copies - have);
      const nameIt = italianFor(nameEn, itMap) || nameEn;
      if (need === 0) { skippedOwned.push({ name_it: nameIt, name_en: nameEn, owned: have }); continue; }
      let cands = [];
      for (const lang of LANG_PASSES[mode]) {
        const cs = [];
        for (const b of gbps) for (const pr of (products[lang][String(b.id)] || [])) if (productOk(pr, o, lang, need)) cs.push([b, pr]);
        if (cs.length) { cands = cs; break; }
      }
      if (!cands.length) { missing.push({ name_it: nameIt, name_en: nameEn, reason: 'nessuna offerta CardTrader Zero con questi filtri' }); continue; }
      const [b, pr] = cands.reduce((m, c) => (c[1].price.cents < m[1].price.cents ? c : m));
      const ph = pr.properties_hash || {};
      items.push({
        name_it: nameIt, name_en: nameEn, version: b.version || null,
        collector_number: bpProps(b).collector_number || null, rarity: rarityOf(b),
        color: b._color || bpColor(b) || null, blueprint_id: b.id, product_id: pr.id, qty: need, have,
        price_cents: pr.price.cents, currency: pr.price.currency || 'EUR',
        condition: ph.condition, language: ph.mtg_language, foil: !!ph.mtg_foil,
      });
    }
    const byName = (a, b) => norm(a.name_it).localeCompare(norm(b.name_it));
    items.sort(byName); missing.sort(byName); skippedOwned.sort(byName);
    return {
      items, missing, skipped_owned: skippedOwned,
      total_cents: items.reduce((a, i) => a + i.price_cents * i.qty, 0),
      currency: items.length ? items[0].currency : 'EUR',
      italian_names: Object.keys(itMap).length > 0, color_unavailable: colorUnavailable, text_unavailable: textUnavailable,
    };
  }

  // ---- modalita' "lista di carte": per ogni carta l'offerta CardTrader Zero piu' economica
  let scLast = 0;
  async function scGap() { const g = 110 - (Date.now() - scLast); if (g > 0) await sleep(g); scLast = Date.now(); }
  async function scSearch(q, extra) {
    await scGap();
    try { return (await httpJson('GET', config.scryBase + '/cards/search?' + new URLSearchParams({ q, ...extra }), { retries: 1 })).data || []; }
    catch (e) { if (e instanceof ApiError && e.status === 404) return []; throw e; }
  }
  async function scFuzzy(name) {
    await scGap();
    try { return await httpJson('GET', config.scryBase + '/cards/named?' + new URLSearchParams({ fuzzy: name }), { retries: 1 }); }
    catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null; throw e; }
  }
  async function scCollection(idents) {
    const out = [];
    for (let i = 0; i < idents.length; i += 75) {
      await scGap();
      const d = await httpJson('POST', config.scryBase + '/cards/collection', { body: { identifiers: idents.slice(i, i + 75) }, retries: 1 });
      out.push(...(d.data || []));
    }
    return out;
  }
  const printedName = c => c.printed_name || (c.card_faces || []).map(f => f.printed_name || f.name || '').filter(Boolean).join(' // ') || '';
  const qName = n => String(n).replace(/["\\]/g, '');
  const cnKey = v => String(v == null ? '' : v).trim().toLowerCase().replace(/^0+(?=\d)/, '');
  const eurOf = c => { const p = c && c.prices; if (!p) return null; const v = parseFloat(p.eur) || parseFloat(p.eur_foil); return v > 0 ? v : null; };
  const imgOf = c => (c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {});

  // nome scritto dall'utente (italiano o inglese) -> carta Scryfall (nome inglese)
  async function resolveNames(names, progress) {
    const res = new Map();
    const reg = (key, c) => { if (!res.has(key)) res.set(key, c); };
    for (const c of await scCollection(names.map(n => ({ name: n })))) nameKeys(c.name).forEach(k => reg(k, c));
    const left = names.filter(n => !res.has(norm(n))).slice(0, 80);
    let i = 0;
    for (const n of left) {
      progress(`Cerco le carte non riconosciute ${++i}/${left.length}\u2026`);
      const hits = await scSearch(`lang:it "${qName(n)}"`, { unique: 'cards' });
      const exact = hits.find(c => norm(printedName(c)) === norm(n) || nameKeys(printedName(c)).has(norm(n)));
      if (exact) { reg(norm(n), exact); continue; }
      const f = await scFuzzy(n);
      if (f && f.name) reg(norm(n), f);
    }
    return res;
  }

  let expIdx = null;
  async function expansionIndex(token) {
    if (expIdx && Date.now() - expIdx.t < 600000) return expIdx.v;
    const list = await expansions(token);
    const v = { byCode: new Map(), byName: new Map() };
    list.forEach(e => { v.byCode.set(e.code.toLowerCase(), e); v.byName.set(norm(e.name), e); });
    expIdx = { t: Date.now(), v };
    return v;
  }
  function pickBlueprint(bps, card) {
    const keys = nameKeys(card.name);
    const m = bps.filter(b => [...nameKeys(b.name || '')].some(k => keys.has(k)));
    if (!m.length) return null;
    return m.find(b => cnKey(bpProps(b).collector_number) === cnKey(card.collector_number)) || m[0];
  }
  async function fetchBpProducts(token, bpId, language, foil) {
    const params = { blueprint_id: bpId };
    if (language) params.language = language;
    if (foil !== null && foil !== undefined) params.foil = foil ? 'true' : 'false';
    await mpWait();
    const d = await ct('GET', '/marketplace/products', token, params);
    if (Array.isArray(d)) return d;
    const out = [];
    Object.values(d || {}).forEach(v => { if (Array.isArray(v)) out.push(...v); });
    return out;
  }

  async function buildListPlan(token, p, progress = () => {}) {
    const ownedMode = p.owned_mode === 'none' ? 'none' : 'any'; // senza espansione "stessa espansione" non ha senso
    const mode = LANG_PASSES[p.language_mode] ? p.language_mode : 'it_en';
    const foilOpt = p.foil || 'no';
    const o = { foil: foilOpt, maxCondRank: COND[p.min_condition || 'Near Mint'] ?? 1, maxPriceCents: Math.round((parseFloat(p.max_price) || 0) * 100) };
    const foilParam = foilOpt === 'no' ? false : foilOpt === 'yes' ? true : null;
    const own = parseOwned(p.owned);

    const wanted = new Map();
    for (const r of p.items || []) {
      const k = norm(r.name); if (!k) continue;
      const w = wanted.get(k) || { name: r.name, qty: 0 };
      w.qty += Math.max(1, parseInt(r.qty) || 1); wanted.set(k, w);
    }
    progress('Riconosco le carte della lista\u2026');
    const res = await resolveNames([...wanted.values()].map(w => w.name), progress);
    const missing = [], skippedOwned = [], toBuy = new Map();
    for (const w of wanted.values()) {
      const c = res.get(norm(w.name));
      if (!c) { missing.push({ name_it: w.name, name_en: w.name, reason: 'carta non riconosciuta (controlla il nome)' }); continue; }
      const e = toBuy.get(c.name) || { card: c, qty: 0, label: w.name };
      e.qty += w.qty; toBuy.set(c.name, e);
    }
    for (const [name, e] of [...toBuy.entries()]) {
      const keys = new Set(nameKeys(name)); keys.add(norm(e.label));
      e.have = ownedCount(keys, own, '', ownedMode);
      e.need = Math.max(0, e.qty - e.have);
      if (e.need === 0) { skippedOwned.push({ name_it: e.label, name_en: name, owned: e.have }); toBuy.delete(name); }
    }

    const idx = await expansionIndex(token);
    const items = [];
    let n = 0;
    for (const e of toBuy.values()) {
      progress(`Cerco l'offerta pi\u00f9 economica ${++n}/${toBuy.size}: ${e.card.name}`);
      let prints = (await scSearch(`!"${qName(e.card.name)}" game:paper`, { unique: 'prints', order: 'eur', dir: 'asc' })).filter(c => !c.digital);
      prints.sort((a, b) => (eurOf(a) ?? 1e9) - (eurOf(b) ?? 1e9));
      let best = null, anyExp = false;
      for (const lang of LANG_PASSES[mode]) {
        let checked = 0, bestL = null;
        for (let i = 0; i < prints.length && checked < 8; i++) {
          const pr = prints[i];
          const ex = idx.byCode.get((pr.set || '').toLowerCase()) || idx.byName.get(norm(pr.set_name));
          if (!ex) continue;
          anyExp = true;
          let bps;
          try { bps = singleCards(await getBlueprints(token, ex.id)); }
          catch (er) { if (er instanceof ApiError && er.status === 404) continue; throw er; }
          const b = pickBlueprint(bps, pr); if (!b) continue;
          checked++;
          for (const prod of await fetchBpProducts(token, b.id, lang, foilParam))
            if (productOk(prod, o, lang, e.need) && (!bestL || prod.price.cents < bestL.prod.price.cents)) bestL = { b, prod, pr };
          const nextP = prints[i + 1] ? eurOf(prints[i + 1]) : null;
          if (bestL && (checked >= 3 || (nextP !== null && bestL.prod.price.cents / 100 <= nextP))) break;
        }
        if (bestL) { best = bestL; break; }
      }
      if (!best) { missing.push({ name_it: e.label, name_en: e.card.name, reason: anyExp ? 'nessuna offerta CardTrader Zero con questi filtri' : 'edizioni non trovate su CardTrader' }); continue; }
      const { b, prod, pr } = best, ph = prod.properties_hash || {}, im = imgOf(pr);
      const faces = pr.card_faces || [];
      items.push({
        name_it: e.card.name, name_en: e.card.name, version: b.version || null,
        collector_number: bpProps(b).collector_number || pr.collector_number || null,
        rarity: pr.rarity ? pr.rarity.charAt(0).toUpperCase() + pr.rarity.slice(1) : null,
        color: colorCode(pr.colors || (faces[0] && faces[0].colors) || []),
        blueprint_id: b.id, product_id: prod.id, qty: e.need, have: e.have,
        price_cents: prod.price.cents, currency: prod.price.currency || 'EUR',
        condition: ph.condition, language: ph.mtg_language, foil: !!ph.mtg_foil,
        set_code: (pr.set || '').toLowerCase(), set_name: pr.set_name || '', img: im.small || im.normal || '', img_big: im.normal || im.small || '',
      });
    }

    let italian = false;
    if (items.length) {
      progress('Scarico i nomi italiani\u2026');
      const map = {};
      const names = [...new Set(items.map(i => i.name_en))];
      try {
        for (let i = 0; i < names.length; i += 15) {
          const q = '(' + names.slice(i, i + 15).map(x => `!"${qName(x)}"`).join(' or ') + ') lang:it';
          for (const c of await scSearch(q, { unique: 'cards' })) { const pn = printedName(c); if (pn) map[c.name] = pn; }
        }
      } catch (er) { /* restano i nomi inglesi */ }
      items.forEach(it => { if (map[it.name_en]) { it.name_it = map[it.name_en]; italian = true; } });
      missing.forEach(m => { if (map[m.name_en]) m.name_it = map[m.name_en]; });
    }
    const byName = (a, b) => norm(a.name_it).localeCompare(norm(b.name_it));
    items.sort(byName); missing.sort(byName); skippedOwned.sort(byName);
    return {
      list: true, items, missing, skipped_owned: skippedOwned,
      total_cents: items.reduce((a, i) => a + i.price_cents * i.qty, 0),
      currency: items.length ? items[0].currency : 'EUR',
      italian_names: italian, color_unavailable: false, text_unavailable: false,
    };
  }

  function cartSummary(cart) {
    let count = 0, subtotal = null;
    if (cart && typeof cart === 'object') {
      (cart.subcarts || []).forEach(sc => (sc.cart_items || []).forEach(it => { count += parseInt(it.quantity) || 0; }));
      if (cart.subtotal && typeof cart.subtotal === 'object') subtotal = { cents: cart.subtotal.cents, currency: cart.subtotal.currency };
    }
    return { items: count, subtotal };
  }
  const cart = async token => cartSummary(await ct('GET', '/cart', token));
  // Unica operazione di scrittura dell'app: cart/add (sempre via CardTrader Zero). Nessun acquisto.
  const cartAdd = async (token, productId, quantity) =>
    cartSummary(await ct('POST', '/cart/add', token, null,
      { product_id: parseInt(productId), quantity: parseInt(quantity) || 1, via_cardtrader_zero: true }));

  return { config, ApiError, info, expansions, expansionInfo, buildPlan, buildListPlan, cart, cartAdd, norm, nameKeys };
})();

if (typeof module !== 'undefined') module.exports = Core;
