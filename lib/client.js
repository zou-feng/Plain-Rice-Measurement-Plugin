/**
 * dsh-plugin-balance-pet — Client half.
 *
 * Hand-written bundle in the same lazy-CJS form the DSH bundler emits, so a
 * standalone plugin needs no build step: executing this file only registers a
 * factory, and every side effect (including attaching the widget) lives inside
 * the factory and runs at the plugin's activation.
 *
 * The page never talks to DeepSeek: it polls the Host's `/balance-pet/status`
 * snapshot (every 3 seconds, plus a local 1-second clock repaint) and fetches
 * `/balance-pet/config` once for the asset revision.
 *
 * Two hard-won rules are encoded here:
 *   - The stylesheet and sprite URLs carry the Host's asset revision, because a
 *     cached stylesheet once left the widget unpositioned with its text offscreen.
 *   - `apply` never throws: a throwing `apply` marks this plugin's loader entry
 *     failed, and the shell turns any failed entry into a whole-page boot error.
 */
if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
  window.__ModuleLoader__.load({
    id: 'dsh-plugin-balance-pet',
    factory: () => {
      var module = { exports: {} }
      var exports = module.exports

      var STATUS_URL = '/balance-pet/status'
      var CONFIG_URL = '/balance-pet/config'
      var SPRITE_URL = '/balance-pet/sprite'
      var STYLE_URL = '/balance-pet/style'
      var TICK_MS = 1000
      var WIDGET_ID = 'dsh-balance-pet-root'
      /** localStorage key for the right-click menu's choices. */
      var PREF_KEY = 'dsh-balance-pet:prefs'
      /**
       * The sizes the menu offers. `width: null` means "leave it to the
       * stylesheet", whose clamp() keeps her proportional to the window.
       *
       * Widths are also capped at `window.innerWidth - 48` when applied, so even
       * 超大 shrinks to fit a small window instead of hanging off the edge. A
       * floor of 160px keeps the tablet readable if the window is tiny.
       */
      var MENU_SIZES = [
        { id: 'auto', label: '自动', width: null },
        { id: 'small', label: '小', width: 230 },
        { id: 'medium', label: '中', width: 290 },
        { id: 'large', label: '大', width: 350 },
        { id: 'huge', label: '超大', width: 460 },
      ]
      /**
       * Red for the hurt flash, as an SVG colour matrix.
       *
       * The wanted effect is "her luminance, poured into a red channel that
       * clips to flat red" — the probe of a reference tint showed a mid-tone
       * input landing on (204,0,0), i.e. the red gain has to be ~3.2x while the
       * other two sit at 0.4x, which keeps the overall luminance about equal.
       * A plain `sepia -> saturate -> hue-rotate` chain cannot reach that, so
       * the matrix is spelled out and the filter forces sRGB to match it.
       */
      var HURT_FILTER_ID = 'dsh-pet-hurt-red'
      var HURT_MATRIX = [
        '0.68032 2.28864 0.23104 0 0',
        '0.08504 0.28608 0.02888 0 0',
        '0.08504 0.28608 0.02888 0 0',
        '0 0 0 1 0',
      ].join(' ')

      /** 谷价 name colour. */
      var VALLEY_COLOR = '#5cf07f'
      /** 峰价 name colour. */
      var PEAK_COLOR = '#9ad7ff'

      /** Asset revision reported by the Host; set before the widget mounts. */
      var assetVersion = null
      /** The mounted widget parts, or null while it has not been mounted yet. */
      var ui = null
      var lastBalance = null
      var tick = 0
      var lastFrame = null
      var drag = null
      var moved = false
      /** Only meaningful after a drag; the CSS corner anchor owns the start. */
      var pos = null
      /** Epoch ms of the next peak/valley flip, from the Host; null until known. */
      var nextSwitchAt = null
      /**
       * Server clock minus local clock. The countdown is measured against the
       * Host's `serverTime` rather than this machine's clock, so a wrong system
       * time cannot make it lie. China is a fixed UTC+8, so no DST to worry about.
       */
      var skewMs = 0
      /** Set once the Host has been asked about an expired countdown. */
      var switchAsked = false
      /** Set by the menu's "refresh now"; makes the next poll fetch immediately. */
      var forceNow = false
      /** Menu choices, restored from localStorage on mount. */
      var prefs = { size: 'auto', hidden: false }
      /** The open context menu node, or null while it is closed. */
      var menuNode = null
      /** Document listeners that only exist while the menu is open. */
      var menuListeners = null

      function pad2(n) {
        return n < 10 ? '0' + String(n) : String(n)
      }

      function el(tag, className, text) {
        var node = document.createElement(tag)
        if (className) node.className = className
        if (text !== undefined && text !== null) node.textContent = String(text)
        return node
      }

      /** Append the Host's revision so a changed asset is never a cache hit. */
      function versioned(url) {
        if (assetVersion === null || url.indexOf('?') !== -1) return url
        return url + '?v=' + encodeURIComponent(assetVersion)
      }

      /**
       * Resolve one Host route against the page's own base URI, then append the
       * Host's revision. A plain relative path breaks whenever the shell is not
       * mounted at the origin root.
       */
      function versionedUrl(path) {
        var url = path
        try {
          url = new URL(path, document.baseURI).href
        } catch (error) {
          url = path
        }
        return versioned(url)
      }

      function attachStylesheet() {
        if (document.querySelector('link[data-balance-pet-style]') !== null) return
        var link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = versionedUrl(STYLE_URL)
        link.setAttribute('data-balance-pet-style', '')
        document.head.appendChild(link)
      }

      function createWidget() {
        var root = el('div', 'dsh-pet-root')
        root.id = WIDGET_ID

        var fx = el('div', 'dsh-pet-fx')

        /*
         * The hurt flash's colour matrix travels with the widget as an inline
         * SVG filter. It is rendered at zero size rather than `display: none`,
         * because a filter inside a display:none subtree cannot be referenced.
         */
        var svgNs = 'http://www.w3.org/2000/svg'
        var svg = document.createElementNS(svgNs, 'svg')
        svg.setAttribute('class', 'dsh-pet-svgdefs')
        svg.setAttribute('aria-hidden', 'true')
        var filter = document.createElementNS(svgNs, 'filter')
        filter.setAttribute('id', HURT_FILTER_ID)
        // The matrix above is sRGB arithmetic; SVG filters default to linearRGB.
        filter.setAttribute('color-interpolation-filters', 'sRGB')
        var matrix = document.createElementNS(svgNs, 'feColorMatrix')
        matrix.setAttribute('type', 'matrix')
        matrix.setAttribute('values', HURT_MATRIX)
        filter.appendChild(matrix)
        svg.appendChild(filter)

        var sprite = el('div', 'dsh-pet-sprite')
        var image = el('img')
        image.src = versionedUrl(SPRITE_URL)
        image.alt = '余额看板娘'
        image.draggable = false
        sprite.appendChild(image)

        // Minecraft-style hurt flash: a second copy of the SAME artwork, run
        // through the red matrix and blinked over her when a deduction lands. It
        // reuses the already-requested sprite URL, and it is inserted BEFORE the
        // tablet so the flash never washes out the figures on the screen.
        var hurt = el('img', 'dsh-pet-hurt')
        hurt.src = versionedUrl(SPRITE_URL)
        hurt.alt = ''
        hurt.draggable = false
        sprite.appendChild(hurt)

        // The tablet reads, top to bottom — no caption line, the price-window
        // name owns the top slot:
        //   梁文谷        (梁文峰 on peak pricing)
        //   ¥ 23.21      (the figure, the thing you read at a glance)
        //   159:22:11    (hours:minutes:seconds until the rate flips)
        var screen = el('div', 'dsh-pet-screen')
        var label = el('div', 'dsh-pet-name', '梁文谷')
        var money = el('div', 'dsh-pet-money', '¥ --')
        var count = el('div', 'dsh-pet-count', '--:--:--')
        screen.appendChild(label)
        screen.appendChild(money)
        screen.appendChild(count)

        var problem = el('div', 'dsh-pet-err')
        problem.style.display = 'none'
        var problemDetail = el('div')
        problem.appendChild(el('div', undefined, '查询失败'))
        problem.appendChild(problemDetail)

        // On-widget diagnostic: a failed snapshot fetch says so on the tablet
        // instead of leaving the placeholders silently stuck.
        var diag = el('div', 'dsh-pet-diag')
        diag.style.display = 'none'

        // While she is hidden this is the only thing left on screen, so the
        // "hide" choice stays reversible without touching any config file.
        var restore = el('button', 'dsh-pet-restore', '👁')
        restore.type = 'button'
        restore.title = '显示看板娘'

        sprite.appendChild(screen)
        sprite.appendChild(diag)
        sprite.appendChild(problem)
        root.appendChild(svg)
        root.appendChild(fx)
        root.appendChild(sprite)
        root.appendChild(restore)
        return {
          root: root,
          fx: fx,
          sprite: sprite,
          hurt: hurt,
          restore: restore,
          screen: screen,
          money: money,
          count: count,
          label: label,
          problem: problem,
          problemDetail: problemDetail,
          diag: diag,
        }
      }

      /**
       * Show the failure box in place of the tablet content. Both occupy the same
       * slot, so the screen must be hidden or the two texts overlap.
       */
      function showProblem(text) {
        if (ui === null) return
        ui.problemDetail.textContent = String(text).slice(0, 48)
        ui.screen.style.display = 'none'
        ui.problem.style.display = ''
      }

      function hideProblem() {
        if (ui === null) return
        ui.problem.style.display = 'none'
        ui.screen.style.display = ''
      }

      function pushFloat(kind, text) {
        if (ui === null) return
        var node = el('div', 'dsh-pet-float ' + kind, text)
        ui.fx.appendChild(node)
        window.setTimeout(function () {
          if (node.parentNode === ui.fx) ui.fx.removeChild(node)
        }, 2200)
      }

      /**
       * The "hurt" reaction to a deduction: she shakes and flashes red, the way
       * an entity does in Minecraft when it takes damage.
       *
       * Both halves hang off ONE class on the root — the shake keyframes run
       * there, and `.dsh-pet-root.is-hurt .dsh-pet-hurt` blinks the red layer —
       * so a single class add/remove starts and ends the whole thing.
       *
       * The shake deliberately lives on the ROOT and not on `.dsh-pet-sprite`:
       * the sprite's `transform` already belongs to the click squash, and two
       * animations fighting over one property would cancel each other.
       */
      function playHurt() {
        if (ui === null) return
        ui.root.classList.remove('is-hurt')
        // Force a reflow: without it the browser coalesces the two class
        // changes and the animation never restarts on a second hit.
        void ui.root.offsetWidth
        ui.root.classList.add('is-hurt')
      }

      /* ── right-click menu ───────────────────────────────────────────────── */

      function readPrefs() {
        try {
          var raw = window.localStorage.getItem(PREF_KEY)
          if (raw === null) return
          var saved = JSON.parse(raw)
          if (saved !== null && typeof saved === 'object') {
            // Whitelist against MENU_SIZES, so a stale or hand-edited stored
            // value can never reach applySize as an unknown id.
            var known = false
            for (var i = 0; i < MENU_SIZES.length; i += 1) {
              if (MENU_SIZES[i].id === saved.size) known = true
            }
            if (known) prefs.size = saved.size
            if (saved.hidden === true) prefs.hidden = true
          }
        } catch (error) {
          // A blocked or corrupt store just means "no memory" — never fatal.
        }
      }

      function writePrefs() {
        try {
          window.localStorage.setItem(PREF_KEY, JSON.stringify({ size: prefs.size, hidden: prefs.hidden }))
        } catch (error) {
          /* ignore */
        }
      }

      /** Apply the chosen width. `auto` hands control back to the stylesheet. */
      function applySize() {
        if (ui === null) return
        var chosen = null
        for (var i = 0; i < MENU_SIZES.length; i += 1) {
          if (MENU_SIZES[i].id === prefs.size) chosen = MENU_SIZES[i]
        }
        if (chosen === null || chosen.width === null) {
          ui.root.style.width = ''
          return
        }
        // Never wider than the window, or she would hang off the edge.
        ui.root.style.width = Math.max(160, Math.min(chosen.width, window.innerWidth - 48)) + 'px'
      }

      function applyHidden() {
        if (ui === null) return
        if (prefs.hidden) ui.root.classList.add('is-hidden')
        else ui.root.classList.remove('is-hidden')
      }

      function menuRow(label, onPick, active) {
        var row = el('div', 'dsh-pet-menu-row' + (active ? ' is-active' : ''))
        row.appendChild(el('span', 'dsh-pet-menu-label', label))
        if (active) row.appendChild(el('span', 'dsh-pet-menu-tick', '✓'))
        row.addEventListener('click', function (event) {
          event.stopPropagation()
          onPick()
          closeMenu()
        })
        return row
      }

      function buildMenu() {
        var menu = el('div', 'dsh-pet-menu')
        // A right-click inside the menu must not open a second one.
        menu.addEventListener('contextmenu', function (event) {
          event.preventDefault()
          event.stopPropagation()
        })

        menu.appendChild(menuRow('立即刷新余额', function () {
          forceNow = true
          poll()
        }))

        menu.appendChild(el('div', 'dsh-pet-menu-sep'))
        menu.appendChild(el('div', 'dsh-pet-menu-title', '尺寸'))
        for (var i = 0; i < MENU_SIZES.length; i += 1) {
          var entry = MENU_SIZES[i]
          menu.appendChild(
            menuRow(
              entry.label,
              (function (id) {
                return function () {
                  prefs.size = id
                  writePrefs()
                  applySize()
                }
              })(entry.id),
              prefs.size === entry.id,
            ),
          )
        }

        menu.appendChild(el('div', 'dsh-pet-menu-sep'))
        menu.appendChild(
          menuRow(prefs.hidden ? '显示看板娘' : '隐藏看板娘', function () {
            prefs.hidden = !prefs.hidden
            writePrefs()
            applyHidden()
          }),
        )
        return menu
      }

      function closeMenu() {
        if (menuListeners !== null) {
          document.removeEventListener('pointerdown', menuListeners.onDown, true)
          document.removeEventListener('keydown', menuListeners.onKey, true)
          window.removeEventListener('resize', menuListeners.onLeave)
          window.removeEventListener('blur', menuListeners.onLeave)
          menuListeners = null
        }
        if (menuNode !== null && menuNode.parentNode !== null) menuNode.parentNode.removeChild(menuNode)
        menuNode = null
      }

      /**
       * Open the menu at the pointer. It lives inside the widget root (which is
       * `position: fixed`), so its coordinates are relative to that box, and the
       * final position is clamped so the menu never leaves the window.
       */
      function openMenu(clientX, clientY) {
        if (ui === null) return
        closeMenu()
        var menu = buildMenu()
        ui.root.appendChild(menu)
        var box = ui.root.getBoundingClientRect()
        var width = menu.offsetWidth
        var height = menu.offsetHeight
        var x = clientX - box.left
        var y = clientY - box.top
        var margin = 8
        if (clientX + width > window.innerWidth - margin) x = window.innerWidth - margin - width - box.left
        if (clientY + height > window.innerHeight - margin) y = window.innerHeight - margin - height - box.top
        menu.style.left = Math.round(Math.max(margin - box.left, x)) + 'px'
        menu.style.top = Math.round(Math.max(margin - box.top, y)) + 'px'
        menuNode = menu

        menuListeners = {
          onDown: function (event) {
            if (menuNode !== null && !menuNode.contains(event.target)) closeMenu()
          },
          onKey: function (event) {
            if (event.key === 'Escape') closeMenu()
          },
          // The menu is anchored to the pointer, so any scroll/resize invalidates it.
          onLeave: function () {
            closeMenu()
          },
        }
        document.addEventListener('pointerdown', menuListeners.onDown, true)
        document.addEventListener('keydown', menuListeners.onKey, true)
        window.addEventListener('resize', menuListeners.onLeave)
        window.addEventListener('blur', menuListeners.onLeave)
      }

      function onContextMenu(event) {
        event.preventDefault()
        openMenu(event.clientX, event.clientY)
      }

      /** Local clock, corrected by the last observed server-time offset. */
      function localNow() {
        return Date.now() + skewMs
      }

      /**
       * `HH:MM:SS`, as hours:minutes:seconds.
       *
       * Hours are NOT wrapped at 24: a ten-day holiday block counts up to
       * `246:31:07` rather than showing a day count, which is what the tablet
       * asks for. They are zero-padded to two digits and simply grow from there.
       */
      function formatCountdown(ms) {
        var total = Math.max(0, Math.floor(ms / 1000))
        var hours = Math.floor(total / 3600)
        var minutes = Math.floor((total - hours * 3600) / 60)
        var seconds = total - hours * 3600 - minutes * 60
        return pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds)
      }

      /**
       * Repaint the countdown every tick. The Host hands over an absolute
       * instant, so this is recomputed from the clock rather than decremented —
       * a throttled background tab resumes on the correct number instead of
       * drifting behind.
       */
      function paintCountdown() {
        if (ui === null) return
        if (nextSwitchAt === null) {
          ui.count.textContent = '--:--:--'
          return
        }
        ui.count.textContent = formatCountdown(nextSwitchAt - localNow())
      }

      /**
       * One paint per tick: the price-window label, the countdown to the next
       * switch, and the balance the Host already resolved. The balance rides
       * this snapshot, so the page never talks to DeepSeek itself.
       *
       * NOTE: this runs EVERY tick against the same cached `lastFrame`, so it
       * must not re-derive anything from the wall clock. Recomputing `skewMs`
       * here once pinned `localNow()` to the frozen `serverTime` of that cached
       * frame, which froze the countdown and made it jump 3 seconds at a time —
       * the offset is taken when a snapshot ARRIVES, in poll().
       *
       * Colour rule:
       *   - the NAME is tinted by the window in force right now (谷价 green,
       *     峰价 blue);
       *   - the COUNTDOWN is tinted by the window it is counting DOWN TO, so it
       *     is the exact inverse — a green countdown means valley is coming, a
       *     blue one means peak is coming. It is counting INTO the other window
       *     by definition, so `valley` selects the opposite colour here.
       *   - the FIGURE stays white: the balance has to read at a glance no
       *     matter what the rate is.
       */
      function applySnapshot(snapshot) {
        if (ui === null) return
        if (ui.diag !== undefined) ui.diag.style.display = 'none'
        var valley = snapshot.valley === true
        ui.label.textContent = snapshot.label === '梁文谷' ? '梁文谷' : '梁文峰'
        ui.label.style.color = valley ? VALLEY_COLOR : PEAK_COLOR
        ui.count.style.color = valley ? PEAK_COLOR : VALLEY_COLOR
        if (typeof snapshot.nextSwitchAt === 'number' && isFinite(snapshot.nextSwitchAt)) {
          nextSwitchAt = snapshot.nextSwitchAt
          // A fresh, still-future deadline re-arms the expiry probe in poll().
          if (nextSwitchAt > localNow()) switchAsked = false
        }
        paintCountdown()
        if (snapshot.ok === true && typeof snapshot.balance === 'number') {
          noteBalance(snapshot.balance)
          return
        }
        noteBalance(undefined, snapshot.message === null || snapshot.message === undefined ? undefined : snapshot.message)
      }

      /** Format like the reference build: grouped digits, always two decimals. */
      function formatMoney(value) {
        var text = Math.abs(value).toFixed(2)
        var parts = text.split('.')
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        return (value < 0 ? '-' : '') + '¥ ' + parts.join('.')
      }

      /** Balance paint: keeps the previous figure while the Host reports a fault. */
      function noteBalance(next, source) {
        // `undefined` keeps the previous reading when the Host has no value yet.
        if (next === undefined) {
          // Only take over the tablet when there is no figure to show at all.
          if (lastBalance === null) showProblem(source === undefined ? '余额暂时不可用' : source)
          return
        }
        if (lastBalance !== null && Math.abs(next - lastBalance) >= 0.005) {
          var delta = next - lastBalance
          if (delta < 0) {
            pushFloat('dollar', '-¥' + Math.abs(delta).toFixed(2))
            // Money went out: take the hit (shake + red flash), Minecraft-style.
            playHurt()
          } else {
            pushFloat('heart', '❤')
          }
        }
        lastBalance = next
        if (ui !== null) {
          ui.money.textContent = formatMoney(next)
          hideProblem()
        }
      }

      /** One-time fetch of the Host's asset revision (and nothing else). */
      function loadConfig() {
        return fetch(versionedUrl(CONFIG_URL), { cache: 'no-store' })
          .then(function (response) {
            return response.json()
          })
          .then(function (payload) {
            if (typeof payload.assetVersion === 'string' && payload.assetVersion.length > 0) {
              assetVersion = payload.assetVersion
            }
            return payload
          })
          .catch(function () {
            return null
          })
      }

      /** Surface a stuck snapshot on the widget itself, not only in the console. */
      function showDiag(text) {
        if (ui === null || ui.diag === undefined) return
        ui.diag.textContent = String(text).slice(0, 60)
        ui.diag.style.display = ''
      }

      /**
       * Poll the Host snapshot. While nothing has ever landed this retries every
       * tick and reports the failure on the widget; a fabricated "empty" frame
       * used to leave the tablet showing a plausible-looking peak label with
       * placeholder time and balance, which is exactly how this hid for so long.
       */
      function poll() {
        tick += 1
        // Ask the Host for a fresh snapshot every 3 seconds; the countdown still
        // repaints every tick from the last snapshot.
        //
        // An expired countdown is the one exception: at the switch instant the
        // label must flip, not wait out the remaining cadence. `switchAsked`
        // keeps a failing Host from being hammered once a second.
        var expired = nextSwitchAt !== null && localNow() >= nextSwitchAt && !switchAsked
        // `forceNow` is the menu's "refresh now": it skips the 3-second cadence
        // and asks for an uncached reading.
        var forced = forceNow
        if (forced) forceNow = false
        if (lastFrame === null || tick % 3 === 0 || expired || forced) {
          if (expired) switchAsked = true
          var url = versionedUrl(STATUS_URL)
          // The header tells the Host to bypass its own few-second cache; a
          // same-origin request needs no preflight for a custom header.
          var options = { cache: 'no-store' }
          if (forced) options.headers = { 'x-balance-pet-force': '1' }
          fetch(url, options)
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + String(response.status) + ' @ ' + url)
              return response.json()
            })
            .then(function (snapshot) {
              lastFrame = snapshot
              // Taken HERE, once per real response — never on a repaint of the
              // cached frame, or the countdown stops moving between fetches.
              if (typeof snapshot.serverTime === 'number' && isFinite(snapshot.serverTime)) {
                skewMs = snapshot.serverTime - Date.now()
              }
              if (ui !== null && ui.diag !== undefined) ui.diag.style.display = 'none'
            })
            .catch(function (error) {
              if (lastFrame === null) showDiag('快照读取失败：' + (error && error.message ? error.message : '未知错误'))
            })
        }
        if (lastFrame !== null) applySnapshot(lastFrame)
        else paintCountdown()
      }

      /** Switch from the CSS corner anchor to explicit pixels, keeping her put. */
      function freezePosition() {
        var rect = ui.root.getBoundingClientRect()
        var left = Math.round(rect.left)
        var top = Math.round(rect.top)
        var measured = rect.width > 0 ? rect.width : 280
        if (!isFinite(left)) left = Math.round(window.innerWidth - measured - 24)
        if (!isFinite(top)) top = Math.round(window.innerHeight - measured * 0.67 - 24)
        ui.root.style.left = left + 'px'
        ui.root.style.top = top + 'px'
        ui.root.style.right = 'auto'
        ui.root.style.bottom = 'auto'
        pos = { x: left, y: top }
      }

      function setPosition(next) {
        pos = next
        ui.root.style.left = Math.round(next.x) + 'px'
        ui.root.style.top = Math.round(next.y) + 'px'
      }

      function onPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch (error) {}
        // A drag needs explicit pixels, so resolve the corner anchor once.
        freezePosition()
        drag = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: pos.x,
          originY: pos.y,
        }
        moved = false
        ui.sprite.classList.add('is-drag')
        // Nothing else happens here. A drag has NO effect attached to it: she
        // just follows the pointer. (An earlier build started a sway from here
        // or from the first move, which read as a jump at the start of a drag.)
      }

      function onPointerMove(event) {
        if (drag === null || drag.id !== event.pointerId) return
        var dx = event.clientX - drag.startX
        var dy = event.clientY - drag.startY
        // Past the threshold this stops being a click and becomes a drag; the
        // only thing a drag does is move her.
        if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true
        if (!moved) return
        setPosition({
          x: Math.min(window.innerWidth - 90, Math.max(-70, drag.originX + dx)),
          y: Math.min(window.innerHeight - 130, Math.max(-70, drag.originY + dy)),
        })
      }

      function onPointerUp(event) {
        if (drag === null || drag.id !== event.pointerId) return
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch (error) {}
        drag = null
        ui.sprite.classList.remove('is-drag')
        // A drag ends silently; only a CLICK — released without ever crossing
        // the movement threshold — gets the squash.
        if (moved) return
        ui.sprite.classList.remove('dsh-pet-squish')
        void ui.sprite.offsetWidth
        ui.sprite.classList.add('dsh-pet-squish')
      }

      function mount(mounted, ctx) {
        ui = mounted
        document.body.appendChild(ui.root)
        ui.sprite.addEventListener('pointerdown', onPointerDown)
        ui.sprite.addEventListener('pointermove', onPointerMove)
        ui.sprite.addEventListener('pointerup', onPointerUp)
        ui.sprite.addEventListener('pointercancel', onPointerUp)
        ui.sprite.addEventListener('animationend', function (event) {
          // The click squash is the only animation left, so this is the only
          // class that ever needs clearing.
          if (event.animationName === 'dsh-pet-squish') ui.sprite.classList.remove('dsh-pet-squish')
        })
        // The hurt effect hangs off the ROOT (see playHurt), so it needs its own
        // listener to drop the class once the shake has played out.
        ui.root.addEventListener('animationend', function (event) {
          if (event.animationName === 'dsh-pet-shake') ui.root.classList.remove('is-hurt')
        })
        // Right-click opens the menu; the sprite is the only clickable part.
        ui.sprite.addEventListener('contextmenu', onContextMenu)
        ui.restore.addEventListener('click', function (event) {
          event.stopPropagation()
          prefs.hidden = false
          writePrefs()
          applyHidden()
        })
        // Restore the saved size / visibility, then clamp the width in case the
        // window has changed since it was chosen.
        readPrefs()
        applySize()
        applyHidden()
        var onResize = function () {
          applySize()
          closeMenu()
        }
        window.addEventListener('resize', onResize)
        // Undo every side effect on stop / update: the poll timer, the DOM node,
        // and the stylesheet link all belong to this plugin's fiber.
        ctx.effect(function () {
          return function () {
            closeMenu()
            window.removeEventListener('resize', onResize)
            if (ui !== null) {
              if (ui.root.parentNode !== null) ui.root.parentNode.removeChild(ui.root)
              ui = null
            }
            var link = document.querySelector('link[data-balance-pet-style]')
            if (link !== null && link.parentNode !== null) link.parentNode.removeChild(link)
          }
        })
        ctx.effect(function () {
          return ctx.interval(poll, TICK_MS)
        })
        poll()
      }

      function run(ctx) {
        // Config first: it carries the asset revision that keeps a changed
        // stylesheet or sprite from being served out of the browser cache.
        loadConfig().then(function () {
          attachStylesheet()
          if (document.getElementById(WIDGET_ID) !== null) return
          // Nothing below may escape: a throwing `apply` fails this plugin's
          // loader entry, and the shell turns ANY failed entry into a page-level
          // boot error.
          try {
            mount(createWidget(), ctx)
          } catch (error) {
            console.error('[balance-pet] widget failed to start', error)
          }
        })
      }

      /**
       * Run once a body exists: `apply` can fire while the document is still
       * parsing, and an early `return` there would silently drop the widget.
       */
      function whenBodyReady(callback) {
        if (document.body !== null) {
          callback()
          return
        }
        var attempts = 0
        var timer = window.setInterval(function () {
          attempts += 1
          if (document.body !== null) {
            window.clearInterval(timer)
            callback()
            return
          }
          if (attempts >= 200) {
            window.clearInterval(timer)
            console.error('[balance-pet] document.body never appeared; widget not mounted')
          }
        }, 50)
      }

      /**
       * The browser half is loaded on its own, so it needs its own `inject`:
       * the Host half's declaration does not apply here. Without `timer` the
       * cordis guard rejects `ctx.interval` ("cannot get property "timer"
       * without inject"), which silently left the widget showing its
       * placeholders forever.
       */
      exports.inject = ['timer']

      exports.apply = (ctx) => {
        whenBodyReady(() => run(ctx))
      }

      return module.exports
    },
  })
}
