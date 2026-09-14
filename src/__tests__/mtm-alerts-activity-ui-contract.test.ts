import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { mtmAccessErrorKey } from "@/lib/mtm/access-error"
import { activityRowHref } from "@/lib/mtm/activity-actions"
import { fieldSyncAuditData, routeTransitionActions } from "@/lib/mtm/field-sync-audit"
import { groupMtmAlertsByAgentDay, type MtmAlertDayRow } from "@/lib/mtm/alert-day-groups"

/**
 * Prod 2026-09-14, /mtm/alerts and /mtm/activity for an office manager.
 * Pins the parts a route test cannot see: which localized sentence a failed
 * read shows, that no server `error` string reaches the screen, the grouped
 * row shape, and the exact-record links.
 */

const messages = {
  en: JSON.parse(readFileSync("messages/en.json", "utf8")),
  ru: JSON.parse(readFileSync("messages/ru.json", "utf8")),
  az: JSON.parse(readFileSync("messages/az.json", "utf8")),
}
const pages = {
  alerts: readFileSync("src/app/(dashboard)/mtm/alerts/page.tsx", "utf8"),
  activity: readFileSync("src/app/(dashboard)/mtm/activity/page.tsx", "utf8"),
}

describe("localized access errors (after #204)", () => {
  it("maps the server code, not the server sentence", () => {
    expect(mtmAccessErrorKey(403, { error: "This view needs a field scope…", code: "MTM_FIELD_SCOPE_REQUIRED" })).toBe("scopeRequired")
    expect(mtmAccessErrorKey(403, { code: "MTM_AGENT_OUT_OF_SCOPE" })).toBe("agentOutOfScope")
    expect(mtmAccessErrorKey(403, { code: "TENANT_CAPABILITY_DISABLED" })).toBe("forbidden")
    expect(mtmAccessErrorKey(401, null)).toBe("forbidden")
    expect(mtmAccessErrorKey(500, { error: "Failed" })).toBe("loadFailed")
    expect(mtmAccessErrorKey(0, "garbage")).toBe("loadFailed")
  })

  it("has the explanation in every language on both pages", () => {
    for (const [locale, dict] of Object.entries(messages)) {
      for (const namespace of ["mtmAlertsPage", "mtmActivity"]) {
        for (const key of ["scopeRequired", "agentOutOfScope", "forbidden", "loadFailed", "retry"]) {
          expect(dict[namespace].accessError[key], `${locale}.${namespace}.accessError.${key}`).toMatch(/\S/)
        }
      }
    }
    expect(messages.az.mtmAlertsPage.accessError.scopeRequired)
      .toBe("Bu bölməni görmək üçün hesabınıza sahə əməkdaşı kartı bağlanmalıdır — administratora müraciət edin.")
  })

  it("both pages render accessError.<key> and never toast the server's error string", () => {
    for (const [name, source] of Object.entries(pages)) {
      expect(source, name).toContain("mtmAccessErrorKey(res.status")
      expect(source, name).toContain("accessError.${errorKey}")
      expect(source, name).not.toMatch(/toast\.error\([^)]*\.error\b/)
      expect(source, name).not.toMatch(/Failed to load/)
    }
  })
})

describe("grouped alert rows", () => {
  const row = (id: string, at: string, meters: number, agentId = "agent-1"): MtmAlertDayRow => ({
    id, agentId, agentName: "Anar", type: "OUT_OF_ZONE", category: "WARNING", title: "Route deviation detected", description: null,
    isResolved: false, createdAt: at,
    metadata: { messageKey: "routeDeviation", messageParams: { deviationMeters: meters, thresholdMeters: 500 } },
  })

  it("splits by agent and by tenant-local day, not by UTC day", () => {
    const groups = groupMtmAlertsByAgentDay([
      row("a", "2026-09-14T19:30:00.000Z", 100), // 23:30 Baku, 14th
      row("b", "2026-09-14T20:30:00.000Z", 200), // 00:30 Baku, 15th
      row("c", "2026-09-14T19:40:00.000Z", 300, "agent-2"),
    ], "Asia/Baku")
    expect(groups.map((group) => `${group.agentId}@${group.dateKey}`).sort())
      .toEqual(["agent-1@2026-09-14", "agent-1@2026-09-15", "agent-2@2026-09-14"])
  })

  it("the row reads agent · situation · span · count · distance, and the map link is the history window", () => {
    expect(pages.alerts).toContain('parts.join(" · ")')
    expect(pages.alerts).toContain('t("times", { count: group.count })')
    expect(pages.alerts).toContain("group.historyHref")
    expect(pages.alerts).toContain("/mtm/visits?visitId=")
    expect(messages.az.mtmAlertsPage.openOnMap).toBe("Xəritədə bax")
    expect(messages.az.mtmAlertsPage.openVisit).toBe("Ziyarəti aç")
    expect(messages.az.mtmAlertsPage.distanceOffRoute).toBe("Marşrutdan {distance} kənarda")
  })

  it("keeps old open alerts apart and closes them only on an explicit action", () => {
    expect(pages.alerts).toContain("data.stale.total > 0")
    expect(pages.alerts).toContain("stale: true")
    expect(pages.alerts).toContain("<ConfirmDialog")
  })
})

describe("activity rows", () => {
  it("link the exact visit, then the route, then the section", () => {
    expect(activityRowHref({ entity: "visit", subject: { customerName: "A", visitId: "v 1", routeId: "r1" } })).toBe("/mtm/visits?visitId=v%201")
    expect(activityRowHref({ entity: "route", subject: { customerName: null, visitId: null, routeId: "r1" } })).toBe("/mtm/routes?routeId=r1")
    expect(activityRowHref({ entity: "photo" })).toBe("/mtm/photos")
    expect(activityRowHref({ entity: "settings" })).toBeNull()
  })

  it("label every sync action in az/ru/en and show the customer's name", () => {
    for (const [locale, dict] of Object.entries(messages)) {
      for (const action of ["CHECK_IN", "CHECK_IN_FORCED", "CHECK_OUT", "ROUTE_START", "ROUTE_COMPLETE", "ALERT_BULK_RESOLVE"]) {
        expect(dict.mtmActivity.action[action], `${locale} ${action}`).toMatch(/\S/)
      }
    }
    expect(messages.az.mtmActivity.action.CHECK_IN).not.toBe("Check-in")
    expect(messages.ru.mtmActivity.action.CHECK_OUT).not.toBe("Check-out")
    expect(pages.activity).toContain("subject?.customerName")
    expect(pages.activity).toContain("activityRowHref(log)")
  })

  it("sync audit rows are shaped for the journal", () => {
    expect(fieldSyncAuditData({
      organizationId: "org", agentId: "a", action: "ROUTE_COMPLETE", operationId: "op", source: "mobile_sync",
      visitId: "v", routeId: "r", customerName: "  Aptek  ",
    })).toMatchObject({ entity: "route", entityId: "r", metadataKind: "field_sync", newData: { customerName: "Aptek", operationId: "op" } })
    expect(routeTransitionActions("PLANNED", "COMPLETED")).toEqual(["ROUTE_START", "ROUTE_COMPLETE"])
    expect(routeTransitionActions("IN_PROGRESS", "IN_PROGRESS")).toEqual([])
    expect(routeTransitionActions("IN_PROGRESS", "COMPLETED")).toEqual(["ROUTE_COMPLETE"])
    expect(routeTransitionActions(null, "COMPLETED")).toEqual([])
  })
})
