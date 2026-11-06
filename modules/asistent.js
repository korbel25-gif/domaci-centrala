/* =====================================================================
   MODUL: Asistent
   Hlasový a textový asistent nad celou centrálou.
   - Mozek: Claude (v publikované verzi přes účet claude.ai, lokálně přes
     vlastní API klíč) s nástroji, které poskytují moduly (vlastnost tools).
     Bez připojení běží offline režim s pevnými povely.
   - Hlas: rozpoznávání řeči (Chrome/Edge, lokální verze) a čtení odpovědí.
   - Kdekoli: kulaté tlačítko vpravo dole nebo Ctrl+K.
   Data: App.store('asistent') → 'cfg'
   ===================================================================== */
(function () {
  const { esc, fmt } = App;
  const store = App.store('asistent');
  const CFG0 = { name: 'Jarvis', brain: 'auto', apiKey: '', model: 'claude-sonnet-4-5', voice: true, voiceName: '', wake: false, depth: 'quick' };
  let cfg = Object.assign({}, CFG0, store.get('cfg', {}));
  if (cfg.name === 'Atlas') { cfg.name = CFG0.name; store.set('cfg', cfg) }
  const saveCfg = () => store.set('cfg', cfg);
  const nt = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const owner = () => App.raw.get('hs:core:owner') || '';

  App.css('asistent', `
  .as-orb{position:fixed;right:calc(22px + env(safe-area-inset-right,0px));bottom:calc(22px + env(safe-area-inset-bottom,0px));width:62px;height:62px;border-radius:50%;border:0;padding:0;z-index:30;cursor:pointer;
    background:radial-gradient(circle at 50% 50%,rgba(46,240,255,.95) 0 14%,rgba(46,240,255,.25) 15% 30%,rgba(5,8,16,.9) 31%);box-shadow:0 0 24px rgba(46,240,255,.55),inset 0 0 12px rgba(46,240,255,.4)}
  .as-orb::before,.as-orb::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:rgba(46,240,255,.35);animation:asSpin 4s linear infinite}
  .as-orb::after{inset:5px;border-top-color:transparent;border-bottom-color:#A57BFF;border-left-color:rgba(165,123,255,.4);animation-duration:2.6s;animation-direction:reverse}
  .as-orb.hid{opacity:0;pointer-events:none;transform:scale(.6);transition:opacity .2s,transform .2s}
  .as-orb.listening{background:radial-gradient(circle,rgba(56,255,165,.95) 0 16%,rgba(56,255,165,.25) 17% 32%,rgba(5,8,16,.9) 33%);box-shadow:0 0 30px rgba(56,255,165,.7);animation:asPulse 1s ease-in-out infinite}
  .as-orb.thinking::before{animation-duration:.9s}.as-orb.thinking::after{animation-duration:.6s}
  .as-orb.speaking{animation:asPulse .55s ease-in-out infinite}
  @keyframes asSpin{to{transform:rotate(360deg)}}
  @keyframes asPulse{50%{transform:scale(1.08)}}
  .as-panel{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);z-index:29;display:flex;flex-direction:column;background:var(--glass);backdrop-filter:blur(14px);
    border-left:1px solid rgba(46,240,255,.35);box-shadow:-20px 0 60px var(--shade),0 0 40px rgba(46,240,255,.1);transform:translateX(105%);transition:transform .35s cubic-bezier(.2,.8,.2,1);
    padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-right:env(safe-area-inset-right,0px)}
  .as-panel.open{transform:none}
  .as-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}
  .as-head .ring{width:38px;height:38px;border-radius:50%;flex:none;position:relative;background:radial-gradient(circle,var(--accent) 0 18%,transparent 19%)}
  .as-head .ring::before{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-left-color:rgba(46,240,255,.4);animation:asSpin 3s linear infinite}
  .as-head b{font-family:var(--f-display);text-transform:uppercase;letter-spacing:.16em;font-size:16px}
  .as-head small{display:block;font-family:var(--f-mono);font-size:11px;color:var(--muted);letter-spacing:.02em}
  .as-head .x{margin-left:auto}
  .as-wave{display:flex;gap:3px;align-items:center;height:22px;margin-left:8px}
  .as-wave i{width:3px;height:4px;background:var(--accent);border-radius:2px;opacity:.5;transition:height .15s}
  .as-panel.speaking .as-wave i,.as-panel.listening .as-wave i{animation:asBar .7s ease-in-out infinite;opacity:1}
  .as-panel.listening .as-wave i{background:var(--inc)}
  .as-wave i:nth-child(2){animation-delay:.1s!important}.as-wave i:nth-child(3){animation-delay:.2s!important}.as-wave i:nth-child(4){animation-delay:.3s!important}.as-wave i:nth-child(5){animation-delay:.15s!important}
  @keyframes asBar{50%{height:20px}}
  .as-msgs{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
  .as-m{max-width:88%;padding:10px 13px;border-radius:4px;line-height:1.5;white-space:pre-wrap;word-break:break-word;animation:viewin .3s ease-out}
  .as-m.u{align-self:flex-end;background:var(--accent-soft);border:1px solid rgba(46,240,255,.35)}
  .as-m.a{align-self:flex-start;background:var(--card2);border:1px solid var(--line);border-left:2px solid var(--accent)}
  .as-m.a.err{border-left-color:var(--exp)}
  .as-t{align-self:flex-start;font-family:var(--f-mono);font-size:11px;color:var(--muted);padding-left:4px}
  .as-t::before{content:"› ";color:var(--accent)}
  .as-chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 18px 10px}
  .as-chips button{border:1px solid var(--line);background:var(--field);color:var(--muted);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600}
  .as-chips button:hover{color:var(--fg);border-color:var(--accent)}
  .as-in{display:flex;gap:8px;padding:12px 18px 16px;border-top:1px solid var(--line);align-items:flex-end}
  .as-in textarea{flex:1;resize:none;min-height:42px;max-height:120px;padding:10px 12px}
  .as-in .btn{height:42px;display:grid;place-items:center;padding:0 12px}
  .as-in .mic.on{background:var(--inc);border-color:var(--inc);color:var(--on-accent);box-shadow:0 0 16px rgba(56,255,165,.6)}
  .as-in svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .as-big{display:grid;place-items:center;padding:20px 0}
  .as-big .orb2{width:180px;height:180px;border-radius:50%;position:relative;cursor:pointer;border:0;background:radial-gradient(circle,rgba(46,240,255,.95) 0 10%,rgba(46,240,255,.18) 11% 34%,rgba(5,8,16,.6) 35%);box-shadow:0 0 60px rgba(46,240,255,.35)}
  .as-big .orb2::before,.as-big .orb2::after{content:"";position:absolute;border-radius:50%;border:2px solid transparent}
  .as-big .orb2::before{inset:-14px;border-top-color:var(--accent);border-right-color:rgba(46,240,255,.3);animation:asSpin 6s linear infinite}
  .as-big .orb2::after{inset:14px;border-bottom-color:#A57BFF;border-left-color:rgba(165,123,255,.3);animation:asSpin 3.5s linear infinite reverse}
  .as-tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:8px}
  .as-tools div{border:1px solid var(--line);border-radius:var(--r);padding:8px 10px;background:var(--card);font-size:12px;color:var(--muted)}
  .as-tools b{display:block;font-family:var(--f-mono);color:var(--accent);font-size:12px;margin-bottom:2px}
  @media (prefers-reduced-motion:reduce){.as-orb::before,.as-orb::after,.as-head .ring::before,.as-big .orb2::before,.as-big .orb2::after{animation:none}}
  `);

  /* ===================== stav a UI panelu ===================== */
  let panel, orb, msgs, input, micBtn, statusEl, sampleFn = null, busy = false, ctl = null;
  const hist = [];   // {role, content} – krátká paměť rozhovoru
  function setState(s) { ['listening', 'thinking', 'speaking'].forEach(c => { orb?.classList.toggle(c, s === c); panel?.classList.toggle(c, s === c) }) }
  function brain() {
    if (cfg.brain === 'offline') return 'offline';
    if (cfg.brain !== 'api' && sampleFn) return 'claude';
    if (cfg.brain !== 'claude' && cfg.apiKey) return 'api';
    return 'offline';
  }
  const brainLabel = () => ({ claude: 'online · Claude (váš účet)', api: 'online · Claude API', offline: 'offline režim · pevné povely' })[brain()];
  function status() { if (statusEl) statusEl.textContent = brainLabel() }

  function buildUI() {
    orb = document.createElement('button'); orb.className = 'as-orb'; orb.setAttribute('aria-label', 'Otevřít asistenta (Ctrl+K)'); orb.title = 'Asistent (Ctrl+K)';
    panel = document.createElement('aside'); panel.className = 'as-panel'; panel.setAttribute('aria-label', 'Asistent');
    panel.innerHTML = `<div class="as-head"><span class="ring"></span><div><b id="asName"></b><small id="asStatus"></small></div><span class="as-wave"><i></i><i></i><i></i><i></i><i></i></span>
        <button class="btn sm x" id="asClose" aria-label="Zavřít">✕</button></div>
      <div class="as-msgs" id="asMsgs" aria-live="polite"></div>
      <div class="as-chips">${[['Hlášení', '__brief'], ['Stavba domu', 'Jak jsme na tom se stavbou domu?'], ['Výdaje tento měsíc', 'Kolik jsem utratil tento měsíc?'], ['Neuhrazené faktury', 'Které faktury nejsou zaplacené?'], ['Portfolio', 'Jak je na tom moje portfolio?'], ['Večerní scéna', 'Spusť scénu večer']].map(([l, q]) => `<button data-q="${esc(q)}">${l}</button>`).join('')}</div>
      <form class="as-in" id="asForm"><textarea id="asIn" rows="1" placeholder="Napište nebo podržte mikrofon…" aria-label="Zpráva pro asistenta"></textarea>
        <button type="button" class="btn mic" id="asMic" aria-label="Mluvit"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
        <button class="btn primary" aria-label="Odeslat"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z"/></svg></button></form>`;
    document.body.append(panel, orb);
    msgs = panel.querySelector('#asMsgs'); input = panel.querySelector('#asIn'); micBtn = panel.querySelector('#asMic'); statusEl = panel.querySelector('#asStatus');
    panel.querySelector('#asName').textContent = cfg.name;
    orb.onclick = () => toggle(); panel.querySelector('#asClose').onclick = () => toggle(false);
    panel.querySelector('#asForm').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ''; ask(t) } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('#asForm').requestSubmit() } });
    panel.querySelectorAll('[data-q]').forEach(b => b.onclick = () => b.dataset.q === '__brief' ? briefing() : ask(b.dataset.q));
    micBtn.onclick = () => listenOnce();
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle() } if (e.key === 'Escape' && panel.classList.contains('open')) toggle(false) });
    if (!SR) { micBtn.disabled = true; micBtn.title = 'Rozpoznávání řeči tento prohlížeč nepodporuje' }
    status();
    say(`${new Date().getHours() < 10 ? 'Dobré ráno' : new Date().getHours() < 18 ? 'Dobrý den' : 'Dobrý večer'}${owner() ? ', ' + owner() : ''}. Jsem ${cfg.name}. Zeptejte se na rozpočet, faktury, portfolio nebo domácnost, nebo klikněte na Hlášení.`, false);
  }
  function toggle(open) { const o = open ?? !panel.classList.contains('open'); panel.classList.toggle('open', o); orb.classList.toggle('hid', o); if (o) setTimeout(() => input.focus(), 300); else { window.speechSynthesis?.cancel(); setState('') } }
  function bubble(cls, text) { const d = document.createElement('div'); d.className = 'as-m ' + cls; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d }
  function trace(text) { const d = document.createElement('div'); d.className = 'as-t'; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight }
  function say(text, voice = true) { bubble('a', text); if (voice) speak(text) }

  /* ===================== hlas ===================== */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, wakeRec = null, armedUntil = 0;
  function voices() { try { return speechSynthesis.getVoices() } catch (e) { return [] } }
  function speak(text) {
    if (!cfg.voice || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#`›•]/g, '').replace(/\s+/g, ' ').slice(0, 900));
      u.lang = 'cs-CZ'; const v = voices().find(v => v.name === cfg.voiceName) || voices().find(v => /^cs/i.test(v.lang)); if (v) u.voice = v;
      u.rate = 1.05; u.onstart = () => setState('speaking'); u.onend = u.onerror = () => setState('');
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  function listenOnce() {
    if (!SR) return; if (rec) { rec.stop(); return }
    window.speechSynthesis?.cancel();
    rec = new SR(); rec.lang = 'cs-CZ'; rec.interimResults = true;
    rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(''); input.value = t; if (e.results[e.results.length - 1].isFinal) { input.value = ''; ask(t) } };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') say('Mikrofon není povolený. V publikované webové verzi ho prohlížeč nepovolí; použijte verzi z počítače.', false) };
    rec.onend = () => { rec = null; micBtn.classList.remove('on'); setState('') };
    try { rec.start(); micBtn.classList.add('on'); setState('listening') } catch (e) { rec = null }
  }
  /* Poslouchání na oslovení: "<jméno>, rozsviť v kuchyni" */
  function wakeLoop(on) {
    if (!SR) return;
    if (!on) { if (wakeRec) { wakeRec.onend = null; wakeRec.stop(); wakeRec = null } return }
    if (wakeRec) return;
    wakeRec = new SR(); wakeRec.lang = 'cs-CZ'; wakeRec.continuous = true; wakeRec.interimResults = false;
    wakeRec.onresult = e => {
      const t = e.results[e.results.length - 1][0].transcript.trim(), n = nt(t), nm = nt(cfg.name).replace(/[^a-z0-9]/g, '');
      const pat = '(' + nm + (nm[0] === 'j' ? '|dz' + nm.slice(1) : '') + ')[a-z]*';   // „Jarvis“ i „Džarvisi“
      const at = n.search(new RegExp('(^|\\s)(hej\\s+)?' + pat));
      if (at >= 0) { const cmd = t.slice(at).replace(/^\s*(hej\s+)?\S+[,!.\s]*/i, '').trim(); toggle(true); if (cmd.length > 2) ask(cmd); else { armedUntil = Date.now() + 8000; say('Ano?') } }
      else if (Date.now() < armedUntil) { armedUntil = 0; ask(t) }
    };
    wakeRec.onerror = e => { if (e.error === 'not-allowed') { cfg.wake = false; saveCfg(); wakeRec = null } };
    wakeRec.onend = () => { const r = wakeRec; wakeRec = null; if (cfg.wake && r) setTimeout(() => wakeLoop(true), 400) };
    try { wakeRec.start() } catch (e) { wakeRec = null }
  }

  /* ===================== mozek ===================== */
  function rules() {
    const n = new Date();
    return `Jsi ${cfg.name}, osobní asistent aplikace Domácí centrála${owner() ? ' pro uživatele jménem ' + owner() : ''}. Je ${n.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${n.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.
Mluvíš česky, věcně, zdvořile a s lehkým suchým humorem. Odpovídej krátce (1–4 věty), protože odpověď se může číst nahlas; seznamy jen když o ně uživatel žádá.
Data o rozpočtu, fakturách, investicích a domácnosti zjišťuj VÝHRADNĚ nástroji; nic si nevymýšlej. Když nástroj vrátí ukazkova_data: true, zmiň, že jde o ukázková data. Částky piš v Kč s mezerami mezi tisíci.
Akce provádíš nástroji (ovládání domácnosti, koncept faktury, otevření modulu). Faktury jen jako koncept – nikdy netvrď, že byla vystavena nebo odeslána.
Daně a investice: uváděj jen orientačně, nejde o daňové ani investiční poradenství.`;
  }
  function toolDefs() { return App.tools() }

  async function ask(text) {
    if (busy) { ctl?.abort(); }
    bubble('u', text); toggle(true);
    busy = true; setState('thinking'); ctl = new AbortController(); const my = ctl;
    const b = brain(); let answer = '';
    try {
      if (b === 'claude') answer = await viaSample(text, my);
      else if (b === 'api') answer = await viaApi(text, my);
      else answer = await offline(text);
    } catch (e) {
      if (e?.code === 'cancelled' || e?.name === 'AbortError') { if (my === ctl) { busy = false; setState('') } return }
      if (b === 'claude' && ['not_granted', 'sampling_disabled', 'tools_unavailable', 'not_declared', 'capability_disabled'].includes(e?.code)) { sampleFn = null; status() }
      trace(b === 'offline' ? 'chyba' : `Claude není dostupný (${e?.code || e?.message || 'chyba'}), odpovídám offline`);
      try { answer = await offline(text) } catch (e2) { answer = 'Tohle se nepovedlo: ' + (e2.message || e2) }
    }
    if (my !== ctl) return;
    busy = false; setState('');
    hist.push({ role: 'user', content: text }, { role: 'assistant', content: answer }); while (hist.length > 12) hist.shift();
    if (answer && !answered) say(answer); answered = false;
  }
  let answered = false;   // u streamování už bublina existuje

  /* --- Claude přes účet claude.ai (publikovaná verze, schopnost sample) --- */
  async function viaSample(text, my) {
    const tools = toolDefs().map(t => ({ name: t.name, description: t.description, ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
      execute: async inp => { trace(toolLabel(t)); return await t.run(inp || {}) } }));
    let el = null;
    const res = await sampleFn([{ role: 'user', content: rules() }, ...hist, { role: 'user', content: text }], {
      tools, signal: my.signal, cache: false, modelTier: cfg.depth === 'deep' ? 'default' : 'quick',
      onText: ({ text }) => { if (my !== ctl) return; if (!el) el = bubble('a', ''); el.textContent = text; msgs.scrollTop = msgs.scrollHeight }
    });
    if (el) { answered = true; speak(res.text) }
    return res.text;
  }
  /* --- Claude přes vlastní API klíč (lokální verze) --- */
  async function viaApi(text, my) {
    const tools = toolDefs();
    const messages = [...hist.map(h => ({ role: h.role, content: h.content })), { role: 'user', content: text }];
    for (let round = 0; round < 6; round++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: my.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1024, system: rules(), messages, tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status);
      messages.push({ role: 'assistant', content: j.content });
      const uses = (j.content || []).filter(c => c.type === 'tool_use');
      if (!uses.length) return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || '…';
      const results = [];
      for (const u of uses) {
        const t = tools.find(x => x.name === u.name); let out;
        try { trace(toolLabel(t || { name: u.name })); out = t ? await t.run(u.input || {}) : 'Error: neznámý nástroj' } catch (e) { out = 'Error: ' + e.message }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 24000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return 'Na tohle jsem potřeboval příliš mnoho kroků. Zkuste otázku zúžit.';
  }
  const LABELS = { budget_summary: 'čtu rozpočet', budget_transactions: 'hledám v pohybech', portfolio_summary: 'počítám portfolio', investment_tax: 'počítám daň z investic', invoices_list: 'procházím faktury', invoices_stats: 'počítám fakturaci', invoice_draft: 'zakládám koncept faktury', home_status: 'zjišťuji stav domácnosti', home_control: 'ovládám zařízení', home_scene: 'spouštím scénu', home_thermostat: 'nastavuji termostat', open_module: 'otevírám modul', house_status: 'kontroluji harmonogram domu', house_tasks: 'procházím úkoly stavby', house_task_done: 'odškrtávám úkol', house_budget: 'počítám financování domu', house_study: 'listuji studií domu', mortgage_status: 'kontroluji hypotéku', mortgage_simulate: 'počítám hypotéku', payments_due: 'kontroluji pravidelné platby', system_info: 'kontroluji systém' };
  const toolLabel = t => LABELS[t.name] || ('nástroj ' + t.name);

  /* ===================== offline režim ===================== */
  const T = name => toolDefs().find(t => t.name === name);
  async function run(name, inp = {}) { const t = T(name); if (!t) throw new Error('Modul s tímto nástrojem je vypnutý.'); trace(toolLabel(t)); return await t.run(inp) }
  const MONTH_STEMS = [['led', 1], ['unor', 2], ['brez', 3], ['dub', 4], ['kvet', 5], ['cervenc', 7], ['cerv', 6], ['srp', 8], ['zari', 9], ['rij', 10], ['listop', 11], ['pros', 12]];
  function period(n) {
    const d = new Date(), ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    if (/minul\w* mesic/.test(n)) { const x = new Date(d.getFullYear(), d.getMonth() - 1, 1); return ym(x.getFullYear(), x.getMonth() + 1) }
    if (/(tento|tenhle|letos\w*|aktualn\w*) mesic|tento mesic|za mesic/.test(n)) return ym(d.getFullYear(), d.getMonth() + 1);
    const yr = (n.match(/\b(20\d\d)\b/) || [])[1];
    for (const [s, m] of MONTH_STEMS) if (new RegExp('\\b' + s).test(n)) return ym(yr || (m > d.getMonth() + 1 ? d.getFullYear() - 1 : d.getFullYear()), m);
    if (/letos/.test(n)) return String(d.getFullYear());
    if (yr) return yr;
    return '';
  }
  async function offline(text) {
    const n = nt(text);
    if (/hlaseni|prehled dne|jak (jsem|to) na tom|shrnuti|briefing|dobre rano/.test(n)) return await brief(false);
    if (/kolik je hodin|^cas\b|kolikat|jaky je den/.test(n)) { const i = await run('system_info'); return `Je ${i.den} ${fmt.date(i.datum)}, ${i.cas}.` }
    if (/^(otevri|prejdi|ukaz mi modul|zobraz modul|prepni)/.test(n)) {
      const map = [['rozpoc', 'rozpocet'], ['investic', 'investice'], ['portfol', 'investice'], ['faktur', 'faktury'], ['domacnost', 'domacnost'], ['prehled', 'prehled'], ['system', 'system'], ['nastaven', 'asistent'], ['asistent', 'asistent']];
      const hit = map.find(([k]) => n.includes(k)); if (hit) { await run('open_module', { modul: hit[1] }); return 'Otevírám.' }
    }
    if (/(kdo mi dluzi|dluzi mi|nezaplatil)/.test(n)) return offline('neuhrazené faktury');
    // domácnost
    if (/scen|rezim/.test(n) || /^(dobrou noc|odchazim|jdu spat)/.test(n)) {
      const k = /noc|spat/.test(n) ? 'noc' : /odchod|odchaz/.test(n) ? 'odchod' : /vecer/.test(n) ? 'vecer' : /rano/.test(n) ? 'rano' : '';
      if (k) { const r = await run('home_scene', { scena: k }); return `Scéna ${r.scena} spuštěna.` }
    }
    if (/(rozsvit|zhasni|zapni|vypni|ztlum)/.test(n)) {
      const on = /rozsvit|zapni/.test(n); const rooms = ['obyvak', 'kuchyn', 'loznic', 'garaz'];
      const room = rooms.find(r => n.includes(r)) || ''; const dev = (n.match(/(lamp\w*|strop|kavovar|tv|televiz\w*|nocni)/) || [])[1] || '';
      const jas = +(n.match(/(\d{1,3})\s*%/) || [])[1] || undefined;
      const r = await run('home_control', { mistnost: room, zarizeni: dev.replace(/televiz\w*/, 'tv').replace(/lamp\w*/, 'lamp').replace('nocni', 'nocni'), zapnout: /ztlum/.test(n) ? true : on, jas: /ztlum/.test(n) ? (jas || 25) : jas });
      return `${on || /ztlum/.test(n) ? 'Zapnuto' : 'Vypnuto'}: ${r.zmeneno.join(', ')}.`;
    }
    if (/(zatahn|vytahn|zaluzi)/.test(n)) { const r = await run('home_control', { zarizeni: 'zaluzie', zatazeni: /vytahn|otevr/.test(n) ? 0 : 100 }); return `Hotovo: ${r.zmeneno.join(', ')}.` }
    if (/vrata/.test(n) && /(otevr|zavr)/.test(n)) { const o = /otevr/.test(n); await run('home_control', { zarizeni: 'vrata', otevrit: o }); return o ? 'Otevírám vrata.' : 'Zavírám vrata.' }
    if (/(teplot|termostat|topen|stupn)/.test(n)) {
      const num = (n.match(/(\d{2}(?:[.,]5)?)/) || [])[1];
      if (num && /(nastav|dej|zvys|sniz|na \d)/.test(n)) { const r = await run('home_thermostat', { teplota: parseFloat(num.replace(',', '.')) }); return `Termostat nastaven na ${String(r.cil).replace('.', ',')} °C.` }
      const s = await run('home_status'); return `Doma je ${String(s.teplota).replace('.', ',')} °C, termostat je nastavený na ${String(s.cil).replace('.', ',')} °C.`;
    }
    if (/(domacnost|co sviti|sviti|prikon|spotreb)/.test(n)) { const s = await run('home_status'); const on = s.zarizeni.filter(z => z.typ === 'light' && z.zapnuto); return `Svítí ${on.length ? on.map(z => z.mistnost + ' – ' + z.nazev).join(', ') : 'nic'}. Příkon ${s.prikon_w} W, teplota ${String(s.teplota).replace('.', ',')} °C.` }
    // stavba domu
    if (/(stavb|harmonogram|cislo popisn|kolaudac|\bdum\b|domu|palis|zaklad|povoleni)/.test(n) && !/domacnost/.test(n)) {
      if (/(financ|penez|rozpocet stavby|kolik stoji|chybi)/.test(n)) { const b = await run('house_budget'); return `Zdroje ${fmt.czk(b.celkem_zdroje)}, náklady ${fmt.czk(b.celkem_naklady)}, ${b.rozdil >= 0 ? 'zbývá' : 'chybí'} ${fmt.czk(Math.abs(b.rozdil))}.` }
      const h = await run('house_status'); const nx = h.bezi[0] || h.nejblizsi[0];
      return `Do termínu čísla popisného zbývá ${h.dni_do_terminu} dní. Podle plánu bude číslo popisné ${fmt.date(h.planovane_cp)}, ${h.rezerva_dni >= 0 ? 'rezerva ' + h.rezerva_dni + ' dní' : 'zpoždění ' + (-h.rezerva_dni) + ' dní'}. Hotovo ${h.hotovo_procent} %.` + (h.po_terminu.length ? ` Po termínu: ${h.po_terminu.map(t => t.ukol).join(', ')}.` : '') + (nx ? ` Teď: ${nx.ukol}.` : '');
    }
    // faktury
    if (/faktur/.test(n)) {
      if (/(koncept|vystav|nov\w* faktur|udelej faktur)/.test(n)) return 'Koncept faktury umím založit v online režimu. Offline ji vytvořte v modulu Faktury.';
      if (/(po splatnosti|nezaplacen|neuhrazen|ceka|dluzi)/.test(n)) {
        const r = await run('invoices_list', { stav: /po splatnosti/.test(n) ? 'po_splatnosti' : 'neuhrazene' });
        if (!r.pocet) return 'Žádné neuhrazené faktury. Všichni zaplatili.';
        return `${r.pocet} ${r.pocet === 1 ? 'faktura čeká' : r.pocet < 5 ? 'faktury čekají' : 'faktur čeká'} na úhradu, celkem ${fmt.czk(r.celkem)}: ` + r.faktury.map(f => `${f.cislo} (${f.odberatel}, ${fmt.czk(f.castka)}, ${f.stav})`).join('; ') + '.' + (r.ukazkova_data ? ' Jde o ukázková data.' : '');
      }
      const s = await run('invoices_stats', { rok: period(n).slice(0, 4) || undefined });
      return `V roce ${s.rok} jste vyfakturoval ${fmt.czk(s.fakturovano)}, zaplaceno ${fmt.czk(s.zaplaceno)}, čeká ${fmt.czk(s.ceka_na_uhradu)}. Limit DPH je vyčerpaný na ${String(s.vycerpano_procent).replace('.', ',')} %.` + (s.ukazkova_data ? ' Jde o ukázková data.' : '');
    }
    // investice
    if (/(dan\w* z (prodej|investic|akci)|kolik zaplatim na dani)/.test(n)) { const t = await run('investment_tax', {}); return `Letos z prodejů ${fmt.czk(t.prijmy_z_prodeju)}${t.pod_limitem_100k ? ', pod limitem 100 000 Kč, takže bez daně' : `, orientační daň ${fmt.czk(t.odhad_dane)}`}. Dividendy ${fmt.czk(t.dividendy)}. Jen orientačně.` }
    if (/(portfol|investic|akci|etf|casov\w* test|xtb)/.test(n)) {
      const p = await run('portfolio_summary'); const nx = p.nejblizsi_casovy_test[0];
      return `Portfolio má hodnotu ${fmt.czk(p.hodnota)}, ${p.zisk >= 0 ? 'zisk' : 'ztráta'} ${fmt.czk(Math.abs(p.zisk))} (${String(p.vynos_procent).replace('.', ',')} %).` + (nx ? ` Další lot projde časovým testem ${fmt.date(nx.osvobozeno_od)}: ${nx.ticker}, ${String(nx.kusu).replace('.', ',')} ks.` : '') + (p.ukazkova_data ? ' Jde o ukázková data.' : '');
    }
    // rozpočet
    if (/(utratil|utratila|utrata|vydaj|prijm|rozpocet|bilanc|kolik jsem|za co|kolik stoj|nejvic)/.test(n)) {
      const per = period(n); let cat = '';
      const m = n.match(/(?:za|na)\s+([a-z]{4,})/); if (m && !/^(mesic|tento|minul|leto|tenhle)/.test(m[1])) cat = m[1].slice(0, 5);
      const s = await run('budget_summary', per ? { period: per } : {});
      if (cat) { const k = s.vydaje_podle_kategorii.find(x => nt(x.kategorie).includes(cat)); if (k) return `Za ${k.kategorie.toLowerCase()} v období ${s.obdobi} ${fmt.czk(k.castka)}.`; const t = await run('budget_transactions', { query: cat, period: s.obdobi }); if (t.pocet) return `${t.pocet} pohybů obsahujících „${cat}“ v období ${s.obdobi}, součet ${fmt.czk(t.soucet)}.` }
      const top = s.vydaje_podle_kategorii.slice(0, 3).map(k => `${k.kategorie} ${fmt.czk(k.castka)}`).join(', ');
      return `${s.obdobi}: příjmy ${fmt.czk(s.prijmy)}, výdaje ${fmt.czk(s.vydaje)}, bilance ${s.bilance >= 0 ? '+' : ''}${fmt.czk(s.bilance)}. Nejvíc: ${top}.` + (s.ukazkova_data ? ' Jde o ukázková data.' : '') + (per && per !== s.obdobi ? '' : '');
    }
    if (/^(ahoj|cau|dobry den|nazdar|hej)/.test(n)) return `Zdravím${owner() ? ', ' + owner() : ''}. Co pro vás můžu udělat?`;
    if (/(dekuji|diky)/.test(n)) return 'Rádo se stalo.';
    return `V offline režimu rozumím povelům jako: „hlášení“, „kolik jsem utratil v říjnu“, „neuhrazené faktury“, „jak je na tom portfolio“, „rozsviť v kuchyni“, „nastav teplotu na 22“, „spusť scénu noc“. Na volné otázky mě připojte ke Claudovi v nastavení modulu Asistent.`;
  }

  /* ===================== hlášení ===================== */
  async function brief(alsoBubble = true) {
    const h = new Date().getHours(), parts = [];
    parts.push(`${h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer'}${owner() ? ', ' + owner() : ''}. Je ${new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}.`);
    const tryRun = async (n, i) => { try { return T(n) ? await run(n, i) : null } catch (e) { return null } };
    const d = new Date(), cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const b = await tryRun('budget_summary', {});
    if (b) parts.push(`Rozpočet${b.obdobi === cur ? ' tento měsíc' : ' za ' + b.obdobi}: výdaje ${fmt.czk(b.vydaje)}, příjmy ${fmt.czk(b.prijmy)}${b.vydaje_podle_kategorii[0] ? `, nejvíc na ${b.vydaje_podle_kategorii[0].kategorie.toLowerCase()}` : ''}.`);
    const f = await tryRun('invoices_list', { stav: 'neuhrazene' });
    if (f) { const late = f.faktury.filter(x => x.stav === 'po splatnosti'); parts.push(f.pocet ? `Na úhradu čeká ${f.pocet} ${f.pocet === 1 ? 'faktura' : f.pocet < 5 ? 'faktury' : 'faktur'} za ${fmt.czk(f.celkem)}${late.length ? `, z toho ${late.length} po splatnosti` : ''}.` : 'Všechny faktury jsou zaplacené.') }
    const p = await tryRun('portfolio_summary');
    if (p) { const nx = p.nejblizsi_casovy_test[0]; parts.push(`Portfolio ${fmt.czk(p.hodnota)}, ${p.zisk >= 0 ? 'v zisku' : 've ztrátě'} ${String(Math.abs(p.vynos_procent)).replace('.', ',')} %.${nx ? ` Nejbližší časový test: ${nx.ticker} ${fmt.date(nx.osvobozeno_od)}.` : ''}`) }
    const hs = await tryRun('house_status');
    if (hs) { const nx = hs.bezi[0] || hs.nejblizsi[0]; parts.push(`Stavba: do termínu čísla popisného ${hs.dni_do_terminu} dní, ${hs.rezerva_dni >= 0 ? 'plán drží s rezervou ' + hs.rezerva_dni + ' dní' : 'plán nestíhá o ' + (-hs.rezerva_dni) + ' dní'}${hs.po_terminu.length ? ', ' + hs.po_terminu.length + ' úkolů po termínu' : ''}.${nx ? ' Na řadě: ' + nx.ukol + '.' : ''}`) }
    const s = await tryRun('home_status');
    if (s) { const on = s.zarizeni.filter(z => z.typ === 'light' && z.zapnuto).length; parts.push(`Doma ${String(s.teplota).replace('.', ',')} °C, ${on ? 'svítí ' + on + (on === 1 ? ' světlo' : on < 5 ? ' světla' : ' světel') : 'nic nesvítí'}.`) }
    if ([b, f, p].some(x => x?.ukazkova_data)) parts.push('Část údajů jsou zatím ukázková data.');
    const text = parts.join(' ');
    if (alsoBubble) say(text);
    return text;
  }
  async function briefing() { toggle(true); bubble('u', 'Hlášení'); setState('thinking'); const t = await brief(false); setState(''); say(t) }

  /* ===================== registrace modulu ===================== */
  App.register({
    id: 'asistent',
    name: 'Asistent',
    description: 'Hlasový a textový asistent nad celou centrálou. Otevřete ho kdekoli tlačítkem vpravo dole nebo Ctrl+K.',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="4 3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
    order: 5,

    init() {
      buildUI();
      (async () => { try { if (window.claude?.use) sampleFn = await window.claude.use('sample') } catch (e) { sampleFn = null } status() })();
      if (cfg.wake) setTimeout(() => wakeLoop(true), 1500);
      if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { };
    },

    widget(el) {
      el.innerHTML = `<div class="wnums"><div><span>Jméno</span><b>${esc(cfg.name)}</b></div><div><span>Režim</span><b style="font-size:13px;white-space:normal">${esc(brainLabel())}</b></div></div>
        <div class="acts"><button class="btn primary sm" id="wBrief">Hlášení</button><button class="btn sm" id="wOpen">Otevřít (Ctrl+K)</button></div>`;
      el.querySelector('#wBrief').onclick = () => briefing();
      el.querySelector('#wOpen').onclick = () => toggle(true);
    },

    mount(root, ctx) {
      const tools = App.tools();
      const vs = voices().filter(v => /^cs/i.test(v.lang));
      root.innerHTML = `<div class="mw">
        <div class="grid2">
          <section class="panel as-big"><button class="orb2" id="aOrb" aria-label="Mluvit s asistentem"></button>
            <div style="text-align:center;margin-top:18px"><h2 style="font-size:22px;letter-spacing:.2em">${esc(cfg.name)}</h2><p class="muted" style="margin:6px 0 12px">${esc(brainLabel())}</p>
            <div class="acts" style="justify-content:center"><button class="btn primary" id="aBrief">Hlášení</button><button class="btn" id="aTalk"${SR ? '' : ' disabled'}>Mluvit</button><button class="btn" id="aOpen">Psát</button></div></div></section>
          <section class="panel"><div class="phead"><h2>Nastavení</h2><span class="muted">ukládá se samo</span></div>
            <div class="fgrid">
              <label class="field">Jméno asistenta<input type="text" id="aName" value="${esc(cfg.name)}" maxlength="24"></label>
              <label class="field">Mozek<select id="aBrain">${[['auto', 'Automaticky'], ['claude', 'Claude přes účet claude.ai'], ['api', 'Claude přes API klíč'], ['offline', 'Jen offline povely']].map(([k, l]) => `<option value="${k}"${cfg.brain === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field">Rychlost × hloubka<select id="aDepth"><option value="quick"${cfg.depth === 'quick' ? ' selected' : ''}>Rychlé odpovědi</option><option value="deep"${cfg.depth === 'deep' ? ' selected' : ''}>Důkladnější (pomalejší)</option></select></label>
              <label class="field" style="grid-column:1/-1">API klíč Anthropic (jen pro verzi z počítače)<input type="password" id="aKey" value="${esc(cfg.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
              <label class="field">Model pro API<input type="text" id="aModel" value="${esc(cfg.model)}"></label>
              <label class="field">Hlas${vs.length ? `<select id="aVoiceName"><option value="">výchozí český</option>${vs.map(v => `<option${v.name === cfg.voiceName ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<span class="muted" style="font-weight:400">český hlas v prohlížeči nenalezen</span>'}</label>
            </div>
            <div class="modlist" style="margin-top:12px">
              <label><input type="checkbox" class="switch" id="aVoice"${cfg.voice ? ' checked' : ''}><span><b>Číst odpovědi nahlas</b><br><span class="d">Hlasem prohlížeče (nejlépe v Edge nebo Chrome s českým hlasem).</span></span></label>
              <label><input type="checkbox" class="switch" id="aWake"${cfg.wake ? ' checked' : ''}${SR ? '' : ' disabled'}><span><b>Poslouchat na oslovení</b><br><span class="d">Řekněte „${esc(cfg.name)}, …“ a povel. Mikrofon zůstává zapnutý, jen ve verzi z počítače.</span></span></label>
            </div>
            <p class="muted" style="font-size:12px">API klíč zůstává jen v tomto prohlížeči a posílá se přímo do Anthropic. Volání API se platí podle vašeho účtu na console.anthropic.com. V publikované verzi na claude.ai se klíč nepoužívá: asistent tam jede přes váš účet claude.ai a při prvním dotazu se zeptá na povolení.</p>
          </section></div>
        <section class="panel"><div class="phead"><h2>Co umí</h2><span class="muted num">${tools.length} nástrojů z ${new Set(tools.map(t => t.module)).size} modulů</span></div>
          <div class="as-tools">${tools.map(t => `<div><b>${esc(t.name)}</b>${esc(t.description)}</div>`).join('')}</div>
          <p class="muted" style="font-size:12px;margin-bottom:0">Nové moduly přidají asistentovi schopnosti vlastností <span class="code">tools</span> (viz README). Asistent je pak umí použít bez další úpravy.</p></section></div>`;
      const $ = s => root.querySelector(s);
      $('#aOrb').onclick = () => { toggle(true); listenOnce() };
      $('#aTalk').onclick = () => { toggle(true); listenOnce() };
      $('#aOpen').onclick = () => toggle(true);
      $('#aBrief').onclick = () => briefing();
      const set = (k, v, redraw) => { cfg[k] = v; saveCfg(); status(); panel.querySelector('#asName').textContent = cfg.name; if (redraw) App.go('asistent') };
      $('#aName').onchange = e => { set('name', e.target.value.trim() || CFG0.name); ctx.toast('Jméno uloženo.') };
      $('#aBrain').onchange = e => set('brain', e.target.value);
      $('#aDepth').onchange = e => set('depth', e.target.value);
      $('#aKey').onchange = e => { set('apiKey', e.target.value.trim()); ctx.toast(cfg.apiKey ? 'Klíč uložen v tomto prohlížeči.' : 'Klíč smazán.') };
      $('#aModel').onchange = e => set('model', e.target.value.trim() || CFG0.model);
      const vn = $('#aVoiceName'); if (vn) vn.onchange = e => { set('voiceName', e.target.value); speak('Takhle teď zním.') };
      $('#aVoice').onchange = e => set('voice', e.target.checked);
      $('#aWake').onchange = e => { set('wake', e.target.checked); wakeLoop(e.target.checked); ctx.toast(e.target.checked ? `Poslouchám na „${cfg.name}“.` : 'Poslouchání vypnuto.') };
    }
  });
})();
