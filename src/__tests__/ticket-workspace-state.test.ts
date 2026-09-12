import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import { safeTicketReturnTo, ticketDetailHref, ticketScrollStorageKey } from "@/lib/ticketing/workspace-state"

const queueSource = readFileSync("src/app/(dashboard)/tickets/page.tsx", "utf8")
const detailSource = readFileSync("src/app/(dashboard)/tickets/[id]/page.tsx", "utf8")
const reportSource = readFileSync("src/components/tickets/ticketing-report.tsx", "utf8")
const dataTableSource = readFileSync("src/components/data-table.tsx", "utf8")

describe("ticket workspace navigation state", () => {
  it("preserves the exact ticket queue query", () => {
    const returnTo = "/tickets?view=kanban&status=open&priority=high&q=payment"

    expect(safeTicketReturnTo(returnTo)).toBe(returnTo)
    expect(ticketDetailHref("ticket/1", returnTo)).toBe(
      "/tickets/ticket%2F1?returnTo=%2Ftickets%3Fview%3Dkanban%26status%3Dopen%26priority%3Dhigh%26q%3Dpayment",
    )
    expect(ticketScrollStorageKey(returnTo)).toBe(`tickets:scroll:${returnTo}`)
  })

  it.each([
    "https://evil.test/tickets",
    "//evil.test/tickets",
    "/tickets/other",
    "/tickets\\@evil.test",
    "/companies",
    "not-a-url",
    null,
  ])("rejects unsafe or unrelated return targets: %s", (value) => {
    expect(safeTicketReturnTo(value)).toBe("/tickets")
  })

  it("exposes recoverable queue states to users and browser evidence", () => {
    for (const testId of [
      "tickets-loading",
      "tickets-load-error",
      "tickets-retry-load",
      "tickets-empty-state",
      "tickets-no-results-state",
      "tickets-empty-action",
      "tickets-kanban-empty-state",
      "tickets-kanban-no-results-state",
    ]) {
      expect(queueSource).toContain(testId)
    }
  })

  it("stores and restores the actual nested dashboard scroll container", () => {
    expect(queueSource).toContain('document.querySelector("main")')
    expect(queueSource).toContain("scroller?.scrollTop ?? window.scrollY")
    expect(queueSource).toContain('scroller.scrollTo({ top, behavior: "instant" })')
  })

  it("keeps the embedded Reports mode behind the same role and tenant-module boundary as its API", () => {
    expect(queueSource).toContain('checkPermission(capabilityUser.role as Role, "reports", "read")')
    expect(queueSource).toContain('hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "analytics")')
    expect(queueSource).toContain('view !== "reports" || canViewReports')
    expect(queueSource).toContain('view === "reports" && canViewReports')
    expect(queueSource).toContain('t("reportsUnavailable")')
  })

  it("keeps the empty company-risk scroller keyboard reachable", () => {
    expect(reportSource).toContain('aria-label={t("companyRiskTable")}')
    expect(reportSource).toContain("tabIndex={0}")
    expect(reportSource).toContain("focus-visible:ring-ring")
  })

  it("uses an accessible active page-size treatment in compact tables", () => {
    expect(dataTableSource).toContain('compact')
    expect(dataTableSource).toContain('bg-primary font-medium text-primary-foreground')
    expect(dataTableSource).not.toContain('compact && "bg-orange-')
  })

  it("keeps queue and case work above narrow-screen overflow", () => {
    expect(queueSource).toContain('descriptionClassName="hidden sm:block"')
    expect(detailSource).toContain('className="grid grid-cols-3 overflow-hidden')
    expect(detailSource).toContain("sm:grid-cols-4")
    expect(detailSource).toContain("xl:grid-cols-7")
    expect(detailSource).toContain('className="grid min-w-0 gap-4 lg:grid-cols-3"')
    expect(detailSource).toContain('className="flex min-w-0 flex-col gap-4 lg:col-span-2"')
    expect(detailSource).toContain('className="support-case-workspace"')
    expect(detailSource).toContain("max-w-full whitespace-normal")
  })

  it("exposes recoverable ticket and partial-context states", () => {
    for (const testId of [
      "ticket-detail-loading",
      "ticket-detail-load-error",
      "ticket-detail-retry-load",
      "ticket-detail-stale",
      "ticket-context-loading",
      "ticket-context-error",
      "ticket-context-retry",
    ]) {
      expect(detailSource).toContain(testId)
    }
    expect(detailSource).toContain("setContextRetryKey((value) => value + 1)")
  })
})
