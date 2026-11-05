/* =====================================================================
   MODUL: Investice
   Portfolio akcií/ETF, FIFO loty, časový test (3 roky), limit 100 000 Kč,
   dividendy, alokace. Ceny a kurzy se zadávají ručně (zatím bez online cen).
   Data: App.store('investice') → klíč 'data'
   Nápad na rozšíření: import exportu z XTB (xlsx) do funkce importXTB().
   ===================================================================== */
(function () {
  const { fmt, esc } = App;
  const YEARS_TEST = 3;            // časový test u cenných papírů (§ 4 odst. 1 písm. u) ZDP)
  const SMALL_LIMIT = 100000;      // osvobození, když úhrn příjmů z prodeje za rok nepřesáhne 100 000 Kč (písm. t)
  const TAX_RATE = 0.15;           // orientačně základní sazba
  const PAL = ['#2EF0FF', '#A57BFF', '#38FFA5', '#FFD24A', '#FF5FD2', '#4D7CFF', '#FF9A3D', '#9CFF4A'];

  App.css('investice', `
  .inv-donut{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .inv-donut svg{width:170px;height:170px;transform:rotate(-90deg);flex:none}
  .inv-donut circle.seg{fill:none;stroke-width:4.2;animation:dash 1.2s cubic-bezier(.2,.8,.2,1) both;filter:drop-shadow(0 0 3px rgba(46,240,255,.4))}
  @keyframes dash{from{stroke-dasharray:0 100}}
  .inv-leg{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
  .inv-leg div{display:flex;align-items:center;gap:8px;font-size:13px}
  .inv-leg i{width:10px;height:10px;border-radius:50%;flex:none}
  .inv-leg b{margin-left:auto;font-family:var(--f-mono)}
  .lots{display:flex;flex-direction:column;gap:10px}
  .lot{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:13px}
  .lot .prog{grid-column:1/-1}
  .lot .c{font-family:var(--f-mono);color:var(--muted);font-size:12px}
  .lot .c.soon{color:var(--warn)}
  .inv-price{width:96px;text-align:right;font-family:var(--f-mono)}
  .bars12{display:flex;align-items:flex-end;gap:6px;height:120px;padding-top:8px}
  .bars12 div{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;min-width:0}
  .bars12 i{width:100%;background:linear-gradient(180deg,var(--accent),rgba(46,240,255,.25));transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.8,.2,1) both;box-shadow:0 0 10px rgba(46,240,255,.35);border-radius:1px}
  .bars12 span{font-size:10px;color:var(--muted);font-family:var(--f-mono)}
  .taxrow{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
  .taxrow b{font-family:var(--f-mono)}
  `);

  /* ---------- data ---------- */
  const FX0 = { CZK: 1, EUR: 24.3, USD: 21.0 };
  function load(store) {
    let d = store.get('data', null);
    if (!d) { d = sample(); store.set('data', d) }
    d.fx = Object.assign({}, FX0, d.fx || {}); d.prices = d.prices || {}; d.txs = d.txs || [];
    return d;
  }
  const uid = () => Math.random().toString(36).slice(2, 10);
  const addYears = (iso, n) => { const [y, m, dd] = iso.split('-').map(Number); const d = new Date(Date.UTC(y + n, m - 1, dd)); return d.toISOString().slice(0, 10) };
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) };
  const exemptFrom = buy => addDays(addYears(buy, YEARS_TEST), 1);   // test musí být PŘEKROČEN
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

  /* ---------- výpočty (FIFO) ---------- */
  function calc(d) {
    const fxOf = c => d.fx[c] || 1;
    const P = {}, realized = [], divs = [], buys = [];
    const txs = [...d.txs].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 1));
    for (const t of txs) {
      const p = P[t.ticker] || (P[t.ticker] = { ticker: t.ticker, name: t.name || t.ticker, ccy: t.ccy, lots: [], last: +t.price });
      if (t.name) p.name = t.name;
      const fx = +t.fx || fxOf(t.ccy);
      if (t.type === 'buy') {
        p.lots.push({ date: t.date, qty: +t.qty, price: +t.price, fx, feePer: (+t.fee || 0) / (+t.qty || 1) }); p.last = +t.price;
        buys.push({ date: t.date, czk: t.qty * t.price * fx + (+t.fee || 0) });
      } else if (t.type === 'sell') {
        let q = +t.qty; const feePer = (+t.fee || 0) / (q || 1); p.last = +t.price;
        while (q > 1e-9 && p.lots.length) {
          const L = p.lots[0], take = Math.min(q, L.qty);
          realized.push({ ticker: t.ticker, buy: L.date, sell: t.date, qty: take, cost: take * (L.price * L.fx + L.feePer), proceeds: take * t.price * fx, fee: take * feePer, exempt: t.date >= exemptFrom(L.date) });
          L.qty -= take; q -= take; if (L.qty <= 1e-9) p.lots.shift();
        }
      } else if (t.type === 'div') divs.push({ ...t, czk: (+t.price) * fx });
    }
    const pos = Object.values(P).map(p => {
      const qty = p.lots.reduce((s, l) => s + l.qty, 0); if (qty <= 1e-9) return null;
      const cost = p.lots.reduce((s, l) => s + l.qty * (l.price * l.fx + l.feePer), 0);
      const avg = p.lots.reduce((s, l) => s + l.qty * l.price, 0) / qty;
      const pr = d.prices[p.ticker]?.price ?? p.last;
      const value = qty * pr * fxOf(p.ccy);
      const td = App.today();
      const exQty = p.lots.filter(l => td >= exemptFrom(l.date)).reduce((s, l) => s + l.qty, 0);
      return { ...p, qty, cost, avg, price: pr, priceDate: d.prices[p.ticker]?.date, value, pl: value - cost, exQty };
    }).filter(Boolean).sort((a, b) => b.value - a.value);
    const value = pos.reduce((s, p) => s + p.value, 0), cost = pos.reduce((s, p) => s + p.cost, 0);
    return { pos, realized, divs, buys, value, cost, pl: value - cost };
  }
  function taxYear(c, y) {
    const r = c.realized.filter(x => x.sell.startsWith(String(y)));
    const gross = r.reduce((s, x) => s + x.proceeds, 0);
    const underLimit = gross <= SMALL_LIMIT;
    const taxable = r.filter(x => !x.exempt);
    const gain = taxable.reduce((s, x) => s + x.proceeds - x.cost - x.fee, 0);
    const base = underLimit ? 0 : Math.max(0, gain);
    const divs = c.divs.filter(x => x.date.startsWith(String(y))).reduce((s, x) => s + x.czk, 0);
    return { r, gross, underLimit, exemptGain: r.filter(x => x.exempt).reduce((s, x) => s + x.proceeds - x.cost - x.fee, 0), gain, base, tax: base * TAX_RATE, divs };
  }

  /* ---------- ukázková data ---------- */
  function sample() {
    const t = [];
    const add = (date, type, ticker, name, qty, price, ccy, fx, fee = 0) => t.push({ id: uid(), date, type, ticker, name, qty, price, ccy, fx, fee });
    add('2022-03-10', 'buy', 'AAPL', 'Apple', 5, 160, 'USD', 22.5, 30);
    add('2023-06-12', 'buy', 'AAPL', 'Apple', 3, 183, 'USD', 21.8, 20);
    add('2024-09-02', 'buy', 'AAPL', 'Apple', 4, 225, 'USD', 22.6, 20);
    add('2026-04-15', 'sell', 'AAPL', 'Apple', 6, 255, 'USD', 21.9, 25);
    add('2023-03-20', 'buy', 'CEZ', 'ČEZ', 20, 900, 'CZK', 1, 40);
    add('2024-07-15', 'div', 'CEZ', 'ČEZ', 0, 1040, 'CZK', 1);
    add('2025-07-14', 'div', 'CEZ', 'ČEZ', 0, 1100, 'CZK', 1);
    add('2026-07-13', 'div', 'CEZ', 'ČEZ', 0, 1180, 'CZK', 1);
    add('2024-02-05', 'buy', 'MSFT', 'Microsoft', 3, 405, 'USD', 23.4, 20);
    add('2025-08-11', 'buy', 'MSFT', 'Microsoft', 2, 520, 'USD', 21.3, 20);
    // pravidelné nákupy ETF každých 14 dní
    let d = '2023-01-09', k = 0; const end = App.today();
    while (d <= end) { const pr = Math.round((88 + k * 0.55 + Math.sin(k / 3) * 3) * 100) / 100; add(d, 'buy', 'VWCE', 'Vanguard FTSE All-World', 2, pr, 'EUR', 24.5 - k * 0.003, 0); d = addDays(d, 14); k++ }
    return { sample: true, txs: t, fx: { ...FX0 }, prices: { VWCE: { price: 141.2, date: end }, AAPL: { price: 262, date: end }, MSFT: { price: 498, date: end }, CEZ: { price: 1085, date: end } } };
  }

  /* ---------- registrace ---------- */
  App.register({
    id: 'investice',
    name: 'Investice',
    description: 'Portfolio, časový test 3 roky, daně z prodeje a dividendy.',
    icon: App.icons.chart,
    order: 20,

    /* Nástroje pro asistenta */
    tools(ctx) {
      return [
        { name: 'portfolio_summary', description: 'Souhrn investičního portfolia: hodnota v Kč, pořizovací cena, nerealizovaný zisk, pozice (ticker, kusy, hodnota, zisk, kolik kusů už splňuje 3letý časový test) a nejbližší loty, které časový test splní. Ceny jsou ručně zadané.',
          run: () => { const d = load(ctx.store), c = calc(d), td = App.today();
            const next = c.pos.flatMap(p => p.lots.map(l => ({ ticker: p.ticker, kusu: Math.round(l.qty * 1e4) / 1e4, koupeno: l.date, osvobozeno_od: exemptFrom(l.date) }))).filter(x => x.osvobozeno_od > td).sort((a, b) => a.osvobozeno_od.localeCompare(b.osvobozeno_od)).slice(0, 6);
            return { ukazkova_data: !!d.sample, hodnota: Math.round(c.value), porizovaci_cena: Math.round(c.cost), zisk: Math.round(c.pl), vynos_procent: c.cost ? Math.round(c.pl / c.cost * 1000) / 10 : 0,
              pozice: c.pos.map(p => ({ ticker: p.ticker, nazev: p.name, kusu: Math.round(p.qty * 1e4) / 1e4, cena: p.price, mena: p.ccy, hodnota: Math.round(p.value), zisk: Math.round(p.pl), osvobozeno_kusu: Math.round(p.exQty * 1e4) / 1e4 })), nejblizsi_casovy_test: next } } },
        { name: 'investment_tax', description: 'Orientační daň z prodeje cenných papírů za rok: hrubé příjmy z prodejů vůči limitu 100 000 Kč, zisk z lotů po a před 3letým testem, odhad daně a dividendy. Není to daňové poradenství.',
          inputSchema: { type: 'object', properties: { rok: { type: 'number' } } },
          run: inp => { const d = load(ctx.store), t = taxYear(calc(d), +inp.rok || new Date().getFullYear()); return { ukazkova_data: !!d.sample, prijmy_z_prodeju: Math.round(t.gross), pod_limitem_100k: t.underLimit, zisk_po_testu: Math.round(t.exemptGain), zisk_pred_testem: Math.round(t.gain), zaklad_dane: Math.round(t.base), odhad_dane: Math.round(t.tax), dividendy: Math.round(t.divs) } } }
      ];
    },

    widget(el, ctx) {
      const d = load(ctx.store), c = calc(d);
      const td = App.today();
      const next = c.pos.flatMap(p => p.lots.map(l => ({ t: p.ticker, ex: exemptFrom(l.date) }))).filter(x => x.ex > td).sort((a, b) => a.ex.localeCompare(b.ex))[0];
      el.innerHTML = `${d.sample ? '<div class="lbl">ukázková data</div>' : ''}
        <div class="wnums"><div><span>Hodnota</span><b data-count="${c.value}"></b></div>
        <div><span>Zisk / ztráta</span><b class="${c.pl >= 0 ? 'inc' : 'exp'}" data-count="${c.pl}" data-pre="${c.pl > 0 ? '+' : ''}"></b></div>
        <div><span>Výnos</span><b class="${c.pl >= 0 ? 'inc' : 'exp'}">${c.cost ? fmt.pct(c.pl / c.cost * 100) : '—'}</b></div></div>
        ${next ? `<span class="wnote">Další lot projde časovým testem: <b style="color:var(--accent)">${esc(next.t)}</b> za ${daysBetween(td, next.ex)} dní (${fmt.date(next.ex)})</span>` : ''}`;
    },

    mount(root, ctx) {
      let d = load(ctx.store);
      let tab = 'prehled';
      const save = () => ctx.store.set('data', d);
      const $ = s => root.querySelector(s);

      function draw() {
        const c = calc(d), y = new Date().getFullYear(), tx = taxYear(c, y), td = App.today();
        const divY = tx.divs;
        root.innerHTML = `<div class="mw">
          ${d.sample ? '<div class="banner"><b>Ukázková data.</b> <span>Tickery, ceny i kurzy jsou vymyšlené. Po přidání první vlastní transakce ukázka zmizí.</span></div>' : ''}
          <div class="kpis">
            <div class="kpi"><span class="lbl">Hodnota portfolia</span><span class="v" data-count="${c.value}"></span><span class="s">${c.pos.length} pozic</span></div>
            <div class="kpi"><span class="lbl">Pořizovací cena</span><span class="v" data-count="${c.cost}"></span><span class="s">včetně poplatků</span></div>
            <div class="kpi"><span class="lbl">Nerealizovaný zisk</span><span class="v ${c.pl >= 0 ? 'inc' : 'exp'}" data-count="${c.pl}" data-pre="${c.pl > 0 ? '+' : ''}"></span><span class="s">${c.cost ? fmt.pct(c.pl / c.cost * 100) : '—'}</span></div>
            <div class="kpi"><span class="lbl">Dividendy ${y}</span><span class="v" data-count="${divY}"></span><span class="s">hrubě, daní se zvlášť</span></div>
          </div>
          <div class="tabs" role="tablist">${[['prehled', 'Pozice'], ['dane', 'Časový test a daně'], ['obchody', 'Transakce'], ['nastaveni', 'Kurzy']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
          <div id="invTab"></div></div>`;
        root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; draw() });
        const T = $('#invTab');
        if (tab === 'prehled') T.innerHTML = viewPositions(c) ;
        if (tab === 'dane') T.innerHTML = viewTax(c, tx, y, td);
        if (tab === 'obchody') T.innerHTML = viewTrades();
        if (tab === 'nastaveni') T.innerHTML = viewFx();
        wire(c);
        App.countUp(root);
      }

      function viewPositions(c) {
        const tot = c.value || 1; let acc = 0;
        const segs = c.pos.map((p, i) => { const v = p.value / tot * 100; const s = `<circle class="seg" r="15.915" cx="21" cy="21" stroke="${PAL[i % PAL.length]}" stroke-dasharray="${Math.max(0, v - .6)} ${100 - v + .6}" stroke-dashoffset="${-acc}" style="animation-delay:${i * 90}ms"/>`; acc += v; return s }).join('');
        const months = []; const now = new Date(); for (let k = 11; k >= 0; k--) { const dt = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`) }
        const inv = months.map(m => c.buys.filter(b => b.date.startsWith(m)).reduce((s, b) => s + b.czk, 0)); const mx = Math.max(1, ...inv);
        return `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <section class="panel"><div class="phead"><h2>Pozice</h2><span class="muted">Aktuální cenu přepište ručně, přepočet je okamžitý.</span></div>
          <div class="tablebox"><table><thead><tr><th>Titul</th><th class="amt">Kusů</th><th class="amt">Prům. nákup</th><th class="amt">Aktuální cena</th><th class="amt">Hodnota</th><th class="amt">Zisk</th><th>Časový test</th></tr></thead><tbody>
          ${c.pos.map((p, i) => `<tr><td><div class="p"><i class="dot" style="background:${PAL[i % PAL.length]};display:inline-block;margin-right:8px"></i>${esc(p.ticker)}</div><div class="x">${esc(p.name)} · ${p.ccy}</div></td>
            <td class="amt">${fmt.num(p.qty, 4)}</td><td class="amt">${fmt.num(p.avg)} ${p.ccy}</td>
            <td class="amt"><input class="inv-price" type="number" step="any" data-px="${esc(p.ticker)}" value="${p.price}" aria-label="Cena ${esc(p.ticker)}"><div class="x">${p.priceDate ? fmt.date(p.priceDate) : 'z poslední transakce'}</div></td>
            <td class="amt">${fmt.czk(p.value)}</td><td class="amt ${p.pl >= 0 ? 'inc' : 'exp'}">${p.pl > 0 ? '+' : ''}${fmt.czk(p.pl)}<div class="x">${fmt.pct(p.pl / p.cost * 100)}</div></td>
            <td style="min-width:140px"><div class="prog ${p.exQty >= p.qty - 1e-9 ? 'done' : ''}"><b style="width:${p.exQty / p.qty * 100}%"></b></div><div class="x">${fmt.num(p.exQty, 2)} z ${fmt.num(p.qty, 2)} ks osvobozeno</div></td></tr>`).join('')}
          </tbody></table></div></section>
          <div class="grid2">
            <section class="panel"><div class="phead"><h2>Rozložení</h2></div><div class="inv-donut"><svg viewBox="0 0 42 42"><circle r="15.915" cx="21" cy="21" fill="none" stroke="var(--track)" stroke-width="4.2"/>${segs}</svg>
              <div class="inv-leg">${c.pos.map((p, i) => `<div><i style="background:${PAL[i % PAL.length]}"></i>${esc(p.ticker)}<b>${fmt.pct(p.value / tot * 100)}</b></div>`).join('')}</div></div></section>
            <section class="panel"><div class="phead"><h2>Vloženo za posledních 12 měsíců</h2><span class="muted num">${fmt.czk(inv.reduce((a, b) => a + b, 0))}</span></div>
              <div class="bars12">${inv.map((v, k) => `<div title="${App.MONTHS[+months[k].slice(5) - 1]}: ${fmt.czk(v)}"><i style="height:${Math.max(2, v / mx * 100)}%;animation-delay:${k * 50}ms"></i><span>${App.MON[+months[k].slice(5) - 1]}</span></div>`).join('')}</div></section>
          </div></div>`;
      }

      function viewTax(c, tx, y, td) {
        const lots = c.pos.flatMap(p => p.lots.map(l => ({ p, l, ex: exemptFrom(l.date) }))).filter(x => x.ex > td).sort((a, b) => a.ex.localeCompare(b.ex));
        const freeVal = c.pos.reduce((s, p) => s + p.exQty * p.price * (d.fx[p.ccy] || 1), 0);
        return `<div class="grid2" style="margin-top:16px">
          <section class="panel"><div class="phead"><h2>Kdy projdou časovým testem</h2><span class="muted">${YEARS_TEST} roky od nákupu</span></div>
            <p class="muted" style="margin-top:0">Už osvobozeno: <b style="color:var(--inc)">${fmt.czk(freeVal)}</b> v současné hodnotě. Prodej těchto kusů je od daně osvobozen.</p>
            <div class="lots">${lots.slice(0, 12).map(({ p, l, ex }, i) => { const total = daysBetween(l.date, ex), left = daysBetween(td, ex); return `<div class="lot">
              <span><b>${esc(p.ticker)}</b> · ${fmt.num(l.qty, 4)} ks z ${fmt.date(l.date)}</span><span class="c ${left < 90 ? 'soon' : ''}">za ${left} dní · ${fmt.date(ex)}</span>
              <div class="prog"><b style="width:${(1 - left / total) * 100}%;animation-delay:${i * 50}ms"></b></div></div>` }).join('') || '<span class="muted">Všechny otevřené loty už časový test splňují.</span>'}
            ${lots.length > 12 ? `<span class="muted">… a dalších ${lots.length - 12} lotů</span>` : ''}</div></section>
          <section class="panel"><div class="phead"><h2>Daně za rok ${y}</h2><span class="pill ${tx.base ? 'warn' : 'ok'}">${tx.base ? 'k danění' : 'bez daně'}</span></div>
            <div class="taxrow"><span>Příjmy z prodejů (hrubě)</span><b>${fmt.czk(tx.gross)}</b></div>
            <div class="meter ${tx.gross / SMALL_LIMIT < .5 ? 'ok' : tx.gross <= SMALL_LIMIT ? 'mid' : 'hi'}" style="margin-top:8px"><b style="width:${Math.min(100, tx.gross / SMALL_LIMIT * 100)}%"></b></div>
            <div class="mlbl" style="margin-top:4px">${tx.underLimit ? `Pod limitem ${fmt.czk(SMALL_LIMIT)} – zbývá ${fmt.czk(SMALL_LIMIT - tx.gross)}` : `Limit ${fmt.czk(SMALL_LIMIT)} překročen`}</div>
            <div class="taxrow"><span>Zisk z lotů po časovém testu</span><b class="inc">${fmt.czk(tx.exemptGain)}</b></div>
            <div class="taxrow"><span>Zisk z lotů kratších než ${YEARS_TEST} roky</span><b>${fmt.czk(tx.gain)}</b></div>
            <div class="taxrow"><span>Orientační základ daně</span><b>${fmt.czk(tx.base)}</b></div>
            <div class="taxrow"><span>Orientační daň (${TAX_RATE * 100} %)</span><b class="${tx.tax ? 'exp' : ''}">${fmt.czk(tx.tax)}</b></div>
            <div class="taxrow"><span>Dividendy (hrubě)</span><b>${fmt.czk(tx.divs)}</b></div>
            <p class="muted" style="font-size:12px">Orientační výpočet metodou FIFO v kurzech zadaných u transakcí. Nejde o daňové poradenství. Pravidla ověřte u daňového poradce nebo na webu Finanční správy.</p>
            ${tx.r.length ? `<div class="lbl" style="margin-top:8px">Prodeje ${y}</div>${tx.r.map(x => `<div class="taxrow"><span>${esc(x.ticker)} · ${fmt.num(x.qty, 4)} ks · koupeno ${fmt.date(x.buy)}</span><span><span class="pill ${x.exempt ? 'ok' : 'warn'}">${x.exempt ? 'test splněn' : 'do 3 let'}</span> <b>${fmt.czk(x.proceeds - x.cost - x.fee)}</b></span></div>`).join('')}` : ''}
          </section></div>`;
      }

      function viewTrades() {
        const list = [...d.txs].sort((a, b) => b.date.localeCompare(a.date));
        const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
        return `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <section class="panel"><div class="phead"><h2>Nová transakce</h2></div>
          <form id="invForm" class="fgrid">
            <label class="field">Datum<input type="date" id="fD" value="${App.today()}" required></label>
            <label class="field">Typ<select id="fT">${opt('buy', 'Nákup')}${opt('sell', 'Prodej')}${opt('div', 'Dividenda')}</select></label>
            <label class="field">Ticker<input type="text" id="fK" placeholder="např. VWCE" required list="invTick"></label>
            <datalist id="invTick">${[...new Set(d.txs.map(t => t.ticker))].map(t => `<option value="${esc(t)}">`).join('')}</datalist>
            <label class="field">Název<input type="text" id="fN" placeholder="nepovinné"></label>
            <label class="field" id="fQw">Počet kusů<input type="number" id="fQ" step="any" min="0"></label>
            <label class="field"><span id="fPl">Cena za kus</span><input type="number" id="fP" step="any" min="0" required></label>
            <label class="field">Měna<select id="fC">${Object.keys(d.fx).map(k => opt(k, k, 'USD')).join('')}</select></label>
            <label class="field">Kurz CZK<input type="number" id="fX" step="any" value="${d.fx.USD}"></label>
            <label class="field">Poplatek (Kč)<input type="number" id="fF" step="any" value="0"></label>
            <div class="field" style="justify-content:flex-end"><button class="btn primary" type="submit">Přidat</button></div>
          </form></section>
          <section class="panel"><div class="phead"><h2>Historie</h2><span class="muted num">${list.length} transakcí</span></div>
          <div class="tablebox"><table><thead><tr><th>Datum</th><th>Typ</th><th>Titul</th><th class="amt">Kusů</th><th class="amt">Cena</th><th class="amt">Celkem Kč</th><th></th></tr></thead><tbody>
          ${list.slice(0, 150).map(t => `<tr><td class="d">${fmt.date(t.date)}</td><td><span class="pill ${t.type === 'buy' ? 'ok' : t.type === 'sell' ? 'warn' : 'dim'}">${{ buy: 'nákup', sell: 'prodej', div: 'dividenda' }[t.type]}</span></td>
            <td><b>${esc(t.ticker)}</b></td><td class="amt">${t.type === 'div' ? '—' : fmt.num(t.qty, 4)}</td><td class="amt">${fmt.num(t.price)} ${t.ccy}</td>
            <td class="amt">${fmt.czk((t.type === 'div' ? 1 : t.qty) * t.price * (t.fx || 1))}</td><td><button class="btn sm danger" data-del="${t.id}">Smazat</button></td></tr>`).join('')}
          </tbody></table></div></section></div>`;
      }

      function viewFx() {
        return `<section class="panel" style="margin-top:16px"><div class="phead"><h2>Kurzy měn</h2><span class="muted">Kolik Kč stojí 1 jednotka měny</span></div>
          <div class="fgrid">${Object.keys(d.fx).filter(k => k !== 'CZK').map(k => `<label class="field">${k}<input type="number" step="any" data-fx="${k}" value="${d.fx[k]}"></label>`).join('')}
          <label class="field">Přidat měnu<input type="text" id="fxNew" placeholder="např. GBP" maxlength="3"></label></div>
          <p class="muted" style="font-size:12px">Kurzy slouží k přepočtu aktuální hodnoty. U transakcí se ukládá kurz platný v den obchodu, ten se použije pro výpočet daně.</p>
          <div class="acts"><button class="btn sm danger" id="invWipe">Smazat všechna data investic</button></div></section>`;
      }

      function wire(c) {
        root.querySelectorAll('[data-px]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (v > 0) { d.prices[i.dataset.px] = { price: v, date: App.today() }; save(); draw(); ctx.toast(`Cena ${i.dataset.px} aktualizována.`) } });
        root.querySelectorAll('[data-fx]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (v > 0) { d.fx[i.dataset.fx] = v; save(); ctx.toast('Kurz uložen.') } });
        const nf = $('#fxNew'); if (nf) nf.onchange = () => { const k = nf.value.trim().toUpperCase(); if (/^[A-Z]{3}$/.test(k) && !d.fx[k]) { d.fx[k] = 1; save(); draw() } };
        const w = $('#invWipe'); if (w) armed(w, () => { d = { sample: false, txs: [], fx: d.fx, prices: {} }; save(); draw(); ctx.toast('Data investic smazána.') });
        root.querySelectorAll('[data-del]').forEach(b => armed(b, () => { d.txs = d.txs.filter(t => t.id !== b.dataset.del); save(); draw() }));
        const f = $('#invForm'); if (!f) return;
        const sync = () => { const ty = $('#fT').value; $('#fQw').hidden = ty === 'div'; $('#fPl').textContent = ty === 'div' ? 'Částka celkem (hrubě)' : 'Cena za kus' };
        $('#fT').onchange = sync; sync();
        $('#fC').onchange = () => { $('#fX').value = d.fx[$('#fC').value] || 1 };
        $('#fK').onchange = () => { const k = $('#fK').value.trim().toUpperCase(); const last = [...d.txs].reverse().find(t => t.ticker === k); if (last) { $('#fN').value = last.name || ''; $('#fC').value = last.ccy; $('#fX').value = d.fx[last.ccy] || 1 } };
        f.onsubmit = e => {
          e.preventDefault();
          const t = { id: uid(), date: $('#fD').value, type: $('#fT').value, ticker: $('#fK').value.trim().toUpperCase(), name: $('#fN').value.trim(), qty: +$('#fQ').value || 0, price: +$('#fP').value, ccy: $('#fC').value, fx: +$('#fX').value || 1, fee: +$('#fF').value || 0 };
          if (!t.ticker || !t.price || (t.type !== 'div' && !t.qty)) { ctx.toast('Vyplňte ticker, počet kusů a cenu.'); return }
          if (t.type === 'sell') { const have = (calc(d).pos.find(p => p.ticker === t.ticker) || { qty: 0 }).qty; if (t.qty > have + 1e-9) { ctx.toast(`Máte jen ${fmt.num(have, 4)} ks ${t.ticker}.`); return } }
          if (d.sample) d = { sample: false, txs: [], fx: d.fx, prices: {} };
          d.txs.push(t); save(); draw(); ctx.toast('Transakce přidána.');
        };
      }
      function armed(btn, fn) { btn.onclick = () => { if (btn.classList.contains('armed')) fn(); else { const o = btn.textContent; btn.classList.add('armed'); btn.textContent = 'Opravdu?'; setTimeout(() => { btn.classList.remove('armed'); btn.textContent = o }, 4000) } } }

      draw();
    }
  });
})();
