import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    division: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    boardPermission: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    boardColumn: { createMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    user: { findFirst: vi.fn() },
    task: { findMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  }
  // $transaction supports both forms: an array of ops, OR an interactive callback
  // (invoked with the mock itself as `tx`, so tx.* routes to these same mocks).
  prisma.$transaction = vi.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.resolve(arg),
  )
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { GET as DIV_GET, POST as DIV_POST } from "@/app/api/v1/divisions/route"
import { PATCH as DIV_PATCH, DELETE as DIV_DELETE } from "@/app/api/v1/divisions/[id]/route"
import { POST as DIV_IMPORT } from "@/app/api/v1/divisions/[id]/import-tasks/route"
import { GET as BP_GET, POST as BP_POST, DELETE as BP_DELETE } from "@/app/api/v1/board-permissions/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ADMIN = { orgId: "org-1", userId: "u-admin", role: "admin", email: "", name: "" }
const MANAGER = { orgId: "org-1", userId: "u-mgr", role: "manager", email: "", name: "" }
const SALES = { orgId: "org-1", userId: "u-sales", role: "sales", email: "", name: "" }

const req = (url: string, opts?: RequestInit) => new Request(url, opts) as any

beforeEach(() => vi.clearAllMocks())

describe("GET/POST /api/v1/divisions", () => {
  it("GET lists divisions org-scoped", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findMany).mockResolvedValue([{ id: "d1", key: "KHS" }] as any)
    const res = await DIV_GET(req("http://localhost/api/v1/divisions"))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.division.findMany).mock.calls[0][0] as any).where.organizationId).toBe("org-1")
  })

  it("POST admin creates a board and upper-cases the key (201)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.create).mockResolvedValue({ id: "d1", key: "KHS", name: "Pentest" } as any)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "khs", name: "Pentest" }) }))
    expect(res.status).toBe(201)
    const data = (vi.mocked(prisma.division.create).mock.calls[0][0] as any).data
    expect(data.key).toBe("KHS")
    expect(data.organizationId).toBe("org-1")
  })

  it("POST manager is allowed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(MANAGER as any)
    vi.mocked(prisma.division.create).mockResolvedValue({ id: "d2", key: "ENG", name: "Eng" } as any)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "ENG", name: "Eng" }) }))
    expect(res.status).toBe(201)
  })

  it("POST seeds the six default board_columns for the new board", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.create).mockResolvedValue({ id: "d9", key: "ENG", name: "Eng" } as any)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "ENG", name: "Eng" }) }))
    expect(res.status).toBe(201)
    const seeded = (vi.mocked(prisma.boardColumn.createMany).mock.calls[0][0] as any).data
    expect(seeded.map((c: any) => c.key)).toEqual(["backlog", "todo", "in_progress", "testing", "review", "done"])
    expect(seeded.every((c: any) => c.mapsToStatus === c.key && c.divisionId === "d9" && c.organizationId === "org-1")).toBe(true)
  })

  it("POST as sales → 403, no create", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "KHS", name: "X" }) }))
    expect(res.status).toBe(403)
    expect(prisma.division.create).not.toHaveBeenCalled()
  })

  it("POST invalid key → 400", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "A B", name: "X" }) }))
    expect(res.status).toBe(400)
  })

  it("POST duplicate key (P2002) → 400", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "KHS", name: "X" }) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("already exists")
  })

  it("POST cross-tenant headUserId → 400 (Codex P0)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await DIV_POST(req("http://localhost/api/v1/divisions", { method: "POST", body: JSON.stringify({ key: "KHS", name: "X", headUserId: "other-org" }) }))
    expect(res.status).toBe(400)
    expect(prisma.division.create).not.toHaveBeenCalled()
  })
})

describe("GET/POST/DELETE /api/v1/board-permissions", () => {
  it("GET lists grants org-scoped + by divisionId (admin)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([{ id: "bp1", userId: "u2" }] as any)
    const res = await BP_GET(req("http://localhost/api/v1/board-permissions?divisionId=d1"))
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.boardPermission.findMany).mock.calls[0][0] as any).where
    expect(where.organizationId).toBe("org-1")
    expect(where.divisionId).toBe("d1")
  })

  it("GET as sales → 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await BP_GET(req("http://localhost/api/v1/board-permissions"))
    expect(res.status).toBe(403)
  })

  it("POST upserts a grant after validating user+division in org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u2" } as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardPermission.upsert).mockResolvedValue({ id: "bp1" } as any)
    const res = await BP_POST(req("http://localhost/api/v1/board-permissions", { method: "POST", body: JSON.stringify({ userId: "u2", divisionId: "d1", canView: true, canMoveToTesting: true }) }))
    expect(res.status).toBe(200)
    const up = vi.mocked(prisma.boardPermission.upsert).mock.calls[0][0] as any
    expect(up.where.userId_divisionId).toEqual({ userId: "u2", divisionId: "d1" })
    expect(up.create.organizationId).toBe("org-1")
    expect(up.create.canView).toBe(true)
    expect(up.create.canMoveToTesting).toBe(true)
  })

  it("POST cross-tenant user → 400, no upsert (Codex P0)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    const res = await BP_POST(req("http://localhost/api/v1/board-permissions", { method: "POST", body: JSON.stringify({ userId: "x", divisionId: "d1", canView: true }) }))
    expect(res.status).toBe(400)
    expect(prisma.boardPermission.upsert).not.toHaveBeenCalled()
  })

  it("POST as sales → 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await BP_POST(req("http://localhost/api/v1/board-permissions", { method: "POST", body: JSON.stringify({ userId: "u2", divisionId: "d1" }) }))
    expect(res.status).toBe(403)
  })

  it("DELETE by id is org-scoped and audits the revoke", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.boardPermission.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await BP_DELETE(req("http://localhost/api/v1/board-permissions?id=bp1", { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.boardPermission.deleteMany).mock.calls[0][0] as any).where).toEqual({ id: "bp1", organizationId: "org-1" })
    // revoking board access is audit-logged when a row actually went away
    expect(logAudit).toHaveBeenCalledWith("org-1", "delete", "board_permission", "bp1", undefined, { oldValue: { id: "bp1" } })
  })

  it("DELETE of an absent grant is idempotent: 200, no audit (no spurious member-diff failure)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.boardPermission.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await BP_DELETE(req("http://localhost/api/v1/board-permissions?userId=u9&divisionId=d9", { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("DELETE without id or user+division → 400", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    const res = await BP_DELETE(req("http://localhost/api/v1/board-permissions", { method: "DELETE" }))
    expect(res.status).toBe(400)
    expect(prisma.boardPermission.deleteMany).not.toHaveBeenCalled()
  })
})

describe("PATCH/DELETE /api/v1/divisions/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it("PATCH admin edits name/color (200)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.division.update).mockResolvedValue({ id: "d1", name: "New" } as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ name: "New", color: "#00875A" }) }), params("d1"))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.division.update).mock.calls[0][0] as any).data.name).toBe("New")
  })

  it("PATCH manager is allowed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(MANAGER as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.division.update).mockResolvedValue({ id: "d1", name: "X" } as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ name: "X" }) }), params("d1"))
    expect(res.status).toBe(200)
  })

  it("PATCH as sales → 403, no update", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ name: "X" }) }), params("d1"))
    expect(res.status).toBe(403)
    expect(prisma.division.update).not.toHaveBeenCalled()
  })

  it("PATCH cross-org division → 404 (org-scope guard)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue(null)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/other", { method: "PATCH", body: JSON.stringify({ name: "X" }) }), params("other"))
    expect(res.status).toBe(404)
    expect(prisma.division.update).not.toHaveBeenCalled()
  })

  it("PATCH admin sets the per-board slaTargetDays (#14)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.division.update).mockResolvedValue({ id: "d1", slaTargetDays: 7 } as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ slaTargetDays: 7 }) }), params("d1"))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.division.update).mock.calls[0][0] as any).data.slaTargetDays).toBe(7)
  })

  it("PATCH slaTargetDays=null clears it (back to the global default)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.division.update).mockResolvedValue({ id: "d1", slaTargetDays: null } as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ slaTargetDays: null }) }), params("d1"))
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.division.update).mock.calls[0][0] as any).data.slaTargetDays).toBeNull()
  })

  it("PATCH slaTargetDays out of range → 400, no update", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ slaTargetDays: 0 }) }), params("d1"))
    expect(res.status).toBe(400)
    expect(prisma.division.update).not.toHaveBeenCalled()
  })

  it("PATCH cross-tenant headUserId → 400, no update", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await DIV_PATCH(req("http://localhost/api/v1/divisions/d1", { method: "PATCH", body: JSON.stringify({ headUserId: "other-org" }) }), params("d1"))
    expect(res.status).toBe(400)
    expect(prisma.division.update).not.toHaveBeenCalled()
  })

  it("DELETE admin soft-archives (isActive=false, org-scoped, 200)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await DIV_DELETE(req("http://localhost/api/v1/divisions/d1", { method: "DELETE" }), params("d1"))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.division.updateMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: "d1", organizationId: "org-1" })
    expect(call.data.isActive).toBe(false)
  })

  it("DELETE as sales → 403, no archive", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await DIV_DELETE(req("http://localhost/api/v1/divisions/d1", { method: "DELETE" }), params("d1"))
    expect(res.status).toBe(403)
    expect(prisma.division.updateMany).not.toHaveBeenCalled()
  })

  it("DELETE non-existent / cross-org → 404 (count 0)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await DIV_DELETE(req("http://localhost/api/v1/divisions/nope", { method: "DELETE" }), params("nope"))
    expect(res.status).toBe(404)
  })
})

describe("POST /api/v1/divisions/[id]/import-tasks", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it("admin moves loose tasks into the board + assigns keys to keyless ones (200)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1", key: "HHH", name: "TEST" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: "t1", taskKey: null }, { id: "t2", taskKey: "HHH-5" }] as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ max: 5 }] as any) // generateTaskKey → next = HHH-6
    const res = await DIV_IMPORT(req("http://localhost/api/v1/divisions/d1/import-tasks", { method: "POST" }), params("d1"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.moved).toBe(2)
    const calls = vi.mocked(prisma.task.update).mock.calls.map((c: any) => c[0])
    const t1 = calls.find((c: any) => c.where.id === "t1")
    const t2 = calls.find((c: any) => c.where.id === "t2")
    expect(t1.data).toEqual({ divisionId: "d1", taskKey: "HHH-6" }) // keyless → assigned next key
    expect(t2.data).toEqual({ divisionId: "d1" })                   // already keyed → key untouched
  })

  it("as sales → 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await DIV_IMPORT(req("http://localhost/api/v1/divisions/d1/import-tasks", { method: "POST" }), params("d1"))
    expect(res.status).toBe(403)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("cross-org board → 404", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue(null)
    const res = await DIV_IMPORT(req("http://localhost/api/v1/divisions/other/import-tasks", { method: "POST" }), params("other"))
    expect(res.status).toBe(404)
  })

  it("no loose tasks → moved 0", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1", key: "HHH", name: "TEST" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    const res = await DIV_IMPORT(req("http://localhost/api/v1/divisions/d1/import-tasks", { method: "POST" }), params("d1"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.moved).toBe(0)
  })
})
