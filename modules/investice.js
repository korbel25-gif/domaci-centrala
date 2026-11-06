/* =====================================================================
   MODUL: Investice
   Portfolio akcií/ETF, FIFO loty, časový test (3 roky), limit 100 000 Kč,
   dividendy, alokace. Ceny a kurzy se zadávají ručně (zatím bez online cen).
   Data: App.store('investice') → klíč 'data'
   Import z XTB: export historie účtu z xStation 5 (XLSX/CSV) → parseXTB().
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
  /** Komu patří lot: 'Vlastní' nebo jméno investičního plánu (Mikuláš, …). */
  const planName = (d, k) => (d.plans || {})[k]?.name || 'Plán ' + String(k).split(':')[1];
  const ownerOf = (d, pos) => { const k = (d.planPos || {})[pos]; return k ? planName(d, k) : 'Vlastní' };
  function calc(d, owner) {
    const fxOf = c => d.fx[c] || 1;
    const P = {}, realized = [], divs = [], buys = [];
    const txs = [...d.txs].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 1));
    for (const t of txs) {
      const p = P[t.ticker] || (P[t.ticker] = { ticker: t.ticker, name: t.name || t.ticker, ccy: t.ccy, lots: [], last: +t.price });
      if (t.name) p.name = t.name;
      const fx = +t.fx || fxOf(t.ccy);
      if (t.type === 'buy') {
        p.lots.push({ date: t.date, qty: +t.qty, price: +t.price, fx, feePer: (+t.fee || 0) / (+t.qty || 1), pos: t.pos || '' }); p.last = +t.price;
        buys.push({ date: t.date, czk: t.qty * t.price * fx + (+t.fee || 0) });
      } else if (t.type === 'sell') {
        let q = +t.qty; const feePer = (+t.fee || 0) / (q || 1); p.last = +t.price;
        while (q > 1e-6 && p.lots.length) {
          // XTB uvádí, kterou pozici prodej uzavřel (Position ID) – pak se bere ta, jinak nejstarší (FIFO)
          const li = t.pos ? Math.max(0, p.lots.findIndex(l => l.pos === t.pos)) : 0;
          const L = p.lots[li], take = Math.min(q, L.qty);
          realized.push({ ticker: t.ticker, buy: L.date, sell: t.date, qty: take, cost: take * (L.price * L.fx + L.feePer), proceeds: take * t.price * fx, fee: take * feePer, exempt: t.date >= exemptFrom(L.date) });
          L.qty -= take; q -= take; if (L.qty <= 1e-6) p.lots.splice(li, 1);
        }
      } else if (t.type === 'div') divs.push({ ...t, czk: (+t.price) * fx });
    }
    if (owner) for (const p of Object.values(P)) p.lots = p.lots.filter(l => ownerOf(d, l.pos) === owner);
    const pos = Object.values(P).map(p => {
      const qty = p.lots.reduce((s, l) => s + l.qty, 0); if (qty <= 1e-6) return null;
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
    const dy = c.divs.filter(x => x.date.startsWith(String(y))), divs = dy.reduce((s, x) => s + x.czk, 0), wht = dy.reduce((s, x) => s + (+x.wht || 0) * (+x.fx || 1), 0);
    return { wht, r, gross, underLimit, exemptGain: r.filter(x => x.exempt).reduce((s, x) => s + x.proceeds - x.cost - x.fee, 0), gain, base, tax: base * TAX_RATE, divs };
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

  /* ---------- import z XTB ----------
     Zdroj: xStation 5 → Historie účtu → Export (XLSX). Čte list s hotovostními operacemi
     (nákupy, prodeje, dividendy, srážková daň) a z otevřených pozic aktuální ceny.
     Částky jsou v měně účtu (Kč); kurz se dopočítá z částky ÷ (kusy × cena), takže obsahuje i poplatek za směnu. */
  /* Jednotné kurzy GFŘ (Kč za 1 jednotku) – pro přepočet obchodů z účtů v USD/EUR. Doplňte další rok, až vyjde pokyn (leden).
     Pro rok, který tu chybí, se použije kurz ze záložky Kurzy. */
  const JK = { 2023: { EUR: 23.97, USD: 22.14, GBP: 27.59, CHF: 24.69, PLN: 5.31 }, 2024: { EUR: 25.16, USD: 23.28, GBP: 29.78, CHF: 26.40, PLN: 5.85 }, 2025: { EUR: 24.66, USD: 21.84, GBP: 28.80, CHF: 26.33, PLN: 5.82 } };
  function czkRate(ccy, date, fx, conv = []) {
    if (ccy === 'CZK') return 1;
    const y = String(date).slice(0, 4); if ((JK[y] || {})[ccy]) return JK[y][ccy];
    const c = conv.filter(x => x.ccy === ccy && x.date.startsWith(y));   // rok bez jednotného kurzu: průměr vašich směn v XTB
    return c.length ? Math.round(c.reduce((s, x) => s + x.rate, 0) / c.length * 1e4) / 1e4 : fx[ccy] || 1;
  }
  const SUFFIX_CCY = { US: 'USD', UK: 'GBX', DE: 'EUR', NL: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', BE: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR', AT: 'EUR', CZ: 'CZK', PL: 'PLN', CH: 'CHF', DK: 'DKK', SE: 'SEK', NO: 'NOK' };
  const xnum = v => typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s| /g, '').replace(/,(?=\d+$)/, '.').replace(/,/g, ''));
  const nt = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  function xdate(v) {
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;   // SheetJS vrací místní čas buňky
    if (typeof v === 'number') return new Date(Math.floor(v - 25569) * 864e5).toISOString().slice(0, 10);
    const t = String(v || '').trim(); let m;
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }
  function findHeader(rows, need) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const h = rows[i].map(nt), col = {};
      for (const [k, re] of Object.entries(need)) { const j = h.findIndex(x => re.test(x)); if (j >= 0) col[k] = j }
      if (Object.keys(need).every(k => k in col)) return { at: i, col, h };
    }
    return null;
  }
  /** sheets = { název listu: řádky jako pole }, fname = název souboru (XTB ho začíná měnou účtu).
      Vrací obchody, dividendy, ceny z otevřených pozic a pohyby peněz na účtu. */
  function parseXTB(sheets, fname = '') {
    const out = { txs: [], prices: {}, open: {}, skipped: {}, unknown: [], wht: 0, sheet: '', acc: '', account: '',
      conv: [], plans: [], cash: { vklady: 0, vybery: 0, prevodyIn: 0, prevodyOut: 0, uroky: 0, danUroky: 0, cfd: 0, poplatky: 0, zustatek: null } };
    const fm = String(fname).match(/(?:^|[\\/])(CZK|USD|EUR|GBP|PLN)_(\d+)/i); if (fm) { out.acc = fm[1].toUpperCase(); out.account = fm[2] }
    if (!out.acc) for (const rows of Object.values(sheets)) {   // nebo z tabulky souhrnu (sloupec Currency / Měna)
      for (let k = 0; k < Math.min(rows.length, 15) && !out.acc; k++) { const i = rows[k].findIndex(c => /^(currency|mena)$/.test(nt(c))); if (i >= 0) { const v = String((rows[k + 1] || [])[i] || '').trim().toUpperCase(); if (/^[A-Z]{3}$/.test(v)) out.acc = v } }
      if (out.acc) break;
    }
    const col = (h, re) => h.findIndex(x => re.test(x));
    for (const [name, rows] of Object.entries(sheets)) {
      const H = findHeader(rows, { type: /^(type|typ)$/, comment: /^(comment|komentar|popis)$/, amount: /^(amount|castka)$/ });
      if (!H) continue;
      out.sheet = name;
      if (!out.account) { const r = rows.slice(0, H.at).find(r => /account number|cislo uctu/.test(nt(r[0]))); if (r) out.account = String(r[1] || '').trim() }
      const tcol = col(H.h, /^(time|cas|datum|date)$/), scol = (i => i >= 0 ? i : col(H.h, /^(symbol|instrument|nastroj)$/))(col(H.h, /^(ticker|symbol)$/));
      const ncol = col(H.h, /^(instrument|nazev)$/), icol = col(H.h, /^id$/), pcol = col(H.h, /^position id$/), ccol = col(H.h, /^(category|kategorie)$/);
      const whts = [], ev = [], subs = {}, prcol = col(H.h, /^(product|produkt)$/);
      for (const r of rows.slice(H.at + 1)) {
        const type = nt(r[H.col.type]), com = String(r[H.col.comment] ?? '').trim(), amt = xnum(r[H.col.amount]);
        if (!type || !isFinite(amt)) continue;
        if (/^(total|celkem)$/.test(type)) { out.cash.zustatek = Math.round(amt * 100) / 100; continue }
        const sym = String((scol >= 0 ? r[scol] : '') || (com.match(/^(?:corr\s+)?([A-Z0-9\-]+\.[A-Z]{2})\b/) || [])[1] || '').trim().toUpperCase();
        const date = xdate(tcol >= 0 ? r[tcol] : ''), id = icol >= 0 ? String(r[icol] ?? '').trim() : '', pos = pcol >= 0 ? String(r[pcol] ?? '').trim() : '';
        const nm = ncol >= 0 && ncol !== scol ? String(r[ncol] || '').trim() : '';
        const cat = ccol >= 0 ? nt(r[ccol]) : '';
        const ts = tcol >= 0 && r[tcol] instanceof Date ? r[tcol].getTime() : 0, ip = prcol >= 0 && /investment plan|investicni plan/.test(nt(r[prcol]));
        const tm = com.match(/^Transfer from (\d+) to (\d+)/i);   // vnitřní přesun mezi hlavním účtem a investičním plánem
        if (tm && ip) {
          const sub = amt >= 0 ? tm[2] : tm[1], S = subs[sub] || (subs[sub] = { sub, vlozeno: 0, vybrano: 0, od: date, do: date });
          if (amt >= 0) { S.vlozeno += amt; ev.push({ ts, k: 'in', sub }) } else S.vybrano += -amt;
          if (date < S.od) S.od = date; if (date > S.do) S.do = date;
        }
        if (tm) { out.skipped['přesuny do investičních plánů'] = (out.skipped['přesuny do investičních plánů'] || 0) + 1; continue }
        const [base, suf] = sym.includes('.') ? [sym.slice(0, sym.lastIndexOf('.')), sym.slice(sym.lastIndexOf('.') + 1)] : [sym, ''];
        const m = com.match(/(OPEN|CLOSE)\s+(BUY|SELL)\s+(?:(?=\S*[A-Z])\S+\s+)?([\d.,]+)(?:\s*\/\s*[\d.,]+)?\s*@\s*([\d.,]+)/i);
        if (m && sym && date && cat !== 'cfd') {
          const qty = xnum(m[3]), price = xnum(m[4]), kind = m[1].toUpperCase() === 'OPEN' ? 'buy' : 'sell';
          if (!(qty > 0 && price > 0)) { out.unknown.push(com); continue }
          const fxA = Math.abs(amt) / (qty * price);
          out.txs.push({ xtb: id || `${date}|${sym}|${kind}|${qty}|${amt}`, date, type: kind, ticker: base, name: nm || sym, sym, pos, qty, price, ccy: SUFFIX_CCY[suf] || 'USD', fxA, fee: 0 });
          if (ip && kind === 'buy' && ts) ev.push({ ts, k: 'buy', pos });
        } else if (/divid/.test(type) && sym && date) {
          out.txs.push({ xtb: id || `${date}|${sym}|div|${amt}`, date, type: 'div', ticker: base, name: nm || sym, sym, pos, qty: 0, price: Math.round(amt * 100) / 100, ccy: '', fee: 0, wht: 0 });
        } else if (/withholding|wht|srazkov/.test(type) && sym) {
          whts.push({ base, pos, date, v: -amt }); out.wht += -amt;
        } else {
          const C = out.cash;
          if (/^deposit|^vklad/.test(type)) C.vklady += amt;
          else if (/^withdraw|^vyber/.test(type)) C.vybery += -amt;
          else if (/^subaccount/.test(type)) { /* přesun mezi Moje obchody a Investiční plány – v součtu nula */ }
          else if (/^transfer|prevod/.test(type)) {
            if (amt >= 0) C.prevodyIn += amt; else C.prevodyOut += -amt;
            const cm = com.match(/conversion,\s*([A-Z]{3}) to ([A-Z]{3}).*?rate:\s*([\d.]+)/i);   // skutečný kurz směny
            if (cm && date && +cm[3] > 0) { const [f, t, r] = [cm[1].toUpperCase(), cm[2].toUpperCase(), +cm[3]]; if (f === 'CZK' && t !== 'CZK') out.conv.push({ date, ccy: t, rate: Math.round(1 / r * 1e4) / 1e4 }); else if (t === 'CZK') out.conv.push({ date, ccy: f, rate: r }) }
          }
          else if (/interest tax|dan z uroku/.test(type)) C.danUroky += -amt;
          else if (/interest|urok/.test(type)) C.uroky += amt;
          else if (/close trade|swap|rollover/.test(type) || cat === 'cfd') C.cfd += amt;
          else if (/fee|poplatek|commission/.test(type)) C.poplatky += -amt;
          else { out.unknown.push(`${r[H.col.type]}: ${com}`); continue }
          const k = /^deposit/.test(type) ? 'vklady' : /^withdraw/.test(type) ? 'výběry' : /^subaccount/.test(type) ? 'přesuny mezi podúčty' : /^transfer/.test(type) ? 'převody mezi účty' : /interest/.test(type) ? 'úroky' : cat === 'cfd' || /close trade|swap/.test(type) ? 'CFD' : 'poplatky';
          out.skipped[k] = (out.skipped[k] || 0) + 1;
        }
      }
      // srážková daň k dividendě: stejná pozice a den (v souboru bývá daň dřív než dividenda)
      const divs = out.txs.filter(t => t.type === 'div');
      for (const w of whts) {
        const d = divs.find(x => x.ticker === w.base && x.pos && x.pos === w.pos && x.date === w.date) || divs.find(x => x.ticker === w.base && Math.abs(daysBetween(x.date, w.date || x.date)) <= 3 && Math.sign(x.price) === Math.sign(w.v));
        if (d) d.wht = Math.round((d.wht + w.v) * 100) / 100;
      }
      for (const k of Object.keys(out.cash)) if (out.cash[k] != null) out.cash[k] = Math.round(out.cash[k] * 100) / 100;
      // nákup do minuty po vkladu do jediného plánu → víme, kterému plánu pozice patří
      ev.sort((a, b) => a.ts - b.ts); const anchor = {};
      ev.forEach((e, i) => { if (e.k !== 'buy') return; const w = new Set(ev.slice(0, i).filter(x => x.k === 'in' && e.ts - x.ts <= 60000).map(x => x.sub)); if (w.size === 1) anchor[e.pos] = [...w][0] });
      out.anchor = anchor;
      out.plans = Object.values(subs).map(S => ({ ...S, vlozeno: Math.round(S.vlozeno * 100) / 100, vybrano: Math.round(S.vybrano * 100) / 100, lots: [] }));
    }
    // aktuální ceny a držené kusy z listu otevřených pozic
    for (const [name, rows] of Object.entries(sheets)) {
      if (!/open|otevr/i.test(name)) continue;
      const H = findHeader(rows, { symbol: /^(ticker|symbol)$/, px: /^(current price|market price|aktualni cena|trzni cena)$/ });
      if (!H) continue;
      const tcol = col(H.h, /^(type|typ)$/), vcol = col(H.h, /^(volume|objem)$/), prc = col(H.h, /^(product|produkt)$/), posc = col(H.h, /^(instrument\/position|position|pozice)$/);
      const groups = []; let g = null;   // XTB řadí pozice po plánech: každý plán = blok titulů za sebou
      for (const r of rows.slice(H.at + 1)) {
        const sym = String(r[H.col.symbol] || '').trim().toUpperCase(), px = xnum(r[H.col.px]); if (!sym) continue;
        const base = sym.includes('.') ? sym.slice(0, sym.lastIndexOf('.')) : sym, isLot = tcol >= 0 && /^(buy|sell)$/i.test(String(r[tcol]).trim());
        const plan = prc >= 0 && /investment plan|investicni plan/.test(nt(r[prc]));
        if (!isLot) { if (plan && (!g || g.seen.has(base))) groups.push(g = { seen: new Set(), lots: [] }); if (!plan) g = null; if (g) g.seen.add(base) }
        if (px > 0) out.prices[base] = px;
        if (isLot && vcol >= 0) {
          out.open[base] = Math.round(((out.open[base] || 0) + xnum(r[vcol])) * 1e4) / 1e4;
          if (g && plan && posc >= 0) g.lots.push(String(r[posc]).trim());
        }
      }
      // skupina → plán: hlasování podle známých nákupů, zbytek podle posledních vkladů
      const A = out.anchor || {}, free = new Set(out.plans.map(p => p.sub));
      const pick = groups.map(G => { const v = {}; G.lots.forEach(p => A[p] && (v[A[p]] = (v[A[p]] || 0) + 1)); return Object.entries(v).sort((a, b) => b[1] - a[1])[0]?.[0] });
      pick.forEach(sub => sub && free.delete(sub));
      const rest = out.plans.filter(p => free.has(p.sub)).sort((a, b) => b.do.localeCompare(a.do));
      groups.forEach((G, i) => { const sub = pick[i] && out.plans.some(p => p.sub === pick[i] && !p.lots.length) ? pick[i] : rest.shift()?.sub; const P = out.plans.find(p => p.sub === sub); if (P) P.lots.push(...G.lots) });
    }
    return out;
  }
  /** Doplní kurzy do Kč podle měny účtu (CZK / USD / EUR). */
  function toCZK(P, acc, fx, conv) {
    return P.txs.map(t => {
      const r = czkRate(acc, t.date, fx, conv), o = { ...t, acc, xtb: acc + ':' + t.xtb };
      if (t.type === 'div') { o.ccy = acc; o.fx = r }
      else { if (Math.abs(t.fxA - 1) < 0.03) o.ccy = acc; o.fx = Math.round(t.fxA * r * 1e4) / 1e4 }
      delete o.fxA; if (t.type === 'div' || !t.pos) delete o.pos; else o.pos = acc + ':' + t.pos; return o;
    });
  }
  function mergeConv(a = [], b = []) { const m = new Map(); [...a, ...b].forEach(x => m.set(x.date + x.ccy + x.rate, x)); return [...m.values()].sort((x, y) => x.date.localeCompare(y.date)) }
  async function readXTB(file) {
    if (/\.pdf$/i.test(file.name)) throw new Error('PDF výpis číst neumím. V xStation zvolte Historie účtu → Export a uložte XLSX.');
    if (!window.XLSX) throw new Error('Knihovna pro Excel se nenačetla (chybí internet).');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }), sheets = {};
    for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    const r = parseXTB(sheets, file.name);
    if (!r.sheet) throw new Error('V souboru jsem nenašel hotovostní operace z XTB (sloupce Type, Comment, Amount).');
    return r;
  }
  window.CentralaParseXTB = parseXTB;   // pro testy

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
      let tab = 'prehled', pending = null, owner = '';
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
        if (tab === 'prehled') T.innerHTML = viewPositions(owner ? calc(d, owner) : c);
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
          ${owners().length > 1 ? `<div class="seg" role="group" aria-label="Čí portfolio" style="align-self:flex-start;flex-wrap:wrap">${['', ...owners()].map(o => `<button data-own="${esc(o)}" aria-pressed="${owner === o}">${o ? esc(o) : 'Vše'}</button>`).join('')}</div>` : ''}
          <section class="panel"><div class="phead"><h2>Pozice${owner ? ' · ' + esc(owner) : ''}</h2><span class="muted">${owner ? `hodnota ${fmt.czk(c.value)} · ${c.pl >= 0 ? '+' : ''}${fmt.czk(c.pl)}` : 'Aktuální cenu přepište ručně, přepočet je okamžitý.'}</span></div>
          <div class="tablebox"><table><thead><tr><th>Titul</th><th class="amt">Kusů</th><th class="amt">Prům. nákup</th><th class="amt">Aktuální cena</th><th class="amt">Hodnota</th><th class="amt">Zisk</th><th>Časový test</th></tr></thead><tbody>
          ${c.pos.map((p, i) => `<tr><td><div class="p"><i class="dot" style="background:${PAL[i % PAL.length]};display:inline-block;margin-right:8px"></i>${esc(p.ticker)}</div><div class="x">${esc(p.name)} · ${p.ccy}</div></td>
            <td class="amt">${fmt.num(p.qty, 4)}</td><td class="amt">${fmt.num(p.avg)} ${p.ccy}</td>
            <td class="amt"><input class="inv-price" type="number" step="any" data-px="${esc(p.ticker)}" value="${p.price}" aria-label="Cena ${esc(p.ticker)}"><div class="x">${p.priceDate ? fmt.date(p.priceDate) : 'z poslední transakce'}</div></td>
            <td class="amt">${fmt.czk(p.value)}</td><td class="amt ${p.pl >= 0 ? 'inc' : 'exp'}">${p.pl > 0 ? '+' : ''}${fmt.czk(p.pl)}<div class="x">${fmt.pct(p.pl / p.cost * 100)}</div></td>
            <td style="min-width:140px"><div class="prog ${p.exQty >= p.qty - 1e-6 ? 'done' : ''}"><b style="width:${p.exQty / p.qty * 100}%"></b></div><div class="x">${fmt.num(p.exQty, 2)} z ${fmt.num(p.qty, 2)} ks osvobozeno</div></td></tr>`).join('')}
          </tbody></table></div></section>
          ${owner ? '' : plansView() + accounts(c)}
          <div class="grid2">
            <section class="panel"><div class="phead"><h2>Rozložení</h2></div><div class="inv-donut"><svg viewBox="0 0 42 42"><circle r="15.915" cx="21" cy="21" fill="none" stroke="var(--track)" stroke-width="4.2"/>${segs}</svg>
              <div class="inv-leg">${c.pos.map((p, i) => `<div><i style="background:${PAL[i % PAL.length]}"></i>${esc(p.ticker)}<b>${fmt.pct(p.value / tot * 100)}</b></div>`).join('')}</div></div></section>
            <section class="panel"><div class="phead"><h2>Nakoupeno za posledních 12 měsíců</h2><span class="muted num">${fmt.czk(inv.reduce((a, b) => a + b, 0))}</span></div>
              <div class="bars12">${inv.map((v, k) => `<div title="${App.MONTHS[+months[k].slice(5) - 1]}: ${fmt.czk(v)}"><i style="height:${Math.max(2, v / mx * 100)}%;animation-delay:${k * 50}ms"></i><span>${App.MON[+months[k].slice(5) - 1]}</span></div>`).join('')}</div></section>
          </div></div>`;
      }

      function owners() { const k = Object.entries(d.plans || {}).filter(([, x]) => x.lots.length).map(([k]) => planName(d, k)); return k.length ? ['Vlastní', ...new Set(k)] : [] }
      function plansView() {
        const E = Object.entries(d.plans || {}); if (!E.length) return '';
        const people = [...new Set(E.filter(([, x]) => x.lots.length || x.name).map(([k]) => planName(d, k)))];
        const card = name => {
          const ks = E.filter(([k]) => planName(d, k) === name), c2 = calc(d, name);
          const vin = ks.reduce((s, [, x]) => s + x.vlozeno * (d.fx[x.acc] || 1), 0), vout = ks.reduce((s, [, x]) => s + x.vybrano * (d.fx[x.acc] || 1), 0), net = vin - vout, active = ks.some(([, x]) => x.lots.length);
          const res = c2.value - net;
          return `<div class="kpi"><span class="lbl">${esc(name)}</span><span class="v">${fmt.czk(c2.value)}</span>
            <span class="s">vloženo ${fmt.czk(vin)}${vout ? ` · vybráno ${fmt.czk(vout)}` : ''}</span>
            <span class="s">výsledek <b class="${res >= 0 ? 'inc' : 'exp'}">${res > 0 ? '+' : ''}${fmt.czk(res)}</b>${active ? '' : ' · plán ukončen'}</span>
            <span class="s">${ks.map(([, x]) => x.acc).join(' + ')} · ${c2.pos.map(p => esc(p.ticker)).join(', ') || '—'}</span></div>`;
        };
        return `<section class="panel"><div class="phead"><h2>Investiční plány</h2><span class="muted">pojmenujte plány – stejné jméno sloučí plán v USD i EUR</span></div>
          <div class="kpis" style="margin-bottom:14px">${people.map(card).join('')}</div>
          <div class="tablebox"><table><thead><tr><th>Plán</th><th>Komu patří</th><th class="amt">Vloženo</th><th class="amt">Vybráno</th><th class="amt">Otevřené pozice</th><th>Období</th></tr></thead><tbody>
          ${E.sort((a, b) => (b[1].lots.length > 0) - (a[1].lots.length > 0) || a[0].localeCompare(b[0])).map(([k, x]) => `<tr${x.lots.length ? '' : ' style="opacity:.6"'}><td><b>${x.acc}</b> · ${esc(x.sub)}<div class="x">${x.lots.length ? 'aktivní' : 'ukončený'}</div></td>
            <td><input type="text" list="invPeople" data-plan="${esc(k)}" value="${esc(x.name || '')}" placeholder="např. Mikuláš" style="width:150px"></td>
            <td class="amt">${fmt.num(x.vlozeno)} ${x.acc}</td><td class="amt">${fmt.num(x.vybrano)} ${x.acc}</td><td class="amt">${x.lots.length}</td><td class="d">${fmt.date(x.od)} – ${fmt.date(x.do)}</td></tr>`).join('')}
          </tbody></table></div><datalist id="invPeople"><option value="Mikuláš"><option value="Maruška"><option value="Korbelovi"></datalist>
          <p class="muted" style="font-size:12px;margin-bottom:0">Výsledek = dnešní hodnota + vybrané peníze − vložené peníze, v dnešním kurzu. Pozice se plánům přiřazují podle výpisu otevřených pozic z XTB. Plán, který jste zrušili a peníze převedli zpět na hlavní účet, je označený jako ukončený.</p></section>`;
      }
      function accounts(c) {
        const A = Object.entries(d.cash || {}); if (!A.length) return '';
        const r = k => d.fx[k] || 1, cz = (v, k) => fmt.czk(v * r(k));
        const net = A.reduce((s, [k, x]) => s + (x.vklady - x.vybery) * r(k), 0), cash = A.reduce((s, [k, x]) => s + (x.zustatek || 0) * r(k), 0);
        const total = c.value + cash, res = total - net;
        const n2 = (v, k) => `${fmt.num(v)} ${k}`;
        return `<section class="panel"><div class="phead"><h2>Účty XTB</h2><span class="muted">stav podle posledního importu</span></div>
          <div class="kpis" style="margin-bottom:14px">
            <div class="kpi"><span class="lbl">Čistý vklad z banky</span><span class="v">${fmt.czk(net)}</span><span class="s">vklady − výběry</span></div>
            <div class="kpi"><span class="lbl">Hotovost na účtech</span><span class="v">${fmt.czk(cash)}</span><span class="s">přepočet dnešním kurzem</span></div>
            <div class="kpi"><span class="lbl">Celkem v XTB</span><span class="v">${fmt.czk(total)}</span><span class="s">portfolio + hotovost</span></div>
            <div class="kpi"><span class="lbl">Celkový výsledek</span><span class="v ${res >= 0 ? 'inc' : 'exp'}">${res > 0 ? '+' : ''}${fmt.czk(res)}</span><span class="s">${net > 0 ? fmt.pct(res / net * 100) + ' z čistého vkladu' : ''}</span></div></div>
          <div class="tablebox"><table><thead><tr><th>Účet</th><th class="amt">Vklady</th><th class="amt">Výběry</th><th class="amt">Převody přijaté</th><th class="amt">Převody odeslané</th><th class="amt">Úroky po dani</th><th class="amt">CFD</th><th class="amt">Hotovost</th></tr></thead><tbody>
          ${A.map(([k, x]) => `<tr><td><b>${k}</b><div class="x">${esc(x.ucet || '')}${x.k ? ' · ' + fmt.date(x.k) : ''}</div></td><td class="amt">${n2(x.vklady, k)}</td><td class="amt">${n2(x.vybery, k)}</td>
            <td class="amt">${n2(x.prevodyIn, k)}</td><td class="amt">${n2(x.prevodyOut, k)}</td><td class="amt">${n2(x.uroky - x.danUroky, k)}</td>
            <td class="amt ${x.cfd < 0 ? 'exp' : x.cfd > 0 ? 'inc' : ''}">${x.cfd ? n2(x.cfd, k) : '—'}</td><td class="amt">${x.zustatek != null ? n2(x.zustatek, k) : '—'}<div class="x">${k !== 'CZK' && x.zustatek ? cz(x.zustatek, k) : ''}</div></td></tr>`).join('')}
          </tbody></table></div>
          <p class="muted" style="font-size:12px;margin-bottom:0">Převody jsou směny mezi vašimi účty CZK, USD a EUR. Celkový výsledek zahrnuje zisky z prodejů, dividendy, úroky i výsledek CFD. Nahrajte všechny tři účty, ať sedí čistý vklad i hotovost.</p></section>`;
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
            ${tx.wht ? `<div class="taxrow"><span>Daň sražená u zdroje (dividendy)</span><b>${fmt.czk(tx.wht)}</b></div>` : ''}
            <p class="muted" style="font-size:12px">Orientační výpočet: prodej se páruje s nákupem stejně jako v XTB (u ručních transakcí nejstarší nákup první), v kurzech uložených u transakcí. Nejde o daňové poradenství. Pravidla ověřte u daňového poradce nebo na webu Finanční správy.</p>
            ${tx.r.length ? `<div class="lbl" style="margin-top:8px">Prodeje ${y} podle titulů</div>${Object.entries(tx.r.reduce((g, x) => ((g[x.ticker] = g[x.ticker] || []).push(x), g), {})).map(([k, L]) => { const z = L.reduce((s, x) => s + x.proceeds - x.cost - x.fee, 0), ex = L.every(x => x.exempt), mix = !ex && L.some(x => x.exempt);
              return `<details class="taxrow" style="display:block"><summary style="display:flex;justify-content:space-between;gap:10px;cursor:pointer"><span><b style="font-family:var(--f-body)">${esc(k)}</b> · ${L.length} ${L.length === 1 ? 'lot' : L.length < 5 ? 'loty' : 'lotů'} · výnos ${fmt.czk(L.reduce((s, x) => s + x.proceeds, 0))}</span><span><span class="pill ${ex ? 'ok' : 'warn'}">${ex ? 'test splněn' : mix ? 'část do 3 let' : 'do 3 let'}</span> <b class="${z >= 0 ? 'inc' : 'exp'}">${fmt.czk(z)}</b></span></summary>
              ${L.map(x => `<div class="taxrow" style="padding-left:12px"><span>${fmt.num(x.qty, 4)} ks · koupeno ${fmt.date(x.buy)} · prodáno ${fmt.date(x.sell)}</span><span><span class="pill ${x.exempt ? 'ok' : 'warn'}">${x.exempt ? 'test splněn' : 'do 3 let'}</span> <b>${fmt.czk(x.proceeds - x.cost - x.fee)}</b></span></div>`).join('')}</details>` }).join('')}` : ''}
          </section></div>`;
      }

      function viewTrades() {
        const list = [...d.txs].sort((a, b) => b.date.localeCompare(a.date));
        const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
        return `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <label class="drop" id="xtbDrop"><span><strong>Import z XTB</strong> <small>— přetáhněte sem export historie účtu (XLSX) nebo klikněte. Každý účet (CZK, USD, EUR) exportujte a nahrajte zvlášť. V xStation 5: Historie účtu → období od založení účtu → Export.</small></span>
            <span class="btn primary">Vybrat soubor</span><input type="file" id="xtbIn" accept=".xlsx,.xls,.csv" hidden></label>
          <div id="xtbPrev"></div>
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
            <td><b>${esc(t.ticker)}</b>${t.xtb ? ' <span class="pill dim">XTB</span>' : ''}</td><td class="amt">${t.type === 'div' ? '—' : fmt.num(t.qty, 4)}</td><td class="amt">${fmt.num(t.price)} ${t.ccy}</td>
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
        root.querySelectorAll('[data-own]').forEach(b => b.onclick = () => { owner = b.dataset.own; draw() });
        root.querySelectorAll('[data-plan]').forEach(i => i.onchange = () => { d.plans[i.dataset.plan].name = i.value.trim(); save(); setTimeout(draw); ctx.toast('Plán pojmenován.') });
        root.querySelectorAll('[data-px]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (v > 0) { d.prices[i.dataset.px] = { price: v, date: App.today() }; save(); draw(); ctx.toast(`Cena ${i.dataset.px} aktualizována.`) } });
        root.querySelectorAll('[data-fx]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (v > 0) { d.fx[i.dataset.fx] = v; save(); ctx.toast('Kurz uložen.') } });
        const nf = $('#fxNew'); if (nf) nf.onchange = () => { const k = nf.value.trim().toUpperCase(); if (/^[A-Z]{3}$/.test(k) && !d.fx[k]) { d.fx[k] = 1; save(); draw() } };
        const w = $('#invWipe'); if (w) armed(w, () => { d = { sample: false, txs: [], fx: d.fx, prices: {} }; save(); draw(); ctx.toast('Data investic smazána.') });
        root.querySelectorAll('[data-del]').forEach(b => armed(b, () => { d.txs = d.txs.filter(t => t.id !== b.dataset.del); save(); draw() }));
        const xd = $('#xtbDrop');
        if (xd) {
          const go = async file => {
            if (!file) return;
            try { pending = await readXTB(file); pending.file = file.name; pending.accFound = !!pending.acc; showPrev() } catch (e) { ctx.toast(e.message) }
          };
          $('#xtbIn').onchange = e => go(e.target.files[0]);
          ['dragenter', 'dragover'].forEach(ev => xd.addEventListener(ev, e => { e.preventDefault(); xd.classList.add('over') }));
          ['dragleave', 'drop'].forEach(ev => xd.addEventListener(ev, e => { e.preventDefault(); xd.classList.remove('over') }));
          xd.addEventListener('drop', e => go(e.dataTransfer.files[0]));
          if (pending) showPrev();
        }
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
      function showPrev() {
        const P = pending; P.acc = P.acc || 'CZK';
        const conv = mergeConv(d.conv, P.conv);
        const all = toCZK(P, P.acc, d.fx, conv), have = new Set(d.sample ? [] : d.txs.filter(t => t.xtb).map(t => t.xtb));
        const fresh = all.filter(t => !have.has(t.xtb)), dup = all.length - fresh.length;
        const yrs = [...new Set(fresh.map(t => t.date.slice(0, 4)))].filter(y => P.acc !== 'CZK' && !(JK[y] || {})[P.acc]);
        // kontrola: kusy z importu tohoto účtu vs. otevřené pozice ve výpisu
        const net = {}; [...(d.sample ? [] : d.txs.filter(t => t.acc === P.acc)), ...fresh].forEach(t => { if (t.type === 'buy') net[t.ticker] = (net[t.ticker] || 0) + t.qty; if (t.type === 'sell') net[t.ticker] = (net[t.ticker] || 0) - t.qty });
        const bad = [...new Set([...Object.keys(net), ...Object.keys(P.open)])].filter(k => Math.abs((net[k] || 0) - (P.open[k] || 0)) > 1e-3);
        const n = k => fresh.filter(t => t.type === k).length;
        const manual = d.sample ? [] : d.txs.filter(t => !t.xtb && fresh.some(x => x.ticker === t.ticker));
        const sk = Object.entries(P.skipped).map(([k, v]) => `${k} ${v}×`).join(', ');
        const span = fresh.length ? `${fmt.date(fresh.reduce((a, t) => t.date < a ? t.date : a, fresh[0].date))} – ${fmt.date(fresh.reduce((a, t) => t.date > a ? t.date : a, fresh[0].date))}` : '';
        $('#xtbPrev').innerHTML = `<section class="panel imp"><div class="phead"><h2>Náhled importu</h2><span class="muted">${esc(P.file)} · list ${esc(P.sheet)}</span></div>
          <div class="kpis" style="margin-bottom:12px">
            <div class="kpi"><span class="lbl">Nákupy</span><span class="v">${n('buy')}</span></div>
            <div class="kpi"><span class="lbl">Prodeje</span><span class="v">${n('sell')}</span></div>
            <div class="kpi"><span class="lbl">Dividendy</span><span class="v">${n('div')}</span><span class="s">${P.wht ? 'sražená daň ' + fmt.czk(P.wht) : ''}</span></div>
            <div class="kpi"><span class="lbl">Aktuální ceny</span><span class="v">${Object.keys(P.prices).length}</span><span class="s">z otevřených pozic</span></div></div>
          <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px"><label class="field" style="width:140px">Účet v měně<select id="xtbAcc">${['CZK', 'USD', 'EUR'].map(c => `<option${c === P.acc ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
            <p class="muted" style="margin:0 0 4px;font-size:13px;flex:1;min-width:220px">${P.accFound ? 'Zjištěno z výpisu.' : '<span style="color:var(--warn)">Měnu jsem ve výpisu nenašel, zkontrolujte ji.</span>'} ${P.acc === 'CZK' ? 'Kurz se počítá z částky v Kč, včetně poplatku za směnu.' : `Částky v ${P.acc} se přepočtou na Kč jednotným kurzem GFŘ za daný rok${yrs.length ? ` (pro rok ${yrs.join(', ')} průměrem vašich směn v XTB: ${czkRate(P.acc, yrs[0] + '-01-01', d.fx, conv)} Kč)` : ''}.`}</p></div>
          <p class="muted" style="margin:0 0 6px">${span ? 'Období ' + span + '. ' : ''}${dup ? `Už importováno dříve: ${dup} (přeskočím). ` : ''}${sk ? `Nepotřebné operace: ${sk}. ` : ''}${P.unknown.length ? `<span style="color:var(--warn)">Nerozpoznáno ${P.unknown.length} řádků, např. „${esc(P.unknown[0])}“.</span>` : ''}</p>
          ${P.plans?.length ? `<p class="muted" style="margin:0 0 6px">Investiční plány: ${P.plans.length} (${P.plans.filter(x => x.lots.length).length} s otevřenými pozicemi). Pojmenujete je po importu v záložce Pozice.</p>` : ''}
          <p style="margin:0 0 6px;color:var(--${bad.length ? 'warn' : 'inc'})">${bad.length ? `Kontrola kusů nesedí u: ${bad.map(k => `${esc(k)} (import ${fmt.num(net[k] || 0, 4)}, výpis ${fmt.num(P.open[k] || 0, 4)})`).join(', ')}.` : `Kontrola: držené kusy sedí s otevřenými pozicemi ve výpisu (${Object.keys(P.open).length} titulů).`}</p>
          ${d.sample ? '<p class="muted" style="margin:0 0 6px">Ukázková data se nahradí vašimi.</p>' : ''}
          ${manual.length ? `<p style="margin:0 0 6px;color:var(--warn)">Pro stejné tituly máte ${manual.length} ručně zadaných transakcí. Pokud jde o tytéž obchody, započítaly by se dvakrát.</p>` : ''}
          <div class="acts">${true ? `<button class="btn primary" id="xtbGo">Importovat ${fresh.length} transakcí</button>` : '<span class="muted">Nic nového k importu.</span>'}
          ${manual.length ? `<button class="btn" id="xtbGoRepl">Importovat a smazat ruční u těchto titulů</button>` : ''}<button class="btn" id="xtbNo">Zrušit</button></div></section>`;
        const run = repl => {
          if (d.sample) d = { sample: false, txs: [], fx: d.fx, prices: {} };
          d.conv = conv; d.cash = d.cash || {}; d.cash[P.acc] = { ...P.cash, ucet: P.account, k: App.today() };
          // investiční plány tohoto účtu: přepsat stav, ponechat jména
          const old = d.plans || {}; d.plans = Object.fromEntries(Object.entries(old).filter(([k]) => !k.startsWith(P.acc + ':')));
          (P.plans || []).forEach(x => { const k = P.acc + ':' + x.sub; d.plans[k] = { ...x, acc: P.acc, lots: x.lots.map(l => P.acc + ':' + l), name: old[k]?.name || '' } });
          d.planPos = {}; Object.entries(d.plans).forEach(([k, x]) => x.lots.forEach(l => d.planPos[l] = k));
          const lc = {}; conv.forEach(x => { if (!lc[x.ccy] || x.date > lc[x.ccy].date) lc[x.ccy] = x }); for (const [c, x] of Object.entries(lc)) d.fx[c] = x.rate;   // aktuální kurz = poslední směna
          if (repl) { const tk = new Set(fresh.map(t => t.ticker)); d.txs = d.txs.filter(t => t.xtb || !tk.has(t.ticker)) }
          fresh.forEach(t => d.txs.push({ id: uid(), ...t }));
          // kurz měny = poslední kurz z importu, pokud ho nemáte zadaný
          const lastFx = {}; fresh.filter(t => t.type !== 'div' && t.acc === 'CZK').sort((a, b) => a.date.localeCompare(b.date)).forEach(t => lastFx[t.ccy] = t.fx);
          for (const [c, v] of Object.entries(lastFx)) if (!d.fx[c] || d.fx[c] === FX0[c] || d.fx[c] === 1) d.fx[c] = v;
          for (const [k, v] of Object.entries(P.prices)) d.prices[k] = { price: v, date: App.today() };
          pending = null; save(); draw(); ctx.toast(`Importováno ${fresh.length} transakcí z XTB.`);
        };
        const g = $('#xtbGo'); if (g && !fresh.length) g.textContent = 'Uložit ceny a stav účtu'; if (g) g.onclick = () => run(false);
        const gr = $('#xtbGoRepl'); if (gr) gr.onclick = () => run(true);
        $('#xtbNo').onclick = () => { pending = null; $('#xtbPrev').innerHTML = '' };
        $('#xtbAcc').onchange = e => { P.acc = e.target.value; showPrev() };
      }
      function armed(btn, fn) { btn.onclick = () => { if (btn.classList.contains('armed')) fn(); else { const o = btn.textContent; btn.classList.add('armed'); btn.textContent = 'Opravdu?'; setTimeout(() => { btn.classList.remove('armed'); btn.textContent = o }, 4000) } } }

      draw();
    }
  });
})();
