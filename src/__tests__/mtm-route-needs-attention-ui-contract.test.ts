import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

/**
 * Routes audit 2026-09-26, «Согласования»: with nothing pending the tab showed
 * three blocks each saying «nothing» — the first one titled «Требует
 * внимания» — and with something pending the tab itself gave no sign. The
 * count now sits on the tab; an empty tab is one line; a queue with nothing in
 * it is not drawn.
 */
describe("MTM approvals tab UI contract", () => {
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const routeQueue = source("src/components/mtm/route-approval-queue.tsx")
  const customerQueue = source("src/components/mtm/customer-request-queue.tsx")

  it("puts the pending count on the tab, from the aggregate-only endpoint", () => {
    expect(routesPage).toContain('fetch("/api/v1/mtm/routes/needs-attention"')
    expect(routesPage).toContain('data-testid="mtm-routes-approvals-count"')
    expect(routesPage).toContain("}, [approvalRefreshVersion, capabilities.canReview, orgId])")
  })

  it("says «nothing to approve» once, and draws only the queue that has something", () => {
    expect(routesPage).not.toContain("<MtmRouteNeedsAttention")
    expect(routesPage).toContain("approvalCounts && approvalTotal === 0 ? (")
    expect(routesPage).toContain('data-testid="mtm-approvals-empty"')
    // An unknown count is not «nothing»: both queues load on their own then.
    expect(routesPage).toContain("{!approvalCounts || approvalCounts.routeChanges > 0 ? <MtmRouteApprovalQueue")
    expect(routesPage).toContain("{!approvalCounts || approvalCounts.customerRequests > 0 ? <MtmCustomerRequestQueue")
    expect(routeQueue).toContain('id="mtm-route-approval-queue"')
    expect(customerQueue).toContain('id="mtm-customer-approval-queue"')
  })

  it("counts each queue in its heading", () => {
    expect(routeQueue).toContain('t("pendingApprovalsCount", { count: requests.length })')
    expect(customerQueue).toContain('t("pendingApprovalsCount", { count: requests.length })')
  })
})
