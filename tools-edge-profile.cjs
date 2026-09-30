// Prints the glass panel's top/bottom edge y for a range of columns, so the real
// edge slopes can be read as numbers and any contamination spotted.
// Needs `npm i -D sharp` (dev-only tool, not part of the plugin runtime).
const sharp = require('sharp')
const path = require('path')

sharp(path.join(__dirname, 'assets', 'sprite.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
  const { width: W, height: H, channels: C } = info
  const isGlass = (x, y) => {
    const i = (y * W + x) * C
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a < 200) return false
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return mx < 48 && (mx - mn) < 12
  }

  // Longest vertical glass run per column → its top and bottom.
  const rows = []
  for (let x = 380; x <= 530; x += 5) {
    let best = null, run = null
    for (let y = 215; y <= 350; y++) {
      if (isGlass(x, y)) { if (run === null) run = { a: y, b: y }; else run.b = y }
      else { if (run && run.b - run.a >= 15 && (best === null || run.b - run.a > best.b - best.a)) best = run; run = null }
    }
    if (run && run.b - run.a >= 15 && (best === null || run.b - run.a > best.b - best.a)) best = run
    if (best) rows.push({ x, top: best.a, bot: best.b, h: best.b - best.a + 1 })
  }

  console.log('  x   top   bot   height')
  for (const r of rows) console.log('  ' + String(r.x).padStart(3) + '  ' + String(r.top).padStart(4) + '  ' + String(r.bot).padStart(5) + '  ' + String(r.h).padStart(6))

  // Fit top and bottom, but only over the central columns (avoid hand/finger ends).
  const central = rows.filter((r) => r.x >= 400 && r.x <= 515)
  const fit = (key) => {
    const n = central.length
    const mx = central.reduce((s, r) => s + r.x, 0) / n
    const my = central.reduce((s, r) => s + r[key], 0) / n
    let a = 0, b = 0
    for (const r of central) { a += (r.x - mx) * (r[key] - my); b += (r.x - mx) ** 2 }
    const slope = a / b
    return { slope, deg: Math.atan(slope) * 180 / Math.PI }
  }
  const t = fit('top'), b2 = fit('bot')
  console.log('')
  console.log('central columns used:', central.length, '(x', central[0].x, '..', central[central.length - 1].x + ')')
  console.log('top    edge slope:', t.slope.toFixed(4), '->', t.deg.toFixed(2), 'deg')
  console.log('bottom edge slope:', b2.slope.toFixed(4), '->', b2.deg.toFixed(2), 'deg')
  console.log('MEAN (use this)  :', ((t.deg + b2.deg) / 2).toFixed(2), 'deg')
})
