/**
 * Smart AI Search — read-tool executor tests.
 * Covers org-scoping, the anti-hallucination gate, limit clamping, "me"
 * assignee resolution, Decimal→number normalization, and audit hygiene.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    deal: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    task: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    ticket: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    contact: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    sharingRule: { findMany: vi.fn().mockResolvedValue([]) },
    fieldPermission: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
  logAudit: vi.fn(),
}))

// The task list's access builder (sharing rules + board access + department
// isolation) is the task screen's own and is tested there; here it only has to
// be applied.
const { buildTaskListWhere } = vi.hoisted(() => ({
  buildTaskListWhere: vi.fn(),
}))
vi.mock("@/lib/tasks/list-query", () => ({
  buildTaskListWhere,
  parseTaskListFilters: vi.fn().mockReturnValue({}),
}))

import { executeReadTool } from "@/lib/ai/read-tool-executor"
import { prisma, logAudit } from "@/lib/prisma"

const ORG = "org-1"
const USER = "u-1"

const MODELS: [string, keyof typeof prisma][] = [
  ["list_invoices", "invoice"],
  ["list_deals", "deal"],
  ["list_tasks", "task"],
  ["list_tickets", "ticket"],
  ["list_contacts", "contact"],
]

const TASK_ACCESS = { organizationId: "org-1", OR: [{ assignedTo: "u-1" }, { divisionId: { in: ["board-1"] } }] }

beforeEach(() => {
  vi.clearAllMocks()
  buildTaskListWhere.mockResolvedValue({ where: TASK_ACCESS, blocked: false })
  vi.mocked((prisma as any).sharingRule.findMany).mockResolvedValue([])
  vi.mocked((prisma as any).fieldPermission.findFirst).mockResolvedValue(null)
})

describe("executeReadTool", () => {
  it("scopes every query to the caller's organizationId", async () => {
    for (const [tool, model] of MODELS) {
      const res = await executeReadTool(tool, {}, ORG, USER, "admin")
      expect(res.success).toBe(true)
      const findMany = vi.mocked((prisma as any)[model].findMany)
      expect(findMany.mock.calls.at(-1)![0].where.organizationId).toBe(ORG)
    }
  })

  it("rejects a hallucinated field and never hits the DB", async () => {
    const res = await executeReadTool("list_invoices", { customerName: "x" }, ORG, USER, "admin")
    expect(res.success).toBe(false)
    expect(res.error).toContain("Invalid filter")
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
    expect(prisma.invoice.count).not.toHaveBeenCalled()
  })

  it("clamps an oversized limit to the hard cap (50)", async () => {
    await executeReadTool("list_deals", { limit: 10000 }, ORG, USER, "admin")
    expect(vi.mocked(prisma.deal.findMany).mock.calls[0][0].take).toBe(50)
  })

  it("uses the default limit (20) when none is given", async () => {
    await executeReadTool("list_tasks", {}, ORG, USER, "admin")
    expect(vi.mocked(prisma.task.findMany).mock.calls[0][0].take).toBe(20)
  })

  it("interprets inclusive date-only filters in the caller timezone", async () => {
    await executeReadTool(
      "list_deals",
      { dateFrom: "2026-08-05", dateTo: "2026-08-05" },
      ORG,
      USER,
      "admin",
      "Asia/Baku",
    )
    const createdAt = vi.mocked(prisma.deal.findMany).mock.calls[0][0].where.createdAt
    expect(createdAt.gte.toISOString()).toBe("2026-08-04T20:00:00.000Z")
    expect(createdAt.lt.toISOString()).toBe("2026-08-05T20:00:00.000Z")
    expect(createdAt.lte).toBeUndefined()
  })

  it("resolves assignedTo:'me' to the caller's user id", async () => {
    await executeReadTool("list_deals", { assignedTo: "me" }, ORG, "u-9", "admin")
    expect(vi.mocked(prisma.deal.findMany).mock.calls[0][0].where.assignedTo).toBe("u-9")
  })

  it("normalizes Decimal money to a JS number and links each row", async () => {
    const decimalLike = { toNumber: () => 1250.5 }
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
      { id: "i1", invoiceNumber: "INV-1", status: "paid", totalAmount: decimalLike, currency: "AZN", issueDate: new Date("2026-05-09") },
    ] as any)
    vi.mocked(prisma.invoice.count).mockResolvedValueOnce(1)

    const res = await executeReadTool("list_invoices", {}, ORG, USER, "admin")
    expect(res.success).toBe(true)
    const row = res.data.rows[0]
    expect(row.cells.totalAmount).toBe(1250.5)
    expect(typeof row.cells.totalAmount).toBe("number")
    expect(row.href).toBe("/invoices/i1")
  })

  it("reports total + truncated when the count exceeds returned rows", async () => {
    vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([
      { id: "d1", name: "D", stage: "LEAD", valueAmount: 5, currency: "AZN", expectedClose: null },
    ] as any)
    vi.mocked(prisma.deal.count).mockResolvedValueOnce(137)

    const res = await executeReadTool("list_deals", {}, ORG, USER, "admin")
    expect(res.data.total).toBe(137)
    expect(res.data.returned).toBe(1)
    expect(res.data.truncated).toBe(true)
  })

  it("excludes soft-deleted tasks (deletedAt: null in the WHERE)", async () => {
    await executeReadTool("list_tasks", {}, ORG, USER, "admin")
    expect(vi.mocked(prisma.task.findMany).mock.calls[0][0].where.deletedAt).toBeNull()
  })

  it("audits as 'ai_read' and never logs the free-text search value", async () => {
    await executeReadTool("list_contacts", { search: "secret-name" }, ORG, USER, "admin")
    expect(logAudit).toHaveBeenCalled()
    const args = vi.mocked(logAudit).mock.calls.at(-1)!
    expect(args[1]).toBe("ai_read")
    expect(JSON.stringify(args)).not.toContain("secret-name")
  })

  it("returns an error for an unknown read tool", async () => {
    const res = await executeReadTool("list_unicorns", {}, ORG, USER, "admin")
    expect(res.success).toBe(false)
  })

  it("fails closed without a role", async () => {
    const missingRole = await executeReadTool("list_deals", {}, ORG, USER)
    expect(missingRole.success).toBe(false)
    expect(prisma.deal.findMany).not.toHaveBeenCalled()
  })
})

/**
 * Owner 2026-11-26: Da Vinci answers every employee "within their rights".
 * Until then a salesperson got no list at all, because the builders read
 * the whole organization. Now each list is narrowed by the screen's own rule.
 */
describe("executeReadTool for a role below manager", () => {
  it("shows a salesperson only own deals and the shared intake queue, like the deal list", async () => {
    const res = await executeReadTool("list_deals", { stage: "proposal" }, ORG, USER, "sales")
    expect(res.success).toBe(true)
    const where = vi.mocked(prisma.deal.findMany).mock.calls[0][0].where
    expect(where).toEqual({
      organizationId: ORG,
      stage: "proposal",
      OR: [{ assignedTo: USER }, { assignedTo: null }],
    })
    // The total is counted over the same narrowed set, not the organization.
    expect(vi.mocked(prisma.deal.count).mock.calls[0][0].where).toEqual(where)
  })

  it("widens by an active sharing rule exactly as the screen does", async () => {
    vi.mocked((prisma as any).sharingRule.findMany).mockResolvedValue([
      { ruleType: "role", targetRole: "sales", sourceRole: "manager", isActive: true },
    ])
    vi.mocked((prisma as any).user.findMany).mockResolvedValue([{ id: "boss-1" }])
    await executeReadTool("list_deals", {}, ORG, USER, "sales")
    const where = vi.mocked(prisma.deal.findMany).mock.calls[0][0].where
    expect(where.OR).toContainEqual({ OR: [{ assignedTo: { in: ["boss-1"] } }] })
  })

  it("keeps a search filter and the ownership rule together", async () => {
    await executeReadTool("list_tickets", { status: "open" }, ORG, USER, "support")
    const where = vi.mocked(prisma.ticket.findMany).mock.calls[0][0].where
    expect(where.status).toBe("open")
    expect(where.OR).toEqual([{ assignedTo: USER }, { createdBy: USER }, { assignedTo: null }])
  })

  it("applies the task screen's access rules to tasks", async () => {
    await executeReadTool("list_tasks", { status: "todo" }, ORG, USER, "sales")
    expect(buildTaskListWhere).toHaveBeenCalledWith(ORG, USER, "sales", {})
    const where = vi.mocked(prisma.task.findMany).mock.calls[0][0].where
    expect(where.status).toBe("todo")
    expect(where.deletedAt).toBeNull()
    expect(where.AND).toContainEqual(TASK_ACCESS)
  })

  it("applies board isolation to managers too, as the task screen does", async () => {
    await executeReadTool("list_tasks", {}, ORG, USER, "manager")
    expect(vi.mocked(prisma.task.findMany).mock.calls[0][0].where.AND).toContainEqual(TASK_ACCESS)
  })

  it("returns nothing when the task screen would show nothing", async () => {
    buildTaskListWhere.mockResolvedValue({ where: TASK_ACCESS, blocked: true })
    const res = await executeReadTool("list_tasks", {}, ORG, USER, "sales")
    expect(res.success).toBe(true)
    expect(res.data.total).toBe(0)
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("gives no list at all to a role with a hidden field on that entity", async () => {
    vi.mocked((prisma as any).fieldPermission.findFirst).mockResolvedValue({ id: "fp-1" })
    const res = await executeReadTool("list_deals", {}, ORG, USER, "sales")
    expect(res.success).toBe(false)
    expect(res.error).toBe("ACCESS_SCOPE_UNAVAILABLE")
    expect(prisma.deal.findMany).not.toHaveBeenCalled()
  })

  it("still refuses an entity the role may not read at all", async () => {
    const res = await executeReadTool("list_invoices", {}, ORG, USER, "ticketing")
    expect(res.success).toBe(false)
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })
})
