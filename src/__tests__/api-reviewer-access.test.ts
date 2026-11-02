/**
 * Reviewer access API: only an admin gives, lists, closes and reads the
 * journal; the login it creates is a read-only `reviewer` with every
 * unticked section hidden; the end date cannot exceed 30 days; closing
 * deactivates the login and revokes its sessions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { db, logAudit } = vi.hoisted(() => {
  const db = {
    user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    reviewerAccessGrant: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    complianceAuditLog: { groupBy: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(db))
  return { db, logAudit: vi.fn() }
})
vi.mock("@/lib/prisma", () => ({ prisma: db, logAudit: (...args: unknown[]) => logAudit(...args) }))

const auth = vi.hoisted(() => ({ role: "admin" }))
type Handler = (req: NextRequest, auth: Record<string, unknown>, ctx: unknown) => Promise<Response>
vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: Handler) => (req: NextRequest, ctx: unknown) =>
    handler(req, { orgId: "org_1", userId: "admin_1", role: auth.role, email: "a@b.c", name: "Admin", principalType: "session" }, ctx),
}))

import { GET, POST } from "@/app/api/v1/reviewer-access/route"
import { DELETE } from "@/app/api/v1/reviewer-access/[id]/route"
import { GET as JOURNAL } from "@/app/api/v1/reviewer-access/[id]/journal/route"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/v1/reviewer-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))
}

const valid = { name: "Auditor", email: "Audit@Firma.az", modules: ["crm", "sales"], expiresAt: inDays(7), reason: "NDA review" }

beforeEach(() => {
  vi.clearAllMocks()
  auth.role = "admin"
  db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(db))
  db.user.findFirst.mockResolvedValue(null)
  db.user.create.mockResolvedValue({ id: "rev_1", email: "audit@firma.az" })
  db.reviewerAccessGrant.count.mockResolvedValue(0)
  db.reviewerAccessGrant.create.mockImplementation(async ({ data }: { data: { expiresAt: Date } }) => ({ id: "grant_1", expiresAt: data.expiresAt }))
})

describe("POST /api/v1/reviewer-access", () => {
  it("creates a read-only reviewer with every unticked section hidden, and shows the password once", async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const json = await res.json()
    expect(json.data).toMatchObject({ id: "grant_1", email: "audit@firma.az" })
    expect(typeof json.data.password).toBe("string")
    expect(json.data.password.length).toBeGreaterThanOrEqual(12)

    const user = db.user.create.mock.calls[0][0].data
    expect(user).toMatchObject({ organizationId: "org_1", role: "reviewer", isActive: true, email: "audit@firma.az" })
    expect(user.passwordHash).not.toContain(json.data.password)
    expect(user.hiddenModules).toEqual(USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "crm" && id !== "sales"))
    expect(db.reviewerAccessGrant.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org_1", userId: "rev_1", modules: ["crm", "sales"], reason: "NDA review", grantedByUserId: "admin_1",
    })
    expect(logAudit).toHaveBeenCalledWith("org_1", "reviewer_access_granted", "user", "rev_1", "audit@firma.az", expect.anything())
  })

  it("refuses an end date beyond 30 days or in the past", async () => {
    for (const expiresAt of [inDays(32), inDays(-1)]) {
      const res = await post({ ...valid, expiresAt })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("REVIEWER_ACCESS_EXPIRY_RANGE")
    }
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it("refuses an unknown section, no section and a taken e-mail", async () => {
    expect((await post({ ...valid, modules: ["settings"] })).status).toBe(400)
    expect((await post({ ...valid, modules: [] })).status).toBe(400)
    db.user.findFirst.mockResolvedValueOnce({ id: "someone" })
    const taken = await post(valid)
    expect(taken.status).toBe(409)
    expect((await taken.json()).code).toBe("REVIEWER_ACCESS_EMAIL_TAKEN")
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it("caps open grants at five", async () => {
    db.reviewerAccessGrant.count.mockResolvedValueOnce(5)
    expect((await post(valid)).status).toBe(409)
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it("is admin-only", async () => {
    for (const other of ["manager", "viewer", "reviewer", "sales"]) {
      auth.role = other
      expect((await post(valid)).status, other).toBe(403)
      expect((await GET(new NextRequest("http://localhost/api/v1/reviewer-access"))).status, other).toBe(403)
    }
    expect(db.user.create).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/reviewer-access", () => {
  it("lists grants with whether they are open and how many reads each made", async () => {
    db.reviewerAccessGrant.findMany.mockResolvedValue([
      { id: "g1", modules: ["crm"], reason: "r", expiresAt: new Date(inDays(3)), createdAt: new Date(), revokedAt: null, user: { id: "rev_1", name: "A", email: "a@x", lastLogin: null } },
      { id: "g2", modules: ["crm"], reason: "r", expiresAt: new Date(inDays(3)), createdAt: new Date(), revokedAt: new Date(), user: { id: "rev_2", name: "B", email: "b@x", lastLogin: null } },
    ])
    db.complianceAuditLog.groupBy.mockResolvedValue([{ userId: "rev_1", _count: { _all: 12 } }])
    const json = await (await GET(new NextRequest("http://localhost/api/v1/reviewer-access"))).json()
    expect(json.data.map((row: { id: string; open: boolean; reads: number }) => [row.id, row.open, row.reads])).toEqual([
      ["g1", true, 12],
      ["g2", false, 0],
    ])
  })
})

describe("DELETE /api/v1/reviewer-access/[id]", () => {
  const ctx = { params: Promise.resolve({ id: "g1" }) }
  const req = () => new NextRequest("http://localhost/api/v1/reviewer-access/g1", { method: "DELETE" })

  it("closes the grant, deactivates the login and revokes its sessions", async () => {
    db.reviewerAccessGrant.findFirst.mockResolvedValue({ id: "g1", userId: "rev_1", revokedAt: null, user: { email: "a@x" } })
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(200)
    expect(db.reviewerAccessGrant.update.mock.calls[0][0]).toMatchObject({ where: { id: "g1" }, data: { revokedByUserId: "admin_1" } })
    const userUpdate = db.user.update.mock.calls[0][0]
    expect(userUpdate.where).toEqual({ id: "rev_1" })
    expect(userUpdate.data.isActive).toBe(false)
    expect(userUpdate.data.passwordChangedAt).toBeInstanceOf(Date)
    expect(db.reviewerAccessGrant.findFirst.mock.calls[0][0].where).toEqual({ id: "g1", organizationId: "org_1" })
  })

  it("is a no-op for an already closed grant and 404 for another tenant's", async () => {
    db.reviewerAccessGrant.findFirst.mockResolvedValueOnce({ id: "g1", userId: "rev_1", revokedAt: new Date(), user: { email: "a@x" } })
    expect((await DELETE(req(), ctx)).status).toBe(200)
    db.reviewerAccessGrant.findFirst.mockResolvedValueOnce(null)
    expect((await DELETE(req(), ctx)).status).toBe(404)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/reviewer-access/[id]/journal", () => {
  it("returns the reviewer's reads from the compliance log, newest first", async () => {
    db.reviewerAccessGrant.findFirst.mockResolvedValue({ userId: "rev_1" })
    db.complianceAuditLog.findMany.mockResolvedValue([
      { id: "l1", occurredAt: new Date(), recordTable: "contacts", recordId: "cm1", ipAddress: "1.2.3.4", metadata: { kind: "record", path: "/api/v1/contacts/cm1" } },
    ])
    const json = await (await JOURNAL(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: "g1" }) })).json()
    expect(db.complianceAuditLog.findMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: "org_1", userId: "rev_1" }, orderBy: { occurredAt: "desc" } })
    expect(json.data[0]).toMatchObject({ section: "contacts", kind: "record", recordId: "cm1", path: "/api/v1/contacts/cm1" })
  })
})
