import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    division: { findFirst: vi.fn() },
    boardColumn: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    task: { updateMany: vi.fn() },
  }
  prisma.$transaction = vi.fn((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve(arg),
  )
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { PUT } from "@/app/api/v1/divisions/[id]/columns/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ADMIN = { orgId: "org-1", userId: "u-admin", role: "admin", email: "", name: "" }
const SALES = { orgId: "org-1", userId: "u-sales", role: "sales", email: "", name: "" }
const req = (body: unknown) =>
  new Request("http://localhost/api/v1/divisions/d1/columns", { method: "PUT", body: JSON.stringify(body) }) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.clearAllMocks())

describe("PUT /api/v1/divisions/[id]/columns", () => {
  it("sales role → 403, no writes", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    const res = await PUT(req({ columns: [{ label: "X", mapsToStatus: "todo" }] }), params("d1"))
    expect(res.status).toBe(403)
    expect(prisma.boardColumn.upsert).not.toHaveBeenCalled()
  })

  it("cross-org division → 404", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue(null)
    const res = await PUT(req({ columns: [{ label: "X", mapsToStatus: "todo" }] }), params("other"))
    expect(res.status).toBe(404)
  })

  it("empty columns / invalid mapsToStatus → 400 (Zod)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    expect((await PUT(req({ columns: [] }), params("d1"))).status).toBe(400)
    expect((await PUT(req({ columns: [{ label: "X", mapsToStatus: "bogus" }] }), params("d1"))).status).toBe(400)
  })

  it("duplicate key in payload → 400, no transaction", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    const res = await PUT(req({ columns: [
      { key: "a", label: "A", mapsToStatus: "todo" },
      { key: "a", label: "B", mapsToStatus: "done" },
    ] }), params("d1"))
    expect(res.status).toBe(400)
    expect(prisma.boardColumn.findMany).not.toHaveBeenCalled()
  })

  it("provided key that doesn't exist on the board → 400", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValueOnce([{ key: "backlog" }] as any)
    const res = await PUT(req({ columns: [{ key: "ghost", label: "X", mapsToStatus: "todo" }] }), params("d1"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Unknown column key")
  })

  it("adds new columns (generates keys), sortOrder = index, mapsToStatus preserved", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardColumn.findMany)
      .mockResolvedValueOnce([] as any) // existing (none)
      .mockResolvedValueOnce([{ key: "col_a", label: "Backlog" }, { key: "col_b", label: "Doing" }] as any) // result
    const res = await PUT(req({ columns: [
      { label: "Backlog", mapsToStatus: "backlog", color: "#EA580C" },
      { label: "Doing", mapsToStatus: "in_progress" },
    ] }), params("d1"))
    expect(res.status).toBe(200)
    const upserts = vi.mocked(prisma.boardColumn.upsert).mock.calls.map((c: any) => c[0])
    expect(upserts).toHaveLength(2)
    expect(upserts.map((u: any) => u.create.label)).toEqual(["Backlog", "Doing"])
    expect(upserts.map((u: any) => u.create.mapsToStatus)).toEqual(["backlog", "in_progress"])
    expect(upserts.map((u: any) => u.create.sortOrder)).toEqual([0, 1])
    expect(upserts.every((u: any) => /^col_[0-9a-f]{16}$/.test(u.create.key))).toBe(true)
    expect(upserts[0].create.color).toBe("#EA580C")
    expect(upserts[1].create.color).toBeNull()
    expect(prisma.task.updateMany).not.toHaveBeenCalled() // nothing removed
  })

  it("removing a column deletes it AND detaches its tasks (boardColumnKey -> null)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardColumn.findMany)
      .mockResolvedValueOnce([{ key: "backlog" }, { key: "todo" }] as any) // existing
      .mockResolvedValueOnce([{ key: "backlog" }] as any) // result
    const res = await PUT(req({ columns: [{ key: "backlog", label: "Backlog", mapsToStatus: "backlog" }] }), params("d1"))
    expect(res.status).toBe(200)
    // tasks in the removed "todo" column are detached, org+division scoped
    const upd = vi.mocked(prisma.task.updateMany).mock.calls[0][0] as any
    expect(upd.where).toEqual({ organizationId: "org-1", divisionId: "d1", boardColumnKey: { in: ["todo"] } })
    expect(upd.data).toEqual({ boardColumnKey: null })
    // the removed column is deleted
    const del = vi.mocked(prisma.boardColumn.deleteMany).mock.calls[0][0] as any
    expect(del.where.key.in).toEqual(["todo"])
  })

  it("audits the change with BOTH the prior and new column sets", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardColumn.findMany)
      .mockResolvedValueOnce([{ key: "backlog", label: "Backlog", mapsToStatus: "backlog" }] as any) // before
      .mockResolvedValueOnce([{ key: "backlog", label: "Icebox", mapsToStatus: "backlog" }] as any) // after (renamed)
    const res = await PUT(req({ columns: [{ key: "backlog", label: "Icebox", mapsToStatus: "backlog" }] }), params("d1"))
    expect(res.status).toBe(200)
    const audit = vi.mocked(logAudit).mock.calls[0] as any
    expect(audit[5]).toEqual({
      oldValue: { columns: ["backlog:Backlog=>backlog"] },
      newValue: { columns: ["backlog:Icebox=>backlog"] },
    })
  })
})
