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

      /** 谷价 name colour. */
      var VALLEY_COLOR = '#5cf07f'
      /** 峰价 name colour. */
      var PEAK_COLOR = '#9ad7ff'
      /** The clock's colour, independent of the price window. */
      var CLOCK_COLOR = '#9ad7ff'

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

        var sprite = el('div', 'dsh-pet-sprite')
        var image = el('img')
        image.src = versionedUrl(SPRITE_URL)
        image.alt = '余额看板娘'
        image.draggable = false
        sprite.appendChild(image)

        // The tablet reads, top to bottom — no caption line, the price-window
        // name owns the top slot:
        //   梁文谷        (梁文峰 on peak pricing)
        //   ¥ 23.21      (the figure, the thing you read at a glance)
        //   02:17:04     (Beijing time)
        var screen = el('div', 'dsh-pet-screen')
        var label = el('div', 'dsh-pet-name', '梁文谷')
        var money = el('div', 'dsh-pet-money', '¥ --')
        var clock = el('div', 'dsh-pet-clock', '--:--:--')
        screen.appendChild(label)
        screen.appendChild(money)
        screen.appendChild(clock)

        var problem = el('div', 'dsh-pet-err')
        problem.style.display = 'none'
        var problemDetail = el('div')
        problem.appendChild(el('div', undefined, '查询失败'))
        problem.appendChild(problemDetail)

        // On-widget diagnostic: a failed snapshot fetch says so on the tablet
        // instead of leaving the placeholders silently stuck.
        var diag = el('div', 'dsh-pet-diag')
        diag.style.display = 'none'

        sprite.appendChild(screen)
        sprite.appendChild(diag)
        sprite.appendChild(problem)
        root.appendChild(fx)
        root.appendChild(sprite)
        return {
          root: root,
          fx: fx,
          sprite: sprite,
          screen: screen,
          money: money,
          clock: clock,
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
       * One paint per second: the price-window label, the clock, and the
       * balance the Host already resolved. The balance rides this snapshot, so
       * the page never talks to DeepSeek itself.
       *
       * Colour rule: only the price-window name is tinted — 谷价 green, 峰价
       * blue. The clock is always the same blue and never changes with the
       * window.
       */
      function applySnapshot(snapshot) {
        if (ui === null) return
        if (ui.diag !== undefined) ui.diag.style.display = 'none'
        var valley = snapshot.valley === true
        ui.clock.textContent =
          pad2(snapshot.hour) + ':' + pad2(snapshot.minute) + ':' + pad2(Math.floor((Date.now() % 60000) / 1000))
        ui.clock.style.color = CLOCK_COLOR
        ui.label.textContent = snapshot.label === '梁文谷' ? '梁文谷' : '梁文峰'
        ui.label.style.color = valley ? VALLEY_COLOR : PEAK_COLOR
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
          if (delta < 0) pushFloat('dollar', '-¥' + Math.abs(delta).toFixed(2))
          else pushFloat('heart', '❤')
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
        // Ask the Host for a fresh snapshot every 3 seconds; the clock still
        // repaints every tick from the last snapshot plus local seconds.
        if (lastFrame === null || tick % 3 === 0) {
          var url = versionedUrl(STATUS_URL)
          fetch(url, { cache: 'no-store' })
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + String(response.status) + ' @ ' + url)
              return response.json()
            })
            .then(function (snapshot) {
              lastFrame = snapshot
              if (ui !== null && ui.diag !== undefined) ui.diag.style.display = 'none'
            })
            .catch(function (error) {
              if (lastFrame === null) showDiag('快照读取失败：' + (error && error.message ? error.message : '未知错误'))
            })
        }
        if (lastFrame !== null) applySnapshot(lastFrame)
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
        ui.sprite.classList.add('dsh-pet-hang')
      }

      function onPointerMove(event) {
        if (drag === null || drag.id !== event.pointerId) return
        var dx = event.clientX - drag.startX
        var dy = event.clientY - drag.startY
        if (!moved && Math.abs(dx) + Math.abs(dy) > 6) {
          moved = true
          ui.sprite.classList.remove('dsh-pet-hang')
        }
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
        ui.sprite.classList.remove('dsh-pet-hang')
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
          if (event.animationName === 'dsh-pet-squish') ui.sprite.classList.remove('dsh-pet-squish')
        })
        // Undo every side effect on stop / update: the poll timer, the DOM node,
        // and the stylesheet link all belong to this plugin's fiber.
        ctx.effect(function () {
          return function () {
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
