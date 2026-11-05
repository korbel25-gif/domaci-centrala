/* =====================================================================
   MODUL: Faktury (OSVČ)
   Vystavení faktur, odběratelé, QR platba, sledování úhrad,
   obrat vůči limitu pro registraci k DPH.
   Data: App.store('faktury') → klíč 'data'
   Propojení: poslouchá 'rozpocet:import' a páruje příchozí platby
              podle variabilního symbolu (= číslo faktury) a částky.
   ===================================================================== */
(function () {
  const { fmt, esc } = App;

  App.css('faktury', `
  .fa-list .p{font-family:var(--f-mono)}
  .fa-ed{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:16px}
  @media (max-width:1100px){.fa-ed{grid-template-columns:1fr}}
  .fa-items{display:flex;flex-direction:column;gap:8px}
  .fa-item{display:grid;grid-template-columns:minmax(0,3fr) minmax(60px,.8fr) minmax(54px,.7fr) minmax(80px,1fr) auto;gap:6px;align-items:center}
  .fa-item.dph{grid-template-columns:minmax(0,3fr) minmax(60px,.8fr) minmax(54px,.7fr) minmax(80px,1fr) minmax(56px,.6fr) auto}
  .fa-item input,.fa-item select{width:100%;min-width:0}
  .paperwrap{overflow-x:auto;position:sticky;top:16px}
  .paper{background:#fff;color:#151821;width:100%;min-width:520px;aspect-ratio:210/297;padding:34px 38px;font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:11px;line-height:1.45;
    box-shadow:0 0 0 1px rgba(46,240,255,.35),0 0 40px rgba(46,240,255,.18);display:flex;flex-direction:column;gap:18px;border-radius:2px}
  .paper h3{font-family:"Chakra Petch",sans-serif;font-size:22px;letter-spacing:.06em;text-transform:uppercase;color:#151821;margin:0}
  .paper .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #151821;padding-bottom:10px}
  .paper .hd .no{text-align:right;font-family:"JetBrains Mono",monospace;font-size:14px}
  .paper .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .paper .cap{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#6b7182;margin-bottom:3px}
  .paper .ph{color:#b04a5a;font-style:italic}
  .paper table{min-width:0;width:100%;border-collapse:collapse}
  .paper th{color:#6b7182;font-size:9px;border-bottom:1px solid #151821;padding:5px 4px;opacity:1;font-family:inherit;letter-spacing:.1em}
  .paper td{border-bottom:1px solid #e3e5ea;padding:6px 4px;color:#151821}
  .paper .r{text-align:right;font-family:"JetBrains Mono",monospace;white-space:nowrap}
  .paper .sum{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:auto}
  .paper .tot{text-align:right}.paper .tot b{display:block;font-size:22px;font-family:"JetBrains Mono",monospace}
  .paper .qr{display:flex;gap:10px;align-items:center;font-size:9px;color:#6b7182}
  .paper .qr .q{width:96px;height:96px;display:grid;place-items:center;border:1px dashed #c8ccd6;text-align:center;font-size:9px}
  .paper .qr img,.paper .qr canvas{width:96px!important;height:96px!important}
  .paper .ft{border-top:1px solid #e3e5ea;padding-top:8px;color:#6b7182;font-size:9.5px}
  .fa-rev input,.fa-rev select{padding:5px 7px;font-size:13px}
  .fa-rev tr.off td{opacity:.45}
  .fa-bars{display:flex;gap:6px;align-items:flex-end;height:110px}
  .fa-bars div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;height:100%;min-width:0}
  .fa-bars i{width:100%;transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.8,.2,1) both;background:linear-gradient(180deg,#C77DFF,rgba(199,125,255,.25));box-shadow:0 0 10px rgba(199,125,255,.4)}
  .fa-bars span{font-size:10px;color:var(--muted);font-family:var(--f-mono)}
  #faPrint{display:none}
  @media print{
    /* tiskne se jen kopie faktury vložená do #faPrint, všechno ostatní je skryté → vždy právě 1 strana */
    html,body{background:#fff!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important}
    body.fa-printing>*:not(#faPrint){display:none!important}
    body.fa-printing::before,body.fa-printing::after{display:none!important}
    #faPrint{display:block!important}
    #faPrint .paper{width:210mm;height:297mm;min-width:0;aspect-ratio:auto;box-shadow:none;border-radius:0;padding:14mm 16mm;font-size:10pt;overflow:hidden;break-after:avoid;page-break-after:avoid}
    @page{size:A4;margin:0}
  }`);

  /* ---------- data ---------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) };
  // osobní údaje dodavatele se vyplňují v Nastavení (v kódu nejsou, kód je veřejný)
  const CFG0 = { rateSrc: 'mzda', name: '', addr: '', ico: '', dic: '', platce: false, ucet: '', email: '', tel: '',
    zapis: 'Fyzická osoba zapsaná v živnostenském rejstříku.', splatnost: 10, limit: 2000000, cislo: 'MMRRRR', sazba: '',
    pravidelne: [{ t: 'Projekční práce na Vašich zakázkách dle SoD', p: 45000, on: true }, { t: 'Gemini Pro Ai - předplatné', p: 550, on: false }],
    mailPredmet: 'Faktura č. {cislo}',
    mailText: 'Dobrý den,\n\nv příloze zasílám fakturu č. {cislo} na částku {castka} se splatností {splatnost}.\nPlatbu prosím pošlete na účet {ucet}, variabilní symbol {vs}.\n\nDěkuji a přeji hezký den\n{jmeno}\n{telefon}' };

  /* ---------- PDF faktury a odeslání e-mailem ---------- */
  const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const dlCap = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);   // ukládání souborů v publikované verzi
  async function invoicePdf(el) {
    await loadScript(H2C); await loadScript(JSPDF);
    const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, onclone: doc => { const p = doc.getElementById(el.id); if (p) { p.style.boxShadow = 'none'; p.style.minWidth = '0'; p.style.width = '794px' } } });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const h = canvas.height * 210 / canvas.width;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, Math.min(h, 297));
    return pdf.output('blob');
  }
  async function saveFile(blob, name) {
    const dl = await dlCap;
    if (dl) { await dl.save({ filename: name, data: blob }); return 'saved' }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500); return 'downloaded';
  }
  function fillTpl(t, d, inv) {
    const tot = totals(inv, d.cfg.platce).total;
    const map = { cislo: inv.cislo, castka: fmt.czk2(tot), splatnost: fmt.date(inv.splatnost), vs: vsOf(inv.cislo), ucet: d.cfg.ucet || '', jmeno: d.cfg.name || '', telefon: d.cfg.tel || '', odberatel: inv.client?.name || '' };
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);
  }
  const ATELIER = { name: 'Atelier Kozák s.r.o.', addr: 'Nádražní 169\n517 73 Opočno', ico: '28813863', dic: 'CZ28813863', email: '' };
  function load(store) {
    let d = store.get('data', null);
    if (!d) { d = sample(); store.set('data', d) }
    d.cfg = Object.assign({}, CFG0, d.cfg || {}); d.clients = d.clients || []; d.inv = d.inv || [];
    for (const k of ['name', 'addr', 'ico', 'ucet', 'email', 'tel']) if (!d.cfg[k]) d.cfg[k] = CFG0[k];
    if (!d.cfg.rateV2) { d.cfg.rateSrc = 'mzda'; d.cfg.rateV2 = true }   // fakturuje se mzdová část z Naviga
    if (!d.clients.some(c => c.ico === ATELIER.ico)) d.clients.unshift({ id: uid(), ...ATELIER });
    return d;
  }
  const lineBase = it => (+it.q || 0) * (+it.p || 0);
  const totals = (inv, platce) => { if (inv.fixed && inv.fixed.total != null) { const t = +inv.fixed.total, b = inv.fixed.base ?? t; return { base: b, vat: t - b, total: t } } let base = 0, vat = 0; for (const it of inv.items) { const b = lineBase(it); base += b; if (platce) vat += b * (+it.v || 0) / 100 } return { base, vat, total: Math.round((base + vat) * 100) / 100 } };
  const status = inv => inv.stav === 'zaplaceno' ? ['zaplaceno', 'ok'] : inv.stav === 'koncept' ? ['koncept', 'dim'] : inv.splatnost < App.today() ? ['po splatnosti', 'bad'] : ['čeká na úhradu', 'warn'];
  function nextNo(d, y, date) {
    if ((d.cfg?.cislo || CFG0.cislo) === 'MMRRRR') {   // např. 072026 = červenec 2026
      const dd = date || App.today(), base = dd.slice(5, 7) + dd.slice(0, 4), taken = new Set(d.inv.map(i => String(i.cislo)));
      if (!taken.has(base)) return base; for (let n = 2; ; n++) if (!taken.has(base + '-' + n)) return base + '-' + n;
    }
    return nextSeq(d, y);
  }
  function nextSeq(d, y) {
    // pokračuje v číselné řadě posledního dokladu roku (např. 2026007 → 2026008, FA-2026-012 → FA-2026-013)
    const yr = d.inv.map(i => String(i.cislo)).filter(c => c.includes(y) && /\d+$/.test(c));
    if (!yr.length) return y + '001';
    const tail = c => +(c.match(/(\d+)$/)[1].slice(c.match(/(\d+)$/)[1].startsWith(y) ? 4 : 0) || 0);
    const last = yr.sort((a, b) => tail(b) - tail(a))[0], m = last.match(/^(.*?)(\d+)$/);
    if (m[2].startsWith(y) && m[2].length > 4) return m[1] + y + String(+m[2].slice(4) + 1).padStart(m[2].length - 4, '0');
    return m[1] + String(+m[2] + 1).padStart(m[2].length, '0');
  }
  const vsOf = c => String(c || '').replace(/\D/g, '').slice(-10);

  /* Převod čísla účtu (prefix-číslo/banka) na IBAN */
  function czIban(acc) {
    const s = String(acc || '').replace(/\s/g, '');
    if (/^CZ\d{22}$/i.test(s)) return s.toUpperCase();
    const m = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/); if (!m) return null;
    const bban = m[3] + (m[1] || '').padStart(6, '0') + m[2].padStart(10, '0');
    const chk = 98n - BigInt(bban + '123500') % 97n;
    return 'CZ' + String(chk).padStart(2, '0') + bban;
  }
  /* Řetězec pro QR Platbu (formát SPAYD) */
  function spayd(d, inv) {
    const iban = czIban(d.cfg.ucet); if (!iban) return null;
    const t = totals(inv, d.cfg.platce).total;
    return `SPD*1.0*ACC:${iban}*AM:${t.toFixed(2)}*CC:CZK*X-VS:${vsOf(inv.cislo)}*DT:${inv.splatnost.replace(/-/g, '')}*MSG:${('Faktura ' + inv.cislo).slice(0, 60)}`;
  }

  /* Párování plateb z bankovních výpisů */
  function match(d, txs) {
    let n = 0;
    for (const inv of d.inv) {
      if (inv.stav !== 'vystaveno') continue;
      const t = totals(inv, d.cfg.platce).total, no = String(inv.cislo);
      const hit = (txs || []).find(x => x.amount > 0 && Math.abs(x.amount - t) < 0.5 &&
        (String(x.vs || '').replace(/^0+/, '') === vsOf(no).replace(/^0+/, '') || `${x.desc} ${x.note} ${x.party}`.includes(no)));
      if (hit) { inv.stav = 'zaplaceno'; inv.paid = hit.date; inv.paidFrom = 'výpis: ' + (hit.src || ''); n++ }
    }
    return n;
  }
  function budgetTx() { try { return (JSON.parse(App.raw.get('rodinny-rozpocet-v1') || 'null') || {}).tx || [] } catch (e) { return [] } }

  /* ---------- ukázka ---------- */
  function sample() {
    const c1 = { id: uid(), name: 'Ukázkový klient s.r.o.', addr: 'Dlouhá 1\n110 00 Praha 1', ico: '', dic: '', email: '' };
    const c2 = { id: uid(), name: 'Projekční kancelář Ukázka', addr: 'Krátká 5\n500 02 Hradec Králové', ico: '', dic: '', email: '' };
    const mk = (no, cl, date, items, stav, paid) => ({ id: uid(), cislo: no, clientId: cl.id, client: { ...cl }, vystaveno: date, duzp: date, splatnost: addDays(date, 14), items, note: '', stav, paid: paid || null });
    const it = (t, q, u, p) => ({ t, q, u, p, v: 21 });
    const y = new Date().getFullYear();
    return {
      sample: true, cfg: { ...CFG0, name: '' }, clients: [c1, c2], inv: [
        mk(y + '001', c1, `${y}-01-20`, [it('Zpracování dokumentace pro stavební povolení', 1, 'ks', 18000)], 'zaplaceno', `${y}-02-01`),
        mk(y + '002', c2, `${y}-03-11`, [it('Projektové práce – DPS', 35, 'hod', 650), it('Vizualizace', 1, 'ks', 1750)], 'zaplaceno', `${y}-03-24`),
        mk(y + '003', c1, `${y}-06-02`, [it('Autorský dozor', 16, 'hod', 750)], 'zaplaceno', `${y}-06-14`),
        mk(y + '004', c2, `${y}-09-08`, [it('Projektové práce – DPS', 40, 'hod', 650), it('Výkaz výměr', 1, 'ks', 5000)], 'vystaveno'),
        mk(y + '005', c1, App.today().slice(0, 8) + '01', [it('Konzultace', 12, 'hod', 800), it('Úprava výkresů', 8, 'hod', 750)], 'vystaveno'),
        mk(y + '006', c2, App.today(), [it('Studie interiéru', 1, 'ks', 9500)], 'koncept')
      ]
    };
  }


  /* =================================================================
     IMPORT STARŠÍCH FAKTUR
     PDF (Billdu i jiné programy), XLS/XLSX/CSV export seznamu faktur, ISDOC.
     Výsledek je vždy seznam záznamů ke kontrole:
     { cislo, klient, ico, dic, adresa, vystaveno, splatnost, total, base, mena, stav, paid, items?, zdroj, varovani[] }
     ================================================================= */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const loadScript = src => new Promise((ok, err) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('Knihovnu se nepodařilo načíst (chybí internet?)')); document.head.appendChild(s) });
  async function loadPdfJs() {
    if (window.pdfjsLib) return;
    // worker načteme jako obyčejný skript → pdf.js poběží v hlavním vlákně (funguje i z file:// a v publikované verzi)
    await loadScript(PDFJS + 'pdf.worker.min.js');
    await loadScript(PDFJS + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  }
  const normT = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function toIso(s) {
    // datum z Excelu může přijít jako půlnoc místního času v UTC (např. 29.10. 23:00Z = 30.10.) → zaokrouhlit na nejbližší den
    if (s instanceof Date && !isNaN(s)) return new Date(s.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
    if (typeof s === 'number' && s > 20000 && s < 80000) return new Date(Math.round((s - 25569) * 864e5)).toISOString().slice(0, 10);
    const t = String(s ?? '').trim(); let m;
    if (m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (m = t.match(/(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})/)) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }
  function amt(v) {
    if (typeof v === 'number') return v; if (v == null) return null;
    let s = String(v).replace(/[\s  ]/g, '').replace(/[^0-9,.\-−]/g, '').replace('−', '-'); if (!/\d/.test(s)) return null;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c > -1) s = s.replace(',', '.');
    else if (d > -1 && s.split('.').length > 2) s = s.replace(/\./g, '');
    const n = parseFloat(s); return isNaN(n) ? null : n;
  }
  const DATE_RE = /\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4}|\d{4}-\d{2}-\d{2}/;
  const AMT_RE = /-?\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?|-?\d+,\d{1,2}|-?\d+\.\d{2}(?!\d)|-?\d{3,}/;

  /* ---- PDF: text s pozicemi ---- */
  async function pdfPages(buf) {
    await loadPdfJs();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      pages.push(tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width || 0 })));
    }
    return pages;
  }
  function lines(items) {
    const L = [];
    for (const it of [...items].sort((a, b) => b.y - a.y)) { let l = L.find(l => Math.abs(l.y - it.y) < 3); if (!l) { l = { y: it.y, items: [] }; L.push(l) } l.items.push(it) }
    return L.sort((a, b) => b.y - a.y).map(l => { l.items.sort((a, b) => a.x - b.x); return { y: l.y, x: l.items[0].x, text: l.items.map(i => i.s).join(' '), items: l.items } });
  }
  /* hodnota u popisku: ve stejném prvku, vpravo na stejném řádku, nebo pod popiskem */
  function near(items, labelRe, valRe) {
    for (const L of items.filter(i => labelRe.test(i.s))) {
      const after = L.s.slice(L.s.search(labelRe)).replace(labelRe, ''); let m = after.match(valRe); if (m) return m[0];
      const right = items.filter(i => i !== L && Math.abs(i.y - L.y) < 3 && i.x > L.x && i.x < L.x + 320).sort((a, b) => a.x - b.x);
      for (const i of right) { if (labelRe.test(i.s) || /:$/.test(i.s) && !valRe.test(i.s)) break; m = i.s.match(valRe); if (m) return m[0] }
      const below = items.filter(i => i.y < L.y - 2 && i.y > L.y - 36 && Math.abs(i.x - L.x) < 70).sort((a, b) => b.y - a.y);
      for (const i of below) { m = i.s.match(valRe); if (m) return m[0] }
    }
    return null;
  }
  function clientBlock(items) {
    const lab = items.find(i => /^(odběratel|příjemce|zákazník|klient|customer|bill to)\b/i.test(i.s));
    if (!lab) return {};
    const inline = lab.s.replace(/^(odběratel|příjemce|zákazník|klient|customer|bill to)\s*:?\s*/i, '');
    const blk = items.filter(i => i !== lab && i.y < lab.y + 1 && i.y > lab.y - 140 && i.x >= lab.x - 4 && i.x < lab.x + 240 && !(Math.abs(i.y - lab.y) < 3 && i.x < lab.x));
    const ls = lines(blk).map(l => l.text);
    const out = []; if (inline) out.push(inline);
    for (const t of ls) { if (/^(dodavatel|datum|splatnost|bankovn|iban|forma úhrady|číslo účtu|variabiln|způsob)/i.test(t)) break; out.push(t); if (out.length > 7) break }
    const txt = out.join('\n');
    const ico = (txt.match(/IČO?\s*:?\s*(\d{6,8})/i) || [])[1] || '';
    const dic = (txt.match(/DIČ\s*:?\s*([A-Z]{2}\d{8,10})/i) || [])[1] || '';
    const rest = out.filter(t => !/^(IČO?|DIČ|tel|telefon|mobil|e-?mail|web)\b|IČO?\s*:?\s*\d|DIČ\s*:?\s*[A-Z]{2}|@|www\./i.test(t));
    return { klient: rest[0] || '', adresa: rest.slice(1, 4).join('\n'), ico, dic };
  }
  function parsePdfPage(items) {
    const text = lines(items).map(l => l.text).join('\n');
    const r = { varovani: [] };
    let m = text.match(/(?:faktur[ay]|daňov\S*\s+doklad)[^\n]{0,40}?(?:č\.|číslo|č|no\.?)\s*:?\s*([A-Z]{0,5}[-\/]?\d[\dA-Z\-\/]{2,})/i)
      || text.match(/číslo\s+(?:faktury|dokladu)\s*:?\s*([A-Z]{0,5}[-\/]?\d[\dA-Z\-\/]{2,})/i);
    r.cislo = m ? m[1] : (near(items, /číslo\s+(faktury|dokladu)/i, /[A-Z]{0,5}[-\/]?\d[\dA-Z\-\/]{2,}/) || '');
    r.vs = near(items, /variabiln\S*\s*symbol|^VS\b/i, /\d{1,10}/) || '';
    if (!r.cislo && r.vs) r.cislo = r.vs;
    r.vystaveno = toIso(near(items, /vystaven[ií]|datum vystavení|issue date|date of issue/i, DATE_RE) || '');
    r.splatnost = toIso(near(items, /splatnost|datum splatnosti|due date/i, DATE_RE) || '');
    r.duzp = toIso(near(items, /DUZP|zdaniteln|uskutečnění/i, DATE_RE) || '');
    let tot = null;
    for (const re of [/(celkem\s+)?k\s+úhrad[ěe]/i, /zbývá\s+(uhradit|zaplatit)/i, /celkem\s+k\s+zaplacení/i, /celkem\s+s\s+dph|celková\s+částka|celkem/i, /total/i]) { const v = near(items, re, AMT_RE); if (v != null && amt(v) != null) { tot = amt(v); break } }
    if (tot == null) { const all = (text.match(new RegExp(AMT_RE.source + '\\s*(Kč|CZK)', 'g')) || []).map(amt).filter(v => v != null); if (all.length) tot = Math.max(...all) }
    r.total = tot;
    const base = near(items, /(celkem\s+)?bez\s+dph|základ\s+daně|základ/i, AMT_RE); r.base = base ? amt(base) : null;
    r.mena = /\bEUR\b|€/.test(text) && !/\bKč\b|\bCZK\b/.test(text) ? 'EUR' : 'CZK';
    r.zaplaceno = /zaplaceno|uhrazeno|neplaťte|nehraďte/i.test(text);
    r.isInvoice = /faktur|daňov\S* doklad|invoice/i.test(text);
    Object.assign(r, clientBlock(items));
    return r;
  }
  async function fromPdf(buf, name) {
    const pages = await pdfPages(buf);
    if (!pages.some(p => p.length)) throw new Error('PDF neobsahuje text (je to sken?). Takové PDF zatím přečíst neumím.');
    const out = []; let cur = null;
    for (const items of pages) {
      const r = parsePdfPage(items);
      if (r.cislo && (!cur || r.cislo !== cur.cislo) && r.isInvoice) { cur = r; out.push(cur) }
      else if (cur) { for (const k of ['vystaveno', 'splatnost', 'duzp', 'klient', 'adresa', 'ico', 'dic']) if (!cur[k] && r[k]) cur[k] = r[k]; if (r.total != null) cur.total = r.total; if (r.base != null) cur.base = r.base; cur.zaplaceno = cur.zaplaceno || r.zaplaceno }
      else if (r.total != null) { cur = r; out.push(cur) }
    }
    return out.map(r => ({ ...r, zdroj: name, stav: r.zaplaceno ? 'zaplaceno' : null }));
  }

  /* ---- ISDOC (XML standard českých fakturačních programů) ---- */
  function fromIsdoc(text, name) {
    const x = new DOMParser().parseFromString(text, 'application/xml');
    if (x.querySelector('parsererror')) throw new Error('Soubor není platné XML.');
    const q = (el, ...path) => { let n = el; for (const p of path) { n = n && [...n.children].find(c => c.localName === p); } return n ? n.textContent.trim() : '' };
    const all = (el, nm) => [...el.getElementsByTagNameNS('*', nm)];
    const invs = all(x, 'Invoice').length ? all(x, 'Invoice') : [x.documentElement];
    return invs.map(inv => {
      const cust = all(inv, 'AccountingCustomerParty')[0]; const party = cust ? all(cust, 'Party')[0] : null;
      const addr = party ? all(party, 'PostalAddress')[0] : null;
      const items = all(inv, 'InvoiceLine').map(l => {
        const qn = amt(q(l, 'InvoicedQuantity')) || 1, unit = (all(l, 'InvoicedQuantity')[0]?.getAttribute('unitCode')) || 'ks';
        const base = amt(q(l, 'LineExtensionAmount')) || 0, pct = amt(q(l, 'ClassifiedTaxCategory', 'Percent')) || 0;
        return { t: q(l, 'Item', 'Description') || q(l, 'Note') || 'Položka', q: qn, u: unit, p: Math.round(base / qn * 100) / 100, v: pct };
      });
      return {
        cislo: q(inv, 'ID'), vs: all(inv, 'VariableSymbol')[0]?.textContent.trim() || '',
        vystaveno: toIso(q(inv, 'IssueDate')), duzp: toIso(q(inv, 'TaxPointDate')), splatnost: toIso(all(inv, 'PaymentDueDate')[0]?.textContent || ''),
        klient: party ? q(party, 'PartyName', 'Name') : '', ico: party ? q(party, 'PartyIdentification', 'ID') : '', dic: party ? q(party, 'PartyTaxScheme', 'CompanyID') : '',
        adresa: addr ? [`${q(addr, 'StreetName')} ${q(addr, 'BuildingNumber')}`.trim(), `${q(addr, 'PostalZone')} ${q(addr, 'CityName')}`.trim()].filter(Boolean).join('\n') : '',
        total: amt(all(inv, 'PayableAmount')[0]?.textContent) ?? amt(all(inv, 'TaxInclusiveAmount')[0]?.textContent),
        base: amt(all(inv, 'TaxExclusiveAmount')[0]?.textContent), mena: q(inv, 'LocalCurrencyCode') || 'CZK',
        stav: amt(all(inv, 'AlreadyClaimedTaxInclusiveAmount')[0]?.textContent) && !amt(all(inv, 'PayableAmount')[0]?.textContent) ? 'zaplaceno' : null,
        items: items.length ? items : null, zdroj: name, varovani: []
      };
    });
  }

  /* ---- tabulka (XLS/XLSX/CSV export seznamu faktur) ---- */
  const COLS = [
    ['cislo', 'Číslo faktury *', [/cislo (faktury|dokladu)/, /^cislo$/, /^doklad/, /invoice (no|number)/, /^number$/, /^cislo/]],
    ['klient', 'Odběratel', [/odberatel/, /klient/, /zakaznik/, /customer/, /client/, /nazev/, /firma/]],
    ['ico', 'IČO odběratele', [/^ico/, /ic odberatele/, /company id/, /reg/]],
    ['vystaveno', 'Datum vystavení *', [/vystaven/, /issue/, /date of issue/, /^datum$/, /created/, /^date$/]],
    ['splatnost', 'Splatnost', [/splatnost/, /due/]],
    ['base', 'Částka bez DPH', [/bez dph/, /zaklad/, /subtotal/, /net/, /without/]],
    ['total', 'Částka celkem *', [/celkem s dph/, /k uhrade/, /celkem/, /total/, /castka/, /amount/, /suma/]],
    ['stav', 'Stav / zaplaceno', [/^stav/, /status/, /uhrazen/, /zaplacen/, /paid$/]],
    ['paid', 'Datum úhrady', [/datum uhrady/, /uhrazeno dne/, /zaplaceno dne/, /paid (date|on)/, /payment date/, /datum platby/]],
    ['mena', 'Měna', [/^mena/, /currency/]]
  ];
  function decodeBuf(buf) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '') } catch (e) { return new TextDecoder('windows-1250').decode(buf) } }
  function csvRows(text) {
    const first = text.split(/\r?\n/).slice(0, 20).join('\n'); let delim = ';', best = -1;
    for (const d of [';', ',', '\t']) { const n = first.split(d).length; if (n > best) { best = n; delim = d } }
    const rows = []; let row = [], f = '', qt = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (qt) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else qt = false } else f += c }
      else if (c === '"') qt = true; else if (c === delim) { row.push(f); f = '' }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row) }
    return rows.map(r => r.map(v => v.trim()));
  }
  function tableGuess(rows) {
    let best = 0, h = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) { const sc = (rows[i] || []).filter(c => { const t = normT(c); return t && COLS.some(([, , rs]) => rs.some(r => r.test(t))) }).length; if (sc > best) { best = sc; h = i } }
    const head = (rows[h] || []).map(normT), used = new Set(), map = { header: h };
    for (const [k, , rs] of COLS) { map[k] = -1; outer: for (const r of rs) for (let i = 0; i < head.length; i++) if (!used.has(i) && r.test(head[i]) && !(k === 'total' && /bez dph|zaklad/.test(head[i]))) { map[k] = i; used.add(i); break outer } }
    return map;
  }
  function tableRecords(rows, map, name) {
    const out = [];
    for (let i = map.header + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r || r.every(c => c === '' || c == null)) continue;
      const g = k => map[k] >= 0 ? r[map[k]] : '';
      const cislo = String(g('cislo') ?? '').trim(); const total = amt(g('total'));
      if (!cislo || total == null) continue;
      const st = normT(g('stav')); const paid = toIso(g('paid'));
      out.push({ cislo, klient: String(g('klient') ?? '').trim(), ico: String(g('ico') ?? '').replace(/\D/g, ''), vystaveno: toIso(g('vystaveno')), splatnost: toIso(g('splatnost')), total, base: amt(g('base')), mena: String(g('mena') || 'CZK').toUpperCase().slice(0, 3),
        stav: /storn/.test(st) ? 'storno' : /nezaplac|neuhraz|unpaid|^ne$|^no$|false|po splatnosti|ceka/.test(st) ? 'vystaveno' : (paid || /zaplac|uhraz|paid|^ano$|^yes$|true/.test(st)) ? 'zaplaceno' : st ? 'vystaveno' : null, paid, zdroj: name, varovani: [] });
    }
    return out;
  }

  /* ---------- registrace ---------- */
  App.register({
    id: 'faktury',
    name: 'Faktury',
    description: 'Fakturace OSVČ: odběratelé, QR platba, úhrady a obrat vůči limitu DPH.',
    icon: App.icons.invoice,
    order: 30,

    /* Nástroje pro asistenta */
    tools(ctx) {
      const lst = (d, i) => ({ cislo: i.cislo, odberatel: i.client?.name || '', vystaveno: i.vystaveno, splatnost: i.splatnost, castka: totals(i, d.cfg.platce).total, stav: status(i)[0], zaplaceno: i.paid || null });
      return [
        { name: 'invoices_list', description: 'Seznam faktur OSVČ. stav: neuhrazene (vystavené a nezaplacené), po_splatnosti, zaplacene, koncepty nebo vse; volitelně rok. Vrací max 30 faktur (číslo, odběratel, data, částka, stav).',
          inputSchema: { type: 'object', properties: { stav: { type: 'string', enum: ['neuhrazene', 'po_splatnosti', 'zaplacene', 'koncepty', 'vse'] }, rok: { type: 'string' } } },
          run: inp => { const d = load(ctx.store), td = App.today(); let a = d.inv; const st = inp.stav || 'vse';
            if (st === 'neuhrazene') a = a.filter(i => i.stav === 'vystaveno'); if (st === 'po_splatnosti') a = a.filter(i => i.stav === 'vystaveno' && i.splatnost < td);
            if (st === 'zaplacene') a = a.filter(i => i.stav === 'zaplaceno'); if (st === 'koncepty') a = a.filter(i => i.stav === 'koncept');
            if (inp.rok) a = a.filter(i => i.vystaveno.startsWith(String(inp.rok)));
            return { ukazkova_data: !!d.sample, pocet: a.length, celkem: a.reduce((s, i) => s + totals(i, d.cfg.platce).total, 0), faktury: a.slice(-30).reverse().map(i => lst(d, i)) } } },
        { name: 'invoices_stats', description: 'Statistika fakturace za rok: fakturováno (bez DPH), zaplaceno, čeká na úhradu, po splatnosti a obrat vůči limitu pro registraci k DPH.',
          inputSchema: { type: 'object', properties: { rok: { type: 'string' } } },
          run: inp => { const d = load(ctx.store), y = String(inp.rok || new Date().getFullYear()), td = App.today();
            const iss = d.inv.filter(i => i.stav !== 'koncept'), yr = iss.filter(i => i.vystaveno.startsWith(y)), T = i => totals(i, d.cfg.platce);
            const base = yr.reduce((s, i) => s + T(i).base, 0), open = iss.filter(i => i.stav === 'vystaveno');
            return { rok: y, ukazkova_data: !!d.sample, fakturovano: base, zaplaceno: yr.filter(i => i.stav === 'zaplaceno').reduce((s, i) => s + T(i).total, 0), ceka_na_uhradu: open.reduce((s, i) => s + T(i).total, 0), po_splatnosti: open.filter(i => i.splatnost < td).map(i => lst(d, i)), limit_dph: d.cfg.limit, vycerpano_procent: Math.round(base / d.cfg.limit * 1000) / 10 } } },
        { name: 'invoice_draft', description: 'Vytvoří KONCEPT nové faktury (nevystaví ji). Odběratele hledá podle názvu mezi uloženými, jinak ho založí. Vrací číslo konceptu; uživatel ho pak zkontroluje a vystaví v modulu Faktury.',
          inputSchema: { type: 'object', properties: { odberatel: { type: 'string' }, polozky: { type: 'array', items: { type: 'object', properties: { popis: { type: 'string' }, mnozstvi: { type: 'number' }, jednotka: { type: 'string' }, cena: { type: 'number', description: 'cena za jednotku v Kč' } }, required: ['popis', 'cena'] } }, splatnost_dni: { type: 'number' } }, required: ['odberatel', 'polozky'] },
          run: inp => {
            let d = load(ctx.store); if (d.sample) d = { sample: false, cfg: d.cfg, clients: d.clients, inv: [] };
            const nm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            let c = d.clients.find(x => nm(x.name).includes(nm(inp.odberatel)) || nm(inp.odberatel).includes(nm(x.name)));
            if (!c) { c = { id: uid(), name: String(inp.odberatel), addr: '', ico: '', dic: '', email: '' }; d.clients.push(c) }
            const t = App.today(), y = String(new Date().getFullYear());
            const items = (Array.isArray(inp.polozky) ? inp.polozky : []).map(p => ({ t: String(p.popis || ''), q: +p.mnozstvi || 1, u: String(p.jednotka || 'ks'), p: +p.cena || 0, v: 21 })).filter(i => i.t);
            if (!items.length) throw new Error('Chybí položky faktury');
            const inv = { id: uid(), cislo: nextNo(d, y, t), clientId: c.id, client: { ...c }, vystaveno: t, duzp: t, splatnost: addDays(t, +inp.splatnost_dni || +d.cfg.splatnost || 14), items, note: '', stav: 'koncept' };
            d.inv.push(inv); ctx.store.set('data', d); ctx.bus.emit('faktury:changed');
            return { koncept: inv.cislo, odberatel: c.name, novy_odberatel: !c.ico && !c.addr, castka: totals(inv, d.cfg.platce).total };
          } }
      ];
    },

    init(ctx) {
      ctx.bus.on('rozpocet:import', e => {
        const d = load(ctx.store); const n = match(d, e.tx);
        if (n) { ctx.store.set('data', d); setTimeout(() => ctx.toast(`Faktury: ${n} ${n === 1 ? 'faktura označena jako zaplacená' : 'faktury označeny jako zaplacené'} podle výpisu.`), 1200) }
      });
    },

    widget(el, ctx) {
      const d = load(ctx.store), y = String(new Date().getFullYear());
      const iss = d.inv.filter(i => i.stav !== 'koncept');
      const year = iss.filter(i => i.vystaveno.startsWith(y)).reduce((s, i) => s + totals(i, d.cfg.platce).base, 0);
      const open = iss.filter(i => i.stav === 'vystaveno'); const openSum = open.reduce((s, i) => s + totals(i, d.cfg.platce).total, 0);
      const late = open.filter(i => i.splatnost < App.today()).length;
      const f = year / d.cfg.limit;
      el.innerHTML = `${d.sample ? '<div class="lbl">ukázková data</div>' : ''}
        <div class="wnums"><div><span>Fakturováno ${y}</span><b data-count="${year}"></b></div><div><span>Čeká na úhradu</span><b class="warn" style="color:var(--warn)" data-count="${openSum}"></b></div>
        <div><span>Po splatnosti</span><b class="${late ? 'exp' : 'inc'}">${late}</b></div></div>
        <div class="meter ${f < .5 ? 'ok' : f < .8 ? 'mid' : 'hi'}"><b style="width:${Math.min(100, f * 100)}%"></b></div>
        <span class="wnote">Obrat ${fmt.pct(f * 100)} z limitu pro DPH ${fmt.czk(d.cfg.limit)}</span>`;
    },

    mount(root, ctx) {
      let d = load(ctx.store), tab = 'prehled', cur = null, yearF = String(new Date().getFullYear());
      const save = () => ctx.store.set('data', d);
      const $ = s => root.querySelector(s);
      const dropSample = () => { if (d.sample) { d = { sample: false, cfg: d.cfg, clients: d.clients, inv: [] } } };

      function draw() {
        root.innerHTML = `<div class="mw">
          ${d.sample ? '<div class="banner"><b>Ukázková data.</b> <span>Faktury i odběratelé jsou vymyšlení. Doplňte své údaje v Nastavení. Ukázka zmizí, jakmile uložíte první vlastní fakturu.</span></div>' : ''}
          ${!d.cfg.name || !d.cfg.ico || !d.cfg.ucet ? '<div class="banner"><b>Chybí údaje dodavatele.</b> <span>Doplňte jméno, IČO, adresu a číslo účtu v záložce Nastavení, jinak faktura není úplná a QR platba se nevytvoří.</span></div>' : ''}
          <div class="tabs" role="tablist">${[['prehled', 'Faktury'], ['editor', cur ? 'Faktura ' + cur.cislo : 'Nová faktura'], ['vykaz', 'Z výkazu práce'], ['klienti', 'Odběratelé'], ['import', 'Import starších'], ['nastaveni', 'Nastavení']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${esc(l)}</button>`).join('')}</div>
          <div id="faTab"></div></div>`;
        root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { if (b.dataset.tab === 'editor' && !cur) newInv(); tab = b.dataset.tab; draw() });
        const T = $('#faTab');
        ({ prehled: viewList, editor: viewEditor, klienti: viewClients, import: viewImport, vykaz: viewVykaz, nastaveni: viewCfg })[tab](T);
        App.countUp(root);
      }

      /* ---- seznam ---- */
      function viewList(T) {
        const years = [...new Set([String(new Date().getFullYear()), ...d.inv.map(i => i.vystaveno.slice(0, 4))])].sort().reverse();
        if (yearF !== 'vse' && !years.includes(yearF)) yearF = years[0];
        const y = yearF === 'vse' ? null : yearF, inY = i => !y || i.vystaveno.startsWith(y);
        const iss = d.inv.filter(i => i.stav !== 'koncept');
        const yr = iss.filter(inY);
        const sum = a => a.reduce((s, i) => s + totals(i, d.cfg.platce).total, 0);
        const base = yr.reduce((s, i) => s + totals(i, d.cfg.platce).base, 0);
        const paid = sum(yr.filter(i => i.stav === 'zaplaceno'));
        const open = yr.filter(i => i.stav === 'vystaveno'), late = open.filter(i => i.splatnost < App.today());
        const f = base / d.cfg.limit;
        const mon = Array.from({ length: 12 }, (_, k) => yr.filter(i => +i.vystaveno.slice(5, 7) === k + 1).reduce((s, i) => s + totals(i, d.cfg.platce).base, 0)); const mx = Math.max(1, ...mon);
        const list = d.inv.filter(inY).sort((a, b) => b.vystaveno.localeCompare(a.vystaveno) || String(b.cislo).localeCompare(String(a.cislo)));
        const perYear = years.map(yy => { const a = iss.filter(i => i.vystaveno.startsWith(yy)); return { yy, n: a.length, base: a.reduce((s, i) => s + totals(i, d.cfg.platce).base, 0), paid: sum(a.filter(i => i.stav === 'zaplaceno')) } }); const mxY = Math.max(1, ...perYear.map(r => r.base));
        const row = i => { const [s, c] = status(i); return `<tr><td class="p">${esc(i.cislo)}</td><td><div class="p" style="font-family:var(--f-body)">${esc(i.client?.name || '—')}</div><div class="x">${esc(i.items[0]?.t || '')}</div></td>
              <td class="d">${fmt.date(i.vystaveno)}</td><td class="d">${fmt.date(i.splatnost)}</td><td><span class="pill ${c}">${s}</span>${i.paid ? `<div class="x">${fmt.date(i.paid)}</div>` : ''}${i.sent && !i.paid ? `<div class="x">odesláno ${fmt.date(i.sent.date)}</div>` : ''}</td>
              <td class="amt">${fmt.czk(totals(i, d.cfg.platce).total)}</td>
              <td style="white-space:nowrap"><button class="btn sm" data-open="${i.id}">Otevřít</button>${i.stav === 'vystaveno' ? ` <button class="btn sm" data-pay="${i.id}">Zaplaceno</button>` : ''}</td></tr>` };
        const rows = y ? list.map(row).join('') : years.map(yy => { const a = list.filter(i => i.vystaveno.startsWith(yy)); return a.length ? `<tr><td colspan="7" style="padding-top:16px"><span class="lbl" style="font-size:13px">${yy}</span> <span class="muted num">· ${a.length} faktur · ${fmt.czk(sum(a.filter(i => i.stav !== 'koncept')))}</span></td></tr>` + a.map(row).join('') : '' }).join('');
        T.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <div class="seg" role="group" aria-label="Rok" style="align-self:flex-start">${years.map(yy => `<button data-yr="${yy}" aria-pressed="${yearF === yy}">${yy}</button>`).join('')}<button data-yr="vse" aria-pressed="${yearF === 'vse'}">Všechny roky</button></div>
          <div class="kpis">
            <div class="kpi"><span class="lbl">Fakturováno ${y || 'celkem'}</span><span class="v" data-count="${base}"></span><span class="s">${yr.length} faktur${d.cfg.platce ? ', bez DPH' : ''}</span></div>
            <div class="kpi"><span class="lbl">Zaplaceno</span><span class="v inc" data-count="${paid}"></span><span class="s">${y ? 'za rok ' + y : 'celkem'}</span></div>
            <div class="kpi"><span class="lbl">Čeká na úhradu</span><span class="v" style="color:var(--warn)" data-count="${sum(open)}"></span><span class="s">${open.length} faktur</span></div>
            <div class="kpi"><span class="lbl">Po splatnosti</span><span class="v ${late.length ? 'exp' : 'inc'}" data-count="${sum(late)}"></span><span class="s">${late.length} faktur</span></div>
          </div>
          ${y ? `<div class="grid2">
            <section class="panel"><div class="phead"><h2>Obrat vůči limitu DPH</h2><span class="pill ${f < .8 ? 'ok' : f < 1 ? 'warn' : 'bad'}">${fmt.pct(f * 100)}</span></div>
              <div class="meter ${f < .5 ? 'ok' : f < .8 ? 'mid' : 'hi'}"><b style="width:${Math.min(100, f * 100)}%"></b></div>
              <div class="mlbl" style="margin-top:6px">${fmt.czk(base)} z ${fmt.czk(d.cfg.limit)} · zbývá ${fmt.czk(Math.max(0, d.cfg.limit - base))}</div>
              <p class="muted" style="font-size:12px">Počítá se z faktur vystavených v roce ${y}. Limit lze změnit v Nastavení; aktuální pravidla registrace k DPH si ověřte na webu Finanční správy.</p></section>
            <section class="panel"><div class="phead"><h2>Fakturace po měsících</h2></div>
              <div class="fa-bars">${mon.map((v, k) => `<div title="${App.MONTHS[k]}: ${fmt.czk(v)}"><i style="height:${Math.max(2, v / mx * 100)}%;animation-delay:${k * 45}ms"></i><span>${App.MON[k]}</span></div>`).join('')}</div></section>
          </div>` : `<section class="panel"><div class="phead"><h2>Fakturace po letech</h2></div>
              <div class="fa-bars">${perYear.slice().reverse().map((r, k) => `<div title="${r.yy}: ${fmt.czk(r.base)}, ${r.n} faktur"><i style="height:${Math.max(2, r.base / mxY * 100)}%;animation-delay:${k * 60}ms"></i><span>${r.yy}</span></div>`).join('')}</div>
              <div class="tablebox"><table style="min-width:420px"><thead><tr><th>Rok</th><th class="amt">Faktur</th><th class="amt">Fakturováno</th><th class="amt">Zaplaceno</th></tr></thead><tbody>${perYear.map(r => `<tr><td><b>${r.yy}</b></td><td class="amt">${r.n}</td><td class="amt">${fmt.czk(r.base)}</td><td class="amt">${fmt.czk(r.paid)}</td></tr>`).join('')}</tbody></table></div></section>`}
          <section class="panel fa-list"><div class="phead"><h2>${y ? 'Faktury ' + y : 'Všechny faktury'}</h2><div class="acts"><button class="btn sm" id="faVk">Faktura z výkazu práce</button><button class="btn sm" id="faImp">Importovat starší faktury</button><button class="btn sm" id="faMatch">Spárovat s výpisy z banky</button><button class="btn primary sm" id="faNew">+ Nová faktura</button></div></div>
            <div class="tablebox"><table><thead><tr><th>Číslo</th><th>Odběratel</th><th>Vystaveno</th><th>Splatnost</th><th>Stav</th><th class="amt">Částka</th><th></th></tr></thead><tbody>
            ${rows || `<tr><td colspan="7" class="empty">${y ? 'V roce ' + y + ' zatím žádné faktury.' : 'Zatím žádné faktury.'}</td></tr>`}
            </tbody></table></div></section></div>`;
        root.querySelectorAll('[data-yr]').forEach(b => b.onclick = () => { yearF = b.dataset.yr; draw() });
        $('#faImp').onclick = () => { tab = 'import'; draw() };
        $('#faVk').onclick = () => { tab = 'vykaz'; draw() };
        $('#faNew').onclick = () => { newInv(); tab = 'editor'; draw() };
        $('#faMatch').onclick = () => { const n = match(d, budgetTx()); save(); draw(); ctx.toast(n ? `Spárováno ${n} faktur.` : 'Ve výpisech jsem nenašel žádnou odpovídající platbu (shoda částky a VS).') };
        root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { cur = JSON.parse(JSON.stringify(d.inv.find(i => i.id === b.dataset.open))); tab = 'editor'; draw() });
        root.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { const i = d.inv.find(x => x.id === b.dataset.pay); i.stav = 'zaplaceno'; i.paid = App.today(); save(); draw(); ctx.toast(`Faktura ${i.cislo} označena jako zaplacená.`) });
      }

      const rec = () => (d.cfg.pravidelne || []).filter(x => x.on && x.t).map(x => ({ t: x.t, q: 1, u: 'ks', p: +x.p || 0, v: d.cfg.platce ? 21 : 0 }));
      function newInv() {
        const y = String(new Date().getFullYear()); const t = App.today();
        cur = { id: uid(), cislo: nextNo(d.sample ? { inv: [], cfg: d.cfg } : d, y, t), clientId: d.clients[0]?.id || '', client: d.clients[0] ? { ...d.clients[0] } : {}, vystaveno: t, duzp: t, splatnost: addDays(t, +d.cfg.splatnost || 14), items: [...rec(), { t: '', q: 1, u: 'ks', p: 0, v: d.cfg.platce ? 21 : 0 }], note: '', stav: 'koncept', isNew: true };
      }

      /* ---- editor ---- */
      function viewEditor(T) {
        if (!cur) newInv();
        const pl = d.cfg.platce;
        T.innerHTML = `<div class="fa-ed">
          <section class="panel"><div class="phead"><h2>${cur.isNew ? 'Nová faktura' : 'Úprava faktury'}</h2><span class="pill ${status(cur)[1]}">${status(cur)[0]}</span></div>
            ${cur.imported ? `<p class="muted" style="margin-top:0;font-size:12px">Převzato z ${esc(cur.imported.from)} (${fmt.date(cur.imported.at)}).${cur.fixed ? ' Částka je převzatá z dokladu; úpravou položek se přepočítá.' : ''}</p>` : ''}
            <div class="fgrid">
              <label class="field">Číslo (= variabilní symbol)<input type="text" id="eNo" value="${esc(cur.cislo)}"></label>
              <label class="field">Odběratel<select id="eCl">${d.clients.map(c => `<option value="${c.id}"${c.id === cur.clientId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="">+ nový odběratel…</option></select></label>
              <label class="field">Vystaveno<input type="date" id="eV" value="${cur.vystaveno}"></label>
              <label class="field">DUZP<input type="date" id="eZ" value="${cur.duzp}"></label>
              <label class="field">Splatnost<input type="date" id="eS" value="${cur.splatnost}"></label>
            </div>
            <div class="lbl" style="margin:16px 0 8px">Položky</div>
            <div class="fa-items" id="eItems">${cur.items.map((it, k) => `<div class="fa-item${pl ? ' dph' : ''}" data-k="${k}">
              <input type="text" data-f="t" value="${esc(it.t)}" placeholder="Popis" aria-label="Popis">
              <textarea data-f="d" rows="${Math.max(1, String(it.d || '').split('\n').length)}" placeholder="Rozpis (nepovinné)" aria-label="Rozpis položky" style="grid-column:1/-1;order:9;font-size:12px;padding:4px 8px;min-height:0">${esc(it.d || '')}</textarea>
              <input type="number" data-f="q" step="any" value="${it.q}" aria-label="Množství">
              <input type="text" data-f="u" value="${esc(it.u)}" aria-label="Jednotka">
              <input type="number" data-f="p" step="any" value="${it.p}" aria-label="Cena za jednotku">
              ${pl ? `<select data-f="v" aria-label="Sazba DPH">${[21, 12, 0].map(v => `<option${+it.v === v ? ' selected' : ''}>${v}</option>`).join('')}</select>` : ''}
              <button class="btn sm danger" data-rm="${k}" aria-label="Odebrat položku">×</button></div>`).join('')}</div>
            <div class="acts" style="margin-top:8px"><button class="btn sm" id="eAdd">+ Položka</button></div>
            <label class="field" style="margin-top:12px">Poznámka na faktuře<textarea id="eNote" rows="2">${esc(cur.note)}</textarea></label>
            <div class="acts" style="margin-top:16px">
              <button class="btn" id="eSave">Uložit koncept</button>
              <button class="btn primary" id="eIssue">${cur.stav === 'koncept' ? 'Vystavit' : 'Uložit'}</button>
              <button class="btn primary" id="eMail">Odeslat e-mailem</button>
              <button class="btn" id="ePrint">Tisk / PDF</button>
              ${!cur.isNew ? '<button class="btn" id="eDup">Duplikovat</button><button class="btn danger" id="eDel">Smazat</button>' : ''}
            </div>
            <p class="muted" style="font-size:12px">Tisk a uložení do PDF fungují ve verzi spuštěné z vašeho počítače (index.html). V publikované webové verzi prohlížeč tisk nepovolí.</p>
            ${cur.sent ? `<p class="muted" style="font-size:12px">Naposledy odesláno ${fmt.date(cur.sent.date)}${cur.sent.to ? ' na ' + esc(cur.sent.to) : ''}.</p>` : ''}
            <div id="eMailBox"></div>
          </section>
          <div class="paperwrap"><div class="paper" id="paper"></div></div></div>`;
        paper();
        const sync = () => {
          cur.cislo = $('#eNo').value.trim(); cur.vystaveno = $('#eV').value; cur.splatnost = $('#eS').value; if ($('#eZ')) cur.duzp = $('#eZ').value; cur.note = $('#eNote').value;
          root.querySelectorAll('.fa-item').forEach(r => { const it = cur.items[+r.dataset.k]; r.querySelectorAll('[data-f]').forEach(i => it[i.dataset.f] = i.type === 'number' || i.dataset.f === 'v' ? +i.value : i.value) });
          paper();
        };
        T.querySelectorAll('input,textarea,select:not(#eCl)').forEach(i => i.addEventListener('input', e => { if (e.target.dataset.f && cur.fixed) delete cur.fixed; sync() }));
        $('#eV').addEventListener('change', () => { $('#eS').value = addDays($('#eV').value, +d.cfg.splatnost || 14); if ($('#eZ')) $('#eZ').value = $('#eV').value; sync() });
        $('#eCl').onchange = e => { if (!e.target.value) { tab = 'klienti'; draw(); ctx.toast('Přidejte odběratele a vraťte se k faktuře.'); return } const c = d.clients.find(x => x.id === e.target.value); cur.clientId = c.id; cur.client = { ...c }; paper() };
        $('#eAdd').onclick = () => { sync(); cur.items.push({ t: '', q: 1, u: 'ks', p: 0, v: 21 }); draw() };
        root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sync(); cur.items.splice(+b.dataset.rm, 1); if (!cur.items.length) cur.items.push({ t: '', q: 1, u: 'ks', p: 0, v: 21 }); draw() });
        const store = stav => {
          sync(); if (!cur.cislo) { ctx.toast('Vyplňte číslo faktury.'); return false }
          if (!cur.items.some(i => i.t && i.p)) { ctx.toast('Přidejte aspoň jednu položku s popisem a cenou.'); return false }
          if (d.inv.some(i => i.cislo === cur.cislo && i.id !== cur.id) && !d.sample) { ctx.toast(`Číslo ${cur.cislo} už má jiná faktura.`); return false }
          dropSample(); if (stav) cur.stav = stav; delete cur.isNew; cur.items = cur.items.filter(i => i.t || +i.p);
          const k = d.inv.findIndex(i => i.id === cur.id); const copy = JSON.parse(JSON.stringify(cur)); if (k >= 0) d.inv[k] = copy; else d.inv.push(copy);
          save(); return true;
        };
        $('#eSave').onclick = () => { if (store(cur.stav === 'koncept' ? 'koncept' : null)) { draw(); ctx.toast('Uloženo.') } };
        $('#eIssue').onclick = () => { if (store(cur.stav === 'koncept' ? 'vystaveno' : null)) { draw(); ctx.toast(`Faktura ${cur.cislo} vystavena.`) } };
        $('#ePrint').onclick = () => {
          paper();
          let box = document.getElementById('faPrint'); if (!box) { box = document.createElement('div'); box.id = 'faPrint'; document.body.appendChild(box) }
          box.innerHTML = ''; const copy = $('#paper').cloneNode(true); copy.removeAttribute('id');
          const qrC = $('#paper canvas'); const qrI = copy.querySelector('canvas'); if (qrC && qrI) { const img = new Image(); img.src = qrC.toDataURL(); img.style.cssText = 'width:96px;height:96px'; qrI.replaceWith(img) }
          box.appendChild(copy); document.body.classList.add('fa-printing');
          const end = () => { document.body.classList.remove('fa-printing'); box.innerHTML = ''; window.removeEventListener('afterprint', end) };
          window.addEventListener('afterprint', end);
          try { window.print() } catch (e) { end() }
        };
        $('#eMail').onclick = () => {
          sync(); const box = $('#eMailBox'); const cl = d.clients.find(c => c.id === cur.clientId) || cur.client || {};
          const canShare = !!(navigator.canShare && navigator.share);
          box.innerHTML = `<div class="imp" style="margin-top:14px"><div class="phead" style="margin:0"><h2>Odeslat fakturu ${esc(cur.cislo)}</h2><button class="btn sm" id="mClose" aria-label="Zavřít">✕</button></div>
            <label class="field">Komu<input type="text" id="mTo" value="${esc(cl.email || '')}" placeholder="e-mail odběratele" inputmode="email"></label>
            <label class="field">Předmět<input type="text" id="mSub" value="${esc(fillTpl(d.cfg.mailPredmet, d, cur))}"></label>
            <label class="field">Text<textarea id="mBody" rows="8">${esc(fillTpl(d.cfg.mailText, d, cur))}</textarea></label>
            <div class="acts">${canShare ? '<button class="btn primary" id="mShare">Odeslat s PDF v příloze</button>' : ''}
              <button class="btn${canShare ? '' : ' primary'}" id="mGmail">Stáhnout PDF a otevřít Gmail</button><button class="btn" id="mMailto">PDF + jiný e-mailový program</button><button class="btn" id="mCopy">Kopírovat text</button></div>
            <p class="muted" style="font-size:12px;margin:0">${canShare ? '„Odeslat s PDF v příloze“ otevře nabídku sdílení systému; vyberte Pošta nebo Outlook a faktura už bude přiložená. ' : ''}„Stáhnout PDF a otevřít Gmail“ uloží fakturu jako PDF a v nové záložce otevře nový e-mail v Gmailu s vyplněným adresátem, předmětem i textem; PDF do něj přetáhněte nebo přiložte sponkou.</p></div>`;
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const ready = () => {
            const to = $('#mTo').value.trim();
            if (to && cl.id && cl.email !== to) { const c = d.clients.find(x => x.id === cl.id); if (c) { c.email = to; cur.client = { ...c } } }
            if (cur.stav === 'koncept' || cur.isNew) { if (!store(cur.stav === 'koncept' ? 'vystaveno' : null)) return null } else if (!store(null)) return null;
            return { to, sub: $('#mSub').value, body: $('#mBody').value };
          };
          const done = m => { cur.sent = { date: App.today(), to: m.to }; const k = d.inv.findIndex(i => i.id === cur.id); if (k >= 0) d.inv[k].sent = cur.sent; save() };
          const pdfName = () => `Faktura_${String(cur.cislo).replace(/[^\w-]/g, '')}.pdf`;
          $('#mClose').onclick = () => { box.innerHTML = '' };
          $('#mCopy').onclick = () => { const t = `${$('#mSub').value}\n\n${$('#mBody').value}`; navigator.clipboard?.writeText(t).then(() => ctx.toast('Text e-mailu zkopírován.'), () => { $('#mBody').select(); ctx.toast('Text je označený, zkopírujte ho Ctrl+C.') }) };
          const sh = $('#mShare'); if (sh) sh.onclick = async () => {
            const m = ready(); if (!m) return; paper(); sh.disabled = true; sh.textContent = 'Připravuji PDF…';
            try {
              const file = new File([await invoicePdf($('#paper'))], pdfName(), { type: 'application/pdf' });
              if (!navigator.canShare({ files: [file] })) throw new Error('Sdílení souborů tento prohlížeč nepodporuje.');
              await navigator.share({ files: [file], title: m.sub, text: m.body }); done(m); ctx.toast('Faktura předána k odeslání.');
            } catch (e) { if (e?.name !== 'AbortError') ctx.toast(e.message || 'Sdílení se nepovedlo, použijte druhé tlačítko.') }
            sh.disabled = false; sh.textContent = 'Odeslat s PDF v příloze';
          };
          const viaMail = async (id, label, url) => {
            const m = ready(); if (!m) return; paper(); const b = $('#' + id); b.disabled = true; b.textContent = 'Připravuji PDF…';
            // okno pro e-mail otevřít hned v reakci na klik (jinak ho prohlížeč může zablokovat)
            const a = document.createElement('a'); a.href = url(m); a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
            try { await saveFile(await invoicePdf($('#paper')), pdfName()); done(m); ctx.toast(`PDF uloženo jako ${pdfName()}. Přiložte ho do e-mailu.`) }
            catch (e) { ctx.toast(e?.code === 'declined' ? 'Uložení PDF zrušeno.' : (e.message || 'PDF se nepodařilo vytvořit.')) }
            b.disabled = false; b.textContent = label;
          };
          $('#mGmail').onclick = () => viaMail('mGmail', 'Stáhnout PDF a otevřít Gmail', m => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&su=${encodeURIComponent(m.sub)}&body=${encodeURIComponent(m.body)}`);
          $('#mMailto').onclick = () => viaMail('mMailto', 'PDF + jiný e-mailový program', m => `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.sub)}&body=${encodeURIComponent(m.body)}`);
        };
        const dup = $('#eDup'); if (dup) dup.onclick = () => { const y = String(new Date().getFullYear()), t = App.today(); cur = { ...JSON.parse(JSON.stringify(cur)), id: uid(), cislo: nextNo(d, y, t), vystaveno: t, duzp: t, splatnost: addDays(t, +d.cfg.splatnost || 14), stav: 'koncept', paid: null, isNew: true }; draw(); ctx.toast('Kopie připravena, upravte a uložte.') };
        const del = $('#eDel'); if (del) armed(del, () => { d.inv = d.inv.filter(i => i.id !== cur.id); save(); cur = null; tab = 'prehled'; draw(); ctx.toast('Faktura smazána.') });
      }

      function paper() {
        const c = d.cfg, pl = c.platce, cl = cur.client || {}, t = totals(cur, pl);
        const ph = (v, l) => v ? esc(v).replace(/\n/g, '<br>') : `<span class="ph">${l}</span>`;
        const P = $('#paper'); if (!P) return;
        P.innerHTML = `<div class="hd"><div><h3>Faktura${pl ? ' – daňový doklad' : ''}</h3></div><div class="no">č. ${esc(cur.cislo)}</div></div>
          <div class="cols"><div><div class="cap">Dodavatel</div><b>${ph(c.name, 'jméno – doplňte v Nastavení')}</b><br>${ph(c.addr, 'adresa')}<br>IČO: ${ph(c.ico, 'doplňte')}${c.dic ? '<br>DIČ: ' + esc(c.dic) : ''}${c.email ? '<br>' + esc(c.email) : ''}${c.tel ? '<br>' + esc(c.tel) : ''}</div>
            <div><div class="cap">Odběratel</div><b>${ph(cl.name, 'vyberte odběratele')}</b><br>${ph(cl.addr, '')}${cl.ico ? '<br>IČO: ' + esc(cl.ico) : ''}${cl.dic ? '<br>DIČ: ' + esc(cl.dic) : ''}</div></div>
          <div class="cols"><div><div class="cap">Platební údaje</div>Účet: <b>${ph(c.ucet, 'doplňte')}</b><br>${czIban(c.ucet) ? 'IBAN: ' + czIban(c.ucet).replace(/(.{4})/g, '$1 ') + '<br>' : ''}Variabilní symbol: <b>${esc(vsOf(cur.cislo))}</b><br>Forma úhrady: převodem</div>
            <div><div class="cap">Data</div>Vystaveno: ${fmt.date(cur.vystaveno)}<br>DUZP: ${fmt.date(cur.duzp)}<br>Splatnost: <b>${fmt.date(cur.splatnost)}</b></div></div>
          <table><thead><tr><th style="text-align:left">Popis</th><th class="r">Množství</th><th class="r">Cena/j.</th>${pl ? '<th class="r">DPH</th>' : ''}<th class="r">Celkem</th></tr></thead><tbody>
          ${cur.items.map(it => `<tr><td>${esc(it.t) || '<span class="ph">popis položky</span>'}${it.d ? `<div style="white-space:pre-line;color:#6b7182;font-size:.9em">${esc(it.d)}</div>` : ''}</td><td class="r">${fmt.num(it.q)} ${esc(it.u)}</td><td class="r">${fmt.num(it.p)}</td>${pl ? `<td class="r">${it.v} %</td>` : ''}<td class="r">${fmt.czk2(lineBase(it) * (pl ? 1 + (+it.v || 0) / 100 : 1))}</td></tr>`).join('')}
          </tbody></table>
          ${cur.note ? `<div>${esc(cur.note).replace(/\n/g, '<br>')}</div>` : ''}
          <div class="sum"><div class="qr"><div class="q" id="qr"></div><div>QR Platba<br>naskenujte v bankovní aplikaci</div></div>
            <div class="tot">${pl ? `Základ: ${fmt.czk2(t.base)}<br>DPH: ${fmt.czk2(t.vat)}<br>` : ''}<span class="cap">K úhradě</span><b>${fmt.czk2(t.total)}</b></div></div>
          <div class="ft">${esc(c.zapis)}${pl ? '' : ' Nejsem plátce DPH.'}</div>`;
        const q = P.querySelector('#qr'), code = spayd(d, cur);
        if (!code) q.textContent = 'QR se vytvoří po zadání čísla účtu';
        else if (window.QRCode) { try { new QRCode(q, { text: code, width: 192, height: 192, correctLevel: QRCode.CorrectLevel.M }) } catch (e) { q.textContent = 'QR nelze vytvořit' } }
        else q.textContent = 'Knihovna QR se nenačetla (chybí internet?)';
      }

      /* ---- odběratelé ---- */
      function viewClients(T) {
        T.innerHTML = `<div class="grid2" style="margin-top:16px">
          <section class="panel"><div class="phead"><h2>Nový odběratel</h2></div>
            <form id="cForm" class="fgrid"><label class="field" style="grid-column:1/-1">Název<input type="text" id="cN" required></label>
            <label class="field" style="grid-column:1/-1">Adresa<textarea id="cA" rows="2"></textarea></label>
            <label class="field">IČO<input type="text" id="cI" inputmode="numeric"></label><label class="field">DIČ<input type="text" id="cD"></label>
            <label class="field">E-mail<input type="text" id="cE"></label><div class="field" style="justify-content:flex-end"><button class="btn primary" type="submit">Přidat</button></div></form></section>
          <section class="panel"><div class="phead"><h2>Odběratelé</h2><span class="muted num">${d.clients.length}</span></div>
            <div class="srcs">${d.clients.map(c => `<div><span><b>${esc(c.name)}</b> <span class="muted">${c.ico ? '· IČO ' + esc(c.ico) : ''} · ${d.inv.filter(i => i.clientId === c.id).length} faktur</span></span><button class="btn sm danger" data-cdel="${c.id}">Smazat</button></div>`).join('') || '<span class="muted">Zatím nikdo.</span>'}</div></section></div>`;
        $('#cForm').onsubmit = e => {
          e.preventDefault(); const name = $('#cN').value.trim(); if (!name) return;
          if (d.sample) { d.clients = []; }
          const c = { id: uid(), name, addr: $('#cA').value.trim(), ico: $('#cI').value.trim(), dic: $('#cD').value.trim(), email: $('#cE').value.trim() };
          d.clients.push(c); save(); if (cur) { cur.clientId = c.id; cur.client = { ...c } } draw(); ctx.toast(`Odběratel ${name} přidán.`);
        };
        root.querySelectorAll('[data-cdel]').forEach(b => armed(b, () => { d.clients = d.clients.filter(c => c.id !== b.dataset.cdel); save(); draw() }));
      }

      /* ---- nastavení ---- */
      function viewCfg(T) {
        const c = d.cfg; const f = (k, l, extra = '') => `<label class="field">${l}<input type="text" data-c="${k}" value="${esc(c[k])}" ${extra}></label>`;
        T.innerHTML = `<section class="panel" style="margin-top:16px"><div class="phead"><h2>Údaje dodavatele</h2><span class="muted">Ukládá se automaticky</span></div>
          <div class="fgrid">${f('name', 'Jméno a příjmení')}${f('ico', 'IČO', 'inputmode="numeric"')}${f('dic', 'DIČ (nepovinné)')}${f('ucet', 'Číslo účtu (123-456789/0800)')}${f('email', 'E-mail')}${f('tel', 'Telefon')}
          <label class="field" style="grid-column:1/-1">Adresa<textarea data-c="addr" rows="2">${esc(c.addr)}</textarea></label>
          <label class="field" style="grid-column:1/-1">Text zápisu v rejstříku<input type="text" data-c="zapis" value="${esc(c.zapis)}"></label>
          <label class="field" style="grid-column:1/-1">Předmět e-mailu s fakturou<input type="text" data-c="mailPredmet" value="${esc(c.mailPredmet)}"></label>
          <label class="field" style="grid-column:1/-1">Text e-mailu ({cislo}, {castka}, {splatnost}, {vs}, {ucet}, {jmeno}, {telefon}, {odberatel})<textarea data-c="mailText" rows="7">${esc(c.mailText)}</textarea></label>
          <label class="field">Splatnost (dní)<input type="number" data-c="splatnost" value="${c.splatnost}" min="0"></label>
          <label class="field">Číslování faktur<select id="cNum"><option value="MMRRRR"${c.cislo === 'MMRRRR' ? ' selected' : ''}>měsíc + rok (072026)</option><option value="RRRRNNN"${c.cislo !== 'MMRRRR' ? ' selected' : ''}>rok + pořadí (2026001)</option></select></label>
          <label class="field">Limit pro DPH (Kč)<input type="number" data-c="limit" value="${c.limit}" step="1000"></label>
          <label class="field check" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" class="switch" id="cPl"${c.platce ? ' checked' : ''}> Jsem plátce DPH</label></div>
          ${c.ucet && !czIban(c.ucet) ? '<p class="err">Číslo účtu nemá tvar předčíslí-číslo/kód banky, QR platba nebude fungovat.</p>' : ''}
          <div class="lbl" style="margin:18px 0 8px">Pravidelné položky – přidají se na každou novou fakturu</div>
          <div class="modlist">${(c.pravidelne || []).map((x, k) => `<label style="display:grid;grid-template-columns:auto minmax(0,1fr) 130px auto;gap:10px"><input type="checkbox" class="switch" data-pr="${k}.on"${x.on ? ' checked' : ''} aria-label="Zapnuto">
            <input type="text" data-pr="${k}.t" value="${esc(x.t)}" aria-label="Text položky"><input type="number" data-pr="${k}.p" value="${x.p}" step="100" aria-label="Částka" style="text-align:right"><button type="button" class="btn sm danger" data-prdel="${k}" aria-label="Odebrat">×</button></label>`).join('')}</div>
          <button class="btn sm" id="prAdd" style="margin-top:8px">+ Pravidelná položka</button>
          <div class="acts" style="margin-top:16px"><button class="btn sm danger" id="faWipe">Smazat všechny faktury</button></div></section>`;
        root.querySelectorAll('[data-c]').forEach(i => i.onchange = () => { c[i.dataset.c] = i.type === 'number' ? +i.value : i.value.trim(); save(); if (i.dataset.c === 'ucet') draw(); ctx.toast('Uloženo.') });
        $('#cNum').onchange = e => { c.cislo = e.target.value; save(); ctx.toast('Číslování uloženo.') };
        root.querySelectorAll('[data-pr]').forEach(i => i.onchange = () => { const [k, f] = i.dataset.pr.split('.'); const x = c.pravidelne[+k]; x[f] = f === 'on' ? i.checked : f === 'p' ? (+i.value || 0) : i.value; save(); ctx.toast('Uloženo.') });
        root.querySelectorAll('[data-prdel]').forEach(b => b.onclick = () => { c.pravidelne.splice(+b.dataset.prdel, 1); save(); draw() });
        $('#prAdd').onclick = () => { c.pravidelne.push({ t: 'Nová pravidelná položka', p: 0, on: true }); save(); draw() };
        $('#cPl').onchange = e => { c.platce = e.target.checked; save(); ctx.toast(c.platce ? 'Faktury budou s DPH.' : 'Faktury bez DPH.') };
        armed($('#faWipe'), () => { d = { sample: false, cfg: d.cfg, clients: d.clients, inv: [] }; save(); cur = null; draw(); ctx.toast('Faktury smazány.') });
      }


      /* ---- import starších faktur ---- */

      /* ---- faktura z výkazu práce (Navigo3 a podobné programy) ----
         Navigo export „Výkazy“: Datum, Uživatel, Typ práce, Alokace, Popis, Počet jednotek, Jednotky,
         Nákladová cena / j., Prodejní cena / j., Vícenáklad, Vystavená faktura, Projekt, Zákazník, Org. jednotka …
         Řádky s Vícenáklad = Ano se nefakturují; už vyfakturované řádky se standardně vynechají. */
      const VCOLS = [
        ['datum', 'Datum *', [/^datum/, /^date/, /^den$/]],
        ['hodiny', 'Hodiny / počet jednotek *', [/pocet jednotek/, /hodin/, /^hod/, /^h$/, /doba/, /trvani/, /odprac/, /vykazan/, /mnozstvi/, /hours/, /duration/]],
        ['zakazka', 'Zakázka / projekt', [/^projekt$/, /zakazk/, /projekt/, /project/, /^akce/]],
        ['cast', 'Část / alokace', [/alokac/, /^cast/, /etap/, /faze/]],
        ['druh', 'Druh práce', [/typ prace/, /druh/, /cinnost/, /job/, /ukon/, /aktivit/]],
        ['popis', 'Popis', [/^popis/, /descr/, /komentar/]],
        ['osoba', 'Pracovník', [/^uzivatel$/, /uzivatel/, /pracovnik/, /osoba/, /^user/, /resitel/]],
        ['klient', 'Zákazník', [/zakaznik/, /klient/, /odberatel/, /customer/, /investor/]],
        ['org', 'Organizace', [/org\. jednotka/, /organizac/, /firma/]],
        ['prodej', 'Prodejní cena / h', [/prodejni cena \/ j/, /prodejni cena/, /sazba/, /rate/]],
        ['naklad', 'Nákladová cena / h', [/nakladova cena \/ j/, /nakladova cena/]],
        ['mzda', 'Mzdová část (Kč celkem za řádek)', [/mzdova cast/, /mzdov/]],
        ['vn', 'Vícenáklad (nefakturuje se)', [/vicenaklad/]],
        ['fakt', 'Už vyfakturováno', [/^vystavena faktura$/, /vystavena faktura/, /fakturovano/, /invoice/]]
      ];
      const vk = { file: null, rows: null, map: null, f: null, group: 'zakazka', format: 'vzor', rateSrc: d.cfg.rateSrc || 'mzda', sazba: d.cfg.sazba || '', clientId: '' };
      function vGuess(rows) {
        let best = 0, h = 0;
        for (let i = 0; i < Math.min(rows.length, 25); i++) { const sc = (rows[i] || []).filter(c => { const t = normT(c); return t && t.length < 50 && VCOLS.some(([, , rs]) => rs.some(r => r.test(t))) }).length; if (sc > best) { best = sc; h = i } }
        const head = (rows[h] || []).map(normT), used = new Set(), map = { header: h };
        for (const [k, , rs] of VCOLS) { map[k] = -1; outer: for (const r of rs) for (let i = 0; i < head.length; i++) if (!used.has(i) && !/\bid$/.test(head[i]) && r.test(head[i])) { map[k] = i; used.add(i); break outer } }
        return map;
      }
      function hrs(v) {
        if (v instanceof Date) return v.getUTCHours() + v.getUTCMinutes() / 60;
        if (typeof v === 'number') return v;
        const s = String(v ?? '').trim(); let m;
        if (m = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/)) return +m[1] + +m[2] / 60;
        if (m = s.match(/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i)) if (m[1] || m[2]) return amt(m[1] || 0) + (+m[2] || 0) / 60;
        return amt(s);
      }
      const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
      const yes = v => /^(ano|yes|true|1|a)$/i.test(String(v ?? '').trim()) || v === true;
      function vEntries() {
        const { rows, map } = vk; const out = []; let vn = 0;
        const g = (r, k) => map[k] >= 0 ? r[map[k]] : '';
        for (let i = map.header + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r) continue; const date = toIso(g(r, 'datum')); const h = hrs(g(r, 'hodiny'));
          if (!date || h == null || isNaN(h) || h === 0) continue;
          if (map.vn >= 0 && yes(g(r, 'vn'))) { vn++; continue }
          out.push({ date, h, zakazka: clean(g(r, 'zakazka')), cast: clean(g(r, 'cast')), druh: clean(g(r, 'druh')), popis: clean(g(r, 'popis')), osoba: clean(g(r, 'osoba')), klient: clean(g(r, 'klient')), org: clean(g(r, 'org')), prodej: amt(g(r, 'prodej')), naklad: amt(g(r, 'naklad')), mzda: amt(g(r, 'mzda')), fakt: clean(g(r, 'fakt')) });
        }
        if (out.length && out.every(e => e.h < 1) && map.hodiny >= 0 && !/pocet|jednot/.test(normT((rows[map.header] || [])[map.hodiny]))) out.forEach(e => e.h = Math.round(e.h * 24 * 100) / 100);
        out.vn = vn; return out;
      }
      function vFiltered(all) {
        const f = vk.f; return all.filter(e => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to) && (!f.osoba || e.osoba === f.osoba) && !f.off.has(e.zakazka) && !(f.skipInv && e.fakt));
      }
      function vItems(list) {
        const key = e => ({ zakazka: e.zakazka || 'Projektové práce', cast: [e.zakazka, e.cast].filter(Boolean).join(' – ') || 'Projektové práce', druh: e.druh || 'Projektové práce', jedna: 'Projektové práce dle výkazu' })[vk.group];
        const groups = new Map(), src = ['prodej', 'naklad', 'mzda'].includes(vk.rateSrc) ? vk.rateSrc : null;
        for (const e of list) { const k = key(e); const g = groups.get(k) || { t: k, h: 0, money: 0, rated: 0 }; g.h += e.h; if (src && e[src]) { g.money += src === 'mzda' ? e.mzda : e.h * e[src]; g.rated += e.h } groups.set(k, g) }
        const def = +vk.sazba || 0;
        return [...groups.values()].map(g => ({ t: g.t, q: Math.round(g.h * 100) / 100, u: 'hod', p: src ? (g.rated ? Math.round(g.money / g.rated * 100) / 100 : 0) : def, v: 21 }));
      }
      /* formát jako vzorová faktura: zakázka = 1 položka (1 ks), pod ní rozpis částí s částkami */
      function vVzor(list) {
        const src = ['prodej', 'naklad', 'mzda'].includes(vk.rateSrc) ? vk.rateSrc : null, def = +vk.sazba || 0, P = new Map();
        for (const e of list) {
          const a = src === 'mzda' ? (e.mzda || 0) : e.h * (src ? (e[src] || 0) : def);
          const p = P.get(e.zakazka) || { t: e.zakazka || 'Projektové práce', parts: new Map(), sum: 0, h: 0 };
          const lc = x => x ? x.charAt(0).toLowerCase() + x.slice(1) : ''; const k = [lc(e.druh), lc(e.cast)].filter(Boolean).join(' ') || 'projekční práce';
          const part = p.parts.get(k) || { a: 0, h: 0 }; part.a += a; part.h += e.h; p.parts.set(k, part); p.sum += a; p.h += e.h; P.set(e.zakazka, p);
        }
        return [...P.values()].map(p => ({ t: p.t, q: 1, u: 'ks', p: Math.round(p.sum), v: 0, h: p.h, d: [...p.parts].map(([k, x]) => `${k} - ${Math.round(x.a)},-`).join('\n') }));
      }
      const vMake = list => vk.format === 'vzor' ? vVzor(list) : vItems(list);
      function viewVykaz(T) {
        if (!vk.rows) {
          T.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
            <label class="drop" id="vkDrop"><div><strong>Nahrát výkaz práce</strong> <small>— export z Navigo3 (Výkazy → Excel) nebo z jiného programu ve formátu XLSX, XLS nebo CSV.</small></div><span class="btn primary">Vybrat soubor</span><input type="file" id="vkFile" accept=".xlsx,.xls,.csv,.txt" hidden></label>
            <section class="panel"><div class="phead"><h2>Jak na to v Navigu</h2></div><ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
              <li>V Navigu otevřete výkazy, ve filtru nastavte období a sebe jako uživatele a exportujte je do Excelu.</li>
              <li>Soubor nahrajte sem. Sloupce Navigo exportu se rozpoznají samy.</li>
              <li>Vícenáklady se nefakturují a už vyfakturované řádky se vynechají. Vyberte odběratele a sazbu; položky se seskupí podle zakázek nebo jejich částí.</li></ol></section></div>`;
          const drop = $('#vkDrop'), fi = $('#vkFile');
          const go = async f => {
            if (!f) return;
            try {
              const buf = await f.arrayBuffer(), ext = f.name.split('.').pop().toLowerCase(); let rows;
              if (ext === 'xlsx' || ext === 'xls') { if (!window.XLSX) throw new Error('Knihovna pro Excel se nenačetla.'); const wb = XLSX.read(buf, { type: 'array', cellDates: true }); const sh = wb.Sheets['Data'] || wb.Sheets[wb.SheetNames[0]]; rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' }) }
              else rows = csvRows(decodeBuf(buf));
              vk.file = f.name; vk.rows = rows; vk.map = vGuess(rows); vk.f = null; draw();
            } catch (e) { ctx.toast(`${f.name}: ${e.message || 'soubor se nepodařilo přečíst'}`) }
          };
          fi.onchange = e => { go(e.target.files[0]); e.target.value = '' };
          ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over') }));
          ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over') }));
          drop.addEventListener('drop', e => go(e.dataTransfer.files[0]));
          return;
        }
        const all = vEntries();
        const nm = s => normT(s).replace(/[^a-z0-9]/g, '');
        const findClient = n => n && d.clients.find(c => nm(c.name) && (nm(c.name).includes(nm(n)) || nm(n).includes(nm(c.name))));
        if (!vk.f && all.length) {
          const ds = all.map(e => e.date).sort(), people = [...new Set(all.map(e => e.osoba).filter(Boolean))];
          const me = people.find(p => d.cfg.name && normT(p).includes(normT(d.cfg.name).split(' ').pop())) || (people.length === 1 ? people[0] : '');
          vk.f = { from: ds[0], to: ds[ds.length - 1], osoba: me, off: new Set(), skipInv: true };
          const org = all.find(e => e.org)?.org, kl = all.find(e => e.klient)?.klient;
          vk.clientId = (findClient(org) || findClient(kl) || {}).id || (org ? 'new:' + org : d.clients[0]?.id || '');
        }
        const head = vk.rows[vk.map.header] || [];
        const opts = sel => '<option value="-1">—</option>' + head.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || 'sloupec ' + (i + 1))}</option>`).join('');
        if (all.length && ['naklad', 'prodej', 'mzda'].includes(vk.rateSrc) && !all.some(e => e[vk.rateSrc])) vk.rateSrc = all.some(e => e.mzda) ? 'mzda' : 'vlastni';
        const list = all.length ? vFiltered(all) : [], items = vMake(list);
        const inRange = e => (!vk.f.osoba || e.osoba === vk.f.osoba) && e.date >= vk.f.from && e.date <= vk.f.to;
        const zak = [...new Set(all.filter(inRange).map(e => e.zakazka))].map(z => [z, all.filter(e => e.zakazka === z && inRange(e) && !(vk.f.skipInv && e.fakt)).reduce((s, e) => s + e.h, 0)]).filter(x => x[1] > 0);
        const people = [...new Set(all.map(e => e.osoba).filter(Boolean))];
        const invd = all.filter(e => e.fakt && inRange(e)).length;
        const hasP = all.some(e => e.prodej), hasN = all.some(e => e.naklad), hasM = all.some(e => e.mzda);
        const newOpts = [...new Set([all.find(e => e.org)?.org, all.find(e => e.klient)?.klient].filter(n => n && !findClient(n)))];
        const sumH = list.reduce((s, e) => s + e.h, 0), sumK = items.reduce((s, i) => s + i.q * i.p, 0) + rec().reduce((s, i) => s + i.p, 0);
        T.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <section class="imp"><div class="phead" style="margin:0"><h2>Výkaz ${esc(vk.file)}</h2><button class="btn sm" id="vkNew">Jiný soubor</button></div>
            <span class="muted">${all.length} záznamů k fakturaci${all.vn ? ` · <b style="color:var(--warn)">${all.vn} vícenákladů vynecháno</b>` : ''}${invd ? ` · ${invd} už vyfakturovaných` : ''}</span>
            <details${all.length ? '' : ' open'}><summary class="lbl" style="cursor:pointer">Sloupce v souboru</summary>
              <div class="mapgrid" style="margin-top:10px"><label>Řádek se záhlavím<input type="number" id="vkH" min="1" value="${vk.map.header + 1}"></label>${VCOLS.map(([k, l]) => `<label>${l}<select data-vm="${k}">${opts(vk.map[k])}</select></label>`).join('')}</div></details>
            ${all.length ? '' : '<span class="err">Nenacházím žádné záznamy. Vyberte aspoň sloupce Datum a Hodiny.</span>'}</section>
          ${all.length ? `<div class="grid2">
            <section class="panel"><div class="phead"><h2>Co fakturovat</h2></div>
              <div class="fgrid">
                <label class="field">Od<input type="date" id="vkFrom" value="${vk.f.from}"></label><label class="field">Do<input type="date" id="vkTo" value="${vk.f.to}"></label>
                ${people.length > 1 ? `<label class="field">Pracovník<select id="vkOs"><option value="">všichni</option>${people.map(p => `<option${p === vk.f.osoba ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
                <label class="field">Formát položek<select id="vkFm"><option value="vzor"${vk.format === 'vzor' ? ' selected' : ''}>jako moje faktura: zakázka s rozpisem</option><option value="hodiny"${vk.format === 'hodiny' ? ' selected' : ''}>hodiny × sazba</option></select></label>
                ${vk.format === 'hodiny' ? `<label class="field">Položky podle<select id="vkG">${[['zakazka', 'zakázek'], ['cast', 'zakázek a jejich částí'], ['druh', 'typu práce'], ['jedna', 'jedna položka']].map(([k, l]) => `<option value="${k}"${vk.group === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
                <label class="field">Sazba<select id="vkRs">${hasM ? `<option value="mzda"${vk.rateSrc === 'mzda' ? ' selected' : ''}>mzdová část z výkazu</option>` : ''}<option value="vlastni"${vk.rateSrc === 'vlastni' ? ' selected' : ''}>vlastní hodinová sazba</option>${hasP ? `<option value="prodej"${vk.rateSrc === 'prodej' ? ' selected' : ''}>prodejní cena z výkazu</option>` : ''}${hasN ? `<option value="naklad"${vk.rateSrc === 'naklad' ? ' selected' : ''}>nákladová cena z výkazu</option>` : ''}</select></label>
                ${vk.rateSrc === 'vlastni' ? `<label class="field">Hodinová sazba (Kč)<input type="number" id="vkS" step="10" min="0" value="${esc(vk.sazba)}"></label>` : ''}
                <label class="field">Odběratel<select id="vkC">${d.clients.map(c => `<option value="${c.id}"${c.id === vk.clientId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}${newOpts.map(n => `<option value="new:${esc(n)}"${vk.clientId === 'new:' + n ? ' selected' : ''}>+ ${esc(n)} (založit z výkazu)</option>`).join('')}<option value="">+ jiný nový odběratel…</option></select></label>
              </div>
              <label class="check" style="margin-top:10px"><input type="checkbox" id="vkSk"${vk.f.skipInv ? ' checked' : ''}> Vynechat řádky, které už mají vystavenou fakturu</label>
              ${zak.length > 1 ? `<div class="lbl" style="margin:14px 0 6px">Zakázky</div><div class="modlist">${zak.map(([z, h], i) => `<label><input type="checkbox" class="switch" data-vz="${i}"${vk.f.off.has(z) ? '' : ' checked'}><span><b>${esc(z || '(bez zakázky)')}</b> <span class="d">${fmt.num(h, 2)} h</span></span></label>`).join('')}</div>` : ''}
            </section>
            <section class="panel"><div class="phead"><h2>Náhled položek</h2><span class="muted num">${fmt.num(sumH, 2)} h · ${list.length} záznamů</span></div>
              <div class="tablebox"><table style="min-width:420px"><thead><tr><th>Položka</th><th class="amt">Hodin</th><th class="amt">${vk.format === 'vzor' ? '' : 'Sazba'}</th><th class="amt">Celkem</th></tr></thead><tbody>
              ${rec().map(i => `<tr><td>${esc(i.t)} <span class="pill dim">pravidelná</span></td><td class="amt">—</td><td class="amt">${fmt.num(i.p)}</td><td class="amt">${fmt.czk(i.p)}</td></tr>`).join('')}${items.map(i => `<tr><td>${esc(i.t)}${i.d ? `<div class="x" style="white-space:pre-line">${esc(i.d)}</div>` : ''}</td><td class="amt">${fmt.num(i.h ?? i.q, 2)}</td><td class="amt">${vk.format === 'vzor' ? (i.p ? '' : '<span style="color:var(--warn)">doplňte sazbu</span>') : i.p ? fmt.num(i.p) : '<span style="color:var(--warn)">doplňte</span>'}</td><td class="amt">${fmt.czk(i.q * i.p)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Ve vybraném období nic.</td></tr>'}
              </tbody></table></div>
              <div class="taxrow" style="border:0"><span>Celkem${d.cfg.platce ? ' bez DPH' : ''}</span><b style="font-size:18px">${fmt.czk(sumK)}</b></div>
              <div class="acts"><button class="btn primary" id="vkGo"${items.length && items.every(i => i.p > 0) && vk.clientId ? '' : ' disabled'}>Vytvořit koncept faktury</button>
              ${!vk.clientId ? '<span class="muted">Vyberte odběratele.</span>' : !items.every(i => i.p > 0) ? '<span class="muted">Doplňte hodinovou sazbu.</span>' : ''}</div></section></div>` : ''}</div>`;
        $('#vkNew').onclick = () => { vk.rows = null; draw() };
        root.querySelectorAll('[data-vm]').forEach(s => s.onchange = () => { vk.map[s.dataset.vm] = +s.value; vk.f = null; draw() });
        $('#vkH').onchange = e => { const h = Math.max(0, (+e.target.value || 1) - 1); const g = vGuess(vk.rows.slice(h)); g.header = h; Object.keys(g).forEach(k => { if (k !== 'header' && g[k] >= 0) g[k] = g[k] }); vk.map = g; vk.map.header = h; vk.f = null; draw() };
        if (!all.length) return;
        $('#vkFrom').onchange = e => { vk.f.from = e.target.value; draw() };
        $('#vkTo').onchange = e => { vk.f.to = e.target.value; draw() };
        const os = $('#vkOs'); if (os) os.onchange = e => { vk.f.osoba = e.target.value; draw() };
        const vg = $('#vkG'); if (vg) vg.onchange = e => { vk.group = e.target.value; draw() };
        $('#vkFm').onchange = e => { vk.format = e.target.value; draw() };
        $('#vkRs').onchange = e => { vk.rateSrc = d.cfg.rateSrc = e.target.value; save(); draw() };
        $('#vkSk').onchange = e => { vk.f.skipInv = e.target.checked; draw() };
        const vs = $('#vkS');
        if (vs) {
          vs.oninput = () => { vk.sazba = vs.value; const g = $('#vkGo'); if (g) g.disabled = !(+vs.value > 0) || !vk.clientId };
          vs.addEventListener('blur', e => { d.cfg.sazba = +vs.value || ''; save(); if (e.relatedTarget?.id !== 'vkGo') draw() });
          vs.addEventListener('keydown', e => { if (e.key === 'Enter') vs.blur() });
        }
        $('#vkC').onchange = e => { if (!e.target.value) { tab = 'klienti'; draw(); ctx.toast('Přidejte odběratele a vraťte se do záložky Z výkazu práce.'); return } vk.clientId = e.target.value; draw() };
        root.querySelectorAll('[data-vz]').forEach(c => c.onchange = () => { const z = zak[+c.dataset.vz][0]; c.checked ? vk.f.off.delete(z) : vk.f.off.add(z); draw() });
        $('#vkGo').onclick = () => {
          const lst = vFiltered(vEntries()), items = vMake(lst), hours = lst.reduce((s, e) => s + e.h, 0);
          if (!items.length || !items.every(i => i.p > 0)) { draw(); return }
          let c;
          if (String(vk.clientId).startsWith('new:')) {
            if (d.sample) d = { sample: false, cfg: d.cfg, clients: [], inv: [] };
            c = { id: uid(), name: vk.clientId.slice(4), addr: '', ico: '', dic: '', email: '' }; d.clients.push(c); save(); vk.clientId = c.id;
            ctx.toast(`Odběratel ${c.name} založen. Doplňte mu v záložce Odběratelé adresu a IČO.`);
          } else c = d.clients.find(x => x.id === vk.clientId);
          if (!c) { draw(); return }
          newInv(); cur.clientId = c.id; cur.client = { ...c }; cur.items = [...cur.items.filter(i => i.t), ...items.map(({ h, ...i }) => ({ ...i, v: d.cfg.platce ? 21 : 0 }))];
          cur.note = '';
          cur.source = { vykaz: vk.file, od: vk.f.from, do: vk.f.to, hodin: hours };
          tab = 'editor'; draw();
        };
      }

      const imp = { tables: [], recs: [], busy: '' };
      function viewImport(T) {
        const tb = imp.tables[0];
        T.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
          <label class="drop" id="faDrop"><div><strong>Nahrát starší faktury</strong> <small>— PDF faktur (i více faktur v jednom PDF), export seznamu faktur v XLS/XLSX/CSV nebo soubory ISDOC. Lze více najednou.</small></div>
            <span class="btn primary">Vybrat soubory</span><input type="file" id="faFile" multiple accept=".pdf,.csv,.xls,.xlsx,.isdoc,.xml,.isdocx" hidden></label>
          ${imp.busy ? `<div class="panel"><span class="sim">${esc(imp.busy)}</span></div>` : ''}
          ${!imp.recs.length && !tb && !imp.busy ? `<section class="panel"><div class="phead"><h2>Jak získat faktury z Billdu</h2></div>
            <ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
              <li><b style="color:var(--fg)">Seznam faktur (nejspolehlivější):</b> v Billdu označte faktury a zvolte hromadný export do XLS nebo CSV. Soubor nahrajte sem a zkontrolujte, které sloupce co obsahují.</li>
              <li><b style="color:var(--fg)">PDF:</b> hromadný export PDF vám Billdu pošle e-mailem jako ZIP. Rozbalte ho a nahrajte PDF sem. Číslo, data, odběratele a částku čtu z textu faktury, takže je vždy zkontrolujte.</li>
              <li><b style="color:var(--fg)">ISDOC:</b> pokud máte faktury z jiného programu (Fakturoid, iDoklad, Pohoda…), nahrajte soubory .isdoc. Přenesou se i jednotlivé položky.</li></ol>
            <p class="muted" style="font-size:12px">Soubory se zpracují jen ve vašem prohlížeči. Samotná PDF se neukládají, ukládají se jen údaje z nich.</p></section>` : ''}
          ${tb ? tableMapView(tb) : ''}
          ${imp.recs.length ? reviewView() : ''}</div>`;
        const drop = $('#faDrop'), fi = $('#faFile');
        fi.onchange = e => { handle([...e.target.files]); e.target.value = '' };
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over') }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over') }));
        drop.addEventListener('drop', e => handle([...e.dataTransfer.files]));
        if (tb) wireMap(tb);
        if (imp.recs.length) wireReview();
      }
      async function handle(files) {
        for (const f of files) {
          const ext = f.name.split('.').pop().toLowerCase();
          imp.busy = `Čtu ${f.name}…`; draw();
          try {
            const buf = await f.arrayBuffer();
            if (ext === 'pdf') { const r = await fromPdf(buf, f.name); if (!r.length) ctx.toast(`${f.name}: nenašel jsem v něm fakturu.`); imp.recs.push(...r) }
            else if (ext === 'isdoc' || ext === 'xml') imp.recs.push(...fromIsdoc(decodeBuf(buf), f.name));
            else if (ext === 'isdocx') ctx.toast(`${f.name}: soubor .isdocx je ZIP. Přejmenujte ho na .zip, rozbalte a nahrajte .isdoc uvnitř.`);
            else if (ext === 'xls' || ext === 'xlsx') {
              if (!window.XLSX) throw new Error('Knihovna pro Excel se nenačetla. Uložte export jako CSV.');
              const wb = XLSX.read(buf, { type: 'array', cellDates: true });
              const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
              imp.tables.push({ name: f.name, rows, map: tableGuess(rows) });
            } else if (ext === 'csv' || ext === 'txt') { const rows = csvRows(decodeBuf(buf)); imp.tables.push({ name: f.name, rows, map: tableGuess(rows) }) }
            else ctx.toast(`${f.name}: tento formát neumím.`);
          } catch (e) { console.error(e); ctx.toast(`${f.name}: ${e.message || 'soubor se nepodařilo přečíst'}`) }
        }
        imp.busy = ''; prepRecs(); draw();
      }
      function prepRecs() {
        const td = App.today(), have = new Set(d.sample ? [] : d.inv.map(i => String(i.cislo)));
        const seen = new Set();
        for (const r of imp.recs) {
          if (r._prep) { seen.add(String(r.cislo)); continue }
          r._prep = true; r.varovani = r.varovani || [];
          r.splatnost = r.splatnost || (r.vystaveno ? addDays(r.vystaveno, 14) : '');
          if (!r.stav) r.stav = 'zaplaceno';
          r.paid = r.stav === 'zaplaceno' ? (r.paid || r.splatnost || r.vystaveno || td) : null;
          if (!r.cislo) r.varovani.push('chybí číslo');
          if (r.total == null) r.varovani.push('chybí částka');
          if (!r.vystaveno) r.varovani.push('chybí datum vystavení');
          if (!r.klient) r.varovani.push('chybí odběratel');
          if (r.mena && r.mena !== 'CZK') r.varovani.push(`měna ${r.mena} – uloží se jako Kč`);
          const dup = have.has(String(r.cislo)) || seen.has(String(r.cislo));
          if (dup) r.varovani.push('číslo už existuje');
          r.vzit = !dup && r.stav !== 'storno' && !!r.cislo && r.total != null;
          seen.add(String(r.cislo));
        }
      }
      function tableMapView(tb) {
        const head = tb.rows[tb.map.header] || [];
        const opts = sel => '<option value="-1">—</option>' + head.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || 'sloupec ' + (i + 1))}</option>`).join('');
        const n = tableRecords(tb.rows, tb.map, tb.name).length;
        return `<section class="imp"><div class="phead" style="margin:0"><h2>Sloupce v souboru ${esc(tb.name)}</h2><span class="muted">${imp.tables.length > 1 ? 'další v pořadí: ' + (imp.tables.length - 1) : ''}</span></div>
          <div class="mapgrid"><label>Řádek se záhlavím<input type="number" id="tmH" min="1" value="${tb.map.header + 1}"></label>${COLS.map(([k, l]) => `<label>${l}<select data-tm="${k}">${opts(tb.map[k])}</select></label>`).join('')}</div>
          <div class="acts"><button class="btn primary" id="tmGo"${n ? '' : ' disabled'}>Načíst ${n} faktur ke kontrole</button><button class="btn" id="tmSkip">Přeskočit soubor</button>
          ${n ? '' : '<span class="err">Zatím nenacházím žádnou fakturu. Vyberte aspoň sloupce Číslo a Částka celkem.</span>'}</div></section>`;
      }
      function wireMap(tb) {
        root.querySelectorAll('[data-tm]').forEach(s => s.onchange = () => { tb.map[s.dataset.tm] = +s.value; draw() });
        $('#tmH').onchange = e => { const h = Math.max(0, (+e.target.value || 1) - 1); const g = tableGuess(tb.rows.slice(h)); for (const k in g) if (k !== 'header') tb.map[k] = g[k]; tb.map.header = h; draw() };
        $('#tmGo').onclick = () => { imp.recs.push(...tableRecords(tb.rows, tb.map, tb.name)); imp.tables.shift(); prepRecs(); draw() };
        $('#tmSkip').onclick = () => { imp.tables.shift(); draw() };
      }
      function reviewView() {
        const n = imp.recs.filter(r => r.vzit).length, sum = imp.recs.filter(r => r.vzit).reduce((s, r) => s + (r.total || 0), 0);
        const inp = (i, k, type = 'text', w = '') => `<input type="${type}" data-r="${i}" data-k="${k}" value="${esc(r_(i)[k] ?? '')}"${w ? ` style="width:${w}"` : ''} aria-label="${k}">`;
        return `<section class="panel"><div class="phead"><h2>Kontrola před importem</h2><span class="muted num">${imp.recs.length} nalezeno · ${n} k importu · ${fmt.czk(sum)}</span></div>
          <p class="muted" style="margin-top:0">Údaje z PDF jsou odhad podle textu faktury. Opravte, co nesedí. Stav je předvyplněný jako <b>zaplaceno</b>; u neuhrazených ho přepněte a později je spárujete s výpisy z banky.</p>
          <div class="tablebox"><table class="fa-rev"><thead><tr><th></th><th>Číslo</th><th>Odběratel</th><th>IČO</th><th>Vystaveno</th><th>Splatnost</th><th class="amt">Celkem Kč</th><th>Stav</th><th>Poznámka</th></tr></thead><tbody>
          ${imp.recs.map((r, i) => `<tr class="${r.vzit ? '' : 'off'}"><td><input type="checkbox" data-take="${i}"${r.vzit ? ' checked' : ''} aria-label="Importovat"></td>
            <td>${inp(i, 'cislo', 'text', '110px')}</td><td>${inp(i, 'klient', 'text', '190px')}</td><td>${inp(i, 'ico', 'text', '92px')}</td>
            <td>${inp(i, 'vystaveno', 'date')}</td><td>${inp(i, 'splatnost', 'date')}</td><td>${inp(i, 'total', 'number', '110px')}</td>
            <td><select data-r="${i}" data-k="stav" aria-label="Stav"><option value="zaplaceno"${r.stav === 'zaplaceno' ? ' selected' : ''}>zaplaceno</option><option value="vystaveno"${r.stav !== 'zaplaceno' ? ' selected' : ''}>neuhrazeno</option></select></td>
            <td class="x">${esc(r.zdroj)}${r.items ? ` · ${r.items.length} položek` : ''}${r.varovani.length ? `<br><span style="color:var(--warn)">${esc(r.varovani.join(', '))}</span>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="acts" style="margin-top:12px"><button class="btn primary" id="rvGo"${n ? '' : ' disabled'}>Importovat ${n} faktur</button><button class="btn" id="rvCancel">Zahodit</button></div></section>`;
      }
      const r_ = i => imp.recs[i];
      function wireReview() {
        root.querySelectorAll('[data-r]').forEach(el => el.onchange = () => {
          const r = r_(+el.dataset.r), k = el.dataset.k; r[k] = k === 'total' ? amt(el.value) : el.value.trim();
          if (k === 'stav') r.paid = r.stav === 'zaplaceno' ? (r.paid || r.splatnost || r.vystaveno) : null;
          draw();
        });
        root.querySelectorAll('[data-take]').forEach(el => el.onchange = () => { r_(+el.dataset.take).vzit = el.checked; draw() });
        $('#rvCancel').onclick = () => { imp.recs = []; draw() };
        $('#rvGo').onclick = () => {
          const take = imp.recs.filter(r => r.vzit && r.cislo && r.total != null);
          if (d.sample) d = { sample: false, cfg: d.cfg, clients: [], inv: [] };
          const nm = s => normT(s).replace(/[^a-z0-9]/g, '');
          for (const r of take) {
            let c = (r.ico && d.clients.find(x => x.ico === r.ico)) || (r.klient && d.clients.find(x => nm(x.name) === nm(r.klient)));
            if (!c && (r.klient || r.ico)) { c = { id: uid(), name: r.klient || 'IČO ' + r.ico, addr: r.adresa || '', ico: r.ico || '', dic: r.dic || '', email: '' }; d.clients.push(c) }
            const vyst = r.vystaveno || App.today();
            d.inv.push({
              id: uid(), cislo: String(r.cislo), clientId: c?.id || '', client: c ? { ...c } : { name: r.klient || '' },
              vystaveno: vyst, duzp: r.duzp || vyst, splatnost: r.splatnost || addDays(vyst, 14),
              items: r.items || [{ t: 'Faktura převzatá z ' + r.zdroj, q: 1, u: 'ks', p: r.total, v: 0 }],
              fixed: r.items ? null : { total: r.total, base: r.base ?? null },
              note: '', stav: r.stav === 'zaplaceno' ? 'zaplaceno' : 'vystaveno', paid: r.stav === 'zaplaceno' ? (r.paid || r.splatnost || vyst) : null,
              imported: { from: r.zdroj, at: App.today() }
            });
          }
          save(); imp.recs = []; tab = 'prehled'; draw(); ctx.toast(`Importováno ${take.length} faktur.`);
        };
      }

      function armed(btn, fn) { btn.onclick = () => { if (btn.classList.contains('armed')) fn(); else { const o = btn.textContent; btn.classList.add('armed'); btn.textContent = 'Opravdu?'; setTimeout(() => { btn.classList.remove('armed'); btn.textContent = o }, 4000) } } }
      draw();
      return ctx.bus.on('faktury:changed', () => { d = load(ctx.store); draw() });
    }
  });
})();
