/**
 * Four screens, four addresses — and why that is not cosmetics.
 *
 * «Görüşlər və yazılış» was one page with tabs inside it, so the whole section
 * had one help video: four minutes covering the day, the services, the team
 * and WhatsApp at once. A person who opened the services screen was offered a
 * tour that starts with the day timeline, and nobody watches four minutes to
 * reach their own question (owner, 2026-11-10: «разделим на разделы и для
 * каждого своё короткое видео»).
 *
 * The help-video launcher resolves ONE entry per path, so the split is what
 * makes short films possible at all. Three things have to hold for that:
 *
 *   1. Every section path is a real page, passing its own section to the
 *      workspace — a path in the nav with no page behind it is a dead tab.
 *   2. Every section path is in the help-video registry, so the screen can own
 *      a film; without the entry the card never appears, however well the
 *      video was shot.
 *   3. The addresses the tabs used to be (`?tab=pages`, `?tab=team`) are sent
 *      on. They are in bookmarks and in messages between colleagues, and
 *      silently opening the day instead would look like the section lost them.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BOOKING_SECTION_PATHS, type BookingSection } from "@/components/booking/booking-workspace"
import { HELP_VIDEO_ENTRIES } from "@/content/help/video-assets"

const ROOT = join(__dirname, "..", "..")
const pageOf = (path: string) => join(ROOT, "src", "app", "(dashboard)", path, "page.tsx")

describe("the meetings section's four screens", () => {
  it("gives every screen its own address", () => {
    expect(BOOKING_SECTION_PATHS).toEqual({
      meetings: "/meetings",
      pages: "/meetings/services",
      whatsapp: "/meetings/whatsapp",
      team: "/meetings/team",
    })
  })

  it("has a page behind every address, asking for its own screen", () => {
    for (const [section, path] of Object.entries(BOOKING_SECTION_PATHS) as [BookingSection, string][]) {
      const source = readFileSync(pageOf(path), "utf8")
      expect(source, `${path} must render the workspace`).toContain("BookingWorkspace")
      expect(source, `${path} must ask for the ${section} screen`).toContain(`section="${section}"`)
    }
  })

  it("lets every screen own a help video", () => {
    const routes = new Set(HELP_VIDEO_ENTRIES.flatMap((entry) => entry.routes))
    for (const path of Object.values(BOOKING_SECTION_PATHS)) expect(routes, path).toContain(path)
  })

  it("sends the old tab links on instead of dropping them on the day", () => {
    const source = readFileSync(pageOf("/meetings"), "utf8")
    expect(source).toContain('redirect("/meetings/services")')
    expect(source).toContain('redirect("/meetings/team")')
  })
})
