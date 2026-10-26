// Dátum nafotenia z EXIF (JPEG, segment APP1). Malý vlastný parser —
// číta len DateTimeOriginal / DateTimeDigitized / DateTime, nič iné.
// Musí sa prečítať PRED prekreslením cez canvas, ktoré metadáta odstráni.

const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004
const TAG_DATETIME = 0x0132
const TYPE_ASCII = 2

// Vráti 'YYYY-MM-DD' alebo null. Nikdy nevyhodí výnimku.
export async function readExifDate(file) {
  if (!file) return null
  const looksJpeg = /jpe?g/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '')
  if (!looksJpeg) return null
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer()
    return parseExifDate(new DataView(buffer))
  } catch {
    return null
  }
}

export function parseExifDate(view) {
  try {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return null
      const marker = view.getUint8(offset + 1)
      if (marker === 0xd9 || marker === 0xda) return null // koniec obrázka / začiatok dát
      const length = view.getUint16(offset + 2)
      const isExif =
        marker === 0xe1 &&
        offset + 10 <= view.byteLength &&
        view.getUint32(offset + 4) === 0x45786966 && // "Exif"
        view.getUint16(offset + 8) === 0
      if (isExif) return parseTiff(view, offset + 10, Math.min(view.byteLength, offset + 2 + length))
      offset += 2 + length
    }
  } catch {
    // poškodený súbor
  }
  return null
}

function parseTiff(view, start, end) {
  const order = view.getUint16(start)
  const le = order === 0x4949
  if (!le && order !== 0x4d4d) return null
  const u16 = (o) => view.getUint16(o, le)
  const u32 = (o) => view.getUint32(o, le)
  if (u16(start + 2) !== 42) return null

  const readIfd = (ifdOffset) => {
    const abs = start + ifdOffset
    if (abs + 2 > end) return null
    const count = u16(abs)
    const tags = new Map()
    for (let i = 0; i < count; i++) {
      const entry = abs + 2 + i * 12
      if (entry + 12 > end) break
      tags.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), valueAt: entry + 8 })
    }
    return tags
  }

  const readAscii = (tag) => {
    if (!tag || tag.type !== TYPE_ASCII) return null
    const at = tag.count > 4 ? start + u32(tag.valueAt) : tag.valueAt
    if (at + tag.count > end) return null
    let text = ''
    for (let i = 0; i < tag.count; i++) {
      const c = view.getUint8(at + i)
      if (c === 0) break
      text += String.fromCharCode(c)
    }
    return text
  }

  const ifd0 = readIfd(u32(start + 4))
  if (!ifd0) return null
  let raw = null
  const exifPointer = ifd0.get(TAG_EXIF_IFD)
  if (exifPointer) {
    const exif = readIfd(u32(exifPointer.valueAt))
    raw = readAscii(exif?.get(TAG_DATETIME_ORIGINAL)) || readAscii(exif?.get(TAG_DATETIME_DIGITIZED))
  }
  return exifToIsoDate(raw || readAscii(ifd0.get(TAG_DATETIME)))
}

// '2024:05:17 14:03:22' → '2024-05-17'. Nezmyselné a budúce dátumy zahodí.
export function exifToIsoDate(raw, today = new Date()) {
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw || '')
  if (!m) return null
  const [, y, mo, d] = m
  if (Number(y) < 1990) return null
  const iso = `${y}-${mo}-${d}`
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null
  if (date.getTime() > today.getTime()) return null
  return iso
}
