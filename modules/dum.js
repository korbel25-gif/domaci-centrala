/* =====================================================================
   MODUL: Rodinný dům Vejprnice
   Harmonogram stavby (Gantt s návaznostmi), hlídání termínu čísla
   popisného kvůli zápisu do 1. třídy, financování z prodeje bytu.
   Data: App.store('dum') → klíč 'data'
   ===================================================================== */
(function () {
  const { esc, fmt } = App;
  const DEADLINE = '2028-02-29';          // číslo popisné + trvalý pobyt nejpozději v únoru 2028
  const PHASES = [
    { id: 'prip', name: 'Příprava a projekt', color: '#2EF0FF' },
    { id: 'byt', name: 'Prodej bytu', color: '#FFD24A' },
    { id: 'pov', name: 'Povolení záměru', color: '#A57BFF' },
    { id: 'stav', name: 'Stavba', color: '#FF9A3D' },
    { id: 'kol', name: 'Kolaudace a škola', color: '#38FFA5' },
    { id: 'svp', name: 'Svépomoc', color: '#FF5FD2' }
  ];
  const WHO = ['Tomáš', 'Základy', 'Palis', 'ČEZ', 'Úřad', 'Externí', 'Svépomoc', 'Rodina'];

  /* ---------- výchozí harmonogram ---------- */
  const T = (id, ph, name, who, start, end, o = {}) => ({ id, ph, name, who, start, end, deps: o.deps || [], crit: !!o.crit, done: false, note: o.note || '' });
  const TASKS0 = [
    T('e1', 'prip', 'Ověřit na ZŠ Vejprnice kritéria přijetí do 1. třídy', 'Rodina', '2026-11-09', '2026-11-27', { note: 'Zeptat se, k jakému datu musí být trvalý pobyt ve spádovém obvodu a jak se přijímají děti mimo obvod.' }),
    T('t1', 'prip', 'Žádost o připojení elektřiny (ČEZ Distribuce)', 'Tomáš', '2026-11-09', '2026-11-20', { crit: true, note: 'Připojení nového odběrného místa trvá podle ČEZ 5–19 měsíců. Podat co nejdřív.' }),
    T('t1b', 'prip', 'ČEZ: smlouva o připojení a realizace přípojky', 'ČEZ', '2026-11-23', '2027-09-30', { deps: ['t1'], crit: true }),
    T('t2', 'prip', 'Vyjádření k přípojkám vody, kanalizace a ke sjezdu', 'Tomáš', '2026-11-09', '2026-12-18'),
    T('t3', 'prip', 'Radonový a inženýrsko-geologický průzkum', 'Externí', '2026-11-16', '2026-12-18'),
    T('t4', 'prip', 'Palis: nabídka, rezervace kapacity, sladění konstrukčního systému se studií', 'Palis', '2026-11-16', '2027-01-15', { note: 'Ověřit, zda Palis postaví navrženou skladbu stěny 368 mm, nebo vlastní systém; kdo dělá statiku a výrobní dokumentaci.' }),
    T('t5', 'prip', 'Dokumentace pro povolení záměru', 'Tomáš', '2026-11-09', '2027-01-29', { crit: true }),
    T('t6', 'prip', 'PBŘ, statika, PENB – podklady k dokumentaci', 'Externí', '2026-12-01', '2027-01-29'),
    T('v1', 'prip', 'Ověřit režim povolení pro kryté stání, sklad a saunu', 'Tomáš', '2027-01-04', '2027-01-22', { note: 'Vedlejší stavby nesmí brzdit kolaudaci domu.' }),
    T('t7', 'prip', 'JES a stanoviska dotčených orgánů (vč. případného vynětí ze ZPF)', 'Úřad', '2027-01-04', '2027-02-12', { deps: [] }),
    T('t8', 'prip', 'Souhlasy sousedů na situačním výkresu (zrychlené řízení)', 'Tomáš', '2027-01-18', '2027-02-12'),
    T('b1', 'byt', 'Konec nájmu, převzetí bytu', 'Rodina', '2026-11-30', '2026-12-04'),
    T('b2', 'byt', 'Příprava prodeje: cena, úschova, kupní smlouva', 'Rodina', '2026-12-01', '2027-01-15'),
    T('b3', 'byt', 'Prodej bytu a vklad do katastru', 'Rodina', '2027-01-18', '2027-03-15', { deps: ['b2'], crit: true, note: 'Peníze potřeba nejpozději k záloze Palisu a k základům.' }),
    T('p1', 'pov', 'Podání žádosti o povolení záměru', 'Tomáš', '2027-02-15', '2027-02-15', { deps: ['t5', 't6', 't7'], crit: true }),
    T('p2', 'pov', 'Řízení: rozhodnutí do 30 dnů + právní moc', 'Úřad', '2027-02-16', '2027-04-16', { deps: ['p1'], crit: true, note: 'Jednoduchá stavba: rozhodnutí do 30 dnů, právní moc po 15 dnech. Přerušení řízení kvůli doplnění lhůtu prodlouží.' }),
    T('p3', 'pov', 'Výrobní dokumentace Palis, výběr dodavatele základů', 'Tomáš', '2027-02-16', '2027-04-16', { deps: ['t4'] }),
    T('p4', 'pov', 'Smlouvy s Palisem a dodavatelem základů', 'Tomáš', '2027-03-01', '2027-04-16', { deps: ['t4'], crit: true }),
    T('s1', 'stav', 'Vytyčení, zařízení staveniště, staveništní elektřina', 'Základy', '2027-04-26', '2027-05-07', { deps: ['p2', 'p4'], crit: true }),
    T('s2', 'stav', 'Přípojky vody a kanalizace', 'Základy', '2027-05-03', '2027-05-28', { deps: ['p2'] }),
    T('s3', 'stav', 'Zemní práce a základová deska', 'Základy', '2027-05-10', '2027-06-25', { deps: ['s1'], crit: true }),
    T('s4', 'stav', 'Zrání desky, kontrola rovinnosti, předání Palisu', 'Základy', '2027-06-28', '2027-07-16', { deps: ['s3'], crit: true }),
    T('s5', 'stav', 'Montáž hrubé stavby (stěny, strop, střecha, okna)', 'Palis', '2027-07-19', '2027-08-13', { deps: ['s4'], crit: true }),
    T('s6', 'stav', 'Dokončovací práce a TZB (TČ, rekuperace, elektro, voda, podlahy)', 'Palis', '2027-08-16', '2027-11-12', { deps: ['s5'], crit: true }),
    T('s7', 'stav', 'Definitivní připojení elektřiny, elektroměr', 'ČEZ', '2027-10-01', '2027-10-29', { deps: ['t1b'], crit: true }),
    T('s9', 'stav', 'Geodetické zaměření a geometrický plán', 'Externí', '2027-10-18', '2027-11-26', { deps: ['s5'], crit: true, note: 'Geodet 4–8 týdnů, objednat v září.' }),
    T('s8', 'stav', 'Revize, zkoušky, blower door test, PENB', 'Externí', '2027-11-15', '2027-11-26', { deps: ['s6', 's7'], crit: true }),
    T('s10', 'stav', 'Dokumentace skutečného provedení', 'Tomáš', '2027-11-01', '2027-11-26', { deps: ['s5'] }),
    T('k1', 'kol', 'Žádost o kolaudační rozhodnutí', 'Tomáš', '2027-11-29', '2027-11-29', { deps: ['s8', 's9', 's10'], crit: true }),
    T('k2', 'kol', 'Kontrolní prohlídka (do 30 dnů), rozhodnutí (do 15 dnů), právní moc', 'Úřad', '2027-11-30', '2028-01-14', { deps: ['k1'], crit: true }),
    T('k3', 'kol', 'Přidělení čísla popisného (obec Vejprnice)', 'Úřad', '2028-01-17', '2028-01-31', { deps: ['k2'], crit: true }),
    T('k4', 'kol', 'Přihlášení trvalého pobytu', 'Rodina', '2028-02-01', '2028-02-11', { deps: ['k3'], crit: true }),
    T('b4', 'byt', 'Oznámení finančnímu úřadu o použití peněz na bytovou potřebu (je-li třeba)', 'Rodina', '2028-03-01', '2028-04-01', { deps: ['b3'], note: 'Jen pokud byt nesplní časový test. Lhůta je do termínu daňového přiznání za rok prodeje.' }),
    T('k5', 'kol', 'Zápis do 1. třídy', 'Rodina', '2028-04-01', '2028-04-30', { deps: ['k4'], crit: true }),
    T('k6', 'kol', 'Nástup do 1. třídy', 'Rodina', '2028-09-01', '2028-09-01', { deps: ['k5'] }),
    T('v2', 'svp', 'Kryté stání a sklad', 'Svépomoc', '2028-03-01', '2028-06-30', { deps: ['k2'] }),
    T('v3', 'svp', 'Sauna', 'Svépomoc', '2028-05-01', '2028-08-31', { deps: ['k2'] }),
    T('v4', 'svp', 'Zahrada a oplocení', 'Svépomoc', '2028-04-01', '2028-10-31', { deps: ['k2'] })
  ];
  const BUDGET0 = {
    zdroje: [
      { id: 'z1', name: 'Prodej bytu (odhad)', amount: 5300000, date: '2027-03-15' },
      { id: 'z2', name: 'Vlastní úspory', amount: 0, date: '2027-01-01' },
      { id: 'z3', name: 'Navýšení hypotéky / úvěr', amount: 0, date: '2027-06-01' }
    ],
    naklady: [
      { id: 'n1', name: 'Průzkumy, PBŘ, statika, geodet, poplatky', amount: 120000, date: '2027-01-15' },
      { id: 'n2', name: 'Přípojky (elektro, voda, kanalizace, sjezd)', amount: 250000, date: '2027-05-15' },
      { id: 'n3', name: 'Základová deska (dodavatel základů)', amount: 570000, date: '2027-06-25' },
      { id: 'n4', name: 'Palis – záloha při podpisu smlouvy', amount: 1400000, date: '2027-04-15' },
      { id: 'n5', name: 'Palis – hrubá stavba', amount: 1900000, date: '2027-08-13' },
      { id: 'n6', name: 'Palis – dokončení a TZB', amount: 1440000, date: '2027-11-12' },
      { id: 'n7', name: 'Kuchyň a vybavení', amount: 350000, date: '2027-11-30' },
      { id: 'n8', name: 'Svépomoc: kryté stání, sklad, sauna (materiál)', amount: 400000, date: '2028-05-01' },
      { id: 'n9', name: 'Zahrada a oplocení', amount: 200000, date: '2028-06-01' },
      { id: 'n10', name: 'Rezerva', amount: 300000, date: '2027-12-15' }
    ]
  };
  const INFO = {
    pozemek: 'k. ú. Vejprnice', studie: '8. 9. 2026', zastavena: '125,88 m²', podlahova: '102,86 m² (TFA)', obestaveny: 'cca 690 m³',
    konstrukce: 'jednopodlažní dřevostavba v pasivním standardu, obvodová stěna 368 mm', tzb: 'tepelné čerpadlo, rekuperace', rozpocet: 'cca 5,31 mil. Kč vč. DPH 12 % (položkový rozpočet 9/2026, dům vč. TZB, bez vedlejších staveb)'
  };

  /* ---------- pomocné ---------- */
  const DAY = 864e5;
  const dt = s => new Date(s + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const addD = (s, n) => iso(new Date(dt(s).getTime() + n * DAY));
  const diff = (a, b) => Math.round((dt(b) - dt(a)) / DAY);
  function load(store) {
    let d = store.get('data', null);
    if (!d) { d = { tasks: structuredClone(TASKS0), budget: structuredClone(BUDGET0), deadline: DEADLINE }; store.set('data', d) }
    d.deadline = d.deadline || DEADLINE;
    return d;
  }
  function analyse(d) {
    const td = App.today(), by = Object.fromEntries(d.tasks.map(t => [t.id, t]));
    const conflicts = d.tasks.filter(t => t.deps.some(id => by[id] && by[id].end > t.start && !(by[id].start === by[id].end && by[id].end === t.start)));
    const late = d.tasks.filter(t => !t.done && t.end < td);
    const running = d.tasks.filter(t => !t.done && t.start <= td && t.end >= td);
    const next = d.tasks.filter(t => !t.done && t.start > td).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
    const cp = by.k3 ? by.k3.end : null, pobyt = by.k4 ? by.k4.end : null;
    const slack = pobyt ? diff(pobyt, d.deadline) : null;
    const done = d.tasks.filter(t => t.done).length;
    return { td, by, conflicts, late, running, next, cp, pobyt, slack, progress: done / d.tasks.length, daysLeft: diff(td, d.deadline) };
  }
  /* posune návazné úkoly tak, aby začínaly až po skončení předchůdců (zachová délku) */
  function reschedule(d) {
    const by = Object.fromEntries(d.tasks.map(t => [t.id, t])); let moved = 0;
    for (let pass = 0; pass < d.tasks.length; pass++) {
      let ch = false;
      for (const t of d.tasks) {
        if (t.done || !t.deps.length) continue;
        const need = t.deps.map(id => by[id]).filter(Boolean).reduce((m, p) => { const e = p.start === p.end ? p.end : addD(p.end, 1); return e > m ? e : m }, '0');
        if (need > t.start) { const len = diff(t.start, t.end); t.start = need; t.end = addD(need, len); ch = true; moved++ }
      }
      if (!ch) break;
    }
    return moved;
  }

  App.css('dum', `
  .dm-hero{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px}
  @media (max-width:900px){.dm-hero{grid-template-columns:1fr}}
  .dm-count{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
  .dm-count .big{font-family:var(--f-mono);font-size:64px;line-height:1;font-weight:700;color:var(--accent);text-shadow:0 0 26px rgba(46,240,255,.55)}
  .dm-count .big small{font-size:16px;color:var(--muted);text-shadow:none;margin-left:6px}
  .dm-status{padding:12px 14px;border-radius:var(--r);border:1px solid;display:flex;flex-direction:column;gap:2px}
  .dm-status.ok{border-color:rgba(56,255,165,.5);background:rgba(56,255,165,.07)} .dm-status.ok b{color:var(--inc)}
  .dm-status.warn{border-color:rgba(255,210,74,.5);background:var(--warn-soft)} .dm-status.warn b{color:var(--warn)}
  .dm-status.bad{border-color:rgba(255,79,121,.6);background:rgba(255,79,121,.08)} .dm-status.bad b{color:var(--exp)}
  .gantt{overflow-x:auto;position:relative}
  .gantt svg{display:block;min-width:1080px;width:100%}
  .gantt text{font-family:var(--f-body);font-size:11px;fill:var(--muted)}
  .gantt .lbl-t{fill:var(--fg);font-size:11.5px}
  .gantt .bar{cursor:pointer;transition:opacity .2s;transform-box:fill-box;transform-origin:left;animation:fill .8s cubic-bezier(.2,.8,.2,1) both}
  .gantt .bar:hover{opacity:.85}
  .gantt .crit{stroke:#fff;stroke-width:1;stroke-dasharray:3 2}
  .gantt .row:hover rect.bg{fill:rgba(46,240,255,.05)}
  .gantt .today{stroke:var(--accent);stroke-width:2;filter:drop-shadow(0 0 4px var(--accent));animation:blink 2s ease-in-out infinite}
  .gantt .dl{stroke:var(--exp);stroke-width:2;stroke-dasharray:6 4}
  .dm-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}
  .dm-legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}
  .dm-tasks td{vertical-align:middle}
  .dm-tasks input[type=date]{padding:4px 6px;font-size:12px}
  .dm-tasks tr.sel td{background:var(--accent-soft)}
  .dm-tasks tr.dn td{opacity:.55}
  .dm-tasks .who{font-size:11px;color:var(--muted)}
  .dm-fin td input{width:100%;min-width:0;padding:4px 6px;font-size:13px}
  .dm-cash svg{width:100%;height:200px;display:block}
  .dm-info{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;font-size:13px}
  .dm-info span:nth-child(odd){color:var(--muted)}
  `);

  App.register({
    id: 'dum',
    name: 'Rodinný dům Vejprnice',
    short: 'Dům',
    description: 'Harmonogram stavby, termín čísla popisného kvůli zápisu do školy a financování z prodeje bytu.',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-5h6v5"/><path d="M16 5V3h2v3.5"/></svg>',
    order: 8,

    tools(ctx) {
      return [
        { name: 'house_status', description: 'Stav projektu stavby rodinného domu ve Vejprnicích: dny do termínu čísla popisného (únor 2028), plánované datum čísla popisného a trvalého pobytu, rezerva, procento hotových úkolů, úkoly po termínu, běžící a nejbližší úkoly, kolize v návaznostech.',
          run: () => { const d = load(ctx.store), a = analyse(d), m = t => ({ id: t.id, ukol: t.name, kdo: t.who, od: t.start, do: t.end, kriticky: t.crit });
            return { termin_cp: d.deadline, dni_do_terminu: a.daysLeft, planovane_cp: a.cp, planovany_pobyt: a.pobyt, rezerva_dni: a.slack, hotovo_procent: Math.round(a.progress * 100), po_terminu: a.late.map(m), bezi: a.running.map(m), nejblizsi: a.next.map(m), kolize: a.conflicts.map(m) } } },
        { name: 'house_tasks', description: 'Seznam úkolů harmonogramu stavby domu, volitelně jen jedna fáze (prip, byt, pov, stav, kol, svp) nebo jen nedokončené.',
          inputSchema: { type: 'object', properties: { faze: { type: 'string' }, jen_otevrene: { type: 'boolean' } } },
          run: inp => { const d = load(ctx.store); return d.tasks.filter(t => (!inp.faze || t.ph === inp.faze) && (!inp.jen_otevrene || !t.done)).map(t => ({ id: t.id, faze: PHASES.find(p => p.id === t.ph)?.name, ukol: t.name, kdo: t.who, od: t.start, do: t.end, hotovo: t.done, kriticky: t.crit, poznamka: t.note })) } },
        { name: 'house_task_done', description: 'Označí úkol harmonogramu domu jako hotový nebo nehotový. Úkol lze zadat id nebo částí názvu.',
          inputSchema: { type: 'object', properties: { ukol: { type: 'string' }, hotovo: { type: 'boolean' } }, required: ['ukol'] },
          run: inp => { const d = load(ctx.store), q = String(inp.ukol).toLowerCase(); const t = d.tasks.find(t => t.id === q) || d.tasks.find(t => t.name.toLowerCase().includes(q)); if (!t) throw new Error('Úkol nenalezen'); t.done = inp.hotovo !== false; ctx.store.set('data', d); ctx.bus.emit('dum:changed'); return { ukol: t.name, hotovo: t.done } } },
        { name: 'house_budget', description: 'Financování stavby domu: zdroje (prodej bytu, úspory, úvěr), plánované náklady, rozdíl a nejnižší stav peněz v čase podle plánovaných plateb.',
          run: () => { const d = load(ctx.store), b = d.budget, z = b.zdroje.reduce((s, x) => s + (+x.amount || 0), 0), n = b.naklady.reduce((s, x) => s + (+x.amount || 0), 0);
            return { zdroje: b.zdroje, naklady: b.naklady, celkem_zdroje: z, celkem_naklady: n, rozdil: z - n, nejnizsi_stav: cash(b).min } } }
      ];
    },

    widget(el, ctx) {
      const d = load(ctx.store), a = analyse(d), nx = a.next[0] || a.running[0];
      const st = a.slack == null ? 'warn' : a.slack >= 14 ? 'ok' : a.slack >= 0 ? 'warn' : 'bad';
      el.innerHTML = `<div class="wnums"><div><span>Do termínu č. p.</span><b data-count="${a.daysLeft}" data-fmt="num">${a.daysLeft}</b></div>
        <div><span>Rezerva</span><b style="color:var(--${st === 'ok' ? 'inc' : st === 'warn' ? 'warn' : 'exp'})">${a.slack} dní</b></div><div><span>Hotovo</span><b>${Math.round(a.progress * 100)} %</b></div></div>
        <div class="meter ok"><b style="width:${Math.max(2, a.progress * 100)}%"></b></div>
        <span class="wnote">${a.late.length ? `<span style="color:var(--exp)">${a.late.length} úkolů po termínu.</span> ` : ''}${nx ? `Další: ${esc(nx.name)} (${fmt.date(nx.start)})` : ''}</span>`;
    },

    mount(root, ctx) {
      let d = load(ctx.store), sel = null, phaseF = '';
      const save = () => ctx.store.set('data', d);
      const $ = s => root.querySelector(s);

      function draw() {
        const a = analyse(d);
        const st = a.slack >= 14 ? 'ok' : a.slack >= 0 ? 'warn' : 'bad';
        root.innerHTML = `<div class="mw">
          <div class="dm-hero">
            <section class="panel"><div class="dm-count"><div><span class="lbl">Do termínu čísla popisného</span><div class="big"><span data-count="${a.daysLeft}" data-fmt="num"></span><small>dní</small></div>
              <span class="muted">termín ${fmt.date(d.deadline)} · zápis do 1. třídy v dubnu 2028</span></div>
              <div class="dm-status ${st}"><b>${a.slack >= 0 ? `Plán drží, rezerva ${a.slack} dní` : `Plán nestíhá o ${-a.slack} dní`}</b>
                <span class="muted">Číslo popisné podle plánu ${fmt.date(a.cp)}, trvalý pobyt ${fmt.date(a.pobyt)}</span></div></div>
              <div style="margin-top:14px"><div class="meter ok"><b style="width:${Math.max(1, a.progress * 100)}%"></b></div><div class="mlbl" style="margin-top:4px">Hotovo ${Math.round(a.progress * 100)} % úkolů · ${a.running.length} běží · ${a.late.length ? `<span style="color:var(--exp)">${a.late.length} po termínu</span>` : 'nic po termínu'}${a.conflicts.length ? ` · <span style="color:var(--warn)">${a.conflicts.length} kolizí v návaznostech</span>` : ''}</div></div></section>
            <section class="panel"><div class="phead"><h2>Teď na řadě</h2></div>
              <div class="lots">${[...a.late.map(t => [t, 'bad']), ...a.running.map(t => [t, 'warn']), ...a.next.map(t => [t, 'dim'])].slice(0, 6).map(([t, c]) => `<div class="taxrow"><span><span class="pill ${c}">${c === 'bad' ? 'po termínu' : c === 'warn' ? 'běží' : fmt.date(t.start)}</span> ${esc(t.name)}</span><span class="who muted">${esc(t.who)}</span></div>`).join('')}</div></section>
          </div>
          <section class="panel"><div class="phead"><h2>Harmonogram</h2><div class="acts">
            <select id="dmF" aria-label="Fáze"><option value="">Všechny fáze</option>${PHASES.map(p => `<option value="${p.id}"${phaseF === p.id ? ' selected' : ''}>${p.name}</option>`).join('')}</select>
            ${a.conflicts.length ? `<button class="btn sm" id="dmRe">Posunout návazné úkoly (${a.conflicts.length})</button>` : ''}</div></div>
            <div class="gantt" id="gantt">${gantt(a)}</div>
            <div class="dm-legend">${PHASES.map(p => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('')}<span><i style="background:transparent;border:1px dashed #fff"></i>kritická cesta</span><span><i style="background:var(--inc)"></i>hotovo</span><span><i style="background:var(--exp)"></i>po termínu / termín č. p.</span></div></section>
          <section class="panel"><div class="phead"><h2>Úkoly</h2><span class="muted">Klikněte na pruh v grafu nebo upravte data přímo v tabulce.</span></div>
            <div class="tablebox"><table class="dm-tasks"><thead><tr><th></th><th>Úkol</th><th>Kdo</th><th>Od</th><th>Do</th><th class="amt">Dní</th><th>Stav</th></tr></thead><tbody>
            ${d.tasks.filter(t => !phaseF || t.ph === phaseF).sort((x, y) => x.start.localeCompare(y.start)).map(t => { const late = !t.done && t.end < a.td, conf = a.conflicts.includes(t); return `<tr data-row="${t.id}" class="${sel === t.id ? 'sel' : ''} ${t.done ? 'dn' : ''}">
              <td><input type="checkbox" data-done="${t.id}"${t.done ? ' checked' : ''} aria-label="Hotovo"></td>
              <td><div class="p"><i class="dot" style="display:inline-block;margin-right:8px;background:${PHASES.find(p => p.id === t.ph).color}"></i>${esc(t.name)}${t.crit ? ' <span class="pill dim" title="kritická cesta">KC</span>' : ''}</div>${t.note ? `<div class="x">${esc(t.note)}</div>` : ''}</td>
              <td><select data-who="${t.id}" aria-label="Kdo">${WHO.map(w => `<option${w === t.who ? ' selected' : ''}>${w}</option>`).join('')}</select></td>
              <td><input type="date" data-s="${t.id}" value="${t.start}"></td><td><input type="date" data-e="${t.id}" value="${t.end}"></td>
              <td class="amt">${diff(t.start, t.end) + 1}</td>
              <td>${t.done ? '<span class="pill ok">hotovo</span>' : late ? '<span class="pill bad">po termínu</span>' : conf ? '<span class="pill warn">kolize</span>' : t.start <= a.td ? '<span class="pill warn">běží</span>' : '<span class="pill dim">plán</span>'}</td></tr>` }).join('')}
            </tbody></table></div></section>
          ${finance()}
          <div class="grid2">
            <section class="panel"><div class="phead"><h2>Stavba</h2></div><div class="dm-info">
              <span>Pozemek</span><span>${INFO.pozemek}</span><span>Studie</span><span>${INFO.studie}</span><span>Zastavěná plocha</span><span>${INFO.zastavena}</span><span>Podlahová plocha</span><span>${INFO.podlahova}</span>
              <span>Obestavěný prostor</span><span>${INFO.obestaveny}</span><span>Konstrukce</span><span>${INFO.konstrukce}</span><span>TZB</span><span>${INFO.tzb}</span><span>Rozpočet domu</span><span>${INFO.rozpocet}</span>
              <span>Dodavatelé</span><span>základy: vybrat · vrchní stavba: Palis Plzeň (předběžně) · stání, sklad, sauna, zahrada: svépomocí</span><span>Projekt</span><span>Tomáš Korbel</span></div></section>
            <section class="panel"><div class="phead"><h2>Prodej bytu</h2></div><div class="dm-info">
              <span>Byt</span><span>3+1, 70 m², velmi dobrý stav, Plzeň</span><span>Nájem</span><span>končí 30. 11. 2026</span>
              <span>Odhad ceny</span><span>cca 5,0–5,6 mil. Kč (medián nabídkových cen 3+1 v Plzni 80 519 Kč/m², 10/2026; skutečné prodejní ceny bývají nižší)</span>
              <span>Daň z prodeje</span><span>Pokud jste byt koupili před rokem 2021 a vlastníte ho přes 5 let, je prodej osvobozen. Při koupi po roce 2020 platí 10letý test; osvobození pak získáte, když peníze použijete na vlastní bytovou potřebu (stavba domu, splacení úvěru na pozemek) do konce roku následujícího po prodeji a oznámíte to finančnímu úřadu. Ověřte s daňovým poradcem.</span></div></section>
          </div></div>`;
        wire(a); App.countUp(root);
      }

      function gantt(a) {
        const tasks = d.tasks.filter(t => !phaseF || t.ph === phaseF);
        const from = '2026-11-01', to = '2028-10-31', W = 1080, L = 300, R = 10, RH = 24, TOP = 34;
        const span = diff(from, to), X = s => L + Math.max(0, Math.min(span, diff(from, s))) / span * (W - L - R);
        const rows = []; PHASES.forEach(p => { const ts = tasks.filter(t => t.ph === p.id).sort((x, y) => x.start.localeCompare(y.start)); if (ts.length) { rows.push({ ph: p }); ts.forEach(t => rows.push({ t })) } });
        const H = TOP + rows.length * RH + 10;
        let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Harmonogram stavby">`;
        for (let m = new Date(Date.UTC(2026, 10, 1)); iso(m) <= to; m.setUTCMonth(m.getUTCMonth() + 1)) {
          const x = X(iso(m)), jan = m.getUTCMonth() === 0;
          s += `<line x1="${x}" x2="${x}" y1="${TOP - 8}" y2="${H}" stroke="var(--line)" ${jan ? '' : 'stroke-dasharray="2 4"'}/><text x="${x + 3}" y="${TOP - 14}">${App.MON[m.getUTCMonth()]}${jan || iso(m) === from ? ' ' + String(m.getUTCFullYear()).slice(2) : ''}</text>`;
        }
        rows.forEach((r, i) => {
          const y = TOP + i * RH;
          if (r.ph) { s += `<text x="4" y="${y + 16}" style="fill:${r.ph.color};font-weight:700;letter-spacing:.08em;font-size:11px">${r.ph.name.toUpperCase()}</text>`; return }
          const t = r.t, ph = PHASES.find(p => p.id === t.ph), late = !t.done && t.end < a.td, x1 = X(t.start), x2 = Math.max(X(addD(t.end, 1)), x1 + 4);
          const col = t.done ? 'var(--inc)' : late ? 'var(--exp)' : ph.color;
          s += `<g class="row" data-bar="${t.id}"><rect class="bg" x="0" y="${y}" width="${W}" height="${RH}" fill="transparent"/>
            <text class="lbl-t" x="14" y="${y + 16}">${esc(t.name.length > 44 ? t.name.slice(0, 43) + '…' : t.name)}</text>
            ${t.start === t.end ? `<path class="bar" d="M${x1} ${y + 5} l7 7 -7 7 -7 -7z" fill="${col}" style="animation-delay:${i * 15}ms"/>` :
              `<rect class="bar${t.crit ? ' crit' : ''}" x="${x1}" y="${y + 6}" width="${x2 - x1}" height="${RH - 12}" rx="3" fill="${col}" opacity="${sel && sel !== t.id ? .45 : .9}" style="animation-delay:${i * 15}ms;filter:drop-shadow(0 0 4px ${col})"/>`}
            <title>${esc(t.name)} · ${fmt.date(t.start)} – ${fmt.date(t.end)} · ${esc(t.who)}</title></g>`;
        });
        const xt = X(a.td), xd = X(d.deadline), xz = X('2028-04-01');
        s += `<line class="dl" x1="${xd}" x2="${xd}" y1="${TOP - 8}" y2="${H}"/><text x="${xd - 4}" y="${H - 4}" text-anchor="end" style="fill:var(--exp)">termín č. p.</text>`;
        s += `<line x1="${xz}" x2="${xz}" y1="${TOP - 8}" y2="${H}" stroke="var(--inc)" stroke-dasharray="2 3"/><text x="${xz + 4}" y="${H - 4}" style="fill:var(--inc)">zápis</text>`;
        s += `<line class="today" x1="${xt}" x2="${xt}" y1="${TOP - 8}" y2="${H}"/><text x="${xt + 4}" y="${TOP - 2}" style="fill:var(--accent);font-weight:700">dnes</text>`;
        return s + '</svg>';
      }

      function cashHtml() {
        const c = cash(d.budget); if (!c.pts.length) return '';
        const W = 640, H = 200, L = 60, B = 24, T = 10;
        const lo = Math.min(0, c.min), hi = Math.max(1, ...c.pts.map(p => p.bal)); const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
        const t0 = dt(c.pts[0].date).getTime(), t1 = Math.max(t0 + DAY, dt(c.pts[c.pts.length - 1].date).getTime()), X = s => L + (dt(s).getTime() - t0) / (t1 - t0) * (W - L - 10);
        let path = `M${X(c.pts[0].date)} ${Y(0)}`; let prev = 0; for (const p of c.pts) { path += ` L${X(p.date)} ${Y(prev)} L${X(p.date)} ${Y(p.bal)}`; prev = p.bal }
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Stav peněz v čase">
          <line x1="${L}" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" opacity=".6"/>
          <text x="${L - 6}" y="${Y(hi) + 4}" text-anchor="end" style="font-size:10px">${(hi / 1e6).toFixed(1).replace('.', ',')} mil.</text><text x="${L - 6}" y="${Y(0) + 4}" text-anchor="end" style="font-size:10px">0</text>
          ${lo < 0 ? `<text x="${L - 6}" y="${Y(lo) + 4}" text-anchor="end" style="font-size:10px;fill:var(--exp)">${(lo / 1e6).toFixed(1).replace('.', ',')} mil.</text>` : ''}
          <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" class="sl" pathLength="1" style="filter:drop-shadow(0 0 4px var(--accent))"/>
          ${c.pts.map(p => `<circle cx="${X(p.date)}" cy="${Y(p.bal)}" r="3" fill="${p.bal < 0 ? 'var(--exp)' : 'var(--accent)'}"><title>${fmt.date(p.date)} · ${esc(p.name)} · stav ${fmt.czk(p.bal)}</title></circle>`).join('')}
          <text x="${L}" y="${H - 6}" style="font-size:10px">${fmt.date(c.pts[0].date)}</text><text x="${W - 10}" y="${H - 6}" text-anchor="end" style="font-size:10px">${fmt.date(c.pts[c.pts.length - 1].date)}</text></svg>`;
      }

      function finance() {
        const b = d.budget, z = b.zdroje.reduce((s, x) => s + (+x.amount || 0), 0), n = b.naklady.reduce((s, x) => s + (+x.amount || 0), 0), c = cash(b);
        const rows = (list, k) => list.map((x, i) => `<tr><td><input type="text" data-f="${k}.${i}.name" value="${esc(x.name)}" aria-label="Položka"></td><td style="width:140px"><input type="date" data-f="${k}.${i}.date" value="${x.date}" aria-label="Datum"></td><td style="width:150px"><input type="number" step="10000" data-f="${k}.${i}.amount" value="${x.amount}" aria-label="Částka" style="text-align:right"></td><td><button class="btn sm danger" data-del="${k}.${i}" aria-label="Odebrat">×</button></td></tr>`).join('');
        return `<section class="panel"><div class="phead"><h2>Financování stavby</h2><span class="pill ${z - n >= 0 ? 'ok' : 'bad'}">${z - n >= 0 ? 'pokryto' : 'chybí ' + fmt.czk(n - z)}</span></div>
          <div class="kpis" style="margin-bottom:14px">
            <div class="kpi"><span class="lbl">Zdroje</span><span class="v inc" data-count="${z}"></span><span class="s">prodej bytu, úspory, úvěr</span></div>
            <div class="kpi"><span class="lbl">Náklady</span><span class="v exp" data-count="${n}"></span><span class="s">dům, přípojky, svépomoc, rezerva</span></div>
            <div class="kpi"><span class="lbl">Rozdíl</span><span class="v ${z - n >= 0 ? 'inc' : 'exp'}" data-count="${z - n}"></span><span class="s">pozemek s hypotékou se nepočítá</span></div>
            <div class="kpi"><span class="lbl">Nejnižší stav</span><span class="v ${c.min >= 0 ? 'inc' : 'exp'}" data-count="${c.min}"></span><span class="s">${c.minDate ? 'kolem ' + fmt.date(c.minDate) : ''}</span></div></div>
          <div class="grid2"><div>
            <div class="lbl" style="margin-bottom:6px">Zdroje</div><div class="tablebox" style="margin:0"><table class="dm-fin" style="min-width:480px"><tbody>${rows(b.zdroje, 'zdroje')}</tbody></table></div><button class="btn sm" data-add="zdroje" style="margin-top:6px">+ Zdroj</button>
            <div class="lbl" style="margin:14px 0 6px">Náklady a termíny plateb</div><div class="tablebox" style="margin:0"><table class="dm-fin" style="min-width:480px"><tbody>${rows(b.naklady, 'naklady')}</tbody></table></div><button class="btn sm" data-add="naklady" style="margin-top:6px">+ Náklad</button>
          </div><div><div class="lbl" style="margin-bottom:6px">Stav peněz v čase</div><div class="dm-cash">${cashHtml()}</div>
            <p class="muted" style="font-size:12px">Částky jsou výchozí odhady: dům podle položkového rozpočtu ze září (cca 5,31 mil. Kč vč. DPH) rozdělený na základy a Palis, ostatní orientačně. Přepište je skutečnými nabídkami. Kde stav klesne pod nulu, je potřeba úvěr nebo jiné rozložení plateb.</p></div></div></section>`;
      }

      function wire(a) {
        $('#dmF').onchange = e => { phaseF = e.target.value; draw() };
        const re = $('#dmRe'); if (re) re.onclick = () => { const n = reschedule(d); save(); draw(); ctx.toast(`Posunuto ${n} úkolů. Zkontrolujte rezervu do termínu.`) };
        root.querySelectorAll('[data-bar]').forEach(g => g.onclick = () => { sel = sel === g.dataset.bar ? null : g.dataset.bar; draw(); const r = root.querySelector(`[data-row="${sel}"]`); r?.scrollIntoView({ behavior: 'smooth', block: 'center' }) });
        root.querySelectorAll('[data-done]').forEach(c => c.onchange = () => { a.by[c.dataset.done].done = c.checked; save(); draw() });
        root.querySelectorAll('[data-who]').forEach(c => c.onchange = () => { a.by[c.dataset.who].who = c.value; save() });
        root.querySelectorAll('[data-s],[data-e]').forEach(c => c.onchange = () => {
          const t = a.by[c.dataset.s || c.dataset.e]; if (!c.value) return;
          if (c.dataset.s) { const len = diff(t.start, t.end); t.start = c.value; if (t.end < t.start) t.end = addD(t.start, len) } else { t.end = c.value < t.start ? t.start : c.value }
          save(); draw(); const n = analyse(d).conflicts.length; if (n) ctx.toast(`${n} návazných úkolů začíná dřív, než skončí předchůdce.`, 'Posunout návazné', () => { reschedule(d); save(); draw() });
        });
        root.querySelectorAll('[data-f]').forEach(i => i.onchange = () => { const [k, idx, f] = i.dataset.f.split('.'); d.budget[k][+idx][f] = f === 'amount' ? (+i.value || 0) : i.value; save(); draw() });
        root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const [k, idx] = b.dataset.del.split('.'); d.budget[k].splice(+idx, 1); save(); draw() });
        root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const k = b.dataset.add; d.budget[k].push({ id: 'x' + Date.now(), name: k === 'zdroje' ? 'Nový zdroj' : 'Nový náklad', amount: 0, date: App.today() }); save(); draw() });
      }
      draw();
      return ctx.bus.on('dum:changed', () => { d = load(ctx.store); draw() });
    }
  });

  /* průběh peněz: zdroje +, náklady −, seřazeno podle data */
  function cash(b) {
    const ev = [...b.zdroje.map(x => ({ date: x.date, name: x.name, v: +x.amount || 0 })), ...b.naklady.map(x => ({ date: x.date, name: x.name, v: -(+x.amount || 0) }))].filter(e => e.v && e.date).sort((x, y) => x.date.localeCompare(y.date));
    let bal = 0, min = 0, minDate = null; const pts = [];
    for (const e of ev) { bal += e.v; pts.push({ date: e.date, name: e.name, bal }); if (bal < min) { min = bal; minDate = e.date } }
    return { pts, min, minDate };
  }
})();
