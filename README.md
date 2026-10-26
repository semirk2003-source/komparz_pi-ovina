# Komparz Stupák — castingová databáza

Webová aplikácia castingového oddelenia: databáza približne 5 000 komparzistov s fotografiami,
vyhľadávanie a filtre, pracovné výbery zdieľané v tíme, exporty pre réžiu a produkciu (PDF, PPTX,
XLSX, CSV), archív účinkovania s filmografiou a leaderboardom, import registračných vĺn
a správa používateľov s tromi rolami.

Postavené podľa dokumentu *Komparz Stupák — castingová databáza, špecifikácia v1.0*.
Architektúra a pravidlá tímu sú v [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

- **Technológie:** React + Vite, **JavaScript (nie TypeScript)**, Tailwind CSS, Supabase
  (databáza, prihlásenie, úložisko fotiek), TanStack Query, SheetJS, PptxGenJS.
- **Jazyk rozhrania:** slovenčina.

---

## 1. Rýchly štart — demo režim (bez databázy)

Supabase projekt zatiaľ nemusí existovať. Bez prístupových údajov beží aplikácia v **demo režime**:
dáta (800 vymyslených profilov, archív, výbery) sa vygenerujú a uložia len vo vašom prehliadači.

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
automaticky — nič nevkladáte.

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
   uložia sa k registračnej vlne ako doplnkové odpovede, nič sa nestratí. Doplnkové odpovede vidí aj rola
   prizeraný, preto sa stĺpce pripomínajúce kontakt alebo citlivý údaj (telefón, e-mail, adresa, IBAN, rodné číslo)
   do nich nepreberú — zostanú len v dočasnej tabuľke.
3. **Uložte ako CSV UTF-8.** Inak sa rozsype diakritika („Ďuriš" bude nečitateľné).
4. **Table Editor → schéma `staging` → `people_raw` → Insert → Import data from CSV.**
5. **SQL Editor:**

   ```sql
   select * from public.migrate_people_from_staging('Pôvodný Excel');
   ```

   Vypíše počet vytvorených, aktualizovaných a chybných riadkov. Spustiť sa dá opakovane — profily
   sa aktualizujú, nevznikajú kópie.

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

- **A:** `--mode=a --csv=ludia.csv` (stĺpce `legacy_id` a `foto_odkaz`). Priečinok na Drive dočasne
  nastavte na „ktokoľvek s odkazom môže zobraziť" a **po skončení ho vráťte na súkromný**.
- **B:** obrázky z `xl/media` (premenujte kópiu `.xlsx` na `.zip` a rozbaľte). Najprv
  `--mode=b --dir=xl/media --draft-from=ludia.csv` pripraví návrh mapovania podľa poradia —
  **poradie nie je zaručené**, preto ho skontrolujte a opravte, potom `--mode=b --dir=xl/media --map=scripts/output/navrh-mapovania.csv`.
- **C:** súbory alebo podpriečinky pomenované číslom, napr. `1234_Novak.jpg` alebo `1234 - Ján Novák/`.
  Súbory bez čísla sa automaticky nepárujú — skončia v reporte na ručné priradenie.

Skript fotky zmenší na 1600 px, vytvorí náhľad 400 px, odstráni skryté údaje (aj GPS), prečíta dátum
nafotenia, dodrží limit 5 fotiek na profil a uloží report do `scripts/output/`. Na konci vypíše
**20 profilov naprieč abecedou — skontrolujte pohľadom, že je to naozaj tá správna tvár.**

### 4.3 Archív účinkovania

CSV so stĺpcami `datum, meno, postava, projekt, seria` nahrajte do `staging.appearances_raw` a spustite:

```sql
select * from public.migrate_appearances_from_staging();
```

Pôvodné meno zo súpisky sa uloží nezmenené. Prepojenie na profily robí `match_unmatched_appearances()`
podľa kapitoly 5.5:

- **presná zhoda mena s práve jedným profilom → potvrdené automaticky,**
- podobné mená → len **navrhnuté**, potvrdzuje ich človek v aplikácii (Archív → filter Navrhnuté),
- menovci v databáze (napr. dve Diany Vranové) → nikdy sa nespoja automaticky, zostanú na rozhodnutie.

**Automatické potvrdenie presnej zhody je vedomé rozhodnutie s rizikom:** ak na pľaci hral človek, ktorý
v databáze nie je, ale má rovnaké meno ako jediný profil v nej (menovec mimo databázy), záznam sa
pripíše nesprávnemu človeku a objaví sa v jeho filmografii aj leaderboarde. Ak toto riziko nechcete
podstúpiť, spustite prepojenie tak, aby aj presné zhody boli len navrhnuté:

```sql
select public.match_unmatched_appearances(p_auto_confirm_exact => false);
```

(Parameter `p_auto_confirm_exact` dopĺňa tím Archív. `migrate_appearances_from_staging()` volá
prepojenie s predvolenými hodnotami — pri vypnutom automatickom potvrdení spustite po migrácii archívu
príkaz vyššie, alebo nechajte potvrdené záznamy skontrolovať v Archíve.)

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
drop function if exists public.migrate_appearances_from_staging();
drop schema if exists staging cascade;
```

Ak by ste neskôr potrebovali migráciu zopakovať, stačí znova spustiť `040_migration.sql`.

### 4.6 Ďalšie registračné vlny

Nové vlny sa už nahrávajú priamo v aplikácii: **Import** (len správca) — nahrať súbor, skontrolovať
priradenie stĺpcov, náhľad nových / zhodných / chybných riadkov, rozhodnúť o duplicitách, až potom
vykonať. Na konci sa dá stiahnuť protokol vrátane dôvodov, prečo riadky neprešli.

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

- **Platený plán Supabase** robí denné zálohy automaticky (Database → Backups). Za príplatok je
  k dispozícii aj obnova k ľubovoľnému okamihu (Point in Time Recovery).
- **Vlastná záloha raz za čas** (potrebujete heslo k databáze z kroku 3.1):

  ```bash
  npx supabase db dump --linked -f zaloha-schema.sql
  npx supabase db dump --linked --data-only -f zaloha-data.sql
  ```

- **Skúška obnovy — aspoň raz na začiatku a potom raz ročne.** Založte druhý, testovací Supabase projekt,
  v SQL Editore spustite `zaloha-schema.sql` a potom `zaloha-data.sql` a skontrolujte počty profilov.
  Záloha, ktorú ste nikdy neobnovili, nie je záloha.
- Fotografie v úložisku nie sú súčasťou databázovej zálohy. Pri migrácii si ponechajte kópiu
  pôvodného priečinka fotiek.

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
| Rozsypaná diakritika | Súbor nebol v UTF-8. Uložte znova a nahrajte opakovane (prevod je opakovateľný). |
| Na internete nefunguje, lokálne áno | Chýbajú premenné prostredia vo Verceli (časť 5). |
| Pozvánka nepríde | Je nasadená funkcia `invite-user` (časť 3.5)? Je adresa v Redirect URLs? |
