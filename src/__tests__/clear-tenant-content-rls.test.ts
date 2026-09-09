import { describe, it, expect, vi, beforeEach } from "vitest"
import { getRlsContext } from "@/lib/rls-context"

// Capture the RLS context active at the moment each raw DELETE runs. With the real runWithRlsBypass
// (NOT mocked) wrapping clearTenantContent, this must be { bypass: true } — proving the deletes will
// carry set_config('app.rls_bypass') in prod (the [P1] fix). A regression that drops the wrap → false.
const bypassAtDelete: (boolean | undefined)[] = []
const deleteQueries: string[] = []

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => ({ id: "o1", name: "Demo", slug: "demo" })) },
    $queryRaw: vi.fn(async () => [
      { table_name: "tickets" },
      { table_name: "deals" },
      { table_name: "funds" },
      { table_name: "fund_transactions" },
      { table_name: "fund_balance_projections" },
      { table_name: "domain_events" },
      { table_name: "event_outbox" },
      { table_name: "consumer_inbox" },
      { table_name: "effect_attempts" },
    ]),
    $executeRawUnsafe: vi.fn(async (query: string) => {
      bypassAtDelete.push(getRlsContext()?.bypass)
      deleteQueries.push(query)
      return 1
    }),
  },
}))

import { clearTenantContent } from "@/lib/tenant-provisioning"

beforeEach(() => {
  bypassAtDelete.length = 0
  deleteQueries.length = 0
})

describe("clearTenantContent — raw DELETEs run under an RLS bypass context", () => {
  it("every raw DELETE sees bypass:true (so set_config bypass applies once RLS is enabled)", async () => {
    const res = await clearTenantContent("o1")
    expect(bypassAtDelete.length).toBeGreaterThan(0)          // it actually deleted
    expect(bypassAtDelete.every((b) => b === true)).toBe(true) // ALL under bypass — none unscoped
    expect(res.rowsDeleted).toBeGreaterThan(0)
  })

  it("preserves the finance ledger and canonical recovery evidence", async () => {
    await clearTenantContent("o1")

    expect(deleteQueries).toHaveLength(2)
    expect(deleteQueries.join("\n")).toContain('DELETE FROM "tickets"')
    expect(deleteQueries.join("\n")).toContain('DELETE FROM "deals"')
    expect(deleteQueries.join("\n")).not.toMatch(/funds|fund_transactions|fund_balance_projections/)
    expect(deleteQueries.join("\n")).not.toMatch(/domain_events|event_outbox|consumer_inbox|effect_attempts/)
  })
})
