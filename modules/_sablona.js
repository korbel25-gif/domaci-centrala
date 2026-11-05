/* =====================================================================
   ŠABLONA NOVÉHO MODULU
   ---------------------------------------------------------------------
   1) Zkopírujte tento soubor, např. jako modules/poznamky.js
   2) Změňte id (malá písmena bez diakritiky), název, ikonu a obsah
   3) V index.html přidejte řádek <script src="modules/poznamky.js"></script>
   Modul se pak sám objeví v menu, na Přehledu i v Systém → Moduly.
   ===================================================================== */
(function () {
  const { esc, fmt } = App;

  // Vlastní CSS modulu (nepovinné). Barvy berte z proměnných: var(--accent), var(--inc), var(--exp)…
  App.css('poznamky', `
    .pz-list{display:flex;flex-direction:column;gap:8px}
    .pz-list div{padding:10px 12px;border:1px solid var(--line);border-radius:var(--r);display:flex;justify-content:space-between;gap:10px}
  `);

  App.register({
    id: 'poznamky',                     // unikátní, použije se v adrese (#poznamky) i jako jméno úložiště
    name: 'Poznámky',                   // název v záhlaví a na přehledu
    short: 'Poznámky',                  // krátký název do menu (nepovinné)
    description: 'Ukázkový modul – jednoduché poznámky.',
    icon: App.icons.note,               // SVG ikona; vlastní vložte jako text '<svg viewBox="0 0 24 24">…</svg>'
    order: 50,                          // pořadí v menu (menší = výš)

    /* init – zavolá se jednou po načtení stránky. Hodí se pro poslech událostí jiných modulů. */
    init(ctx) {
      // ctx.bus.on('rozpocet:import', e => console.log('Nové pohyby z banky', e.tx.length));
    },

    /* widget – malá dlaždice na Přehledu (nepovinné) */
    widget(el, ctx) {
      const notes = ctx.store.get('notes', []);
      el.innerHTML = `<div class="wnums"><div><span>Poznámek</span><b>${notes.length}</b></div></div>`;
    },

    /* mount – vykreslí celý modul do elementu root.
       Může vrátit funkci, která se zavolá při odchodu z modulu (úklid časovačů apod.). */
    mount(root, ctx) {
      const { store, toast } = ctx;      // store.get(klíč, výchozí) / store.set(klíč, hodnota)
      let notes = store.get('notes', []);

      function draw() {
        root.innerHTML = `<div class="mw">
          <section class="panel"><div class="phead"><h2>Nová poznámka</h2></div>
            <form id="pzForm" class="acts"><input type="text" id="pzText" style="flex:1" placeholder="Text poznámky"><button class="btn primary">Přidat</button></form>
          </section>
          <section class="panel"><div class="pz-list">${notes.map((n, i) => `<div><span>${esc(n.text)} <span class="muted">· ${fmt.date(n.date)}</span></span><button class="btn sm danger" data-i="${i}">Smazat</button></div>`).join('') || '<span class="muted">Zatím nic.</span>'}</div></section>
        </div>`;
        root.querySelector('#pzForm').onsubmit = e => {
          e.preventDefault(); const t = root.querySelector('#pzText').value.trim(); if (!t) return;
          notes.unshift({ text: t, date: App.today() }); store.set('notes', notes); draw(); toast('Poznámka uložena.');
        };
        root.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { notes.splice(+b.dataset.i, 1); store.set('notes', notes); draw() });
      }
      draw();
      // return () => { /* úklid */ };
    }
  });
})();
