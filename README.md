# Domácí centrála

Osobní systém složený z modulů: rodinný rozpočet, investice, faktury pro OSVČ a chytrá domácnost. Další moduly přidáte bez zásahu do jádra.

## Spuštění

Otevřete `index.html` dvojklikem v prohlížeči (Chrome, Edge nebo Firefox). Nepotřebujete server ani instalaci.
Internet je potřeba jen pro písma, import Excelu a generování QR kódů.

Data se ukládají do prohlížeče (localStorage). **Mezi počítači je synchronizujte** v sekci *Systém → Synchronizace mezi počítači*:
na prvním PC vytvořte soubor `centrala-data.json` ve složce Google Disku (nebo OneDrive, Dropboxu), na druhém PC ho připojte.
Změny se pak ukládají a načítají samy (Chrome nebo Edge, verze spuštěná z počítače). Zálohu do souboru najdete tamtéž.

## Webová verze (GitHub Pages + Google Disk)

Stejná aplikace běží i z webové adresy, takže funguje na PC, Macu, iPadu i iPhonu a data se synchronizují přes váš Google Disk.

1. **GitHub:** nový veřejný repozitář `domaci-centrala`, nahrajte do něj obsah této složky. *Settings → Pages → Deploy from a branch → main / (root)*. Adresa: `https://UZIVATEL.github.io/domaci-centrala/`.
2. **Google Cloud Console:** nový projekt → povolit *Google Drive API* → *OAuth consent screen* (External, Testing, svůj Gmail jako testovací uživatel) → *Clients → Create client → Web application*:
   - Authorized JavaScript origins: `https://UZIVATEL.github.io`
   - Authorized redirect URIs: `https://UZIVATEL.github.io/domaci-centrala/`
3. ID klienta vložte do `config.js` (`googleClientId`).
4. Na každém zařízení: otevřít adresu → *Systém → Synchronizace → Přihlásit přes Google*. Na iPhonu/iPadu: Safari → Sdílet → Přidat na plochu.

Data leží ve skryté složce aplikace na vašem Google Disku (`centrala-data.json`), ne v repozitáři. V kódu nejsou žádné osobní údaje; ty se vyplňují v aplikaci.
Pokud se tatáž data změní na dvou zařízeních zároveň, aplikace je sloučí po položkách a zeptá se jen při skutečném střetu.

## Struktura

```
index.html            kostra stránky + seznam modulů (<script src="modules/...">)
core/core.css         vzhled: barvy (:root), písmo, sdílené komponenty
core/core.js          jádro: navigace, přehled, úložiště, události, záloha
modules/rozpocet.js   Rodinný rozpočet (výpisy, kategorie příjmů a výdajů)
modules/dum.js        Rodinný dům Vejprnice (harmonogram, termín č. p., financování z prodeje bytu)
modules/investice.js  Investice (FIFO, časový test 3 roky, limit 100 000 Kč, dividendy)
modules/faktury.js    Faktury OSVČ (QR platba, úhrady, limit DPH, párování s výpisy, import z PDF/XLS/CSV/ISDOC)
modules/domacnost.js  Chytrá domácnost (zatím simulace, připraveno na Home Assistant)
modules/asistent.js   Asistent – hlas i text, Claude s nástroji modulů, offline povely, hlášení
modules/_sablona.js   šablona pro nový modul
```

## Nový modul ve 3 krocích

1. Zkopírujte `modules/_sablona.js`, například jako `modules/auto.js`.
2. Změňte `id`, `name`, `icon` a obsah funkcí `mount` (celá obrazovka modulu) a `widget` (dlaždice na přehledu).
3. Do `index.html` přidejte řádek `<script src="modules/auto.js"></script>`.

## Asistent

Otevře se kdekoli kulatým tlačítkem vpravo dole nebo **Ctrl+K**.

- **Mozek:** v publikované verzi na claude.ai jede přes váš účet Claude (při prvním dotazu se zeptá na povolení). Ve verzi z počítače zadejte v modulu Asistent API klíč Anthropic. Bez obojího funguje offline s pevnými povely.
- **Hlas:** rozpoznávání řeči a poslouchání na oslovení fungují ve verzi z počítače v Chrome nebo Edge. Čtení odpovědí nahlas funguje všude, kde má prohlížeč český hlas.

### Jak modul naučí asistenta něco nového

Přidejte do registrace modulu vlastnost `tools`, funkci vracející seznam nástrojů:

```js
tools(ctx) {
  return [{
    name: 'notes_list',                       // a-z, 0-9, _ ; unikátní
    description: 'Vrátí poslední poznámky.',  // asistent podle popisu pozná, kdy nástroj použít
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    run: input => ctx.store.get('notes', []).slice(0, input.limit || 10)   // vrací malá data
  }];
}
```

Asistent nástroj sám použije, bez další úpravy. Pro změnu dat vyšlete po zápisu událost (např. `ctx.bus.emit('notes:changed')`), aby se otevřená obrazovka překreslila.

## API jádra (výběr)

| Funkce | K čemu |
|---|---|
| `App.register({...})` | přihlásí modul |
| `ctx.store.get(k, výchozí)` / `ctx.store.set(k, v)` | trvalé úložiště modulu (`hs:<id>:<k>`) |
| `ctx.bus.on(událost, fn)` / `ctx.bus.emit(událost, data)` | komunikace mezi moduly |
| `ctx.toast(text, [tlačítko, akce])` | krátké oznámení dole |
| `App.css(id, text)` | vloží CSS modulu |
| `App.tools()` | všechny nástroje asistenta z jádra a modulů |
| `App.countUp(el)` | animace čísel `<b data-count="1234" data-fmt="czk">` |
| `App.fmt.czk / czk2 / date / pct / num` | formátování |

### Události

| Událost | Kdo vysílá | Data |
|---|---|---|
| `rozpocet:import` | Rozpočet po importu výpisu | `{ src, tx[] }`, kde tx má `date, amount, party, desc, vs …` |
| `store:change` | jádro při každém uložení | `{ ns, k }` |

Modul Faktury poslouchá `rozpocet:import` a sám označí faktury jako zaplacené, když najde platbu se stejnou částkou a variabilním symbolem.

## Nápady na rozšíření

- Investice: import exportu z XTB a online ceny přes API brokera.
- Faktury: odesílání e-mailem a export pro daňové přiznání.
- Domácnost: napojení na Home Assistant ve funkci `haCall()`.
- Nové moduly: auto (STK, servis, tankování), dokumenty a záruky, energie a měřáky.
