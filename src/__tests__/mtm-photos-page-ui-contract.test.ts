import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Prod audit 2026-09-14: /mtm/photos opened on a wall of broken images. */
describe("MTM photos page", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/photos/page.tsx", "utf8")
  const locales = ["en", "ru", "az"].map((locale) =>
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmPhotosPage)

  it("replaces a missing file with a labelled tile instead of a broken image", () => {
    expect(page).toContain("onError={() => onMissing(photo.id)}")
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

  it("counts the cards over the chosen period so they add up; the server total is only a note", () => {
    expect(page).toContain('<ColorStatCard label={t("statTotal")} value={periodPhotos.length}')
    expect(page).toContain("for (const p of periodPhotos) statusCounts[p.status]")
    expect(page).toContain('t("latestOfTotal", { shown: photos.length, total })')
    expect(page).not.toContain("value={total}")
    expect(page).not.toContain("value={photos.length}")
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
