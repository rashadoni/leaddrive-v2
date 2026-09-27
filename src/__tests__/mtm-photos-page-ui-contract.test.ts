import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Prod audit 2026-09-14: /mtm/photos opened on a wall of broken images. */
describe("MTM photos page", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/photos/page.tsx", "utf8")
  const locales = ["en", "ru", "az"].map((locale) =>
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmPhotosPage)

  it("replaces a missing file with a labelled tile instead of a broken image", () => {
    expect(page).toContain("onFinalError={() => onMissing(photo.id)}")
    expect(page).toContain('data-testid="mtm-photo-missing"')
    expect(page).toContain('missingLabel={t("fileMissing")}')
    expect(page).toContain('loading="lazy"')
    expect(locales[2].fileMissing).toBe("Fayl tapılmadı")
  })

  it("lands on this week's photos and filters employees on the server", () => {
    expect(page).toContain('useState<PhotoPeriod>("week")')
    expect(page).toContain('params.set("agentId", agentFilter)')
    expect(page).toContain('data-testid="mtm-photos-period"')
    expect(page).toContain('data-testid="mtm-photos-agent"')
  })

  it("counts the cards over the chosen period on the server, so «all» is not the page size", () => {
    // Audit 2026-09-26: «Всего 200» while 1367 photos were stored.
    expect(page).toContain('<ColorStatCard label={t("statTotal")} value={periodTotal}')
    expect(page).toContain("setStatusCounts(r.data.byStatus && typeof r.data.byStatus === \"object\" ? r.data.byStatus : {})")
    expect(page).toContain('params.set("since", new Date(mtmPhotoPeriodStart(period, new Date(), timezone)).toISOString())')
    expect(page).toContain('if (activeFilter !== "all") params.set("status", activeFilter)')
    expect(page).toContain('t("latestOfTotal", { shown: photos.length, total })')
    expect(page).not.toContain("value={photos.length}")
    // A response to an earlier choice must not paint over the current one.
    expect(page).toContain("if (requestId !== photoRequestRef.current) return")
  })

  it("does not offer to approve a photo whose file is missing, and keeps the tile's buttons inside it", () => {
    expect(page).toContain('photo.status === "PENDING" && (!photo.url || missingFiles.has(photo.id)) ? (')
    expect(page).toContain('data-testid="mtm-photo-review-unavailable"')
    expect(page).toContain("if (!missingFiles.has(id)) updatePhotoStatus(id, \"APPROVED\")")
    expect(page).toContain('<div className="mt-2 grid grid-cols-2 gap-1">')
  })

  it("has no dead Export button, no duplicate agent search, and names its view modes", () => {
    expect(page).not.toContain("Export (")
    expect(page).not.toContain('t("searchPlaceholder")')
    expect(page).toContain('{t("modeGallery")}')
    expect(page).toContain('{t("modeCompare")}')
    expect(page).toContain('{t("modeBatch")}')
    expect(page).not.toContain('description={t("subtitle")}')
  })

  it("uses the organization's timezone and the roster for its filters", () => {
    expect(page).toContain("mtmPhotoPeriodStart(period, new Date(), timezone)")
    expect(page).toContain('fetch("/api/v1/mtm/settings"')
    expect(page).toContain('fetch("/api/v1/mtm/agents?limit=200"')
    expect(page).not.toContain("setHours(0, 0, 0, 0)")
  })

  it("shows when a photo was taken, links its visit and opens it large", () => {
    expect(page).toContain("formatDateTime(photo.createdAt, locale")
    expect(page).toContain("href={`/mtm/visits?visitId=${encodeURIComponent(photo.visit.id)}`}")
    expect(page).toContain('data-testid="mtm-photo-lightbox"')
    expect(page).toContain("onClick={() => setLightboxPhoto(photo)}")
    for (const messages of locales) {
      for (const key of ["fileMissing", "periodToday", "periodWeek", "periodAll", "latestOfTotal", "openVisit", "openPhoto", "closeLightbox"]) {
        expect(messages[key], key).toEqual(expect.any(String))
      }
    }
  })
})
