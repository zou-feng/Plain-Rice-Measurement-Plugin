// Measures the REAL rendered width of each tablet line by rasterising it and
// taking the ink (non-transparent) bounding box. This replaces the rough
// "0.62em per character" estimate that made fit checks unreliable.
// Needs `npm i -D sharp` (dev-only tool, not part of the plugin runtime).
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, 'lib', 'style.css'), 'utf8')
const screen = /\.dsh-pet-screen\s*\{([^}]*)\}/s.exec(css)[1]
const left = Number(/left:\s*([\d.]+)%/.exec(screen)[1])
const top = Number(/top:\s*([\d.]+)%/.exec(screen)[1])
const widthPct = Number(/width:\s*([\d.]+)%/.exec(screen)[1])
const heightPct = Number(/height:\s*([\d.]+)%/.exec(screen)[1])
const tilt = Number(/rotate\((-?[\d.]+)deg\)/.exec(screen)[1])

const nameCqw = Number(/\.dsh-pet-name\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const moneyCqw = Number(/\.dsh-pet-money\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const clockCqw = Number(/\.dsh-pet-clock\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])

/** Pull the first concrete family out of a rule's font-family list. */
function familyOf(rule) {
  const block = new RegExp('\\.dsh-pet-' + rule + '\\s*\\{([^}]*)\\}', 's').exec(css)
  if (!block) return 'sans-serif'
  const fam = /font-family:\s*([^;]+);/.exec(block[1])
  if (!fam) return 'sans-serif'
  const first = fam[1].split(',')[0].trim().replace(/^["']|["']$/g, '')
  return first
}
const nameFamily = familyOf('name')
const moneyFamily = familyOf('money')
const clockFamily = familyOf('clock')

const ART_W = 560
const cqw = (n) => (n / 100) * ART_W
const ns = cqw(nameCqw), ms = cqw(moneyCqw), cs = cqw(clockCqw)

// Measured glass (clean rotated rectangle).
const G = { cx: 455.5, cy: 278.3, w: 126.4, h: 78 }
const GAP_FACTOR = 0.16

async function inkBox(text, fontSize, family, weight) {
  const pad = 40
  const canvasW = Math.ceil(fontSize * 10) + pad * 2
  const canvasH = Math.ceil(fontSize * 3) + pad * 2
  const svg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
    <text x="${pad}" y="${pad + fontSize}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="#fff">${text}</text>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = data[(y * W + x) * C + 3]
    if (a > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  if (maxX < 0) return { w: 0, h: 0 }
  return { w: maxX - minX + 1, h: maxY - minY + 1 }
}

async function main() {
  const moneyText = '¥ 23.21'
  const nameText = '梁文谷'
  const clockText = '02:19:34'

  // Families come straight out of style.css, so the measurement reflects the
  // fonts actually configured rather than a hard-coded guess.
  const mBox = await inkBox(moneyText, ms, moneyFamily, 700)
  const nBox = await inkBox(nameText, ns, nameFamily, 700)
  const cBox = await inkBox(clockText, cs, clockFamily, 600)

  console.log('MEASURED INK (real rasterisation, not an estimate):')
  console.log(`  families: name="${nameFamily}"  money="${moneyFamily}"  clock="${clockFamily}"`)
  console.log(`  name   "${nameText}" @ ${ns.toFixed(1)}px -> ${nBox.w} x ${nBox.h} px`)
  console.log(`  money  "${moneyText}" @ ${ms.toFixed(1)}px -> ${mBox.w} x ${mBox.h} px`)
  console.log(`  clock  "${clockText}" @ ${cs.toFixed(1)}px -> ${cBox.w} x ${cBox.h} px`)

  const textW = Math.max(nBox.w, mBox.w, cBox.w)
  const gap = ms * GAP_FACTOR
  const textH = nBox.h + gap + mBox.h + gap + cBox.h
  console.log('')
  console.log(`  block  : ${textW} x ${textH.toFixed(1)} px   (widest line x stacked height)`)

  // Containment after rotation, expressed in the glass's own frame.
  const rad = tilt * Math.PI / 180
  const boxW = (widthPct / 100) * ART_W
  const boxH = (heightPct / 100) * 373
  const tcx = (left / 100) * ART_W + boxW / 2
  const tcy = (top / 100) * 373 + boxH / 2
  const corners = [[-textW / 2, -textH / 2], [textW / 2, -textH / 2], [textW / 2, textH / 2], [-textW / 2, textH / 2]]
  let worst = Infinity, side = ''
  for (const [x, y] of corners) {
    const rx = x * Math.cos(rad) - y * Math.sin(rad)
    const ry = x * Math.sin(rad) + y * Math.cos(rad)
    const dx = tcx + rx - G.cx, dy = tcy + ry - G.cy
    const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad)
    const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad)
    const mL = G.w / 2 - Math.abs(lx), mV = G.h / 2 - Math.abs(ly)
    if (mL < worst) { worst = mL; side = 'width' }
    if (mV < worst) { worst = mV; side = 'height' }
  }
  console.log(`  glass  : ${G.w} x ${G.h} px`)
  console.log(`  margin : ${worst.toFixed(1)} px on the ${side} axis`)
  console.log('  verdict:', worst >= 0 ? 'FITS' : '*** OVERFLOWS ***')
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
