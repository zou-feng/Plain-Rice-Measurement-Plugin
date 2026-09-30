// Post-edit audit: checks the invariants that earlier bugs violated.
const fs = require('fs')
const path = require('path')

const root = __dirname
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const client = read('lib/client.js')
const host = read('lib/index.js')
const css = read('lib/style.css')
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'))

let failures = 0
const check = (label, ok) => {
  if (!ok) failures += 1
  console.log((ok ? '  OK   ' : '  FAIL ') + label)
}

console.log('--- packaging ---')
check('cordis.patch.yml has no UTF-8 BOM', !(patch[0] === 0xef && patch[1] === 0xbb && patch[2] === 0xbf))
check('cordis.patch.yml starts with a comment', patch[0] === 0x23)
const pkg = JSON.parse(read('package.json'))
check('package.json declares dsh.bundle.patch', pkg.dsh.bundle.patch === './cordis.patch.yml')
check('package.json declares dsh.client.platform=web', pkg.dsh.client.platform === 'web')
check('exports "./client" points at lib/client.js', pkg.exports['./client'].default === './lib/client.js')
check('sharp is dev-only (not in dependencies)', !pkg.dependencies || pkg.dependencies.sharp === undefined)

console.log('--- cordis wiring ---')
check('client exports inject = [timer]', /exports\.inject\s*=\s*\['timer'\]/.test(client))
check('host injects timer + webServer', /export const inject = \['timer', 'webServer'\]/.test(host))
check('host registers routes through ctx.effect', /ctx\.effect\(\(\) => server\.register\(route\)\)/.test(host))
check('host refresh timer is a fiber effect', /ctx\.effect\(\(\) => ctx\.interval\(/.test(host))

console.log('--- balance path ---')
check('host issues the balance request itself', /https\.request\(/.test(host))
check('httpsJson settles on response stream error', /response\.on\('error', fail\)/.test(host))
check('httpsJson settles only once', /if \(settled\) return/.test(host))
check('inflight cleared on both settle paths', /\(\) => \{ inflight = null \},\s*\n\s*\(\) => \{ inflight = null \}/.test(host))
check('config route returns no credential', !/key:\s*hit/.test(host))
check('client never calls DeepSeek directly', client.indexOf('api.deepseek') === -1)
check('client reads balance from the snapshot', /noteBalance\(snapshot\.balance\)/.test(client))
check('no fabricated empty frame (old bug)', !/valley: false, hour: 0/.test(client))

console.log('--- widget lifecycle ---')
check('client removes its DOM node on dispose', /removeChild\(ui\.root\)/.test(client))
check('client removes its stylesheet on dispose', /link\.parentNode\.removeChild\(link\)/.test(client))
check('poll timer is a fiber effect', /return ctx\.interval\(poll, TICK_MS\)/.test(client))
check('apply guards document.body', /document\.body !== null/.test(client))
check('screen hidden while the failure box shows', /ui\.screen\.style\.display = 'none'/.test(client))
check('screen restored when a balance lands', /hideProblem\(\)/.test(client))

console.log('--- stylesheet ---')
check('gap uses cqw (em would resolve wrong)', /gap:\s*0\.88cqw/.test(css))
check('rotation is the measured -9.05deg', /rotate\(-9\.05deg\)/.test(css))
check('screen and err share one angle', (css.match(/rotate\(-9\.05deg\)/g) || []).length === 2)
check('sprite is a size container for cqw', /\.dsh-pet-sprite\s*\{[^}]*container-type:\s*inline-size/s.test(css))
/*
 * `cqw` resolves against the nearest CONTAINER ancestor, and with none it falls
 * back to the VIEWPORT — which once rendered a 5.5cqw float at ~105px instead of
 * 22px. The floats live under `.dsh-pet-fx` (a sibling of `.dsh-pet-sprite`), so
 * the ROOT must also be a container.
 */
check('root is a size container too (floats need one)', /\.dsh-pet-root\s*\{[^}]*container-type:\s*inline-size/s.test(css))
check('float effects live under .dsh-pet-fx', /el\('div', 'dsh-pet-fx'\)/.test(client))
check('floats are appended to fx, not the sprite', /ui\.fx\.appendChild\(node\)/.test(client))
// The widget's overall width may be viewport-relative; the tablet TYPE may not,
// or it would not scale with her.
check('no vw units in widget typography', !/font-size:[^;]*\dvw/.test(css))
const fams = ['name', 'money', 'clock'].map((r) => {
  const m = new RegExp('\\.dsh-pet-' + r + '\\s*\\{([^}]*)\\}', 's').exec(css)
  return m ? /font-family:\s*([^;]+);/.exec(m[1])[1].trim() : null
})
check('all three lines use Microsoft YaHei', fams.every((f) => f !== null && f.indexOf('Microsoft YaHei UI') !== -1))
// Float sizing must stay in the same magnitude as the earlier build (~22px / ~34px).
const dollarCqw = Number(/\.dsh-pet-float\.dollar\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const heartCqw = Number(/\.dsh-pet-float\.heart\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
check('dollar float ~22px at 350px widget', dollarCqw > 5.5 && dollarCqw < 7.5)
check('heart float ~34px at 350px widget', heartCqw > 8.5 && heartCqw < 11)

console.log('')
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
