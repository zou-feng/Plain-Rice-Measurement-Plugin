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
const clockCqw = Number(/\.dsh-pet-clock\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])

const W = 560, H = 373
const cqw = (n) => (n / 100) * W

// Text block size. Height from the three lines; width from the widest line.
// The per-character factor is calibrated against real rasterisation
// (tools-measure-text.cjs): "¥ 23.21" measures ~3.04em, i.e. ~0.43em/char.
const ns = cqw(nameCqw), ms = cqw(moneyCqw), cs = cqw(clockCqw)
const nl = ns * 0.74, ml = ms * 0.74, cl = cs * 0.74
const gap = ms * 0.16
const textH = nl + gap + ml + gap + cl
const textW = ms * 3.04   // measured ink width of "¥ 23.21", in em

// Measured glass (tools-edge-profile.cjs): clean rotated rectangle, 126 x 78 px
// along its own frame, centred at (455.5, 278.3), tilted -9.05deg.
const G = { cx: 455.5, cy: 278.3, w: 126.4, h: 78 }
// Text centre in sprite px (CSS box centre).
const boxW = (width / 100) * W
const boxH = (height / 100) * H
const tcx = (left / 100) * W + boxW / 2
const tcy = (top / 100) * H + boxH / 2

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
console.log('  fonts    :', `name ${nameCqw}cqw  money ${moneyCqw}cqw  clock ${clockCqw}cqw`)
console.log('  text size:', `${textW.toFixed(1)} x ${textH.toFixed(1)} px  (w x h, before rotation)`)
console.log('  glass    :', `${G.w} x ${G.h} px  tilt -9.05deg`)
console.log('')
console.log('  smallest margin after rotation:', worst.d.toFixed(1), 'px on the', worst.side, 'axis')
console.log('  verdict :', allIn ? 'ALL CORNERS INSIDE the glass' : '*** CORNER ESCAPES the glass ***')
