# Komparz Stupák — architektúra a pravidlá tímu

Zdrojom požiadaviek je dokument *Komparz-Stupak-specifikacia* (kapitoly 1–4: use casy UC-01 až UC-16,
dátový model, prístupové pravidlá, obrazovky, požiadavky na rýchlosť). Šprinty a prompty z dokumentu
sú len návod pre laika — staviame celú aplikáciu podľa toho, ČO má vedieť.

## Technológie (pevné)

- React 19 + Vite, **JavaScript (.js / .jsx), žiadny TypeScript, žiadne typy**
- Tailwind CSS v4 (štýly priamo v komponentoch, cez prvky zo `src/components/ui.jsx`)
- Supabase (databáza, prihlásenie, úložisko) — **zatiaľ neexistuje**, viď nižšie
- TanStack Query (serverový stav), React Context (klientský stav), @tanstack/react-virtual
- SheetJS (`xlsx`) a PptxGenJS na exporty, PDF cez tlač prehliadača
- Celé UI je v slovenčine

## Dva režimy dát: demo a Supabase

Supabase projekt sa založí neskôr. Aplikácia preto beží v dvoch režimoch:

- **Demo režim** (`IS_DEMO` v `src/api/backend.js`) — keď chýba `.env.local`. Dáta sú vygenerované
  (`src/api/local/seed.js`) a uložené v `localStorage`. Lokálna vrstva **napodobňuje pravidlá databázy**:
  viewer nedostane kontakty, zapisovať smie len admin/caster (`requireStaff()`), správca `requireAdmin()`,
  audit sa zapisuje cez `audit()`. Zmeny sa šíria do ostatných kariet (`commit()` + `subscribe()`).
- **Supabase režim** — po doplnení `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY`. Schéma je v
  `supabase/migrations/*.sql`, spúšťa sa v poradí čísel.

**Pravidlo:** UI nikdy nevolá `supabase` ani `getDb()` priamo. Všetok prístup k dátam ide cez funkcie v
`src/api/<oblasť>.js`, ktoré vo vnútri rozvetvia `if (IS_DEMO) … else …`. Každá funkcia musí fungovať v
oboch režimoch a v oboch rovnako vynucovať oprávnenia.

## Bezpečnosť (nevyjednávateľné)

- Bez prihlásenia sa nenačíta nič. Neaktívny účet nevidí nič.
- Rola **viewer** nedostane `phone`, `email`, `address` **ani z databázy** (pohľady `people_list`,
  `people_detail` ich neobsahujú; tabuľka `people` je čitateľná len pre staff). Nestačí ich skryť v UI.
- Viewer nesmie exportovať ani upravovať.
- Nič sa nemaže natvrdo: profily `is_active=false` / `anonymized_at`, archív `is_excluded`.
- `raw_name` v archíve a `original_*` hodnoty sa nikdy neprepisujú (vynúti aj trigger).
- Systém prepojenie archívu s profilom len **navrhne** (`suggested`); potvrdiť (`confirmed`) musí človek.
  Do filmografie a leaderboardu idú len `confirmed` a nevyradené záznamy.
- Kľúč `service_role` nikdy nesmie byť v kóde aplikácie (len v migračnom skripte cez premennú prostredia).

## Rýchlosť (merateľné, kapitola 4.6)

- Zoznam profilov (`listPeople()` / `usePeopleList()`) sa načíta raz a filtruje v prehliadači; filter < 100 ms.
- Zoznam dlaždíc je virtualizovaný. Test: `VITE_DEMO_PEOPLE=5000 npm run dev`.
- Fotky: náhľad 400 px v zozname, 1600 px v detaile, dočasné podpísané odkazy (`usePhotoUrl`).

## Zdieľané súbory (zmluvy) — vlastní ich vedúci tímu

| Súbor | Čo poskytuje |
| --- | --- |
| `src/constants/polia.js` | Názvy tabuliek, stĺpcov, povolené hodnoty. Žiadne reťazce s názvami polí v kóde. |
| `src/api/backend.js` | `IS_DEMO`, `supabase`, `unwrap`, `fetchAllPages`, `AppError` |
| `src/api/local/db.js` | demo DB: `getDb`, `commit`, `subscribe`, `nextId`, `requireUser/Staff/Admin`, `audit` |
| `src/api/auth.js`, `src/auth/*` | prihlásenie; `useAuth()`, `usePermissions()` → `{ canEdit, canExport, canSeeContacts, isAdmin }` |
| `src/api/people.js` → `listPeople()` | odľahčený zoznam bez kontaktov (ďalšie funkcie dopĺňa tím Ľudia) |
| `src/api/photos.js`, `src/hooks/usePhotoUrl.js`, `src/components/PersonPhoto.jsx` | fotky |
| `src/hooks/usePeopleList.js` | `{ people, byId, isLoading, error }`, query key `PEOPLE_LIST_KEY` |
| `src/hooks/useOpenProfile.js` | `useOpenProfile()(id)` otvorí detail profilu odkiaľkoľvek (`?osoba=ID`) |
| `src/state/CurrentSelection*` | `useCurrentSelection()` — pracovný košík (viď komentár v súbore) |
| `src/components/ui.jsx`, `toast/*` | UI prvky, `useToast()` |
| `src/lib/format.js` | vek, mená, dátumy, `normalizeText`, `nameWithId` |

Zdieľané súbory sa menia len malými doplňujúcimi úpravami (Edit), nikdy prepisom celého súboru.
Ak potrebujete zmenu správania zdieľaného súboru, napíšte to vo svojej záverečnej správe.

## Vlastníctvo oblastí

| Tím | Zložky | API | SQL |
| --- | --- | --- | --- |
| Ľudia | `src/features/people/` | `src/api/people.js` (okrem `listPeople`), `src/api/favorites.js` | `010_*.sql` |
| Výbery a exporty | `src/features/selections/`, `src/features/exports/` | `src/api/selections.js` | `020_*.sql` |
| Archív | `src/features/archive/`, `src/lib/nameMatch.js` | `src/api/archive.js` | `030_*.sql` |
| Správa a migrácia | `src/features/admin/`, `scripts/`, `supabase/functions/`, `README.md`, `src/lib/normalize.js` | `src/api/admin.js`, `src/api/import.js` | `040_*.sql` |
| Kvalita a bezpečnosť | testy `**/*.test.js`, revízie | — | `090_*.sql` (opravy) |

## Zmluvy medzi tímami

- **Ľudia → ostatní:** `getPeopleContacts(personIds)` v `src/api/people.js` →
  `Map<personId, { phone, email, address, birth_date }>`; pre viewera vyhodí `AppError('forbidden')`.
- **Ľudia → ostatní:** `<ProfileDetail personId />` (`src/features/people/ProfileDetail.jsx`) — vykresľuje ho Layout.
- **Archív → Ľudia:** `<Filmography personId />` (`src/features/archive/Filmography.jsx`).
- **Archív → Výbery:** `getAppearanceStats(personIds)` v `src/api/archive.js` →
  `Map<personId, { shootDays, records, lastDate, productions: string[] }>` (len confirmed, nevyradené).
- **Výbery → všetci:** `<SelectionBar />` (pás pri spodnom okraji, vykresľuje ho Layout) a
  `<AddToSelectionButton personId />` v `src/features/selections/AddToSelectionButton.jsx`.
- **Ľudia → Archív/Leaderboard:** `<PeopleGrid people={[...]} />` v `src/features/people/PeopleGrid.jsx`
  (virtualizovaná mriežka dlaždíc, použiteľná aj na iných obrazovkách).

## Obrazovky a cesty

`/` Ľudia · `/oblubeni` · `/vybery` · `/vybery/:selectionId` (tabuľka výberu + exporty) · `/archiv` ·
`/leaderboard` · `/nazvy` (správa názvov postáv/projektov/sérií, staff) · `/import` (admin) ·
`/nastavenia` (admin). Detail profilu: `?osoba=ID` nad ktoroukoľvek obrazovkou.

## Definícia „hotovo"

`npm run build` a `npx eslint src` bez chýb; funguje v demo režime pre všetky tri roly; Supabase vetva je
napísaná podľa schémy; žiadne `.ts` súbory; texty v slovenčine; dizajn jednoduchý a konzistentný
(redizajn príde neskôr — preto len prvky z `ui.jsx` a Tailwind).
