'use strict';
/* Nuovo mazzo: una scelta chiara tra tre modi (da solo, automatico, guidato). */
(function () {
  let ov = null;
  const css = document.createElement('style');
  css.textContent = [
    '#wiz { position:fixed; inset:0; z-index:70; background:var(--bg); overflow:auto; -webkit-overflow-scrolling:touch; }',
    '#wiz .wbox { max-width:640px; margin:0 auto; padding:14px 14px 40px; }',
    '#wiz .whead { display:flex; align-items:center; gap:10px; margin-bottom:10px; } #wiz .whead h2 { margin:0; font-size:21px; flex:1; }',
    '#wiz .wx { background:transparent; border:none; color:var(--muted); font-size:28px; line-height:1; padding:2px 8px; cursor:pointer; }',
    '#wiz .wback { background:transparent; border:none; color:var(--accent); padding:4px 0; font-size:15px; cursor:pointer; margin-bottom:6px; }',
    '#wiz .wopt { display:flex; gap:14px; align-items:center; width:100%; text-align:left; background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:14px; padding:16px; margin:0 0 12px; cursor:pointer; font:inherit; }',
    '#wiz .wopt:hover, #wiz .wopt:focus-visible { border-color:var(--accent); }',
    '#wiz .wopt .wi { flex:none; width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:rgba(230,184,87,.14); color:#e6b857; font-size:22px; }',
    '#wiz .wopt b { display:block; font-size:17px; margin-bottom:2px; } #wiz .wopt span.d { color:var(--muted); font-size:14px; line-height:1.35; display:block; }',
    '#wiz .wopt em { font-style:normal; font-size:11px; color:var(--accent); border:1px solid var(--accent); border-radius:9px; padding:0 6px; margin-left:6px; vertical-align:middle; }',
    '#wiz .wsec { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:12px; }',
    '#wiz .wsec h4 { margin:0 0 8px; font-size:15px; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; } #wiz .wsec h4 small, #wiz .wsec summary small { color:var(--muted); font-weight:400; font-size:12.5px; }',
    '#wiz .wsec h4 b, #wiz .wsec summary b { display:inline-grid; place-items:center; width:22px; height:22px; border-radius:50%; background:#e6b857; color:#1a1208; font-size:13px; margin-right:6px; }',
    '#wiz .wsec summary { cursor:pointer; font-weight:700; font-size:15px; color:var(--ink); }',
    '#wiz .row { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; } #wiz label.f { flex:1 1 200px; font-size:13px; color:var(--muted); display:block; }',
    '#wiz label.f select, #wiz label.f input { width:100%; margin-top:3px; font-size:16px; }',
    '#wiz .thm { display:flex; flex-wrap:wrap; gap:8px; } #wiz .chip { padding:7px 13px; font-size:14.5px; }',
    '#wiz .sug { color:var(--accent); margin:0 0 8px; min-height:0; }',
    '#wiz .stick { position:sticky; bottom:0; background:var(--bg); padding:10px 0 4px; border-top:1px solid var(--line); } #wiz .stick button { width:100%; font-size:16px; padding:12px; }',
    '#wiz .stick .msg { margin-bottom:6px; min-height:0; }',
    '#wiz .big { width:100%; font-size:16px; padding:12px; margin-top:10px; }'
  ].join('\n');
  document.head.appendChild(css);

  function close() { if (ov) { ov.remove(); ov = null; document.body.classList.remove('noscroll'); } }
  window.__wizClose = close;
  const fmtOpts = (sel) => Object.entries(Deck.FORMATS).map(([k, f]) => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
  function shell(title, back) {
    ov.innerHTML = '<div class="wbox"><div class="whead"><h2>' + title + '</h2><button class="wx" id="wX" aria-label="Chiudi">&times;</button></div>' + (back ? '<button class="wback" id="wBack">&larr; Indietro</button>' : '') + '<div id="wBody"></div></div>';
    document.getElementById('wX').onclick = close;
    if (back) document.getElementById('wBack').onclick = choose;
    return document.getElementById('wBody');
  }
  function choose() {
    const b = shell('Nuovo mazzo', false);
    b.innerHTML = '<div class="msg" style="margin-bottom:12px">Come vuoi iniziare?</div>' +
      '<button class="wopt" data-w="manual"><span class="wi">✎</span><span><b>Lo costruisco io</b><span class="d">Mazzo vuoto: cerchi le carte e le aggiungi una a una.</span></span></button>' +
      '<button class="wopt" data-w="auto"><span class="wi">✨</span><span><b>Automatico<em>nuovo</em></b><span class="d">Scegli formato, tema e colori: l\'app compone un mazzo completo e poi lo rifinisci tu.</span></span></button>' +
      '<button class="wopt" data-w="coach"><span class="wi">❖</span><span><b>Guidato con i consigli</b><span class="d">Parti da un mazzo vuoto e l\'app ti guida un passo alla volta: tema, carte chiave, rampa, rimozioni, terre.</span></span></button>';
    b.querySelectorAll('[data-w]').forEach(x => { x.onclick = () => ({ manual: manual, auto: auto, coach: coach })[x.dataset.w](); });
  }
  function nameFmt(title, back, btn, go) {
    const b = shell(title, true);
    b.innerHTML = '<div class="wsec"><label class="f" style="display:block">Nome del mazzo<input id="wName" type="text" placeholder="es. Selesnya pedine" autocomplete="off"></label>' +
      '<div class="row"><label class="f">Formato<select id="wFmt">' + fmtOpts('pioneer') + '</select></label></div></div>' +
      '<div class="msg">' + back + '</div><button class="big" id="wGo">' + btn + '</button>';
    document.getElementById('wGo').onclick = () => go((document.getElementById('wName').value || '').trim() || 'Nuovo mazzo', document.getElementById('wFmt').value);
    document.getElementById('wName').focus();
  }
  function manual() {
    nameFmt('Lo costruisco io', 'Il mazzo parte vuoto e si apre la ricerca per aggiungere le carte.', 'Crea il mazzo', (n, f) => {
      newDeck(n, f); close(); const s = document.getElementById('btnSearch'); if (s) s.click();
    });
  }
  function coach() {
    nameFmt('Guidato con i consigli', 'L\'app ti propone un passo alla volta cosa aggiungere, e ti dice cosa manca.', 'Crea e inizia', (n, f) => {
      newDeck(n, f); close(); S.strat.open = true; store.set('mtg_strat_open', '1'); render();
      const e = document.getElementById('stratBox'); if (e) setTimeout(() => e.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    });
  }
  function auto() {
    const b = shell('Mazzo automatico', true);
    b.innerHTML = '<div class="msg" style="margin-bottom:10px">Rispondi a poche domande: al resto pensa l\'app. Il mazzo che ottieni lo puoi cambiare come vuoi.</div><div id="wAuto"></div>';
    AutoDeck.mount(document.getElementById('wAuto'), 'pioneer', close);
  }
  function open() {
    close(); ov = document.createElement('div'); ov.id = 'wiz'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Nuovo mazzo');
    document.body.appendChild(ov); document.body.classList.add('noscroll'); choose();
  }
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
  const b1 = document.getElementById('btnNew'); if (b1) b1.onclick = open;
  if (location.hash === '#new') { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ok */ } setTimeout(open, 50); }
  document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('#empty .newlink')) open(); });
})();
