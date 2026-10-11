import {
  BASEMAP_PROVIDER_PATH,
  CARTO_ONLY,
  basemapProviderFromAnswer,
  basemapProviderFromDocument,
  sameBasemapProvider,
  type BasemapProvider,
} from "@/lib/mtm/basemap-provider"

/**
 * What the deployment says about its tile providers, as the page knows it NOW.
 *
 * The document's <meta> (src/app/layout.tsx) says it at the moment the page
 * was loaded, and that is enough to draw the first map without asking
 * anybody. But this application is navigated without reloading, and an
 * installed one keeps the same document for days — so an operator who makes
 * the backup the background (because CARTO started answering with «API KEY
 * REQUIRED» tiles) would reach nobody who already had the app open.
 *
 * So a page with a map asks the server again: when a map is drawn (at most
 * once a minute, and not within the first minute of the page's life — its
 * own tag is that fresh) and every five minutes while a map is on a visible
 * screen. A map follows the answer where it stands — no reload. A question
 * that fails changes nothing: what the page knew stays.
 *
 * Browser only; the pure rules are in basemap-provider.ts.
 */

export const BASEMAP_PROVIDER_ASK_AGAIN_MS = 60_000
export const BASEMAP_PROVIDER_REFRESH_MS = 5 * 60_000

let current: BasemapProvider | null = null
/** When the page last learnt it — from its own document at first, then from the server. */
let askedAt: number | null = null
let asking = false
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

/** What the page knows now; a stable object until the server says otherwise. */
export function basemapProviderSnapshot(): BasemapProvider {
  current ??= basemapProviderFromDocument()
  return current
}

/** On the server there is no page to ask and no map to draw. */
export function basemapProviderServerSnapshot(): BasemapProvider {
  return CARTO_ONLY
}

/**
 * Asks the server what it says now. Not more often than once a minute however
 * many maps a screen has, and never two questions at once.
 */
export async function refreshBasemapProvider(now: number = Date.now()): Promise<void> {
  // The document was written when the page was loaded: that long ago, not «never».
  askedAt ??= typeof performance === "undefined" ? now : Date.now() - performance.now()
  if (asking || now - askedAt < BASEMAP_PROVIDER_ASK_AGAIN_MS) return
  asking = true
  askedAt = now
  try {
    const response = await fetch(BASEMAP_PROVIDER_PATH, { cache: "no-store", credentials: "omit" })
    if (!response.ok) return
    const said = basemapProviderFromAnswer(await response.json())
    if (!sameBasemapProvider(said, basemapProviderSnapshot())) {
      current = said
      for (const listener of [...listeners]) listener()
    }
  } catch {
    // No connection, or an answer that is not one: the page keeps what it knew.
  } finally {
    asking = false
  }
}

export function subscribeBasemapProvider(listener: () => void): () => void {
  listeners.add(listener)
  if (timer == null && typeof window !== "undefined") {
    timer = setInterval(() => {
      // A screen nobody looks at asks nothing; it asks when a map is drawn again.
      if (typeof document === "undefined" || document.visibilityState === "visible") void refreshBasemapProvider()
    }, BASEMAP_PROVIDER_REFRESH_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** For tests: a page as if it had just been loaded. */
export function resetBasemapProviderStoreForTests(): void {
  current = null
  askedAt = null
  asking = false
  if (timer != null) clearInterval(timer)
  timer = null
  listeners.clear()
}
