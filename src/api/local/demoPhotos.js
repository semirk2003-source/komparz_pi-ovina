// Demo „fotografie": vygenerované siluety, aby zoznam vyzeral realisticky
// bez skutočných fotiek. Fotky nahraté v demo režime sa držia v pamäti
// a v sessionStorage ako data URL.

const PALETTE = ['#c7d2fe', '#fbcfe8', '#bbf7d0', '#fde68a', '#bae6fd', '#ddd6fe', '#fecaca', '#d9f99d']
const memo = new Map()
const uploads = new Map()

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function demoPhotoDataUrl(path) {
  const hit = memo.get(path)
  if (hit) return hit
  const h = hash(path)
  const bg = PALETTE[h % PALETTE.length]
  const fg = PALETTE[(h >> 3) % PALETTE.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${bg}"/><circle cx="150" cy="${150 + (h % 20)}" r="${62 + (h % 14)}" fill="${fg}" opacity="0.9"/><path d="M40 400c0-${95 + (h % 30)} 50-150 110-150s110 55 110 150z" fill="${fg}" opacity="0.9"/></svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  memo.set(path, url)
  return url
}

export function putDemoUpload(path, dataUrl) {
  uploads.set(path, dataUrl)
  try {
    sessionStorage.setItem(`komparz-demo-photo:${path}`, dataUrl)
  } catch {
    // plné úložisko — fotka ostane len do obnovenia stránky
  }
}

export function getDemoUpload(path) {
  if (uploads.has(path)) return uploads.get(path)
  try {
    const v = sessionStorage.getItem(`komparz-demo-photo:${path}`)
    if (v) uploads.set(path, v)
    return v
  } catch {
    return null
  }
}

export function removeDemoUpload(path) {
  uploads.delete(path)
  try {
    sessionStorage.removeItem(`komparz-demo-photo:${path}`)
  } catch {
    // nič
  }
}
