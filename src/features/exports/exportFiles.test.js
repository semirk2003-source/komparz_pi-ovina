import { describe, expect, it } from 'vitest'
import { neutralizeFormula, safeFileName } from './exportFiles.js'

describe('neutralizeFormula', () => {
  it('prefixne bunky, ktoré by Excel vyhodnotil ako vzorec', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1")
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(neutralizeFormula('\tx')).toBe("'\tx")
    expect(neutralizeFormula('\rx')).toBe("'\rx")
    expect(neutralizeFormula('+cmd|x')).toBe("'+cmd|x")
    expect(neutralizeFormula('-2+3*cmd')).toBe("'-2+3*cmd")
  })

  it('nechá telefóny, čísla a bežný text bez zmeny', () => {
    expect(neutralizeFormula('+421 900 123 456')).toBe('+421 900 123 456')
    expect(neutralizeFormula('-5')).toBe('-5')
    expect(neutralizeFormula('Ján Novák')).toBe('Ján Novák')
    expect(neutralizeFormula(null)).toBe('')
  })
})

describe('safeFileName', () => {
  it('odstráni diakritiku a nebezpečné znaky', () => {
    expect(safeFileName('Rýchly prachy – klub 19. 8.', 'csv')).toMatch(/^rychly-prachy-klub-19-8-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
