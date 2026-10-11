/**
 * dsh-plugin-balance-pet — Host half.
 *
 * A standalone DSH web-profile plugin: a draggable mascot in the page overlay
 * whose tablet screen shows the DeepSeek balance, names the current price window
 * (梁文峰 peak / 梁文谷 valley), shows Beijing time, and plays a small effect above
 * her head whenever the balance moves.
 *
 * The balance is fetched HERE, in the Host's own Node process, over `node:https`:
 *   - The Host's `web` service cannot read the JSON balance API — it only
 *     decodes html/text bodies with a declared content type.
 *   - The page's own cross-origin fetch to api.deepseek.com is not dependable
 *     (a blocked preflight is what left the tablet blank), and querying here
 *     also keeps the API key out of the browser entirely.
 *
 *   GET /balance-pet/status  → balance + price window + next switch (page polls)
 *
 * `nextSwitchAt` is what the widget's third slot counts down to. It travels as an
 * absolute instant rather than a duration, so a throttled background tab — or a
 * machine whose clock is wrong — still lands on the right number.
 *
 *   GET /balance-pet/config  → asset revision + price window (no credential)
 *   GET /balance-pet/sprite  → the character artwork (PNG)
 *   GET /balance-pet/style   → the stylesheet
 *
 * @module dsh-plugin-balance-pet
 */
import { readFileSync } from 'node:fs'
import https from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'balance-pet'

/** Services this plugin parks on while they are absent. */
export const inject = ['timer', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const SPRITE_FILE = join(HERE, '..', 'assets', 'sprite.png')
const STYLE_FILE = join(HERE, 'style.css')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const API_KEY_ENV = 'DEEPSEEK_API_KEY'
/*
 * Peak/valley pricing — DeepSeek's own wording (模型 & 价格, 注释 2):
 *
 *   「北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为
 *     高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。」
 *
 * So PEAK is the exception, not the rule: two short windows on an ordinary
 * weekday. Everything else — every night, the lunch break, every weekend, and
 * every day of a statutory holiday — bills at the idle (valley) rate.
 *
 * An earlier build had this exactly backwards: it treated 00:30–08:30 as the
 * valley window and the rest of the day as peak. That mislabelled most of every
 * weekday evening, and on a weekend it put the countdown a full 9 hours short
 * (it counted to midnight, when peak used to start, instead of to 09:00).
 */

/** Beijing is a fixed UTC+8 (China dropped DST in 1991), so shifting is exact. */
const BEIJING_OFFSET_MS = 8 * 3600000
const DAY_MS = 86400000

/** The everyday PEAK windows, as `[from, until)` minutes after Beijing midnight. */
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60], // 09:00–12:00
  [14 * 60, 18 * 60], // 14:00–18:00
]

/**
 * Every instant the rate can flip: the four peak-window edges, plus Beijing
 * midnight. Midnight is included because a weekend or holiday block starts and
 * ends there — it is not a switch under the current rule (23:59 and 00:00 are
 * both valley), but it stays in the list so the scan cannot miss a day boundary
 * if the windows are ever retuned.
 */
const SWITCH_BOUNDARIES = [0, 9 * 60, 12 * 60, 14 * 60, 18 * 60]

/**
 * Date ranges billed at the valley rate for the WHOLE day (Beijing dates,
 * inclusive, `YYYY-MM-DD`).
 *
 * Source: 《国务院办公厅关于 2026 年部分节假日安排的通知》. Note this is the
 * full 放假调休 block, not just the statutory days — DeepSeek bills the whole
 * holiday period (中秋+国庆 = 10 valley days).
 *
 * The State Council publishes the next year's calendar around November; until a
 * new range is added here a missing date simply falls back to the everyday
 * weekday rule (peak only 09:00–12:00 and 14:00–18:00, idle the rest of the
 * day), which is the safe direction.
 * See TUNING.md for how to update it.
 */
const ALL_DAY_VALLEY_RANGES = [
  ['2026-01-01', '2026-01-03'], // 元旦
  ['2026-02-15', '2026-02-23'], // 春节 (9 days)
  ['2026-04-04', '2026-04-06'], // 清明节
  ['2026-05-01', '2026-05-05'], // 劳动节
  ['2026-06-19', '2026-06-21'], // 端午节
  ['2026-09-25', '2026-09-27'], // 中秋节
  ['2026-10-01', '2026-10-07'], // 国庆节
]
/**
 * How long a reading stays fresh. Kept short so the tablet tracks the account
 * closely; DeepSeek's own balance endpoint updates with a few seconds of lag, so
 * polling much faster than this buys nothing.
 */
const OK_TTL_MS = 5000
const FAIL_TTL_MS = 5000
/** Backstop refresh, independent of page polling. */
const REFRESH_MS = 5000
const REQUEST_TIMEOUT_MS = 15000
/**
 * Asset revision appended to every client-side asset URL. Bump it whenever the
 * stylesheet or the sprite changes: an asset URL is what the page caches, and a
 * stale stylesheet once left the widget unpositioned with its text offscreen.
 */
const ASSET_VERSION = '30'

function str(value) {
  return typeof value === 'string' ? value : ''
}

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 'YYYY-MM-DD' in Beijing for an instant already shifted to Beijing wall time. */
function beijingDateKey(date) {
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return `${String(date.getUTCFullYear())}-${month < 10 ? '0' : ''}${String(month)}-${day < 10 ? '0' : ''}${String(day)}`
}

/** Shift an epoch instant into a Date whose UTC fields ARE the Beijing wall clock. */
function toBeijing(ts) {
  return new Date(ts + BEIJING_OFFSET_MS)
}

/** Is this Beijing date inside a statutory holiday block? */
function isAllDayValley(dateKey) {
  for (const range of ALL_DAY_VALLEY_RANGES) {
    // ISO date strings compare correctly as plain strings.
    if (dateKey >= range[0] && dateKey <= range[1]) return true
  }
  return false
}

/**
 * Is the account on the valley (idle) rate at this instant?
 * @param ts - epoch milliseconds.
 */
function stateAt(ts) {
  const beijing = toBeijing(ts)
  // A statutory holiday or a weekend is idle all day, whatever the clock says.
  if (isAllDayValley(beijingDateKey(beijing))) return true
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) return true
  // An ordinary weekday is PEAK only inside one of the two short windows;
  // every other minute of it is idle.
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  for (const [from, until] of PEAK_WINDOWS) {
    if (minutes >= from && minutes < until) return false
  }
  return true
}

/**
 * The next instant the rate actually flips.
 *
 * The rate can only change on one of `SWITCH_BOUNDARIES` — the four peak-window
 * edges, plus Beijing midnight where a weekend or holiday block begins or ends
 * — so those are the only instants worth testing, no minute-by-minute scan.
 * Each candidate is filtered by comparing the state either side of it, so a
 * boundary that changes nothing (an ordinary weekday's midnight, a date in the
 * middle of a holiday block) is skipped automatically.
 *
 * @param ts - epoch milliseconds.
 * @returns epoch milliseconds of the next switch, or null if none was found in
 *   the scanned horizon (14 days covers the longest holiday block, 春节).
 */
function nextSwitchAt(ts) {
  const dayStart = Math.floor((ts + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS
  const current = stateAt(ts)
  for (let day = 0; day <= 14; day += 1) {
    const base = dayStart + day * DAY_MS
    for (const minute of SWITCH_BOUNDARIES) {
      const candidate = base + minute * 60000
      if (candidate <= ts) continue
      if (stateAt(candidate) !== current) return candidate
    }
  }
  return null
}

/**
 * The price window at an instant: the rate, the mascot name, and when it flips.
 *
 * The widget draws a countdown, so it needs only `nextSwitchAt`; the Beijing
 * wall clock is not reported because nothing reads it.
 */
function marketAt(date) {
  const ts = date.getTime()
  const valley = stateAt(ts)
  return {
    valley,
    label: valley ? '梁文谷' : '梁文峰',
    nextSwitchAt: nextSwitchAt(ts),
  }
}

function loadFile(path) {
  try {
    return readFileSync(path)
  } catch (error) {
    console.error(`balance-pet: cannot read ${path}: ${String(error && error.message)}`)
    return null
  }
}

/**
 * One HTTPS GET returning parsed JSON, issued from this process rather than the
 * browser.
 * @param url - absolute https URL.
 * @param headers - request headers, already resolved.
 * @returns the parsed body on 2xx; throws otherwise.
 */
function httpsJson(url, headers) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let request
    try {
      request = https.request(url, { method: 'GET', headers, timeout: REQUEST_TIMEOUT_MS }, (response) => {
        const chunks = []
        // A body-stream error must settle the promise: otherwise `inflight`
        // never clears and the balance would stop refreshing for good.
        response.on('error', fail)
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = response.statusCode ?? 0
          if (status < 200 || status >= 300) {
            fail(new Error(`HTTP ${String(status)} ${text.slice(0, 120)}`))
            return
          }
          try {
            succeed(JSON.parse(text))
          } catch {
            fail(new Error('响应不是合法 JSON'))
          }
        })
      })
    } catch (error) {
      fail(error)
      return
    }
    request.on('timeout', () => {
      request.destroy(new Error(`请求超时（${String(REQUEST_TIMEOUT_MS)}ms）`))
    })
    request.on('error', fail)
    request.end()
  })
}

/**
 * Serve the widget surface, keep one cached balance reading, and report the
 * price window and the next switch instant the page renders.
 * @param ctx - the plugin's cordis context.
 */
export function apply(ctx) {
  const sprite = loadFile(SPRITE_FILE)
  const style = loadFile(STYLE_FILE)

  /** Last finished reading, or null before the first one lands. */
  let reading = null
  /** The in-flight query, so concurrent polls share one request. */
  let inflight = null

  function readKey() {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return Promise.resolve(null)
    let ref = API_KEY_ENV
    try {
      if (typeof credentials.credentialRef === 'function') ref = credentials.credentialRef(API_KEY_ENV)
    } catch {
      ref = API_KEY_ENV
    }
    if (ref === null || ref === undefined) return Promise.resolve(null)
    return credentials.resolve(ref).then(
      (hit) => (hit && str(hit.value) ? str(hit.value) : null),
      () => null,
    )
  }

  function queryBalance() {
    return readKey()
      .then((key) => {
        if (key === null) throw new Error('未配置 DEEPSEEK_API_KEY')
        return httpsJson(BALANCE_URL, { Authorization: `Bearer ${key}`, Accept: 'application/json' })
      })
      .then((body) => {
        const infos = body && Array.isArray(body.balance_infos) ? body.balance_infos : null
        const info = infos === null ? null : infos[0]
        if (info === null || info === undefined) throw new Error('响应中没有余额信息')
        const value = num(info.total_balance)
        if (value === null) throw new Error('余额不是数字')
        return { ok: true, balance: value, currency: str(info.currency) || 'CNY' }
      })
  }

  /**
   * Refresh the cached reading once it went stale. The page polls the snapshot
   * every second; the upstream request happens at most once per TTL window.
   *
   * Returns the promise for the query it joins or starts, so a caller that wants
   * a FRESH number (the menu's "refresh now") can wait for one.
   *
   * @param force - bypass the TTL.
   */
  function refresh(force) {
    const now = Date.now()
    const ttl = reading !== null && reading.ok === true ? OK_TTL_MS : FAIL_TTL_MS
    if (!force && reading !== null && now - reading.at < ttl) return Promise.resolve(reading)
    if (inflight !== null) return inflight
    inflight = queryBalance()
      .then(
        (result) => {
          reading = { ok: true, balance: result.balance, currency: result.currency, at: Date.now() }
        },
        (error) => {
          const message = str(error && error.message) || '查询失败'
          reading = { ok: false, message: message.slice(0, 120), at: Date.now() }
          console.error(`balance-pet: balance query failed: ${message}`)
        },
      )
      // Clear the guard on BOTH paths: a stuck guard would silently stop every
      // later refresh.
      .then(
        () => { inflight = null },
        () => { inflight = null },
      )
    return inflight
  }

  refresh(true)
  ctx.effect(() => ctx.interval(() => refresh(false), REFRESH_MS))

  function send(res, status, type, body) {
    res.statusCode = status
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }

  const routes = [
    {
      kind: 'exact',
      path: '/balance-pet/config',
      handler: (req, res) => {
        // Deliberately credential-free: the balance is queried in the Host.
        send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({
            assetVersion: ASSET_VERSION,
            balanceInStatus: true,
            // The everyday PEAK windows, as [fromMinute, untilMinute) after
            // Beijing midnight. Every minute outside them is idle (valley).
            peakWindows: PEAK_WINDOWS.map(([fromMinute, untilMinute]) => ({ fromMinute, untilMinute })),
            // Echoed so the live rule set can be verified from the outside.
            allDayValley: ALL_DAY_VALLEY_RANGES,
          }),
        )
      },
    },
    {
      kind: 'exact',
      path: '/balance-pet/status',
      handler: (req, res) => {
        const answer = () => {
          const market = marketAt(new Date())
          send(
            res,
            200,
            'application/json; charset=utf-8',
            JSON.stringify({
              serverTime: Date.now(),
              valley: market.valley,
              label: market.label,
              peakWindows: PEAK_WINDOWS.map(([fromMinute, untilMinute]) => ({ fromMinute, untilMinute })),
              // Absolute epoch ms of the next peak/valley flip — the page turns
              // this into the countdown it draws, and correcting against
              // `serverTime` keeps it honest on a machine with a wrong clock.
              nextSwitchAt: market.nextSwitchAt,
              ok: reading !== null && reading.ok === true,
              balance: reading !== null && reading.ok === true ? reading.balance : null,
              currency: reading !== null && reading.ok === true ? reading.currency : 'CNY',
              message: reading !== null && reading.ok !== true ? str(reading.message) : null,
              ageMs: reading === null ? null : Date.now() - reading.at,
            }),
          )
        }
        /*
         * The menu's "refresh now" sends this header so the answer is a fresh
         * query rather than the few-second-old cache — otherwise the button
         * would visibly do nothing. A header, not a query parameter, because the
         * route is registered as an exact match on the path.
         */
        if (str(req && req.headers && req.headers['x-balance-pet-force']) === '1') {
          refresh(true).then(answer, answer)
          return
        }
        answer()
      },
    },
    {
      kind: 'exact',
      path: '/balance-pet/sprite',
      handler: (req, res) => {
        if (sprite === null) {
          send(res, 404, 'text/plain; charset=utf-8', 'sprite unavailable')
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        // Revalidate rather than trust a cached copy: the file can change.
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('etag', `"${ASSET_VERSION}-${sprite.length}"`)
        res.end(sprite)
      },
    },
    {
      kind: 'exact',
      path: '/balance-pet/style',
      handler: (req, res) => {
        if (style === null) {
          send(res, 404, 'text/css; charset=utf-8', '')
          return
        }
        // Written directly (not via send) so the revalidate headers survive.
        res.statusCode = 200
        res.setHeader('content-type', 'text/css; charset=utf-8')
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('etag', `"${ASSET_VERSION}-${style.length}"`)
        res.end(style)
      },
    },
  ]

  /** Deferred until the HTTP carrier exists; resolves once per plugin lifetime. */
  const ready = new Promise((resolve) => {
    if (ctx.get('webServer') !== undefined) {
      resolve(ctx.get('webServer'))
      return
    }
    let settled = false
    const take = () => {
      if (settled) return
      settled = true
      resolve(ctx.get('webServer'))
    }
    ctx.inject(['webServer'], take)
    ctx.timeout(take, 60000)
  })

  function registerRoutes() {
    const claimed = []
    const attempt = (server) => {
      for (const route of routes) {
        try {
          ctx.effect(() => server.register(route))
          claimed.push(route.path)
        } catch (error) {
          console.error(`balance-pet: cannot claim ${route.path}: ${String(error && error.message)}`)
        }
      }
      console.log(`balance-pet: routes ready (${claimed.length}/${routes.length})`)
    }
    const direct = ctx.get('webServer')
    if (direct !== undefined) {
      attempt(direct)
      return
    }
    ready.then(
      (server) => {
        if (server === undefined) console.error('balance-pet: webServer never appeared; widget unavailable')
        else attempt(server)
      },
      (error) => console.error(`balance-pet: webServer wait failed: ${String(error && error.message)}`),
    )
  }

  registerRoutes()

  console.log(`balance-pet: ready (sprite ${sprite === null ? 'missing' : `${sprite.length} bytes`})`)
}

/*
 * The peak/valley rule is the part most likely to be silently wrong, so it is
 * reachable from the offline test tool (tools-test-schedule.cjs). DSH reads only
 * `apply`, `inject` and `name` from a plugin module, so these extra bindings are
 * inert at runtime — but they let the holiday table and every switch boundary be
 * asserted without standing the harness up.
 */
export { isAllDayValley, nextSwitchAt, stateAt as isValleyAt }
