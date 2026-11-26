import { afterEach, describe, expect, it, vi } from "vitest"
import {
  latestFieldAppRelease,
  pickFieldAppRelease,
  resetFieldAppReleaseCacheForTests,
} from "@/lib/mtm/field-app-release"

const DL = "https://github.com/rashadoni/leaddrive-mtm/releases/download"

function release(tag: string, version: string, code: number, branch: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    published_at: "2026-10-18T20:08:28Z",
    body: `CI build of abc (branch ${branch}). SHA-256: ${"a".repeat(64)}`,
    assets: [
      { name: `leaddrive-mtm-v${version}.apk`, browser_download_url: `${DL}/${tag}/leaddrive-mtm-v${version}.apk` },
      { name: `leaddrive-mtm-v${version}.apk.sha256`, browser_download_url: `${DL}/${tag}/leaddrive-mtm-v${version}.apk.sha256` },
      { name: `leaddrive-mtm-v${version}-${code}.aab`, browser_download_url: `${DL}/${tag}/leaddrive-mtm-v${version}-${code}.aab` },
    ],
    ...extra,
  }
}

afterEach(() => {
  resetFieldAppReleaseCacheForTests()
  vi.restoreAllMocks()
})

describe("pickFieldAppRelease", () => {
  it("gives the newest build of main, never a newer working-branch build", () => {
    const picked = pickFieldAppRelease([
      release("v3.11.33-build640", "3.11.33", 1640, "claude/experiment"),
      release("v3.11.32-build634", "3.11.32", 1634, "main"),
      release("v3.11.31-build627", "3.11.31", 1627, "main"),
    ])
    expect(picked).toEqual({
      versionName: "3.11.32",
      versionCode: 1634,
      apkUrl: `${DL}/v3.11.32-build634/leaddrive-mtm-v3.11.32.apk`,
      publishedAt: "2026-10-18T20:08:28Z",
      sha256: "a".repeat(64),
      tag: "v3.11.32-build634",
    })
  })

  it("orders by the build number, not by the position in the list", () => {
    const picked = pickFieldAppRelease([
      release("v3.11.31-build627", "3.11.31", 1627, "main"),
      release("v3.11.32-build634", "3.11.32", 1634, "main"),
    ])
    expect(picked?.versionCode).toBe(1634)
  })

  it("skips drafts, builds without a bundle and an APK of another version", () => {
    const draft = release("v3.11.40-build700", "3.11.40", 1700, "main", { draft: true })
    const noBundle = release("v3.11.39-build690", "3.11.39", 1690, "main")
    noBundle.assets = noBundle.assets.filter((asset) => !asset.name.endsWith(".aab"))
    const mismatched = release("v3.11.38-build680", "3.11.38", 1680, "main")
    mismatched.assets[0] = { name: "leaddrive-mtm-v3.11.37.apk", browser_download_url: `${DL}/x/leaddrive-mtm-v3.11.37.apk` }
    const good = release("v3.11.32-build634", "3.11.32", 1634, "main")
    expect(pickFieldAppRelease([draft, noBundle, mismatched, good])?.versionCode).toBe(1634)
  })

  it("never hands out a download address outside the app's own releases", () => {
    const foreign = release("v3.11.50-build800", "3.11.50", 1800, "main")
    foreign.assets[0] = { name: "leaddrive-mtm-v3.11.50.apk", browser_download_url: "https://example.com/leaddrive-mtm-v3.11.50.apk" }
    expect(pickFieldAppRelease([foreign])).toBeNull()
  })

  it("answers null for anything that is not a release list", () => {
    expect(pickFieldAppRelease({ message: "API rate limit exceeded" })).toBeNull()
    expect(pickFieldAppRelease(null)).toBeNull()
  })
})

describe("latestFieldAppRelease", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it("asks GitHub once per ten minutes", async () => {
    const fetchImpl = vi.fn(async () => ok([release("v3.11.32-build634", "3.11.32", 1634, "main")]))
    const now = Date.now()
    expect((await latestFieldAppRelease(now, fetchImpl as unknown as typeof fetch))?.versionCode).toBe(1634)
    expect((await latestFieldAppRelease(now + 5 * 60_000, fetchImpl as unknown as typeof fetch))?.versionCode).toBe(1634)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps offering the last good build when GitHub does not answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const now = Date.now()
    await latestFieldAppRelease(now, (async () => ok([release("v3.11.32-build634", "3.11.32", 1634, "main")])) as unknown as typeof fetch)
    const failing = (async () => new Response("down", { status: 502 })) as unknown as typeof fetch
    expect((await latestFieldAppRelease(now + 11 * 60_000, failing))?.versionCode).toBe(1634)
  })

  it("answers null when nothing has ever been read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const failing = (async () => { throw new Error("offline") }) as unknown as typeof fetch
    expect(await latestFieldAppRelease(Date.now(), failing)).toBeNull()
  })
})

describe("GET /api/v1/public/field-app/latest", () => {
  it("tells the app the newest version and the stable download address", async () => {
    vi.resetModules()
    vi.doMock("@/lib/mtm/field-app-release", () => ({
      FIELD_APP_PLAY_RELEASE: null,
      FIELD_APP_STORE_URL: "https://play.google.com/store/apps/details?id=com.mtmobileapp",
      latestFieldAppRelease: async () => ({
        versionName: "3.11.32", versionCode: 1634, apkUrl: `${DL}/t/a.apk`, publishedAt: "2026-10-18T20:08:28Z", sha256: null, tag: "t",
      }),
    }))
    const { GET } = await import("@/app/api/v1/public/field-app/latest/route")
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.versionCode).toBe(1634)
    expect(body.versionName).toBe("3.11.32")
    expect(body.downloadUrl).toMatch(/\/field\/download$/)
    expect(body.storeUrl).toBeNull()
    vi.doUnmock("@/lib/mtm/field-app-release")
  })

  it("names the store's version, not a newer build of main, once the app is in Google Play", async () => {
    // A build of main that Google has not reviewed yet must not make the app
    // ask people to update to something the store does not offer.
    vi.resetModules()
    const latest = vi.fn(async () => ({
      versionName: "3.11.95", versionCode: 2080, apkUrl: `${DL}/t/a.apk`, publishedAt: "2026-11-30T10:00:00Z", sha256: null, tag: "t",
    }))
    vi.doMock("@/lib/mtm/field-app-release", () => ({
      FIELD_APP_PLAY_RELEASE: { versionName: "3.11.90", versionCode: 2068 },
      FIELD_APP_STORE_URL: "https://play.google.com/store/apps/details?id=com.mtmobileapp",
      latestFieldAppRelease: latest,
    }))
    const { GET } = await import("@/app/api/v1/public/field-app/latest/route")
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      versionName: "3.11.90",
      versionCode: 2068,
      storeUrl: "https://play.google.com/store/apps/details?id=com.mtmobileapp",
    })
    // GitHub is not even asked: an outage there must not hide the store's answer.
    expect(latest).not.toHaveBeenCalled()
    vi.doUnmock("@/lib/mtm/field-app-release")
  })

  it("pins a store version the app accepts", async () => {
    const { FIELD_APP_PLAY_RELEASE, FIELD_APP_STORE_URL } = await vi.importActual<typeof import("@/lib/mtm/field-app-release")>("@/lib/mtm/field-app-release")
    // The app trusts only this address and a «x.y.z» name (field-app-update-policy.ts).
    expect(FIELD_APP_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.mtmobileapp")
    if (FIELD_APP_PLAY_RELEASE) {
      expect(FIELD_APP_PLAY_RELEASE.versionName).toMatch(/^\d+\.\d+\.\d+$/)
      expect(Number.isSafeInteger(FIELD_APP_PLAY_RELEASE.versionCode)).toBe(true)
    }
  })

  it("says unavailable instead of inventing a version", async () => {
    vi.resetModules()
    vi.doMock("@/lib/mtm/field-app-release", () => ({
      FIELD_APP_PLAY_RELEASE: null,
      FIELD_APP_STORE_URL: "https://play.google.com/store/apps/details?id=com.mtmobileapp",
      latestFieldAppRelease: async () => null,
    }))
    const { GET } = await import("@/app/api/v1/public/field-app/latest/route")
    const response = await GET()
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe("FIELD_APP_RELEASE_UNAVAILABLE")
    vi.doUnmock("@/lib/mtm/field-app-release")
  })
})
