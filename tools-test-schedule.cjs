/*
 * Offline test for the peak/valley schedule and the countdown formatting.
 *
 * The pricing rule is the one piece of this plugin that is easy to get quietly
 * wrong — a wrong rule just makes the mascot say 梁文峰 at the wrong hour, with no
 * error anywhere. So the rule is asserted here against DeepSeek's own published
 * windows plus known dates from 《国务院办公厅关于 2026 年部分节假日安排的通知》,
 * and then fuzzed for the switch-boundary invariant.
 *
 * The rule under test, verbatim from DeepSeek's 模型 & 价格 page (注释 2):
 *
 *   「北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为
 *     高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。」
 *
 * PEAK is the exception. Several cases below exist purely to pin that down —
 * they are the ones an earlier, inverted build got wrong.
 *
 * Run: node tools-test-schedule.cjs
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = __dirname
const OFFSET = 8 * 3600000
/** Beijing wall-clock instant → epoch ms (China is a fixed UTC+8). */
const bj = (y, m, d, hh, mm, ss) => Date.UTC(y, m - 1, d, hh, mm || 0, ss || 0) - OFFSET
const stamp = (ts) => new Date(ts + OFFSET).toISOString().replace('T', ' ').slice(0, 19)

let failures = 0
const check = (label, ok, extra) => {
  if (!ok) failures += 1
  console.log((ok ? '  OK   ' : '  FAIL ') + label + (ok || extra === undefined ? '' : `   → ${extra}`))
}

async function main() {
  const mod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
  const { isValleyAt, nextSwitchAt } = mod
  if (typeof isValleyAt !== 'function' || typeof nextSwitchAt !== 'function') {
    console.error('FAIL: lib/index.js did not export the schedule test hooks')
    process.exit(1)
  }

  console.log('--- known instants (Beijing) ---')
  /*
   * Every expectation is written as the wall-clock instant a *human* would read
   * off a calendar, because that is where the bugs are: the two peak windows on
   * an ordinary weekday, the lunch dead zone, the weekend bridge from Friday
   * 18:00 to Monday 09:00, and holiday blocks.
   */
  const cases = [
    // ── The ordinary weekday: peak only 09:00–12:00 and 14:00–18:00 ──────
    ['工作日 10:00 → 峰价，收盘于当日 12:00', bj(2026, 6, 1, 10, 0), false, bj(2026, 6, 1, 12, 0)],
    ['工作日 15:00 → 峰价，收盘于当日 18:00', bj(2026, 6, 1, 15, 0), false, bj(2026, 6, 1, 18, 0)],
    ['边界 09:00 整点 → 已是峰价，收盘于 12:00', bj(2026, 6, 1, 9, 0), false, bj(2026, 6, 1, 12, 0)],
    ['边界 12:00 整点 → 已是谷价（午休），收盘于 14:00', bj(2026, 6, 1, 12, 0), true, bj(2026, 6, 1, 14, 0)],
    ['边界 14:00 整点 → 已是峰价，收盘于 18:00', bj(2026, 6, 1, 14, 0), false, bj(2026, 6, 1, 18, 0)],
    ['边界 18:00 整点 → 已是谷价，收盘于次日 09:00', bj(2026, 6, 1, 18, 0), true, bj(2026, 6, 2, 9, 0)],
    ['工作日 13:00 → 谷价（午休空档）', bj(2026, 6, 1, 13, 0), true, bj(2026, 6, 1, 14, 0)],

    /*
     * These two are the regression guards for the inverted build: it called the
     * whole evening peak and counted to midnight instead of to 09:00.
     */
    ['工作日 20:00 → 谷价（旧版误报峰价）', bj(2026, 6, 1, 20, 0), true, bj(2026, 6, 2, 9, 0)],
    ['工作日 23:00 → 谷价，跨零点不断档，收盘于次日 09:00', bj(2026, 6, 1, 23, 0), true, bj(2026, 6, 2, 9, 0)],
    ['工作日 03:00 → 谷价，收盘于当日 09:00', bj(2026, 6, 1, 3, 0), true, bj(2026, 6, 1, 9, 0)],
    ['工作日 00:10 → 谷价（深夜无峰段）', bj(2026, 6, 1, 0, 10), true, bj(2026, 6, 1, 9, 0)],

    // ── The weekend bridge: Friday 18:00 straight through to Monday 09:00 ──
    ['周五 18:00 → 谷价，一路到周一 09:00（旧版误报峰价到周二 00:30）', bj(2026, 6, 5, 18, 0), true, bj(2026, 6, 8, 9, 0)],
    ['周六 09:00 → 全天谷价，直到周一 09:00', bj(2026, 6, 6, 9, 0), true, bj(2026, 6, 8, 9, 0)],
    ['周日 10:00 → 全天谷价，直到周一 09:00', bj(2026, 6, 7, 10, 0), true, bj(2026, 6, 8, 9, 0)],

    /*
     * 调休上班的周末也照谷价计费 (DeepSeek 2026-09-19 说明), which is the case a
     * "weekday means peak" shortcut would get wrong.
     */
    ['9/20(周日，调休上班) → 仍全天谷价，直到 9/21 周一 09:00', bj(2026, 9, 20, 12, 0), true, bj(2026, 9, 21, 9, 0)],
    ['10/10(周六，调休上班) → 仍全天谷价，直到 10/12 周一 09:00', bj(2026, 10, 10, 12, 0), true, bj(2026, 10, 12, 9, 0)],

    // ── Statutory holiday blocks ─────────────────────────────────────────
    ['元旦 1/2(周五) → 谷价到 1/5 周一 09:00', bj(2026, 1, 2, 12, 0), true, bj(2026, 1, 5, 9, 0)],
    ['春节 2/16(周一) → 谷价到 2/24 周二 09:00', bj(2026, 2, 16, 12, 0), true, bj(2026, 2, 24, 9, 0)],
    ['清明 4/6(周一) → 谷价到 4/7 周二 09:00', bj(2026, 4, 6, 12, 0), true, bj(2026, 4, 7, 9, 0)],
    ['劳动节 5/5(周二) → 谷价到 5/6 周三 09:00', bj(2026, 5, 5, 12, 0), true, bj(2026, 5, 6, 9, 0)],
    ['端午 6/19(周五) → 谷价到 6/22 周一 09:00', bj(2026, 6, 19, 12, 0), true, bj(2026, 6, 22, 9, 0)],
    ['中秋 9/25(周五) → 谷价到 9/28 周一 09:00', bj(2026, 9, 25, 12, 0), true, bj(2026, 9, 28, 9, 0)],
    ['国庆 10/1(周四) 08:33 → 谷价到 10/8 周四 09:00', bj(2026, 10, 1, 8, 33), true, bj(2026, 10, 8, 9, 0)],
    ['国庆最后一天 10/7 23:59 → 谷价，跨零点仍谷价', bj(2026, 10, 7, 23, 59), true, bj(2026, 10, 8, 9, 0)],
    ['国庆后 10/8 08:59 → 谷价，一分钟后转峰', bj(2026, 10, 8, 8, 59), true, bj(2026, 10, 8, 9, 0)],
    ['国庆后 10/8 09:00 → 峰价到 12:00', bj(2026, 10, 8, 9, 0), false, bj(2026, 10, 8, 12, 0)],
    ['国庆后 10/8 12:30 → 谷价（午休）到 14:00', bj(2026, 10, 8, 12, 30), true, bj(2026, 10, 8, 14, 0)],
    ['国庆后 10/8 18:30 → 谷价，到次日 09:00', bj(2026, 10, 8, 18, 30), true, bj(2026, 10, 9, 9, 0)],
  ]

  for (const [label, at, valley, next] of cases) {
    const gotValley = isValleyAt(at)
    const gotNext = nextSwitchAt(at)
    const ok = gotValley === valley && gotNext === next
    check(
      label,
      ok,
      ok ? undefined : `valley=${String(gotValley)}(want ${String(valley)}), next=${stamp(gotNext)}(want ${stamp(next)})`,
    )
  }

  /*
   * The invariant, fuzzed: whenever the schedule reports a switch, the state one
   * millisecond before it must still be the old one and the state at it must be
   * the new one. A holiday table or boundary bug shows up here as a claimed
   * switch that changes nothing (or a skipped one).
   */
  console.log('')
  console.log('--- fuzz: every reported switch really switches ---')
  let seed = 20261001
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const from = bj(2026, 1, 1, 0, 0)
  const to = bj(2027, 1, 1, 0, 0)
  let bad = 0
  let worstYear = 0
  let longest = 0
  for (let i = 0; i < 4000; i += 1) {
    const at = from + Math.floor(rand() * (to - from))
    const current = isValleyAt(at)
    const next = nextSwitchAt(at)
    if (next === null) { bad += 1; continue }
    if (next <= at) { bad += 1; continue }
    if (isValleyAt(next - 1) !== current) { bad += 1; continue }
    if (isValleyAt(next) === current) { bad += 1; continue }
    // The longest valley run is 春节 plus the weekend either side of it:
    // Friday 18:00 → the following Tuesday 09:00, a shade over 10.5 days.
    if (next - at > 11 * 86400000) worstYear += 1
    if (next - at > longest) longest = next - at
  }
  check('4000 random instants in 2026 all switch correctly', bad === 0, bad === 0 ? undefined : `${bad} bad`)
  check('no switch is further than 11 days out', worstYear === 0, worstYear === 0 ? undefined : `${worstYear} outliers`)
  console.log(`  longest gap seen: ${(longest / 86400000).toFixed(2)} days`)

  /*
   * Which Beijing dates bill at the idle rate from midnight to midnight. Under
   * the correct rule that is exactly the weekends plus the statutory holiday
   * blocks — every ordinary weekday still has its two peak windows in it.
   */
  console.log('')
  console.log('--- 2026 whole-day valley dates (weekends + holiday blocks) ---')
  const valleyDays = []
  for (let day = 0; day < 365; day += 1) {
    const midnight = bj(2026, 1, 1, 0, 0) + day * 86400000
    let allValley = true
    for (let m = 0; m < 1440; m += 10) {
      if (!isValleyAt(midnight + m * 60000)) { allValley = false; break }
    }
    if (allValley) valleyDays.push(stamp(midnight).slice(0, 10))
  }
  console.log(`  ${valleyDays.length} whole-day valley dates in 2026`)
  console.log(`  ${valleyDays.join(' ')}`)

  console.log('')
  console.log(failures === 0 ? 'ALL SCHEDULE CHECKS PASSED' : failures + ' CHECK(S) FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
