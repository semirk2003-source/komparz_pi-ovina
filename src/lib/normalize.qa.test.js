// Nezávislé kontrolné testy (QA) čistenia importu podľa špecifikácie, kapitola 5.2.
// Testy označené „Regresia" strážia chyby nájdené pri revízii, ktoré sú už opravené.
import { describe, expect, it } from 'vitest'
import {
  normalizeClothingSize, normalizeEmail, normalizeGender, normalizePhone, normalizeRegion,
  parseBirthDate, parseBool, parseHeight, parseShoeSize, splitName,
} from './normalize.js'

const today = new Date(2026, 9, 26)

describe('meno (rozdelenie podľa poslednej medzery)', () => {
  it('rozdelí meno a priezvisko, viacslovné krstné meno ponechá spolu', () => {
    expect(splitName('Ján Novák').value).toEqual({ first_name: 'Ján', last_name: 'Novák' })
    expect(splitName('Mária Anna Kováčová').value).toEqual({ first_name: 'Mária Anna', last_name: 'Kováčová' })
  })

  it('poznámku v zátvorke presunie do poznámky, nie do priezviska', () => {
    const r = splitName('Ján Novák (tetovanie na krku)')
    expect(r.value).toEqual({ first_name: 'Ján', last_name: 'Novák' })
    expect(r.note).toBe('tetovanie na krku')
  })

  it('e-mail alebo telefón v poli pre meno je chyba, nie meno', () => {
    expect(splitName('jan@x.sk 0905123456').error).toBeTruthy()
    expect(splitName('0905 123 456').error).toBeTruthy()
  })

  it('jednoslovné a podozrivo dlhé meno označí na kontrolu', () => {
    expect(splitName('Novák').warning).toBeTruthy()
    expect(splitName(`Ján ${'Dlhé'.repeat(12)}`).warning).toBeTruthy()
  })

  it('prázdne meno je chyba', () => {
    expect(splitName('   ').error).toBeTruthy()
  })

  // Regresia: formát „Priezvisko, Meno" (bežný v Exceli) sa delil naopak a čiarka
  // zostávala v krstnom mene.
  it('„Priezvisko, Meno" rozdelí správne (alebo aspoň varuje)', () => {
    const r = splitName('Novák, Ján')
    const correct = r.value?.first_name === 'Ján' && r.value?.last_name === 'Novák'
    expect(correct || Boolean(r.warning)).toBe(true)
  })
})

describe('pohlavie → Žena / Muž / Iné', () => {
  it.each([
    ['Žena', 'Žena'], ['žena', 'Žena'], ['Z', 'Žena'], ['F', 'Žena'],
    ['Muž', 'Muž'], ['muz', 'Muž'], ['M', 'Muž'],
    ['Iné', 'Iné'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeGender(raw).value).toBe(expected)
  })

  it('neznáma hodnota → Iné s varovaním, prázdna → null', () => {
    expect(normalizeGender('???')).toMatchObject({ value: 'Iné' })
    expect(normalizeGender('???').warning).toBeTruthy()
    expect(normalizeGender('').value).toBeNull()
  })
})

describe('veľkosti', () => {
  it('topánky: z „42-43" prvé číslo, polovičné čísla, rozsah', () => {
    expect(parseShoeSize('42-43').value).toBe(42)
    expect(parseShoeSize('asi 42').value).toBe(42)
    expect(parseShoeSize('42,5').value).toBe(42.5)
    expect(parseShoeSize('42').warning).toBeUndefined()
    expect(parseShoeSize('99').error).toBeTruthy()
    expect(parseShoeSize('veľké').error).toBeTruthy()
  })

  it('výška: z „178 cm" číslo, metre na centimetre, rozsah', () => {
    expect(parseHeight('178 cm').value).toBe(178)
    expect(parseHeight('1,78').value).toBe(178)
    expect(parseHeight('1.78 m').value).toBe(178)
    expect(parseHeight('500').error).toBeTruthy()
  })

  it('konfekcia: XS až XXXL alebo Iné/detské', () => {
    expect(normalizeClothingSize('m').value).toBe('M')
    expect(normalizeClothingSize('2XL').value).toBe('XXL')
    expect(normalizeClothingSize('M-L').value).toBe('M')
    expect(normalizeClothingSize('164').value).toBe('Iné/detské')
    expect(normalizeClothingSize('').value).toBeNull()
  })
})

describe('región → štyri hodnoty filtra', () => {
  it.each([
    ['Bratislavský kraj', 'Západné Slovensko'],
    ['Trnavský', 'Západné Slovensko'],
    ['Nitriansky', 'Západné Slovensko'],
    ['Žilinský kraj', 'Stredné Slovensko'],
    ['Banskobystrický', 'Stredné Slovensko'],
    ['Košický', 'Východné Slovensko'],
    ['Prešovský kraj', 'Východné Slovensko'],
    ['Česko', 'Česko'],
  ])('kraj %s → %s', (raw, expected) => {
    expect(normalizeRegion(raw).value).toBe(expected)
  })

  it.each([
    ['Bratislava', 'Západné Slovensko'],
    ['Považská Bystrica', 'Západné Slovensko'],
    ['Banská Bystrica', 'Stredné Slovensko'],
    ['Žilina', 'Stredné Slovensko'],
    ['Brezno', 'Stredné Slovensko'],
    ['Košice', 'Východné Slovensko'],
    ['Brno', 'Česko'],
    ['Praha', 'Česko'],
  ])('mesto %s → %s', (city, expected) => {
    expect(normalizeRegion('', city).value).toBe(expected)
  })

  it('nič → Iné / neuvedené bez varovania; nezmysel → s varovaním', () => {
    expect(normalizeRegion('', '')).toEqual({ value: 'Iné / neuvedené' })
    expect(normalizeRegion('Atlantída').warning).toBeTruthy()
  })

  // Regresia: „Trenčiansky" nezodpovedal kľúču 'trencin' a končil ako Iné / neuvedené.
  // To isté pravidlo je zrkadlené v SQL (040_migration.sql) — meniť spolu.
  it('kraj „Trenčiansky kraj" → Západné Slovensko', () => {
    expect(normalizeRegion('Trenčiansky kraj').value).toBe('Západné Slovensko')
  })
})

describe('dátum narodenia', () => {
  it.each([
    ['5.5.1990', '1990-05-05'],
    ['05. 05. 1990', '1990-05-05'],
    ['1990-05-05', '1990-05-05'],
    ['05/05/90', '1990-05-05'],
    ['05.05.20', '2020-05-05'],
    ['33000', '1990-05-07'],
  ])('%s → %s', (raw, expected) => {
    expect(parseBirthDate(raw, today)).toMatchObject({ value: expected, approx: false })
  })

  it('len vek alebo rok → približný dátum s varovaním', () => {
    expect(parseBirthDate('35', today)).toMatchObject({ value: '1991-01-01', approx: true })
    expect(parseBirthDate('35', today).warning).toBeTruthy()
    expect(parseBirthDate('1990', today)).toMatchObject({ value: '1990-01-01', approx: true })
  })

  it('neexistujúci a budúci dátum je chyba, nie tichá oprava', () => {
    expect(parseBirthDate('31.2.1990', today).error).toBeTruthy()
    expect(parseBirthDate('1.1.2030', today).error).toBeTruthy()
    expect(parseBirthDate('', today).value).toBeNull()
  })

  // Regresia: import XLSX (cellDates: true) dáva Date o polnoci miestneho času;
  // prevod cez UTC posúval na Slovensku každý dátum narodenia o deň skôr.
  it('Date z Excelu (miestna polnoc) zachová kalendárny deň', () => {
    expect(parseBirthDate(new Date(1990, 4, 5), today).value).toBe('1990-05-05')
  })
})

describe('kontakty', () => {
  it('telefón: odstráni medzery a doplní predvoľbu', () => {
    expect(normalizePhone('0905 123 456').value).toBe('+421905123456')
    expect(normalizePhone('+421 905 123 456').value).toBe('+421905123456')
    expect(normalizePhone('905123456').value).toBe('+421905123456')
    expect(normalizePhone('00420 601 123 456').value).toBe('+420601123456')
    expect(normalizePhone('12345').warning).toBeTruthy()
  })

  it('e-mail: malé písmená a kontrola tvaru', () => {
    expect(normalizeEmail(' Jan.Novak@Example.SK ').value).toBe('jan.novak@example.sk')
    expect(normalizeEmail('mailto:a@b.sk').value).toBe('a@b.sk')
    expect(normalizeEmail('jan(at)x.sk').error).toBeTruthy()
  })
})

describe('áno/nie', () => {
  it('bežné hodnoty', () => {
    expect(parseBool('áno').value).toBe(true)
    expect(parseBool('x').value).toBe(true)
    expect(parseBool('nie').value).toBe(false)
    // Prázdna bunka = bez hodnoty, aby „Aktualizovať" neprepísalo existujúci údaj (revízia fázy 3).
    expect(parseBool('').value).toBeNull()
  })

  // Regresia: neznáma hodnota (aj „neviem") sa ukladala ako áno, čo kazilo filtre
  // dobového vzhľadu a textujúcich.
  it('„neviem" sa neuloží ako áno', () => {
    expect(parseBool('neviem').value).not.toBe(true)
  })
})
