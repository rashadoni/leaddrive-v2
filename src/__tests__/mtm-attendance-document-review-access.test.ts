import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({ auth: { orgId: "document-org", userId: "reviewer", principalType: "session" } }))
vi.mock("@/lib/mtm/with-attendance-auth", () => ({ withMtmAttendanceAuth: (_action: string, handler: (req: Request, auth: typeof fixture.auth, ctx: unknown) => Promise<Response>) => (req: Request, ctx: unknown) => handler(req, fixture.auth, ctx) }))
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/mtm/attendance-attachment", () => ({ readAttendanceDocument: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { GET } from "@/app/api/v1/mtm/attendance/attachments/[id]/route"
const get = () => GET(new NextRequest("http://localhost/api/v1/mtm/attendance/attachments/document"), { params: Promise.resolve({ id: "document" }) })
beforeEach(() => {
  vi.resetAllMocks(); fixture.auth.principalType = "session"
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (query: TemplateStringsArray) => query.join(" ").includes('FROM "users"') ? [await prisma.user.findFirst()].filter(Boolean) : []) as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm"], modules: { "route-field": true }, settings: {} } as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async () => {
    const row = await prisma.mtmAttendanceAttachment.findFirst() as unknown as { agent: { userId: string; status: string } } | null
    return row?.agent.status === "ACTIVE" ? row.agent : null
  }) as never)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ role: "admin", hiddenModules: [] } as never)
  vi.mocked(prisma.mtmAttendanceAttachment.findFirst).mockResolvedValue({ agentId: "employee", agent: { userId: "employee-user", status: "ACTIVE" } } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(readAttendanceDocument).mockResolvedValue({ bytes: Buffer.from("fixture"), mimeType: "image/jpeg" })
})
describe("CRM private document reviewer admission", () => {
  it("uses the current real scope and private headers", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(readAttendanceDocument).toHaveBeenCalledWith({ organizationId: "document-org", actor: { agentId: null, role: "ADMIN", scopedAgentIds: null } }, "document")
  })
  it.each(["api-key", "read-only", "self", "other-team", "unbounded-manager", "inactive"])("never reads bytes for %s", async (reason) => {
    if (reason === "api-key") fixture.auth.principalType = "api_key"
    if (reason === "read-only") vi.mocked(prisma.user.findFirst).mockResolvedValue({ role: "viewer", hiddenModules: [], mtmAttendanceAll: true } as never)
    if (reason === "self") vi.mocked(prisma.mtmAttendanceAttachment.findFirst).mockResolvedValue({ agentId: "employee", agent: { userId: "reviewer", status: "ACTIVE" } } as never)
    if (reason === "other-team") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: [] })
    if (reason === "unbounded-manager") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: null })
    if (reason === "inactive") vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    expect([403, 404]).toContain((await get()).status)
    expect(readAttendanceDocument).not.toHaveBeenCalled()
  })
})
