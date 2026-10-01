// Numerical fit check: reads the values out of style.css, computes the text
// block's four corners AFTER rotation, and verifies each corner stays inside
// the measured glass panel. Pure geometry — no eyeballing.
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, 'lib', 'style.css'), 'utf8')
const screen = /\.dsh-pet-screen\s*\{([^}]*)\}/s.exec(css)[1]
const left = Number(/left:\s*([\d.]+)%/.exec(screen)[1])
const top = Number(/top:\s*([\d.]+)%/.exec(screen)[1])
const width = Number(/width:\s*([\d.]+)%/.exec(screen)[1])
const height = Number(/height:\s*([\d.]+)%/.exec(screen)[1])
const tilt = Number(/rotate\((-?[\d.]+)deg\)/.exec(screen)[1])

const nameCqw = Number(/\.dsh-pet-name\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const moneyCqw = Number(/\.dsh-pet-money\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const countCqw = Number(/\.dsh-pet-count\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const stackGapCqw = Number(/\.dsh-pet-screen\s*\{[^}]*gap:\s*([\d.]+)cqw/s.exec(css)[1])
/*
 * `.dsh-pet-screen` is top-anchored (`justify-content: flex-start` plus a
 * `padding-top`), so the text block is NOT centred in the glass box — the tools
 * have to apply the same offset or they would report a fit for a layout nobody
 * is using. Missing padding reads as 0, which keeps the old centred maths valid.
 */
const padTopCqw = (() => {
  const m = /\.dsh-pet-screen\s*\{[^}]*padding-top:\s*([\d.]+)cqw/s.exec(css)
  return m === null ? 0 : Number(m[1])
})()
const topAnchored = /\.dsh-pet-screen\s*\{[^}]*justify-content:\s*flex-start/s.test(css)

const W = 560, H = 373
const cqw = (n) => (n / 100) * W

// Text block size. Height from the three lines; width from the widest line.
//
// The factors are calibrated against real rasterisation (tools-measure-text.cjs)
// rather than a "0.62em per character" estimate, which overstated widths by ~40%:
//   "¥ 23.21" measures ~3.47em at the current size. It was ~3.04em at a smaller
//             size — the ¥ glyph and the space do not scale linearly, so
//             re-measure after any font or size change.
//   digit/colon  ~0.55em  (tabular, so it is stable)
const ns = cqw(nameCqw), ms = cqw(moneyCqw), cs = cqw(countCqw)
/*
 * Height is the three LINE BOXES, not ink: every line has `line-height: 1`, so a
 * line box is exactly its font-size tall and the box height is
 * font + gap + font + gap + font. Using 0.74em per line understated the stack by
 * ~17% and reported headroom that was not there.
 */
const gap = cqw(stackGapCqw)
const textH = ns + gap + ms + gap + cs
// The countdown is the longest line: `246:31:07` is 9 narrow characters.
const countW = cs * 0.55 * 9
const textW = Math.max(ms * 3.47, countW)

// Measured glass (tools-edge-profile.cjs): clean rotated rectangle, 126 x 78 px
// along its own frame, centred at (455.5, 278.3), tilted -9.05deg.
const G = { cx: 455.5, cy: 278.3, w: 126.4, h: 78 }
// Text centre in sprite px.
const boxW = (width / 100) * W
const boxH = (height / 100) * H
const boxTop = (top / 100) * H
const boxCentre = boxTop + boxH / 2
const tcx = (left / 100) * W + boxW / 2
const padTop = cqw(padTopCqw)
const tcy = topAnchored ? boxTop + padTop + textH / 2 : boxCentre

// Rotate the text block's four corners by `tilt` around the text centre, then
// express them in the GLASS frame (rotate by -tilt) to test containment in the
// tablet's own coordinate system.
const rad = tilt * Math.PI / 180
const corners = [
  [-textW / 2, -textH / 2], [textW / 2, -textH / 2],
  [textW / 2, textH / 2], [-textW / 2, textH / 2],
]
let allIn = true
let worst = { d: Infinity, side: '' }
for (const [x, y] of corners) {
  const rx = x * Math.cos(rad) - y * Math.sin(rad)
  const ry = x * Math.sin(rad) + y * Math.cos(rad)
  const gx = tcx + rx, gy = tcy + ry
  const dx = gx - G.cx, dy = gy - G.cy
  // In the glass's own frame (rotate the offset by -tilt).
  const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad)
  const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad)
  const marginL = G.w / 2 - Math.abs(lx)
  const marginV = G.h / 2 - Math.abs(ly)
  if (marginL < worst.d) worst = { d: marginL, side: 'width' }
  if (marginV < worst.d) worst = { d: marginV, side: 'height' }
  if (marginL < 0 || marginV < 0) allIn = false
}

console.log('FROM style.css:')
console.log('  geometry :', `left ${left}% top ${top}% w ${width}% h ${height}% rotate ${tilt}deg`)
console.log('  fonts    :', `name ${nameCqw}cqw  money ${moneyCqw}cqw  count ${countCqw}cqw  gap ${stackGapCqw}cqw`)
console.log('  text size:', `${textW.toFixed(1)} x ${textH.toFixed(1)} px  (w x h, before rotation)`)
console.log('  widest   :', textW === countW ? 'the countdown line' : 'the money line', `(${textW.toFixed(1)} px vs glass ${G.w} px)`)
console.log('  widths   :', `count ${countW.toFixed(1)} px   money ${(ms * 3.47).toFixed(1)} px`)
console.log('  glass    :', `${G.w} x ${G.h} px  tilt -9.05deg`)
console.log(
  '  anchor   :',
  topAnchored
    ? `top-anchored, gap above the name ${padTop.toFixed(1)}px, slack below ${(boxTop + boxH - (boxTop + padTop + textH)).toFixed(1)}px`
    : 'centred in the glass box',
)
console.log('')
console.log('  smallest margin after rotation:', worst.d.toFixed(1), 'px on the', worst.side, 'axis')
console.log('  verdict :', allIn ? 'ALL CORNERS INSIDE the glass' : '*** CORNER ESCAPES the glass ***')
