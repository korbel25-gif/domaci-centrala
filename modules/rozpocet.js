/* =====================================================================
   MODUL: Rodinný rozpočet
   Import výpisů (CSV/XLSX/GPC), kategorie příjmů a výdajů.
   Data: localStorage klíč "rodinny-rozpocet-v1".
   Události: po importu vysílá 'rozpocet:import' {src, tx[]}
             – poslouchá je např. modul Faktury (párování plateb).
   ===================================================================== */
(function () {
const MARKUP = `<div class="wrap">
  <div class="top">
    <p class="muted" style="margin:0">Nahrajte výpisy z banky, aplikace je roztřídí a spočítá, kam peníze tečou.</p>
    <div class="tools">
      <select id="fPeriod" aria-label="Období"></select>
      <select id="fSrc" aria-label="Účet"></select>
    </div>
  </div>

  <div class="ticker" id="ticker" aria-label="Postřehy"><div class="tk" id="tk"></div></div>

  <label class="drop" id="drop">
    <div>
      <strong>Nahrát výpisy</strong> <small>— přetáhněte sem soubory nebo klikněte. CSV, XLSX/XLS nebo GPC (ABO). Lze více najednou.</small>
    </div>
    <span class="btn primary">Vybrat soubory</span>
    <input type="file" id="file" multiple accept=".csv,.txt,.xlsx,.xls,.gpc,.abo" hidden>
  </label>

  <div class="banner" id="sampleBanner" hidden>
    <b>Ukázková data.</b> <span>Čísla níže jsou vymyšlená. Po nahrání prvního výpisu ukázka sama zmizí.</span>
  </div>

  <section class="imp" id="imp" hidden></section>

  <section class="panel" id="accPanel" hidden></section>

  <div class="kpis" id="kpis"></div>

  <section class="panel" id="rpPanel"></section>


  <div class="split">
    <section class="panel">
      <div class="phead">
        <h2>Příjmy a výdaje po měsících</h2>
        <div class="legend"><span><i style="background:var(--inc)"></i>Příjmy</span><span><i style="background:var(--exp)"></i>Výdaje</span><span><i style="background:var(--fg);border-radius:50%"></i>Bilance</span></div>
      </div>
      <div id="chart" class="chartbox"></div><div class="tip" id="tip" hidden></div>
    </section>
    <section class="panel">
      <div class="phead">
        <h2>Podle kategorií</h2>
        <div class="seg" role="group" aria-label="Typ">
          <button id="segExp" aria-pressed="true">Výdaje</button><button id="segInc" aria-pressed="false">Příjmy</button>
        </div>
      </div>
      <div class="cats" id="cats"></div>
    </section>
  </div>

  <section class="panel">
    <div class="phead"><h2>Transakce</h2><span class="muted num" id="txCount"></span></div>
    <div class="filters">
      <input type="text" id="q" placeholder="Hledat (obchodník, zpráva, účet…)" aria-label="Hledat">
      <select id="fCat" aria-label="Kategorie"></select>
      <button class="chip" id="fUnc" aria-pressed="false">Jen nezařazené</button>
    </div>
    <div class="tablebox"><table>
      <thead><tr><th>Datum</th><th>Popis</th><th>Účet</th><th>Kategorie</th><th class="amt">Částka</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table></div>
    <div class="more"><button class="btn sm" id="moreBtn" hidden>Zobrazit další</button></div>
  </section>

  <details class="panel" id="setRules">
    <summary>Kategorie a pravidla třídění</summary>
    <p class="muted" style="margin:8px 0 0">Klíčová slova oddělujte čárkou. Hledají se v názvu protistrany, zprávě, poznámce i čísle protiúčtu, na začátku slova a bez ohledu na diakritiku. Pravidla se zkoušejí shora dolů. Do „Převodů mezi vlastními účty“ zadejte čísla svých účtů, aby se převody nepočítaly jako příjem ani výdaj.</p>
    <div class="acts" style="margin-top:12px">
      <input type="text" id="newCatName" placeholder="Nová kategorie" aria-label="Název nové kategorie">
      <select id="newCatType" aria-label="Typ nové kategorie"><option value="exp">Výdaj</option><option value="inc">Příjem</option></select>
      <button class="btn sm" id="addCat">Přidat</button>
      <button class="btn sm" id="reapply">Znovu roztřídit vše (zruší ruční změny)</button>
    </div>
    <div class="rules" id="rules"></div>
  </details>

  <details class="panel" id="setData">
    <summary>Nahraná data</summary>
    <div class="srcs" id="srcs"></div>
    <div class="acts" style="margin-top:12px"><button class="btn sm danger" id="wipe">Smazat všechna data</button></div>
  </details>

  <footer>Výpisy se zpracují přímo ve vašem prohlížeči a nikam se neodesílají. Uložené jsou ve vašich datech Centrály (a při zapnuté synchronizaci na vašem Google Disku).</footer>
</div>
<div class="toast" id="toast" hidden></div>
`;


/* =====================================================================
   PRAVIDELNÉ PLATBY – co je potřeba každý měsíc zaplatit.
   Data: App.store('rozpocet') → 'pravidelne' (synchronizuje se).
   Zaplaceno se pozná podle nahraných výpisů (částka ± 2 %, nebo klíčové slovo
   a částka ± 10 % v okně ±12 dní od splatnosti), nebo ručním odškrtnutím.
   Splátky úvěrů doplňuje modul Hypotéka přes App.loanPayments().
   ===================================================================== */
const RP = App.store('rozpocet');
const RP_FREQ = { m: ['měsíčně', 1], q: ['čtvrtletně', 3], h: ['pololetně', 6], y: ['ročně', 12] };
const rpNorm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const rpItems = () => {
  const own = RP.get('pravidelne', []);
  const loans = (typeof App.loanPayments === 'function' ? App.loanPayments() : []).map(x => ({ ...x, auto: true }));
  return [...own, ...loans].filter(x => x.aktivni !== false && +x.castka > 0);
};
const rpYm = d => d.slice(0, 7);
const rpAddMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) };
const rpDueIn = (it, ym) => { const [, k] = RP_FREQ[it.freq || 'm']; if (k === 1) return true; const start = +(it.mesic || 1); const m = +ym.slice(5); return ((m - start) % k + k) % k === 0 };
const rpDueDate = (it, ym) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${ym}-${String(Math.min(+it.den || 1, last)).padStart(2, '0')}` };
const rpDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
function rpReadTx() { try { const s = JSON.parse(App.raw.get('rodinny-rozpocet-v1') || 'null'); return s && !s.sample && Array.isArray(s.tx) ? s.tx : [] } catch (e) { return [] } }
/** Stav platby v daném měsíci: {due, date, paid:{date, how, amount}|null, state:'ok'|'wait'|'late'|'skip'} */
function rpStatus(it, ym, tx, used) {
  if (!rpDueIn(it, ym)) return { due: false, state: 'skip' };
  const date = rpDueDate(it, ym), td = App.today(), amt = +it.castka;
  const man = RP.get('rucne', {})[it.id + '|' + ym];
  if (man) return { due: true, date, state: 'ok', paid: { date: man, how: 'ručně' } };
  const sq = x => rpNorm(x).replace(/[^a-z0-9/]+/g, ' ').trim();
  const kw = String(it.klic || '').split(',').map(sq).filter(Boolean);
  const txt = t => ' ' + sq([t.party, t.desc, t.note, t.acct, t.vs].join(' ')) + ' ';
  const amts = [amt, ...(it.alt || [])].filter(x => x > 0);
  const hit = tx.find(t => {
    if (t.amount >= 0 || used.has(t.id) || Math.abs(rpDays(date, t.date)) > 12) return false;
    const d = Math.min(...amts.map(x => Math.abs(-t.amount - x))), kwHit = kw.length && kw.some(k => txt(t).includes(k));
    return (d <= Math.max(1, amt * 0.02) && (!kw.length || kwHit)) || (kwHit && d <= amt * 0.1);
  });
  if (hit) { used.add(hit.id); return { due: true, date, state: 'ok', paid: { date: hit.date, how: 'výpis', amount: -hit.amount } } }
  return { due: true, date, state: date < td ? 'late' : 'wait' };
}
function rpMonth(ym) {
  const tx = rpReadTx(), used = new Set();
  return rpItems().map(it => ({ it, ...rpStatus(it, ym, tx, used) })).filter(x => x.due).sort((a, b) => a.date.localeCompare(b.date));
}
/* Známé pravidelné platby – podle příjemce, zprávy nebo čísla účtu. den = obvyklá splatnost. */
const RP_KNOWN = [
  { re: /\b(vzp|zpmv|ozp|cpzp|vozp|rbp|zdravotni poj|zdrav\.? ?poj|pojistovna ministerstva|oborova zdravotni|vojenska zdravotni|revirni bratrska)/, nazev: 'Zdravotní pojištění', den: 8, typ: 'pojistne' },
  { re: /\b(cssz|ossz|pssz|socialni (poj|zabezp)|duchodove poj|ceska sprava socialniho)/, nazev: 'Sociální pojištění', den: 20, typ: 'pojistne' },
  { re: /\b(najem|najemne|pronajem bytu|platba najmu|svj|spolecenstvi vlastniku|fond oprav|bytove druzstvo)/, nazev: 'Nájem / bydlení', den: 0, typ: 'bydleni' },
  { re: /\b(netflix|spotify|youtube|google one|google play|google \*|apple\.com|itunes|icloud|disney|hbo|max\.com|voyo|oneplay|skylink|prime video|amazon prime|audible|storytel|microsoft|xbox|playstation|adobe|canva|openai|chatgpt|anthropic|claude\.ai|dropbox|notion)/, nazev: '', den: 0, typ: 'predplatne' },
  { re: /\b(o2 czech|o2 cz|t-mobile|tmobile|vodafone|nordic telecom|upc|vodafone cz|poda|starnet)/, nazev: '', den: 0, typ: 'telefon' },
  { re: /\b(cez|e\.on|eon|innogy|pre |ppas|bohemia energy|centropol|mnd|vodarn|vodovod|teplarn)/, nazev: '', den: 0, typ: 'energie' },
  { re: /\b(pojist|kooperativa|allianz|generali|uniqa|direct|cpp|csob poj|pillow|slavia poj)/, nazev: '', den: 0, typ: 'pojisteni' },
  { re: /\b(skolka|ms |materska skola|druzina|krouzek|skolne|obedy|strava\.cz)/, nazev: '', den: 0, typ: 'deti' }
];
const RP_TYP = { pojistne: 'pojistné OSVČ', bydleni: 'bydlení', predplatne: 'předplatné', telefon: 'telefon a internet', energie: 'energie', pojisteni: 'pojištění', deti: 'děti' };
const rpTitle = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/^(platba|trvaly prikaz|inkaso|nakup|karta)\s*[:-]?\s*/i, '').slice(0, 40);
/** Návrhy z výpisů: opakující se odchozí platby (stejný příjemce / účet a podobná částka) + známé typy plateb. */
function rpSuggest() {
  const tx = rpReadTx().filter(t => t.amount < 0 && !/^(prevody)$/.test(t.cat || '')), groups = {};
  const loans = (typeof App.loanPayments === 'function' ? App.loanPayments() : []).map(x => +x.castka);
  for (const t of tx) {
    const hay = rpNorm([t.party, t.desc, t.note, t.acct].join(' '));
    if (/hypot|uver|splatka jistiny|splatka uroku/.test(hay)) continue;
    const kn = RP_KNOWN.find(k => k.re.test(' ' + hay));
    const acct = String(t.acct || '').replace(/\s/g, '');
    const key = acct && acct.length > 5 ? 'a:' + acct : 'p:' + rpNorm(t.party || t.desc).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
    if (key.length < 4) continue;
    const g = groups[key] || (groups[key] = { key, L: [], kn: null, src: {} }); g.L.push(t); if (kn) g.kn = kn; g.src[t.src] = (g.src[t.src] || 0) + 1;
  }
  const have = rpItems().map(x => rpNorm([x.nazev, x.klic].join(' ')));
  const out = [];
  for (const g of Object.values(groups)) {
    const L = g.L.sort((a, b) => a.date.localeCompare(b.date)), months = [...new Set(L.map(t => rpYm(t.date)))];
    if (months.length < (g.kn ? 2 : 3)) continue;
    const last = L.slice(-3).map(t => -t.amount).sort((a, b) => a - b), med = last[Math.floor(last.length / 2)];
    const similar = L.filter(t => Math.abs(-t.amount - med) <= med * (g.kn && g.kn.typ === 'energie' ? 0.35 : 0.12));
    const sm = [...new Set(similar.map(t => rpYm(t.date)))];
    if (sm.length < (g.kn ? 2 : 3)) continue;
    if (loans.some(l => Math.abs(l - med) <= 2)) continue;
    // frekvence podle rozestupů měsíců
    const idx = sm.map(m => +m.slice(0, 4) * 12 + +m.slice(5)), gaps = idx.slice(1).map((v, i) => v - idx[i]), gap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
    const freq = gap >= 11 ? 'y' : gap >= 5 ? 'h' : gap >= 3 ? 'q' : 'm';
    const day = g.kn && g.kn.den ? g.kn.den : Math.round(similar.slice(-4).reduce((s2, t) => s2 + +t.date.slice(8), 0) / Math.min(4, similar.length));
    const t0 = similar[similar.length - 1], party = rpTitle(t0.party || t0.desc);
    const nazev = g.kn && g.kn.nazev ? g.kn.nazev + (party ? ` (${party})` : '') : party || 'Platba ' + (t0.acct || '');
    const klic = g.key.startsWith('a:') ? g.key.slice(2) : g.key.slice(2).split(' ').slice(0, 2).join(' ');
    if (have.some(h => h.includes(rpNorm(klic)) || h.includes(rpNorm(party).split(' ')[0] || '§'))) continue;
    const src = Object.entries(g.src).sort((a, b) => b[1] - a[1])[0][0];
    out.push({ nazev, castka: Math.round(med), den: Math.min(28, Math.max(1, day)), klic, pocet: sm.length, freq, mesic: freq !== 'm' ? +sm[sm.length - 1].slice(5) : 1, typ: g.kn ? g.kn.typ : '', ucet: src, last: t0.date });
  }
  const rank = x => x.typ === 'pojistne' ? 0 : x.typ === 'bydleni' ? 1 : x.typ ? 2 : 3;
  return out.sort((a, b) => rank(a) - rank(b) || b.castka - a.castka).slice(0, 25);
}
App.regularPayments = rpMonth;   // pro asistenta a další moduly

function rpWidget() {
  const L = rpMonth(App.today().slice(0, 7)); if (!L.length) return '';
  const late = L.filter(x => x.state === 'late'), wait = L.filter(x => x.state === 'wait'), ok = L.filter(x => x.state === 'ok');
  const nx = late[0] || wait[0];
  return `<span class="wnote" style="display:block;margin-top:6px">Pravidelné platby: <b>${ok.length} z ${L.length}</b> zaplaceno${late.length ? ` · <b style="color:var(--exp)">${late.length} po splatnosti</b>` : ''}${nx ? ` · další ${App.esc(nx.it.nazev)} ${App.fmt.date(nx.date)}` : ''}</span>`;
}
/* Shrnutí pro přehled – čte uložená data bez spuštění celého modulu */
function summary() {
  let s; try { s = JSON.parse(App.raw.get('rodinny-rozpocet-v1') || 'null') } catch (e) { s = null }
  if (!s || !s.tx || !s.tx.length) return null;
  const types = {}; (s.cats || []).forEach(c => types[c.id] = c.type);
  const isTr = t => types[t.cat] === 'transfer';
  const months = [...new Set(s.tx.map(t => t.date.slice(0, 7)))].sort();
  const by = m => { let i = 0, e = 0; for (const t of s.tx) if (!isTr(t) && t.date.startsWith(m)) { if (t.amount > 0) i += t.amount; else e -= t.amount } return { m, i, e, b: i - e } };
  return { sample: !!s.sample, last: by(months[months.length - 1]), hist: months.slice(-8).map(by) };
}

/* Nástroje pro asistenta – čtou uložená data rozpočtu */
function budgetTools() {
  const rpTool = { name: 'payments_due', description: 'Pravidelné měsíční platby (nájem, energie, pojištění, splátky…) a jejich stav v zadaném měsíci: zaplaceno podle výpisu / ručně, čeká na zaplacení (kolik dní zbývá), po splatnosti.',
    inputSchema: { type: 'object', properties: { mesic: { type: 'string', description: 'YYYY-MM, výchozí aktuální měsíc' } } },
    run: inp => { const ym = /^\d{4}-\d{2}$/.test(inp.mesic || '') ? inp.mesic : App.today().slice(0, 7); const L = rpMonth(ym);
      return { mesic: ym, celkem: Math.round(L.reduce((s, x) => s + +x.it.castka, 0)), platby: L.map(x => ({ nazev: x.it.nazev, castka: +x.it.castka, splatnost: x.date, stav: { ok: 'zaplaceno', wait: 'čeká', late: 'po splatnosti' }[x.state], zaplaceno: x.paid?.date, jak: x.paid?.how, zpusob: x.it.zpusob === 'trvaly' ? 'trvalý příkaz / inkaso' : 'platím ručně' })) } } };
  return [rpTool, ...budgetTools0()];
}
function budgetTools0() {
  const read = () => { let s; try { s = JSON.parse(App.raw.get('rodinny-rozpocet-v1') || 'null') } catch (e) { s = null } if (!s || !s.tx || !s.tx.length) throw new Error('V rozpočtu zatím nejsou žádná data. Nahrajte výpis z banky.'); return s };
  const nt = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ctx = s => { const cats = {}; (s.cats || []).forEach(c => cats[c.id] = c); return { cats, isTr: t => cats[t.cat]?.type === 'transfer', name: id => cats[id]?.name || id } };
  const lastMonth = s => s.tx.reduce((m, t) => t.date > m ? t.date : m, '0').slice(0, 7);
  return [
    { name: 'budget_summary', description: 'Souhrn rodinného rozpočtu za období: příjmy, výdaje, bilance a výdaje podle kategorií (seřazeno). period = YYYY-MM nebo YYYY; bez něj poslední měsíc, ve kterém jsou data.',
      inputSchema: { type: 'object', properties: { period: { type: 'string' } } },
      run: inp => { const s = read(), C = ctx(s), p = String(inp.period || lastMonth(s));
        const tx = s.tx.filter(t => t.date.startsWith(p) && !C.isTr(t)); const by = {}; let i = 0, e = 0;
        for (const t of tx) { if (t.amount > 0) i += t.amount; else { e -= t.amount; by[t.cat] = (by[t.cat] || 0) - t.amount } }
        return { obdobi: p, ukazkova_data: !!s.sample, prijmy: Math.round(i), vydaje: Math.round(e), bilance: Math.round(i - e), pohybu: tx.length, posledni_data: lastMonth(s),
          vydaje_podle_kategorii: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ kategorie: C.name(k), castka: Math.round(v) })) } } },
    { name: 'budget_transactions', description: 'Vyhledá pohyby v rozpočtu podle textu (obchodník, zpráva), kategorie a období (YYYY-MM nebo YYYY). Vrací součet a max 25 nejnovějších pohybů.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' }, period: { type: 'string' }, limit: { type: 'number' } } },
      run: inp => { const s = read(), C = ctx(s), q = nt(inp.query), cq = nt(inp.category);
        const tx = s.tx.filter(t => (!inp.period || t.date.startsWith(String(inp.period))) && (!q || nt(t.party + ' ' + t.desc + ' ' + t.note).includes(q)) && (!cq || t.cat === inp.category || nt(C.name(t.cat)).includes(cq))).sort((a, b) => b.date.localeCompare(a.date));
        return { pocet: tx.length, soucet: Math.round(tx.reduce((a, t) => a + t.amount, 0)), pohyby: tx.slice(0, Math.min(25, +inp.limit || 25)).map(t => ({ datum: t.date, castka: t.amount, protistrana: t.party, popis: t.desc, kategorie: C.name(t.cat), ucet: t.src })) } } }
  ];
}

App.register({
  id: 'rozpocet',
  name: 'Rodinný rozpočet',
  short: 'Rozpočet',
  description: 'Výpisy z banky, kategorie příjmů a výdajů.',
  icon: App.icons.wallet,
  order: 10,
  tools: budgetTools,

  widget(el) {
    const s = summary();
    if (!s) { el.innerHTML = '<span class="wnote">Zatím žádná data. Otevřete modul a nahrajte výpis z banky.</span>' + rpWidget(); return }
    const L = s.last, mx = Math.max(1, ...s.hist.map(h => Math.abs(h.b)));
    el.innerHTML = `<div class="lbl">${App.MONTHS[+L.m.slice(5) - 1]} ${L.m.slice(0, 4)}${s.sample ? ' · ukázková data' : ''}</div>
      <div class="wnums"><div><span>Příjmy</span><b class="inc" data-count="${L.i}"></b></div><div><span>Výdaje</span><b class="exp" data-count="${L.e}"></b></div>
      <div><span>Bilance</span><b class="${L.b >= 0 ? 'inc' : 'exp'}" data-count="${L.b}"></b></div></div>
      <div class="minibars" title="Bilance posledních měsíců">${s.hist.map((h, k) => `<i class="${h.b < 0 ? 'neg' : ''}" style="height:${Math.max(4, Math.abs(h.b) / mx * 100)}%;animation-delay:${k * 60}ms" title="${App.MONTHS[+h.m.slice(5) - 1]}: ${App.fmt.czk(h.b)}"></i>`).join('')}</div>
      <span class="wnote">Bilance posledních ${s.hist.length} měsíců</span>${rpWidget()}`;
  },

  mount(root) {
    root.innerHTML = MARKUP;
const LS='rodinny-rozpocet-v1';
const MON=['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];
const MONF=['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const fmt0=new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:0});
const fmt2=new Intl.NumberFormat('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const tok=s=>norm(s).replace(/[^a-z0-9&.@]+/g,' ').trim();

const DEFAULT_CATS=[
 {id:'prevody',name:'Převody mezi vlastními účty',type:'transfer',color:'#7D8BA8',kw:['prevod mezi','vlastni ucet','sporici ucet']},
 {id:'uroky',name:'Úroky a poplatky z dluhů',type:'exp',color:'#FF2E63',kw:['urok','debetni urok','sankcni urok','poplatek za kartu','rocni poplatek za kartu']},
 {id:'mzda',name:'Mzda a plat',type:'inc',color:'#38FFA5',kw:['mzd','vyplat','salary']},
 {id:'davky',name:'Dávky a přídavky',type:'inc',color:'#2DE0C0',kw:['urad prace','pridav','materska','rodicovsk','cssz','ossz']},
 {id:'vratky',name:'Vratky a refundace',type:'inc',color:'#8CFFC9',kw:['vratka','refund','storno','vraceni','preplatek']},
 {id:'ostatni_p',name:'Ostatní příjmy',type:'inc',color:'#B5FFDD',kw:[]},
 {id:'bydleni',name:'Bydlení a energie',type:'exp',color:'#4D7CFF',kw:['najem','svj','hypote','fond oprav','bytove druzstvo','cez','innogy','e.on','eon','plyn','ppas','vodarn','vodovod','energie','zaloha na']},
 {id:'potraviny',name:'Potraviny',type:'exp',color:'#FF9A3D',kw:['albert','billa','lidl','kaufland','tesco','penny','globus','rohlik','kosik','coop','hruska','norma','zabka','potravin','makro','flop']},
 {id:'restaurace',name:'Restaurace a jídlo s sebou',type:'exp',color:'#FFD24A',kw:['restaur','bistro','kavarn','cafe','pizz','mcdonald','kfc','burger','wolt','foodora','damejidlo','starbucks','costa coffee','hospoda','pivnice']},
 {id:'doprava',name:'Auto a doprava',type:'exp',color:'#2EF0FF',kw:['benzina','shell','omv','mol','orlen','eurooil','ceske drahy','cd.cz','regiojet','leo express','dpp','mhd','parkov','bolt','uber','liftago','edalnice','dalnicni','pneu','stk']},
 {id:'domacnost',name:'Domácnost a drogerie',type:'exp',color:'#A57BFF',kw:['dm drogerie','dm-drogerie','drogerie','rossmann','teta','ikea','hornbach','obi','bauhaus','mountfield','jysk','xxxlutz','mobelix','kika','tescoma','alza','mall.cz','datart','electro world','okay']},
 {id:'deti',name:'Děti a škola',type:'exp',color:'#FF5FD2',kw:['skol','krouzek','hrack','sparkys','bambule','druzina','obedy','strava.cz','jidelna','tabor']},
 {id:'zdravi',name:'Zdraví a lékárna',type:'exp',color:'#FF4F79',kw:['lekarn','dr.max','drmax','benu','pilulka','nemocnic','poliklinik','zubni','mudr','optik']},
 {id:'obleceni',name:'Oblečení a obuv',type:'exp',color:'#E0A070',kw:['zara','h&m','reserved','deichmann','ccc','bata','c&a','lindex','kik','pepco','primark','answear','zalando','about you']},
 {id:'volnycas',name:'Sport, kultura, dovolená',type:'exp',color:'#9CFF4A',kw:['decathlon','sportisimo','a3 sport','kino','cinema city','divadl','ticketportal','goout','vstupen','bazen','fitness','booking','airbnb','cestovni','invia']},
 {id:'predplatne',name:'Telefon, internet, předplatné',type:'exp',color:'#6FB4FF',kw:['o2','t-mobile','vodafone','upc','netflix','spotify','youtube','google one','google play','apple.com','icloud','hbo','disney','voyo','oneplay','microsoft','adobe']},
 {id:'pojisteni',name:'Pojištění',type:'exp',color:'#C9A88C',kw:['pojist','kooperativa','allianz','generali','cpp','uniqa','pillow']},
 {id:'poplatky',name:'Daně, odvody, poplatky',type:'exp',color:'#A0A8C0',kw:['financni urad','dan z','cssz','ossz','vzp','zpmv','ozp','vozp','poplatek','sankce']},
 {id:'sporeni',name:'Spoření a investice',type:'exp',color:'#3DB8FF',kw:['xtb','penzijni','stavebni sporeni','burinka','modra pyramida','conseq','portu','fondee','investown','patria']},
 {id:'hotovost',name:'Výběr hotovosti',type:'exp',color:'#E8E06A',kw:['bankomat','atm','vyber hotovosti','vyber z bankomatu']},
 {id:'nezarazeno',name:'Nezařazeno',type:'exp',color:'#5E6A85',kw:[]},
];
const FALLBACK_INC='ostatni_p', FALLBACK_EXP='nezarazeno';

let state={tx:[],cats:structuredClone(DEFAULT_CATS),sample:false};
let ui={period:'all',src:'',cat:'',q:'',unc:false,side:'exp',limit:200,pending:[]};

function save(){try{localStorage.setItem(LS,JSON.stringify(state))}catch(e){}}
function load(){try{const s=JSON.parse(localStorage.getItem(LS)||'null');if(s&&Array.isArray(s.tx)){state=s;
  // doplnit případné nové výchozí kategorie
  for(const d of DEFAULT_CATS){const c=state.cats.find(c=>c.id===d.id);if(!c){const i=DEFAULT_CATS.indexOf(d);const nx=DEFAULT_CATS.slice(i+1).map(x=>state.cats.findIndex(c=>c.id===x.id)).find(j=>j>=0);state.cats.splice(nx??state.cats.length,0,structuredClone(d))}else c.color=d.color}
  // kreditní karta a kontokorent byly odstraněny – úklid starších dat
  delete state.accounts;state.cats=state.cats.filter(c=>c.id!=='splatky_kk');
  for(const t of state.tx)if(t.cat==='splatky_kk'){t.manual=false;t.cat=autoCat(t)}
  return true}}catch(e){}return false}
const catById=id=>state.cats.find(c=>c.id===id)||state.cats.find(c=>c.id===FALLBACK_EXP);

/* Vlastní účty: state.ucty = { 'název': {cislo:'123-456789/0800', banka:'', map:{…}, hint:'…'} } */
const accNum=s=>{const m=String(s||'').replace(/\s/g,'').match(/(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})/);if(m)return m[2].replace(/^0+/,'')+'/'+m[3];
  const ib=String(s||'').replace(/\s/g,'').toUpperCase().match(/^CZ\d{2}(\d{4})(\d{6})(\d{10})$/);return ib?ib[3].replace(/^0+/,'')+'/'+ib[1]:''};
const accBase=s=>{const n=accNum(s);if(n)return n.split('/')[0];const d=String(s||'').replace(/\D/g,'').replace(/^0+/,'');return d.length>=6?d:''};
const ownNums=()=>Object.values(state.ucty||{}).map(u=>accBase(u.cislo)).filter(Boolean);
function isOwnTransfer(t){const n=ownNums();if(!n.length)return false;const k=accBase(t.acct);return !!k&&n.includes(k)}
function autoCat(t){
  if(isOwnTransfer(t))return 'prevody';
  const hay=' '+tok([t.party,t.desc,t.note,t.acct,t.vs].join(' '))+' ';
  for(const c of state.cats){
    if(c.type==='inc'&&t.amount<=0)continue;
    if(c.type==='exp'&&t.amount>=0)continue;
    for(const k of c.kw){const kk=tok(k); if(kk&&hay.includes(' '+kk)) return c.id}
  }
  return t.amount>0?FALLBACK_INC:FALLBACK_EXP;
}
function recat(all){for(const t of state.tx){if(all)t.manual=false;if(!t.manual)t.cat=autoCat(t)}}

/* ---------- parsing ---------- */
function decode(buf){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf).replace(/^﻿/,'')}
  catch(e){return new TextDecoder('windows-1250').decode(buf)}
}
function parseCSV(text){
  const first=text.split(/\r?\n/).slice(0,40).join('\n');
  const cands=[';',',','\t','|'];let delim=';',best=-1;
  for(const d of cands){const n=first.split(d).length;if(n>best){best=n;delim=d}}
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===delim){row.push(f);f=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}
    else f+=c}
  if(f!==''||row.length){row.push(f);rows.push(row)}
  return rows.map(r=>r.map(x=>x.trim()));
}
function parseAmt(v){
  if(typeof v==='number')return v;
  if(v==null)return null;
  let s=String(v).replace(/[\s  ']/g,'').replace(/[^0-9,.\-+−]/g,'').replace('−','-');
  if(!/\d/.test(s))return null;
  const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.');
  if(lc>-1&&ld>-1){if(lc>ld)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'')}
  else if(lc>-1){s=(s.split(',').length>2)?s.replace(/,/g,''):s.replace(',','.')}
  else if(ld>-1&&s.split('.').length>2)s=s.replace(/\./g,'');
  const n=parseFloat(s);return isNaN(n)?null:n;
}
const pad=n=>String(n).padStart(2,'0');
function ymd(y,m,d){if(m<1||m>12||d<1||d>31||y<1990||y>2100)return null;return `${y}-${pad(m)}-${pad(d)}`}
function parseDate(v){
  if(v instanceof Date&&!isNaN(v))return ymd(v.getFullYear(),v.getMonth()+1,v.getDate());
  if(typeof v==='number'&&v>20000&&v<80000){const d=new Date(Math.round((v-25569)*864e5));return ymd(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate())}
  const s=String(v??'').trim();let m;
  if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))return ymd(+m[1],+m[2],+m[3]);
  if(m=s.match(/^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{2,4})/)){let y=+m[3];if(y<100)y+=2000;return ymd(y,+m[2],+m[1])}
  if(m=s.match(/^(\d{4})(\d{2})(\d{2})$/))return ymd(+m[1],+m[2],+m[3]);
  return null;
}
function parseGPC(text){
  const out=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('075')||line.length<100)continue;
    const code=line.slice(60,61);
    let amt=parseInt(line.slice(48,60),10)/100; if(code==='1'||code==='5')amt=-amt;
    const dd=line.slice(122,128).trim()||line.slice(91,97);
    const date=ymd(2000+ +dd.slice(4,6),+dd.slice(2,4),+dd.slice(0,2));
    if(!date||!amt)continue;
    out.push({date,amount:amt,party:line.slice(97,117).trim(),desc:'',note:'',acct:line.slice(19,35).replace(/^0+/,''),vs:line.slice(61,71).replace(/^0+/,'')});
  }
  return out;
}

const FIELDS=[
 ['date','Datum *',[/zauctov/,/provedeni/,/^datum$/,/datum/,/date/,/valuta/]],
 ['amount','Částka (se znaménkem)',[/^castka$/,/castka v mene uctu/,/castka/,/objem/,/amount/,/suma/,/hodnota/]],
 ['credit','nebo: Připsáno',[/pripsan/,/kredit/,/credit/,/^prijem/]],
 ['debit','nebo: Odepsáno',[/odepsan/,/debet/,/debit/,/^vydaj/]],
 ['party','Protistrana / obchodník',[/nazev protiuctu/,/protistran/,/nazev uctu protistrany/,/obchodnik/,/misto/,/prijemce/,/platce/,/counterparty/,/merchant/,/nazev/]],
 ['desc','Zpráva / popis',[/zprava/,/popis/,/ucel/,/detail/,/description/,/informace/,/typ/]],
 ['note','Poznámka',[/poznamka/,/note/,/vlastni/]],
 ['acct','Číslo protiúčtu',[/^protiucet$/,/cislo protiuctu/,/cislo uctu protistrany/,/ucet protistrany/,/protiucet/,/protiuct/,/counter/]],
 ['vs','Variabilní symbol',[/^vs$/,/variabilni/]],
];
function findHeader(rows){
  let best=0,bi=0;
  for(let i=0;i<Math.min(rows.length,40);i++){
    const r=rows[i]||[];let sc=0;
    for(const c of r){const h=norm(c);if(!h||h.length>60)continue;if(FIELDS.some(f=>f[2].some(re=>re.test(h))))sc++}
    if(sc>best){best=sc;bi=i}
  }
  return bi;
}
function guessMap(rows,h){
  const head=(rows[h]||[]).map(norm);const used=new Set();const m={header:h,invert:false};
  for(const [key,,res] of FIELDS){m[key]=-1;
    outer:for(const re of res)for(let i=0;i<head.length;i++){if(!used.has(i)&&re.test(head[i])){m[key]=i;used.add(i);break outer}}}
  if(m.amount>=0){m.credit=-1;m.debit=-1}
  return m;
}
function rowsToTx(rows,m){
  const out=[];
  for(let i=m.header+1;i<rows.length;i++){const r=rows[i];if(!r||m.date<0)continue;
    const date=parseDate(r[m.date]);if(!date)continue;
    let a;
    if(m.amount>=0)a=parseAmt(r[m.amount]);
    else if(m.credit>=0||m.debit>=0){const c=parseAmt(r[m.credit]),d=parseAmt(r[m.debit]);if(c==null&&d==null)continue;a=Math.abs(c||0)-Math.abs(d||0)}
    if(a==null||!a)continue;
    if(m.invert)a=-a;
    const g=k=>m[k]>=0?String(r[m[k]]??'').trim():'';
    out.push({date,amount:Math.round(a*100)/100,party:g('party'),desc:g('desc'),note:g('note'),acct:g('acct'),vs:g('vs')});
  }
  return out;
}

async function readFile(file){
  const buf=await file.arrayBuffer();const name=file.name;const ext=name.split('.').pop().toLowerCase();
  const label=name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,40);
  if(ext==='gpc'||ext==='abo'){const text=decode(buf);const own=(text.match(/^074(\d{16})/m)||[])[1];return {name,label,kind:'gpc',txs:parseGPC(text),num:own?own.replace(/^0+/,''):''}}
  let rows;
  if(ext==='xlsx'||ext==='xls'){
    if(!window.XLSX)throw new Error('Knihovna pro Excel se nenačetla. Uložte výpis jako CSV.');
    const wb=XLSX.read(buf,{type:'array',cellDates:true});
    rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:''});
  }else{
    const text=decode(buf);
    if(/^07[45]/m.test(text.slice(0,200))&&!text.includes(';'))return {name,label,kind:'gpc',txs:parseGPC(text)};
    rows=parseCSV(text);
  }
  const h=findHeader(rows);
  const p={name,label,kind:'table',rows,map:guessMap(rows,h)};
  // číslo vlastního účtu: z hlavičky výpisu nebo z názvu souboru
  const top=rows.slice(0,Math.max(1,h)).flat().map(String).join(' ')+' '+name.replace(/_/g,' ');
  const num=accNum(top)||((name.match(/(\d{6,10})/)||[])[1]||'');
  p.num=num;
  const known=Object.entries(state.ucty||{}).find(([k,u])=>u.cislo&&num&&accBase(u.cislo)&&accBase(u.cislo)===accBase(num))
    ||Object.entries(state.ucty||{}).find(([k,u])=>u.map&&sameHead(p,u.map)&&Object.keys(state.ucty).length===1);
  if(known){p.label=known[0];p.num=known[1].cislo||num;if(known[1].map&&sameHead(p,known[1].map))p.map={...known[1].map}}
  return p;
}
async function handleFiles(files){
  for(const f of files){
    if(/\.pdf$/i.test(f.name)){toast(`${f.name}: PDF výpisy číst neumím. V internetovém bankovnictví stáhněte pohyby jako CSV, XLSX nebo GPC.`);continue}
    try{ui.pending.push(await readFile(f))}catch(e){toast(`${f.name}: ${e.message||'soubor se nepodařilo přečíst'}`)}
  }
  renderImport();
  $('imp').scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------- import panel ---------- */
function currentTxs(p){return p.kind==='gpc'?p.txs:rowsToTx(p.rows,p.map)}
function renderImport(){
  const box=$('imp');const p=ui.pending[0];
  if(!p){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  const txs=currentTxs(p);
  const head=p.kind==='table'?(p.rows[p.map.header]||[]):[];
  const opts=sel=>`<option value="-1">—</option>`+head.map((h,i)=>`<option value="${i}"${i===sel?' selected':''}>${esc(h||('sloupec '+(i+1)))}</option>`).join('');
  const sum=txs.reduce((a,t)=>a+t.amount,0);
  const range=txs.length?`${fmtD(txs.reduce((a,t)=>t.date<a?t.date:a,'9'))} – ${fmtD(txs.reduce((a,t)=>t.date>a?t.date:a,'0'))}`:'';
  box.innerHTML=`
   <div class="phead" style="margin:0"><h2>Import: ${esc(p.name)}</h2><span class="muted">${ui.pending.length>1?`další v pořadí: ${ui.pending.length-1}`:''}</span></div>
   <div class="mapgrid">
     <label>Účet<select id="impAcc">${Object.keys(state.ucty||{}).map(k=>`<option${k===p.label?' selected':''}>${esc(k)}</option>`).join('')}<option value="__new"${state.ucty&&state.ucty[p.label]?'':' selected'}>+ nový účet…</option></select></label>
     ${state.ucty&&state.ucty[p.label]?'':`<label>Název nového účtu (např. „Společný účet“)<input type="text" id="impLabel" value="${esc(p.label)}"></label>`}
     <label>Číslo účtu (pro rozpoznání převodů mezi vašimi účty)<input type="text" id="impNum" value="${esc((state.ucty&&state.ucty[p.label]&&state.ucty[p.label].cislo)||p.num||'')}" placeholder="např. 123456789/0800"></label>
     ${p.kind==='table'?`<label>Řádek se záhlavím<input type="number" id="impHead" min="1" max="${p.rows.length}" value="${p.map.header+1}"></label>`:''}
   </div>
   ${p.kind==='table'?`<div class="lbl">Které sloupce co obsahují</div>
   <div class="mapgrid">${FIELDS.map(([k,l])=>`<label>${l}<select data-k="${k}">${opts(p.map[k])}</select></label>`).join('')}</div>
   <label class="check"><input type="checkbox" id="impInv"${p.map.invert?' checked':''}> Obrátit znaménko (výdaje jsou ve výpisu kladné)</label>`:'<div class="muted">Formát GPC (ABO) — sloupce jsou dané standardem.</div>'}
   <div class="lbl">Náhled ${txs.length?`· ${txs.length} pohybů · ${range} · součet ${fmt0.format(sum)}`:''}</div>
   ${txs.length?`<div class="prev"><table><thead><tr><th>Datum</th><th>Protistrana</th><th>Zpráva</th><th class="amt">Částka</th></tr></thead><tbody>
     ${txs.slice(0,6).map(t=>`<tr><td class="d">${fmtD(t.date)}</td><td>${esc(t.party||t.acct)}</td><td class="x">${esc(t.desc||t.note)}</td><td class="amt ${t.amount>0?'inc':'exp'}">${fmt2.format(t.amount)}</td></tr>`).join('')}
   </tbody></table></div>`:`<div class="err">Zatím nenacházím žádné pohyby. Zkontrolujte řádek se záhlavím a sloupce Datum a Částka.</div>`}
   <div class="acts"><button class="btn primary" id="impGo"${txs.length?'':' disabled'}>Importovat ${txs.length} pohybů</button><button class="btn" id="impSkip">Přeskočit soubor</button></div>`;
  box.querySelectorAll('select[data-k]').forEach(s=>s.onchange=()=>{p.map[s.dataset.k]=+s.value;if(s.dataset.k==='amount'&&+s.value>=0){p.map.credit=-1;p.map.debit=-1}renderImport()});
  const hd=$('impHead');if(hd)hd.onchange=()=>{const h=Math.max(0,Math.min(p.rows.length-1,(+hd.value||1)-1));const inv=p.map.invert;p.map=guessMap(p.rows,h);p.map.invert=inv;renderImport()};
  const inv=$('impInv');if(inv)inv.onchange=()=>{p.map.invert=inv.checked;renderImport()};
  const il=$('impLabel');if(il)il.oninput=e=>p.label=e.target.value;
  $('impAcc').onchange=e=>{if(e.target.value==='__new'){p.label=p.newLabel||'Nový účet'}else{p.newLabel=p.newLabel||p.label;p.label=e.target.value;const sv=state.ucty[p.label]?.map;if(sv&&p.kind==='table'&&sameHead(p,sv))p.map={...sv}}renderImport()};
  $('impNum').oninput=e=>p.num=e.target.value;
  $('impSkip').onclick=()=>{ui.pending.shift();renderImport()};
  $('impGo').onclick=()=>doImport(p,txs);
}
function sameHead(p,map){const h=(p.rows[map.header]||[]).map(norm).join('|');return !!map.sig&&h===map.sig}
function doImport(p,txs){
  const src=(p.label||p.name).trim()||'Účet';
  state.ucty=state.ucty||{};const U=state.ucty[src]||(state.ucty[src]={cislo:'',banka:''});
  if(p.num!=null&&String(p.num).trim())U.cislo=String(p.num).trim();
  if(p.kind==='table')U.map={...p.map,sig:(p.rows[p.map.header]||[]).map(norm).join('|')};
  U.hint=accNum(p.num)||U.hint||'';U.posl=new Date().toISOString().slice(0,10);
  if(state.sample){state.tx=[];state.sample=false}
  const ids=new Set(state.tx.map(t=>t.id));const seen={};let added=0,dup=0;
  for(const t of txs){
    const base=[t.date,t.amount.toFixed(2),tok(t.party+' '+t.desc+' '+t.acct).slice(0,50),src].join('|');
    seen[base]=(seen[base]||0)+1;const id=base+'#'+seen[base];
    if(ids.has(id)){dup++;continue}
    const n={id,src,...t,manual:false};delete n.bal;delete n.ord;n.cat=autoCat(n);state.tx.push(n);ids.add(id);added++;
  }
  recat(false);save();ui.pending.shift();ui.src='';ui.period='all';
  renderImport();render();
  App.bus.emit('rozpocet:import',{src,tx:state.tx.filter(t=>t.src===src)});
  toast(`Importováno ${added} pohybů${dup?`, ${dup} duplicit přeskočeno`:''}.`);
}

/* ---------- views ---------- */
function fmtD(d){const [y,m,dd]=d.split('-');return `${+dd}. ${+m}. ${y}`}
const ym=d=>d.slice(0,7);
function scoped(){
  return state.tx.filter(t=>(!ui.src||t.src===ui.src)&&(ui.period==='all'||t.date.startsWith(ui.period)));
}
const isTr=t=>catById(t.cat).type==='transfer';
function monthsSpan(list){
  if(!list.length)return 1;const ms=list.map(t=>ym(t.date)).sort();
  const [a,b]=[ms[0],ms[ms.length-1]];return (+b.slice(0,4)-+a.slice(0,4))*12+(+b.slice(5)-+a.slice(5))+1;
}
function render(){
  $('sampleBanner').hidden=!state.sample;if(typeof renderRP==='function'&&$('rpPanel'))setTimeout(()=>renderRP());
  renderFilters();renderAccounts();
  const list=scoped();const real=list.filter(t=>!isTr(t));
  const inc=real.filter(t=>t.amount>0).reduce((a,t)=>a+t.amount,0);
  const exp=-real.filter(t=>t.amount<0).reduce((a,t)=>a+t.amount,0);
  const bal=inc-exp;const mcount=monthsSpan(list);
  const unc=list.filter(t=>t.cat===FALLBACK_EXP).length;
  $('kpis').innerHTML=`
   <div class="kpi"><span class="lbl">Příjmy</span><span class="v inc" data-cnt="${inc}">${fmt0.format(inc)}</span><span class="s">${mcount>1?`průměr ${fmt0.format(inc/mcount)} měsíčně`:periodName()}</span></div>
   <div class="kpi"><span class="lbl">Výdaje</span><span class="v exp" data-cnt="${exp}">${fmt0.format(exp)}</span><span class="s">${mcount>1?`průměr ${fmt0.format(exp/mcount)} měsíčně`:periodName()}</span></div>
   <div class="kpi"><span class="lbl">Bilance</span><span class="v ${bal>=0?'inc':'exp'}" data-cnt="${bal}" data-sig="1">${bal>0?'+':''}${fmt0.format(bal)}</span><span class="s">${mcount} ${mcount===1?'měsíc':mcount<5?'měsíce':'měsíců'} v datech</span></div>
   <div class="kpi"><svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="18"/><circle class="arc" cx="22" cy="22" r="18" style="stroke-dashoffset:${(113.1*(1-Math.max(0,Math.min(100,inc?bal/inc*100:0))/100)).toFixed(1)};stroke:${bal>=0?'var(--accent)':'var(--exp)'}"/></svg><span class="lbl">Ušetřeno z příjmů</span><span class="v"${inc?` data-cnt="${Math.round(bal/inc*100)}" data-pct="1"`:''}>${inc?Math.round(bal/inc*100)+' %':'—'}</span><span class="s">${unc?`<span style="color:var(--warn)">${unc} nezařazených výdajů</span>`:'vše roztříděno'}</span></div>`;
  countUp();renderTicker(list,real,inc,exp,bal,mcount);
  renderChart();renderCats(list,mcount);document.body.classList.add('stag');renderTable(list);requestAnimationFrame(()=>setTimeout(()=>document.body.classList.remove('stag'),50));renderSettings();
}
function renderAccounts(){
  const P=$('accPanel');if(!P)return;
  const names=[...new Set(state.tx.map(t=>t.src))];
  if(state.sample||names.length<1){P.hidden=true;return}
  P.hidden=false;
  const per=t=>ui.period==='all'||t.date.startsWith(ui.period);
  const stat=src=>{const L=state.tx.filter(t=>(!src||t.src===src)&&per(t));const R=L.filter(t=>!isTr(t));const i=R.filter(t=>t.amount>0).reduce((a,t)=>a+t.amount,0),e=-R.filter(t=>t.amount<0).reduce((a,t)=>a+t.amount,0);
    const all=state.tx.filter(t=>!src||t.src===src);const a=all.reduce((x,t)=>t.date<x?t.date:x,'9'),b=all.reduce((x,t)=>t.date>x?t.date:x,'0');
    const tr=L.filter(t=>isTr(t)).reduce((x,t)=>x+t.amount,0);return {i,e,b:i-e,n:all.length,a,last:b,tr}};
  const card=(src,title,sub)=>{const s=stat(src);const on=(ui.src||'')===(src||'');const U=(state.ucty||{})[src]||{};
    return `<button class="acc ${on?'on':''}" data-acc="${esc(src||'')}"><span class="lbl">${esc(title)}</span><b class="${s.b>=0?'inc':'exp'}">${s.b>0?'+':''}${fmt0.format(s.b)}</b>
      <span>příjmy <em class="inc">${fmt0.format(s.i)}</em> · výdaje <em class="exp">${fmt0.format(s.e)}</em></span>
      <span class="muted">${sub||(esc(U.cislo||'')+(U.cislo?' · ':'')+`výpisy do ${fmtD(s.last)}`)}${s.tr?` · převody ${s.tr>0?'+':''}${fmt0.format(s.tr)}`:''}</span></button>`};
  const stale=names.filter(n=>{const s=stat(n);return s.last<new Date(Date.now()-40*864e5).toISOString().slice(0,10)});
  P.innerHTML=`<div class="phead"><h2>Účty</h2><span class="muted">${periodName()} · bilance bez převodů mezi vašimi účty</span></div>
    <div class="accs">${card('','Všechny účty dohromady',`${names.length} ${names.length===1?'účet':names.length<5?'účty':'účtů'} · ${state.tx.length} pohybů`)}${names.map(n=>card(n,n)).join('')}</div>
    ${stale.length?`<p class="muted" style="margin:10px 0 0;font-size:12px"><span style="color:var(--warn)">Starší výpisy:</span> ${stale.map(esc).join(', ')} – nahrajte novější, ať sedí souhrn i pravidelné platby.</p>`:''}
    ${ownNums().length<names.length?`<p class="muted" style="margin:6px 0 0;font-size:12px">U účtů bez čísla nepoznám převody mezi vašimi účty. Doplňte čísla v části „Nahraná data“.</p>`:''}`;
  P.querySelectorAll('[data-acc]').forEach(b=>b.onclick=()=>{ui.src=b.dataset.acc;ui.limit=200;render()});
}
function periodName(){if(ui.period==='all')return 'celé období';if(ui.period.length===4)return 'rok '+ui.period;return MONF[+ui.period.slice(5)-1]+' '+ui.period.slice(0,4)}
function renderFilters(){
  const months=[...new Set(state.tx.map(t=>ym(t.date)))].sort().reverse();
  const years=[...new Set(months.map(m=>m.slice(0,4)))];
  if(ui.period!=='all'&&!months.includes(ui.period)&&!years.includes(ui.period))ui.period='all';
  $('fPeriod').innerHTML=`<option value="all">Celé období</option>`+years.map(y=>`<optgroup label="${y}"><option value="${y}">Celý rok ${y}</option>${months.filter(m=>m.startsWith(y)).map(m=>`<option value="${m}">${MONF[+m.slice(5)-1]} ${y}</option>`).join('')}</optgroup>`).join('');
  $('fPeriod').value=ui.period;
  const srcs=[...new Set(state.tx.map(t=>t.src))];
  $('fSrc').innerHTML=`<option value="">Všechny účty</option>`+srcs.map(s=>`<option>${esc(s)}</option>`).join('');
  $('fSrc').value=ui.src;$('fSrc').hidden=srcs.length<2;
  $('fCat').innerHTML=`<option value="">Všechny kategorie</option>`+state.cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('fCat').value=ui.cat;
}
function niceStep(max){const raw=max/4;const p=Math.pow(10,Math.floor(Math.log10(raw||1)));for(const k of [1,2,2.5,5,10])if(raw<=k*p)return k*p;return 10*p}
function kfmt(v){const a=Math.abs(v);return a>=1e6?(v/1e6).toLocaleString('cs-CZ',{maximumFractionDigits:1})+' mil.':a>=1000?Math.round(v/1000)+' tis.':String(Math.round(v))}
function renderChart(){
  const base=state.tx.filter(t=>(!ui.src||t.src===ui.src)&&!isTr(t));
  let months=[...new Set(base.map(t=>ym(t.date)))].sort();
  if(ui.period!=='all')months=months.filter(m=>m.startsWith(ui.period.slice(0,4)));
  months=months.slice(-18);
  if(!months.length){$('chart').innerHTML='<div class="empty">Zatím žádná data.</div>';return}
  const agg=months.map(m=>{let i=0,e=0;for(const t of base)if(t.date.startsWith(m)){if(t.amount>0)i+=t.amount;else e-=t.amount}return{m,i,e,b:i-e}});
  const W=660,H=250,L=58,R=10,T=12,B=30;
  const max=Math.max(1,...agg.map(a=>Math.max(a.i,a.e)));const minB=Math.min(0,...agg.map(a=>a.b));
  const step=niceStep(max-minB);const top=Math.ceil(max/step)*step;const bot=Math.floor(minB/step)*step;
  const y=v=>T+(top-v)/(top-bot)*(H-T-B);
  const gw=(W-L-R)/agg.length;const bw=Math.min(22,gw*0.32);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Měsíční příjmy a výdaje">`;
  for(let v=bot;v<=top+1e-6;v+=step){s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${v===0?'stroke-width="1.5"':'stroke-dasharray="2 3"'}/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${kfmt(v)}</text>`}
  const pts=[];
  agg.forEach((a,k)=>{const cx=L+gw*k+gw/2;const sel=ui.period===a.m;
    if(sel)s+=`<rect x="${L+gw*k+2}" y="${T}" width="${gw-4}" height="${H-T-B}" rx="6" fill="var(--accent-soft)"/>`;
    s+=`<rect class="gb" style="--k:${k}" x="${cx-bw-1}" y="${y(a.i)}" width="${bw}" height="${Math.max(0,y(0)-y(a.i))}" rx="3" fill="var(--inc)"><title>${MONF[+a.m.slice(5)-1]} ${a.m.slice(0,4)} – příjmy ${fmt0.format(a.i)}</title></rect>`;
    s+=`<rect class="gb" style="--k:${k}" x="${cx+1}" y="${y(a.e)}" width="${bw}" height="${Math.max(0,y(0)-y(a.e))}" rx="3" fill="var(--exp)"><title>${MONF[+a.m.slice(5)-1]} ${a.m.slice(0,4)} – výdaje ${fmt0.format(a.e)}</title></rect>`;
    s+=`<text x="${cx}" y="${H-B+16}" text-anchor="middle" ${sel?'style="fill:var(--fg);font-weight:700"':''}>${MON[+a.m.slice(5)-1]}${(k===0||a.m.endsWith('-01'))?' '+a.m.slice(2,4):''}</text>`;
    pts.push([cx,y(a.b),a]);
  });
  agg.forEach((a,k)=>{s+=`<rect class="hit" data-k="${k}" x="${L+gw*k}" y="${T}" width="${gw}" height="${H-T}" fill="transparent"/>`});
  if(pts.length>1)s+=`<polyline class="bl" pathLength="1" points="${pts.map(p=>p[0]+','+p[1]).join(' ')}" fill="none" stroke="var(--fg)" stroke-width="1.5" opacity=".55"/>`;
  pts.forEach((p,k)=>s+=`<circle class="bd" style="--k:${k}" cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="var(--fg)" stroke-width="1.5"><title>Bilance ${fmt0.format(p[2].b)}</title></circle>`);
  $('chart').innerHTML=s+'</svg>';
  wireChart(agg);
}
function renderCats(list,mcount){
  const side=ui.side;const by={};let tot=0;
  for(const t of list){if(isTr(t))continue;if(side==='exp'?t.amount>=0:t.amount<=0)continue;const v=Math.abs(t.amount);by[t.cat]=(by[t.cat]||0)+v;tot+=v}
  const rows=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  if(!rows.length){$('cats').innerHTML='<div class="empty">V tomto období nic.</div>';return}
  const max=rows[0][1];
  $('cats').innerHTML=rows.map(([id,v])=>{const c=catById(id);return `<button class="catrow${ui.cat===id?' on':''}" data-c="${id}">
    <span class="n"><i class="dot" style="background:${c.color}"></i><span>${esc(c.name)}</span></span><span class="a">${fmt0.format(v)}</span>
    <span class="bar"><b style="--k:${rows.findIndex(r=>r[0]===id)};width:${(v/max*100).toFixed(1)}%;background:${c.color}"></b></span>
    <span class="meta">${(v/tot*100).toFixed(1).replace('.',',')} %${mcount>1?` · ${fmt0.format(v/mcount)} / měsíc`:''}</span></button>`}).join('');
  $('cats').querySelectorAll('.catrow').forEach(b=>b.onclick=()=>{ui.cat=ui.cat===b.dataset.c?'':b.dataset.c;ui.limit=200;render()});
}
function renderTable(list){
  const q=tok(ui.q);
  let rows=list.filter(t=>(!ui.cat||t.cat===ui.cat)&&(!ui.unc||t.cat===FALLBACK_EXP)&&(!q||tok([t.party,t.desc,t.note,t.acct,t.vs,t.src].join(' ')).includes(q)));
  rows.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  const sum=rows.reduce((a,t)=>a+(isTr(t)?0:t.amount),0);
  $('txCount').textContent=`${rows.length} pohybů · součet ${fmt0.format(sum)}`;
  $('fUnc').setAttribute('aria-pressed',ui.unc);
  const opts=state.cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if(!rows.length){$('tbody').innerHTML=`<tr><td colspan="5" class="empty">Nic neodpovídá filtru.</td></tr>`;$('moreBtn').hidden=true;return}
  $('tbody').innerHTML=rows.slice(0,ui.limit).map((t,ri)=>`<tr style="--k:${Math.min(ri,25)}" class="${t.cat===FALLBACK_EXP?'unc':''}">
    <td class="d">${fmtD(t.date)}</td>
    <td><div class="p">${esc(t.party||t.acct||'—')}</div><div class="x">${esc([t.desc,t.note,t.vs?'VS '+t.vs:''].filter(Boolean).join(' · '))}</div></td>
    <td class="src">${esc(t.src)}</td>
    <td><select data-id="${esc(t.id)}" aria-label="Kategorie">${opts}</select></td>
    <td class="amt ${isTr(t)?'muted':t.amount>0?'inc':'exp'}">${t.amount>0?'+':''}${fmt2.format(t.amount)}</td></tr>`).join('');
  $('tbody').querySelectorAll('select').forEach(s=>{const t=state.tx.find(x=>x.id===s.dataset.id);s.value=t.cat;s.onchange=()=>setCat(t,s.value)});
  $('moreBtn').hidden=rows.length<=ui.limit;
  $('moreBtn').textContent=`Zobrazit další (${rows.length-ui.limit})`;
}
function setCat(t,cid){
  t.cat=cid;t.manual=true;save();render();
  const kw=tok(t.party)||tok(t.desc).split(' ').slice(0,3).join(' ');
  const c=catById(cid);
  if(kw&&c.id!==FALLBACK_EXP&&c.id!==FALLBACK_INC){
    toast(`Zařazeno do „${c.name}“.`,`Vždy takto: „${kw}“`,()=>{
      if(!c.kw.map(tok).includes(kw))c.kw.unshift(kw);
      // přesunout kategorii výš, aby pravidlo mělo přednost
      recat(false);save();render();toast(`Pravidlo přidáno, pohyby přetříděny.`);
    });
  }else toast(`Zařazeno do „${c.name}“.`);
}
function renderSettings(){
  const typeName={exp:'výdaj',inc:'příjem',transfer:'převod'};
  const cnt={};for(const t of state.tx)cnt[t.cat]=(cnt[t.cat]||0)+1;
  $('rules').innerHTML=state.cats.map((c,i)=>`<div class="rule"><header><span class="n"><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span><span><span class="tag">${typeName[c.type]}</span> <span class="tag num">${cnt[c.id]||0}</span>
    ${i>0?`<button class="btn sm" data-up="${i}" title="Posunout výš" aria-label="Posunout výš">↑</button>`:''}
    ${DEFAULT_CATS.some(d=>d.id===c.id)?'':`<button class="btn sm danger" data-del="${i}" aria-label="Smazat kategorii">×</button>`}</span></header>
    ${c.id===FALLBACK_EXP||c.id===FALLBACK_INC?`<span class="muted" style="font-size:12px">Sem spadne vše, co žádné pravidlo nezachytí.</span>`:`<textarea id="kw-${c.id}" data-i="${i}" aria-label="Klíčová slova ${esc(c.name)}">${esc(c.kw.join(', '))}</textarea>`}</div>`).join('');
  $('rules').querySelectorAll('textarea').forEach(ta=>ta.onchange=()=>{state.cats[+ta.dataset.i].kw=ta.value.split(',').map(s=>s.trim()).filter(Boolean);recat(false);save();render()});
  $('rules').querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{const i=+b.dataset.up;[state.cats[i-1],state.cats[i]]=[state.cats[i],state.cats[i-1]];recat(false);save();render()});
  $('rules').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const c=state.cats.splice(+b.dataset.del,1)[0];for(const t of state.tx)if(t.cat===c.id)t.manual=false;recat(false);save();render()});
  const srcs={};for(const t of state.tx){const s=srcs[t.src]||(srcs[t.src]={n:0,a:'9',b:'0'});s.n++;if(t.date<s.a)s.a=t.date;if(t.date>s.b)s.b=t.date}
  $('srcs').innerHTML=Object.keys(srcs).length?Object.entries(srcs).map(([k,s])=>`<div><span><input type="text" data-ren="${esc(k)}" value="${esc(k)}" aria-label="Název účtu" title="Přejmenovat účet" style="font-weight:700;width:190px"> <span class="muted num">· ${s.n} pohybů · ${fmtD(s.a)} – ${fmtD(s.b)}</span></span><input type="text" data-num="${esc(k)}" value="${esc((state.ucty&&state.ucty[k]&&state.ucty[k].cislo)||'')}" placeholder="číslo účtu" aria-label="Číslo účtu ${esc(k)}" style="width:170px;margin-left:auto"><button class="btn sm danger" data-src="${esc(k)}">Smazat</button></div>`).join(''):'<span class="muted">Nic nenahráno.</span>';
  $('srcs').querySelectorAll('[data-ren]').forEach(i=>i.onchange=()=>{const o=i.dataset.ren,n=i.value.trim();if(!n||n===o)return;
    if(state.tx.some(t=>t.src===n)&&!confirm(`Účet „${n}“ už existuje. Sloučit „${o}“ do něj?`)){i.value=o;return}
    for(const t of state.tx)if(t.src===o){t.src=n;t.id=t.id.replace('|'+o+'#','|'+n+'#')}
    state.ucty=state.ucty||{};if(state.ucty[o]){state.ucty[n]={...state.ucty[o],...(state.ucty[n]||{})};delete state.ucty[o]}
    const pl=RP.get('pravidelne',[]);pl.forEach(x=>{if(x.ucet===o)x.ucet=n});RP.set('pravidelne',pl);
    if(ui.src===o)ui.src=n;save();render();toast(`Účet přejmenován na „${n}“.`)});
  $('srcs').querySelectorAll('[data-num]').forEach(i=>i.onchange=()=>{state.ucty=state.ucty||{};(state.ucty[i.dataset.num]=state.ucty[i.dataset.num]||{}).cislo=i.value.trim();recat(false);save();render();toast('Číslo účtu uloženo, převody mezi účty přetříděny.')});
  $('srcs').querySelectorAll('[data-src]').forEach(b=>armed(b,()=>{state.tx=state.tx.filter(t=>t.src!==b.dataset.src);if(!state.tx.length)state.sample=false;save();render()}));
}
function armed(btn,fn){btn.onclick=()=>{if(btn.classList.contains('armed')){fn()}else{const o=btn.textContent;btn.classList.add('armed');btn.textContent='Opravdu smazat?';setTimeout(()=>{btn.classList.remove('armed');btn.textContent=o},4000)}}}

let toastT;
function toast(msg,actLabel,act){
  const el=$('toast');el.innerHTML=`<span>${esc(msg)}</span>`;
  if(actLabel){const b=document.createElement('button');b.textContent=actLabel;b.onclick=()=>{el.hidden=true;act()};el.appendChild(b)}
  el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,actLabel?9000:4500);
}

/* ---------- sample ---------- */
const SA='Ukázka – běžný účet';
function sampleData(){
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const r=(a,b)=>Math.round(a+rnd()*(b-a));
  const out=[];const now=new Date();
  const add=(src,y,m,d,amount,party,desc='')=>out.push({src,date:ymd(y,m,Math.min(d,28)),amount,party,desc,note:'',acct:'',vs:''});
  for(let k=6;k>=1;k--){
    const dt=new Date(now.getFullYear(),now.getMonth()-k,1);const y=dt.getFullYear(),m=dt.getMonth()+1;
    const A=(d,a,p,x='Platba kartou')=>add(SA,y,m,d,a,p,x);const K=(d,a,p)=>add(SA,y,m,d,a,p,'Platba kartou');
    A(10,48500,'Výplata – mzda','MZDA '+pad(m)+'/'+y);
    A(12,31200,'Mzda partnerka','VYPLATA');
    A(15,-14600,'Hypoteční banka','Splátka hypotéky');
    A(15,-3850,'SVJ Lipová 12','Zálohy na služby');
    A(20,-2150,'ČEZ Prodej','Záloha na elektřinu');
    A(5,-899,'O2 Czech Republic','Mobil a internet');
    A(2,-1240,'Kooperativa pojišťovna','Pojištění domácnosti a auta');
    A(11,-3000,'XTB S.A.','Pravidelná investice');
    for(let i=0;i<5;i++)A(r(1,28),-r(380,1900),['ALBERT 1042','LIDL Plzeňská','KAUFLAND','BILLA','Rohlik.cz'][i]);
    for(let i=0;i<3;i++)A(r(1,28),-r(350,1600),['LIDL Plzeňská','ALBERT 1042','PENNY MARKET'][i]);
    A(r(1,14),-r(1100,1800),'BENZINA 0315');
    A(r(15,28),-r(1100,1800),'OMV 2241');
    A(r(1,28),-r(250,900),'DM DROGERIE MARKT');
    A(r(1,28),-r(180,650),'Dr.Max lékárna');
    A(r(1,28),-2000,'Bankomat Komerční banka','Výběr z bankomatu');
    A(r(1,28),-r(150,2400),'Papírnictví u nádraží');
    if(m===9||m===10)A(3,-1800,'DDM – kroužek','Kroužek keramiky');
    A(13,-33000,'Spořicí účet','Převod mezi účty');
    K(8,-259,'NETFLIX.COM');
    K(r(1,28),-r(600,1900),'Restaurace U Zlatého lva');
    K(r(1,28),-r(320,720),'WOLT');
    K(r(1,28),-r(400,2500),'ALZA.CZ');
    if(m%3===0)K(r(1,28),-r(1200,3800),'DECATHLON');
    if(m%2===0)K(r(1,28),-r(900,2600),'ZARA');
  }
  return out.map((t,i)=>{const n={id:'s'+i,...t,manual:false};n.cat=autoCat(n);return n});
}
function loadSample(){
  state.tx=sampleData();state.sample=true;
}

/* ---------- events ---------- */
const drop=$('drop');
$('file').onchange=e=>{handleFiles([...e.target.files]);e.target.value=''};
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
$('fPeriod').onchange=e=>{ui.period=e.target.value;ui.limit=200;render()};
$('fSrc').onchange=e=>{ui.src=e.target.value;ui.limit=200;render()};
$('fCat').onchange=e=>{ui.cat=e.target.value;ui.limit=200;render()};
$('q').oninput=e=>{ui.q=e.target.value;ui.limit=200;renderTable(scoped())};
$('fUnc').onclick=()=>{ui.unc=!ui.unc;ui.limit=200;render()};
$('moreBtn').onclick=()=>{ui.limit+=300;renderTable(scoped())};
$('segExp').onclick=()=>{ui.side='exp';$('segExp').setAttribute('aria-pressed','true');$('segInc').setAttribute('aria-pressed','false');render()};
$('segInc').onclick=()=>{ui.side='inc';$('segInc').setAttribute('aria-pressed','true');$('segExp').setAttribute('aria-pressed','false');render()};
$('addCat').onclick=()=>{const n=$('newCatName').value.trim();if(!n)return;const type=$('newCatType').value;
  const palette=['#A3478F','#3E8E7E','#C7652E','#5866B8','#8A9A2C','#B54A6A'];
  state.cats.splice(state.cats.findIndex(c=>c.id===FALLBACK_INC),0,{id:'c'+Date.now(),name:n,type,color:palette[state.cats.length%palette.length],kw:[]});
  $('newCatName').value='';save();render();toast(`Kategorie „${n}“ přidána. Doplňte klíčová slova.`)};
$('reapply').onclick=()=>{recat(true);save();render();toast('Vše přetříděno podle pravidel.')};
armed($('wipe'),()=>{state.tx=[];state.sample=false;save();render();toast('Data smazána.')});

if(!load()||state.sample||!state.tx.length){loadSample();save()}else save();
if(state.needsRecat){recat(false);delete state.needsRecat;save()}
/* ---------- motion & interaction ---------- */
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(){
  document.querySelectorAll('[data-cnt]').forEach(el=>{
    const to=+el.dataset.cnt,sig=el.dataset.sig,pct=el.dataset.pct;
    const f=v=>pct?Math.round(v)+' %':(sig&&v>0?'+':'')+fmt0.format(v);
    if(RM){el.textContent=f(to);return}
    const t0=performance.now(),d=1100;
    const step=now=>{const k=Math.min(1,(now-t0)/d),e=1-Math.pow(1-k,4);el.textContent=f(to*e);if(k<1)requestAnimationFrame(step)};
    requestAnimationFrame(step);
  });
}
function wireChart(agg){
  const box=$('chart'),tip=$('tip');
  box.querySelectorAll('.hit').forEach(h=>{
    const a=agg[+h.dataset.k];
    h.onmouseenter=()=>{box.querySelectorAll('.gb').forEach(r=>r.classList.toggle('dim',r.style.getPropertyValue('--k')!=h.dataset.k));
      tip.innerHTML=`<b>${MONF[+a.m.slice(5)-1]} ${a.m.slice(0,4)}</b><span>Příjmy <em class="inc">${fmt0.format(a.i)}</em></span><span>Výdaje <em class="exp">${fmt0.format(a.e)}</em></span><span>Bilance <em class="${a.b>=0?'inc':'exp'}">${a.b>0?'+':''}${fmt0.format(a.b)}</em></span><small>${ui.period===a.m?'Klik: zpět na celé období':'Klik: zobrazit jen tento měsíc'}</small>`;
      tip.hidden=false};
    h.onmousemove=e=>{const r=box.parentElement.getBoundingClientRect();let x=e.clientX-r.left+16,y=e.clientY-r.top+12;if(x+190>r.width)x-=210;tip.style.transform=`translate(${x}px,${y}px)`};
    h.onmouseleave=()=>{tip.hidden=true;box.querySelectorAll('.gb').forEach(r=>r.classList.remove('dim'))};
    h.onclick=()=>{tip.hidden=true;ui.period=ui.period===a.m?'all':a.m;ui.limit=200;render()};
  });
}
function renderTicker(list,real,inc,exp,bal,mcount){
  const items=[];const ex=real.filter(t=>t.amount<0);
  if(ex.length){const big=ex.reduce((a,t)=>t.amount<a.amount?t:a);items.push(`Největší výdaj: <b>${esc(big.party||big.desc||'—')}</b> <span class="exp">${fmt0.format(big.amount)}</span> (${fmtD(big.date)})`)}
  const by={};for(const t of ex)by[t.cat]=(by[t.cat]||0)-t.amount;
  const top=Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
  if(top&&exp)items.push(`Nejvíc peněz jde na <b>${esc(catById(top[0]).name)}</b>: ${Math.round(top[1]/exp*100)} % výdajů`);
  const ms=[...new Set(real.map(t=>ym(t.date)))].sort();
  if(ms.length>=2){const [p,c]=ms.slice(-2);const sumBy=m=>{const o={};for(const t of ex)if(t.date.startsWith(m))o[t.cat]=(o[t.cat]||0)-t.amount;return o};
    const P=sumBy(p),C=sumBy(c);let best=null;
    for(const k in C){if((P[k]||0)<300)continue;const d=(C[k]-P[k])/P[k];if(!best||Math.abs(d)>Math.abs(best[1]))best=[k,d]}
    if(best)items.push(`<b>${esc(catById(best[0]).name)}</b> ${MONF[+c.slice(5)-1]} vs. ${MONF[+p.slice(5)-1]}: <span class="${best[1]>0?'exp':'inc'}">${best[1]>0?'▲ +':'▼ '}${Math.round(best[1]*100)} %</span>`)}
  if(list.length){const days=Math.max(1,(new Date(list.reduce((a,t)=>t.date>a?t.date:a,'0'))-new Date(list.reduce((a,t)=>t.date<a?t.date:a,'9')))/864e5+1);
    items.push(`Průměrně utratíte <b>${fmt0.format(exp/days)}</b> denně`)}
  if(inc)items.push(bal>=0?`Z příjmů zůstalo <span class="inc">${fmt0.format(bal)}</span>`:`Výdaje převyšují příjmy o <span class="exp">${fmt0.format(-bal)}</span>`);
  const unc=list.filter(t=>t.cat===FALLBACK_EXP).length;if(unc)items.push(`<span style="color:var(--warn)">${unc} výdajů čeká na zařazení</span>, klikněte na „Jen nezařazené“`);
  const intr=-list.filter(t=>t.cat==='uroky').reduce((s,t)=>s+t.amount,0);if(intr>0)items.push(`Úroky a poplatky z dluhů stály <span class="exp">${fmt0.format(intr)}</span>`);
  const html=items.map(i=>`<span class="ti">${i}</span>`).join('');
  $('tk').innerHTML=html+html;$('ticker').hidden=!items.length;
  $('tk').style.animationDuration=Math.max(25,items.length*9)+'s';
}


/* ---------- pravidelné platby: panel ---------- */
let rpYmSel=App.today().slice(0,7), rpEdit=false;
const RPCSS=`#rpPanel .rp-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;gap:6px 14px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
#rpPanel .rp-row:last-child{border-bottom:0}
#rpPanel .rp-dot{width:12px;height:12px;border-radius:50%;background:var(--muted)}
#rpPanel .ok .rp-dot{background:var(--inc);box-shadow:0 0 8px var(--inc)}#rpPanel .late .rp-dot{background:var(--exp);box-shadow:0 0 8px var(--exp);animation:blink 1.4s infinite}#rpPanel .wait .rp-dot{background:var(--warn)}
#rpPanel .rp-n b{display:block}#rpPanel .rp-n span{font-size:12px;color:var(--muted)}
#rpPanel .rp-a{font-family:var(--f-mono);text-align:right}
#rpPanel .rp-s{font-size:12px;text-align:right;min-width:150px}
#rpPanel .rp-nav{display:flex;align-items:center;gap:6px}
#rpPanel .rp-ed{width:100%;border-collapse:collapse;font-size:13px}#rpPanel .rp-ed td{padding:4px 4px;border-bottom:1px solid var(--line)}#rpPanel .rp-ed input,#rpPanel .rp-ed select{width:100%;min-width:60px;padding:5px 7px}
@media (max-width:640px){#rpPanel .rp-row{grid-template-columns:auto minmax(0,1fr) auto}#rpPanel .rp-s{grid-column:2/-1;text-align:left;min-width:0}#rpPanel .rp-row .btn{grid-column:2/-1;justify-self:start}}`;
App.css('rozpocet-rp',RPCSS+`
#rpPanel .rp-sug{border:1px dashed var(--accent);border-radius:var(--r);padding:12px;margin-bottom:12px;background:var(--accent-soft)}
#rpPanel .rp-sg{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer}
#rpPanel .rp-sg:last-of-type{border-bottom:0}
#accPanel .accs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:10px}
#accPanel .acc{display:flex;flex-direction:column;gap:4px;text-align:left;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--card);color:var(--fg);font-size:12px;transition:border-color .2s,box-shadow .2s}
#accPanel .acc b{font:700 20px var(--f-mono)}#accPanel .acc em{font-style:normal}
#accPanel .acc:hover{border-color:var(--accent)}#accPanel .acc.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 0 18px var(--accent-soft)}
#accPanel .acc:first-child{background:var(--accent-soft)}`);
function renderRP(){
  const P=$('rpPanel'); if(!P)return;
  const ym=rpYmSel, L=rpMonth(ym), td=App.today(), own=RP.get('pravidelne',[]), manual=RP.get('rucne',{});
  const ok=L.filter(x=>x.state==='ok'), late=L.filter(x=>x.state==='late');
  const left=L.filter(x=>x.state!=='ok').reduce((a,x)=>a+ +x.it.castka,0), total=L.reduce((a,x)=>a+ +x.it.castka,0);
  const yearly=rpItems().reduce((a,x)=>a+ +x.castka*12/RP_FREQ[x.freq||'m'][1],0);
  const rel=d=>{const n=rpDays(td,d);return n===0?'dnes':n===1?'zítra':n>0?`za ${n} dní`:n===-1?'včera':`před ${-n} dny`};
  const noTx=!rpReadTx().length, skryte=RP.get('skryte',[]);
  const SG=noTx?[]:rpSuggest().filter(x=>!skryte.includes(x.klic));
  const sugHtml=SG.length?`<div class="rp-sug"><div class="phead" style="margin:0 0 6px"><b>Nalezeno ve výpisech: ${SG.length}</b><span class="muted" style="font-size:12px">zaškrtnuté se přidají</span></div>
    ${SG.map((x,i)=>`<label class="rp-sg"><input type="checkbox" data-sg="${i}"${x.typ?' checked':''}><span><b>${esc(x.nazev)}</b><span class="muted"> · ${x.typ?RP_TYP[x.typ]+' · ':''}${RP_FREQ[x.freq][0]} · kolem ${x.den}. dne · ${x.pocet}× ve výpisech · ${esc(x.ucet)}</span></span><span class="rp-a">${fmt0.format(x.castka)}</span></label>`).join('')}
    <div class="acts" style="margin-top:8px"><button class="btn sm primary" id="rpSgAdd">Přidat vybrané</button><button class="btn sm" id="rpSgHide">Skrýt nevybrané</button></div></div>`:'';
  P.innerHTML=`${''}<div class="phead"><h2>Pravidelné platby</h2><div class="rp-nav"><button class="btn sm" id="rpPrev" aria-label="Předchozí měsíc">‹</button><b style="min-width:120px;text-align:center">${MONF[+ym.slice(5)-1]} ${ym.slice(0,4)}</b><button class="btn sm" id="rpNext" aria-label="Další měsíc">›</button></div></div>${sugHtml}
    ${L.length?`<p class="muted" style="margin:0 0 6px">Zaplaceno <b style="color:var(--inc)">${ok.length} z ${L.length}</b> · zbývá zaplatit <b>${fmt0.format(left)}</b> z ${fmt0.format(total)}${late.length?` · <b style="color:var(--exp)">${late.length} po splatnosti</b>`:''} · ročně celkem ${fmt0.format(yearly)}</p>
    <div>${L.map(x=>`<div class="rp-row ${x.state}"><i class="rp-dot" aria-hidden="true"></i>
      <span class="rp-n"><b>${esc(x.it.nazev)}</b><span>${x.it.auto?'z modulu Hypotéka · ':''}${x.it.ucet?esc(x.it.ucet)+' · ':''}${x.it.zpusob==='trvaly'?'trvalý příkaz / inkaso':'platím ručně'}${x.it.freq&&x.it.freq!=='m'?' · '+RP_FREQ[x.it.freq][0]:''}${x.it.pozn?' · '+esc(x.it.pozn):''}</span></span>
      <span class="rp-a">${fmt0.format(x.it.castka)}</span>
      <span class="rp-s">${x.state==='ok'?`<span style="color:var(--inc)">zaplaceno ${fmtD(x.paid.date)}</span><br><span class="muted">${x.paid.how==='výpis'?'podle výpisu'+(Math.abs(x.paid.amount-x.it.castka)>1?' ('+fmt0.format(x.paid.amount)+')':''):'označeno ručně'}</span>`:x.state==='late'?`<span style="color:var(--exp)">splatné ${fmtD(x.date)}</span><br><span class="muted">${rel(x.date)}</span>`:`splatné ${fmtD(x.date)}<br><span class="muted">${rel(x.date)}</span>`}</span>
      ${x.state==='ok'&&x.paid.how==='výpis'?'<span></span>':`<button class="btn sm" data-rpmark="${esc(x.it.id)}">${x.state==='ok'?'Zrušit':'Zaplaceno'}</button>`}</div>`).join('')}</div>`
    :`<p class="muted" style="margin:0">${own.length?'V tomto měsíci nic není splatné.':'Zatím tu nic není. Přidejte platby, na které nechcete zapomenout – nájem, energie, pojištění, školka, předplatné…'}</p>`}
    ${noTx&&L.length?'<p class="muted" style="font-size:12px;margin:6px 0 0">Bez nahraných výpisů se zaplacení pozná jen podle ručního odškrtnutí.</p>':''}
    <details style="margin-top:12px" ${rpEdit||!own.length?'open':''} id="rpDet"><summary class="muted" style="cursor:pointer">Upravit seznam plateb</summary>
      <div class="tablebox" style="margin-top:8px"><table class="rp-ed"><thead><tr><th>Název</th><th>Částka Kč</th><th>Den</th><th>Jak často</th><th>Od měsíce</th><th>Platím</th><th>Poznat ve výpisu podle</th><th></th></tr></thead><tbody>
      ${own.map((x,i)=>`<tr><td><input data-rp="${i}.nazev" value="${esc(x.nazev)}" aria-label="Název"></td><td><input type="number" step="1" min="0" data-rp="${i}.castka" value="${x.castka}" style="width:100px" aria-label="Částka"></td>
        <td><input type="number" min="1" max="31" data-rp="${i}.den" value="${x.den}" style="width:60px" aria-label="Den v měsíci"></td>
        <td><select data-rp="${i}.freq" aria-label="Jak často">${Object.entries(RP_FREQ).map(([k,[l]])=>`<option value="${k}"${(x.freq||'m')===k?' selected':''}>${l}</option>`).join('')}</select></td>
        <td><select data-rp="${i}.mesic" aria-label="Od měsíce"${(x.freq||'m')==='m'?' disabled':''}>${MONF.map((m,j)=>`<option value="${j+1}"${+(x.mesic||1)===j+1?' selected':''}>${m}</option>`).join('')}</select></td>
        <td><select data-rp="${i}.zpusob" aria-label="Způsob"><option value="rucne"${x.zpusob!=='trvaly'?' selected':''}>ručně</option><option value="trvaly"${x.zpusob==='trvaly'?' selected':''}>trvalý příkaz / inkaso</option></select></td>
        <td><input data-rp="${i}.klic" value="${esc(x.klic||'')}" placeholder="např. ČEZ, VS 123" aria-label="Klíčová slova"></td>
        <td><button class="btn sm danger" data-rpdel="${i}" aria-label="Smazat">×</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="acts" style="margin-top:8px"><button class="btn sm primary" id="rpAdd">+ Přidat platbu</button><button class="btn sm" id="rpSug">Znovu prohledat výpisy</button></div>
      <div id="rpSugBox"></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Zaplaceno se pozná samo, když ve výpisu najdu platbu se stejnou částkou (±2 %) do 12 dnů od splatnosti. Když se částka mění (energie), vyplňte „Poznat ve výpisu podle“ – název příjemce, část zprávy nebo VS. Splátku hypotéky doplňuje modul Hypotéka sám.</p>
    </details>`;
  $('rpPrev').onclick=()=>{rpYmSel=rpAddMonths(rpYmSel,-1);renderRP()};
  $('rpNext').onclick=()=>{rpYmSel=rpAddMonths(rpYmSel,1);renderRP()};
  const saveOwn=a=>{RP.set('pravidelne',a);rpEdit=true;renderRP()};
  P.querySelectorAll('[data-rpmark]').forEach(b=>b.onclick=()=>{const k=b.dataset.rpmark+'|'+ym, m=RP.get('rucne',{});if(m[k])delete m[k];else m[k]=td.startsWith(ym)?td:rpDueDate(rpItems().find(x=>x.id===b.dataset.rpmark)||{den:1},ym);RP.set('rucne',m);renderRP();toast(m[k]?'Označeno jako zaplacené.':'Označení zrušeno.')});
  P.querySelectorAll('[data-rp]').forEach(i=>i.onchange=()=>{const [ix,f]=i.dataset.rp.split('.'),a=RP.get('pravidelne',[]);a[+ix][f]=i.type==='number'?(+i.value||0):i.value;saveOwn(a)});
  P.querySelectorAll('[data-rpdel]').forEach(b=>b.onclick=()=>{const a=RP.get('pravidelne',[]);a.splice(+b.dataset.rpdel,1);saveOwn(a)});
  $('rpAdd').onclick=()=>{const a=RP.get('pravidelne',[]);a.push({id:'p'+Date.now().toString(36),nazev:'Nová platba',castka:0,den:15,freq:'m',zpusob:'rucne',klic:''});saveOwn(a);setTimeout(()=>{const inp=P.querySelectorAll('[data-rp$=".nazev"]');inp[inp.length-1]?.select()},0)};
  $('rpSug').onclick=()=>{RP.set('skryte',[]);renderRP();toast(SG.length?'Návrhy jsou nahoře.':'Ve výpisech jsem nic dalšího nenašel.')};
  const sa=$('rpSgAdd');if(sa)sa.onclick=()=>{const a=RP.get('pravidelne',[]);let n=0;P.querySelectorAll('[data-sg]').forEach(c=>{if(!c.checked)return;const x=SG[+c.dataset.sg];a.push({id:'p'+Date.now().toString(36)+n,nazev:x.nazev,castka:x.castka,den:x.den,freq:x.freq,mesic:x.mesic,zpusob:'trvaly',klic:x.klic,ucet:x.ucet,typ:x.typ});n++});RP.set('pravidelne',a);renderRP();toast(n?`Přidáno ${n} plateb.`:'Nic nebylo vybráno.')};
  const sh=$('rpSgHide');if(sh)sh.onclick=()=>{const k=RP.get('skryte',[]);P.querySelectorAll('[data-sg]').forEach(c=>{if(!c.checked)k.push(SG[+c.dataset.sg].klic)});RP.set('skryte',k);renderRP()};
  $('rpDet').ontoggle=e=>{rpEdit=e.target.open};
}

render();renderRP();
const rpOff=App.bus.on('store:change',e=>{if(e&&e.ns==='hypoteka')renderRP()});
return ()=>rpOff();
  }
});
})();
