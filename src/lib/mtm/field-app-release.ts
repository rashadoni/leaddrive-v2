/**
 * The newest LeadDrive Route Field build that agents may install outside
 * Google Play (owner, 2026-10-19: until Play accepts the organization account,
 * clients get one link, and the app itself offers the update when it opens).
 *
 * The source is the release list of rashadoni/leaddrive-mtm: build-apk.yml
 * publishes every build as a pre-release, the APK plus the Play bundle whose
 * name carries the versionCode (`leaddrive-mtm-v3.11.32-1634.aab`). Only builds
 * of `main` count — the release notes say «(branch main)». A build of a
 * working branch may carry code that was never approved or was reverted, so it
 * is never handed to an agent.
 *
 * Read over the public GitHub API and kept for ten minutes; a failed read
 * keeps the last good answer for a day rather than telling every phone there
 * is nothing to install.
 */

export const FIELD_APP_RELEASES_REPO = "rashadoni/leaddrive-mtm"

export type FieldAppRelease = {
  versionName: string
  versionCode: number
  apkUrl: string
  publishedAt: string
  sha256: string | null
  tag: string
}

type GithubAsset = { name?: unknown; browser_download_url?: unknown }
type GithubRelease = {
  tag_name?: unknown
  body?: unknown
  draft?: unknown
  published_at?: unknown
  created_at?: unknown
  assets?: unknown
}

const APK_NAME = /^leaddrive-mtm-v(\d+\.\d+\.\d+)\.apk$/
const AAB_NAME = /^leaddrive-mtm-v(\d+\.\d+\.\d+)-(\d+)\.aab$/
const MAIN_BUILD = /\(branch main\)/
const DOWNLOAD_PREFIX = `https://github.com/${FIELD_APP_RELEASES_REPO}/releases/download/`

/** The newest main build in a GitHub release list, or null. Pure, for tests. */
export function pickFieldAppRelease(releases: unknown): FieldAppRelease | null {
  if (!Array.isArray(releases)) return null
  let best: FieldAppRelease | null = null
  for (const raw of releases as GithubRelease[]) {
    if (!raw || raw.draft === true) continue
    const body = typeof raw.body === "string" ? raw.body : ""
    if (!MAIN_BUILD.test(body)) continue
    const assets = Array.isArray(raw.assets) ? (raw.assets as GithubAsset[]) : []
    const names = assets.map((asset) => (typeof asset?.name === "string" ? asset.name : ""))
    const bundle = names.map((name) => AAB_NAME.exec(name)).find((match) => match !== null)
    if (!bundle) continue
    const versionName = bundle[1]
    const versionCode = Number(bundle[2])
    if (!Number.isSafeInteger(versionCode) || versionCode <= 0) continue
    // The APK must be the same version as the bundle that names the code.
    const apk = assets.find((asset) => {
      const match = typeof asset?.name === "string" ? APK_NAME.exec(asset.name) : null
      return match !== null && match[1] === versionName
    })
    const apkUrl = typeof apk?.browser_download_url === "string" ? apk.browser_download_url : ""
    if (!apkUrl.startsWith(DOWNLOAD_PREFIX)) continue
    const publishedAt = typeof raw.published_at === "string" ? raw.published_at
      : typeof raw.created_at === "string" ? raw.created_at : ""
    if (!Number.isFinite(Date.parse(publishedAt))) continue
    if (best && best.versionCode >= versionCode) continue
    best = {
      versionName,
      versionCode,
      apkUrl,
      publishedAt,
      sha256: /SHA-256: ([0-9a-f]{64})/.exec(body)?.[1] ?? null,
      tag: typeof raw.tag_name === "string" ? raw.tag_name : "",
    }
  }
  return best
}

const FRESH_MS = 10 * 60_000
const STALE_MS = 24 * 60 * 60_000

let cached: { at: number; value: FieldAppRelease } | null = null
let inflight: Promise<FieldAppRelease | null> | null = null

async function readReleases(fetchImpl: typeof fetch): Promise<FieldAppRelease | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "leaddrive-crm-field-app",
  }
  const response = await fetchImpl(`https://api.github.com/repos/${FIELD_APP_RELEASES_REPO}/releases?per_page=50`, {
    headers,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`GitHub releases: ${response.status}`)
  return pickFieldAppRelease(await response.json())
}

/** The newest main build, from a ten-minute cache. Null when none is known. */
export async function latestFieldAppRelease(
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<FieldAppRelease | null> {
  if (cached && now - cached.at < FRESH_MS) return cached.value
  if (!inflight) {
    inflight = readReleases(fetchImpl)
      .then((value) => {
        if (value) cached = { at: Date.now(), value }
        return value
      })
      .catch((error) => {
        console.warn("[field-app-release] read failed", error instanceof Error ? error.message : "unknown")
        return null
      })
      .finally(() => { inflight = null })
  }
  const fresh = await inflight
  if (fresh) return fresh
  // GitHub did not answer: the last good build is still the right one to offer.
  return cached && now - cached.at < STALE_MS ? cached.value : null
}

/** Tests only: forget the cache between cases. */
export function resetFieldAppReleaseCacheForTests() {
  cached = null
  inflight = null
}
