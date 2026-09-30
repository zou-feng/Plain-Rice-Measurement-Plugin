// Renders the tablet content onto the real sprite so the layout can be LOOKED
// AT instead of guessed at. The text is rotated to the panel's measured angle
// so it sits parallel to the glass edges.
// Usage: node tools-render-preview.cjs <nameCqw> <moneyCqw> <clockCqw> <outfile> [box|nobox] [valley|peak]
// Needs `npm i -D sharp` (dev-only tool, not part of the plugin runtime).
const sharp = require('sharp')
const path = require('path')

const [, , nameArg, moneyArg, clockArg, outArg, boxArg, windowArg] = process.argv
const nameCqw = Number(nameArg ?? 3.0)
const moneyCqw = Number(moneyArg ?? 6.0)
const clockCqw = Number(clockArg ?? 2.6)
const out = outArg ?? path.join(__dirname, 'preview-layout.png')
const showBox = boxArg !== 'nobox'
const valley = windowArg !== 'peak'

// Palette — must mirror the constants in lib/client.js.
const VALLEY_COLOR = '#5cf07f'
const PEAK_COLOR = '#9ad7ff'
const CLOCK_COLOR = '#9ad7ff'

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
  const cs = cqw(clockCqw) * k

  const nl = ns * 0.74
  const ml = ms * 0.74
  const cl = cs * 0.74
  const gap = ms * 0.16
  const total = nl + gap + ml + gap + cl

  const gw = GLASS.w * k
  const gh = GLASS.h * k
  const budget = gh * FILL
  const cx = GLASS.cx * k
  const cy = GLASS.cy * k
  const y0 = -total / 2

  const box = showBox
    ? `<rect x="${-gw / 2}" y="${-gh / 2}" width="${gw}" height="${gh}" fill="none" stroke="#ff3b30" stroke-width="1.5"/>`
    : ''

  const svg = `<svg width="${sw}" height="${sh}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { text-anchor: middle; }
      .name  { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${ns}px; font-weight: 700; }
      .money { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${ms}px; font-weight: 700; fill: #ffffff; }
      .clock { font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: ${cs}px; font-weight: 600; }
    </style>
    <g transform="translate(${cx} ${cy}) rotate(${TILT})">
      ${box}
      <text class="name"  x="0" y="${y0 + nl}" fill="${valley ? VALLEY_COLOR : PEAK_COLOR}">${valley ? '梁文谷' : '梁文峰'}</text>
      <text class="money" x="0" y="${y0 + nl + gap + ml}">¥ 23.21</text>
      <text class="clock" x="0" y="${y0 + nl + gap + ml + gap + cl}" fill="${CLOCK_COLOR}">02:19:34</text>
    </g>
  </svg>`

  await sharp(spritePath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out)

  console.log('wrote', out)
  console.log('  window   :', valley ? '谷价 -> 梁文谷 (green)' : '峰价 -> 梁文峰 (blue)')
  console.log('  rotation :', TILT + 'deg (panel angle)')
  console.log('  panel    :', `centre ${GLASS.cx},${GLASS.cy}  ${GLASS.w}x${GLASS.h}`)
  console.log('  sizes    :', [ns, ms, cs].map((v) => v.toFixed(1)).join(' / '), 'px (name / money / clock)')
  console.log('  text     :', total.toFixed(1), 'px   budget', budget.toFixed(1), 'px', total <= budget ? 'FITS (margin ' + (budget - total).toFixed(1) + 'px)' : '*** OVERFLOWS ***')
  // Calibrated against real rasterisation: "¥ 23.21" ink width ≈ 3.04em.
  const moneyW = ms * 3.04
  console.log('  money w  :', moneyW.toFixed(1), 'vs panel', gw.toFixed(1), moneyW <= gw * 0.92 ? 'FITS' : '*** TOO WIDE ***')
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
