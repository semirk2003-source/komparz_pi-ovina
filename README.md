# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

<<<<<<< Updated upstream
If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
=======
Potrebujete [Node.js](https://nodejs.org) verzie LTS. V priečinku projektu spustite:

```bash
npm install
npm run dev
```

Otvorte adresu, ktorú vypíše (napr. `http://localhost:5173`). Na prihlasovacej obrazovke kliknite
na jeden z testovacích účtov:

| Účet | Rola | Čo smie |
| --- | --- | --- |
| `admin@demo.sk` | Správca | všetko vrátane importu a nastavení |
| `caster@demo.sk` | Castingový pracovník | čítať, upravovať, tvoriť výbery, exportovať |
| `viewer@demo.sk` | Prizeraný | len čítať — bez kontaktov, bez exportu, bez úprav |

Užitočné:

- **Obnoviť demo dáta** — tlačidlo v žltom páse hore alebo v Nastavenia → Systém.
- **Test rýchlosti s 5 000 profilmi:** vytvorte súbor `.env.local` s riadkom `VITE_DEMO_PEOPLE=5000`,
  reštartujte `npm run dev` a obnovte demo dáta.
- Zmeny v jednej karte prehliadača sa prejavia aj v druhej — tak sa dá skúšať spolupráca na výbere.

Ďalšie príkazy: `npm run build` (produkčné zostavenie), `npm run lint` (kontrola kódu),
`npm test` (testy).

---

## 2. Štruktúra projektu

```
src/
  constants/polia.js      názvy tabuliek, stĺpcov a povolené hodnoty — jediné miesto, žiadne preklepy
  api/                    všetok prístup k dátam (každá funkcia funguje v demo aj Supabase režime)
    backend.js            prepínač demo / Supabase
    local/                demo databáza v prehliadači a generátor dát
    people.js, selections.js, archive.js, admin.js, import.js, photos.js, auth.js
  auth/                   prihlásenie a roly
  features/
    people/               Ľudia, Obľúbení, detail profilu
    selections/           aktuálny výber, uložené výbery, tabuľka výberu
    exports/              PDF, PPTX, XLSX, CSV, kontakty
    archive/              archív účinkovania, leaderboard, správa názvov
    admin/                import registračnej vlny, nastavenia
  lib/                    formátovanie, čistenie importovaných hodnôt, párovanie mien
supabase/
  migrations/             SQL schéma — spúšťa sa v poradí čísel
  functions/invite-user/  serverová funkcia na pozývanie používateľov
scripts/upload-photos.mjs hromadné nahratie fotografií pri migrácii
docs/ARCHITEKTURA.md      architektúra a pravidlá
```

---

## 3. Založenie Supabase (keď príde čas)

Postup je pre človeka bez programátorských skúseností. Každý krok hovorí, čo máte vidieť.

### 3.1 Projekt

1. Na [supabase.com](https://supabase.com) → **Start your project** → prihlásenie cez GitHub.
2. **New project**, názov napr. `komparz-stupak`.
3. **Heslo k databáze** si uložte do správcu hesiel — znova sa neukáže.
4. **Región: Frankfurt (eu-central-1) alebo Zurich.** Údaje zostanú v EÚ (GDPR) a odozva je rýchla.
5. **Create new project**, počkajte asi 2 minúty. Uvidíte nástenku s ponukou Table Editor, SQL Editor…

> Pred nahratím fotografií prepnite projekt na platený plán (približne 25 USD mesačne).
> Bezplatný 1 GB na fotky nestačí a import by sa zastavil v polovici.

### 3.2 Databáza — spustite SQL súbory v poradí

V ľavej ponuke **SQL Editor → New query**. Postupne otvorte súbory z priečinka
`supabase/migrations/` **v poradí čísel** (`001_…`, `010_…`, `020_…`, `030_…`, `040_…`, prípadne ďalšie),
skopírujte celý obsah, vložte a kliknite **Run**. Každý musí skončiť hláškou *Success*.
Ak Supabase zobrazí upozornenie *Potential issue detected* (súbory obsahujú príkazy `drop … if exists`
a `revoke`), potvrďte **Run this query** — je to v poriadku, súbory sa dajú spustiť aj opakovane.

Tým vzniknú všetky tabuľky, prístupové pravidlá (Row Level Security), neverejné úložisko
`person-photos` a migračné nástroje.

> Súbor `040_migration.sql` založí schému **`staging`** — počas migrácie v nej budú surové osobné
> údaje z Excelu. **Nepridávajte ju** do *Project Settings → API → Exposed schemas* (predvolene tam je
> len `public`). Po migrácii ju zmažte (časť 4.5).

### 3.3 Prihlasovanie — vypnite verejnú registráciu

**Authentication → Sign In / Providers** (alebo *Settings*):

- vypnite **Allow new users to sign up** — účty vytvára len správca pozvánkou. Ak by zostalo zapnuté,
  ktokoľvek by si mohol založiť účet (zostal by síce neaktívny, ale zbytočne by pribúdali cudzie účty),
- pri e-maile nechajte zapnuté **Confirm email**.

**Authentication → URL Configuration:**

- **Site URL:** adresa aplikácie (lokálne `http://localhost:5173`, neskôr adresa z Vercelu),
- **Redirect URLs:** pridajte `http://localhost:5173/nastavit-heslo` a `https://VASA-ADRESA/nastavit-heslo`
  (sem vedie odkaz z pozvánky a z obnovy hesla — bez tejto adresy v zozname Supabase odkaz odmietne
  a nový kolega si heslo nenastaví).

### 3.4 Prvý správca

1. **Authentication → Users → Add user → Create new user**, zadajte svoj e-mail a heslo,
   zaškrtnite *Auto Confirm User*.
2. Nový účet je z bezpečnostných dôvodov **neaktívny**. Aktivujte ho v **SQL Editore**:

   ```sql
   update public.app_users
      set role = 'admin', is_active = true, full_name = 'Vaše Meno'
    where email = 'vas@email.sk';
   ```

3. Vytvorte aj **testovací účet s rolou prizeraný** (rovnako, len `role = 'viewer'`). Bez neho
   neoveríte, že kontakty sú naozaj skryté — vy ako správca vidíte všetko.

> Účty zakladajte až **po** spustení SQL súborov z časti 3.2. Ak ste účet vytvorili skôr, príkaz
> `update` vyššie nič nezmení („UPDATE 0") — najprv doplňte chýbajúce riadky a potom ho zopakujte:
>
> ```sql
> insert into public.app_users (id, email, full_name)
> select id, email, split_part(email, '@', 1) from auth.users
> on conflict (id) do nothing;
> ```

Ďalších používateľov už pozývate priamo v aplikácii: **Nastavenia → Používatelia → Pozvať**.

### 3.5 Funkcia na pozývanie používateľov

Pozvánka potrebuje tajný kľúč, ktorý nesmie byť v prehliadači, preto beží ako serverová funkcia.
Raz ju nasaďte (potrebujete [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
npx supabase login
npx supabase link --project-ref VAS_PROJECT_REF      # nájdete v Project Settings → General
npx supabase functions deploy invite-user
```

Kľúče `SUPABASE_URL`, `SUPABASE_ANON_KEY` a `SUPABASE_SERVICE_ROLE_KEY` dostane funkcia od Supabase
automaticky — nič nevkladáte. Nastavte len adresy aplikácie, na ktoré smie viesť odkaz v pozvánke
(oddelené čiarkou; bez tohto nastavenia vedie odkaz na *Site URL*):

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://VASA-ADRESA.vercel.app,http://localhost:5173
```

### 3.6 Prepojenie aplikácie

**Project Settings → API**: skopírujte **Project URL** a kľúč **anon / publishable**.
V priečinku projektu vytvorte súbor `.env.local` (vzor je v `.env.example`):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Reštartujte `npm run dev`. Žltý pás „Demo režim" zmizne a aplikácia pracuje so Supabase.
Súbor `.env.local` sa na GitHub nedostane (je v `.gitignore`).

> **Kľúč `service_role` NIKDY nedávajte do `.env.local`, do kódu ani na GitHub.** Obchádza všetky
> prístupové pravidlá. Používa sa len pri jednorazovom nahrávaní fotiek z vášho počítača (kapitola 4).

### 3.7 Overenie bezpečnosti

- Otvorte aplikáciu v **anonymnom okne** — bez prihlásenia sa nesmie načítať nič.
- Prihláste sa **testovacím viewer účtom** — pri profiloch nesmie byť telefón, e-mail ani adresa
  a nesmú byť dostupné exporty ani úpravy.

---

## 4. Migrácia dát z Excelu a Google Drive

Podrobne v kapitole 5 špecifikácie. Päť pravidiel: nikdy nepracujte s originálom, prevod musí byť
opakovateľný, najprv nalejte a potom čistite, chybné riadky sa nezahadzujú, fotky až po ľuďoch.

### 4.1 Profily

1. **Kópia Excelu.** Vyčistite ju podľa kapitoly 5.2 (prázdne a testovacie riadky, jedna hlavička,
   poznámky zo zátvoriek v mene…).
2. **Premenujte stĺpce** na názvy z tabuľky `staging.people_raw` (bez diakritiky a medzier):
   `legacy_id, meno_priezvisko` (alebo `meno` + `priezvisko`), `pohlavie, datum_narodenia, vek, telefon,
   email, adresa, mesto, kraj, vyska, konfekcia, topanky, vlasy, oci, tetovanie, tetovanie_popis, jazyky,
   vodicak, zrucnosti, dobovy_vzhlad, textujuci, poznamky, registracia, odpovedal, suhlas, foto_odkaz`.
   Stĺpec `legacy_id` (pôvodné číslo) je povinný — je to kotva pre opakovaný prevod.
   **Stĺpce navyše** pridajte do tabuľky `staging.people_raw` (Table Editor → Insert column, typ *text*) —
   uložia sa k registračnej vlne ako doplnkové odpovede, nič sa nestratí. Doplnkové odpovede vidí len
   casting a správca; stĺpce pripomínajúce kontakt alebo citlivý údaj (telefón, e-mail, adresa, IBAN,
   rodné číslo) sa do nich napriek tomu nepreberú — zostanú len v dočasnej tabuľke, ktorá sa po migrácii maže.
3. **Uložte ako CSV UTF-8.** Inak sa rozsype diakritika („Ďuriš" bude nečitateľné).
4. **Table Editor → schéma `staging` → `people_raw` → Insert → Import data from CSV.**
5. **SQL Editor:**

   ```sql
   select * from public.migrate_people_from_staging('Pôvodný Excel');
   ```

   Vypíše počet vytvorených, aktualizovaných, preskočených a chybných riadkov. Spustiť sa dá opakovane —
   profily sa aktualizujú, nevznikajú kópie. **Opakujte ju len pred prepnutím naostro.** Profil, ktorý už
   niekto upravil v aplikácii, migrácia neprepíše — preskočí ho a zapíše do `staging.migration_check_errors`
   („upravený v aplikácii"), aby sa nestratila práca tímu.

   Súhlas so spracovaním: dátum sa prevezme; hodnota „áno" sa uloží ako dátum migrácie (s upozornením),
   „nie" ako nevyplnený súhlas. Prázdne áno/nie stĺpce (dobový vzhľad, textujúci…) sa uložia ako „nie",
   nezrozumiteľná hodnota („neviem") tiež ako „nie" — a s upozornením na kontrolu.

6. **Kontrola — zastavte sa tu, kým nie je v poriadku:**

   ```sql
   select * from staging.migration_check_counts;              -- sedí počet profilov s počtom riadkov?
   select * from staging.migration_check_missing_birth_date;  -- chýba dátum len menšine?
   select * from staging.migration_check_errors;              -- ktoré riadky neprešli a prečo
   select * from staging.migration_check_suspicious_names;    -- jednoslovné a príliš dlhé mená
   select * from staging.migration_check_same_name_birth;     -- možné duplicity
   ```

   Ak je chybných riadkov viac než pár, opravte zdrojové dáta a prevod zopakujte.

Pravidlá čistenia (pohlavie, „42-43" → 42, „178 cm" → 178, kraj → región, telefóny, dátumy, vek →
približný dátum) sú rovnaké ako pri importe v aplikácii — `src/lib/normalize.js`.

### 4.2 Fotografie

Zistite, ktorý prípad platí (kapitola 5.4): **A** odkazy na Drive v Exceli, **B** obrázky vložené
v XLSX, **C** priečinok s fotkami. Potom spustite skript — najprv vždy na skúšku `--dry-run`:

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=...tajny-kluc... \
npm run photos:upload -- --mode=c --dir=./fotky --dry-run
```

Na **Windowse** (PowerShell) nastavte premenné najprv, každú na samostatnom riadku:

```powershell
$env:SUPABASE_URL="https://xxxxxxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="...tajny-kluc..."
npm run photos:upload -- --mode=c --dir=./fotky --dry-run
```

Skript spúšťajte v priečinku projektu po `npm install`. Až keď report zo skúšky (`--dry-run`) vyzerá
správne, spustite ten istý príkaz bez `--dry-run`. Opakované spustenie je bezpečné — už nahraté fotky
sa preskočia.

> **Fotky z iPhonu vo formáte HEIC** skript neprečíta (v reporte budú ako chyba). Najprv ich prevedte
> na JPEG — napr. na Macu v aplikácii Fotky *Exportovať* alebo v Náhľade *Exportovať → JPEG*;
> na iPhone *Nastavenia → Fotoaparát → Formáty → Najkompatibilnejšie* pre ďalšie fotky.

- **A:** `--mode=a --csv=ludia.csv` (stĺpce `legacy_id` a `foto_odkaz`). Priečinok na Drive dočasne
  nastavte na „ktokoľvek s odkazom môže zobraziť" a **po skončení ho vráťte na súkromný**.
- **B:** obrázky z `xl/media` (premenujte kópiu `.xlsx` na `.zip` a rozbaľte). Najprv
  `--mode=b --dir=xl/media --draft-from=ludia.csv` pripraví návrh mapovania podľa poradia —
  **poradie nie je zaručené**, preto ho skontrolujte a opravte, potom `--mode=b --dir=xl/media --map=scripts/output/navrh-mapovania.csv`.
- **C:** súbory pomenované „číslo + oddeľovač + meno", napr. `1234_Novak.jpg`, `1234 - Ján Novák.jpg`,
  alebo priečinok `1234 - Ján Novák/` (len ten, v ktorom fotka priamo leží — čísla vyšších priečinkov ako
  `fotky/2019/` sa ignorujú). Meno v názve sa porovná s menom profilu; pri nezhode sa fotka nenahrá.
  Názvy začínajúce rokom alebo dátumom (`2023-05-01 Ján Novák.jpg`), bez čísla, alebo s nesediacim menom
  skončia v reporte na ručné priradenie. Súbory pomenované len číslom (`1234.jpg`) sa spárujú až s voľbou
  `--allow-bare-id` — použite ju, len ak ste si istí, že číslo je pôvodné číslo z Excelu.

Skript fotky zmenší na 1600 px, vytvorí náhľad 400 px, odstráni skryté údaje (aj GPS), prečíta dátum
nafotenia, dodrží limit 5 fotiek na profil a uloží report do `scripts/output/`. Na konci vypíše
**20 profilov naprieč abecedou — skontrolujte pohľadom, že je to naozaj tá správna tvár.**

### 4.3 Archív účinkovania

CSV so stĺpcami `datum, meno, postava, projekt, seria` nahrajte do `staging.appearances_raw` a spustite:

```sql
select * from public.migrate_appearances_from_staging();
```

Výsledok ukáže, koľko záznamov vzniklo, koľko sa preskočilo ako už nahraté, koľko neprešlo a ako dopadlo
prepojenie: koľko je potvrdených, navrhnutých, nepriradených a koľko zostalo nepriradených, lebo by
vznikla duplicita s už existujúcim záznamom tej istej osoby.

Pôvodné meno zo súpisky sa uloží nezmenené. Prepojenie na profily robí `match_unmatched_appearances()`
podľa kapitoly 5.5:

- **presná zhoda mena s práve jedným profilom → potvrdené automaticky,**
- podobné mená → len **navrhnuté**, potvrdzuje ich človek v aplikácii (Archív → filter Navrhnuté),
- menovci v databáze (napr. dve Diany Vranové) → nikdy sa nespoja automaticky, zostanú na rozhodnutie.

**Automatické potvrdenie presnej zhody je vedomé rozhodnutie s rizikom:** ak na pľaci hral človek, ktorý
v databáze nie je, ale má rovnaké meno ako jediný profil v nej (menovec mimo databázy), záznam sa
pripíše nesprávnemu človeku a objaví sa v jeho filmografii aj leaderboarde. Ak toto riziko nechcete
podstúpiť, spustite migráciu archívu takto — aj presné zhody budú len navrhnuté a potvrdí ich človek:

```sql
select * from public.migrate_appearances_from_staging(false);
```

Rozhodnite sa **pred prvým spustením**: záznamy, ktoré už boli raz potvrdené, ďalšie spustenie nezmení.

### 4.4 Kontrolný zoznam pred prepnutím na ostro (kapitola 5.6)

Excel prestaňte používať až keď platí všetkých osem bodov:

- [ ] počet profilov sedí s počtom riadkov Excelu
- [ ] 20 náhodných profilov naprieč abecedou sedí s Excelom údaj po údaji
- [ ] 20 profilov má **správnu tvár** (nie len nejakú fotku)
- [ ] archív má správny počet záznamov
- [ ] nikto nie je v databáze dvakrát omylom (`migration_check_same_name_birth`)
- [ ] bez prihlásenia sa nenačíta nič (anonymné okno)
- [ ] testovací viewer nevidí kontakty
- [ ] záloha existuje a skúšobná obnova prebehla (kapitola 6)

Potom Excel premenujte na „archív – needitovať" a odoberte práva na úpravu.

### 4.5 Po migrácii: zmažte dočasné dáta

Schéma `staging` drží surové kópie osobných údajov z Excelu (vrátane kontaktov a stĺpcov, ktoré sa do
profilov nepreniesli). Keď je migrácia hotová a prejde **celý kontrolný zoznam 4.4**, zmažte ju
v SQL Editore:

```sql
drop function if exists public.migrate_people_from_staging(text);
drop function if exists public.migrate_appearances_from_staging(boolean);
drop schema if exists staging cascade;
```

Ak chcete migračné nástroje ešte ponechať (napr. na ďalšiu dávku archívu), vyprázdnite aspoň dočasné tabuľky:

```sql
truncate staging.people_raw, staging.appearances_raw, staging.migration_errors, staging.migration_runs;
```

Ak by ste neskôr potrebovali migráciu zopakovať, stačí znova spustiť `040_migration.sql`.

### 4.6 Ďalšie registračné vlny

Nové vlny sa už nahrávajú priamo v aplikácii: **Import** (len správca) — nahrať súbor, skontrolovať
priradenie stĺpcov, náhľad nových / zhodných / chybných riadkov, rozhodnúť o duplicitách, až potom
vykonať. Na konci sa dá stiahnuť protokol vrátane dôvodov, prečo riadky neprešli.

- Hromadne sa dá aktualizovať len **jednoznačná zhoda** (pôvodné číslo, alebo meno + dátum narodenia).
- Zhoda len podľa telefónu či e-mailu (často člen rodiny) alebo s viacerými profilmi je predvolene
  **preskočená**; aktualizovať ju možno len ručne pri riadku po porovnaní údajov. Meno a dátum narodenia
  sa pri takejto zhode nikdy neprepíšu.
- Prázdne bunky existujúce údaje nemenia.

---

## 5. Zverejnenie na internete (Vercel)

1. Kód odošlite na GitHub do repozitára **na vašom účte**.
2. [vercel.com](https://vercel.com) → prihlásenie cez GitHub → **Add New → Project** → vyberte repozitár.
3. Framework sa rozpozná sám (Vite). V časti **Environment Variables** pridajte
   `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY` — bez nich aplikácia na internete zobrazí len hlášku
   „Aplikácia nie je nastavená" (demo režim sa na internete sám nezapne, aby doň nikto nezadával
   skutočné údaje).
4. **Deploy.** O minútu dostanete adresu `nieco.vercel.app`.
5. Túto adresu doplňte v Supabase do **Site URL** a **Redirect URLs** (časť 3.3).

Súbor `vercel.json` zabezpečuje, že priame odkazy (napr. `/vybery/12`) fungujú aj po obnovení stránky.

**Demo verzia na internete (napr. na ukážku pred založením Supabase):** vo Verceli nastavte namiesto
Supabase údajov premennú `VITE_DEMO_MODE=true`. Aplikácia potom beží s vymyslenými dátami, každý návštevník
má vlastné dáta len vo svojom prehliadači a hore svieti žltý pás „Demo režim". Do demo verzie nezadávajte
skutočné údaje. Produkčný build **bez** Supabase údajov a **bez** `VITE_DEMO_MODE=true` sa do demo režimu
sám neprepne — zobrazí len hlášku „Aplikácia nie je nastavená".

---

## 6. Zálohy a skúška obnovy

### 6.1 Automatické zálohy (hlavná cesta)

Na **platenom pláne** Supabase robí denné zálohy sám: **Database → Backups**. Tam vidíte zoznam záloh
a tlačidlo na obnovu. Za príplatok je aj obnova k ľubovoľnému okamihu (Point in Time Recovery).
Bezplatný plán automatické zálohy nemá — tam je jediná záloha tá vlastná (6.2).

### 6.2 Vlastná záloha cez `pg_dump`

Hodí sa raz mesačne a pred každým väčším zásahom (import, migrácia). Nepotrebuje Docker.

1. Nainštalujte klientske nástroje PostgreSQL vo verzii **rovnakej alebo novšej**, než má projekt
   (verziu vidíte v *Project Settings → Infrastructure*). Mac: `brew install postgresql@17`,
   Windows: inštalátor z postgresql.org (stačia „Command Line Tools").
2. **Project Settings → Database → Connection string → URI**, režim *Session pooler*. Skopírujte ho
   a namiesto `[YOUR-PASSWORD]` doplňte heslo k databáze z kroku 3.1.
3. V príkazovom riadku (adresu dajte do úvodzoviek):

   ```bash
   export DB_URL="postgresql://postgres.xxxxxxxx:HESLO@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

   # Účty používateľov (prihlásenie) — bez nich by sa údaje aplikácie neobnovili.
   pg_dump "$DB_URL" --data-only --table=auth.users --table=auth.identities --file=zaloha-auth.sql

   # Všetky údaje aplikácie (profily, archív, výbery, záznam zmien…).
   pg_dump "$DB_URL" --data-only --schema=public --file=zaloha-data.sql
   ```

   Štruktúru databázy zálohovať netreba — je v `supabase/migrations/` v repozitári.
   Súbory obsahujú osobné údaje: ukladajte ich šifrovane a nikdy nie do repozitára.

### 6.3 Skúška obnovy — raz na začiatku, potom raz ročne

Záloha, ktorú ste nikdy neobnovili, nie je záloha. Skúšku robte do **nového, testovacieho projektu**,
nie do ostrého.

1. Založte nový Supabase projekt (časť 3.1) a spustite v ňom všetky `supabase/migrations/*.sql` (časť 3.2).
2. Skopírujte jeho connection string (ako v 6.2) do `TEST_DB_URL` a nahrajte zálohu — **najprv účty,
   potom údaje**; `session_replication_role = replica` vypne počas nahrávania triggery, aby sa záznamy
   nezdvojili:

   ```bash
   export TEST_DB_URL="postgresql://postgres.yyyyyyyy:HESLO@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
   psql "$TEST_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
        -c "SET session_replication_role = replica" -f zaloha-auth.sql
   psql "$TEST_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
        -c "SET session_replication_role = replica" -f zaloha-data.sql
   ```

3. Kontrola v SQL Editore testovacieho projektu — čísla musia sedieť s ostrým projektom:

   ```sql
   select (select count(*) from public.people)      as profily,
          (select count(*) from public.appearances) as archiv,
          (select count(*) from public.selections)  as vybery,
          (select count(*) from public.app_users)   as pouzivatelia;
   ```

4. Prepojte lokálnu aplikáciu na testovací projekt (`.env.local`), prihláste sa svojím účtom a pozrite
   pár profilov a jeden výber. Potom testovací projekt zmažte.

Fotografie v úložisku nie sú súčasťou databázovej zálohy. Pôvodný priečinok fotiek z migrácie si ponechajte;
fotky pridané neskôr v aplikácii sa dajú stiahnuť cez Supabase CLI (`npx supabase storage cp -r ss:///person-photos ./zaloha-fotky --experimental`).

---

## 7. Bezpečnosť — pravidlá, ktoré sa neobchádzajú

- Bez prihlásenia sa nenačíta nič; nový účet je neaktívny, kým ho neaktivuje správca.
- Prizeraný nedostane telefón, e-mail ani adresu **ani z databázy** (nielen skryté v aplikácii).
- Upravovať smú len správca a castingový pracovník; výber zmaže len jeho autor alebo správca.
- Nič sa nemaže natvrdo: profily sa deaktivujú alebo anonymizujú, archív sa vyraďuje, odobratie
  prístupu používateľa nemaže jeho výbery. Zmeny profilov, archívu a výberov sa zapisujú do záznamu zmien.
- Fotky sú v neverejnom úložisku a zobrazujú sa len cez dočasné odkazy.
- Kľúč `service_role` je len v premennej prostredia pri migračnom skripte a v Edge Function.
  Nikdy v `.env.local`, v kóde ani na GitHube.
- CSV a XLSX s osobnými údajmi nepatria do repozitára (`*.csv` a `scripts/output/` sú v `.gitignore`).

---

## 8. Keď sa niečo pokazí

| Čo vidíte | Čo s tým |
| --- | --- |
| „command not found" | Program nie je nainštalovaný alebo treba reštartovať počítač. |
| Aplikácia sa načíta, ale je prázdna | Nie ste prihlásený, účet nie je aktívny, alebo chýbajú údaje v `.env.local`. |
| Fotky sa nezobrazujú | Skontrolujte, že úložisko sa volá `person-photos` a že prebehol `001_schema.sql`. |
| Import CSV skončil chybou | Najčastejšie kódovanie — uložte znova ako *CSV UTF-8*. |
| Migrácia hlási pri všetkých riadkoch „Chýba pôvodné číslo" | Stĺpec `legacy_id` sa pri importe nepriradil (preklep v hlavičke alebo skrytý znak na začiatku súboru). Skontrolujte v Table Editore, či je stĺpec `legacy_id` v `staging.people_raw` vyplnený; ak nie, vyprázdnite tabuľku (`truncate staging.people_raw;`), v Exceli prepíšte názov prvého stĺpca ručne a importujte znova. |
| Rozsypaná diakritika | Súbor nebol v UTF-8. Uložte znova a nahrajte opakovane (prevod je opakovateľný). |
| Na internete nefunguje, lokálne áno | Chýbajú premenné prostredia vo Verceli (časť 5). |
| Pozvánka nepríde | Je nasadená funkcia `invite-user` (časť 3.5)? Je adresa v Redirect URLs? |
>>>>>>> Stashed changes
