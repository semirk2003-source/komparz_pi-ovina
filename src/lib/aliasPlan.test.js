import { describe, expect, it } from 'vitest'
import { invertChanges, planClear, planExclude, planMerge, variantsOf } from './aliasPlan.js'

const v = (raw_value, alias = null) => ({ raw_value, occurrences: 1, alias })

describe('planMerge — pravidlá ostávajú ploché', () => {
  it('A→B a zlúčenie B pod C presmeruje aj A na C', () => {
    const values = [v('A', { canonical_value: 'B', is_excluded: false }), v('B'), v('C')]
    const changes = planMerge(values, ['B'], 'C')
    const rules = Object.fromEntries(changes.map((c) => [c.raw_value, c.rule]))
    expect(rules.B).toEqual({ canonical_value: 'C', is_excluded: false })
    expect(rules.A).toEqual({ canonical_value: 'C', is_excluded: false })
  })

  it('cieľ, ktorý je sám zlúčený, sa nahradí konečným názvom', () => {
    const values = [v('X'), v('B', { canonical_value: 'C', is_excluded: false }), v('C')]
    expect(planMerge(values, ['X'], 'B')).toEqual([
      { raw_value: 'X', before: null, rule: { canonical_value: 'C', is_excluded: false } },
    ])
  })

  it('hodnota rovnaká ako cieľ nedostane pravidlo na seba a vyradený variant zostane vyradený', () => {
    const values = [v('Čašník'), v('čašník'), v('Čašnik', { canonical_value: 'čašník', is_excluded: true })]
    const changes = planMerge(values, ['Čašník', 'čašník'], 'Čašník')
    const rules = Object.fromEntries(changes.map((c) => [c.raw_value, c.rule]))
    expect(rules['Čašník']).toBeUndefined()
    expect(rules['čašník']).toEqual({ canonical_value: 'Čašník', is_excluded: false })
    expect(rules['Čašnik']).toEqual({ canonical_value: 'Čašník', is_excluded: true })
  })
})

describe('planExclude', () => {
  const values = [v('C'), v('A', { canonical_value: 'C', is_excluded: false }), v('D')]

  it('s variantmi vyradí aj hodnoty zlúčené pod vyraďovaným názvom', () => {
    expect(variantsOf(values, ['C'])).toEqual(['A'])
    const raws = planExclude(values, ['C'], { withVariants: true }).map((c) => c.raw_value).sort()
    expect(raws).toEqual(['A', 'C'])
  })

  it('bez variantov vyradí len vybrané a ponechá zlúčenie', () => {
    const changes = planExclude(values, ['A'], { withVariants: false })
    expect(changes).toEqual([
      { raw_value: 'A', before: { canonical_value: 'C', is_excluded: false }, rule: { canonical_value: 'C', is_excluded: true } },
    ])
  })
})

describe('krok späť', () => {
  it('invertChanges vráti pôvodné pravidlá vrátane zrušených', () => {
    const values = [v('A', { canonical_value: 'B', is_excluded: false }), v('B')]
    const clear = planClear(values, ['A', 'B'])
    expect(clear).toEqual([{ raw_value: 'A', before: { canonical_value: 'B', is_excluded: false }, rule: null }])
    expect(invertChanges(clear)).toEqual([{ raw_value: 'A', before: null, rule: { canonical_value: 'B', is_excluded: false } }])
  })
})
