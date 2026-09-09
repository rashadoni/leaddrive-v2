import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task C10 (RUX-604). Two things the route card
 * must keep doing, both about not showing something that is not there.
 */
describe("MTM route card UI contract", () => {
  const routesPage = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
  const routeMap = readFileSync("src/components/mtm/route-map.tsx", "utf8")

  it("does not put the Advisor risk block on the route card", () => {
    // The block sat above the route's own numbers and answered a question
    // nobody asked there. It stays where it is read on purpose — tasks,
    // payments — and this only removes it from this card.
    expect(routesPage).not.toContain("AdvisorRecordWidget")
    expect(routesPage).not.toContain("advisor-record-widget")
  })

  it("shows an explanation instead of an empty map when no stop has coordinates", () => {
    // Drawing nothing looks like a broken map; drawing (0, 0) put marker "1"
    // in the Gulf of Guinea. Both were real (audit A1).
    expect(routeMap).toContain('data-testid="mtm-route-map-empty"')
    expect(routeMap).toContain("routeMapNoCoordinates")
    expect(routeMap).toContain("hasMtmCoordinates(point.customer)")
  })
})
