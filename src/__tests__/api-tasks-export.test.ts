import { describe, it, expect, beforeEach, vi } from "vitest"

// prisma mock
vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    task: { findMany: vi.fn() },
    taskType: { findMany: vi.fn() },
    eventType: { findMany: vi.fn() },
    customField: { findMany: vi.fn() },
  }
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
}))

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((row: any) => row),
}))

// Keep parseTaskListFilters + statusBucketLabel REAL; stub only the access builder.
vi.mock("@/lib/tasks/list-query", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/tasks/list-query")>()
  return { ...actual, buildTaskListWhere: vi.fn() }
})

import { GET } from "@/app/api/v1/tasks/export/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId } from "@/lib/api-auth"
import { buildTaskListWhere } from "@/lib/tasks/list-query"

const SESSION = { orgId: "org-1", userId: "u1", role: "admin", email: "a@b.com", name: "A" }
const req = (qs = "") => new Request(`http://x/api/v1/tasks/export${qs}`) as any

const TASKS = [
  {
    taskKey: "PRJ-1", title: "Build landing", type: "seo", eventType: "914_line", status: "in_progress", priority: "high",
    assignee: { name: "Alice" }, project: { name: "Website" }, division: { name: "Marketing", key: "MKT" },
    dueDate: new Date("2026-06-10"), createdAt: new Date("2026-06-01"), completedAt: null,
    category: "Q2", estimatedHours: null, estimatedPrice: null, customFields: {},
  },
  {
    taskKey: "PRJ-2", title: "Fix bug", type: "bug", status: "done", priority: "low",
    assignee: null, project: null, division: null,
    dueDate: null, createdAt: new Date("2026-05-20"), completedAt: new Date("2026-05-25"),
    category: null, estimatedHours: null, estimatedPrice: null, customFields: {},
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(buildTaskListWhere).mockResolvedValue({ where: {}, blocked: false })
  vi.mocked(prisma.task.findMany).mockResolvedValue(TASKS as any)
  vi.mocked(prisma.taskType.findMany).mockResolvedValue([
    { name: "seo", displayName: "SEO" }, { name: "bug", displayName: "Bug" },
  ] as any)
  vi.mocked(prisma.eventType.findMany).mockResolvedValue([{ name: "914_line", displayName: "914 LINE" }] as any)
  vi.mocked(prisma.customField.findMany).mockResolvedValue([])
})

describe("GET /api/v1/tasks/export", () => {
  it("401 without org", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it("CSV resolves the type label and the status bucket", async () => {
    const res = await GET(req("?format=csv"))
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    const text = await res.text()
    expect(text).toContain("Key,Title,Type,Event type,Status,Stage,Priority,Assignee")
    expect(text).toContain("PRJ-1")
    expect(text).toContain("Build landing")
    expect(text).toContain("SEO")          // displayName, not the machine "seo"
    expect(text).toContain("914 LINE")     // event-type displayName resolved in its column
    expect(text).toContain("Ongoing")      // in_progress → ongoing bucket
    expect(text).toContain("MKT — Marketing")
    expect(text).toContain("Completed")    // done → completed bucket (PRJ-2)
  })

  it("xlsx returns the spreadsheet mime + a dated filename", async () => {
    const res = await GET(req("?format=xlsx"))
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain("tasks-export-")
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx")
  })

  it("blocked access (inaccessible divisionId) exports an empty file, no task query", async () => {
    vi.mocked(buildTaskListWhere).mockResolvedValue({ where: {}, blocked: true })
    const res = await GET(req("?format=csv&divisionId=other"))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain("Key,Title,Type")  // header present
    expect(text).not.toContain("PRJ-1")        // no rows
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("groupBy=type sorts rows by type label (Bug before SEO)", async () => {
    const res = await GET(req("?format=csv&groupBy=type"))
    const text = await res.text()
    expect(text.indexOf("PRJ-2")).toBeLessThan(text.indexOf("PRJ-1")) // Bug < SEO
  })

  it("includes active task custom fields as extra columns", async () => {
    vi.mocked(prisma.customField.findMany).mockResolvedValue([
      { fieldName: "brand", fieldLabel: "Brand" },
    ] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { ...TASKS[0], customFields: { brand: "Acme" } },
    ] as any)
    const res = await GET(req("?format=csv"))
    const text = await res.text()
    expect(text).toContain("Brand")  // header
    expect(text).toContain("Acme")   // value
  })
})
