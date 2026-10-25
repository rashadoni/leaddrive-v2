import { afterEach, describe, expect, it, vi } from "vitest"
import { parseTimeAppRelease, TIME_APP_CERTIFICATE, TIME_APP_CHANNEL, TIME_APP_PACKAGE, TIME_APP_STORE_URL } from "@/lib/mtm/time-app-release"
import manifest from "@/lib/mtm/time-app-release-manifest.json"

const release = {
  versionName: "1.0.1", versionCode: 1100, publishedAt: "2026-10-24T12:00:00Z",
  sourceSha: "a".repeat(40), sourceBranch: "main", apkSha256: "b".repeat(64),
  signingCertificateSha256: TIME_APP_CERTIFICATE, tag: "time-v1.0.1-1100",
  apkUrl: "https://github.com/rashadoni/leaddrive-mtm/releases/download/time-v1.0.1-1100/leaddrive-time-1.0.1-1100.apk",
}
const envelope = { schemaVersion: 1, packageName: TIME_APP_PACKAGE, channel: TIME_APP_CHANNEL, release }
afterEach(() => {
  vi.doUnmock("@/lib/mtm/time-app-release")
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("Time release boundary", () => {
  it("promotes the reviewed main-built Time 1048 release", () => {
    expect(parseTimeAppRelease(manifest)).toMatchObject({
      versionName: "1.0.0", versionCode: 1048,
      sourceSha: "32fe203d256d2928a67bd5f4a596ac58a2149775", sourceBranch: "main",
      signingCertificateSha256: TIME_APP_CERTIFICATE,
      tag: "time-v1.0.0-1048",
      apkUrl: "https://github.com/rashadoni/leaddrive-mtm/releases/download/time-v1.0.0-1048/leaddrive-time-1.0.0-1048.apk",
    })
  })
  it("accepts a complete separately identified Time manifest", () => {
    expect(parseTimeAppRelease(envelope)).toEqual(release)
  })
  it.each([
    { packageName: "com.mtmobileapp" }, { channel: "field-stable" }, { schemaVersion: 2 }, { release: null },
  ])("rejects a foreign or missing release envelope: %j", patch => {
    expect(parseTimeAppRelease({ ...envelope, ...patch })).toBeNull()
  })
  it.each([
    { sourceBranch: "codex/attendance-standalone" }, { sourceSha: "latest" },
    { signingCertificateSha256: "c".repeat(64) }, { apkSha256: null },
    { versionCode: "1100" }, { versionCode: 0 }, { versionCode: 1.1 }, { versionName: "latest" },
    { publishedAt: "yesterday" }, { tag: "v3.11.53-build795" },
    { apkUrl: "https://github.com/rashadoni/leaddrive-mtm/releases/download/v3.11.53-build795/leaddrive-mtm-v3.11.53.apk" },
    { apkUrl: `${release.apkUrl}?redirect=field` }, { apkUrl: release.apkUrl.replace("github.com", "example.org") },
  ])("rejects unsafe or unbound artifact metadata: %j", patch => {
    expect(parseTimeAppRelease({ ...envelope, release: { ...release, ...patch } })).toBeNull()
  })
})

async function mockRelease(value: typeof release | null) {
  vi.doMock("@/lib/mtm/time-app-release", async importOriginal => ({
    ...await importOriginal<object>(), latestTimeAppRelease: () => value,
  }))
}

describe("public Time routes", () => {
  it("serves the promoted manifest through both real public routes", async () => {
    vi.stubEnv("TIME_APP_STORE_URL", "")
    const latest = await import("@/app/api/v1/public/time-app/latest/route")
    const response = await latest.GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      packageName: TIME_APP_PACKAGE, channel: TIME_APP_CHANNEL,
      versionCode: 1048, versionName: "1.0.0",
      apkSha256: manifest.release.apkSha256,
      downloadUrl: "https://app.leaddrivecrm.org/time/download", storeUrl: null,
    })
    const download = await import("@/app/time/download/route")
    const redirect = await download.GET()
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("Location")).toBe(manifest.release.apkUrl)
    expect(redirect.headers.get("Cache-Control")).toBe("no-store")
  })
  it("returns a typed unavailable response without a download or Field fallback", async () => {
    await mockRelease(null)
    const latest = await import("@/app/api/v1/public/time-app/latest/route")
    const download = await import("@/app/time/download/route")
    for (const route of [latest, download]) {
      const response = await route.GET()
      expect(response.status).toBe(503)
      expect(response.headers.get("Cache-Control")).toBe("no-store")
      expect(response.headers.get("Location")).toBeNull()
      const body = await response.json()
      expect(body.code).toBe("TIME_APP_RELEASE_UNAVAILABLE")
      expect(body.downloadUrl).toBeUndefined()
    }
  })
  it("exposes the Time contract and redirects only to its pinned APK", async () => {
    await mockRelease(release)
    vi.stubEnv("TIME_APP_STORE_URL", "")
    // A mismatched CRM base cannot move a phone off the approved Time host.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.org")
    const latest = await import("@/app/api/v1/public/time-app/latest/route")
    const response = await latest.GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      packageName: TIME_APP_PACKAGE, channel: TIME_APP_CHANNEL,
      versionCode: 1100, versionName: "1.0.1", signingCertificateSha256: TIME_APP_CERTIFICATE,
      downloadUrl: "https://app.leaddrivecrm.org/time/download", pageUrl: "https://app.leaddrivecrm.org/time", storeUrl: null,
    })
    const download = await import("@/app/time/download/route")
    const redirect = await download.GET()
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("Location")).toBe(release.apkUrl)
    expect(redirect.headers.get("Cache-Control")).toBe("no-store")
  })
  it.each(["https://play.google.com/store/apps/details?id=com.mtmobileapp", "https://example.org", ""]) (
    "does not enable a foreign or unavailable Play destination: %s", async url => {
      await mockRelease(release)
      vi.stubEnv("TIME_APP_STORE_URL", url)
      const { GET } = await import("@/app/api/v1/public/time-app/latest/route")
      expect((await (await GET()).json()).storeUrl).toBeNull()
    },
  )
  it("allows only the exact Time Play listing when explicitly configured", async () => {
    await mockRelease(release)
    vi.stubEnv("TIME_APP_STORE_URL", TIME_APP_STORE_URL)
    const { GET } = await import("@/app/api/v1/public/time-app/latest/route")
    expect((await (await GET()).json()).storeUrl).toBe(TIME_APP_STORE_URL)
  })
})
