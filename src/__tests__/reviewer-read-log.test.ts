/**
 * Every API read of an outside reviewer becomes one line in the append-only
 * compliance_audit_log; nobody else is logged, and a write is not a read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const recordComplianceAccess = vi.fn(async () => "row")
vi.mock("@/lib/audit/compliance-audit", () => ({ recordComplianceAccess: (...args: unknown[]) => recordComplianceAccess(...(args as [])) }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: async (_org: string, fn: () => unknown) => fn() }))

import { recordReviewerRead } from "@/lib/audit/reviewer-read-log"

const reviewer = { role: "reviewer", orgId: "org_1", userId: "rev_1" }

beforeEach(() => recordComplianceAccess.mockClear())

describe("recordReviewerRead", () => {
  it("writes one line per request for a reviewer's read", async () => {
    const req = new NextRequest("http://localhost/api/v1/contacts/cmabc123xyz?tab=deals", { headers: { "user-agent": "UA" } })
    recordReviewerRead(req, reviewer)
    recordReviewerRead(req, reviewer)
    await Promise.resolve()
    expect(recordComplianceAccess).toHaveBeenCalledTimes(1)
    expect(recordComplianceAccess.mock.calls[0][0]).toMatchObject({
      organizationId: "org_1", userId: "rev_1", action: "read", recordType: "pii",
      recordTable: "contacts", recordId: "cmabc123xyz", userAgent: "UA",
      metadata: { reviewer: true, kind: "record", path: "/api/v1/contacts/cmabc123xyz", query: "?tab=deals" },
    })
  })

  it("logs nobody else and no write", async () => {
    recordReviewerRead(new NextRequest("http://localhost/api/v1/contacts"), { ...reviewer, role: "viewer" })
    recordReviewerRead(new NextRequest("http://localhost/api/v1/contacts", { method: "POST" }), reviewer)
    await Promise.resolve()
    expect(recordComplianceAccess).not.toHaveBeenCalled()
  })
})
