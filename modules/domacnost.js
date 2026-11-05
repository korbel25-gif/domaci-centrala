/* =====================================================================
   MODUL: Chytrá domácnost
   Zatím SIMULACE – zařízení, termostat a spotřeba se jen napodobují.
   Připojení skutečné domácnosti: doplňte funkci haCall() níže
   (např. Home Assistant REST API: /api/states, /api/services/...).
   Data: App.store('domacnost') → 'devices', 'thermo', 'ha'
   ===================================================================== */
(function () {
  const { esc } = App;

  App.css('domacnost', `
  .hm-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
  .thermo{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .thermo svg{width:150px;height:150px;flex:none}
  .thermo .arc{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px currentColor)}
  .thermo text{font-family:var(--f-mono);fill:var(--fg)}
  .thermo .ctl{display:flex;flex-direction:column;gap:8px}
  .thermo .ctl .btn{font-size:18px;padding:6px 16px}
  .energy svg{width:100%;height:110px;display:block}
  .energy .now{font-family:var(--f-mono);font-size:30px;color:var(--warn);text-shadow:0 0 14px rgba(255,210,74,.5)}
  .scenes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .scenes .btn{padding:14px 10px}
  .rooms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}
  .room h2{margin-bottom:12px}
  .dev{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:var(--r);background:rgba(8,12,24,.6);transition:box-shadow .35s,border-color .35s}
  .room .devs{display:flex;flex-direction:column;gap:10px}
  .dev header{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .dev header b{display:flex;align-items:center;gap:8px}
  .bulb{width:14px;height:14px;border-radius:50%;background:var(--line);transition:background .3s,box-shadow .3s}
  .dev.on{border-color:rgba(255,210,74,.55);box-shadow:0 0 22px rgba(255,210,74,calc(var(--lv,1)*.25)),inset 0 0 18px rgba(255,210,74,calc(var(--lv,1)*.08))}
  .dev.on .bulb{background:#FFE48A;box-shadow:0 0 calc(6px + var(--lv,1)*14px) #FFD24A}
  .dev.plug.on{border-color:rgba(56,255,165,.5);box-shadow:0 0 18px rgba(56,255,165,.18)}
  .dev.plug.on .bulb{background:var(--inc);box-shadow:0 0 12px var(--inc)}
  .dev input[type=range]{width:100%;accent-color:var(--accent)}
  .blind{height:46px;border:1px solid var(--line);position:relative;overflow:hidden;background:linear-gradient(180deg,rgba(46,240,255,.12),rgba(140,90,255,.08))}
  .blind i{position:absolute;inset:0 0 auto;background:repeating-linear-gradient(180deg,#24314f 0 5px,#141c30 5px 7px);transition:height .5s cubic-bezier(.2,.8,.2,1)}
  .gate{height:10px;background:rgba(255,255,255,.07);position:relative;overflow:hidden}
  .gate i{position:absolute;left:0;top:0;bottom:0;background:var(--accent);box-shadow:0 0 10px var(--accent);transition:width 2.4s linear}
  .hp{position:relative;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:#04060c}
  .hp img{display:block;width:100%;height:auto;filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(1.1);opacity:.55;user-select:none}
  .hp svg{position:absolute;inset:0;width:100%;height:100%}
  .hp .rm{cursor:pointer;outline:none}
  .hp .rm polygon{fill:rgba(46,240,255,.03);stroke:rgba(46,240,255,.25);stroke-width:3;transition:fill .5s,stroke .3s,filter .5s}
  .hp .rm.lit polygon{fill:rgba(255,210,74,calc(.06 + var(--lv,1)*.2));stroke:rgba(255,210,74,.7);filter:drop-shadow(0 0 calc(var(--lv,1)*26px) rgba(255,210,74,.55))}
  .hp .rm:hover polygon,.hp .rm:focus-visible polygon{stroke:var(--accent);fill:rgba(46,240,255,.12)}
  .hp .rm.lit:hover polygon{fill:rgba(255,210,74,calc(.18 + var(--lv,1)*.32))}
  .hp .rm.sel polygon{stroke:var(--accent);stroke-width:7;filter:drop-shadow(0 0 14px rgba(46,240,255,.8))}
  .hp text{font-family:var(--f-display);fill:var(--fg);text-anchor:middle;pointer-events:none;paint-order:stroke;stroke:#04060c;stroke-width:8px;stroke-linejoin:round}
  .hp text.n{font-size:34px;font-weight:600}.hp text.t{font-size:30px;font-family:var(--f-mono);fill:var(--accent)}.hp text.i{font-size:24px;fill:var(--warn)}
  .hp-x{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
  .hp-x button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:6px 14px;font-weight:600;font-size:13px}
  .hp-x button.on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
  .hp-x button.lit{box-shadow:0 0 14px rgba(255,210,74,.35);border-color:rgba(255,210,74,.6)}
  @media (max-width:640px){.hp text.t,.hp text.i{display:none}.hp text.n{font-size:44px}}
  .sim{display:inline-flex;align-items:center;gap:6px}
  .sim::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 8px var(--warn);animation:blink 1.6s infinite}
  `);

  /* Místnosti podle studie RD Vejprnice. poly = obrys v souřadnicích obrázku img/dum/dum-pudorys.webp (2000 × 1258 px). */
  const ROOMS = [
    { id: 'zadveri', name: 'Zádveří', poly: '58,364 448,364 448,535 58,535' },
    { id: 'tech', name: 'Technická místnost', short: 'Technická', poly: '58,56 338,56 338,351 58,351', dt: .6 },
    { id: 'wc', name: 'WC', poly: '344,56 448,56 448,351 344,351' },
    { id: 'pracovna', name: 'Pracovna', poly: '58,609 448,609 448,870 58,870', dt: -.3 },
    { id: 'obyvak', name: 'Obývák s kuchyní', short: 'Obývák', poly: '468,111 1110,111 1110,809 468,809', dt: .2 },
    { id: 'chodba', name: 'Chodba', poly: '1128,338 1521,338 1521,515 1505,515 1505,635 1405,635 1405,441 1128,441', at: [1270, 395], dt: -.4 },
    { id: 'koupelna', name: 'Koupelna', poly: '1128,58 1505,58 1505,325 1128,325', dt: 1.3 },
    { id: 'loznice', name: 'Ložnice', poly: '1521,58 1936,58 1936,495 1521,495', dt: -1.1 },
    { id: 'pokoj109', name: 'Pokoj 1.09', poly: '1521,515 1936,515 1936,866 1521,866', dt: -.2 },
    { id: 'pokoj110', name: 'Pokoj 1.10', poly: '1128,528 1391,528 1391,642 1505,642 1505,866 1128,866', at: [1300, 760], dt: -.2 },
    { id: 'terasa', name: 'Terasa', poly: '334,910 1104,910 1104,1244 334,1244', out: true },
    { id: 'stani', name: 'Kryté stání', off: true, out: true },
    { id: 'sauna', name: 'Sklad a sauna', off: true }
  ];
  const D = (id, room, type, name, o = {}) => ({ id, room, type, name, ...(type === 'light' ? { on: false, level: 80 } : type === 'plug' ? { on: false, w: 50 } : type === 'blind' ? { pos: 0 } : { open: false }), ...o });
  const DEV0 = [
    D('l_zad', 'Zádveří', 'light', 'Strop', { level: 100 }),
    D('p_tc', 'Technická místnost', 'plug', 'Tepelné čerpadlo', { on: true, w: 850 }),
    D('p_rek', 'Technická místnost', 'plug', 'Rekuperace', { on: true, w: 40 }),
    D('l_wc', 'WC', 'light', 'Strop', { level: 100 }),
    D('l_pr', 'Pracovna', 'light', 'Strop'), D('p_pc', 'Pracovna', 'plug', 'Počítač', { w: 180 }), D('b_pr', 'Pracovna', 'blind', 'Žaluzie'),
    D('l1', 'Obývák s kuchyní', 'light', 'Strop', { on: true }), D('l2', 'Obývák s kuchyní', 'light', 'Nad jídelním stolem', { level: 60 }),
    D('l3', 'Obývák s kuchyní', 'light', 'Pod linkou', { on: true, level: 100 }), D('s1', 'Obývák s kuchyní', 'plug', 'TV a technika', { on: true, w: 85 }),
    D('s2', 'Obývák s kuchyní', 'plug', 'Kávovar', { w: 1200 }), D('b1', 'Obývák s kuchyní', 'blind', 'Okno na terasu', { pos: 30 }),
    D('l_ch', 'Chodba', 'light', 'Strop', { level: 50 }),
    D('l_ko', 'Koupelna', 'light', 'Strop', { level: 100 }), D('p_su', 'Koupelna', 'plug', 'Sušák ručníků', { w: 300 }),
    D('l4', 'Ložnice', 'light', 'Noční světlo', { level: 20 }), D('l_lo', 'Ložnice', 'light', 'Strop'), D('b_lo', 'Ložnice', 'blind', 'Žaluzie', { pos: 30 }),
    D('l_p9', 'Pokoj 1.09', 'light', 'Strop'), D('b_p9', 'Pokoj 1.09', 'blind', 'Žaluzie', { pos: 30 }),
    D('l_p10', 'Pokoj 1.10', 'light', 'Strop'), D('b_p10', 'Pokoj 1.10', 'blind', 'Žaluzie', { pos: 30 }),
    D('l_te', 'Terasa', 'light', 'Osvětlení terasy', { level: 70 }),
    D('g1', 'Kryté stání', 'gate', 'Brána'), D('l5', 'Kryté stání', 'light', 'Osvětlení stání', { level: 100 }),
    D('p_sa', 'Sklad a sauna', 'plug', 'Sauna', { w: 6000 })
  ];
  const DEV_V = 2;   // verze výchozích zařízení; vyšší číslo = přepsání simulace novou sadou
  function loadDevs(store) {
    if (store.get('devV', 0) < DEV_V) { store.set('devices', DEV0); store.set('devV', DEV_V) }
    return store.get('devices', DEV0);
  }
  const ALWAYS = ['p_tc', 'p_rek'];   // technika, kterou scény nevypínají
  const watts = devs => 140 + devs.reduce((s, d) => s + (d.type === 'light' && d.on ? d.level * 0.12 : 0) + (d.type === 'plug' && d.on ? d.w : 0), 0);

  /* Místo pro skutečné ovládání. Zatím jen zapíše do konzole. */
  function haCall(ha, device, action) {
    if (!ha.url || !ha.token) return;   // bez nastavení zůstává simulace
    // Příklad pro Home Assistant:
    // fetch(ha.url + '/api/services/light/turn_on', { method:'POST', headers:{Authorization:'Bearer '+ha.token,'Content-Type':'application/json'}, body: JSON.stringify({entity_id: device.entity}) })
    console.info('[domacnost] akce', device.id, action);
  }

  const SCENES = {
    rano: (devs, th) => devs.forEach(d => { if (d.type === 'light') d.on = ['l1', 'l3', 'l_ko'].includes(d.id); if (d.type === 'blind') d.pos = 0; if (d.id === 's2') d.on = true }),
    odchod: (devs, th) => { devs.forEach(d => { if ((d.type === 'light' || d.type === 'plug') && !ALWAYS.includes(d.id)) d.on = false; if (d.type === 'gate') d.open = false }); th.target = 19 },
    vecer: (devs, th) => { devs.forEach(d => { if (d.type === 'light') { d.on = ['l1', 'l2', 'l_te'].includes(d.id); if (d.id === 'l1') d.level = 40 } if (d.type === 'blind') d.pos = 100 }); th.target = 21.5 },
    noc: (devs, th) => { devs.forEach(d => { if (d.type === 'light') d.on = d.id === 'l4'; if (d.type === 'plug' && !ALWAYS.includes(d.id)) d.on = false; if (d.type === 'blind') d.pos = 100; if (d.type === 'gate') d.open = false }); th.target = 19.5 }
  };

  const SCENE_NAMES = { rano: 'Ráno', odchod: 'Odchod z domu', vecer: 'Večer', noc: 'Noc' };

  App.register({
    id: 'domacnost',
    name: 'Chytrá domácnost',
    short: 'Domácnost',
    description: 'Světla, termostat, žaluzie a spotřeba. Zatím simulace, připraveno na napojení.',
    icon: App.icons.home,
    order: 40,

    /* Nástroje pro asistenta */
    tools(ctx) {
      const get = () => ({ devs: loadDevs(ctx.store), th: ctx.store.get('thermo', { target: 21.5, current: 20.8 }) });
      const put = (devs, th) => { ctx.store.set('devices', devs); ctx.store.set('thermo', th); ctx.bus.emit('domacnost:changed') };
      const nt = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return [
        { name: 'home_status', description: 'Stav domácnosti (simulace) v novém domě ve Vejprnicích: zařízení po místnostech podle půdorysu (světla, zásuvky, žaluzie, vrata), teplota a cílová teplota termostatu, aktuální příkon ve wattech.',
          run: () => { const { devs, th } = get(); return { simulace: true, teplota: Math.round(th.current * 10) / 10, cil: th.target, prikon_w: Math.round(watts(devs)), zarizeni: devs.map(d => ({ mistnost: d.room, nazev: d.name, typ: d.type, zapnuto: d.on, jas: d.level, zatazeni: d.pos, otevreno: d.open })) } } },
        { name: 'home_control', description: 'Zapne nebo vypne světla a zásuvky, nastaví jas, zatažení žaluzií nebo otevře/zavře vrata. Vyber místnost a/nebo název zařízení; bez názvu platí pro všechna světla v místnosti (nebo v celém domě).',
          inputSchema: { type: 'object', properties: { mistnost: { type: 'string' }, zarizeni: { type: 'string' }, zapnout: { type: 'boolean' }, jas: { type: 'number', description: '1-100' }, zatazeni: { type: 'number', description: 'žaluzie 0-100 %' }, otevrit: { type: 'boolean', description: 'vrata' } } },
          run: inp => {
            const { devs, th } = get(); const room = nt(inp.mistnost), name = nt(inp.zarizeni);
            let hit = devs.filter(d => (!room || nt(d.room).includes(room) || room.includes(nt(d.room).slice(0, 4))) && (!name || nt(d.name).includes(name) || nt(d.type).includes(name)));
            if (!name && inp.zatazeni == null && inp.otevrit == null) hit = hit.filter(d => d.type === 'light');
            if (!hit.length) throw new Error('Žádné takové zařízení. Místnosti: ' + [...new Set(devs.map(d => d.room))].join(', '));
            for (const d of hit) {
              if (inp.zapnout != null && (d.type === 'light' || d.type === 'plug')) d.on = !!inp.zapnout;
              if (inp.jas != null && d.type === 'light') { d.level = Math.max(1, Math.min(100, +inp.jas)); d.on = true }
              if (inp.zatazeni != null && d.type === 'blind') d.pos = Math.max(0, Math.min(100, +inp.zatazeni));
              if (inp.otevrit != null && d.type === 'gate') d.open = !!inp.otevrit;
            }
            put(devs, th); return { zmeneno: hit.map(d => `${d.room} – ${d.name}`) };
          } },
        { name: 'home_scene', description: 'Spustí scénu domácnosti: rano, odchod, vecer nebo noc.', inputSchema: { type: 'object', properties: { scena: { type: 'string', enum: Object.keys(SCENE_NAMES) } }, required: ['scena'] },
          run: inp => { const k = nt(inp.scena).replace(/[^a-z]/g, '').replace('rano', 'rano'); const key = Object.keys(SCENES).find(x => k.startsWith(x.slice(0, 3))); if (!key) throw new Error('Neznámá scéna'); const { devs, th } = get(); SCENES[key](devs, th); put(devs, th); return { scena: SCENE_NAMES[key] } } },
        { name: 'home_thermostat', description: 'Nastaví cílovou teplotu termostatu ve °C (15–28).', inputSchema: { type: 'object', properties: { teplota: { type: 'number' } }, required: ['teplota'] },
          run: inp => { const { devs, th } = get(); th.target = Math.max(15, Math.min(28, Math.round(+inp.teplota * 2) / 2)); put(devs, th); return { cil: th.target } } }
      ];
    },

    widget(el, ctx) {
      const devs = loadDevs(ctx.store), th = ctx.store.get('thermo', { target: 21.5, current: 20.8 });
      const on = devs.filter(d => d.type === 'light' && d.on).length;
      el.innerHTML = `<div class="lbl sim">simulace</div><div class="wnums"><div><span>Teplota</span><b>${th.current.toFixed(1)} °C</b></div>
        <div><span>Svítí</span><b style="color:var(--warn)">${on} světel</b></div><div><span>Příkon</span><b>${Math.round(watts(devs))} W</b></div></div>
        <span class="wnote">Termostat nastaven na ${th.target.toFixed(1)} °C</span>`;
    },

    mount(root, ctx) {
      let devs = loadDevs(ctx.store), selRoom = null;
      let th = ctx.store.get('thermo', { target: 21.5, current: 20.8 });
      let ha = ctx.store.get('ha', { url: '', token: '' });
      const hist = Array.from({ length: 60 }, () => watts(devs) + (Math.random() - .5) * 30);
      const save = () => { ctx.store.set('devices', devs) };
      const $ = s => root.querySelector(s);
      const roomNames = () => [...ROOMS.map(r => r.name).filter(n => devs.some(d => d.room === n)), ...new Set(devs.map(d => d.room).filter(n => !ROOMS.some(r => r.name === n)))];

      root.innerHTML = `<div class="mw">
        <div class="banner"><b class="sim">Simulace.</b> <span>Zařízení zatím nejsou skutečná. Napojení na Home Assistant nebo jiný systém se doplní v kódu modulu (funkce haCall).</span></div>
        <div class="hm-top">
          <section class="panel"><div class="phead"><h2>Termostat</h2><span class="pill dim" id="thState"></span></div>
            <div class="thermo"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="8" stroke-dasharray="235.6 314.2" transform="rotate(135 60 60)"/>
              <circle class="arc" id="thArc" cx="60" cy="60" r="50" stroke-dasharray="235.6 314.2" transform="rotate(135 60 60)"/>
              <text x="60" y="58" text-anchor="middle" font-size="22" id="thCur"></text><text x="60" y="78" text-anchor="middle" font-size="9" style="fill:var(--muted)" id="thTgt"></text></svg>
            <div class="ctl"><button class="btn" id="thUp" aria-label="Zvýšit teplotu">+</button><button class="btn" id="thDn" aria-label="Snížit teplotu">−</button></div></div></section>
          <section class="panel energy"><div class="phead"><h2>Spotřeba teď</h2><span class="now" id="eNow"></span></div><div id="eChart"></div><span class="wnote">posledních 60 sekund</span></section>
          <section class="panel"><div class="phead"><h2>Scény</h2></div><div class="scenes">
            <button class="btn" data-scene="rano">Ráno</button><button class="btn" data-scene="odchod">Odchod z domu</button>
            <button class="btn" data-scene="vecer">Večer</button><button class="btn" data-scene="noc">Noc</button></div></section>
        </div>
        <section class="panel"><div class="phead"><h2>Dům Vejprnice</h2><span class="muted" id="hpSel">Klikněte na místnost v půdorysu.</span></div>
          <div class="hp"><img src="${App.asset('img/dum/dum-pudorys.webp')}" alt="Půdorys přízemí"><svg viewBox="0 0 2000 1258" id="hpSvg" role="group" aria-label="Místnosti"></svg></div>
          <div class="hp-x" id="hpX"></div></section>
        <div class="rooms" id="rooms"></div>
        <details class="panel"><summary>Připojení skutečné domácnosti</summary>
          <p class="muted">Pro Home Assistant zadejte adresu serveru a dlouhodobý přístupový token. Token zůstává jen v tomto prohlížeči. Spojení funguje jen ve verzi spuštěné z počítače ve stejné síti a server musí povolit přístup z prohlížeče (CORS).</p>
          <div class="fgrid"><label class="field">Adresa serveru<input type="text" id="haUrl" placeholder="http://homeassistant.local:8123" value="${esc(ha.url)}"></label>
          <label class="field">Token<input type="password" id="haTok" value="${esc(ha.token)}" autocomplete="off"></label>
          <div class="field" style="justify-content:flex-end"><button class="btn" id="haTest">Otestovat spojení</button></div></div>
          <p class="muted" id="haRes"></p></details></div>`;

      const roomTemp = r => th.current + (r.dt || 0) + (r.out ? 0 : 0);
      const lit = name => { const ls = devs.filter(d => d.room === name && d.type === 'light' && d.on); return ls.length ? Math.max(...ls.map(d => d.level)) / 100 : 0 };
      function drawPlan() {
        $('#hpSvg').innerHTML = ROOMS.filter(r => r.poly).map(r => {
          const pts = r.poly.split(' ').map(p => p.split(',').map(Number)), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          const [cx, cy] = r.at || [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
          const lv = lit(r.name), n = devs.filter(d => d.room === r.name).length, small = Math.max(...xs) - Math.min(...xs) < 160;
          return `<g class="rm${lv ? ' lit' : ''}${selRoom === r.name ? ' sel' : ''}" data-rm="${esc(r.name)}" tabindex="0" role="button" aria-label="${esc(r.name)}${lv ? ', svítí' : ''}" style="--lv:${lv}">
            <polygon points="${r.poly}"/>${small ? `<text class="n" x="${cx}" y="${cy}" style="font-size:28px">${esc(r.short || r.name)}</text>` : `<text class="n" x="${cx}" y="${cy - 14}">${esc(r.short || r.name)}</text>
            ${r.out ? `<text class="i" x="${cx}" y="${cy + 26}">${lv ? 'svítí' : 'venku'}</text>` : `<text class="t" x="${cx}" y="${cy + 26}" data-tt="${esc(r.id)}">${roomTemp(r).toFixed(1).replace('.', ',')}°</text>`}
            ${n && lv && !r.out ? `<text class="i" x="${cx}" y="${cy + 58}">svítí</text>` : ''}`}</g>`;
        }).join('');
        const off = ROOMS.filter(r => r.off && devs.some(d => d.room === r.name));
        $('#hpX').innerHTML = `<span class="lbl">Mimo dům</span>${off.map(r => `<button data-rm="${esc(r.name)}" class="${selRoom === r.name ? 'on' : ''}${lit(r.name) || devs.some(d => d.room === r.name && ((d.type === 'plug' && d.on) || (d.type === 'gate' && d.open))) ? ' lit' : ''}">${esc(r.name)}</button>`).join('')}
          ${selRoom ? '<button data-rm="" style="margin-left:auto">Zobrazit celý dům</button>' : ''}`;
        $('#hpSel').textContent = selRoom ? selRoom : 'Klikněte na místnost v půdorysu.';
        root.querySelectorAll('[data-rm]').forEach(g => {
          const pick = () => { const n = g.dataset.rm; selRoom = !n || selRoom === n ? null : n; drawPlan(); drawRooms(); if (selRoom) $('#rooms').scrollIntoView({ behavior: 'smooth', block: 'nearest' }) };
          g.onclick = pick; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } };
        });
      }
      function drawTemps() { root.querySelectorAll('[data-tt]').forEach(t => { const r = ROOMS.find(x => x.id === t.dataset.tt); t.textContent = roomTemp(r).toFixed(1).replace('.', ',') + '°' }) }
      function drawRooms() {
        const rooms = roomNames().filter(r => !selRoom || r === selRoom);
        $('#rooms').innerHTML = rooms.map(r => `<section class="panel room"><h2>${esc(r)}</h2><div class="devs">${devs.filter(d => d.room === r).map(dev).join('')}</div></section>`).join('');
        root.querySelectorAll('[data-tg]').forEach(b => b.onchange = () => { const d = devs.find(x => x.id === b.dataset.tg); d.on = b.checked; haCall(ha, d, d.on ? 'on' : 'off'); save(); drawRooms(); drawPlan() });
        root.querySelectorAll('[data-lv]').forEach(b => b.oninput = () => { const d = devs.find(x => x.id === b.dataset.lv); d.level = +b.value; const el = b.closest('.dev'); el.style.setProperty('--lv', d.level / 100); save(); drawPlan() });
        root.querySelectorAll('[data-bl]').forEach(b => b.oninput = () => { const d = devs.find(x => x.id === b.dataset.bl); d.pos = +b.value; b.closest('.dev').querySelector('.blind i').style.height = d.pos + '%'; b.closest('.dev').querySelector('.bp').textContent = d.pos + ' %'; save() });
        root.querySelectorAll('[data-gt]').forEach(b => b.onclick = () => { const d = devs.find(x => x.id === b.dataset.gt); d.open = !d.open; haCall(ha, d, d.open ? 'open' : 'close'); save(); drawRooms(); drawPlan() });
      }
      function dev(d) {
        if (d.type === 'light') return `<div class="dev${d.on ? ' on' : ''}" style="--lv:${d.level / 100}"><header><b><i class="bulb"></i>${esc(d.name)}</b><input type="checkbox" class="switch" data-tg="${d.id}"${d.on ? ' checked' : ''} aria-label="${esc(d.name)}"></header>
          <input type="range" min="1" max="100" value="${d.level}" data-lv="${d.id}" aria-label="Jas ${esc(d.name)}"${d.on ? '' : ' disabled'}></div>`;
        if (d.type === 'plug') return `<div class="dev plug${d.on ? ' on' : ''}"><header><b><i class="bulb"></i>${esc(d.name)}</b><input type="checkbox" class="switch" data-tg="${d.id}"${d.on ? ' checked' : ''} aria-label="${esc(d.name)}"></header><span class="wnote">${d.on ? d.w + ' W' : 'vypnuto'}</span></div>`;
        if (d.type === 'blind') return `<div class="dev"><header><b>${esc(d.name)}</b><span class="bp num">${d.pos} %</span></header><div class="blind"><i style="height:${d.pos}%"></i></div><input type="range" min="0" max="100" value="${d.pos}" data-bl="${d.id}" aria-label="Zatažení ${esc(d.name)}"></div>`;
        if (d.type === 'gate') return `<div class="dev"><header><b>${esc(d.name)}</b><span class="pill ${d.open ? 'warn' : 'ok'}">${d.open ? 'otevřeno' : 'zavřeno'}</span></header><div class="gate"><i style="width:${d.open ? 100 : 0}%"></i></div><button class="btn sm" data-gt="${d.id}">${d.open ? 'Zavřít' : 'Otevřít'}</button></div>`;
        return '';
      }
      function drawThermo() {
        const f = Math.max(0, Math.min(1, (th.current - 15) / 13));
        const arc = $('#thArc'); arc.style.strokeDashoffset = 235.6 * (1 - f);
        const heat = th.current < th.target - 0.05;
        arc.style.stroke = heat ? 'var(--warn)' : 'var(--accent)'; arc.style.color = heat ? 'var(--warn)' : 'var(--accent)';
        $('#thCur').textContent = th.current.toFixed(1) + '°'; $('#thTgt').textContent = 'cíl ' + th.target.toFixed(1) + ' °C';
        $('#thState').textContent = heat ? 'topí' : 'udržuje'; $('#thState').className = 'pill ' + (heat ? 'warn' : 'ok');
      }
      function drawEnergy() {
        const W = 320, H = 110, mx = Math.max(...hist) * 1.15, mn = 0;
        const pts = hist.map((v, i) => `${(i / (hist.length - 1) * W).toFixed(1)},${(H - (v - mn) / (mx - mn) * H).toFixed(1)}`).join(' ');
        $('#eChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="eg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--warn)" stop-opacity=".35"/><stop offset="1" stop-color="var(--warn)" stop-opacity="0"/></linearGradient></defs>
          <polygon points="0,${H} ${pts} ${W},${H}" fill="url(#eg)"/><polyline points="${pts}" fill="none" stroke="var(--warn)" stroke-width="2" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px rgba(255,210,74,.7))"/></svg>`;
        $('#eNow').textContent = Math.round(hist[hist.length - 1]) + ' W';
      }
      const scenes = Object.fromEntries(Object.entries(SCENES).map(([k, f]) => [k, () => f(devs, th)]));
      root.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => { scenes[b.dataset.scene](); save(); ctx.store.set('thermo', th); drawRooms(); drawPlan(); drawThermo(); ctx.toast(`Scéna „${b.textContent}“ spuštěna.`) });
      $('#thUp').onclick = () => { th.target = Math.min(28, th.target + .5); ctx.store.set('thermo', th); drawThermo() };
      $('#thDn').onclick = () => { th.target = Math.max(15, th.target - .5); ctx.store.set('thermo', th); drawThermo() };
      $('#haUrl').onchange = e => { ha.url = e.target.value.trim().replace(/\/$/, ''); ctx.store.set('ha', ha) };
      $('#haTok').onchange = e => { ha.token = e.target.value.trim(); ctx.store.set('ha', ha) };
      $('#haTest').onclick = async () => {
        const r = $('#haRes'); if (!ha.url) { r.textContent = 'Zadejte adresu serveru.'; return }
        r.textContent = 'Zkouším…';
        try { const res = await fetch(ha.url + '/api/', { headers: { Authorization: 'Bearer ' + ha.token } }); const j = await res.json().catch(() => ({})); r.textContent = res.ok ? `Spojeno: ${j.message || 'OK'}` : `Server odpověděl chybou ${res.status}. Zkontrolujte token.` }
        catch (e) { r.textContent = 'Spojení se nepodařilo. Zkontrolujte adresu, síť a nastavení CORS na serveru. V publikované webové verzi spojení nefunguje.' }
      };

      drawPlan(); drawRooms(); drawThermo(); drawEnergy();
      const timer = setInterval(() => {
        const target = watts(devs); const last = hist[hist.length - 1];
        hist.push(last + (target - last) * .35 + (Math.random() - .5) * 18); hist.shift(); drawEnergy();
        const diff = th.target - th.current; th.current += Math.sign(diff) * Math.min(Math.abs(diff), .02) + (Math.random() - .5) * .01; drawThermo(); drawTemps();
      }, 1000);
      const persist = setInterval(() => ctx.store.set('thermo', th), 10000);
      const off = ctx.bus.on('domacnost:changed', () => { devs = loadDevs(ctx.store); th = ctx.store.get('thermo', th); drawPlan(); drawRooms(); drawThermo() });
      return () => { clearInterval(timer); clearInterval(persist); off(); ctx.store.set('thermo', th) };   // úklid při odchodu z modulu
    }
  });
})();
