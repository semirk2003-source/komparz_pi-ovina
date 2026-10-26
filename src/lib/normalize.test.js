import { describe, expect, it } from 'vitest'
import {
  normalizeClothingSize, normalizeEmail, normalizeGender, normalizePhone, normalizeRegion,
  parseBirthDate, parseBool, parseHeight, parseShoeSize, splitName,
} from './normalize.js'

const TODAY = new Date(2026, 9, 26)

describe('splitName', () => {
  it('delí podľa poslednej medzery a presúva zátvorku do poznámky', () => {
    expect(splitName('Anna Mária Nováková (tetovanie na krku)')).toEqual({
      value: { first_name: 'Anna Mária', last_name: 'Nováková' },
      note: 'tetovanie na krku',
    })
  })
  it('odmietne e-mail alebo telefón v mene', () => {
    expect(splitName('jan@x.sk 0905 123 456').error).toBeTruthy()
  })
  it('upozorní na jednoslovné meno', () => {
    expect(splitName('Madonna').warning).toMatch(/Jednoslovné/)
  })
})

describe('hodnoty profilu', () => {
  it('pohlavie', () => {
    expect(normalizeGender('ž').value).toBe('Žena')
    expect(normalizeGender('MUŽ').value).toBe('Muž')
    expect(normalizeGender('nebinárne').value).toBe('Iné')
    expect(normalizeGender('').value).toBeNull()
  })
  it('veľkosti', () => {
    expect(parseShoeSize('42-43').value).toBe(42)
    expect(parseShoeSize('asi 42').value).toBe(42)
    expect(parseShoeSize('70').error).toBeTruthy()
    expect(parseHeight('178 cm').value).toBe(178)
    expect(parseHeight('1,65').value).toBe(165)
    expect(normalizeClothingSize('2XL').value).toBe('XXL')
    expect(normalizeClothingSize('M/L').value).toBe('M')
    expect(normalizeClothingSize('122').value).toBe('Iné/detské')
  })
  it('región', () => {
    expect(normalizeRegion('Bratislavský kraj').value).toBe('Západné Slovensko')
    expect(normalizeRegion('Banskobystrický').value).toBe('Stredné Slovensko')
    expect(normalizeRegion('', 'Banská Štiavnica').value).toBe('Stredné Slovensko')
    expect(normalizeRegion('Prešovský kraj').value).toBe('Východné Slovensko')
    expect(normalizeRegion('', 'Brno').value).toBe('Česko')
    expect(normalizeRegion('', '').value).toBe('Iné / neuvedené')
  })
  it.each([
    ['Bratislavský', 'Bratislava', 'Západné Slovensko'],
    ['Trnavský', 'Trnava', 'Západné Slovensko'],
    ['Nitriansky', 'Nitra', 'Západné Slovensko'],
    ['Trenčiansky', 'Trenčín', 'Západné Slovensko'],
    ['Žilinský', 'Žilina', 'Stredné Slovensko'],
    ['Banskobystrický', 'Banská Bystrica', 'Stredné Slovensko'],
    ['Košický', 'Košice', 'Východné Slovensko'],
    ['Prešovský', 'Prešov', 'Východné Slovensko'],
  ])('kraj %s / krajské mesto %s → %s', (adj, city, expected) => {
    expect(normalizeRegion(`${adj} kraj`).value).toBe(expected)
    expect(normalizeRegion(adj).value).toBe(expected)
    expect(normalizeRegion('', city).value).toBe(expected)
  })
  it('meno v tvare „Priezvisko, Meno"', () => {
    expect(splitName('Novák, Ján').value).toEqual({ first_name: 'Ján', last_name: 'Novák' })
    expect(splitName('Kováčová, Mária Anna (dieťa 4 r.)')).toMatchObject({
      value: { first_name: 'Mária Anna', last_name: 'Kováčová' },
      note: 'dieťa 4 r.',
    })
    expect(splitName('A, B, C').error).toBeTruthy()
  })
  it('dátum z Excelu (Date o miestnej polnoci) zachová kalendárny deň', () => {
    expect(parseBirthDate(new Date(1990, 4, 5), TODAY)).toEqual({ value: '1990-05-05', approx: false })
    expect(parseBirthDate(new Date(2030, 0, 1), TODAY).error).toBeTruthy()
  })
  it('neznáma hodnota áno/nie nie je áno', () => {
    expect(parseBool('neviem')).toMatchObject({ value: null })
    expect(parseBool('neviem').warning).toBeTruthy()
  })
  it('dátum narodenia', () => {
    expect(parseBirthDate('5.3.1990', TODAY)).toEqual({ value: '1990-03-05', approx: false })
    expect(parseBirthDate('1990-03-05', TODAY).value).toBe('1990-03-05')
    expect(parseBirthDate('32937', TODAY).value).toBe('1990-03-05')
    expect(parseBirthDate('35', TODAY)).toMatchObject({ value: '1991-01-01', approx: true })
    expect(parseBirthDate('31.2.1990', TODAY).error).toBeTruthy()
    expect(parseBirthDate('1.1.2030', TODAY).error).toBeTruthy()
  })
  it('kontakty a áno/nie', () => {
    expect(normalizePhone('0905 123 456').value).toBe('+421905123456')
    expect(normalizePhone('00420 777 123 456').value).toBe('+420777123456')
    expect(normalizeEmail(' Jan@X.SK ').value).toBe('jan@x.sk')
    expect(normalizeEmail('zly-mail').error).toBeTruthy()
    expect(parseBool('áno').value).toBe(true)
    expect(parseBool('x').value).toBe(true)
    expect(parseBool('nie').value).toBe(false)
  })
})
