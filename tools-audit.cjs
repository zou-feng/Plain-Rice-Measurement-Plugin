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

console.log('--- interaction ---')
/*
 * A drag must be NOTHING BUT MOVEMENT. Two earlier builds hung an animation on
 * it — first a translateY sway, then a rotation-only sway — and both were
 * reported as "it jumps when I drag". So while dragging, no class may be added
 * except the cursor one, and no sway rule or keyframes may exist at all.
 */
const downHandler = /function onPointerDown\(event\)\s*\{([\s\S]*?)\n      \}/.exec(client)
const downAdds = downHandler === null ? null : (downHandler[1].match(/classList\.add\([^)]*\)/g) || [])
check('pointerdown adds only the cursor class', downAdds !== null && downAdds.length === 1 && downAdds[0] === "classList.add('is-drag')")
const moveHandler = /function onPointerMove\(event\)\s*\{([\s\S]*?)\n      \}/.exec(client)
check('a drag adds no animation class', moveHandler !== null && moveHandler[1].indexOf('classList') === -1)
check('the sway is gone from the client', client.indexOf('dsh-pet-hang') === -1)
check('the sway is gone from the stylesheet', css.indexOf('dsh-pet-hang') === -1)
check('the cursor is the only drag feedback', /\.dsh-pet-sprite\.is-drag\s*\{[^}]*cursor:\s*grabbing/s.test(css))
const squishKf = /@keyframes dsh-pet-squish\s*\{([\s\S]*?)\n\}/.exec(css)
const scales = squishKf === null ? [] : [...squishKf[1].matchAll(/scale\(([\d.]+),\s*([\d.]+)\)/g)].map((m) => Number(m[2]))
check('squash never grows taller than rest (no upward pop)', scales.length > 0 && scales.every((y) => y <= 1.0001))
check('squash does widen horizontally', squishKf !== null && /scale\(1\.1[0-9]/.test(squishKf[1]))
const upHandler = /function onPointerUp\(event\)\s*\{([\s\S]*?)\n      \}/.exec(client)
check('releasing a drag does not squash', upHandler !== null && /if \(moved\) return/.test(upHandler[1]))
// The widget's overall width may be viewport-relative; the tablet TYPE may not,
// or it would not scale with her.
check('no vw units in widget typography', !/font-size:[^;]*\dvw/.test(css))
const fams = ['name', 'money', 'count'].map((r) => {
  const m = new RegExp('\\.dsh-pet-' + r + '\\s*\\{([^}]*)\\}', 's').exec(css)
  return m ? /font-family:\s*([^;]+);/.exec(m[1])[1].trim() : null
})
check('all three lines use Microsoft YaHei', fams.every((f) => f !== null && f.indexOf('Microsoft YaHei UI') !== -1))
// Float sizing must stay in the same magnitude as the earlier build (~22px / ~34px).
const dollarCqw = Number(/\.dsh-pet-float\.dollar\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
const heartCqw = Number(/\.dsh-pet-float\.heart\s*\{[^}]*font-size:\s*([\d.]+)cqw/s.exec(css)[1])
check('dollar float ~22px at 350px widget', dollarCqw > 5.5 && dollarCqw < 7.5)
check('heart float ~34px at 350px widget', heartCqw > 8.5 && heartCqw < 11)

console.log('--- price window (peak/valley) ---')
/*
 * The rule is NOT "it is 00:30–08:30". Weekends and every day of a Chinese
 * statutory holiday bill at the valley rate all day — including a weekend that
 * is a 调休 makeup workday — which is why the mascot used to say 梁文峰 on
 * 2026-10-01, a national holiday. tools-test-schedule.cjs asserts the behaviour;
 * these checks only prove the shape of the rule is still in the source.
 */
check('weekends are valley all day', /weekday === 0 \|\| weekday === 6/.test(host))
check('a holiday range table exists', /ALL_DAY_VALLEY_RANGES = \[/.test(host))
check('all seven 2026 holiday blocks are listed', (host.match(/'2026-\d\d-\d\d', '2026-\d\d-\d\d'/g) || []).length === 7)
check('the 国庆 block is right', /'2026-10-01', '2026-10-07'/.test(host))
check('the 春节 block is right', /'2026-02-15', '2026-02-23'/.test(host))
check('Beijing offset is a fixed UTC+8', /BEIJING_OFFSET_MS = 8 \* 3600000/.test(host))
check('the old pure-clock rule is gone', !/const valley = minutes >= VALLEY_FROM && minutes < VALLEY_UNTIL/.test(host))
check('next switch tests only real boundaries', /boundaries = \[0, VALLEY_FROM, VALLEY_UNTIL\]/.test(host))
check('the scan horizon covers the longest block', /day <= 14/.test(host))
check('status carries an absolute nextSwitchAt', /nextSwitchAt: market\.nextSwitchAt/.test(host))
check('schedule hooks are exported for the offline test', /export \{ isAllDayValley, nextSwitchAt, stateAt as isValleyAt \}/.test(host))

console.log('--- countdown ---')
/*
 * The third slot counts hours:minutes:seconds down to the next flip, and hours
 * are NOT wrapped at 24 — the longest form is a holiday block's `246:31:07`.
 * No day/天 form is allowed: that was an earlier design and it was rejected.
 */
check('the third slot is the countdown', /el\('div', 'dsh-pet-count'/.test(client) && client.indexOf('dsh-pet-clock') === -1)
check('no leftover clock constant', client.indexOf('CLOCK_COLOR') === -1)
check('the format is HH:MM:SS', /return pad2\(hours\) \+ ':' \+ pad2\(minutes\) \+ ':' \+ pad2\(seconds\)/.test(client))
check('hours past 24 are not turned into days', client.indexOf("'天'") === -1 && !/formatCountdown[\s\S]{0,400}86400/.test(client))
check('countdown is recomputed from the clock, not decremented', /nextSwitchAt - localNow\(\)/.test(client))
check('the local clock is corrected by the server offset', /skewMs = snapshot\.serverTime - Date\.now\(\)/.test(client))
/*
 * The offset must be taken ONCE PER RESPONSE, in poll()'s fetch handler — never
 * inside applySnapshot, which re-runs every tick against the SAME cached frame.
 * Doing it there once pinned `localNow()` to that frame's frozen `serverTime`,
 * so the countdown stopped moving and jumped 3 seconds at a time.
 */
const applyBody = /function applySnapshot\(snapshot\)\s*\{([\s\S]*?)\n      \}/.exec(client)
check('the server offset is NOT recomputed on a repaint', applyBody !== null && applyBody[1].indexOf('skewMs =') === -1)
const skewAt = client.indexOf('skewMs = snapshot.serverTime')
check('the server offset is taken when a snapshot arrives', skewAt !== -1 && skewAt > client.indexOf('lastFrame = snapshot'))
check('the cached frame is repainted every tick', /if \(lastFrame !== null\) applySnapshot\(lastFrame\)/.test(client))
check('an expired countdown forces an immediate refetch', /localNow\(\) >= nextSwitchAt && !switchAsked/.test(client))
check('a failing Host is not hammered every second', /if \(expired\) switchAsked = true/.test(client))
/*
 * Colour rule, and the two tints are NOT the same one:
 *   - the name follows the window in force NOW (谷价 green / 峰价 blue);
 *   - the countdown follows the window it counts DOWN TO, which by definition is
 *     the other one — so its tint must be the exact INVERSE.
 * The figure stays white. The stylesheet keeps a colour only as the fallback for
 * the `--:--:--` placeholder shown before the first snapshot.
 */
check('the name is tinted by the window in force', /ui\.label\.style\.color = valley \? VALLEY_COLOR : PEAK_COLOR/.test(client))
check('the countdown is tinted by the window it counts TO', /ui\.count\.style\.color = valley \? PEAK_COLOR : VALLEY_COLOR/.test(client))
check('the two tints are inverse, not identical', /ui\.label\.style\.color = valley \? VALLEY_COLOR : PEAK_COLOR[\s\S]{0,120}ui\.count\.style\.color = valley \? PEAK_COLOR : VALLEY_COLOR/.test(client))
check('both lines share the same two colours', /var VALLEY_COLOR = '#5cf07f'/.test(client) && /var PEAK_COLOR = '#9ad7ff'/.test(client))
check('the figure is not tinted', client.indexOf('ui.money.style.color') === -1)
check('the stylesheet keeps a placeholder fallback colour', /\.dsh-pet-count\s*\{[^}]*color:\s*#9ad7ff/s.test(css))
/*
 * The stack of line boxes (`line-height: 1` + the flex gap) must fit the 78px
 * glass. That is the ceiling deciding how big any line may be.
 */
const stack = (() => {
  const c = (re) => Number(re.exec(css)[1])
  const name = c(/\.dsh-pet-name\s*\{[^}]*font-size:\s*([\d.]+)cqw/s)
  const money = c(/\.dsh-pet-money\s*\{[^}]*font-size:\s*([\d.]+)cqw/s)
  const count = c(/\.dsh-pet-count\s*\{[^}]*font-size:\s*([\d.]+)cqw/s)
  const gap = c(/\.dsh-pet-screen\s*\{[^}]*gap:\s*([\d.]+)cqw/s)
  return ((name + money + count + 2 * gap) / 100) * 560
})()
check('the line stack fits the 78px glass', stack <= 78, `${stack.toFixed(1)}px`)
/*
 * The block is TOP-ANCHORED: the name sits in the upper part of the tablet and
 * the slack is left at the bottom. Centring it again would silently move all
 * three lines, so the anchor and the gap are asserted, and the gap is checked
 * against the glass so a bigger font cannot push the name out of the panel.
 *
 * The window is deliberately a band, not an exact value: the name must CLEAR the
 * border (a hair above it looked like it was touching) while still sitting
 * clearly above centre.
 */
const padTopCqw = (() => {
  const m = /\.dsh-pet-screen\s*\{[^}]*padding-top:\s*([\d.]+)cqw/s.exec(css)
  return m === null ? null : Number(m[1])
})()
check('the text block is top-anchored, not centred', /\.dsh-pet-screen\s*\{[^}]*justify-content:\s*flex-start/s.test(css))
check('the gap above the name is a small cqw value', padTopCqw !== null && padTopCqw > 0 && padTopCqw <= 0.8, String(padTopCqw))
const gapAboveName = ((padTopCqw === null ? 0 : padTopCqw) / 100) * 560
check('the name clears the upper border', gapAboveName >= 1.8, `${gapAboveName.toFixed(2)}px`)
check('the name stays in the upper part', gapAboveName <= 4, `${gapAboveName.toFixed(2)}px`)
check('the whole stack still clears the glass bottom', gapAboveName + stack <= 78, `${(gapAboveName + stack).toFixed(1)}px`)

console.log('--- 扣款挨打反馈 ---')
/*
 * A deduction shakes her and flashes her red, Minecraft-style. The red is a
 * SECOND copy of the sprite run through an SVG feColorMatrix: a plain
 * `sepia -> saturate -> hue-rotate` chain was tried first and could not reach
 * the reference colour (mid-tones have to saturate to about (204,0,0)).
 */
check('a deduction triggers the hurt effect', /pushFloat\('dollar'[\s\S]{0,140}playHurt\(\)/.test(client))
check('the red layer reuses the same sprite', /el\('img', 'dsh-pet-hurt'\)[\s\S]{0,200}versionedUrl\(SPRITE_URL\)/.test(client))
check('the red layer sits UNDER the tablet (text stays readable)', client.indexOf('sprite.appendChild(hurt)') < client.indexOf('sprite.appendChild(screen)'))
check('the tint is an inline SVG colour matrix', /createElementNS\(svgNs, 'feColorMatrix'\)/.test(client) && /setAttribute\('values', HURT_MATRIX\)/.test(client))
check('the filter forces sRGB (SVG defaults to linearRGB)', /color-interpolation-filters', 'sRGB'/.test(client))
check('the filter is not inside a display:none subtree', !/dsh-pet-svgdefs[\s\S]{0,80}display:\s*none/.test(css))
check('the shake runs on the ROOT, not the sprite', /\.dsh-pet-root\.is-hurt\s*\{[^}]*dsh-pet-shake/s.test(css))
check('the shake never scales (the sprite owns transform)', !/@keyframes dsh-pet-shake\s*\{[\s\S]*?\n\}/.test(css) || !/scale\(/.test(/@keyframes dsh-pet-shake\s*\{([\s\S]*?)\n\}/.exec(css)[1]))
check('the flash is stepped, not a smooth fade', /animation:\s*dsh-pet-flash\s+\d+ms\s+steps\(/.test(css))
check('the hurt class is cleared on animationend', /animationName === 'dsh-pet-shake'[\s\S]{0,80}classList\.remove\('is-hurt'\)/.test(client))

console.log('--- 右键菜单 ---')
check('right-click opens the menu and suppresses the native one', /addEventListener\('contextmenu', onContextMenu\)/.test(client) && /event\.preventDefault\(\)\s*\n\s*openMenu/.test(client))
check('the menu offers 立即刷新', /立即刷新余额/.test(client))
check('the menu offers five sizes', /MENU_SIZES = \[/.test(client) && (client.match(/\{ id: '(auto|small|medium|large|huge)'/g) || []).length === 5)
/*
 * Every id in MENU_SIZES must also be accepted by the stored-value whitelist,
 * or the choice silently fails to persist. This is checked structurally rather
 * than by listing the ids twice: a hand-written list is exactly what broke when
 * `huge` was added.
 */
const menuIds = (client.match(/\{ id: '([a-z]+)', label: '[^']+', width: (?:null|\d+) \}/g) || []).map(
  (row) => /id: '([a-z]+)'/.exec(row)[1],
)
check('the size list is parsed', menuIds.length === 5, menuIds.join(','))
check(
  'every offered size survives the storage whitelist',
  menuIds.length > 0 && menuIds.every((id) => new RegExp(`saved\\.size === '${id}'|MENU_SIZES\\[i\\]\\.id === saved\\.size`).test(client)),
  menuIds.join(','),
)
check('the storage whitelist is driven by MENU_SIZES, not a copy', /MENU_SIZES\[i\]\.id === saved\.size/.test(client))
check(
  'sizes ascend',
  (() => {
    const widths = (client.match(/width: (\d+)/g) || []).map((s) => Number(/\d+/.exec(s)[0]))
    return widths.length === 4 && widths.every((w, i) => i === 0 || w > widths[i - 1])
  })(),
  (client.match(/width: (\d+)/g) || []).join(' '),
)
check('the menu toggles 显示 / 隐藏', /prefs\.hidden \? '显示看板娘' : '隐藏看板娘'/.test(client))
check('hiding leaves a way back', /el\('button', 'dsh-pet-restore'/.test(client) && /\.dsh-pet-root:not\(\.is-hidden\) \.dsh-pet-restore/.test(css))
check('the choices persist', /localStorage\.setItem\(PREF_KEY/.test(client))
check('the menu closes on outside click, Escape and resize', /'pointerdown', menuListeners\.onDown/.test(client) && /Escape/.test(client) && /addEventListener\('resize', menuListeners\.onLeave\)/.test(client))
check('menu listeners are removed again', /removeEventListener\('pointerdown', menuListeners\.onDown/.test(client))
check('dispose closes the menu', /closeMenu\(\)[\s\S]{0,120}removeEventListener\('resize', onResize\)/.test(client))
check('the menu is dark and rounded', /\.dsh-pet-menu\s*\{[\s\S]{0,500}rgba\(26, 28, 34/.test(css) && /border-radius:\s*8px/.test(css))
check('the menu takes pointer events back', /\.dsh-pet-menu\s*\{[\s\S]{0,700}pointer-events:\s*auto/.test(css))
check('the menu clamps itself into the window', /window\.innerWidth - margin - width/.test(client) && /window\.innerHeight - margin - height/.test(client))
check('"refresh now" asks the Host to bypass its cache', /x-balance-pet-force/.test(client) && /x-balance-pet-force/.test(host))
check('the Host waits for the forced query before answering', /refresh\(true\)\.then\(answer, answer\)/.test(host))

console.log('')
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
