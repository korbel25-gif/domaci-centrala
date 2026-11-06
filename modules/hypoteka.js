/* =====================================================================
   MODUL: Hypotéka
   Úvěry (zatím hypotéka na pozemek, později třeba na stavbu): splátkový
   kalendář, zůstatek, konec fixace, úroky a jejich odpočet z daní,
   simulace sazby po fixaci a mimořádných splátek, kontrola splátek ve
   výpisech z Rozpočtu.
   Data: App.store('hypoteka') → 'loans' (pole úvěrů), 'sel' (vybraný)
   Osobní údaje se zadávají v aplikaci, v kódu nejsou.
   ===================================================================== */
(function () {
  const { esc, fmt } = App;

  App.css('hypoteka', `
  .hy-top{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}
  @media (max-width:900px){.hy-top{grid-template-columns:1fr}}
  .hy-chart svg{width:100%;height:220px;display:block;overflow:visible}
  .hy-chart .ax{font:10px var(--f-mono);fill:var(--muted)}
  .hy-chart .bal{fill:none;stroke:var(--accent);stroke-width:2.2;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 4px rgba(46,240,255,.5))}
  .hy-chart .area{fill:url(#hyG)}
  .hy-chart .now{stroke:var(--warn);stroke-dasharray:4 4;stroke-width:1.5}
  .hy-chart .fix{stroke:var(--exp);stroke-dasharray:2 4;stroke-width:1.5}
  .hy-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}
  .hy-legend i{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;margin-right:6px}
  .hy-sim{display:flex;flex-direction:column;gap:10px}
  .hy-sim input[type=range]{width:100%;accent-color:var(--accent)}
  .hy-sim .big{font:700 26px var(--f-mono);color:var(--accent)}
  .hy-loans{display:flex;gap:8px;flex-wrap:wrap}
  .hy-years td,.hy-years th{white-space:nowrap}
  .hy-years tr.cur td{background:var(--accent-soft)}
  .hy-ok{color:var(--inc)} .hy-bad{color:var(--exp)} .hy-warn{color:var(--warn)}
  `);

  /* ---------- výpočty ---------- */
  const DAY = 864e5;
  const dt = s => new Date(s + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const addM = (s, n, day) => { const d = dt(s); const y = d.getUTCFullYear(), m = d.getUTCMonth() + n; const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(day || d.getUTCDate(), last)))) };
  const days = (a, b) => Math.round((dt(b) - dt(a)) / DAY);
  const annuity = (L, rPct, n) => { const r = rPct / 1200; return n <= 0 ? L : r ? L * r / (1 - Math.pow(1 + r, -n)) : L / n };
  const round2 = v => Math.round(v * 100) / 100;

  /** Splátkový kalendář jako v bance: úrok se počítá denně (ACT/360) za kalendářní měsíc, zaúčtuje se
      poslední den měsíce a zaplatí se v nejbližší anuitní splátce (ta = úrok + zbytek na jistinu).
      Před první anuitní splátkou (období čerpání) se úrok platí hned na konci měsíce.
      Respektuje skutečné úroky z výpisů (L.uroky), změny sazby a mimořádné splátky. */
  function schedule(L, opt = {}) {
    const out = []; if (!(+L.castka > 0 && L.cerpani && (+L.roky > 0 || L.konec))) return out;
    const day = +L.den || dt(L.cerpani).getUTCDate();
    const first = L.prvniSplatka && L.prvniSplatka > L.cerpani ? L.prvniSplatka : addM(L.cerpani, 1, day);
    const mdiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
    const n0 = L.konec && L.konec > first ? mdiff(first, L.konec) + 1 : Math.round((+L.roky || 0) * 12);
    const rates = [...(L.sazby || [])].filter(x => x.od && +x.sazba >= 0).sort((a, b) => a.od.localeCompare(b.od));
    const extras = [...(L.mimoradne || []), ...(opt.extra || [])].filter(x => x.date && +x.castka > 0).sort((a, b) => a.date.localeCompare(b.date));
    const U = L.uroky || {};
    const rateAt = d => { let r = +L.sazba; for (const x of rates) if (x.od <= d) r = +x.sazba; if (opt.rateAfterFix != null && L.fixaceDo && d > L.fixaceDo) r = opt.rateAfterFix; return r };
    const k = +L.splatkaBanka > 0 ? +L.splatkaBanka / annuity(+L.castka, +L.sazba, n0) : 1;   // kalibrace na výpočet banky
    let P = +L.castka, rate = +L.sazba, nLeft = n0, pay = +L.splatkaBanka > 0 ? +L.splatkaBanka : annuity(P, rate, nLeft);
    let due = 0, dueAct = false, cur = L.cerpani, ms = L.cerpani.slice(0, 8) + '01', ei = 0;
    for (let it = 0; it < 900 && (P > 0.005 || due > 0.005); it++) {
      const me = iso(new Date(Date.UTC(+ms.slice(0, 4), +ms.slice(5, 7), 0))), payD = addM(ms, 0, day), ym = ms.slice(0, 7);
      let acc = 0; const r0 = rateAt(ms);
      if (payD >= first && payD > cur && payD <= me && nLeft > 0) {
        acc += P * r0 / 36000 * days(cur, payD);
        while (ei < extras.length && extras[ei].date <= payD) {   // mimořádná splátka (zjednodušeně ke dni splátky)
          const x = extras[ei++], amt = Math.min(P, +x.castka); P -= amt;
          out.push({ date: x.date, extra: amt, interest: 0, principal: amt, pay: amt, bal: round2(P), rate });
          if (x.rezim === 'splatka') pay = annuity(P, rate, nLeft) * k;
        }
        const r = rateAt(payD); if (r !== rate) { rate = r; pay = annuity(P, rate, nLeft) * k }   // nová fixace → nová splátka
        let interest = round2(due); let principal = nLeft <= 1 ? P : Math.min(P, Math.max(0, pay - interest));
        if (P - principal <= 0.005) { interest = round2(interest + acc); acc = 0 }   // poslední splátka: doplatí i úrok za poslední dny
        P -= principal; nLeft--;
        out.push({ date: payD, interest, principal: round2(principal), pay: round2(interest + principal), bal: round2(Math.max(0, P)), rate, actual: dueAct });
        due = 0; dueAct = false; cur = payD;
      }
      acc += P * r0 / 36000 * (days(cur, me) + 1);
      const posted = U[ym] != null ? +U[ym] : round2(acc);
      if (me < first) out.push({ date: me, interest: posted, principal: 0, pay: posted, bal: round2(P), rate: r0, io: true, actual: U[ym] != null });
      else { due += posted; dueAct = U[ym] != null }
      cur = addM(ms, 1, 1); ms = cur;
      if (P <= 0.005 && nLeft <= 0 && due > 0.005) { out.push({ date: addM(ms, 0, day), interest: round2(due), principal: 0, pay: round2(due), bal: 0, rate }); due = 0 }
    }
    return out;
  }
  function stats(L, opt) {
    const S = schedule(L, opt), td = App.today(), y = td.slice(0, 4);
    const past = S.filter(x => x.date <= td), fut = S.filter(x => x.date > td);
    const bal = past.length ? past[past.length - 1].bal : +L.castka || 0;
    const reg = S.filter(x => !x.extra);
    const nextPay = fut.find(x => !x.extra);
    const sumI = a => a.reduce((s, x) => s + x.interest, 0);
    const byYear = {};
    for (const x of S) { const k = x.date.slice(0, 4), Y = byYear[k] || (byYear[k] = { rok: k, urok: 0, umor: 0, mimo: 0, zustatek: 0 }); Y.urok += x.interest; if (x.extra) Y.mimo += x.extra; else Y.umor += x.principal; Y.zustatek = x.bal }
    return {
      S, bal, nextPay, pay: (fut.find(x => !x.extra && !x.io) || reg[reg.length - 1] || {}).pay || 0, curPay: (nextPay || {}).pay || 0, ioUntil: nextPay?.io ? S.find(x => !x.io && !x.extra)?.date : null, last: S[S.length - 1]?.date,
      paidPrincipal: (+L.castka || 0) - bal, interestPaid: sumI(past), interestYear: sumI(S.filter(x => x.date.startsWith(y))), interestTotal: sumI(S),
      years: Object.values(byYear), fixDays: L.fixaceDo ? days(td, L.fixaceDo) : null,
      balAtFix: L.fixaceDo ? (S.filter(x => x.date <= L.fixaceDo).pop()?.bal ?? +L.castka) : null
    };
  }
  /* daně: odpočet úroků (§ 15 odst. 3 ZDP) */
  const deductLimit = L => (L.smlouva || L.cerpani || '9999') >= '2021-01-01' ? 150000 : 300000;
  function stavbaStart() {   // začátek stavby podle harmonogramu v modulu Dům (fáze „Stavba“)
    try { const d = App.store('dum').get('data', null); const t = (d?.tasks || []).filter(x => x.ph === 'stav').sort((a, b) => a.start.localeCompare(b.start))[0]; return t ? { date: t.start, name: t.name, done: t.done } : null } catch (e) { return null }
  }
  /* splátky ve výpisech z Rozpočtu */
  function bankPayments(pay) {
    let s; try { s = JSON.parse(App.raw.get('rodinny-rozpocet-v1') || 'null') } catch (e) { s = null }
    if (!s?.tx?.length || !pay) return null;
    const nt = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hit = s.tx.filter(t => t.amount < 0 && (Math.abs(-t.amount - pay) <= Math.max(2, pay * 0.01) || /hypot|uver/.test(nt(t.party + ' ' + t.desc))));
    const months = new Set(hit.map(t => t.date.slice(0, 7)));
    return { n: hit.length, months: months.size, last: hit.map(t => t.date).sort().pop(), sample: !!s.sample };
  }

  /* ---------- úložiště ---------- */
  const NEW = () => ({ id: 'u' + Date.now().toString(36), nazev: 'Hypotéka na pozemek', banka: '', ucel: 'pozemek', castka: 0, cerpani: '', smlouva: '', sazba: 0, roky: 30, den: 0, fixaceDo: '', prvniSplatka: '', konec: '', splatkaBanka: 0, pojisteni: 0, sazby: [], mimoradne: [], uroky: {} });
  const loadLoans = store => {
    let a = store.get('loans', null); if (!Array.isArray(a) || !a.length) return [NEW()];
    // úklid: stejný úvěr načtený vícekrát ze souboru → nechat poslední verzi; prázdné rozpracované pryč, když existuje vyplněný
    const key = L => +L.castka > 0 ? `${+L.castka}|${L.smlouva || L.cerpani || ''}` : '';
    const seen = new Map(); a.forEach((L, i) => { const k = key(L); if (k) seen.set(k, i) });
    const b = a.filter((L, i) => { const k = key(L); return k ? seen.get(k) === i : !a.some(x => key(x)) || i === 0 && false });
    const out = b.length ? b : [NEW()];
    if (out.length !== a.length) store.set('loans', out);
    return out;
  };
  const ready = L => +L.castka > 0 && +L.sazba >= 0 && +L.roky > 0 && !!L.cerpani;

  App.loanSchedule = schedule;   // pro kontrolu a další moduly

  /* splátky pro Pravidelné platby v Rozpočtu */
  App.loanPayments = () => {
    const td = App.today(), st = App.store('hypoteka');
    return loadLoans(st).filter(ready).map(L => { const s = stats(L); return { L, s } }).filter(({ L, s }) => L.cerpani <= td && s.last >= td.slice(0, 7))
      .map(({ L, s }) => ({ id: 'hyp-' + L.id, nazev: 'Splátka – ' + (L.nazev || 'úvěr'), castka: Math.round((s.curPay || s.pay) + (+L.pojisteni || 0)), alt: [Math.round(s.curPay || s.pay)], den: s.ioUntil ? 31 : (+L.den || +L.cerpani.slice(8)), freq: 'm', zpusob: 'trvaly', klic: '', pozn: L.banka || '' }));
  };

  App.register({
    id: 'hypoteka',
    name: 'Hypotéka',
    description: 'Úvěr na pozemek: zůstatek, splátkový kalendář, fixace, úroky a jejich odpočet z daní.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9.5 16.5l5-5"/><circle cx="10" cy="12" r="1"/><circle cx="14" cy="16" r="1"/></svg>',
    order: 9,

    tools(ctx) {
      const cur = () => { const a = loadLoans(ctx.store); return a.find(x => x.id === ctx.store.get('sel', '')) || a[0] };
      return [
        { name: 'mortgage_status', description: 'Stav hypotéky (úvěru na pozemek): zůstatek jistiny, měsíční splátka, sazba, konec fixace a počet dní do něj, zaplacené úroky letos i celkem, odhad odpočtu úroků z daní, datum poslední splátky.',
          run: () => { const L = cur(); if (!ready(L)) return { zadano: false, pozn: 'Hypotéka zatím není vyplněná v modulu Hypotéka.' }; const s = stats(L), lim = deductLimit(L);
            return { nazev: L.nazev, banka: L.banka, zustatek: Math.round(s.bal), splatka: Math.round(s.pay), pojisteni: +L.pojisteni || 0, sazba: L.sazba, fixace_do: L.fixaceDo, dni_do_konce_fixace: s.fixDays, zustatek_pri_konci_fixace: Math.round(s.balAtFix || 0), uroky_letos: Math.round(s.interestYear), uroky_zaplaceno_celkem: Math.round(s.interestPaid), uroky_za_celou_dobu: Math.round(s.interestTotal), odpocet_limit: lim, uspora_na_dani_letos: Math.round(Math.min(s.interestYear, lim) * 0.15), posledni_splatka: s.last } } },
        { name: 'mortgage_simulate', description: 'Simulace hypotéky: dopad mimořádné splátky (částka, kdy, zda zkrátit dobu nebo snížit splátku) a/nebo jiné sazby po konci fixace. Vrací novou splátku, úspору na úrocích a nové datum splacení.',
          inputSchema: { type: 'object', properties: { mimoradna: { type: 'number' }, datum: { type: 'string', description: 'YYYY-MM-DD, výchozí konec fixace' }, rezim: { type: 'string', enum: ['doba', 'splatka'] }, sazba_po_fixaci: { type: 'number' } } },
          run: inp => { const L = cur(); if (!ready(L)) throw new Error('Hypotéka není vyplněná.'); const base = stats(L, { rateAfterFix: inp.sazba_po_fixaci != null ? +inp.sazba_po_fixaci : null });
            const ex = +inp.mimoradna > 0 ? [{ date: inp.datum || L.fixaceDo || App.today(), castka: +inp.mimoradna, rezim: inp.rezim || 'doba' }] : [];
            const s = stats(L, { extra: ex, rateAfterFix: inp.sazba_po_fixaci != null ? +inp.sazba_po_fixaci : null }), after = s.S.find(x => !x.extra && x.date > (ex[0]?.date || L.fixaceDo || App.today()));
            return { splatka_pred: Math.round(base.pay), splatka_po: Math.round(after?.pay || 0), uroky_celkem_pred: Math.round(base.interestTotal), uroky_celkem_po: Math.round(s.interestTotal), uspora_na_urocich: Math.round(base.interestTotal - s.interestTotal), splaceno_pred: base.last, splaceno_po: s.last } } }
      ];
    },

    widget(el, ctx) {
      const a = loadLoans(ctx.store), L = a.find(x => x.id === ctx.store.get('sel', '')) || a[0];
      if (!ready(L)) { el.innerHTML = `<div class="wnums"><div><span>Hypotéka</span><b>—</b></div></div><span class="wnote">Zadejte údaje z úvěrové smlouvy v modulu.</span>`; return }
      const s = stats(L), p = s.paidPrincipal / L.castka;
      el.innerHTML = `<div class="wnums"><div><span>Zbývá splatit</span><b data-count="${Math.round(s.bal)}"></b></div><div><span>Splátka</span><b>${fmt.czk(s.pay + (+L.pojisteni || 0))}</b></div>
        <div><span>Konec fixace</span><b class="${s.fixDays != null && s.fixDays < 180 ? 'exp' : ''}">${s.fixDays != null ? (s.fixDays >= 0 ? s.fixDays + ' dní' : 'skončila') : '—'}</b></div></div>
        <div class="meter ok"><b style="width:${Math.max(1, p * 100)}%"></b></div><span class="wnote">Splaceno ${fmt.pct(p * 100)} jistiny · úroky letos ${fmt.czk(s.interestYear)}</span>`;
    },

    mount(root, ctx) {
      let loans = loadLoans(ctx.store), sel = ctx.store.get('sel', loans[0].id), simRate = null, exAmt = 100000, exMode = 'doba', edit = false, allYears = false;
      const L = () => loans.find(x => x.id === sel) || loans[0];
      const save = () => { ctx.store.set('loans', loans); ctx.store.set('sel', sel) };
      const $ = s => root.querySelector(s);

      function draw() {
        const l = L(), ok = ready(l);
        root.innerHTML = `<div class="mw">
          ${loans.length > 1 || ok ? `<div class="hy-loans">${loans.map(x => `<button class="btn sm${x.id === l.id ? ' primary' : ''}" data-loan="${x.id}">${esc(x.nazev || 'Úvěr')}</button>`).join('')}<button class="btn sm" id="hyAdd">+ Další úvěr</button></div>` : ''}
          ${ok && !edit ? overview(l) : ''}
          ${form(l, !ok || edit)}
        </div>`;
        wire(l); App.countUp(root);
      }

      function overview(l) {
        const s = stats(l), fixS = simRate != null ? stats(l, { rateAfterFix: simRate }) : null, td = App.today(), y = td.slice(0, 4);
        const lim = deductLimit(l), ded = Math.min(s.interestYear, lim), st = l.ucel === 'pozemek' ? stavbaStart() : null;
        const limitDate = l.ucel === 'pozemek' && (l.smlouva || l.cerpani) ? addM(l.smlouva || l.cerpani, 48) : null;
        const bp = bankPayments(s.pay);
        const afterFix = simRate ?? +l.sazba, fixPay = fixS ? (fixS.S.find(x => !x.extra && l.fixaceDo && x.date > l.fixaceDo)?.pay || 0) : s.pay;
        const exS = stats(l, { extra: [{ date: l.fixaceDo && l.fixaceDo > td ? l.fixaceDo : td, castka: exAmt, rezim: exMode }] });
        const exNext = exS.S.find(x => !x.extra && x.date > (l.fixaceDo && l.fixaceDo > td ? l.fixaceDo : td));
        return `
          <div class="kpis">
            <div class="kpi"><span class="lbl">Zbývá splatit</span><span class="v" data-count="${Math.round(s.bal)}"></span><span class="s">z ${fmt.czk(l.castka)} · splaceno ${fmt.pct(s.paidPrincipal / l.castka * 100)}</span></div>
            <div class="kpi"><span class="lbl">Měsíční splátka</span><span class="v">${fmt.czk(s.pay)}</span><span class="s">${s.ioUntil ? `teď jen úroky ~${fmt.czk(s.curPay)} · anuita od ${fmt.date(s.ioUntil)} · ` : ''}${+l.pojisteni ? `+ pojištění ${fmt.czk(l.pojisteni)} · ` : ''}sazba ${fmt.num(l.sazba, 2)} %${s.nextPay ? ` · další ${fmt.date(s.nextPay.date)}` : ''}</span></div>
            <div class="kpi"><span class="lbl">Konec fixace</span><span class="v ${s.fixDays != null && s.fixDays < 180 ? 'exp' : ''}">${s.fixDays == null ? '—' : s.fixDays >= 0 ? s.fixDays + ' dní' : 'skončila'}</span><span class="s">${l.fixaceDo ? fmt.date(l.fixaceDo) + ` · zůstatek ${fmt.czk(s.balAtFix)}` : 'doplňte v nastavení'}</span></div>
            <div class="kpi"><span class="lbl">Úroky ${y}</span><span class="v">${fmt.czk(s.interestYear)}</span><span class="s">zaplaceno celkem ${fmt.czk(s.interestPaid)} · za celou dobu ${fmt.czk(s.interestTotal)}</span></div>
          </div>
          <div class="hy-top">
            <section class="panel hy-chart"><div class="phead"><h2>Průběh splácení</h2><span class="muted">poslední splátka ${fmt.date(s.last)}</span></div>${chart(l, s, fixS)}
              <div class="hy-legend"><span><i style="border-color:var(--accent)"></i>zůstatek jistiny</span><span><i style="border-color:var(--warn);border-top-style:dashed"></i>dnes</span>${l.fixaceDo ? '<span><i style="border-color:var(--exp);border-top-style:dotted"></i>konec fixace</span>' : ''}${fixS ? `<span><i style="border-color:var(--muted);border-top-style:dashed"></i>sazba ${fmt.num(simRate, 2)} % po fixaci</span>` : ''}</div></section>
            <section class="panel"><div class="phead"><h2>Odpočet úroků z daní</h2><span class="pill ${st && limitDate && st.date > limitDate ? 'bad' : 'ok'}">${y}</span></div>
              <div class="taxrow"><span>Úroky zaplacené v roce ${y}${(() => { const A = s.S.filter(x => x.date.startsWith(y) && !x.extra && x.interest > 0), n = A.filter(x => x.actual).length; return `<br><span class="muted" style="font-size:12px">${n ? `${n} z ${A.length} měsíců podle výpisů, zbytek odhad` : 'odhad – doplňte úroky z výpisů'}</span>` })()}</span><b>${fmt.czk(s.interestYear)}</b></div>
              <div class="taxrow"><span>Roční limit odpočtu</span><b>${fmt.czk(lim)}</b></div>
              <div class="taxrow"><span>Odečtete ze základu daně</span><b>${fmt.czk(ded)}</b></div>
              <div class="taxrow"><span>Ušetříte na dani (15 %)</span><b class="hy-ok">${fmt.czk(ded * 0.15)}</b></div>
              ${l.ucel === 'pozemek' ? `<div class="taxrow" style="display:block"><span>Podmínka u pozemku: stavba musí začít do 4 let od uzavření smlouvy, tj. do <b>${limitDate ? fmt.date(limitDate) : '— doplňte datum smlouvy'}</b>.</span>
                ${st ? `<div class="${limitDate && st.date <= limitDate ? 'hy-ok' : 'hy-bad'}" style="margin-top:4px">Podle harmonogramu v modulu Dům začíná stavba ${fmt.date(st.date)} (${esc(st.name)})${limitDate ? (st.date <= limitDate ? ` – rezerva ${days(st.date, limitDate)} dní.` : ' – to je po lhůtě!') : '.'}</div>` : ''}</div>` : ''}
              <p class="muted" style="font-size:12px;margin-bottom:0">Odpočet podle § 15 ZDP. Úroky se rozdělí mezi všechny dlužníky, kteří odpočet uplatňují (dohromady max. limit). Potvrzení o zaplacených úrocích vydá banka po skončení roku. Orientační výpočet, nejde o daňové poradenství.</p></section>
          </div>
          <div class="grid2">
            <section class="panel hy-sim"><div class="phead"><h2>Co po fixaci</h2><span class="muted">${l.fixaceDo ? 'od ' + fmt.date(l.fixaceDo) : 'zadejte konec fixace'}</span></div>
              <label class="field">Sazba po fixaci: <b id="hySimV">${fmt.num(afterFix, 2)} %</b><input type="range" id="hySim" min="2" max="9" step="0.05" value="${afterFix}" ${l.fixaceDo ? '' : 'disabled'}></label>
              <div class="taxrow"><span>Splátka po fixaci</span><span class="big">${fmt.czk(fixPay)}</span></div>
              <div class="taxrow"><span>Rozdíl proti dnešku</span><b class="${fixPay > s.pay ? 'hy-bad' : 'hy-ok'}">${fixPay >= s.pay ? '+' : ''}${fmt.czk(fixPay - s.pay)} měsíčně</b></div>
              <div class="taxrow"><span>Úroky za celou dobu</span><b>${fmt.czk((fixS || s).interestTotal)}</b></div>
              <p class="muted" style="font-size:12px;margin:0">Ke konci fixace můžete bez poplatku splatit libovolnou část úvěru nebo přejít k jiné bance. Nabídku si vyžádejte zhruba 3–6 měsíců předem.</p></section>
            <section class="panel hy-sim"><div class="phead"><h2>Mimořádná splátka</h2><span class="muted">${l.fixaceDo && l.fixaceDo > td ? 'ke konci fixace (zdarma)' : 'dnes'}</span></div>
              <div class="fgrid"><label class="field">Částka<input type="number" id="hyEx" step="10000" min="0" value="${exAmt}"></label>
                <label class="field">Po splátce<select id="hyExM"><option value="doba"${exMode === 'doba' ? ' selected' : ''}>zkrátit dobu splácení</option><option value="splatka"${exMode === 'splatka' ? ' selected' : ''}>snížit měsíční splátku</option></select></label></div>
              <div class="taxrow"><span>Ušetříte na úrocích</span><span class="big">${fmt.czk(s.interestTotal - exS.interestTotal)}</span></div>
              <div class="taxrow"><span>${exMode === 'doba' ? 'Splaceno dřív' : 'Nová splátka'}</span><b class="hy-ok">${exMode === 'doba' ? `${fmt.date(exS.last)} (o ${Math.round(days(exS.last, s.last) / 30.44)} měsíců)` : fmt.czk(exNext?.pay || 0)}</b></div>
              <button class="btn sm" id="hyExAdd" style="align-self:flex-start">Zapsat jako provedenou splátku</button></section>
          </div>
          <section class="panel"><div class="phead"><h2>Splátky po letech</h2>${bp ? `<span class="muted">${bp.sample ? 'Rozpočet obsahuje ukázková data. ' : ''}Ve výpisech v Rozpočtu: ${bp.months} měsíců se splátkou${bp.last ? ', poslední ' + fmt.date(bp.last) : ''}</span>` : ''}</div>
            <div class="tablebox"><table class="hy-years"><thead><tr><th>Rok</th><th class="amt">Úmor jistiny</th><th class="amt">Mimořádně</th><th class="amt">Úroky</th><th class="amt">Zaplaceno celkem</th><th class="amt">Zůstatek na konci roku</th></tr></thead><tbody>
            ${s.years.filter(Y => allYears || +Y.rok <= +y + 4).map(Y => `<tr class="${Y.rok === y ? 'cur' : ''}"><td>${Y.rok}</td><td class="amt">${fmt.czk(Y.umor)}</td><td class="amt">${Y.mimo ? fmt.czk(Y.mimo) : '—'}</td><td class="amt">${fmt.czk(Y.urok)}</td><td class="amt">${fmt.czk(Y.umor + Y.mimo + Y.urok)}</td><td class="amt">${fmt.czk(Y.zustatek)}</td></tr>`).join('')}
            </tbody></table></div>${s.years.some(Y => +Y.rok > +y + 4) ? `<div class="more"><button class="btn sm" id="hyAllY">${allYears ? 'Skrýt další roky' : `Zobrazit všechny roky (do ${s.last.slice(0, 4)})`}</button></div>` : ''}</section>`;
      }

      function chart(l, s, fixS) {
        const W = 640, H = 200, P = 34, S = s.S.filter(x => !x.extra); if (!S.length) return '';
        const t0 = dt(l.cerpani).getTime(), t1 = dt((fixS && fixS.last > s.last ? fixS : s).last).getTime(), max = +l.castka;
        const X = d => P + (dt(d).getTime() - t0) / (t1 - t0) * (W - P - 6), Y = v => 6 + (1 - v / max) * (H - 26);
        const line = SS => `M${X(l.cerpani)},${Y(max)} ` + SS.map(x => `L${X(x.date).toFixed(1)},${Y(x.bal).toFixed(1)}`).join(' ');
        const yrs = []; for (let yy = +l.cerpani.slice(0, 4) + 1; yy <= +s.last.slice(0, 4); yy++) yrs.push(yy);
        const step = Math.ceil(yrs.length / 8);
        const td = App.today();
        return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Zůstatek jistiny v čase"><defs><linearGradient id="hyG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
          ${[0, .25, .5, .75, 1].map(f => `<line x1="${P}" x2="${W - 6}" y1="${Y(max * f)}" y2="${Y(max * f)}" stroke="var(--track)"/><text class="ax" x="${P - 4}" y="${Y(max * f) + 3}" text-anchor="end">${Math.round(max * f / 1000)}k</text>`).join('')}
          ${yrs.filter((_, i) => i % step === 0).map(yy => `<text class="ax" x="${X(yy + '-01-01')}" y="${H - 4}" text-anchor="middle">${yy}</text>`).join('')}
          <path class="area" d="${line(S)} L${X(S[S.length - 1].date)},${Y(0)} L${X(l.cerpani)},${Y(0)} Z"/>
          ${fixS ? `<path d="${line(fixS.S.filter(x => !x.extra))}" fill="none" stroke="var(--muted)" stroke-dasharray="5 4" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : ''}
          <path class="bal" d="${line(S)}"/>
          ${td > l.cerpani && td < s.last ? `<line class="now" x1="${X(td)}" x2="${X(td)}" y1="6" y2="${H - 20}"/><circle cx="${X(td)}" cy="${Y(s.bal)}" r="4" fill="var(--warn)"/>` : ''}
          ${l.fixaceDo && l.fixaceDo < s.last ? `<line class="fix" x1="${X(l.fixaceDo)}" x2="${X(l.fixaceDo)}" y1="6" y2="${H - 20}"/>` : ''}</svg>`;
      }

      function form(l, open) {
        const f = (k, label, type = 'text', extra = '') => `<label class="field">${label}<input type="${type}" data-k="${k}" value="${esc(l[k] ?? '')}" ${extra}></label>`;
        return `<details class="panel" ${open ? 'open' : ''}><summary>${ready(l) ? 'Nastavení úvěru' : 'Zadejte údaje z úvěrové smlouvy'}</summary>
          ${ready(l) ? '' : '<p class="muted">Stačí výše úvěru, datum čerpání, sazba a doba splatnosti. Ostatní je nepovinné. Údaje se ukládají jen do vašich dat (a na váš Google Disk), ne do kódu.</p>'}
          <div class="fgrid">
            ${f('nazev', 'Název')}${f('banka', 'Banka')}
            <label class="field">Účel<select data-k="ucel"><option value="pozemek"${l.ucel === 'pozemek' ? ' selected' : ''}>koupě pozemku</option><option value="stavba"${l.ucel === 'stavba' ? ' selected' : ''}>stavba domu</option><option value="byt"${l.ucel === 'byt' ? ' selected' : ''}>byt / dům</option><option value="jine"${l.ucel === 'jine' ? ' selected' : ''}>jiné</option></select></label>
            ${f('castka', 'Výše úvěru (Kč)', 'number', 'step="10000" min="0"')}${f('cerpani', 'Datum čerpání', 'date')}${f('smlouva', 'Datum podpisu smlouvy', 'date')}
            ${f('sazba', 'Úroková sazba (% p. a.)', 'number', 'step="0.01" min="0"')}${f('roky', 'Splatnost (roky)', 'number', 'step="1" min="1" max="40"')}${f('fixaceDo', 'Konec fixace', 'date')}${f('prvniSplatka', 'První anuitní splátka (nepovinné)', 'date')}${f('konec', 'Konečná splatnost (nepovinné)', 'date')}
            ${f('den', 'Den splátky v měsíci', 'number', 'min="1" max="28" placeholder="podle čerpání"')}${f('splatkaBanka', 'Splátka podle banky (nepovinné)', 'number', 'step="1" min="0" placeholder="dopočítá se"')}${f('pojisteni', 'Pojištění měsíčně (Kč)', 'number', 'step="1" min="0"')}
          </div>
          <div class="grid2" style="margin-top:12px">
            <div><div class="lbl" style="margin-bottom:6px">Mimořádné splátky</div>
              ${(l.mimoradne || []).map((x, i) => `<div class="taxrow"><span>${fmt.date(x.date)} · ${fmt.czk(x.castka)} · ${x.rezim === 'splatka' ? 'nižší splátka' : 'kratší doba'}</span><button class="btn sm danger" data-delx="${i}">×</button></div>`).join('') || '<span class="muted">žádné</span>'}
              <div class="acts" style="margin-top:6px"><input type="date" id="hyXd" aria-label="Datum"><input type="number" id="hyXa" step="10000" placeholder="částka" aria-label="Částka" style="width:120px"><select id="hyXm" aria-label="Režim"><option value="doba">zkrátit dobu</option><option value="splatka">snížit splátku</option></select><button class="btn sm" id="hyXadd">Přidat</button></div></div>
            <div style="grid-column:1/-1"><div class="lbl" style="margin-bottom:6px">Úroky podle výpisů z banky</div>
              ${Object.entries(l.uroky || {}).sort().map(([m, v]) => `<div class="taxrow"><span>${App.MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)} · ${fmt.czk2(v)}</span><button class="btn sm danger" data-delu="${m}">×</button></div>`).join('') || '<span class="muted">zatím žádné – počítá se odhadem</span>'}
              <div class="acts" style="margin-top:6px"><input type="month" id="hyUm" aria-label="Měsíc"><input type="number" id="hyUv" step="0.01" placeholder="úrok Kč" aria-label="Úrok" style="width:120px"><button class="btn sm" id="hyUadd">Přidat</button></div></div>
            <div><div class="lbl" style="margin-bottom:6px">Změny sazby (např. nová fixace)</div>
              ${(l.sazby || []).map((x, i) => `<div class="taxrow"><span>od ${fmt.date(x.od)} · ${fmt.num(x.sazba, 2)} %</span><button class="btn sm danger" data-delr="${i}">×</button></div>`).join('') || '<span class="muted">žádné</span>'}
              <div class="acts" style="margin-top:6px"><input type="date" id="hyRd" aria-label="Od"><input type="number" id="hyRs" step="0.01" placeholder="sazba %" aria-label="Sazba" style="width:100px"><button class="btn sm" id="hyRadd">Přidat</button></div></div>
          </div>
          <div class="acts" style="margin-top:12px">${ready(l) ? '<button class="btn primary" id="hyDone">Hotovo</button>' : ''}<label class="btn sm">Načíst údaje ze souboru<input type="file" id="hyImp" accept=".json,application/json" hidden></label>${loans.length > 1 ? '<button class="btn sm danger" id="hyDel">Smazat tento úvěr</button>' : ''}</div></details>`;
      }

      function wire(l) {
        root.querySelectorAll('[data-loan]').forEach(b => b.onclick = () => { sel = b.dataset.loan; simRate = null; save(); draw() });
        const add = $('#hyAdd'); if (add) add.onclick = () => { const n = NEW(); n.nazev = 'Hypotéka na stavbu'; n.ucel = 'stavba'; loans.push(n); sel = n.id; edit = true; save(); draw() };
        root.querySelectorAll('[data-k]').forEach(i => i.onchange = () => {
          const k = i.dataset.k, num = i.type === 'number'; l[k] = num ? (parseFloat(i.value) || 0) : i.value; save();
          if (ready(l) && !edit && ['castka', 'cerpani', 'sazba', 'roky'].includes(k)) { edit = true }
          setTimeout(draw);
        });
        const sum = root.querySelector('details.panel>summary'); if (sum) sum.onclick = () => { edit = !root.querySelector('details.panel').open; if (!ready(l)) edit = false; setTimeout(draw) };
        const imp = $('#hyImp'); if (imp) imp.onchange = async e => {
          const f = e.target.files[0]; if (!f) return;
          try {
            const j = JSON.parse(await f.text()), src = Array.isArray(j.loans) ? j.loans : [j.loan || j];
            const keys = Object.keys(NEW()).filter(k => k !== 'id');
            src.forEach((x, i) => { const same = loans.find(y => +y.castka === +x.castka && (y.smlouva || y.cerpani) && (y.smlouva === x.smlouva || y.banka === x.banka));
              const tgt = same || (i === 0 && !ready(l) ? l : (loans.push(NEW()), loans[loans.length - 1])); keys.forEach(k => { if (x[k] !== undefined && x[k] !== '') tgt[k] = k === 'uroky' ? { ...(tgt.uroky || {}), ...x[k] } : x[k] }); if (i === 0) sel = tgt.id });
            edit = false; save(); draw(); ctx.toast('Údaje z úvěrové smlouvy načteny. Zkontrolujte je v Nastavení úvěru.');
          } catch (err) { ctx.toast('Soubor se nepodařilo načíst. Je to soubor .json z Centrály?') }
        };
        const done = $('#hyDone'); if (done) done.onclick = () => { edit = false; draw(); ctx.toast('Uloženo.') };
        const del = $('#hyDel'); if (del) del.onclick = () => { if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Opravdu?'; return } loans = loans.filter(x => x.id !== l.id); sel = loans[0].id; save(); draw() };
        $('#hyXadd') && ($('#hyXadd').onclick = () => { const d = $('#hyXd').value, a = +$('#hyXa').value; if (!d || !(a > 0)) { ctx.toast('Zadejte datum a částku.'); return } (l.mimoradne = l.mimoradne || []).push({ date: d, castka: a, rezim: $('#hyXm').value }); save(); draw() });
        $('#hyRadd') && ($('#hyRadd').onclick = () => { const d = $('#hyRd').value, r = parseFloat($('#hyRs').value); if (!d || !(r >= 0)) { ctx.toast('Zadejte datum a sazbu.'); return } (l.sazby = l.sazby || []).push({ od: d, sazba: r }); save(); draw() });
        root.querySelectorAll('[data-delx]').forEach(b => b.onclick = () => { l.mimoradne.splice(+b.dataset.delx, 1); save(); draw() });
        $('#hyUadd') && ($('#hyUadd').onclick = () => { const m = $('#hyUm').value, v = parseFloat($('#hyUv').value); if (!m || !(v >= 0)) { ctx.toast('Zadejte měsíc a částku úroku.'); return } (l.uroky = l.uroky || {})[m] = v; save(); draw() });
        root.querySelectorAll('[data-delu]').forEach(b => b.onclick = () => { delete l.uroky[b.dataset.delu]; save(); draw() });
        root.querySelectorAll('[data-delr]').forEach(b => b.onclick = () => { l.sazby.splice(+b.dataset.delr, 1); save(); draw() });
        const sim = $('#hySim'); if (sim) { sim.oninput = () => { $('#hySimV').textContent = fmt.num(+sim.value, 2) + ' %' }; sim.onchange = () => { simRate = +sim.value; const y = scrollY; draw(); scrollTo(0, y) } }
        const ex = $('#hyEx'); if (ex) ex.onchange = () => { exAmt = Math.max(0, +ex.value || 0); const y = scrollY; draw(); scrollTo(0, y) };
        const exm = $('#hyExM'); if (exm) exm.onchange = () => { exMode = exm.value; const y = scrollY; draw(); scrollTo(0, y) };
        const ay = $('#hyAllY'); if (ay) ay.onclick = () => { allYears = !allYears; const yy = scrollY; draw(); scrollTo(0, yy) };
        const exa = $('#hyExAdd'); if (exa) exa.onclick = () => { const td = App.today(); (l.mimoradne = l.mimoradne || []).push({ date: l.fixaceDo && l.fixaceDo > td ? l.fixaceDo : td, castka: exAmt, rezim: exMode }); save(); draw(); ctx.toast('Mimořádná splátka zapsána do kalendáře.') };
      }

      draw();
      return ctx.bus.on('store:change', e => { if (e?.ns === 'dum') draw() });
    }
  });
})();
