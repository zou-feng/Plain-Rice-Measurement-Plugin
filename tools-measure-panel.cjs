// Unambiguous tilt direction: linear regression of y on x over the glass pixels
// (image coords, y-down). slope m → CSS rotate = atan(m) deg, sign included.
const sharp = require('D:/deepseek harness/Deepseekharnessoneclickinstall-main/data/dsh/profiles/node_modules/sharp')
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
  const sx = 470, sy = 285
  const seen = new Uint8Array(W * H), stack = [[sx, sy]]
  seen[sy * W + sx] = 1
  let n = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0
  while (stack.length) {
    const [x, y] = stack.pop()
    n++; Sx += x; Sy += y; Sxx += x * x; Sxy += x * y
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const k = ny * W + nx
      if (seen[k]) continue
      seen[k] = 1
      if (isGlass(nx, ny)) stack.push([nx, ny])
    }
  }
  const slope = (n * Sxy - Sx * Sy) / (n * Sxx - Sx * Sx)
  const deg = Math.atan(slope) * 180 / Math.PI
  console.log('glass pixels :', n)
  console.log('regression slope (dy/dx, image coords):', slope.toFixed(4))
  console.log('=> rotate(' + deg.toFixed(1) + 'deg)   [CSS rotate = this exact value]')
  console.log('')
  console.log('sign meaning : positive slope = right side LOWER (y grows to the right)')
  console.log('               positive CSS rotate = clockwise = right side lower')

  // Also print top-right and bottom-right corner positions to sanity-check.
  let minY = 1e9, maxY = -1, minYx = 0, maxYx = 0
  // re-scan to find extrema
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x]) { if (y < minY) { minY = y; minYx = x } if (y > maxY) { maxY = y; maxYx = x } }
  }
  console.log('topmost glass point  : x=' + minYx + ' y=' + minY)
  console.log('bottommost glass point: x=' + maxYx + ' y=' + maxY)
})
