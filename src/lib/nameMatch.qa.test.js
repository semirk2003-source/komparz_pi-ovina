// Nezávislé kontrolné testy (QA) párovania archívu podľa špecifikácie, kapitola 5.5:
// systém len navrhuje; menovci sa nikdy nesmú zliať do jednej osoby.
import { describe, expect, it } from 'vitest'
import { bestSuggestion, countNamesakes, groupNameVariants, nameScore, normalizeName, suggestPeople } from './nameMatch.js'

const people = [
  { id: 1, first_name: 'Diana', last_name: 'Vranová' },
  { id: 2, first_name: 'Diana', last_name: 'Vranová' },
  { id: 3, first_name: 'Ján', last_name: 'Novák' },
  { id: 4, first_name: 'Jana', last_name: 'Nováková' },
  { id: 5, first_name: 'Veronika', last_name: 'Ivanová' },
  { id: 6, first_name: 'Ondrej', last_name: 'Trnavský' },
]

describe('normalizeName', () => {
  it('ignoruje diakritiku, veľkosť písmen a interpunkciu', () => {
    expect(normalizeName('  ĎURIŠ-Šťastná, Ľubica ')).toBe('duris stastna lubica')
    expect(normalizeName(null)).toBe('')
  })
})

describe('menovci (Diana Vranová dvakrát)', () => {
  it('presná zhoda s menovcami je označená ako nejednoznačná', () => {
    const best = bestSuggestion('Diana Vranová', people)
    expect(best.ambiguous).toBe(true)
    expect(best.alternatives.map((a) => a.person.id).sort()).toEqual([1, 2])
  })

  it('aj podobné meno pri menovcoch ostáva nejednoznačné', () => {
    expect(bestSuggestion('Dana Vranová', people).ambiguous).toBe(true)
  })

  it('countNamesakes nájde oboch', () => {
    expect(countNamesakes(people[0], people)).toBe(2)
    expect(countNamesakes(people[2], people)).toBe(1)
  })
})

describe('zhoda mien', () => {
  it('poradie slov a chýbajúca diakritika nevadia', () => {
    expect(nameScore('Novák Ján', people[2])).toBe(1)
    expect(nameScore('Jan Novak', people[2])).toBe(1)
  })

  it('jednoznačný človek dostane jediný návrh', () => {
    const best = bestSuggestion('Veronika Ivanova', people)
    expect(best).toMatchObject({ ambiguous: false })
    expect(best.person.id).toBe(5)
  })

  it('Ján Novák a Jana Nováková nie sú zamieňané pri presnej zhode', () => {
    expect(bestSuggestion('Ján Novák', people).person.id).toBe(3)
    expect(bestSuggestion('Jana Nováková', people).person.id).toBe(4)
  })

  it('neznáme meno nič nenavrhne; prázdne meno nič nenavrhne', () => {
    expect(bestSuggestion('Peter Kováč', people)).toBeNull()
    expect(suggestPeople('', people)).toEqual([])
  })

  it('návrhy sú zoradené od najlepšieho a obmedzené limitom', () => {
    const list = suggestPeople('Novák J.', people, { limit: 1, minScore: 0.5 })
    expect(list).toHaveLength(1)
    expect(list[0].person.id).toBe(3)
  })

  it('výkon: 5000 profilov pod 100 ms na jedno meno', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, first_name: `Meno${i}`, last_name: `Priezvisko${i % 97}` }))
    suggestPeople('Meno1 Priezvisko1', many)
    const t0 = performance.now()
    suggestPeople('Meno4321 Priezvisko53', many)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('zjednocovanie názvov postáv', () => {
  it('Čašník / čašník / Čašnik spadnú do jednej skupiny, „Čašník v bare" nie', () => {
    const groups = groupNameVariants([
      { raw_value: 'Čašník' }, { raw_value: 'čašník' }, { raw_value: 'Čašnik' }, { raw_value: 'Čašník v bare' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((g) => g.raw_value)).toEqual(['Čašník', 'čašník', 'Čašnik'])
  })
})
