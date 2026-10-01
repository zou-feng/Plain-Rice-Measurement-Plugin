/*
 * Offline test for the peak/valley schedule and the countdown formatting.
 *
 * The pricing rule is the one piece of this plugin that is easy to get quietly
 * wrong — a wrong holiday table just makes the mascot say 梁文峰 on a national
 * holiday, with no error anywhere. So the rule is asserted here against known
 * dates from 《国务院办公厅关于 2026 年部分节假日安排的通知》 plus DeepSeek's
 * own schedule notices, and then fuzzed for the switch-boundary invariant.
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
   * off a calendar, because that is where the bugs are: date rollover, the
   * 00:00–00:30 peak notch, weekends, and holiday blocks.
   */
  const cases = [
    // Everyday window.
    ['正常工作日 09:00 → 峰价，收盘于次日 00:30', bj(2026, 6, 1, 9, 0), false, bj(2026, 6, 2, 0, 30)],
    ['正常工作日 03:00 → 谷价，收盘于当日 08:30', bj(2026, 6, 1, 3, 0), true, bj(2026, 6, 1, 8, 30)],
    ['正常工作日 00:10 → 峰价（00:30 前的空档）', bj(2026, 6, 1, 0, 10), false, bj(2026, 6, 1, 0, 30)],
    ['正常工作日 23:00 → 峰价，跨零点不断档', bj(2026, 6, 1, 23, 0), false, bj(2026, 6, 2, 0, 30)],
    ['边界 08:30 整点 → 已是峰价', bj(2026, 6, 1, 8, 30), false, bj(2026, 6, 2, 0, 30)],
    ['边界 00:30 整点 → 已是谷价', bj(2026, 6, 1, 0, 30), true, bj(2026, 6, 1, 8, 30)],

    // Weekends are valley the whole day (since 2026-08-23).
    ['周六 09:00 → 全天谷价，直到周一 00:00', bj(2026, 6, 6, 9, 0), true, bj(2026, 6, 8, 0, 0)],
    ['周日 10:00 → 全天谷价，直到周一 00:00', bj(2026, 6, 7, 10, 0), true, bj(2026, 6, 8, 0, 0)],

    /*
     * 调休上班的周末也照谷价计费 (DeepSeek 2026-09-19 说明), which is the case a
     * "weekend means idle" shortcut would get right and a "weekday list" would
     * get wrong.
     */
    ['9/20(周日，调休上班) → 仍全天谷价', bj(2026, 9, 20, 12, 0), true, bj(2026, 9, 21, 0, 0)],
    ['10/10(周六，调休上班) → 仍全天谷价', bj(2026, 10, 10, 12, 0), true, bj(2026, 10, 12, 0, 0)],

    // Statutory holiday blocks, including the Friday ones a weekday rule misses.
    ['元旦 1/2(周五) → 谷价到 1/5 周一 00:00', bj(2026, 1, 2, 12, 0), true, bj(2026, 1, 5, 0, 0)],
    ['春节 2/16(周一) → 谷价到 2/24 周二 00:00', bj(2026, 2, 16, 12, 0), true, bj(2026, 2, 24, 0, 0)],
    ['清明 4/6(周一) → 谷价到 4/7 周二 00:00', bj(2026, 4, 6, 12, 0), true, bj(2026, 4, 7, 0, 0)],
    ['劳动节 5/5(周二) → 谷价到 5/6 周三 00:00', bj(2026, 5, 5, 12, 0), true, bj(2026, 5, 6, 0, 0)],
    ['端午 6/19(周五) → 谷价到 6/22 周一 00:00', bj(2026, 6, 19, 12, 0), true, bj(2026, 6, 22, 0, 0)],
    ['中秋 9/25(周五) → 谷价到 9/28 周一 00:00', bj(2026, 9, 25, 12, 0), true, bj(2026, 9, 28, 0, 0)],
    ['国庆 10/1(周四) 08:33 → 谷价到 10/8 周四 00:00', bj(2026, 10, 1, 8, 33), true, bj(2026, 10, 8, 0, 0)],
    ['国庆最后一天 10/7 23:59 → 谷价，一分钟后就翻峰价', bj(2026, 10, 7, 23, 59), true, bj(2026, 10, 8, 0, 0)],
    ['国庆后 10/8 00:10 → 峰价，00:30 转谷', bj(2026, 10, 8, 0, 10), false, bj(2026, 10, 8, 0, 30)],
    ['国庆后 10/8 00:35 → 谷价，08:30 转峰', bj(2026, 10, 8, 0, 35), true, bj(2026, 10, 8, 8, 30)],
    ['国庆后 10/8 09:00 → 峰价到次日 00:30', bj(2026, 10, 8, 9, 0), false, bj(2026, 10, 9, 0, 30)],
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
  for (let i = 0; i < 4000; i += 1) {
    const at = from + Math.floor(rand() * (to - from))
    const current = isValleyAt(at)
    const next = nextSwitchAt(at)
    if (next === null) { bad += 1; continue }
    if (next <= at) { bad += 1; continue }
    if (isValleyAt(next - 1) !== current) { bad += 1; continue }
    if (isValleyAt(next) === current) { bad += 1; continue }
    // A switch can never be more than a spring-festival block away.
    if (next - at > 11 * 86400000) worstYear += 1
  }
  check('4000 random instants in 2026 all switch correctly', bad === 0, bad === 0 ? undefined : `${bad} bad`)
  check('no switch is further than 11 days out', worstYear === 0, worstYear === 0 ? undefined : `${worstYear} outliers`)

  /*
   * How long the current run of valley actually is, printed as a sanity check on
   * the holiday table as a whole.
   */
  console.log('')
  console.log('--- 2026 valley days (whole-day, from the holiday/weekend rule) ---')
  const valleyDays = []
  for (let day = 0; day < 365; day += 1) {
    const noon = bj(2026, 1, 1, 12, 0) + day * 86400000
    const date = new Date(noon + OFFSET)
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - OFFSET
    if (isValleyAt(midnight) && isValleyAt(midnight + 86399000)) valleyDays.push(stamp(midnight).slice(0, 10))
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
