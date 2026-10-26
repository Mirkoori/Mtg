'use strict';
/* Aggiornamento giornaliero da Scryfall: prezzi della collezione, legalita' delle carte dei mazzi, storico del valore. */
window.Refresh = (function () {
  const DAY = 86400000;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
  const idb = (() => {
    const ready = new Promise(res => { try { const r = indexedDB.open('mtgcol', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); } });
    return {
      async get(k) { const d = await ready; if (!d) return undefined; return new Promise(res => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } }); },
      async set(k, v) { const d = await ready; if (!d) return; return new Promise(res => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); } catch (e) { res(); } }); },
    };
  })();
  const today = () => new Date().toISOString().slice(0, 10);
  const num = v => parseFloat(v) || 0;
  const unitPrice = (e, c) => { const nf = e.qty - (e.foilQty || 0); return nf * (c.eur || 0) + (e.foilQty || 0) * (c.eurFoil || c.eur || 0); };
  function valueOf(entries, cards) { return entries.reduce((a, e) => { const c = cards[e.key]; return c ? a + unitPrice(e, c) : a; }, 0); }
  function legalOf(raw) { const o = {}; ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'brawl'].forEach(k => { if (raw.legalities && raw.legalities[k]) o[k] = raw.legalities[k]; }); return o; }

  async function fetchRaw(sids, progress) {
    const out = new Map(); const ids = [...sids];
    for (let i = 0; i < ids.length; i += 75) {
      const r = await scry('/cards/collection', { identifiers: ids.slice(i, i + 75).map(id => ({ id: id })) });
      (r.data || []).forEach(c => out.set(c.id, c)); if (progress) progress(Math.min(ids.length, i + 75), ids.length);
    }
    return out;
  }

  // restituisce { value, prev, alerts } oppure null se non serve / non riesce
  async function run(force, progress) {
    const last = num(store.get('mtg_refresh_t'));
    if (!force && Date.now() - last < 20 * 3600 * 1000) return null;
    let entries = await idb.get('entries'); const cards = (await idb.get('cards')) || {};
    if (!entries || !entries.length) entries = jget('mtg_entries', []);
    const deckCards = jget('mtg_cards', {}), decks = jget('mtg_decks', []);
    const sids = new Set();
    (entries || []).forEach(e => { const c = cards[e.key]; if (c && c.sid) sids.add(c.sid); });
    Object.keys(deckCards).forEach(k => { if (deckCards[k] && deckCards[k].sid) sids.add(deckCards[k].sid); });
    if (!sids.size) { store.set('mtg_refresh_t', String(Date.now())); return null; }
    const raw = await fetchRaw(sids, progress);
    if (!raw.size) return null;

    // 1. prezzi della collezione
    let changed = false;
    Object.keys(cards).forEach(k => { const c = cards[k], r = c && raw.get(c.sid); if (!r) return; const e1 = num(r.prices && r.prices.eur), e2 = num(r.prices && r.prices.eur_foil); if (c.eur !== e1 || c.eurFoil !== e2) { c.eur = e1; c.eurFoil = e2; changed = true; } });
    if (changed) await idb.set('cards', cards);
    // 2. legalita' e prezzi delle carte dei mazzi + avvisi
    const alerts = jget('mtg_alerts', []); const fmtScry = {}; (decks || []).forEach(d => { fmtScry[d.id] = (typeof Deck !== 'undefined' && Deck.FORMATS && Deck.FORMATS[d.format] && Deck.FORMATS[d.format].scry) || d.format; });
    let dc = false;
    Object.keys(deckCards).forEach(k => {
      const c = deckCards[k], r = c && raw.get(c.sid); if (!r) return;
      const nl = legalOf(r), ol = c.legal || {};
      decks.forEach(d => {
        if (!(d.cards || []).some(e => e.id === k && e.section !== 'side')) return; const f = fmtScry[d.id]; if (!f) return;
        const was = ol[f], now = nl[f];
        if (was && now && was !== now && (was === 'legal' || was === 'restricted') && (now === 'banned' || now === 'not_legal' || now === 'restricted')) alerts.push({ t: Date.now(), deck: d.name, card: c.name, fmt: f, from: was, to: now, seen: false });
      });
      if (JSON.stringify(nl) !== JSON.stringify(ol)) { c.legal = nl; dc = true; }
      const e1 = num(r.prices && r.prices.eur), e2 = num(r.prices && r.prices.eur_foil); if (c.eur !== e1 || c.eurFoil !== e2) { c.eur = e1; c.eurFoil = e2; dc = true; }
    });
    if (dc) store.set('mtg_cards', JSON.stringify(deckCards));
    store.set('mtg_alerts', JSON.stringify(alerts.slice(-40)));
    // 3. storico del valore
    const ents = (entries || []).filter(e => cards[e.key]); let value = null;
    if (ents.length) {
      value = valueOf(ents, cards);
      const h = jget('mtg_value_hist', []).filter(x => x.d !== today()); h.push({ d: today(), v: Math.round(value * 100) / 100 });
      store.set('mtg_value_hist', JSON.stringify(h.slice(-400)));
      // 4. variazioni carta per carta rispetto a una rilevazione di almeno 3 giorni fa
      const cur = {}; ents.forEach(e => { const c = cards[e.key]; const p = (e.foilQty && c.eurFoil > c.eur ? c.eurFoil : c.eur) || 0; if (p >= 0.2) cur[e.key] = Math.round(p * 100); });
      let snaps = (await idb.get('snaps')) || [];
      const base = snaps.filter(s => Date.now() - new Date(s.date + 'T12:00:00').getTime() >= 3 * DAY).pop();
      if (base) {
        const rows = Object.keys(cur).filter(k => base.p[k]).map(k => { const o = base.p[k], n = cur[k], c = cards[k]; return { k: k, name: c.name_it || c.name, img: c.img, o: o / 100, n: n / 100, d: (n - o) / 100, pct: (n - o) / o }; }).filter(x => Math.abs(x.d) >= 0.2 && Math.abs(x.pct) >= 0.1);
        store.set('mtg_movers', JSON.stringify({ date: today(), base: base.date, up: rows.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 8), down: rows.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 8) }));
      }
      const lastSnap = snaps[snaps.length - 1];
      if (!lastSnap || Date.now() - new Date(lastSnap.date + 'T12:00:00').getTime() >= 7 * DAY) { snaps.push({ date: today(), p: cur }); snaps = snaps.slice(-6); await idb.set('snaps', snaps); }
    }
    store.set('mtg_refresh_t', String(Date.now()));
    return { value: value, alerts: alerts.filter(a => !a.seen).length };
  }
  return { run: run, valueOf: valueOf };
})();
