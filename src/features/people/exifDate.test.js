import { describe, expect, it } from 'vitest'
import { exifToIsoDate, parseExifDate } from './exifDate.js'

// Poskladá minimálny JPEG so segmentom APP1/Exif.
// tags: { ifd0: [[tag, ascii]], exif: [[tag, ascii]] }
function buildJpeg({ ifd0 = [], exif = [], littleEndian = true }) {
  const tiff = []
  const le = littleEndian
  const u16 = (v) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
  const u32 = (v) => (le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])

  const ifd0Entries = ifd0.length + (exif.length ? 1 : 0)
  const ifd0Size = 2 + ifd0Entries * 12 + 4
  const exifSize = exif.length ? 2 + exif.length * 12 + 4 : 0
  let dataOffset = 8 + ifd0Size + exifSize
  const data = []

  const entry = (tag, text) => {
    const bytes = [...text].map((c) => c.charCodeAt(0)).concat(0)
    const e = [...u16(tag), ...u16(2), ...u32(bytes.length), ...u32(dataOffset)]
    data.push(...bytes)
    dataOffset += bytes.length
    return e
  }

  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  tiff.push(...u16(ifd0Entries))
  for (const [tag, text] of ifd0) tiff.push(...entry(tag, text))
  if (exif.length) tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(8 + ifd0Size))
  tiff.push(...u32(0))
  if (exif.length) {
    tiff.push(...u16(exif.length))
    for (const [tag, text] of exif) tiff.push(...entry(tag, text))
    tiff.push(...u32(0))
  }
  tiff.push(...data)

  const app1Len = 2 + 6 + tiff.length
  const bytes = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9]
  return new DataView(new Uint8Array(bytes).buffer)
}

describe('parseExifDate', () => {
  it('prečíta DateTimeOriginal (little endian)', () => {
    expect(parseExifDate(buildJpeg({ exif: [[0x9003, '2023:07:14 10:22:01']] }))).toBe('2023-07-14')
  })

  it('prečíta DateTimeOriginal (big endian)', () => {
    expect(parseExifDate(buildJpeg({ exif: [[0x9003, '2021:01:02 08:00:00']], littleEndian: false }))).toBe('2021-01-02')
  })

  it('uprednostní DateTimeOriginal pred DateTime v IFD0', () => {
    const view = buildJpeg({ ifd0: [[0x0132, '2024:12:24 09:00:00']], exif: [[0x9003, '2019:03:03 03:03:03']] })
    expect(parseExifDate(view)).toBe('2019-03-03')
  })

  it('použije DateTime, ak chýba Exif IFD', () => {
    expect(parseExifDate(buildJpeg({ ifd0: [[0x0132, '2022:11:30 12:00:00']] }))).toBe('2022-11-30')
  })

  it('pri súbore bez EXIF alebo inom formáte vráti null', () => {
    expect(parseExifDate(new DataView(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer))).toBeNull()
    expect(parseExifDate(new DataView(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer))).toBeNull()
    expect(parseExifDate(new DataView(new ArrayBuffer(0)))).toBeNull()
  })

  it('poškodený segment nevyhodí výnimku', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49])
    expect(parseExifDate(new DataView(bytes.buffer))).toBeNull()
  })
})

describe('exifToIsoDate', () => {
  const today = new Date('2026-10-26T12:00:00Z')
  it('zahodí nulový, neplatný a budúci dátum', () => {
    expect(exifToIsoDate('0000:00:00 00:00:00', today)).toBeNull()
    expect(exifToIsoDate('2023:02:30 10:00:00', today)).toBeNull()
    expect(exifToIsoDate('2027:01:01 10:00:00', today)).toBeNull()
    expect(exifToIsoDate('', today)).toBeNull()
  })
  it('prevedie platný dátum', () => {
    expect(exifToIsoDate('2026:10:25 23:59:59', today)).toBe('2026-10-25')
  })
})
