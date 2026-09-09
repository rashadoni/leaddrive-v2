import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM route needs-attention UI contract", () => {
  const summary = source("src/components/mtm/route-needs-attention.tsx")
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const routeQueue = source("src/components/mtm/route-approval-queue.tsx")
  const customerQueue = source("src/components/mtm/customer-request-queue.tsx")

  it("adds a summary without removing or replacing either existing queue", () => {
    expect(routesPage).toContain("<MtmRouteNeedsAttention")
    expect(routesPage).toContain("<MtmRouteApprovalQueue")
    expect(routesPage).toContain("<MtmCustomerRequestQueue")
    expect(routeQueue).toContain('id="mtm-route-approval-queue"')
    expect(customerQueue).toContain('id="mtm-customer-approval-queue"')
  })

  it("keeps category jumps keyboard-safe and exposes dynamic state accessibly", () => {
    expect(summary).toContain('href="#mtm-route-approval-queue"')
    expect(summary).toContain('href="#mtm-customer-approval-queue"')
    expect(summary).toContain('aria-live="polite"')
    expect(summary).toContain("min-h-11")
    expect(summary).toContain("AbortController")
  })
})
