'use strict';
/* Funzioni condivise: chiamate a Scryfall, dati compatti delle carte, simboli di mana. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCRY = 'https://api.scryfall.com';
const LEGAL_KEYS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'brawl'];
// ---------- Scryfall
let lastReq = 0;
async function scry(path, body) {
  const gap = 110 - (Date.now() - lastReq); if (gap > 0) await sleep(gap);
  lastReq = Date.now();
  let r;
  try {
    r = await fetch(path.startsWith('http') ? path : SCRY + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
      : { headers: { Accept: 'application/json' } });
  } catch (e) { throw new Error('Connessione a Scryfall non riuscita.'); }
  if (r.status === 404) return { data: [], not_found: [] };
  if (!r.ok) throw new Error('Scryfall: errore ' + r.status);
  return r.json();
}

function slim(c) {
  const faces = c.card_faces || [];
  const f0 = faces[0] || {};
  const iu = c.image_uris || f0.image_uris || {};
  const it = c.lang === 'it';
  const join = k => faces.length ? faces.map(f => f[k] || '').filter(Boolean).join('\n//\n') : (c[k] || '');
  const pn = it ? (c.printed_name || faces.map(f => f.printed_name || f.name).join(' // ')) : null;
  const legal = {}; LEGAL_KEYS.forEach(k => { if (c.legalities && c.legalities[k]) legal[k] = c.legalities[k]; });
  return {
    id: c.oracle_id || f0.oracle_id || c.id, name: c.name, name_it: pn && pn !== c.name ? pn : null,
    type: c.type_line || join('type_line'), type_it: it ? (c.printed_type_line || join('printed_type_line') || null) : null,
    mana: c.mana_cost || faces.map(f => f.mana_cost || '').filter(Boolean).join(' // '), cmc: c.cmc || 0,
    colors: c.colors || f0.colors || [], ci: c.color_identity || [],
    text: c.oracle_text || join('oracle_text'), text_it: it ? (c.printed_text || join('printed_text') || null) : null,
    pt: c.power != null ? c.power + '/' + c.toughness : (f0.power != null ? f0.power + '/' + f0.toughness : (c.loyalty ? 'Lealt\u00e0 ' + c.loyalty : '')),
    img: iu.small || iu.normal || '', imgBig: iu.normal || iu.small || '',
    back: faces[1] && faces[1].image_uris ? faces[1].image_uris.normal : '',
    rarity: c.rarity || '', set: (c.set || '').toUpperCase(), setName: c.set_name || '', cn: c.collector_number || '', released: c.released_at || '', sid: c.id,
    eur: parseFloat(c.prices && c.prices.eur) || 0, eurFoil: parseFloat(c.prices && c.prices.eur_foil) || 0,
    legal, produced: c.produced_mana || [], lang: c.lang || 'en',
  };
}

// ---------- mana
function manaHtml(cost) {
  return String(cost || '').replace(/\{([^}]+)\}/g, (_, s) => {
    const k = s.replace('/', '');
    const col = 'WUBRG'.includes(s) && s.length === 1 ? s : (s === 'C' ? 'C' : (/^\d+$/.test(s) ? 'N' : 'X'));
    return `<span class="pip p${col}">${esc(s.replace('/', ''))}</span>`;
  }).replace(/\/\//g, '<span class="sep">//</span>');
}

