/**
 * One's own message on a task: changed or removed by its author, or the admin
 * (Ulviyya, 2026-11-12: «komentdə yazılan mətn redaktə olmur… həmdə silmək
 * olmur»). Someone else's message and the task's own history stay as they are.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  who: { orgId: "org-z", userId: "ulviyya", role: "sales" },
  comments: [] as Array<{ id: string; taskId: string; organizationId: string; userId: string | null; isSystem: boolean; content: string; editedAt: Date | null }>,
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_m: string, _a: string, handler: (req: NextRequest, auth: unknown, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) => handler(req, state.who, ctx),
}))
vi.mock("@/lib/tasks/task-access", () => ({
  openTaskFor: vi.fn(async (_db: unknown, args: { taskId: string; organizationId: string }) => (args.taskId === "t1" && args.organizationId === "org-z" ? { id: "t1" } : null)),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    taskComment: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; taskId: string; organizationId: string } }) =>
        state.comments.find((c) => c.id === where.id && c.taskId === where.taskId && c.organizationId === where.organizationId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { content: string; editedAt: Date } }) => {
        const row = state.comments.find((c) => c.id === where.id)!
        Object.assign(row, data)
        return { id: row.id, content: row.content, editedAt: row.editedAt }
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => { state.comments = state.comments.filter((c) => c.id !== where.id) }),
    },
  },
}))

const route = await import("@/app/api/v1/tasks/[id]/comments/[commentId]/route")
const ctx = (commentId: string, id = "t1") => ({ params: Promise.resolve({ id, commentId }) }) as never
const patch = (commentId: string, content: unknown, id = "t1") =>
  route.PATCH(new NextRequest(`http://crm.test/api/v1/tasks/${id}/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ content }) }), ctx(commentId, id))
const del = (commentId: string) => route.DELETE(new NextRequest(`http://crm.test/api/v1/tasks/t1/comments/${commentId}`, { method: "DELETE" }), ctx(commentId))

beforeEach(() => {
  state.who = { orgId: "org-z", userId: "ulviyya", role: "sales" }
  state.comments = [
    { id: "mine", taskId: "t1", organizationId: "org-z", userId: "ulviyya", isSystem: false, content: "Ağdaş nömrəsi göndərildi\n📎 a.jpg", editedAt: null },
    { id: "hers", taskId: "t1", organizationId: "org-z", userId: "madina", isSystem: false, content: "Qəbul etdim", editedAt: null },
    { id: "history", taskId: "t1", organizationId: "org-z", userId: "ulviyya", isSystem: true, content: "Bordio: moved", editedAt: null },
  ]
})

describe("a task message: its author changes or removes it", () => {
  it("the author changes the text, and the message is marked as edited", async () => {
    const res = await patch("mine", "Ağdaş nömrəsi müştəriyə göndərildi\n📎 a.jpg")
    expect(res.status).toBe(200)
    const row = state.comments.find((c) => c.id === "mine")!
    expect(row.content).toBe("Ağdaş nömrəsi müştəriyə göndərildi\n📎 a.jpg")
    expect(row.editedAt).toBeInstanceOf(Date)
  })

  it("the author removes it", async () => {
    expect((await del("mine")).status).toBe(200)
    expect(state.comments.map((c) => c.id)).toEqual(["hers", "history"])
  })

  it("nobody else changes or removes it, and the task's history is no one's", async () => {
    expect((await patch("hers", "dəyişdim")).status).toBe(403)
    expect((await del("hers")).status).toBe(403)
    expect((await patch("history", "x")).status).toBe(403)
    expect(state.comments.find((c) => c.id === "hers")!.content).toBe("Qəbul etdim")
    expect(state.comments).toHaveLength(3)
  })

  it("the admin may change anyone's; an empty text, another task or an unknown message is refused", async () => {
    state.who = { orgId: "org-z", userId: "boss", role: "admin" }
    expect((await patch("hers", "düzəldildi")).status).toBe(200)
    expect((await patch("hers", "   ")).status).toBe(400)
    expect((await patch("hers", "x", "t9")).status).toBe(404)
    expect((await patch("nope", "x")).status).toBe(404)
  })
})
