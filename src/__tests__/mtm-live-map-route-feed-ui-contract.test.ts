import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Prod audit 2026-09-14 of the live map (agent Anar Mammadov, route of 14 September). */
describe("MTM live map: route, statuses and feed", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")
  const map = readFileSync("src/components/mtm/live-map.tsx", "utf8")

  it("draws the selected employee's stops with plan, fact and a link to the visit", () => {
    expect(page).toContain("summarizeMtmRouteExecution(agentRoute.points)")
    expect(page).toContain("hasMtmCoordinates(customer)")
    expect(page).toContain("visitId: fact?.visit?.id ?? null")
    expect(map).toContain('tMap("routeStop.planned"')
    expect(map).toContain("href={`/mtm/visits?visitId=${encodeURIComponent(stop.visitId)}`}")
    // Frame the employee and their stops, not the whole fleet.
    expect(map).toContain("<FitBounds agents={agents} plannedRoute={plannedRoute} focusAgentId={focusAgentId} />")
  })

  it("honours ?agentId= in live mode", () => {
    expect(page).toContain('searchParams.get("agentId")')
    expect(page).toContain("void fetchAgentRoute(requestedAgentId, tenantToday)")
  })

  it("offers the new field statuses as filters", () => {
    expect(page).toContain('tMap("fieldStatus.stopped")')
    expect(page).toContain('tMap("fieldStatus.routeFinished")')
  })

  it("keeps the employee list and the feed in the page flow, without small scrolling frames", () => {
    expect(page).not.toContain("max-h-[42vh]")
    expect(page).not.toContain("max-h-[180px]")
    expect(page).not.toContain("overflow-y-auto")
    expect(page).toContain("lg:sticky")
    const feed = page.indexOf('data-testid="mtm-map-live-feed"')
    const details = page.indexOf('<details className="group rounded-lg border bg-card">')
    expect(feed).toBeGreaterThan(-1)
    expect(feed).toBeLessThan(details)
    expect(page.slice(details)).not.toContain("liveFeed.map")
  })

  it("renders alerts from their key and distance, grouped, and links them to the history at that time", () => {
    expect(page).toContain("feedAlertText(event.alert)")
    expect(page).toContain('tMap("feed.repeated", { count: event.alert.count })')
    expect(page).toContain("mtmLiveFeedHistoryHref({")
    expect(page).not.toContain('{event.type === "ALERT" ? "⚠ " : "→ "}{event.customer}')
  })
})
