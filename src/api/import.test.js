import { beforeEach, describe, expect, it, vi } from 'vitest'

// Demo databáza potrebuje localStorage — v teste ho nahradíme pamäťou.
const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
})

const { IS_DEMO } = await import('./backend.js')
const { getDb, setSessionUserId } = await import('./local/db.js')
const {
  EXTRA, SKIP, DUPLICATE_ACTIONS, autoMapColumns, buildPreview, executeImport, loadMatchIndex, validateMapping, updatePatch,
} = await import('./import.js')

const HEADERS = ['ID', 'Meno a priezvisko', 'Pohlavie', 'Dátum narodenia', 'Telefón', 'E-mail', 'Mesto', 'Topánky', 'Dobový kostým']

describe.runIf(IS_DEMO)('import registračnej vlny (demo)', () => {
  beforeEach(() => setSessionUserId('demo-admin'))

  it('priradí stĺpce podľa hlavičky a neznáme uloží ako doplnkové odpovede', () => {
    const mapping = autoMapColumns(HEADERS)
    expect(mapping).toEqual(['legacy_id', 'full_name', 'gender', 'birth_date', 'phone', 'email', 'city', 'shoe_size', EXTRA])
    expect(validateMapping(mapping)).toEqual([])
    expect(validateMapping(mapping.map(() => SKIP))).toContain('Chýba stĺpec s menom.')
  })

  it('náhľad rozlíši nové, zhodné a chybné riadky; menovec bez zhody dátumu nie je duplicita', async () => {
    const existing = getDb().people[0]
    const rows = [
      ['', 'Nový Človek', 'M', '1.1.1990', '', '', 'Nitra', '43', 'áno'],
      [String(existing.legacy_id), 'Ktokoľvek Iný', '', '', '', '', '', '', ''],
      ['', 'zly@mail.sk', '', '', '', '', '', '', ''],
      ['', `${existing.first_name} ${existing.last_name}`, '', '2.2.1950', '', '', '', '', ''],
    ]
    const index = await loadMatchIndex()
    const { rows: out, summary } = buildPreview({ headers: HEADERS, rows, mapping: autoMapColumns(HEADERS), index })
    expect(out.map((r) => r.category)).toEqual(['new', 'match', 'error', 'new'])
    expect(out[0].person).toMatchObject({ first_name: 'Nový', last_name: 'Človek', gender: 'Muž', region: 'Západné Slovensko', shoe_size: 43 })
    expect(out[0].extra).toEqual({ 'Dobový kostým': 'áno' })
    expect(out[1].match.personId).toBe(existing.id)
    expect(summary).toMatchObject({ total: 4, new: 2, match: 1, error: 1 })
  })

  it('vykoná import podľa rozhodnutí a vráti protokol', async () => {
    const before = getDb().people.length
    const existing = getDb().people[1]
    const rows = [
      ['', 'Import Test', 'Ž', '3.3.1993', '0905 000 111', '', 'Košice', '38', 'nie'],
      [String(existing.legacy_id), existing.first_name + ' ' + existing.last_name, '', '', '', '', 'Nové Mesto', '', ''],
      ['', '', '', '', '', '', '', '', ''],
    ]
    const index = await loadMatchIndex()
    const preview = buildPreview({ headers: HEADERS, rows, mapping: autoMapColumns(HEADERS), index })
    const plan = preview.rows
      .filter((r) => r.category !== 'error')
      .map((row) =>
        row.category === 'new'
          ? { row, action: DUPLICATE_ACTIONS.CREATE }
          : { row, action: DUPLICATE_ACTIONS.UPDATE, personId: row.match.personId },
      )
    const { protocol, warnings } = await executeImport({ plan, errorRows: preview.rows.filter((r) => r.category === 'error'), registrationId: 3 })
    expect(warnings).toEqual([])

    expect(protocol.map((p) => p.outcome)).toEqual(['created', 'updated', 'error'])
    expect(getDb().people.length).toBe(before + 1)
    const created = getDb().people.find((p) => p.id === protocol[0].personId)
    expect(created).toMatchObject({ phone: '+421905000111', region: 'Východné Slovensko', created_by: 'demo-admin' })
    expect(getDb().people.find((p) => p.id === existing.id).city).toBe('Nové Mesto')
    expect(getDb().person_registrations.find((r) => r.person_id === created.id && r.registration_id === 3).extra).toEqual({ 'Dobový kostým': 'nie' })
  })

  const H2 = ['ID', 'Meno a priezvisko', 'Dátum narodenia', 'Telefón', 'Kraj', 'Dobový vzhľad', 'Mesto']

  it('prázdne bunky pri aktualizácii neprepíšu existujúce údaje', async () => {
    const existing = getDb().people[2]
    existing.period_look = true
    existing.region = 'Stredné Slovensko'
    const index = await loadMatchIndex()
    const preview = buildPreview({ headers: H2, rows: [[String(existing.legacy_id), `${existing.first_name} ${existing.last_name}`, '', '', '', '', '']], mapping: autoMapColumns(H2), index, strict: false })
    const row = preview.rows[0]
    expect(row.category).toBe('match')
    expect(row.person).not.toHaveProperty('period_look')
    expect(row.person).not.toHaveProperty('region')
    await executeImport({ plan: [{ row, action: DUPLICATE_ACTIONS.UPDATE, personId: existing.id }], registrationId: null })
    const after = getDb().people.find((p) => p.id === existing.id)
    expect(after).toMatchObject({ period_look: true, region: 'Stredné Slovensko' })
  })

  it('zhoda len podľa telefónu je možná zhoda — bez cieľa a bez prepisu mena či dátumu', async () => {
    const mother = getDb().people.find((p) => p.phone && p.birth_date && p.legacy_id)
    const index = await loadMatchIndex()
    const preview = buildPreview({
      headers: H2,
      rows: [['', 'Dieťa Testové', '1.1.2022', mother.phone, '', '', '']],
      mapping: autoMapColumns(H2),
      index,
    })
    const row = preview.rows[0]
    expect(row.match).toMatchObject({ kind: 'phone', weak: true, personId: null })
    expect(row.match.candidates.map((c) => c.id)).toContain(mother.id)
    expect(updatePatch(row.person, row.match)).not.toHaveProperty('first_name')
    expect(updatePatch(row.person, row.match)).not.toHaveProperty('birth_date')
    await expect(executeImport({ plan: [{ row, action: DUPLICATE_ACTIONS.UPDATE }] })).rejects.toThrow(/nie je vybraný profil/)
    await executeImport({ plan: [{ row, action: DUPLICATE_ACTIONS.UPDATE, personId: mother.id }] })
    const after = getDb().people.find((p) => p.id === mother.id)
    expect(after.first_name).toBe(mother.first_name)
    expect(after.birth_date).toBe(mother.birth_date)
  })

  it('zhoda s viacerými profilmi nikdy nevyberie prvý automaticky', async () => {
    const [a, b] = getDb().people.slice(10, 12)
    Object.assign(b, { first_name: a.first_name, last_name: a.last_name, birth_date: a.birth_date })
    const index = await loadMatchIndex()
    const preview = buildPreview({
      headers: H2,
      rows: [['', `${a.first_name} ${a.last_name}`, a.birth_date, '', '', '', '']],
      mapping: autoMapColumns(H2),
      index,
    })
    expect(preview.rows[0].match).toMatchObject({ ambiguous: true, personId: null })
    expect(preview.rows[0].match.candidates).toHaveLength(2)
  })

  it('viewer import nespustí', async () => {
    setSessionUserId('demo-viewer')
    await expect(loadMatchIndex()).rejects.toThrow()
  })
})
