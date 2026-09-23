/**
 * The demo link the public form sends by itself (owner, 2026-09-23).
 *
 * One test per rule in the header of src/lib/demo-center/auto-issue.ts: what
 * a form may hand out (the guided story, never the live call), one link per
 * address per day, and the three quiet refusals — all of which still leave
 * the request stored for the owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockIssue = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: (_org: string, fn: () => unknown) => Promise.resolve().then(fn),
}))
vi.mock("@/lib/demo-center/sales-org", () => ({
  inDemoSalesOrganization: async (work: (organizationId: string) => Promise<unknown>) => ({
    organizationId: "org-leaddrive-inc",
    value: await work("org-leaddrive-inc"),
  }),
}))
vi.mock("@/lib/demo-center/issue-grant", () => ({ issueDemoGrant: mockIssue }))

import { prisma } from "@/lib/prisma"
import { PROSPECT_TO_CLOSED_WON } from "@/lib/demo-center/journey"
import { DEMO_AUTO_ISSUE_COOLDOWN_MS, autoIssueDemoGrant } from "@/lib/demo-center/auto-issue"

const NOW = new Date("2026-09-23T09:00:00.000Z")
const request = {
  id: "req-1",
  name: "Rəşad Rəhimov",
  company: "LeadDrive",
  email: "rashad@gmail.com",
  emailNormalized: "rashad@gmail.com",
  locale: "az",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.demoGrant.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-agent", role: "agent" },
    { id: "user-manager", role: "manager" },
  ] as never)
  mockIssue.mockResolvedValue({ ok: true, grantId: "grant-1" })
})

describe("the link a form hands out", () => {
  it("is the guided story, issued by a sales manager, and never carries the live call", async () => {
    expect(await autoIssueDemoGrant({ request, now: NOW })).toBe("issued")
    expect(mockIssue).toHaveBeenCalledTimes(1)
    const call = mockIssue.mock.calls[0][0]
    expect(call.actorUserId).toBe("user-manager")
    expect(call.options).toMatchObject({
      scenarioId: PROSPECT_TO_CLOSED_WON.scenarioId,
      liveCallEnabled: false,
      locale: "az",
    })
  })

  it("is not minted again for an address that already has a live one", async () => {
    vi.mocked(prisma.demoGrant.findFirst).mockResolvedValue({ id: "grant-earlier" } as never)
    expect(await autoIssueDemoGrant({ request, now: NOW })).toBe("already_sent")
    expect(mockIssue).not.toHaveBeenCalled()

    // And the window it looks in is the day the header promises.
    vi.mocked(prisma.demoGrant.findFirst).mockResolvedValue(null as never)
    await autoIssueDemoGrant({ request, now: NOW })
    const where = vi.mocked(prisma.demoGrant.findFirst).mock.calls[1][0].where as {
      createdAt: { gt: Date }
      request: { emailNormalized: string }
    }
    expect(where.request.emailNormalized).toBe("rashad@gmail.com")
    expect(NOW.getTime() - where.createdAt.gt.getTime()).toBe(DEMO_AUTO_ISSUE_COOLDOWN_MS)
  })

  it("refuses quietly when there is no manager to issue on behalf of", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-agent", role: "agent" }] as never)
    expect(await autoIssueDemoGrant({ request, now: NOW })).toBe("unavailable")
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it("reports a failed issue instead of throwing at the form", async () => {
    mockIssue.mockResolvedValue({ ok: false, status: 502, code: "delivery_failed", error: "no" })
    expect(await autoIssueDemoGrant({ request, now: NOW })).toBe("failed")

    mockIssue.mockRejectedValue(new Error("database down"))
    expect(await autoIssueDemoGrant({ request, now: NOW })).toBe("failed")
  })
})
