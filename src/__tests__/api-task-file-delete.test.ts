/**
 * Removing a file of a task (Zeytun, 2026-11-12: «əlavə olunanları da silmək
 * olmur»): only a file of that task in that organization; the row goes, the
 * bytes follow, and a stored name that is not ours never becomes a path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  files: [] as Array<{ id: string; taskId: string; organizationId: string; fileName: string; originalName: string; uploadedBy?: string | null }>,
  unlinked: [] as string[],
  activities: [] as unknown[],
  // Who the board task t1 is: the caller u-1 made it, unless a test says otherwise.
  t1: { id: "t1", divisionId: "board-1", createdBy: "u-1", assignedTo: null as string | null, collaborators: [] as { userId: string }[] },
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_m: string, _a: string, handler: (req: NextRequest, auth: unknown, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) => handler(req, { orgId: "org-z", userId: "u-1", role: "sales" }, ctx),
}))
vi.mock("fs/promises", async (orig) => ({ ...(await orig<typeof import("fs/promises")>()), unlink: vi.fn(async (p: string) => { state.unlinked.push(p) }) }))
vi.mock("@/lib/runtime-paths", () => ({ runtimePublicUploadDirectory: () => "/uploads/tasks" }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) => (where.id === "t1" && where.organizationId === "org-z" ? { id: "t1" } : null)),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; organizationId: string } }) =>
        (where.organizationId === "org-z" && where.id.in.includes("t1") ? [state.t1] : [])),
    },
    taskAttachment: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; taskId: string; organizationId: string } }) =>
        state.files.find((f) => f.id === where.id && f.taskId === where.taskId && f.organizationId === where.organizationId) ?? null),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { state.files = state.files.filter((f) => f.id !== where.id) }),
    },
    taskActivity: { create: vi.fn(async (args: unknown) => { state.activities.push(args) }) },
  },
}))

const { DELETE } = await import("@/app/api/v1/tasks/[id]/files/route")
const del = (taskId: string, fileId: string) =>
  DELETE(new NextRequest(`http://crm.test/api/v1/tasks/${taskId}/files?fileId=${fileId}`, { method: "DELETE" }), { params: Promise.resolve({ id: taskId }) } as never)

beforeEach(() => {
  state.files = [
    { id: "f1", taskId: "t1", organizationId: "org-z", fileName: "0123456789abcdef0123456789abcdef.jpg", originalName: "afişa.jpg" },
    { id: "f2", taskId: "t2", organizationId: "org-z", fileName: "fedcba9876543210fedcba9876543210.pdf", originalName: "other.pdf" },
    { id: "f3", taskId: "t1", organizationId: "org-z", fileName: "../../etc/passwd", originalName: "odd" },
  ]
  state.unlinked = []
  state.activities = []
  state.t1 = { id: "t1", divisionId: "board-1", createdBy: "u-1", assignedTo: null, collaborators: [] }
})

describe("DELETE /api/v1/tasks/[id]/files", () => {
  it("removes the task's file — row and bytes — and writes it in the task's history", async () => {
    const res = await del("t1", "f1")
    expect(res.status).toBe(200)
    expect(state.files.map((f) => f.id)).toEqual(["f2", "f3"])
    expect(state.unlinked).toEqual(["/uploads/tasks/0123456789abcdef0123456789abcdef.jpg"])
    expect(JSON.stringify(state.activities)).toContain("file_removed")
  })

  it("will not remove another task's file, or anything on an unknown task", async () => {
    expect((await del("t1", "f2")).status).toBe(404)
    expect((await del("t9", "f1")).status).toBe(404)
    expect(state.files).toHaveLength(3)
  })

  it("a stored name that is not one of ours is never turned into a path", async () => {
    expect((await del("t1", "f3")).status).toBe(200)
    expect(state.unlinked).toEqual([])
  })

  // Ulviyya, 2026-11-12: «özümüzdən başqa bizim taskları heç kim idarə edə bilməsin».
  it("someone else's board task keeps its files: only its people, or who added the file, remove one", async () => {
    state.t1 = { id: "t1", divisionId: "board-1", createdBy: "u-7", assignedTo: "u-8", collaborators: [] }
    const refused = await del("t1", "f1")
    expect(refused.status).toBe(403)
    expect(state.files.map((f) => f.id)).toEqual(["f1", "f2", "f3"])
    expect(state.unlinked).toEqual([])

    state.files[0].uploadedBy = "u-1"
    expect((await del("t1", "f1")).status).toBe(200)

    state.t1 = { id: "t1", divisionId: "board-1", createdBy: "u-7", assignedTo: "u-8", collaborators: [{ userId: "u-1" }] }
    expect((await del("t1", "f3")).status).toBe(200)
  })
})
