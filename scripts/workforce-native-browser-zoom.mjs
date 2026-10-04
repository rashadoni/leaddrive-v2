import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

/** Hosted fixture only. Native browser page zoom; no app injection/emulation. */
export async function createNativeZoomContext(baseURL) {
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.CI, "true")
  assert.equal(process.env.WF_CALENDAR_BROWSER, "1")
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

export async function proveNative200Zoom(view, outputDirectory, locale) {
  assert.ok(["en", "ru", "az"].includes(locale))
  const targetURL = view.page.url()
  const target = new URL(targetURL)
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname))
  assert.equal(target.protocol, "http:")
  assert.equal(target.pathname, "/workforce/calendar")
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
  await view.page.screenshot({ path: `${outputDirectory}/native-zoom-${locale}-control-100.png` })
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
  await view.page.screenshot({ path: `${outputDirectory}/native-zoom-${locale}-observed-200.png` })
  return { method: "BROWSER_TABS_AUTOMATIC_PER_TAB_ZOOM", factor: change.factor,
    event: change.event, settings: change.settings, control: before, zoomed: after,
    viewportEmulation: false, applicationCssChanged: false, applicationServiceWorkers: 0 }
}
