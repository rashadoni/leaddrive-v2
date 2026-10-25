import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import az from "../../messages/az.json"
import ru from "../../messages/ru.json"
import en from "../../messages/en.json"
import type { TimeAppRelease } from "@/lib/mtm/time-app-release"

const state = vi.hoisted(() => ({ locale: "az" as "az" | "ru" | "en", release: null as TimeAppRelease | null }))
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async () => (key: string, values: Record<string, string> = {}) => {
    const copy = { az, ru, en }[state.locale].timeAppDownload
    const message = copy[key as keyof typeof copy]
    if (!message) throw new Error(`Missing translation ${state.locale}.${key}`)
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? "")
  },
}))
vi.mock("@/lib/mtm/time-app-release", () => ({ latestTimeAppRelease: () => state.release }))
import TimeAppDownloadPage, { generateMetadata } from "@/app/time/page"

function capturePreview(html: string, locale: string, mode: "unavailable" | "accepted-fixture") {
  const directory = process.env.TIME_APP_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${locale}-${mode}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Time ${mode} — review preview</title></head><body>${html}</body></html>`)
}

afterEach(() => { state.release = null })
describe("rendered Time download page", () => {
  it.each(["az", "ru", "en"] as const)("renders truthful %s no-release copy and language links without a download button", async locale => {
    state.locale = locale
    const html = renderToStaticMarkup(await TimeAppDownloadPage())
    capturePreview(html, locale, "unavailable")
    expect(html).toContain({ az, ru, en }[locale].timeAppDownload.unavailable)
    expect(html).toContain('role="status"')
    expect(html).not.toContain('href="/time/download"')
    expect(html).not.toContain("/field")
    for (const lang of ["az", "ru", "en"]) expect(html).toContain(`href="/time?lang=${lang}"`)
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false })
  })
  it.each(["az", "ru", "en"] as const)("renders only an accepted Time download and version in %s", async locale => {
    state.locale = locale
    // Test fixture only. The committed public manifest remains release=null.
    state.release = {
      versionName: "1.0.1", versionCode: 1100, publishedAt: "2026-10-24T12:00:00Z",
      sourceSha: "a".repeat(40), sourceBranch: "main", apkSha256: "b".repeat(64),
      signingCertificateSha256: "c".repeat(64), tag: "test", apkUrl: "https://example.invalid/test-only.apk",
    }
    const html = renderToStaticMarkup(await TimeAppDownloadPage())
    capturePreview(html, locale, "accepted-fixture")
    expect(html).toContain('href="/time/download"')
    expect(html).toContain({ az, ru, en }[locale].timeAppDownload.download)
    expect(html).toContain("1.0.1")
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain("/field")
  })
})
