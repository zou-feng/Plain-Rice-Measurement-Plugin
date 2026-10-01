// Renders the tablet content onto the real sprite so the layout can be LOOKED
// AT instead of guessed at. The text is rotated to the panel's measured angle
// so it sits parallel to the glass edges.
// Usage: node tools-render-preview.cjs <nameCqw> <moneyCqw> <countCqw> <outfile> [box|nobox] [valley|peak] [countText]
// Needs `npm i -D sharp` (dev-only tool, not part of the plugin runtime).
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, 'lib', 'style.css'), 'utf8')
const cssNum = (re, fallback) => {
  const m = re.exec(css)
  return m === null ? fallback : Number(m[1])
}

const [, , nameArg, moneyArg, countArg, outArg, boxArg, windowArg, countTextArg] = process.argv
const nameCqw = Number(nameArg ?? cssNum(/\.dsh-pet-name\s*\{[^}]*font-size:\s*([\d.]+)cqw/s, 2.9))
const moneyCqw = Number(moneyArg ?? cssNum(/\.dsh-pet-money\s*\{[^}]*font-size:\s*([\d.]+)cqw/s, 5.5))
const countCqw = Number(countArg ?? cssNum(/\.dsh-pet-count\s*\{[^}]*font-size:\s*([\d.]+)cqw/s, 2.55))
const stackGapCqw = cssNum(/\.dsh-pet-screen\s*\{[^}]*gap:\s*([\d.]+)cqw/s, 0.88)
const padTopCqw = cssNum(/\.dsh-pet-screen\s*\{[^}]*padding-top:\s*([\d.]+)cqw/s, 0)
/** The countdown has one shape; override only for a quick sanity look. */
const countText = countTextArg ?? '158:47:24'
const out = outArg ?? path.join(__dirname, 'preview-layout.png')
const showBox = boxArg !== 'nobox'
const valley = windowArg !== 'peak'

// Palette — must mirror the constants in lib/client.js. The name is tinted by the
// window in force; the countdown by the window it counts TO, i.e. the INVERSE.
const VALLEY_COLOR = '#5cf07f'
const PEAK_COLOR = '#9ad7ff'
const NAME_COLOR = valley ? VALLEY_COLOR : PEAK_COLOR
const COUNT_COLOR = valley ? PEAK_COLOR : VALLEY_COLOR

const spritePath = path.join(__dirname, 'assets', 'sprite.png')

// Measured on sprite.png (560x373) by tools-measure-panel.cjs:
//   glass is a clean rotated rectangle: 126.4 x 78 px, centre (455.5, 278.3),
//   top/bottom edges both tilted about -9.05deg (tools-edge-profile.cjs)
const ART_W = 560
const ART_H = 373
const GLASS = { cx: 455.5, cy: 278.3, w: 126.4, h: 78 }
const TILT = -9.05
/** Fraction of the panel the text block may occupy, for a safe border margin. */
const FILL = 0.85

const cqw = (n) => (n / 100) * ART_W

async function main() {
  const meta = await sharp(spritePath).metadata()
  const k = meta.width / ART_W
  const sw = meta.width
  const sh = meta.height

  const ns = cqw(nameCqw) * k
  const ms = cqw(moneyCqw) * k
  const cs = cqw(countCqw) * k

  // `line-height: 1`, so each line box is exactly its font-size tall.
  const gap = cqw(stackGapCqw) * k
  const total = ns + gap + ms + gap + cs
  const countW = cs * 0.55 * countText.length

  const gw = GLASS.w * k
  const gh = GLASS.h * k
  const budget = gh * FILL
  const cx = GLASS.cx * k
  // The block is top-anchored in the glass, so the drawing centre sits where the
  // CSS puts it: glass top + padding-top + half the stack.
  const cy = GLASS.cy * k - gh / 2 + cqw(padTopCqw) * k + total / 2
  const y0 = -total / 2

  const box = showBox
    ? `<rect x="${-gw / 2}" y="${-gh / 2}" width="${gw}" height="${gh}" fill="none" stroke="#ff3b30" stroke-width="1.5"/>`
    : ''

  const svg = `<svg width="${sw}" height="${sh}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { text-anchor: middle; }
      .name  { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${ns}px; font-weight: 700; }
      .money { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${ms}px; font-weight: 700; fill: #ffffff; }
      .count { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${cs}px; font-weight: 600; fill: ${COUNT_COLOR}; }
    </style>
    <g transform="translate(${cx} ${cy}) rotate(${TILT})">
      ${box}
      <text class="name"  x="0" y="${y0 + ns}" fill="${NAME_COLOR}">${valley ? '梁文谷' : '梁文峰'}</text>
      <text class="money" x="0" y="${y0 + ns + gap + ms}">¥ 23.21</text>
      <text class="count" x="0" y="${y0 + ns + gap + ms + gap + cs}">${countText}</text>
    </g>
  </svg>`

  await sharp(spritePath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out)

  console.log('wrote', out)
  console.log('  window   :', valley ? '谷价 -> 梁文谷 (green)' : '峰价 -> 梁文峰 (blue)')
  console.log('  colors   :', `name ${NAME_COLOR}   countdown ${COUNT_COLOR} (the window it counts to)`)
  console.log('  rotation :', TILT + 'deg (panel angle)')
  console.log('  panel    :', `centre ${GLASS.cx},${GLASS.cy}  ${GLASS.w}x${GLASS.h}`)
  console.log('  sizes    :', [ns, ms, cs].map((v) => v.toFixed(1)).join(' / '), 'px (name / money / countdown)')
  console.log('  count    :', `"${countText}"`, 'w', countW.toFixed(1), 'px')
  const padTopK = cqw(padTopCqw) * k
  console.log('  stack    :', total.toFixed(1), 'px tall   panel', gh.toFixed(1), 'px',
    total + padTopK <= gh
      ? `FITS (${padTopK.toFixed(1)}px above the name, ${(gh - padTopK - total).toFixed(1)}px slack below)`
      : '*** OVERFLOWS ***')
  // Calibrated against real rasterisation: "¥ 23.21" ink width ≈ 3.47em.
  const moneyW = ms * 3.47
  console.log('  money w  :', moneyW.toFixed(1), 'vs panel', gw.toFixed(1), moneyW <= gw * 0.92 ? 'FITS' : '*** TOO WIDE ***')
  console.log('  count w  :', countW.toFixed(1), 'vs panel', gw.toFixed(1), countW <= gw * 0.95 ? 'FITS' : '*** TOO WIDE ***')
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
