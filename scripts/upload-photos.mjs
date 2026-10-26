#!/usr/bin/env node
// =====================================================================
// Hromadné nahratie fotografií do Supabase (kapitola 5.4 špecifikácie).
//
// Spúšťa sa raz, na vašom počítači, AŽ PO migrácii profilov (fotka potrebuje
// existujúci profil). Kotvou je pôvodné číslo z Excelu (legacy_id).
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   npm run photos:upload -- --mode=c --dir=./fotky --dry-run
//
// Režimy:
//   --mode=a --csv=ludia.csv          CSV so stĺpcami legacy_id a foto_odkaz (odkazy na Google Drive;
//                                     priečinok musí byť dočasne „ktokoľvek s odkazom môže zobraziť")
//   --mode=b --dir=xl/media --map=mapovanie.csv
//                                     obrázky vybalené z XLSX + mapovací CSV (legacy_id, subor).
//                                     Bez --map skript len pripraví NÁVRH mapovania podľa poradia
//                                     (--draft-from=ludia.csv) — poradie nie je zaručené, treba ho skontrolovať.
//   --mode=c --dir=fotky              súbory „1234_Novak.jpg", „1234 - Ján Novák.jpg" alebo priečinok „1234 - Ján Novák/"
//                                     (len priečinok, v ktorom fotka priamo leží). Meno v názve sa porovná s profilom.
//                                     Bez čísla, s rokom/dátumom na začiatku, alebo pri nezhode mena → report na ručné
//                                     párovanie. Súbory pomenované len číslom („1234.jpg") až s --allow-bare-id.
//
// Voľby: --dry-run (nič nenahrá), --limit=N, --concurrency=4, --out=scripts/output
//
// Každá fotka sa zmenší na dlhšiu stranu 1600 px, vytvorí sa náhľad 400 px a odstránia
// sa metadáta (vrátane GPS). Originál sa neuchováva. Najviac 5 fotiek na profil.
// Skript je opakovateľný: názov súboru v úložisku je odvodený z obsahu fotky, takže
// už nahratá fotka sa pri ďalšom spustení preskočí.
//
// Kľúč service_role obchádza všetky prístupové pravidlá. Patrí LEN do premennej
// prostredia pri spustení tohto skriptu — nikdy do súboru v projekte ani na GitHub.
// =====================================================================

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'person-photos'
const MAX_PER_PERSON = 5
const FULL = 1600
const THUMB = 400
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.gif', '.bmp'])

// ---------------------------------------------------------------------
// Argumenty
// ---------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)
const MODE = String(args.mode || '').toLowerCase()
const DRY = Boolean(args['dry-run'])
const LIMIT = args.limit ? Number(args.limit) : Infinity
const CONCURRENCY = Number(args.concurrency || 4)
const OUT_DIR = path.resolve(String(args.out || 'scripts/output'))

function die(msg) {
  console.error(`\nCHYBA: ${msg}\n`)
  process.exit(1)
}

if (args.help || !['a', 'b', 'c'].includes(MODE)) {
  console.log(`Použitie: npm run photos:upload -- --mode=a|b|c [voľby]  (podrobnosti v hlavičke scripts/upload-photos.mjs)`)
  process.exit(args.help ? 0 : 1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  die('Nastavte premenné prostredia SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API).')
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// ---------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------

async function readTable(file) {
  const buf = await readFile(file)
  const wb = /\.xlsx?$/i.test(file)
    ? XLSX.read(buf, { type: 'buffer' })
    : XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true, FS: detectDelimiter(buf.toString('utf8')) })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normKey(k), String(v).trim()])))
}

function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] || ''
  const counts = [';', ',', '\t'].map((d) => [d, line.split(d).length])
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

function normKey(k) {
  return k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_')
}

function parseLegacy(v) {
  const n = Number(String(v ?? '').replace(/\s/g, ''))
  return Number.isInteger(n) && n > 0 ? n : null
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

// „1234_Novak", „1234 - Ján Novák", „1234 Ján Novák" → { legacyId, name }.
// Rok alebo dátum na začiatku („2019 Novák", „2023-05-01 Ján Novák") nie je pôvodné číslo.
const DATE_PREFIX = /^\s*(\d{4}[-_.]\d{1,2}[-_.]\d{1,2}|\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}|\d{8})(?!\d)/
function parseAnchor(name) {
  if (DATE_PREFIX.test(name)) return null
  const m = name.match(/^\s*(\d{1,7})\s*(?:[_\-–—.]+\s*|\s+)(\p{L}[\p{L}\s'.-]*\p{L})/u)
  if (!m) {
    if (args['allow-bare-id']) {
      const bare = name.match(/^\s*(\d{1,7})\s*$/)
      if (bare && !/^(19|20)\d{2}$/.test(bare[1])) return { legacyId: Number(bare[1]), name: null }
    }
    return null
  }
  if (/^(19|20)\d{2}$/.test(m[1])) return { error: `„${name}" začína rokom, nie pôvodným číslom — spárujte ručne.` }
  return { legacyId: Number(m[1]), name: m[2].replace(/[_]+/g, ' ').trim() }
}

function plainTokens(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z]+/).filter((t) => t.length > 1)
}

// Meno v názve súboru musí sedieť s profilom (aspoň priezvisko; ak je v názve viac slov, aj krstné meno).
function nameMatchesProfile(nameHint, person) {
  if (!nameHint) return true
  const file = new Set(plainTokens(nameHint))
  const last = plainTokens(person.last_name)
  const first = plainTokens(person.first_name)
  const lastOk = last.length > 0 && last.every((t) => file.has(t))
  const firstOk = first.length === 0 || first.some((t) => file.has(t))
  return lastOk && (file.size <= last.length || firstOk)
}

function driveFileIds(text) {
  const ids = []
  for (const m of String(text).matchAll(/(?:\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/g)) ids.push(m[1])
  return [...new Set(ids)]
}

async function downloadDrive(id) {
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Google Drive vrátil ${res.status}`)
  const type = res.headers.get('content-type') || ''
  if (!type.startsWith('image/')) {
    throw new Error('Súbor nie je obrázok alebo nie je zdieľaný („ktokoľvek s odkazom môže zobraziť").')
  }
  return Buffer.from(await res.arrayBuffer())
}

// Dátum nafotenia z EXIF (DateTimeOriginal) — kým sa metadáta pri zmenšení odstránia.
async function takenOn(buffer) {
  try {
    const meta = await sharp(buffer).metadata()
    if (!meta.exif) return null
    const m = meta.exif.toString('latin1').match(/(19|20)\d{2}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/)
    if (!m) return null
    const iso = m[0].slice(0, 10).replace(/:/g, '-')
    return Number.isNaN(Date.parse(iso)) ? null : iso
  } catch {
    return null
  }
}

async function resize(buffer, edge, quality) {
  return sharp(buffer, { failOn: 'error' })
    .rotate() // podľa EXIF orientácie, potom sa metadáta zahodia (sharp ich štandardne nekopíruje)
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
}

function csvLine(values) {
  return values.map((v) => {
    const s = String(v ?? '')
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')
}

async function runPool(items, worker) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++]
        await worker(item)
      }
    }),
  )
}

// ---------------------------------------------------------------------
// Zdroje fotiek → [{ legacyId, source, load: () => Buffer }] + nepárované
// ---------------------------------------------------------------------

async function collectJobs() {
  const jobs = []
  const manual = []

  if (MODE === 'a') {
    if (!args.csv) die('Režim A potrebuje --csv=subor.csv so stĺpcami legacy_id a foto_odkaz.')
    for (const row of await readTable(String(args.csv))) {
      const legacyId = parseLegacy(row.legacy_id)
      const link = row.foto_odkaz || row.foto || row.fotky || ''
      if (!link) continue
      if (!legacyId) {
        manual.push({ source: link, reason: 'Riadok bez platného legacy_id.' })
        continue
      }
      for (const id of driveFileIds(link)) {
        jobs.push({ legacyId, source: `drive:${id}`, load: () => downloadDrive(id) })
      }
      if (driveFileIds(link).length === 0) manual.push({ source: link, reason: 'Z odkazu sa nepodarilo vyčítať ID súboru na Drive.' })
    }
  }

  if (MODE === 'b') {
    if (!args.dir) die('Režim B potrebuje --dir=cesta/k/xl/media.')
    const dir = path.resolve(String(args.dir))
    if (!args.map) {
      // Návrh mapovania podľa poradia — len na ručnú kontrolu, nič sa nenahrá.
      if (!args['draft-from']) die('Zadajte --map=mapovanie.csv, alebo --draft-from=ludia.csv na prípravu návrhu mapovania.')
      const people = await readTable(String(args['draft-from']))
      const files = (await readdir(dir))
        .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
        .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
      await mkdir(OUT_DIR, { recursive: true })
      const file = path.join(OUT_DIR, 'navrh-mapovania.csv')
      const lines = [csvLine(['legacy_id', 'subor', 'meno_na_kontrolu'])]
      files.forEach((f, i) => lines.push(csvLine([people[i]?.legacy_id ?? '', f, people[i]?.meno_priezvisko || `${people[i]?.meno ?? ''} ${people[i]?.priezvisko ?? ''}`])))
      await writeFile(file, `﻿${lines.join('\r\n')}`)
      console.log(`\nNávrh mapovania uložený do ${file}.`)
      console.log('POZOR: poradie obrázkov v XLSX nie je zaručené. Skontrolujte aspoň 20 riadkov naprieč súborom,')
      console.log('opravte chyby a potom spustite skript s --map=navrh-mapovania.csv.\n')
      process.exit(0)
    }
    for (const row of await readTable(String(args.map))) {
      const legacyId = parseLegacy(row.legacy_id)
      const file = row.subor || row.file || row.obrazok
      if (!file) continue
      const full = path.join(dir, file)
      if (!legacyId) {
        manual.push({ source: full, reason: 'Riadok mapovania bez platného legacy_id.' })
        continue
      }
      jobs.push({ legacyId, source: full, load: () => readFile(full) })
    }
  }

  if (MODE === 'c') {
    if (!args.dir) die('Režim C potrebuje --dir=priecinok-s-fotkami.')
    const dir = path.resolve(String(args.dir))
    for (const full of await walk(dir)) {
      // Kotva je len v názve súboru, alebo v názve priečinka, v ktorom súbor priamo leží
      // („1234 - Ján Novák/foto1.jpg"). Vyššie priečinky („fotky/2019/") sa ignorujú.
      const parent = path.relative(dir, path.dirname(full)) ? path.basename(path.dirname(full)) : null
      const parsed = parseAnchor(path.basename(full, path.extname(full))) || (parent && parseAnchor(parent))
      if (parsed?.error) manual.push({ source: full, reason: parsed.error })
      else if (parsed) jobs.push({ legacyId: parsed.legacyId, nameHint: parsed.name, source: full, load: () => readFile(full) })
      else manual.push({ source: full, reason: 'Názov nemá tvar „číslo + oddeľovač + meno" — spárujte ručne (podľa mena sa nehádá).' })
    }
  }

  return { jobs: jobs.slice(0, LIMIT), manual }
}

// ---------------------------------------------------------------------
// Hlavný beh
// ---------------------------------------------------------------------

async function fetchAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999)
    if (error) die(`Nepodarilo sa načítať ${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

async function main() {
  console.log(`Režim ${MODE.toUpperCase()}${DRY ? ' — SKÚŠKA NANEČISTO (--dry-run), nič sa nenahrá' : ''}`)
  const { jobs, manual } = await collectJobs()
  console.log(`Nájdených fotiek na spracovanie: ${jobs.length}, na ručné párovanie: ${manual.length}`)

  const people = await fetchAll('people', 'id, legacy_id, first_name, last_name')
  const byLegacy = new Map(people.filter((p) => p.legacy_id != null).map((p) => [p.legacy_id, p]))
  const photos = await fetchAll('person_photos', 'id, person_id, storage_path, is_primary')
  const existingPaths = new Set(photos.map((p) => p.storage_path))
  const countByPerson = new Map()
  const hasPrimary = new Set()
  for (const p of photos) {
    countByPerson.set(p.person_id, (countByPerson.get(p.person_id) || 0) + 1)
    if (p.is_primary) hasPrimary.add(p.person_id)
  }

  const report = manual.map((m) => ({ source: m.source, legacy_id: '', person_id: '', status: 'needs_manual', detail: m.reason }))
  const touched = new Set()
  let done = 0

  await runPool(jobs, async (job) => {
    const entry = { source: job.source, legacy_id: job.legacyId, person_id: '', status: '', detail: '' }
    try {
      const person = byLegacy.get(job.legacyId)
      if (!person) {
        entry.status = 'no_person'
        entry.detail = `Profil s pôvodným číslom ${job.legacyId} neexistuje — najprv migrujte profily.`
        return
      }
      entry.person_id = person.id
      if (!nameMatchesProfile(job.nameHint, person)) {
        entry.status = 'needs_manual'
        entry.detail = `Meno v názve „${job.nameHint}" nesedí s profilom ${person.first_name} ${person.last_name} (pôvodné č. ${job.legacyId}) — nenahraté, overte ručne.`
        return
      }
      const original = await job.load()
      const hash = createHash('sha256').update(original).digest('hex').slice(0, 24)
      const fullPath = `${person.id}/${hash}.jpg`
      const thumbPath = `${person.id}/${hash}_thumb.jpg`
      if (existingPaths.has(fullPath)) {
        entry.status = 'skipped_existing'
        entry.detail = 'Táto fotka už bola nahratá.'
        return
      }
      // Rezervácia miesta (súbežné úlohy pre toho istého človeka).
      const count = countByPerson.get(person.id) || 0
      if (count >= MAX_PER_PERSON) {
        entry.status = 'skipped_limit'
        entry.detail = `Profil už má ${MAX_PER_PERSON} fotografií.`
        return
      }
      countByPerson.set(person.id, count + 1)
      existingPaths.add(fullPath)
      const isPrimary = !hasPrimary.has(person.id)
      if (isPrimary) hasPrimary.add(person.id)

      const taken = await takenOn(original)
      const full = await resize(original, FULL, 82)
      const thumb = await resize(original, THUMB, 75)
      if (DRY) {
        entry.status = 'dry_run'
        entry.detail = `${full.info.width}×${full.info.height}, ${Math.round(full.data.length / 1024)} kB${taken ? `, nafotené ${taken}` : ''}`
        touched.add(person.id)
        return
      }
      for (const [p, file] of [[fullPath, full.data], [thumbPath, thumb.data]]) {
        const { error } = await supabase.storage.from(BUCKET).upload(p, file, { contentType: 'image/jpeg', upsert: true })
        if (error) throw new Error(`Nahratie do úložiska zlyhalo: ${error.message}`)
      }
      const { error } = await supabase.from('person_photos').insert({
        person_id: person.id,
        storage_path: fullPath,
        thumb_path: thumbPath,
        is_primary: isPrimary,
        sort_order: count,
        taken_on: taken,
        width: full.info.width,
        height: full.info.height,
      })
      if (error) throw new Error(`Záznam fotky sa nepodarilo uložiť: ${error.message}`)
      entry.status = 'uploaded'
      entry.detail = taken ? `nafotené ${taken}` : 'dátum nafotenia neznámy — doplňte v profile'
      touched.add(person.id)
    } catch (err) {
      entry.status = 'error'
      entry.detail = err.message
    } finally {
      report.push(entry)
      done++
      if (done % 25 === 0 || done === jobs.length) process.stdout.write(`\r  spracované ${done}/${jobs.length}`)
    }
  })
  console.log('')

  await mkdir(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportFile = path.join(OUT_DIR, `fotky-report-${stamp}.csv`)
  const lines = [csvLine(['zdroj', 'legacy_id', 'person_id', 'stav', 'detail'])]
  for (const r of report) lines.push(csvLine([r.source, r.legacy_id, r.person_id, r.status, r.detail]))
  await writeFile(reportFile, `﻿${lines.join('\r\n')}`)

  const summary = report.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  console.log('\nVýsledok:')
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`)
  console.log(`\nReport: ${reportFile}`)

  // Vizuálna kontrola: 20 profilov rozložených naprieč abecedou.
  const checked = people
    .filter((p) => touched.has(p.id))
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'sk'))
  if (checked.length) {
    const step = Math.max(1, checked.length / 20)
    const sample = Array.from({ length: Math.min(20, checked.length) }, (_, i) => checked[Math.floor(i * step)])
    console.log('\nSKONTROLUJTE POHĽADOM — 20 profilov naprieč abecedou (je to naozaj tá správna tvár?):')
    for (const p of sample) {
      let link = ''
      if (!DRY) {
        const { data } = await supabase.from('person_photos').select('thumb_path').eq('person_id', p.id).order('sort_order').limit(1)
        const thumb = data?.[0]?.thumb_path
        if (thumb) {
          const signed = await supabase.storage.from(BUCKET).createSignedUrl(thumb, 3600)
          link = signed.data?.signedUrl || ''
        }
      }
      console.log(`  [${p.legacy_id}] ${p.first_name} ${p.last_name}  (profil #${p.id})${link ? `\n      ${link}` : ''}`)
    }
    console.log('\nOdkazy platia 1 hodinu. Alebo otvorte profily v aplikácii (Ľudia → vyhľadať meno).')
  }
  if (MODE === 'a') {
    console.log('\nNEZABUDNITE: priečinok na Google Drive vráťte späť na súkromné zdieľanie.')
  }
}

main().catch((err) => die(err.message))
