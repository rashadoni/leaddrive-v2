import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const mocks = vi.hoisted(() => ({
  findSubjects: vi.fn(),
  listProfiles: vi.fn(),
  findCandidates: vi.fn(),
  getScenarios: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { monitoringSubject: { findMany: mocks.findSubjects } },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (_m: string, _a: string, handler: unknown) => handler,
}))

vi.mock("@/lib/social/monitoring-profiles", () => ({
  createOrUpdateMonitoringProfile: vi.fn(),
  findProfileCandidates: mocks.findCandidates,
  listMonitoringProfiles: mocks.listProfiles,
  suggestProfileAliases: vi.fn(() => []),
  buildMonitoringProfileView: vi.fn(),
  pickCanonicalScenario: vi.fn(),
}))

vi.mock("@/lib/social/monitoring-profile-schema", () => ({
  monitoringProfileSchema: { safeParse: vi.fn() },
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: mocks.getScenarios,
}))

import { GET } from "@/app/api/v1/social/monitoring-profiles/route"

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/social/monitoring-profiles${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findSubjects.mockResolvedValue([])
  mocks.listProfiles.mockResolvedValue([])
})

describe("GET /api/v1/social/monitoring-profiles?companyId=", () => {
  it("возвращает только объекты этого клиента и не считает находки по всей организации", async () => {
    mocks.findSubjects.mockResolvedValue([
      { id: "subject-1", name: "Bravo", status: "active" },
      { id: "subject-2", name: "Bravo Express", status: "paused" },
    ])

    const response = await GET(request("?companyId=company-1"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.linked).toHaveLength(2)
    // Полный список считает находки по всем объектам организации — карточке
    // компании это не нужно.
    expect(mocks.listProfiles).not.toHaveBeenCalled()
    expect(mocks.getScenarios).not.toHaveBeenCalled()
  })

  it("скоупится тенантом и прячет только удалённые, но не архивные", async () => {
    await GET(request("?companyId=company-1"))

    expect(mocks.findSubjects).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        companyId: "company-1",
        // Архив обратим: скрытая связь была бы невидимой, её нечем было бы
        // отвязать, а карточка предлагала бы завести дубль.
        status: { not: "deleted" },
      },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    })
  })

  it("не подменяет остальные ветки маршрута", async () => {
    await GET(request())

    expect(mocks.findSubjects).not.toHaveBeenCalled()
    expect(mocks.listProfiles).toHaveBeenCalledWith("org-1")
  })

  it("пустой companyId не включает ветку карточки компании", async () => {
    await GET(request("?companyId=%20%20"))

    expect(mocks.findSubjects).not.toHaveBeenCalled()
    expect(mocks.listProfiles).toHaveBeenCalledTimes(1)
  })
})
