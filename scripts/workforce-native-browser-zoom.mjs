import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const ownedContexts = new WeakMap()
const controlSurfaces = new WeakMap()

export const isNativeZoomPage = page => ownedContexts.has(page.context())

/** Hosted fixture only. Native browser page zoom; no app injection/emulation. */
export async function createNativeZoomContext(baseURL, fixture = "calendar") {
  assert.ok(["calendar", "manager-today"].includes(fixture), "Exact native fixture required")
  const route = fixture === "calendar" ? "/workforce/calendar" : "/workforce"
  const optIn = fixture === "calendar" ? "WF_CALENDAR_BROWSER" : "WF_MANAGER_TODAY_BROWSER"
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.CI, "true")
  assert.equal(process.env[optIn], "1")
  assert.equal(process.env.LEADDRIVE_DISABLE_SERVICE_WORKER, "1")
  assert.notEqual(process.env.NODE_ENV, "production")
  const origin = new URL(baseURL)
  assert.equal(origin.protocol, "http:")
  assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname))
  assert.equal(origin.pathname, "/")
  assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
  const extension = fileURLToPath(new URL("./ci/fixtures/workforce-native-zoom-extension", import.meta.url))
  const profile = await mkdtemp(join(tmpdir(), "workforce-native-zoom-"))
  let context
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, baseURL, locale: "en-US", viewport: null,
      args: ["--window-size=640,1688", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const extensionWorker = worker => worker.url().startsWith("chrome-extension://")
    const worker = context.serviceWorkers().find(extensionWorker)
      ?? await context.waitForEvent("serviceworker", { predicate: extensionWorker, timeout: 30_000 })
    ownedContexts.set(context, { origin: origin.origin, route, fixture })
    return { context, worker, dispose: async () => {
      try { await context.close() } finally { await rm(profile, { recursive: true, force: true }) }
    } }
  } catch (error) {
    try { await context?.close() } finally { await rm(profile, { recursive: true, force: true }) }
    throw error
  }
}

const metrics = page => page.evaluate(() => ({
  width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio,
  visualViewportScale: window.visualViewport?.scale,
  rootZoom: getComputedStyle(document.documentElement).zoom, bodyZoom: getComputedStyle(document.body).zoom,
  rootTransform: getComputedStyle(document.documentElement).transform, bodyTransform: getComputedStyle(document.body).transform,
}))

// Runs as a read-only browser probe. Preserve the actual node identities:
// window scroll alone cannot represent the dashboard's scrolling main.
function captureState({ focused, scrollNodes }) {
  const current = new Set([document.documentElement, document.body])
  for (const target of [...document.querySelectorAll("main"), focused]) {
    for (let node = target; node; node = node.parentElement) current.add(node)
  }
  const nodes = [...current]
  if (!scrollNodes) return nodes
  const number = value => Number.isFinite(value) ? value : null
  return {
    scrollX: window.scrollX, scrollY: window.scrollY,
    visualViewportWidth: window.visualViewport?.width, visualViewportHeight: window.visualViewport?.height,
    visualViewportOffsetLeft: window.visualViewport?.offsetLeft, visualViewportOffsetTop: window.visualViewport?.offsetTop,
    sameFocusedElement: document.activeElement === focused,
    focusVisible: document.activeElement?.matches(":focus-visible") ?? false,
    sameScrollNodes: nodes.length === scrollNodes.length && nodes.every((node, index) => node === scrollNodes[index]),
    scrollContainers: scrollNodes.map(node => ({
      tag: node.tagName, connected: node.isConnected,
      scrollLeft: number(node.scrollLeft), scrollTop: number(node.scrollTop),
      clientWidth: number(node.clientWidth), clientHeight: number(node.clientHeight),
      scrollWidth: number(node.scrollWidth), scrollHeight: number(node.scrollHeight),
    })),
  }
}

// Native page zoom changes CSS pixels without changing the physical window.
// Omit regional clip coordinates, whose units differ from the CSS viewport.
// Save original PNG bytes before validating them; never resize or crop them.
export async function captureNativeViewport(page, path, record, control = false) {
  assert.ok(isNativeZoomPage(page), "Only an owned native fixture context may use CDP capture")
  const target = new URL(page.url())
  const owned = ownedContexts.get(page.context())
  assert.equal(target.origin, owned.origin)
  assert.equal(target.pathname, owned.route)
  assert.equal(target.username + target.password + target.search + target.hash, "")
  assert.match(basename(path), /^[a-z0-9-]+\.png$/)
  const diagnostic = { screenshot: basename(path), method: "CDP_VISIBLE_SURFACE_NO_CLIP", suppliedClip: false, control, status: "FAIL" }
  let session, focused, scrollNodes, timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Native visible-surface capture timed out")), 15_000)
  })
  const bounded = operation => Promise.race([operation, deadline])
  const state = async () => ({ ...await metrics(page), ...await page.evaluate(captureState, { focused, scrollNodes }) })
  const layout = async () => {
    const result = await session.send("Page.getLayoutMetrics")
    const selected = {}
    for (const field of ["layoutViewport", "visualViewport", "cssLayoutViewport", "cssVisualViewport"]) {
      selected[field] = {}
      for (const key of ["pageX", "pageY", "offsetX", "offsetY", "clientWidth", "clientHeight", "scale", "zoom"]) {
        if (Number.isFinite(result[field]?.[key])) selected[field][key] = result[field][key]
      }
    }
    return selected
  }
  try {
    focused = await bounded(page.evaluateHandle(() => document.activeElement))
    assert.ok(focused.asElement(), "Native capture requires a focused DOM element")
    scrollNodes = await bounded(page.evaluateHandle(captureState, { focused }))
    assert.ok(await bounded(scrollNodes.evaluate(nodes => nodes.length <= 64)), "Native capture node binding must remain bounded")
    session = await bounded(page.context().newCDPSession(page))
    diagnostic.before = await bounded(state())
    assert.equal(diagnostic.before.sameFocusedElement, true, "Native capture must begin with its bound focused element")
    assert.equal(diagnostic.before.sameScrollNodes, true, "Native capture must begin with its bound scrolling nodes")
    assert.ok(diagnostic.before.scrollContainers.every(node => node.connected
      && ["scrollLeft", "scrollTop", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"].every(key => Number.isFinite(node[key]))),
    "Native capture requires connected scrolling nodes with finite dimensions")
    diagnostic.layoutBefore = await bounded(layout())
    const screenshot = await bounded(session.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false,
    }))
    const bytes = Buffer.from(screenshot.data, "base64")
    await bounded(writeFile(path, bytes))
    diagnostic.original = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
    assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR")
    const pixels = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    diagnostic.pixels = pixels
    diagnostic.after = await bounded(state())
    diagnostic.layoutAfter = await bounded(layout())
    assert.deepEqual(diagnostic.after, diagnostic.before, "Capture must preserve viewport, zoom, scroll and focus")
    assert.deepEqual(diagnostic.layoutAfter, diagnostic.layoutBefore, "Capture must preserve CDP viewport metrics")
    const { width, height, devicePixelRatio } = diagnostic.before
    assert.ok([1, 2].includes(devicePixelRatio))
    assert.equal(pixels.width, width * devicePixelRatio)
    // innerHeight is an integer. An unchanged 1601-pixel surface at 200%
    // has innerHeight800; this pixel rounding does not alter focus criteria.
    diagnostic.cssIntegerHeightRoundingBoundPixels = devicePixelRatio
    assert.ok(Math.abs(pixels.height - height * devicePixelRatio) <= devicePixelRatio)
    if (control) {
      assert.equal(devicePixelRatio, 1)
      assert.equal(width, 640)
      assert.equal(controlSurfaces.has(page), false)
      controlSurfaces.set(page, pixels)
    }
    diagnostic.controlSurface = controlSurfaces.get(page)
    assert.ok(diagnostic.controlSurface, "Native capture requires its own validated 100% control")
    assert.deepEqual(pixels, diagnostic.controlSurface, "Native zoom must preserve the original physical window")
    diagnostic.status = "PASS"
  } finally {
    clearTimeout(timer)
    let cleanupFailed = false
    for (const cleanup of [() => session?.detach(), () => focused?.dispose(), () => scrollNodes?.dispose()]) {
      let cleanupTimer
      try {
        await Promise.race([cleanup(), new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error("Native capture cleanup timed out")), 5_000)
        })])
      } catch { cleanupFailed = true } finally { clearTimeout(cleanupTimer) }
    }
    diagnostic.cleanup = cleanupFailed ? "FAIL" : "PASS"
    if (cleanupFailed) diagnostic.status = "FAIL"
    record(diagnostic)
    assert.equal(cleanupFailed, false, "Native capture session cleanup must succeed")
  }
}

export async function proveNative200Zoom(view, outputDirectory, locale, record) {
  assert.ok(["en", "ru", "az"].includes(locale))
  assert.ok(isNativeZoomPage(view.page), "Only an owned native fixture context may prove zoom")
  const owned = ownedContexts.get(view.page.context())
  const targetURL = view.page.url()
  const target = new URL(targetURL)
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname))
  assert.equal(target.protocol, "http:")
  assert.equal(target.origin, owned.origin)
  assert.equal(target.pathname, owned.route)
  assert.equal(target.username + target.password + target.search + target.hash, "")
  const setup = await view.worker.evaluate(async url => {
    const tabs = (await globalThis.chrome.tabs.query({})).filter(tab => tab.url === url)
    if (tabs.length !== 1 || !Number.isInteger(tabs[0].id)) throw new Error("Native zoom requires one exact fixture tab")
    const tabId = tabs[0].id
    await globalThis.chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" })
    await globalThis.chrome.tabs.setZoom(tabId, 1)
    return { tabId, factor: await globalThis.chrome.tabs.getZoom(tabId), settings: await globalThis.chrome.tabs.getZoomSettings(tabId) }
  }, targetURL)
  assert.equal(setup.factor, 1)
  assert.equal(setup.settings.mode, "automatic")
  assert.equal(setup.settings.scope, "per-tab")
  await view.page.waitForFunction(() => window.devicePixelRatio === 1 && window.innerWidth === 640)
  const before = await metrics(view.page)
  assert.equal(before.width, 640)
  assert.equal(before.devicePixelRatio, 1)
  assert.equal(before.visualViewportScale, 1)
  assert.ok(before.height >= 800)
  assert.equal(await view.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0)
  await captureNativeViewport(view.page, `${outputDirectory}/native-zoom-${locale}-control-100.png`, record, true)
  const change = await view.worker.evaluate(async tabId => {
    const chrome = globalThis.chrome
    let listener, timer
    const observed = new Promise((resolve, reject) => {
      listener = event => {
        if (event.tabId === tabId && event.newZoomFactor === 2) resolve({
          oldFactor: event.oldZoomFactor, newFactor: event.newZoomFactor,
          settings: event.zoomSettings,
        })
      }
      chrome.tabs.onZoomChange.addListener(listener)
      timer = setTimeout(() => reject(new Error("Native browser zoom event not observed")), 10_000)
    })
    // Attach the rejection observer before awaiting the API operation.
    const completed = observed.then(value => ({ value }), () => ({ failed: true }))
    try {
      await chrome.tabs.setZoom(tabId, 2)
      const event = await completed
      if (event.failed) throw new Error("Native browser zoom event not observed")
      return { event: event.value, factor: await chrome.tabs.getZoom(tabId), settings: await chrome.tabs.getZoomSettings(tabId) }
    } finally {
      clearTimeout(timer)
      chrome.tabs.onZoomChange.removeListener(listener)
    }
  }, setup.tabId)
  assert.equal(change.factor, 2)
  assert.equal(change.event.oldFactor, 1)
  assert.equal(change.event.newFactor, 2)
  for (const settings of [change.settings, change.event.settings]) {
    assert.equal(settings.mode, "automatic")
    assert.equal(settings.scope, "per-tab")
  }
  await view.page.waitForFunction(() => window.devicePixelRatio === 2 && window.innerWidth === 320)
  const after = await metrics(view.page)
  assert.equal(after.width, 320)
  assert.equal(after.devicePixelRatio, before.devicePixelRatio * 2)
  assert.ok(Math.abs(after.height * 2 - before.height) <= 2)
  assert.equal(after.visualViewportScale, before.visualViewportScale)
  for (const field of ["rootZoom", "bodyZoom", "rootTransform", "bodyTransform"]) assert.equal(after[field], before[field])
  assert.ok(["1", "normal"].includes(after.rootZoom) && ["1", "normal"].includes(after.bodyZoom))
  assert.equal(after.rootTransform, "none")
  assert.equal(after.bodyTransform, "none")
  await captureNativeViewport(view.page, `${outputDirectory}/native-zoom-${locale}-observed-200.png`, record)
  return { method: "BROWSER_TABS_AUTOMATIC_PER_TAB_ZOOM", fixture: owned.fixture, factor: change.factor,
    event: change.event, settings: change.settings, control: before, zoomed: after,
    viewportEmulation: false, applicationCssChanged: false, applicationServiceWorkers: 0 }
}
