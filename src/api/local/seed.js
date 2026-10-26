// Deterministický generátor demo dát. Rovnaký počet profilov dá vždy
// rovnaké dáta, takže chyby sa dajú reprodukovať.

import { CLOTHING_SIZES, MATCH_STATUS, ROLES } from '../../constants/polia.js'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FEMALE_FIRST = ['Anna', 'Mária', 'Katarína', 'Zuzana', 'Eva', 'Jana', 'Lucia', 'Veronika', 'Diana', 'Martina', 'Petra', 'Simona', 'Barbora', 'Kristína', 'Lenka', 'Monika', 'Natália', 'Ivana', 'Michaela', 'Nina', 'Soňa', 'Žofia', 'Ema', 'Hana', 'Alžbeta']
const MALE_FIRST = ['Ján', 'Peter', 'Martin', 'Tomáš', 'Michal', 'Jozef', 'Marek', 'Lukáš', 'Ondrej', 'Juraj', 'Pavol', 'Matej', 'Filip', 'Jakub', 'Róbert', 'Igor', 'Štefan', 'Dušan', 'Ľubomír', 'Adam', 'Samuel', 'Patrik', 'Viktor', 'Richard', 'Daniel']
const LAST_STEMS = [
  ['Novák', 'Nováková'], ['Kováč', 'Kováčová'], ['Horváth', 'Horváthová'], ['Varga', 'Vargová'],
  ['Tóth', 'Tóthová'], ['Nagy', 'Nagyová'], ['Baláž', 'Balážová'], ['Molnár', 'Molnárová'],
  ['Szabó', 'Szabóová'], ['Lukáč', 'Lukáčová'], ['Ďuriš', 'Ďurišová'], ['Kráľ', 'Kráľová'],
  ['Vrana', 'Vranová'], ['Ivan', 'Ivanová'], ['Trnavský', 'Trnavská'], ['Hudák', 'Hudáková'],
  ['Polák', 'Poláková'], ['Mráz', 'Mrázová'], ['Šimko', 'Šimková'], ['Bartoš', 'Bartošová'],
  ['Kollár', 'Kollárová'], ['Gajdoš', 'Gajdošová'], ['Čierny', 'Čierna'], ['Biely', 'Biela'],
  ['Zelenák', 'Zelenáková'], ['Repka', 'Repková'], ['Šťastný', 'Šťastná'], ['Ševčík', 'Ševčíková'],
]
const CITIES = [
  ['Bratislava', 'Západné Slovensko', 30], ['Trnava', 'Západné Slovensko', 6], ['Nitra', 'Západné Slovensko', 6],
  ['Pezinok', 'Západné Slovensko', 4], ['Senec', 'Západné Slovensko', 4], ['Trenčín', 'Západné Slovensko', 4],
  ['Žilina', 'Stredné Slovensko', 5], ['Banská Bystrica', 'Stredné Slovensko', 5], ['Martin', 'Stredné Slovensko', 3],
  ['Košice', 'Východné Slovensko', 5], ['Prešov', 'Východné Slovensko', 4], ['Poprad', 'Východné Slovensko', 2],
  ['Brno', 'Česko', 2], ['Praha', 'Česko', 2], ['', 'Iné / neuvedené', 2],
]
const HAIR = ['blond', 'hnedé', 'čierne', 'ryšavé', 'šedivé', 'gaštanové', 'bez vlasov']
const EYES = ['modré', 'hnedé', 'zelené', 'sivé']
const LANGS = ['angličtina', 'nemčina', 'maďarčina', 'ruština', 'francúzština', 'taliančina']
const SKILLS = ['tanec', 'jazda na koni', 'hra na klavír', 'hra na gitaru', 'spev', 'šerm', 'plávanie', 'korčuľovanie', 'žonglovanie']
const NOTES = [
  'Spoľahlivý, chodí načas.', 'Výrazná tvár, vhodný na detail.', 'Má vlastný dobový kostým.',
  'Preferuje víkendy.', 'Vhodná na rolu čašníčky.', 'Nemôže v noci.', 'Má psa — dá sa využiť v scéne.',
  'Má skúsenosť s textom pred kamerou.', 'Bývalý policajt.', 'Zdravotná sestra v civile.', '', '', '', '',
]
const PRODUCTIONS = [
  { name: 'Rýchly prachy', kind: 'seriál', series: ['1. séria', '2. séria', '3. séria'] },
  { name: 'Dunajská nemocnica', kind: 'seriál', series: ['1. séria', '2. séria'] },
  { name: 'Mestská hliadka', kind: 'seriál', series: ['1. séria', '2. séria', '3. séria', '4. séria'] },
  { name: 'Leto 1948', kind: 'film', series: [] },
  { name: 'Hotel pod Tatrami', kind: 'seriál', series: ['1. séria'] },
  { name: 'Reklama — limonáda', kind: 'reklama', series: [] },
]
const ROLE_VARIANTS = [
  ['Čašník', 'čašník', 'Čašnik', 'Čašník v bare'],
  ['Hosť v reštaurácii', 'hosť v reštaurácii', 'Hosť reštaurácia'],
  ['Okoloidúci', 'okoloidúci', 'Okoloiduci'],
  ['Pacient', 'pacient'],
  ['Zdravotná sestra', 'Zdr. sestra'],
  ['Policajt', 'policajt', 'Policajt — hliadka'],
  ['Hosť na svadbe'],
  ['Robotník'],
  ['Turista', 'turista'],
  ['Divák na štadióne'],
  ['test', ''],
]

function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length)]
}

function weighted(rnd, items) {
  const total = items.reduce((s, it) => s + it[2], 0)
  let r = rnd() * total
  for (const it of items) {
    r -= it[2]
    if (r <= 0) return it
  }
  return items[0]
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function typo(rnd, name) {
  const swaps = [['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'], ['ý', 'y'], ['č', 'c'], ['š', 's'], ['ž', 'z'], ['ň', 'n']]
  const options = swaps.filter(([a]) => name.includes(a))
  if (options.length === 0) return name.toUpperCase()
  const [a, b] = pick(rnd, options)
  return name.replace(a, b)
}

// Zvýšiť pri zmene štruktúry demo dát — staré dáta v prehliadači sa potom vygenerujú nanovo.
export const SEED_VERSION = 1

export function generateSeed(peopleCount = 800) {
  const rnd = mulberry32(20260)
  const today = new Date()
  const now = today.toISOString()

  const users = [
    { id: 'demo-admin', email: 'admin@demo.sk', full_name: 'Správca Demo', role: ROLES.ADMIN, is_active: true },
    { id: 'demo-caster', email: 'caster@demo.sk', full_name: 'Kasting Demo', role: ROLES.CASTER, is_active: true },
    { id: 'demo-viewer', email: 'viewer@demo.sk', full_name: 'Réžia Demo', role: ROLES.VIEWER, is_active: true },
  ].map((u) => ({ ...u, created_at: now, updated_at: now }))

  const registrations = [
    { id: 1, name: 'Nábor jar 2024', period_start: '2024-03-01', period_end: '2024-04-30', note: '', created_at: now },
    { id: 2, name: 'Casting DUNAJ', period_start: '2025-01-10', period_end: '2025-02-28', note: 'Registrácia DUNAJ — dobové typy.', created_at: now },
    { id: 3, name: 'Nábor jeseň 2026', period_start: '2026-09-01', period_end: '2026-10-15', note: '', created_at: now },
  ]

  const people = []
  const person_photos = []
  const person_registrations = []
  let photoId = 0

  const forcedNames = [
    ['Diana', 'Vranová', 'Žena'], ['Diana', 'Vranová', 'Žena'],
    ['Veronika', 'Ivanová', 'Žena'], ['Veronika', 'Ivanová', 'Žena'],
    ['Ondrej', 'Trnavský', 'Muž'], ['Ondrej', 'Trnavský', 'Muž'],
  ]

  for (let i = 1; i <= peopleCount; i++) {
    let first, last, gender
    if (i <= forcedNames.length) {
      ;[first, last, gender] = forcedNames[i - 1]
    } else {
      const g = rnd()
      gender = g < 0.52 ? 'Žena' : g < 0.99 ? 'Muž' : 'Iné'
      first = gender === 'Muž' ? pick(rnd, MALE_FIRST) : pick(rnd, FEMALE_FIRST)
      const stem = pick(rnd, LAST_STEMS)
      last = gender === 'Muž' ? stem[0] : stem[1]
    }
    const ageYears = rnd() < 0.06 ? Math.floor(rnd() * 14) + 1 : Math.floor(rnd() * 62) + 16
    const birth = addDays(today, -Math.floor(ageYears * 365.25 + rnd() * 360))
    const [city, region] = weighted(rnd, CITIES)
    const isChild = ageYears < 14
    const height = isChild ? 70 + ageYears * 6 : gender === 'Muž' ? 165 + Math.floor(rnd() * 30) : 155 + Math.floor(rnd() * 25)
    const createdDaysAgo = i > peopleCount - 40 ? Math.floor(rnd() * 50) : 60 + Math.floor(rnd() * 1500)
    const hasTattoos = rnd() < 0.2
    const missingBirth = rnd() < 0.03
    const contacted = rnd() < 0.85 ? isoDate(addDays(today, -Math.floor(rnd() * 1400))) : null
    const slug = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

    people.push({
      id: i,
      legacy_id: 1000 + i,
      first_name: first,
      last_name: last,
      gender,
      birth_date: missingBirth ? null : isoDate(birth),
      birth_date_approx: !missingBirth && rnd() < 0.05,
      phone: rnd() < 0.95 ? `+421 9${Math.floor(rnd() * 10)}${Math.floor(rnd() * 10)} ${String(Math.floor(rnd() * 1000)).padStart(3, '0')} ${String(Math.floor(rnd() * 1000)).padStart(3, '0')}` : null,
      email: rnd() < 0.9 ? `${slug}${i}@example.sk` : null,
      address: rnd() < 0.7 ? `${pick(rnd, ['Hlavná', 'Školská', 'Mierová', 'Záhradná', 'Lipová'])} ${Math.floor(rnd() * 90) + 1}, ${city || 'Bratislava'}` : null,
      city: city || null,
      region,
      height_cm: height,
      clothing_size: isChild ? 'Iné/detské' : pick(rnd, CLOTHING_SIZES.slice(0, 7)),
      shoe_size: isChild ? 20 + Math.floor(ageYears * 1.2) : gender === 'Muž' ? 40 + Math.floor(rnd() * 7) : 36 + Math.floor(rnd() * 6),
      hair_color: pick(rnd, HAIR),
      eye_color: pick(rnd, EYES),
      has_tattoos: hasTattoos,
      tattoo_note: hasTattoos ? pick(rnd, ['predlaktie', 'krk', 'chrbát', 'ruka — viditeľné']) : null,
      languages: LANGS.filter(() => rnd() < 0.15),
      driving_licence: rnd() < 0.6,
      skills: SKILLS.filter(() => rnd() < 0.08),
      period_look: rnd() < 0.25,
      speaking_role: rnd() < 0.15,
      notes: pick(rnd, NOTES) || null,
      is_active: rnd() < 0.97,
      anonymized_at: null,
      consent_at: isoDate(addDays(today, -createdDaysAgo)),
      last_contacted_at: contacted,
      created_at: addDays(today, -createdDaysAgo).toISOString(),
      updated_at: now,
      created_by: 'demo-admin',
      updated_by: null,
    })

    const photoCount = rnd() < 0.08 ? 0 : 1 + Math.floor(rnd() * 3)
    for (let p = 0; p < photoCount; p++) {
      photoId++
      person_photos.push({
        id: photoId,
        person_id: i,
        storage_path: `demo/${i}/${photoId}.jpg`,
        thumb_path: `demo/${i}/${photoId}_thumb.jpg`,
        is_primary: p === 0,
        sort_order: p,
        taken_on: isoDate(addDays(today, -Math.floor(rnd() * 1600))),
        width: 1200,
        height: 1600,
        created_at: now,
        created_by: 'demo-admin',
      })
    }

    const regRoll = rnd()
    if (regRoll < 0.9) {
      const regId = regRoll < 0.4 ? 1 : regRoll < 0.75 ? 2 : 3
      person_registrations.push({
        person_id: i,
        registration_id: regId,
        responded_at: registrations[regId - 1].period_start,
        extra: regId === 2 ? { dobovy_kostym: rnd() < 0.3 ? 'áno' : 'nie' } : {},
      })
    }
  }

  const productions = []
  const production_series = []
  let seriesId = 0
  PRODUCTIONS.forEach((p, idx) => {
    productions.push({ id: idx + 1, name: p.name, kind: p.kind, created_at: now })
    for (const s of p.series) {
      seriesId++
      production_series.push({ id: seriesId, production_id: idx + 1, name: s, created_at: now })
    }
  })

  // Archív: zhruba tretina ľudí niekde hrala.
  const appearances = []
  const seen = new Set()
  let appId = 0
  const actors = people.filter(() => rnd() < 0.35)
  for (const person of actors) {
    const days = 1 + Math.floor(rnd() * rnd() * 25)
    for (let d = 0; d < days; d++) {
      const prod = pick(rnd, PRODUCTIONS)
      const series = prod.series.length ? pick(rnd, prod.series) : null
      const roleGroup = pick(rnd, ROLE_VARIANTS)
      const role = rnd() < 0.8 ? roleGroup[0] : pick(rnd, roleGroup)
      const date = isoDate(addDays(today, -Math.floor(rnd() * 900) - 1))
      const key = `${person.id}|${date}|${prod.name}|${role}`
      if (seen.has(key)) continue
      seen.add(key)

      const roll = rnd()
      let rawName = `${person.first_name} ${person.last_name}`
      let status = MATCH_STATUS.CONFIRMED
      let personId = person.id
      let score = 1
      const sameName = people.filter((x) => x.first_name === person.first_name && x.last_name === person.last_name).length > 1
      if (sameName) {
        status = roll < 0.5 ? MATCH_STATUS.SUGGESTED : MATCH_STATUS.UNMATCHED
        score = 0.99
      } else if (roll < 0.12) {
        rawName = rnd() < 0.5 ? typo(rnd, rawName) : `${person.last_name} ${person.first_name}`
        status = MATCH_STATUS.SUGGESTED
        score = 0.8
      } else if (roll < 0.18) {
        rawName = typo(rnd, rawName)
        status = MATCH_STATUS.UNMATCHED
      }
      if (status === MATCH_STATUS.UNMATCHED) {
        personId = null
        score = null
      }
      appId++
      appearances.push({
        id: appId,
        raw_name: rawName,
        name_override: null,
        shoot_date: date,
        role_name: role || null,
        production_name: prod.name,
        series_name: series,
        original_shoot_date: date,
        original_role_name: role || null,
        original_production_name: prod.name,
        original_series_name: series,
        person_id: personId,
        match_status: status,
        match_score: score,
        is_excluded: false,
        source: 'demo',
        created_at: now,
        updated_at: now,
        created_by: 'demo-admin',
        updated_by: null,
      })
    }
  }
  // Ľudia, ktorí v databáze nie sú.
  for (const name of ['Jozef Neznámy', 'Mária Hosťová', 'Karol Náhradník']) {
    appId++
    const date = isoDate(addDays(today, -Math.floor(rnd() * 300) - 1))
    appearances.push({
      id: appId, raw_name: name, name_override: null, shoot_date: date,
      role_name: 'Okoloidúci', production_name: 'Mestská hliadka', series_name: '4. séria',
      original_shoot_date: date, original_role_name: 'Okoloidúci', original_production_name: 'Mestská hliadka',
      original_series_name: '4. séria', person_id: null, match_status: MATCH_STATUS.UNMATCHED, match_score: null,
      is_excluded: false, source: 'demo', created_at: now, updated_at: now, created_by: 'demo-admin', updated_by: null,
    })
  }

  const role_aliases = [
    { id: 1, kind: 'role', raw_value: 'čašník', canonical_value: 'Čašník', is_excluded: false, created_at: now, created_by: 'demo-admin' },
    { id: 2, kind: 'role', raw_value: 'test', canonical_value: null, is_excluded: true, created_at: now, created_by: 'demo-admin' },
  ]

  const selections = [
    { id: 1, name: 'Rýchly prachy – klub 19. 8.', project_name: 'Rýchly prachy', subtitle: 'Hostia v klube, 3. séria', is_archived: false, created_at: now, updated_at: now, created_by: 'demo-caster', updated_by: 'demo-caster' },
  ]
  const selection_items = people
    .filter((p) => p.is_active && p.region === 'Západné Slovensko')
    .slice(0, 12)
    .map((p, idx) => ({
      selection_id: 1,
      person_id: p.id,
      note: idx === 0 ? 'Výborná energia, preferovaný klientom.' : null,
      sort_order: idx,
      added_at: now,
      added_by: 'demo-caster',
      updated_at: now,
    }))

  return {
    version: SEED_VERSION,
    rev: 0,
    app_users: users,
    people,
    person_photos,
    registrations,
    person_registrations,
    productions,
    production_series,
    appearances,
    role_aliases,
    selections,
    selection_items,
    favorites: [],
    share_links: [],
    audit_log: [],
    seq: {
      people: peopleCount,
      person_photos: photoId,
      registrations: registrations.length,
      productions: productions.length,
      production_series: seriesId,
      appearances: appId,
      role_aliases: role_aliases.length,
      selections: selections.length,
      audit_log: 0,
    },
  }
}
