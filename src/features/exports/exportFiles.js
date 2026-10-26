// Tvorba exportných súborov. Ťažké knižnice (SheetJS, PptxGenJS) sa
// načítavajú až pri prvom exporte, aby nespomaľovali otvorenie aplikácie.

import { AppError } from '../../api/backend.js'
import { getPhotoUrl } from '../../api/photos.js'
import { formatAge, formatDate } from '../../lib/format.js'
import { COLUMNS, allowedColumns, cellText } from '../selections/columns.js'

// Každá exportná funkcia si oprávnenie overí sama — nespoliehame sa len na skryté tlačidlo.
export function assertCanExport(permissions) {
  if (!permissions?.canExport) throw new AppError('Na export nemáte oprávnenie.', 'forbidden')
}

export function safeFileName(name, ext) {
  const base = String(name || 'vyber')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'vyber'
  const date = new Date().toISOString().slice(0, 10)
  return `${base}-${date}.${ext}`
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function tableData(rows, columns, permissions) {
  const cols = allowedColumns(columns, permissions.canSeeContacts)
  return {
    header: cols.map((k) => COLUMNS[k].label),
    body: rows.map((r) => cols.map((k) => cellText(k, r))),
  }
}

// ---------------------------------------------------------------------
// Pre produkciu: CSV a XLSX
// ---------------------------------------------------------------------

// Ochrana pred CSV injection: Excel by bunku začínajúcu =, @, +, -, tabulátorom
// alebo CR vyhodnotil ako vzorec. Takú bunku prefixneme apostrofom.
// + a - necháme len pri telefónoch a číslach (+421 900 …, -5).
const NUMBER_LIKE = /^[+-]?[\d\s()./-]+$/
export function neutralizeFormula(value) {
  const s = String(value ?? '')
  if (/^[=@\t\r]/.test(s)) return `'${s}`
  if (/^[+-]/.test(s) && !NUMBER_LIKE.test(s)) return `'${s}`
  return s
}

function csvEscape(value) {
  const s = neutralizeFormula(value)
  return /[";\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Oddeľovač bodkočiarka a BOM — slovenský Excel tak otvorí súbor správne aj s diakritikou.
export function downloadCsv(rows, columns, permissions, fileName) {
  assertCanExport(permissions)
  const { header, body } = tableData(rows, columns, permissions)
  const lines = [header, ...body].map((line) => line.map(csvEscape).join(';'))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, fileName)
}

export async function downloadXlsx(rows, columns, permissions, fileName, sheetName = 'Výber') {
  assertCanExport(permissions)
  const XLSX = await import('xlsx')
  const { header, body } = tableData(rows, columns, permissions)
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body])
  sheet['!cols'] = header.map((h, i) => ({
    wch: Math.min(50, Math.max(h.length, ...body.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2),
  }))
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
  XLSX.writeFile(book, fileName, { compression: true })
}

// ---------------------------------------------------------------------
// Pre komunikáciu: schránka
// ---------------------------------------------------------------------

// kind: 'names' | 'emails' | 'phones'  → { copied, missing }
export async function copyToClipboard(kind, rows, permissions) {
  assertCanExport(permissions)
  if (kind !== 'names' && !permissions.canSeeContacts) throw new AppError('Na kontakty nemáte oprávnenie.', 'forbidden')
  let values
  let separator = '\n'
  if (kind === 'names') values = rows.map((r) => r.name)
  else if (kind === 'emails') {
    values = rows.map((r) => r.email).filter(Boolean)
    separator = '; '
  } else values = rows.map((r) => r.phone).filter(Boolean)
  await navigator.clipboard.writeText(values.join(separator))
  return { copied: values.length, missing: rows.length - values.length }
}

// ---------------------------------------------------------------------
// Pre réžiu: obrázky
// ---------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Obrázok sa nepodarilo načítať.'))
    img.src = src
  })
}

// Vráti fotku ako JPEG data URL (do PPTX), zmenšenú na maxEdge.
async function photoAsDataUrl(path, maxEdge = 800) {
  if (!path) return null
  try {
    const url = await getPhotoUrl(path)
    if (!url) return null
    const img = await loadImage(url)
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || maxEdge, img.naturalHeight || maxEdge))
    const w = Math.max(1, Math.round((img.naturalWidth || 300) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 400) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { data: canvas.toDataURL('image/jpeg', 0.85), w, h }
  } catch {
    return null
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// Údaje na karte osoby v PDF/PPTX.
export function cardLines(row, { showContacts }) {
  const p = row.person
  const lines = [
    [formatAge(p.age), p.gender].filter(Boolean).join(', '),
    [p.height_cm && `${p.height_cm} cm`, p.clothing_size && `konf. ${p.clothing_size}`, p.shoe_size && `top. ${p.shoe_size}`].filter(Boolean).join(' · '),
    p.city || '',
  ]
  const flags = [p.period_look && 'dobový vzhľad', p.speaking_role && 'textujúci', p.has_tattoos && 'tetovanie'].filter(Boolean)
  if (flags.length) lines.push(flags.join(', '))
  if (showContacts) lines.push([row.phone, row.email].filter(Boolean).join(' · '))
  return lines.filter(Boolean)
}

// opts: { title, subtitle, showContacts, perSlide: 1|2|4|6 }
export async function downloadPptx(rows, permissions, opts, fileName, onProgress) {
  assertCanExport(permissions)
  const showContacts = !!opts.showContacts && permissions.canSeeContacts
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 × 7.5 palca
  pptx.title = opts.title || 'Výber'

  let done = 0
  const photos = await mapLimit(rows, 6, async (r) => {
    // Hlavná fotka 1600 px; ak chýba, náhľad 400 px.
    const res = (await photoAsDataUrl(r.person.photo_path, 1200)) || (await photoAsDataUrl(r.person.thumb_path))
    onProgress?.(++done, rows.length)
    return res
  })

  const title = pptx.addSlide()
  title.background = { color: 'FFFFFF' }
  title.addText(opts.title || 'Výber', { x: 0.8, y: 2.6, w: 11.7, h: 1, fontSize: 40, bold: true, color: '1C1917', fontFace: 'Georgia' })
  if (opts.subtitle) title.addText(opts.subtitle, { x: 0.8, y: 3.6, w: 11.7, h: 0.6, fontSize: 20, color: '57534E' })
  title.addText(`${rows.length} ${rows.length === 1 ? 'osoba' : rows.length < 5 ? 'osoby' : 'osôb'} · ${formatDate(new Date())}`, {
    x: 0.8, y: 4.3, w: 11.7, h: 0.4, fontSize: 14, color: '78716C',
  })

  const perSlide = [1, 2, 4, 6].includes(opts.perSlide) ? opts.perSlide : 4
  const cols = perSlide === 1 ? 1 : perSlide === 2 ? 2 : perSlide === 4 ? 4 : 3
  const rowsPerSlide = perSlide === 6 ? 2 : 1
  const slideW = 13.33
  const margin = 0.5
  const gap = 0.3
  const cellW = (slideW - margin * 2 - gap * (cols - 1)) / cols
  const cellH = (7.5 - 1.0 - margin - gap * (rowsPerSlide - 1)) / rowsPerSlide

  for (let i = 0; i < rows.length; i += perSlide) {
    const slide = pptx.addSlide()
    slide.addText([opts.title, opts.subtitle].filter(Boolean).join(' — ') || 'Výber', {
      x: margin, y: 0.2, w: slideW - margin * 2, h: 0.4, fontSize: 12, color: '78716C',
    })
    rows.slice(i, i + perSlide).forEach((r, j) => {
      const cx = margin + (j % cols) * (cellW + gap)
      const cy = 0.8 + Math.floor(j / cols) * (cellH + gap)
      const photo = photos[i + j]
      const textH = perSlide === 1 ? 0 : Math.min(1.9, cellH * 0.42)
      const photoBoxW = perSlide === 1 ? cellW * 0.42 : cellW
      const photoBoxH = perSlide === 1 ? cellH : cellH - textH - 0.1
      if (photo) {
        const ratio = photo.w / photo.h
        let w = photoBoxW
        let h = w / ratio
        if (h > photoBoxH) {
          h = photoBoxH
          w = h * ratio
        }
        slide.addImage({ data: photo.data, x: cx + (photoBoxW - w) / 2, y: cy, w, h })
      } else {
        slide.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: photoBoxW, h: photoBoxH, fill: { color: 'F5F5F4' }, line: { color: 'E7E5E4' } })
        slide.addText('bez fotky', { x: cx, y: cy + photoBoxH / 2 - 0.2, w: photoBoxW, h: 0.4, align: 'center', fontSize: 10, color: 'A8A29E' })
      }
      const textX = perSlide === 1 ? cx + photoBoxW + 0.4 : cx
      const textY = perSlide === 1 ? cy + 0.3 : cy + photoBoxH + 0.1
      const textW = perSlide === 1 ? cellW - photoBoxW - 0.4 : cellW
      const big = perSlide <= 2
      const parts = [
        { text: r.name, options: { bold: true, fontSize: big ? 24 : 13, color: '1C1917', breakLine: true } },
        ...cardLines(r, { showContacts }).map((t) => ({ text: t, options: { fontSize: big ? 16 : 10, color: '44403C', breakLine: true } })),
      ]
      if (r.note) parts.push({ text: r.note, options: { fontSize: big ? 14 : 9, italic: true, color: '92400E', breakLine: true } })
      slide.addText(parts, { x: textX, y: textY, w: textW, h: perSlide === 1 ? cellH - 0.6 : textH, valign: 'top', margin: 0 })
    })
  }

  await pptx.writeFile({ fileName })
}

// ---------------------------------------------------------------------
// PDF cez tlač prehliadača
// ---------------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// Okno sa otvorí hneď pri kliknutí (inak ho prehliadač zablokuje) a naplní sa po načítaní fotiek.
export async function printPdf(rows, permissions, opts, onProgress) {
  assertCanExport(permissions)
  const showContacts = !!opts.showContacts && permissions.canSeeContacts
  const win = window.open('', '_blank')
  if (!win) throw new AppError('Prehliadač zablokoval nové okno. Povoľte vyskakovacie okná pre túto stránku.', 'popup')
  win.document.write('<!doctype html><title>Pripravujem…</title><p style="font-family:sans-serif;padding:2rem">Pripravujem PDF…</p>')

  let done = 0
  const urls = await mapLimit(rows, 12, async (r) => {
    const url =
      (r.person.photo_path ? await getPhotoUrl(r.person.photo_path) : null) ||
      (r.person.thumb_path ? await getPhotoUrl(r.person.thumb_path) : null)
    onProgress?.(++done, rows.length)
    return url
  })

  const cards = rows
    .map((r, i) => {
      const lines = cardLines(r, { showContacts }).map((l) => `<div class="l">${escapeHtml(l)}</div>`).join('')
      const img = urls[i] ? `<img src="${escapeHtml(urls[i])}" alt="">` : '<div class="nophoto">bez fotky</div>'
      const note = r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ''
      return `<div class="card"><div class="ph">${img}</div><div class="n">${escapeHtml(r.name)}</div>${lines}${note}</div>`
    })
    .join('')

  const html = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><title>${escapeHtml(opts.title || 'Výber')}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1917; margin: 0; }
header { border-bottom: 1px solid #d6d3d1; margin-bottom: 6mm; padding-bottom: 3mm; }
h1 { font-family: Georgia, serif; font-size: 20pt; margin: 0; }
.sub { color: #57534e; font-size: 11pt; margin-top: 1mm; }
.meta { color: #a8a29e; font-size: 8pt; margin-top: 1mm; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
.card { break-inside: avoid; page-break-inside: avoid; font-size: 8.5pt; line-height: 1.3; }
.ph { aspect-ratio: 3 / 4; background: #f5f5f4; border-radius: 2mm; overflow: hidden; margin-bottom: 1.5mm; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nophoto { display: flex; align-items: center; justify-content: center; height: 100%; color: #a8a29e; }
.n { font-weight: 700; font-size: 10pt; }
.l { color: #44403c; }
.note { color: #92400e; font-style: italic; margin-top: 1mm; }
.toolbar { position: sticky; top: 0; background: #fffbeb; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #fde68a; }
@media print { .toolbar { display: none; } }
</style></head><body>
<div class="toolbar">Náhľad tlače — v dialógu tlače zvoľte <b>Uložiť ako PDF</b>. <button onclick="window.print()">Tlačiť / uložiť PDF</button></div>
<header><h1>${escapeHtml(opts.title || 'Výber')}</h1>${opts.subtitle ? `<div class="sub">${escapeHtml(opts.subtitle)}</div>` : ''}
<div class="meta">${rows.length} osôb · ${escapeHtml(formatDate(new Date()))}${showContacts ? ' · obsahuje kontaktné údaje — nešíriť' : ''}</div></header>
<div class="grid">${cards}</div>
</body></html>`

  win.document.open()
  win.document.write(html)
  win.document.close()

  // Počkáme na fotky, potom otvoríme tlač.
  const images = [...win.document.images]
  await Promise.race([
    Promise.all(images.map((img) => (img.complete ? null : new Promise((res) => {
      img.onload = res
      img.onerror = res
    })))),
    new Promise((res) => setTimeout(res, 8000)),
  ])
  win.focus()
  win.print()
}
