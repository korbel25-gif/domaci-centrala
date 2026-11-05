/* =====================================================================
   DOMÁCÍ CENTRÁLA – jádro
   ---------------------------------------------------------------------
   Jádro nic neví o konkrétních modulech. Každý modul se přihlásí přes
   App.register({...}) a jádro mu dá místo v navigaci, na přehledu
   a vlastní úložiště. Podrobnosti v README.md a modules/_sablona.js.
   ===================================================================== */
(function () {
  'use strict';

  const modules = [];
  const listeners = {};
  const memory = {};               // záloha, když prohlížeč nepovolí localStorage
  let cleanup = null;              // úklid po právě zobrazeném modulu

  /* ---------- úložiště ---------- */
  function lsGet(k) { try { const v = localStorage.getItem(k); return v ?? memory[k] ?? null } catch (e) { return memory[k] ?? null } }
  function lsSet(k, v) { memory[k] = v; try { localStorage.setItem(k, v) } catch (e) { } }
  function lsKeys() { try { return Object.keys(localStorage) } catch (e) { return Object.keys(memory) } }

  /* ---------- ikony (jednoduché SVG, stroke = currentColor) ---------- */
  const I = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const icons = {
    grid: I('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
    wallet: I('<path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4 2 4"/><circle cx="16.5" cy="14" r="1.3"/>'),
    chart: I('<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>'),
    invoice: I('<path d="M6 2h9l4 4v16l-2.5-1.5L14 22l-2.5-1.5L9 22l-2.5-1.5L4 22V4a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    home: I('<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    bolt: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    note: I('<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/><path d="M8 9h8M8 13h5"/>')
  };

  /* ---------- formátování ---------- */
  const nf0 = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = {
    czk: v => nf0.format(v || 0),
    czk2: v => nf2.format(v || 0) + ' Kč',
    num: (v, d = 2) => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: d }).format(v || 0),
    money: (v, ccy = 'CZK', d = 2) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: ccy, maximumFractionDigits: d }).format(v || 0),
    date: d => { if (!d) return ''; const [y, m, x] = String(d).slice(0, 10).split('-'); return `${+x}. ${+m}. ${y}` },
    pct: v => (Math.round(v * 10) / 10).toLocaleString('cs-CZ') + ' %'
  };
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const MON = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, actLabel, act) {
    const el = document.getElementById('coreToast'); if (!el) return;
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (actLabel) { const b = document.createElement('button'); b.textContent = actLabel; b.onclick = () => { el.hidden = true; act() }; el.appendChild(b) }
    el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, actLabel ? 9000 : 4500);
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- veřejné API ---------- */
  const App = {
    version: '0.1.0',
    icons, fmt, esc, toast, today, MONTHS, MON,

    /** Přihlášení modulu. Viz modules/_sablona.js */
    register(m) {
      if (!m || !m.id || modules.some(x => x.id === m.id)) { console.warn('Modul nelze registrovat', m); return }
      modules.push(m); modules.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      if (typeof m.init === 'function') { try { m.init(App.ctx(m)) } catch (e) { console.error(e) } }
    },
    all: () => modules.slice(),
    modules: () => modules.filter(m => !App.disabled().includes(m.id)),
    disabled: () => { try { return JSON.parse(lsGet('hs:core:disabled') || '[]') } catch (e) { return [] } },

    /** Úložiště modulu – klíče se ukládají jako hs:<modul>:<klíč> */
    store(ns) {
      return {
        get(k, d) { const v = lsGet(`hs:${ns}:${k}`); if (v == null) return d; try { return JSON.parse(v) } catch (e) { return d } },
        set(k, v) { lsSet(`hs:${ns}:${k}`, JSON.stringify(v)); App.bus.emit('store:change', { ns, k }) }
      }
    },
    raw: { get: lsGet, set: lsSet, keys: lsKeys },

    /** Sběrnice událostí mezi moduly */
    bus: {
      on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return () => listeners[ev] = listeners[ev].filter(f => f !== fn) },
      emit(ev, data) { (listeners[ev] || []).forEach(f => { try { f(data) } catch (e) { console.error(e) } }) }
    },

    /** Všechny nástroje pro asistenta: z jádra + z modulů (vlastnost tools) */
    tools() {
      const out = [
        { name: 'open_module', module: 'core', description: 'Otevře obrazovku centrály: prehled, system nebo id modulu (' + App.modules().map(m => m.id).join(', ') + ').',
          inputSchema: { type: 'object', properties: { modul: { type: 'string' } }, required: ['modul'] },
          run: inp => { const id = String(inp.modul || '').toLowerCase(); const ok = ['prehled', 'system'].includes(id) || App.modules().some(m => m.id === id); if (!ok) throw new Error('Neznámý modul'); App.go(id); return { otevreno: id } } },
        { name: 'system_info', module: 'core', description: 'Aktuální datum, čas, den v týdnu a seznam aktivních modulů centrály.',
          run: () => ({ datum: today(), cas: new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }), den: new Date().toLocaleDateString('cs-CZ', { weekday: 'long' }), moduly: App.modules().map(m => m.name) }) }
      ];
      for (const m of App.modules()) {
        let t = []; try { t = typeof m.tools === 'function' ? m.tools(App.ctx(m)) : (m.tools || []) } catch (e) { console.error(e) }
        t.forEach(x => out.push({ ...x, module: m.id }));
      }
      return out;
    },

    ctx(m) { return { store: App.store(m.id), toast, bus: App.bus, fmt, esc, icons, go: App.go } },
    go(id) { location.hash = id },

    /** Vloží CSS modulu jen jednou */
    css(id, text) { if (document.getElementById('css-' + id)) return; const s = document.createElement('style'); s.id = 'css-' + id; s.textContent = text; document.head.appendChild(s) },

    /** Animované načtení čísel: <b data-count="1234" data-fmt="czk"> */
    countUp(root) {
      const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.querySelectorAll('[data-count]').forEach(el => {
        const to = +el.dataset.count, f = fmt[el.dataset.fmt || 'czk'] || fmt.czk, pre = el.dataset.pre || '';
        if (rm) { el.textContent = pre + f(to); return }
        const t0 = performance.now(), d = 1000;
        const step = n => { const k = Math.min(1, (n - t0) / d), e = 1 - Math.pow(1 - k, 4); el.textContent = pre + f(to * e); if (k < 1) requestAnimationFrame(step) };
        requestAnimationFrame(step);
      });
    },

    /** Cesta k souboru ve složce aplikace (v jednosouborové verzi vloženo přímo) */
    asset: p => (window.CENTRALA_ASSETS || {})[p] || p,

    /** Prohlížeč obrázků přes celou obrazovku: App.lightbox([{src, title, plan}], index) */
    lightbox(items, i = 0) { lightbox(items, i) },

    start() { App.sync.catchRedirect(); buildNav(); window.addEventListener('hashchange', route); route(); clock(); particles(); glow(); App.sync.init() }
  };
  window.App = App;

  /* ---------- vzhled: auto / tmavý / světlý (pro každé zařízení zvlášť, nesynchronizuje se) ---------- */
  const TH = 'cs-theme', mqLight = matchMedia('(prefers-color-scheme: light)');
  const themePref = () => { const v = lsGet(TH); return ['dark', 'light'].includes(v) ? v : 'auto' };
  function applyTheme() {
    const p = themePref(), eff = p === 'auto' ? (mqLight.matches ? 'light' : 'dark') : p;
    document.documentElement.dataset.cs = eff;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', eff === 'light' ? '#EDF1F7' : '#05070E');
    const sw = document.getElementById('thSw'); if (!sw) return;
    const I = { auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
      dark: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
      light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' };
    const L = { auto: 'Podle systému', dark: 'Tmavý', light: 'Světlý' };
    sw.innerHTML = ['auto', 'dark', 'light'].map(k => `<button role="radio" aria-checked="${p === k}" data-th="${k}" title="${L[k]}" aria-label="${L[k]}">${I[k]}</button>`).join('');
    sw.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { lsSet(TH, b.dataset.th); applyTheme(); toast('Vzhled: ' + L[b.dataset.th].toLowerCase() + '.') });
  }
  mqLight.addEventListener?.('change', () => { if (themePref() === 'auto') applyTheme() });
  applyTheme();
  App.theme = () => document.documentElement.dataset.cs || 'dark';

  /* ---------- prohlížeč obrázků ---------- */
  function lightbox(items, i) {
    document.querySelector('.lbx')?.remove();
    const el = document.createElement('div'); el.className = 'lbx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="lbx-bar"><b class="lbx-t"></b><span class="lbx-n muted num"></span><span style="flex:1"></span>
      <button class="btn sm" data-z="-" aria-label="Oddálit">−</button><button class="btn sm" data-z="+" aria-label="Přiblížit">+</button>
      <a class="btn sm lbx-o" target="_blank" rel="noopener">Originál</a><button class="btn sm" data-x aria-label="Zavřít">✕</button></div>
      <div class="lbx-st"><img alt=""></div>
      <button class="lbx-nav prev" aria-label="Předchozí">‹</button><button class="lbx-nav next" aria-label="Další">›</button>`;
    document.body.appendChild(el);
    const st = el.querySelector('.lbx-st'), img = st.querySelector('img');
    let z = 1;
    const zoom = (nz, cx, cy) => {
      nz = Math.max(1, Math.min(5, nz)); const r = st.getBoundingClientRect();
      cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
      const fx = (st.scrollLeft + cx) / (st.scrollWidth || 1), fy = (st.scrollTop + cy) / (st.scrollHeight || 1);
      z = nz; img.style.width = z * 100 + '%'; img.style.height = z * 100 + '%'; st.classList.toggle('zoomed', z > 1);
      st.scrollLeft = fx * st.scrollWidth - cx; st.scrollTop = fy * st.scrollHeight - cy;
    };
    const show = k => {
      i = (k + items.length) % items.length; const it = items[i];
      z = 1; zoom(1); img.src = it.src; img.alt = it.title || ''; el.classList.toggle('plan', !!it.plan);
      el.querySelector('.lbx-t').textContent = it.title || ''; el.querySelector('.lbx-n').textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
      el.querySelector('.lbx-o').href = it.src; el.querySelectorAll('.lbx-nav').forEach(b => b.hidden = items.length < 2);
    };
    const close = () => { el.remove(); document.removeEventListener('keydown', key) };
    const key = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === '+') zoom(z * 1.6); else if (e.key === '-') zoom(z / 1.6) };
    document.addEventListener('keydown', key);
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('.prev').onclick = () => show(i - 1); el.querySelector('.next').onclick = () => show(i + 1);
    el.querySelector('[data-z="+"]').onclick = () => zoom(z * 1.6); el.querySelector('[data-z="-"]').onclick = () => zoom(z / 1.6);
    st.addEventListener('wheel', e => { if (!e.ctrlKey && z === 1 && Math.abs(e.deltaY) < 40) return; e.preventDefault(); const r = st.getBoundingClientRect(); zoom(z * (e.deltaY < 0 ? 1.25 : .8), e.clientX - r.left, e.clientY - r.top) }, { passive: false });
    // tažení myší / prstem: posun při přiblížení, švih do stran mění obrázek
    let drag = null, moved = 0;
    st.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop, id: e.pointerId }; moved = 0; if (e.pointerType === 'mouse') st.setPointerCapture(e.pointerId) };
    st.onpointermove = e => { if (!drag || drag.id !== e.pointerId) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved = Math.max(moved, Math.abs(dx) + Math.abs(dy)); if (z > 1 && e.pointerType === 'mouse') { st.scrollLeft = drag.l - dx; st.scrollTop = drag.t - dy } };
    st.onpointerup = e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, d = drag; drag = null;
      if (z === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { show(i + (dx < 0 ? 1 : -1)); return }
      if (moved < 8) { if (e.target !== img && z === 1) { close(); return } const r = st.getBoundingClientRect(); zoom(z > 1 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top) }
    };
    st.onpointercancel = () => drag = null;
    show(i); el.querySelector('[data-x]').focus();
  }

  /* ---------- navigace a směrování ---------- */
  function buildNav() {
    const cur = (location.hash || '#prehled').slice(1);
    const link = (id, name, icon) => `<a href="#${id}" data-id="${id}"${cur === id ? ' aria-current="page"' : ''}>${icon}<span>${esc(name)}</span></a>`;
    document.getElementById('nav').innerHTML =
      link('prehled', 'Přehled', icons.grid) + '<div class="sep"></div>' +
      App.modules().map(m => link(m.id, m.short || m.name, m.icon || icons.note)).join('') +
      '<div class="sep"></div>' + link('system', 'Systém', icons.gear);
    document.getElementById('modCount').textContent = `${App.modules().length} modulů aktivních`;
  }
  function setHead(title, sub, crumb) {
    document.getElementById('title').textContent = title;
    document.getElementById('subtitle').textContent = sub || '';
    document.getElementById('crumb').textContent = crumb || 'Domácí centrála';
    document.title = title === 'Přehled' ? 'Domácí centrála' : title + ' · Domácí centrála';
  }
  function route() {
    let id = (location.hash || '#prehled').slice(1) || 'prehled';
    if (cleanup) { try { cleanup() } catch (e) { console.error(e) } cleanup = null }
    const view = document.getElementById('view');
    view.innerHTML = ''; view.classList.remove('view'); void view.offsetWidth; view.classList.add('view');
    if (id === 'prehled') { setHead('Přehled', 'Všechny moduly na jednom místě.'); overview(view) }
    else if (id === 'system') { setHead('Systém', 'Moduly, záloha dat a nastavení centrály.'); system(view) }
    else {
      const m = App.modules().find(x => x.id === id);
      if (!m) { location.hash = 'prehled'; return }
      setHead(m.name, m.description, 'Modul');
      try { const r = m.mount(view, App.ctx(m)); if (typeof r === 'function') cleanup = r }
      catch (e) { console.error(e); view.innerHTML = `<div class="panel err">Modul „${esc(m.name)}“ spadl: ${esc(e.message)}</div>` }
    }
    document.querySelectorAll('#nav a').forEach(a => a.dataset.id === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    window.scrollTo(0, 0);
  }

  /* ---------- přehled ---------- */
  function overview(view) {
    const h = new Date().getHours();
    const hi = h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer';
    const owner = lsGet('hs:core:owner') || '';
    const mods = App.modules();
    view.innerHTML = `<div class="mw">
      <div class="hero"><div><span class="lbl">${hi}${owner ? ', ' + esc(owner) : ''}</span>
        <h2 style="font-size:22px;margin-top:4px">Dnes je ${new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2></div></div>
      <div class="ov" id="ov">${mods.map(m => `<section class="panel wt" data-m="${m.id}">
          <header><span class="t">${m.icon || icons.note}${esc(m.name)}</span><a class="open" href="#${m.id}">Otevřít →</a></header>
          <div class="wb"></div></section>`).join('')}
        <section class="panel wt addmod"><header><span class="t">${icons.plus}Nový modul</span></header>
          <ol><li>Zkopírujte <code>modules/_sablona.js</code> pod novým názvem.</li>
          <li>Upravte <code>id</code>, název a funkce <code>mount</code> a <code>widget</code>.</li>
          <li>Přidejte řádek <code>&lt;script src="modules/…"&gt;</code> do <code>index.html</code>.</li></ol>
          <span class="wnote">Modul se sám objeví v menu i tady na přehledu.</span></section>
      </div></div>`;
    mods.forEach(m => {
      const wb = view.querySelector(`[data-m="${m.id}"] .wb`);
      if (typeof m.widget === 'function') { try { m.widget(wb, App.ctx(m)) } catch (e) { console.error(e); wb.innerHTML = `<span class="err">Chyba widgetu</span>` } }
      else wb.innerHTML = `<span class="wnote">${esc(m.description || '')}</span>`;
      App.countUp(wb);
    });
  }

  /* ---------- systém ---------- */
  function system(view) {
    const dis = App.disabled();
    view.innerHTML = `<div class="mw">
      <section class="panel"><div class="phead"><h2>Moduly</h2><span class="muted">Vypnutý modul zmizí z menu, data zůstanou.</span></div>
        <div class="modlist">${App.all().map(m => `<label><input type="checkbox" class="switch" data-id="${m.id}"${dis.includes(m.id) ? '' : ' checked'}>
          ${m.icon || icons.note}<span><b>${esc(m.name)}</b><br><span class="d">${esc(m.description || '')}</span></span></label>`).join('')}</div></section>
      <section class="panel"><div class="phead"><h2>Synchronizace mezi zařízeními</h2></div><div id="syncPanel"></div></section>
      <div class="grid2">
        <section class="panel"><div class="phead"><h2>Záloha dat</h2></div>
          <p class="muted" style="margin-top:0">Data všech modulů jsou uložená v tomto prohlížeči${App.sync?.state === 'ok' ? ' a v synchronizačním souboru' : ''}. Zálohu si stáhněte nebo zkopírujte text níže a uložte ho do souboru.</p>
          <div class="acts"><button class="btn primary" id="bkDl">Stáhnout zálohu</button><button class="btn" id="bkCopy">Kopírovat</button>
          <label class="btn">Obnovit ze souboru<input type="file" id="bkIn" accept=".json" hidden></label></div>
          <textarea class="dump" id="bkTxt" readonly aria-label="Záloha ve formátu JSON"></textarea></section>
        <section class="panel"><div class="phead"><h2>Centrála</h2></div>
          <div class="fgrid"><label class="field">Jméno pro pozdrav<input type="text" id="owner" value="${esc(lsGet('hs:core:owner') || '')}"></label></div>
          <p class="muted">Verze jádra ${App.version}. Nové moduly přidáte podle souboru <span class="code">README.md</span>.</p></section>
      </div></div>`;
    App.sync?.paint();
    view.querySelectorAll('.switch').forEach(s => s.onchange = () => {
      const d = App.disabled().filter(x => x !== s.dataset.id); if (!s.checked) d.push(s.dataset.id);
      lsSet('hs:core:disabled', JSON.stringify(d)); buildNav(); toast(s.checked ? 'Modul zapnut.' : 'Modul vypnut.');
    });
    const dump = () => { const o = {}; lsKeys().filter(k => (k.startsWith('hs:') || k.startsWith('rodinny-rozpocet')) && !k.startsWith('hs:core:sync')).forEach(k => o[k] = lsGet(k)); return JSON.stringify({ app: 'domaci-centrala', version: App.version, created: new Date().toISOString(), data: o }, null, 1) };
    const txt = view.querySelector('#bkTxt'); txt.value = dump();
    view.querySelector('#bkDl').onclick = () => {
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([dump()], { type: 'application/json' })); a.download = `centrala-zaloha-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); toast('Záloha se stahuje. Pokud se nic nestalo, použijte Kopírovat.') } catch (e) { toast('Stažení nejde, použijte Kopírovat.') }
    };
    view.querySelector('#bkCopy').onclick = () => { navigator.clipboard?.writeText(dump()).then(() => toast('Záloha zkopírována.'), () => { txt.select(); toast('Text je označený, zkopírujte ho Ctrl+C.') }) || (txt.select()) };
    view.querySelector('#bkIn').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!j.data) throw 0; Object.entries(j.data).forEach(([k, v]) => lsSet(k, v)); toast('Data obnovena.'); setTimeout(() => location.reload(), 600) }
      catch (err) { toast('Soubor není záloha centrály.') }
    };
    view.querySelector('#owner').onchange = e => { lsSet('hs:core:owner', e.target.value.trim()); toast('Uloženo.') };
  }

  /* ---------- synchronizace mezi zařízeními ----------
     Data (všechny klíče hs:* a rozpočet) se zrcadlí do jednoho JSON souboru. Úložiště:
     • gdrive – skrytá složka aplikace na vašem Google Disku (přihlášení Google). Funguje na všech
       zařízeních včetně iPhonu a iPadu, ale jen ve verzi z webové adresy (https), ne z index.html ze složky.
     • file   – soubor ve složce synchronizované Google Diskem / OneDrive (Chrome a Edge na počítači).
     Logika: hash posledně synchronizovaného stavu (K_HASH) rozhodne, zda se změnila data tady, v úložišti,
     nebo obojí (pak se zeptá uživatele). Nastavení: config.js → window.CENTRALA_CONFIG.googleClientId */
  const Sync = (() => {
    const K_BASE = 'hs:core:syncBase', K_HASH = 'hs:core:syncHash', K_AT = 'hs:core:syncAt', K_MODE = 'hs:core:syncMode', K_TOK = 'hs:core:syncTok', K_USER = 'hs:core:syncUser';
    const FILE_NAME = 'centrala-data.json', SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const framed = window.self !== window.top;
    const canFile = typeof window.showSaveFilePicker === 'function' && !framed;
    const canDrive = () => !framed && location.protocol === 'https:' && !!(window.CENTRALA_CONFIG || {}).googleClientId;
    let mode = lsGet(K_MODE) || 'off', state = 'off', err = '', busy = false, lastStamp = '', conflict = null, pendingFile = null;
    const isData = k => (k.startsWith('hs:') || k.startsWith('rodinny-rozpocet')) && !k.startsWith('hs:core:sync');
    const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
    const snapshot = () => { const o = {}; lsKeys().filter(isData).forEach(k => o[k] = lsGet(k)); return sortObj(o) };
    const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + s.length };
    const hashOf = o => hash(JSON.stringify(sortObj(o)));
    const editing = () => document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const authErr = msg => Object.assign(new Error(msg), { code: 'auth' });

    /* ===== úložiště: soubor ve složce ===== */
    const FileB = (() => {
      let handle = null;
      const TYPES = [{ description: 'Data Domácí centrály', accept: { 'application/json': ['.json'] } }];
      function idb(m, fn) { return new Promise((ok, ko) => { const r = indexedDB.open('centrala-sync', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onerror = () => ko(r.error); r.onsuccess = () => { const tx = r.result.transaction('h', m); const q = fn(tx.objectStore('h')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error) } }) }
      const keep = h => idb('readwrite', st => h ? st.put(h, 'file') : st.delete('file'));
      return {
        kind: 'file', get name() { return handle?.name || FILE_NAME },
        async load() { try { handle = await idb('readonly', st => st.get('file')) } catch (e) { handle = null } return !!handle },
        async ready() { return !!handle && await handle.queryPermission({ mode: 'readwrite' }) === 'granted' },
        async grant() { if (handle) try { await handle.requestPermission({ mode: 'readwrite' }) } catch (e) { } },
        async create() { handle = await window.showSaveFilePicker({ suggestedName: FILE_NAME, types: TYPES }); await keep(handle) },
        async open() { [handle] = await window.showOpenFilePicker({ types: TYPES }); await keep(handle); try { await handle.requestPermission({ mode: 'readwrite' }) } catch (e) { } },
        async forget() { handle = null; await keep(null) },
        async read() { const t = await (await handle.getFile()).text(); return t.trim() ? JSON.parse(t) : null },
        async write(body) { const w = await handle.createWritable(); await w.write(body); await w.close() },
        async stamp() { return String((await handle.getFile()).lastModified) }
      };
    })();

    /* ===== úložiště: Google Disk (skrytá složka aplikace) ===== */
    const DriveB = (() => {
      let fileId = null;
      const tok = () => { try { const t = JSON.parse(lsGet(K_TOK) || 'null'); if (t && t.exp > Date.now() + 60e3) return t.at } catch (e) { } return null };
      const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
      async function api(path, opt = {}) {
        const t = tok(); if (!t) throw authErr('Přihlášení ke Googlu vypršelo.');
        const r = await fetch('https://www.googleapis.com/' + path, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
        if (r.status === 401) { try { localStorage.removeItem(K_TOK) } catch (e) { } throw authErr('Přihlášení ke Googlu vypršelo.') }
        if (!r.ok) throw new Error('Google Disk odpověděl chybou ' + r.status + ': ' + (await r.text()).slice(0, 140));
        return r;
      }
      async function find() {
        if (fileId) return fileId;
        const j = await (await api('drive/v3/files?spaces=appDataFolder&fields=files(id)&q=' + encodeURIComponent(`name='${FILE_NAME}'`))).json();
        return fileId = j.files?.[0]?.id || null;
      }
      return {
        kind: 'gdrive', get name() { return 'Google Disk' + (lsGet(K_USER) ? ' · ' + lsGet(K_USER) : '') },
        async load() { return true },
        async ready() { return !!tok() },
        /* přesměrování na přihlášení Google (funguje i v aplikaci přidané na plochu iPhonu) */
        login(silent) {
          const c = window.CENTRALA_CONFIG || {}; if (!c.googleClientId) { toast('Chybí googleClientId v souboru config.js.'); return }
          if (silent) sessionStorage.setItem('cs-silent', '1');
          const p = { client_id: c.googleClientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: 'cs:' + ((location.hash || '#prehled').slice(1) || 'prehled') };
          if (silent) p.prompt = 'none'; if (lsGet(K_USER)) p.login_hint = lsGet(K_USER);
          location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(p);
        },
        async grant() { this.login(false) },
        async forget() { fileId = null; try { localStorage.removeItem(K_TOK) } catch (e) { } },
        async read() { const id = await find(); if (!id) return null; const t = await (await api('drive/v3/files/' + id + '?alt=media')).text(); return t.trim() ? JSON.parse(t) : null },
        async write(body) {
          const id = await find();
          if (id) { await api('upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); return }
          const b = 'cs' + Date.now(), meta = { name: FILE_NAME, parents: ['appDataFolder'] };
          const mp = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
          fileId = (await (await api('upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp })).json()).id;
        },
        async stamp() { const id = await find(); if (!id) return ''; const j = await (await api('drive/v3/files/' + id + '?fields=version,modifiedTime')).json(); return String(j.version || j.modifiedTime) },
        async who() { try { const j = await (await api('drive/v3/about?fields=user(emailAddress)')).json(); if (j.user?.emailAddress) lsSet(K_USER, j.user.emailAddress) } catch (e) { } }
      };
    })();

    /* návrat z přihlášení Google: token je v adrese za # → uložit a vrátit původní stránku */
    function catchRedirect() {
      const h = location.hash; if (!/access_token=|error=/.test(h)) return;
      const p = new URLSearchParams(h.slice(1)), back = (p.get('state') || '').replace(/^cs:/, '') || 'system';
      if (p.get('access_token')) { lsSet(K_TOK, JSON.stringify({ at: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 })); lsSet(K_MODE, 'gdrive'); mode = 'gdrive'; sessionStorage.removeItem('cs-silent') }
      else if (!sessionStorage.getItem('cs-silent')) sessionStorage.setItem('cs-err', p.get('error') || 'neznámá chyba');
      history.replaceState(null, '', location.pathname + location.search + '#' + back);
    }

    const B = () => mode === 'gdrive' ? DriveB : mode === 'file' ? FileB : null;
    async function writeNow() {
      const be = B(), data = snapshot();
      await be.write(JSON.stringify({ app: 'domaci-centrala', version: App.version, savedAt: new Date().toISOString(), data }));
      lsSet(K_HASH, hashOf(data)); lsSet(K_BASE, JSON.stringify(data)); lsSet(K_AT, new Date().toISOString()); lastStamp = await be.stamp();
    }
    /* sloučení po klíčích (3cestně proti poslednímu společnému stavu): konflikt jen když se tentýž klíč změnil na obou stranách */
    function merge(L, Rm, O) {
      const m = {}, c = [];
      for (const k of new Set([...Object.keys(L), ...Object.keys(Rm), ...Object.keys(O)])) {
        const l = L[k], r = Rm[k], o = O[k]; let v;
        if (l === r) v = l; else if (l === o) v = r; else if (r === o) v = l; else { c.push(k); v = l }
        if (v !== undefined) m[k] = v;
      }
      return { merged: sortObj(m), conflicts: c };
    }
    const getBase = () => { try { return JSON.parse(lsGet(K_BASE) || 'null') } catch (e) { return null } };
    function applyData(data) {
      lsKeys().filter(isData).forEach(k => { if (!(k in data)) { try { localStorage.removeItem(k) } catch (e) { } delete memory[k] } });
      Object.entries(data).forEach(([k, v]) => lsSet(k, v));
      lsSet(K_HASH, hashOf(snapshot())); lsSet(K_BASE, JSON.stringify(snapshot())); lsSet(K_AT, new Date().toISOString());
    }
    function loadFrom(file) {
      if (editing()) { if (!pendingFile) toast('Na jiném zařízení se změnila data. Načtou se, až dopíšete.', 'Načíst teď', () => { applyData(pendingFile.data); location.reload() }); pendingFile = file; return }
      applyData(file.data); toast('Načtena data z jiného zařízení.'); setTimeout(() => location.reload(), 600);
    }
    async function reconcile() {
      const be = B(); if (!be || busy || pendingFile) return; busy = true;
      try {
        if (!await be.ready()) { state = mode === 'gdrive' ? 'login' : 'perm'; return }
        const file = await be.read();
        if (file && typeof file.data !== 'object') throw new Error('Synchronizační soubor nemá správný formát.');
        if (!file) { await writeNow(); state = 'ok'; return }
        lastStamp = await be.stamp();
        const base = lsGet(K_HASH) || '', loc = hashOf(snapshot()), fh = hashOf(file.data);
        if (fh === loc) { if (base !== loc) lsSet(K_HASH, loc); lsSet(K_AT, new Date().toISOString()); state = 'ok'; conflict = null }
        else if (fh !== base && loc === base) { state = 'ok'; loadFrom(file) }
        else if (loc !== base && fh === base) { await writeNow(); state = 'ok' }
        else {
          const O = getBase(), r = O ? merge(snapshot(), file.data, O) : null;
          if (r && !r.conflicts.length) {
            if (hashOf(r.merged) === loc) { await writeNow(); state = 'ok' }                    // jen tady přibylo/změnilo se → odeslat
            else if (editing()) { state = 'ok'; busy = false; return }                           // počkat, až uživatel dopíše
            else { applyData(r.merged); await writeNow(); state = 'ok'; toast('Sloučena data z jiného zařízení.'); setTimeout(() => location.reload(), 600) }
          } else { state = 'conflict'; conflict = file }
        }
        err = '';
      } catch (e) { if (e.code === 'auth') state = 'login'; else { state = 'err'; err = e.message || String(e) } }
      finally { busy = false; paint() }
    }
    let n = 0;
    async function tick() {
      if (pendingFile) { if (!editing()) { applyData(pendingFile.data); location.reload() } return }
      const be = B(); if (!be || state !== 'ok' || busy) return;
      n++;
      try {
        if (hashOf(snapshot()) !== (lsGet(K_HASH) || '')) {        // změna tady → zapsat (ale nejdřív ověřit, že se mezitím nezměnilo úložiště)
          busy = true; const st = await be.stamp(); busy = false;
          if (st && st !== lastStamp) return reconcile();
          busy = true; await writeNow(); busy = false; paint(); return;
        }
        if (mode === 'file' || n % 5 === 0) { const st = await be.stamp(); if (st !== lastStamp) reconcile() }   // Google Disk kontrolujeme ~každých 20 s
      } catch (e) { busy = false; if (e.code === 'auth') state = 'login'; else { state = 'err'; err = e.message } paint() }
    }

    /* ===== ovládání ===== */
    const guard = fn => async () => { try { await fn() } catch (e) { if (e?.name !== 'AbortError') { state = 'err'; err = e.message || String(e); paint() } } };
    const act = {
      driveOn: () => DriveB.login(false),
      fileNew: guard(async () => { await FileB.create(); mode = 'file'; lsSet(K_MODE, 'file'); await writeNow(); state = 'ok'; paint(); toast('Synchronizační soubor vytvořen. Na druhém počítači ho připojte.') }),
      fileOpen: guard(async () => { await FileB.open(); mode = 'file'; lsSet(K_MODE, 'file'); lsSet(K_HASH, ''); await reconcile() }),
      grant: guard(async () => { const be = B(); if (be) await be.grant(); await reconcile() }),
      retry: guard(reconcile),
      useFile: () => { if (!conflict) return; applyData(conflict.data); lastStamp = ''; location.reload() },
      useLocal: guard(async () => { busy = true; await writeNow(); busy = false; conflict = null; state = 'ok'; paint(); toast('Úložiště přepsáno daty z tohoto zařízení.') }),
      off: guard(async () => { const be = B(); if (be) await be.forget(); mode = 'off'; lsSet(K_MODE, 'off'); conflict = null; state = 'off'; paint(); toast('Synchronizace vypnuta. Data zůstávají v tomto prohlížeči.') })
    };
    const at = () => { const a = lsGet(K_AT); return a ? new Date(a).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' };
    const label = () => ({ off: canDrive() || canFile ? 'synchronizace vypnutá' : 'data jen v tomto prohlížeči', ok: 'synchronizováno ' + at(), perm: 'synchronizace čeká na povolení', login: 'přihlásit ke Googlu', conflict: 'rozdílná data – vyřešit', err: 'chyba synchronizace' })[state];
    function paint() {
      const el = document.getElementById('syncSt'); if (el) { el.textContent = label(); el.className = 'sync-' + state }
      const p = document.getElementById('syncPanel'); if (p) { p.innerHTML = panelHtml(); p.querySelectorAll('[data-sy]').forEach(b => b.onclick = () => act[b.dataset.sy]()) }
    }
    function panelHtml() {
      const btn = (a, t, pri) => `<button class="btn${pri ? ' primary' : ''}" data-sy="${a}">${t}</button>`;
      const pill = { off: '<span class="pill dim">vypnuto</span>', ok: '<span class="pill ok">zapnuto</span>', perm: '<span class="pill warn">čeká na povolení</span>', login: '<span class="pill warn">přihlásit</span>', conflict: '<span class="pill warn">rozdílná data</span>', err: '<span class="pill bad">chyba</span>' }[state];
      const e = sessionStorage.getItem('cs-err'); if (e) sessionStorage.removeItem('cs-err');
      const loginErr = e ? `<p class="err">Přihlášení ke Googlu se nepovedlo (${esc(e)}).</p>` : '';
      if (state === 'off') {
        const drive = canDrive() ? `<div class="panel" style="padding:14px"><b>Google Disk</b> <span class="pill ok">doporučeno</span><p class="muted" style="margin:6px 0 10px">Data se ukládají do skryté složky aplikace na vašem Google Disku. Funguje na počítači, Macu, iPadu i iPhonu. Na každém zařízení se jednou přihlásíte.</p>${btn('driveOn', 'Přihlásit přes Google', true)}</div>`
          : `<div class="panel" style="padding:14px"><b>Google Disk</b><p class="muted" style="margin:6px 0 0">${framed ? 'V této vložené verzi nejde.' : location.protocol !== 'https:' ? 'Funguje ve verzi otevřené z webové adresy (https), ne z index.html ze složky.' : 'Chybí přístupový klíč Google v souboru config.js (googleClientId).'}</p></div>`;
        const file = canFile ? `<div class="panel" style="padding:14px"><b>Soubor ve složce</b><p class="muted" style="margin:6px 0 10px">Soubor ve složce Google Disku nebo OneDrive na počítači. Jen Chrome a Edge.</p><div class="acts">${btn('fileNew', 'Vytvořit soubor')}${btn('fileOpen', 'Připojit existující')}</div></div>` : '';
        return `${loginErr}<div class="grid2">${drive}${file}</div>`;
      }
      const name = B()?.name || '';
      if (state === 'conflict') return `<p style="margin-top:0">${pill} Data v tomto zařízení a v úložišti (${esc(name)}) se liší. Která platí?</p>
        <div class="acts">${btn('useFile', 'Použít data z úložiště' + (conflict?.savedAt ? ' (uloženo ' + new Date(conflict.savedAt).toLocaleString('cs-CZ') + ')' : ''), true)}${btn('useLocal', 'Použít data z tohoto zařízení')}</div>
        <p class="muted" style="font-size:12px">Druhá verze se přepíše. Pokud si nejste jistí, nejdřív si níže stáhněte zálohu.</p>`;
      return `${loginErr}<p style="margin-top:0">${pill} ${esc(name)}${state === 'ok' ? ` · naposledy ${at()}` : ''}</p>
        ${state === 'login' ? `<p class="muted">Přihlášení ke Googlu platí hodinu a obnovuje se při otevření aplikace. Teď je potřeba se přihlásit znovu.</p><div class="acts">${btn('grant', 'Přihlásit přes Google', true)}${btn('off', 'Vypnout synchronizaci')}</div>` : ''}
        ${state === 'perm' ? `<p class="muted">Prohlížeč potřebuje po spuštění znovu povolit přístup k souboru. V dialogu můžete zvolit „Povolit při každé návštěvě“.</p><div class="acts">${btn('grant', 'Povolit přístup', true)}${btn('off', 'Vypnout synchronizaci')}</div>` : ''}
        ${state === 'err' ? `<p class="err">${esc(err)}</p><div class="acts">${btn('retry', 'Zkusit znovu', true)}${btn('off', 'Vypnout synchronizaci')}</div>` : ''}
        ${state === 'ok' ? `<p class="muted" style="font-size:12px">Změny se ukládají během několika sekund. Ostatní zařízení je načtou při otevření a za běhu zhruba do 20 sekund.</p><div class="acts">${btn('retry', 'Synchronizovat teď')}${btn('off', 'Vypnout synchronizaci')}</div>` : ''}`;
    }
    async function init() {
      catchRedirect();
      setInterval(tick, 4000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && B() && state !== 'login') reconcile() });
      const el = document.getElementById('syncSt'); if (el) el.onclick = () => (state === 'login' || state === 'perm') ? act.grant() : App.go('system');
      if (mode === 'gdrive' && !canDrive()) mode = 'off';
      if (mode === 'file' && (!canFile || !await FileB.load())) mode = 'off';
      if (mode === 'off') { state = 'off'; paint(); return }
      if (mode === 'gdrive' && !await DriveB.ready()) {
        // tichá obnova přihlášení (jednou za otevření); když se nepovede, uživatel klikne na „Přihlásit“
        if (!sessionStorage.getItem('cs-silent')) { DriveB.login(true); return }
        sessionStorage.removeItem('cs-silent'); state = 'login'; paint(); return;
      }
      if (mode === 'gdrive' && !lsGet(K_USER)) DriveB.who();
      await reconcile();
    }
    return { init, paint, catchRedirect, get state() { return state }, get mode() { return mode } };
  })();
  App.sync = Sync;

  /* ---------- hodiny ---------- */
  function clock() {
    const el = document.getElementById('clock');
    const tick = () => { const d = new Date(); el.innerHTML = `<b>${d.toLocaleTimeString('cs-CZ')}</b>${d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })}` };
    tick(); setInterval(tick, 1000);
  }

  /* ---------- pozadí: částice ---------- */
  const PC = () => document.documentElement.dataset.cs === 'light' ? 'rgba(0,137,168,' : 'rgba(46,240,255,';
  function particles() {
    const c = document.getElementById('fx'); if (!c) return; const x = c.getContext('2d');
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W, H, P = [], mx = -999, my = -999;
    const size = () => {
      const d = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0);
      const n = Math.round(Math.min(90, W * H / 16000));
      P = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.4 + .4 }));
    };
    size(); addEventListener('resize', size);
    addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY });
    const draw = () => {
      x.clearRect(0, 0, W, H);
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        const dm = Math.hypot(p.x - mx, p.y - my); if (dm < 120 && dm > 0) { p.x += (p.x - mx) / dm * .6; p.y += (p.y - my) / dm * .6 }
        x.fillStyle = PC() + '.55)'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill();
      }
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 110) { x.strokeStyle = PC() + ((1 - d / 110) * .14) + ')'; x.lineWidth = 1; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke() }
      }
      if (!RM && !document.hidden) requestAnimationFrame(draw);
    };
    draw(); document.addEventListener('visibilitychange', () => { if (!document.hidden && !RM) requestAnimationFrame(draw) });
  }
  /* ---------- záře panelů pod kurzorem ---------- */
  function glow() {
    document.addEventListener('pointermove', e => {
      const el = e.target.closest && e.target.closest('.panel,.kpi'); if (!el) return;
      const r = el.getBoundingClientRect(); el.style.setProperty('--gx', (e.clientX - r.left) + 'px'); el.style.setProperty('--gy', (e.clientY - r.top) + 'px');
    });
  }
})();
