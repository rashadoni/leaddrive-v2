/**
 * What the service worker downloads ahead of time: nothing of the build, only `/offline`
 * (added separately through `additionalPrecacheEntries` in next.config.ts).
 *
 * Until 2026-11-12 the worker precached every file of the build — 2 437 files, ~30 MB — and a new
 * build is a new worker, so after EVERY deploy each open browser fetched the whole application again
 * in the background. On 12.11 (10+ deploys) the owner's Mac fetched 20 718 files, 247 MB, and pages
 * and data waited behind that queue (owner: «почему сайт долго грузится… может мы что-то не
 * оптимизировали»). Files are now cached as pages are opened (`defaultCache` in src/sw.ts: CacheFirst
 * for `/_next/static` JS, StaleWhileRevalidate for CSS, fonts, images), and the hashed files keep
 * their year-long immutable HTTP cache. Offline, a page opened before still opens; any other shows
 * `/offline`.
 */
import type { ManifestTransform } from "@serwist/build"

export const precacheOfflineOnly: ManifestTransform = async (entries) => ({
  manifest: entries.filter((entry) => entry.url === "/offline"),
  warnings: [],
})
