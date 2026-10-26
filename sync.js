'use strict';
/* Account e salvataggio online (Supabase). Senza config.js compilato non fa nulla.
   Sincronizza solo mazzi, carte dei mazzi e collezione. Il token Cardtrader NON viene mai inviato. */
(function () {
  const KEYS = ['mtg_decks', 'mtg_cards', 'mtg_cur', 'mtg_owned', 'mtg_owned_rows', 'mtg_entries', 'mtg_sell_sent', 'mtg_sell_list'];
  const cfg = window.MTG_CFG || {};
  const LS = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRem = Storage.prototype.removeItem;
  const lget = k => { try { return LS.getItem(k); } catch (e) { return null; } };
  const lset = (k, v) => { try { rawSet.call(LS, k, v); } catch (e) { /* ignora */ } };
  const lrem = k => { try { rawRem.call(LS, k); } catch (e) { /* ignora */ } };
  if (!cfg.url || !cfg.key) return;

  let sb = null, user = null, pushT = null, busy = false, status = '';
  const dirty = () => lget('mtg_sync_dirty') === '1';
  const markDirty = () => { lset('mtg_sync_dirty', '1'); if (user) { clearTimeout(pushT); pushT = setTimeout(() => push().catch(() => {}), 1500); } };
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === LS && KEYS.indexOf(k) >= 0) markDirty(); };
  Storage.prototype.removeItem = function (k) { rawRem.call(this, k); if (this === LS && KEYS.indexOf(k) >= 0) markDirty(); };

  const emptyV = v => !v || v === '[]' || v === '{}';
  const isEmptyLocal = () => emptyV(lget('mtg_decks')) && emptyV(lget('mtg_owned_rows')) && emptyV(lget('mtg_entries'));
  const hhmm = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  async function push() {
    if (!user || busy) return; busy = true;
    try {
      const rows = [], gone = [], now = new Date().toISOString();
      KEYS.forEach(k => { const v = lget(k); if (v == null) gone.push(k); else rows.push({ user_id: user.id, key: k, value: v, updated_at: now }); });
      if (rows.length) { const r = await sb.from('user_data').upsert(rows, { onConflict: 'user_id,key' }); if (r.error) throw r.error; }
      if (gone.length) { const r = await sb.from('user_data').delete().in('key', gone); if (r.error) throw r.error; }
      lset('mtg_sync_last', now); lset('mtg_sync_dirty', '0'); status = 'Salvato online alle ' + hhmm();
    } catch (e) { status = 'Non riesco a salvare online (' + (e.message || e) + '). Riprovo alla prossima modifica.'; }
    busy = false; paint();
  }
  const ts = x => { const t = new Date(x).getTime(); return isNaN(t) ? 0 : t; };
  async function pull() {
    const r = await sb.from('user_data').select('key,value,updated_at'); if (r.error) throw r.error;
    const rows = r.data || [], last = ts(lget('mtg_sync_last'));
    const newest = rows.reduce((m, x) => Math.max(m, ts(x.updated_at)), 0);
    const differs = rows.some(x => KEYS.indexOf(x.key) >= 0 && lget(x.key) !== x.value) || KEYS.some(k => lget(k) != null && !rows.some(x => x.key === k));
    const apply = () => {
      rows.forEach(x => { if (KEYS.indexOf(x.key) >= 0 && lget(x.key) !== x.value) lset(x.key, x.value); });
      KEYS.forEach(k => { if (!rows.some(x => x.key === k) && lget(k) != null) lrem(k); });
      lset('mtg_sync_last', new Date(newest).toISOString()); lset('mtg_sync_dirty', '0'); status = 'Dati online caricati alle ' + hhmm();
      if (differs) location.reload();
    };
    if (!rows.length) { if (!isEmptyLocal()) await push(); return; }
    if (!differs) { lset('mtg_sync_last', new Date(newest).toISOString()); lset('mtg_sync_dirty', '0'); status = 'Dati sincronizzati alle ' + hhmm(); return; }
    // Differenze: se qui non c'e niente di modificato, vincono i dati online.
    if (isEmptyLocal() || (!dirty() && lget('mtg_sync_last'))) return apply();
    if (confirm('Online ci sono dei dati salvati diversi da quelli di questo dispositivo.\n\nOK = usa i dati online (quelli di questo dispositivo vengono sostituiti)\nAnnulla = tieni quelli di questo dispositivo (sostituiscono quelli online)')) return apply();
    return push();
  }

  // ---------- interfaccia
  let btn = null, box = null;
  function css(el, s) { el.style.cssText = s; return el; }
  function paint() {
    if (btn) btn.textContent = user ? 'Account' : 'Accedi';
    const m = document.getElementById('acctMsg'); if (m && user) m.textContent = status;
  }
  function closeBox() { if (box) { box.remove(); box = null; } }
  function openBox() {
    closeBox();
    box = css(document.createElement('div'), 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:grid;place-items:center;padding:14px');
    const inner = css(document.createElement('div'), 'background:var(--card,#fff);color:var(--ink,#111);border-radius:14px;padding:16px;max-width:380px;width:100%;position:relative;font:15px/1.5 system-ui,sans-serif');
    const inp = 'width:100%;padding:9px 10px;margin:4px 0 8px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--bg,#fff);color:inherit;font:inherit;font-size:16px;box-sizing:border-box';
    const bt = 'padding:8px 12px;border-radius:8px;border:1px solid var(--accent,#1f5f4a);background:var(--accent,#1f5f4a);color:var(--accent-ink,#fff);font:inherit;font-weight:600;cursor:pointer;margin:4px 6px 4px 0';
    const bt2 = bt.replace('background:var(--accent,#1f5f4a)', 'background:transparent').replace('color:var(--accent-ink,#fff)', 'color:var(--accent,#1f5f4a)');
    if (user) {
      inner.innerHTML = '<h3 style="margin:0 0 6px">Il tuo account</h3><div style="word-break:break-all">' + (user.email || '') + '</div><div id="acctMsg" style="font-size:13px;opacity:.75;margin:6px 0">' + status + '</div>' +
        '<button id="aSync" style="' + bt + '">Sincronizza ora</button><button id="aOut" style="' + bt2 + '">Esci</button><br>' +
        '<button id="aDel" style="' + bt2 + ';font-size:13px">Elimina i miei dati online</button>' +
        '<div style="font-size:12px;opacity:.7;margin-top:8px">Online vanno solo mazzi e collezione. Il token Cardtrader resta su questo dispositivo.</div>';
    } else {
      inner.innerHTML = '<h3 style="margin:0 0 6px">Accedi</h3><div style="font-size:13px;opacity:.75">Con un account ritrovi mazzi e collezione su ogni dispositivo.</div>' +
        '<label style="font-size:13px">Email<input id="aMail" type="email" autocomplete="email" style="' + inp + '"></label>' +
        '<label style="font-size:13px">Password (almeno 6 caratteri)<input id="aPass" type="password" autocomplete="current-password" style="' + inp + '"></label>' +
        '<button id="aIn" style="' + bt + '">Accedi</button><button id="aUp" style="' + bt2 + '">Crea account</button><br><button id="aRes" style="' + bt2 + ';font-size:13px">Password dimenticata</button><div id="aMsg" style="font-size:13px;margin-top:6px"></div>';
    }
    const x = css(document.createElement('button'), 'position:absolute;top:4px;right:8px;background:none;border:none;font-size:24px;color:inherit;cursor:pointer'); x.textContent = '×'; x.onclick = closeBox; inner.appendChild(x);
    box.appendChild(inner); box.addEventListener('click', e => { if (e.target === box) closeBox(); }); document.body.appendChild(box);
    const q = id => inner.querySelector('#' + id), msg = t => { const m = q('aMsg'); if (m) m.textContent = t; };
    if (user) {
      q('aSync').onclick = async () => { try { status = 'Sincronizzo...'; paint(); if (dirty()) await push(); else await pull(); } catch (e) { status = 'Errore: ' + (e.message || e); } paint(); };
      q('aOut').onclick = async () => { await sb.auth.signOut(); user = null; closeBox(); paint(); };
      q('aDel').onclick = async () => {
        if (!confirm('Eliminare mazzi e collezione salvati online? Quelli su questo dispositivo restano.')) return;
        const r = await sb.from('user_data').delete().in('key', KEYS); status = r.error ? 'Errore: ' + r.error.message : 'Dati online eliminati'; lrem('mtg_sync_last'); paint();
      };
    } else {
      const cred = () => ({ email: q('aMail').value.trim(), password: q('aPass').value });
      q('aIn').onclick = async () => { msg('Accedo...'); const r = await sb.auth.signInWithPassword(cred()); if (r.error) return msg('Non riesco ad accedere: ' + r.error.message); };
      q('aUp').onclick = async () => {
        const c = cred(); if (!c.email || c.password.length < 6) return msg('Scrivi email e una password di almeno 6 caratteri.');
        msg('Creo l\'account...'); c.options = { emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') };
        const r = await sb.auth.signUp(c); if (r.error) return msg('Errore: ' + r.error.message);
        if (!r.data.session) msg('Ti ho mandato una email: aprila e conferma, poi torna qui e accedi.');
      };
      q('aRes').onclick = async () => { const m = q('aMail').value.trim(); if (!m) return msg('Scrivi prima la tua email.'); const r = await sb.auth.resetPasswordForEmail(m, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') }); msg(r.error ? 'Errore: ' + r.error.message : 'Ti ho mandato una email per cambiare la password.'); };
    }
  }
  function mount() {
    btn = document.createElement('a'); btn.href = '#'; btn.textContent = 'Accedi'; btn.className = 'acct';
    btn.onclick = e => { e.preventDefault(); openBox(); };
    const bar = document.querySelector('.tabbar');
    if (bar && window.innerWidth >= 900) { bar.appendChild(btn); return; }
    document.body.classList.add('hasacct'); document.body.appendChild(btn);
  }
  function load(cb) {
    if (window.supabase) return cb();
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
    s.onload = cb; s.onerror = () => { status = 'Servizio online non raggiungibile'; }; document.head.appendChild(s);
  }
  function start() {
    mount();
    load(async () => {
      sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
      const s = await sb.auth.getSession(); user = s.data.session ? s.data.session.user : null; paint();
      let first = true;
      sb.auth.onAuthStateChange(async (ev, sess) => {
        const u = sess ? sess.user : null; const was = user; user = u; paint();
        if (u && (!was || first)) { first = false; try { await pull(); } catch (e) { status = 'Errore: ' + (e.message || e); } closeBox(); paint(); }
      });
      if (user) { first = false; try { await pull(); } catch (e) { status = 'Errore: ' + (e.message || e); } paint(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
