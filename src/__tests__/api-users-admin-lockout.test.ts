import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * Audit of «Настройки → Пользователи», 2026-11-07: an administrator could
 * delete (anonymize, irreversibly) their own account, switch it off, and demote
 * or switch off the organization's last administrator — each one leaves the
 * tenant with nobody who can open Settings again. The routes refuse these now,
 * before anything is written.
 */

type Target = { id: string; organizationId: string; name: string; email: string; role: string; isActive: boolean; anonymizedAt: null }
const state: { target: Target | null; otherAdmins: number; updated: boolean; anonymized: boolean } = {
  target: null, otherAdmins: 0, updated: false, anonymized: false,
}

vi.mock("@/lib/api-auth", () => {
  const auth = { userId: "admin_1", orgId: "org_1", role: "admin", email: "a@b.com", name: "A", principalType: "session" }
  return {
    getSession: vi.fn(async () => auth),
    requireAuth: vi.fn(async () => auth),
    requireSessionAuth: vi.fn(async () => auth),
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
    isAuthError: vi.fn((x: unknown) => x instanceof NextResponse),
  }
})
vi.mock("@/lib/deal-stage-vocabulary", () => ({ orgStageVocabulary: vi.fn(async () => ({ closedStages: [] })) }))
vi.mock("@/lib/user-work-handover", () => ({
  handOverOpenWork: vi.fn(async () => ({ deals: 2, leads: 1, tickets: 0, tasks: 0, projectTasks: 0, projects: 0, divisions: 0 })),
}))
vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: vi.fn(async () => state.target),
    count: vi.fn(async () => state.otherAdmins),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.anonymizedAt) state.anonymized = true
      else state.updated = true
      return { ...state.target, ...data }
    }),
  }
  return {
    logAudit: vi.fn(),
    prisma: { user, $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ user })) },
  }
})

import { DELETE, PUT } from "@/app/api/v1/users/[id]/route"
import { prisma } from "@/lib/prisma"

const put = (id: string, body: unknown) => PUT(
  new NextRequest(`https://example.com/api/v1/users/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id }) },
)
const del = (id: string) => DELETE(
  new NextRequest(`https://example.com/api/v1/users/${id}`, { method: "DELETE" }),
  { params: Promise.resolve({ id }) },
)
const admin = (id: string) => ({ id, organizationId: "org_1", name: "Admin", email: `${id}@x.az`, role: "admin", isActive: true, anonymizedAt: null })

beforeEach(() => {
  vi.clearAllMocks()
  state.updated = false
  state.anonymized = false
  state.otherAdmins = 0
})

describe("an administrator cannot lock the organization out", () => {
  it("refuses to delete one's own account", async () => {
    state.target = admin("admin_1")
    state.otherAdmins = 3
    const res = await del("admin_1")
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("SELF_DELETE")
    expect(state.anonymized).toBe(false)
  })

  it("refuses to switch off one's own account", async () => {
    state.target = admin("admin_1")
    state.otherAdmins = 3
    const res = await put("admin_1", { isActive: false })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("SELF_DEACTIVATE")
    expect(state.updated).toBe(false)
  })

  it.each([
    ["demoting", { role: "manager" }],
    ["switching off", { isActive: false }],
  ])("refuses %s the last active administrator", async (_what, body) => {
    state.target = admin("admin_2")
    const res = await put("admin_2", body)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("LAST_ADMIN")
    expect(state.updated).toBe(false)
    // "Other working admins" means active, not anonymized, role admin, not this one.
    expect(vi.mocked(prisma.user.count).mock.calls[0][0]).toEqual({
      where: { organizationId: "org_1", role: "admin", isActive: true, anonymizedAt: null, id: { not: "admin_2" } },
    })
  })

  it("refuses to delete the last active administrator", async () => {
    state.target = admin("admin_2")
    const res = await del("admin_2")
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("LAST_ADMIN")
    expect(state.anonymized).toBe(false)
  })

  it("lets an administrator go when another one remains", async () => {
    state.target = admin("admin_2")
    state.otherAdmins = 1
    expect((await put("admin_2", { role: "manager" })).status).toBe(200)
    expect(state.updated).toBe(true)
    const res = await del("admin_2")
    expect(res.status).toBe(200)
    expect((await res.json()).handover).toMatchObject({ deals: 2, leads: 1 })
    expect(state.anonymized).toBe(true)
  })

  it("does not count anything for ordinary edits or non-admins", async () => {
    state.target = admin("admin_2")
    expect((await put("admin_2", { name: "Renamed", role: "admin", isActive: true })).status).toBe(200)
    state.target = { ...admin("u_3"), role: "sales" }
    expect((await put("u_3", { isActive: false })).status).toBe(200)
    expect(prisma.user.count).not.toHaveBeenCalled()
  })
})
