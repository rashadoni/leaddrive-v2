/**
 * GET /api/v1/mtm/locations/device — what the selected employee's phone said
 * about itself, for the «device» block of the live map's card (owner,
 * 2026-10-09, of the Navixy demo: «бери почти всё, чего у нас нет», then
 * «добей до 100 %»).
 *
 * The real route behind the real Route & Field wrapper. The database is stood
 * in for by a few employees and their push registrations that answer the
 * route's own queries — its filters and its order are applied to the rows,
 * not merely looked at. A registration here holds everything the table
 * holds, the push address and the installation id included, and is handed
 * over whole, whatever was selected: the answer must not carry them anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/route-permissions")>()),
  resolveMtmRouteActor: vi.fn(),
}))

import { GET } from "@/app/api/v1/mtm/locations/device/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { recordMtmMobileGpsTelemetry } from "@/lib/mtm/mobile-gps-telemetry"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const USER = "user-manager"
const request = (agentId: string | null = "agent-1") => new NextRequest(new URL(
  `http://localhost:3000/api/v1/mtm/locations/device${agentId === null ? "" : `?agentId=${encodeURIComponent(agentId)}`}`,
))

interface Employee { id: string; organizationId: string; status: string }
interface Registration {
  id: string
  organizationId: string
  agentId: string
  // What must stay on the server.
  token: string
  deviceId: string | null
  platform: string
  appVersion: string | null
  lastSeenAt: Date
  disabledAt: Date | null
}
const registration = (id: string, over: Partial<Registration> = {}): Registration => ({
  id, organizationId: ORG, agentId: "agent-1", token: `push-address-${id}-of-the-phone`, deviceId: `installation-${id}`,
  platform: "android", appVersion: "2.4.1", lastSeenAt: new Date("2026-10-09T05:30:00.000Z"), disabledAt: null, ...over,
})

type EmployeeArgs = { where: { id?: string; organizationId?: string; status?: string } }
type RegistrationArgs = {
  where: { organizationId?: string; agentId?: string; disabledAt?: null }
  orderBy?: Array<Record<string, "asc" | "desc">>
  select?: Record<string, boolean>
}

let employees: Employee[]
let registrations: Registration[]

const sortValue = (value: unknown) => (value instanceof Date ? value.getTime() : String(value ?? ""))
/** The first row the route's own filter and order leave — the whole row, as the table holds it. */
const firstRegistration = (args: RegistrationArgs) => registrations
  .filter((row) => row.organizationId === args.where.organizationId
    && row.agentId === args.where.agentId
    && (args.where.disabledAt !== null || row.disabledAt === null))
  .sort((left, right) => {
    for (const rule of args.orderBy ?? []) {
      for (const [field, direction] of Object.entries(rule)) {
        const a = sortValue(left[field as keyof Registration])
        const b = sortValue(right[field as keyof Registration])
        if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1)
      }
    }
    return 0
  })[0] ?? null

const answer = async (agentId: string | null = "agent-1") => {
  const response = await GET(request(agentId))
  return { status: response.status, body: await response.json() as { data?: Record<string, unknown>; error?: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit(`mtm-live-map-device:${ORG}:${USER}`)
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager" })
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
  employees = [
    { id: "agent-1", organizationId: ORG, status: "ACTIVE" },
    { id: "agent-2", organizationId: ORG, status: "ACTIVE" },
    { id: "agent-left", organizationId: ORG, status: "INACTIVE" },
    { id: "agent-elsewhere", organizationId: "org-2", status: "ACTIVE" },
  ]
  registrations = [registration("r1")]
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async (args: EmployeeArgs) => employees.find((row) =>
    row.id === args.where.id && row.organizationId === args.where.organizationId && row.status === args.where.status) ?? null) as never)
  vi.mocked(prisma.mtmDeviceToken.findFirst).mockImplementation((async (args: RegistrationArgs) => firstRegistration(args)) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/v1/mtm/locations/device", () => {
  it("says what the phone reported when it last registered — and only those four things", async () => {
    const { status, body } = await answer()
    expect(status).toBe(200)
    expect(body.data).toEqual({
      notificationsConnected: true,
      platform: "android",
      appVersion: "2.4.1",
      registeredAt: "2026-10-09T05:30:00.000Z",
    })
  })

  it("never lets the push address or the installation id out — they are not asked for, and would not pass if they came", async () => {
    const { body } = await answer()
    // The stand-in hands the whole row over, as a careless select would.
    expect(JSON.stringify(body)).not.toMatch(/push-address|installation-|token|deviceId/i)
    const select = vi.mocked(prisma.mtmDeviceToken.findFirst).mock.calls[0]?.[0] as RegistrationArgs
    expect(Object.keys(select.select ?? {}).sort()).toEqual(["appVersion", "lastSeenAt", "platform"])
  })

  it("a phone that never registered: notifications are not connected, and nothing else is claimed about it", async () => {
    registrations = []
    const { status, body } = await answer()
    expect(status).toBe(200)
    expect(body.data).toEqual({ notificationsConnected: false, platform: null, appVersion: null, registeredAt: null })
  })

  it("a registration the push service has given up on is not a phone that can be reached", async () => {
    registrations = [registration("dead", { disabledAt: new Date("2026-10-08T09:00:00.000Z") })]
    expect((await answer()).body.data).toEqual({ notificationsConnected: false, platform: null, appVersion: null, registeredAt: null })

    // A dead one beside a live one: the live one speaks, though it is the older.
    registrations = [
      registration("dead", { appVersion: "9.9.9", lastSeenAt: new Date("2026-10-09T07:00:00.000Z"), disabledAt: new Date("2026-10-09T08:00:00.000Z") }),
      registration("live", { appVersion: "2.3.0", lastSeenAt: new Date("2026-10-07T07:00:00.000Z") }),
    ]
    expect((await answer()).body.data).toMatchObject({ notificationsConnected: true, appVersion: "2.3.0", registeredAt: "2026-10-07T07:00:00.000Z" })
  })

  it("of two phones the one that registered last speaks", async () => {
    registrations = [
      registration("old-phone", { appVersion: "2.3.0", lastSeenAt: new Date("2026-10-01T07:00:00.000Z") }),
      registration("new-phone", { appVersion: "2.4.1", platform: "ios", lastSeenAt: new Date("2026-10-09T07:00:00.000Z") }),
      registration("older-still", { appVersion: "2.2.0", lastSeenAt: new Date("2026-09-20T07:00:00.000Z") }),
    ]
    expect((await answer()).body.data).toEqual({
      notificationsConnected: true, platform: "ios", appVersion: "2.4.1", registeredAt: "2026-10-09T07:00:00.000Z",
    })
  })

  it("another employee's phone and another organization's are not his", async () => {
    registrations = [
      registration("colleague", { agentId: "agent-2", appVersion: "7.7.7" }),
      registration("elsewhere", { organizationId: "org-2", appVersion: "8.8.8" }),
    ]
    expect((await answer("agent-1")).body.data).toEqual({ notificationsConnected: false, platform: null, appVersion: null, registeredAt: null })
    expect((await answer("agent-2")).body.data).toMatchObject({ notificationsConnected: true, appVersion: "7.7.7" })
  })

  it("drops a version that does not read as one — by the very shape the GPS telemetry accepts — and the rest of the answer stands", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    /** Does the telemetry's own `safeApkVersion` let this through? */
    const telemetryAccepts = (version: string) => {
      info.mockClear()
      recordMtmMobileGpsTelemetry({ organizationId: ORG, endpoint: "location_batch", apkVersion: version, result: "ok", pointCount: 1, durationMs: 1 })
      return (JSON.parse(String(info.mock.calls[0]?.[1])) as { apkVersion: string }).apkVersion === version
    }
    const versions: Array<[string, boolean]> = [
      ["2.4.1", true],
      ["2.4.1+153", true],
      ["10.0.12", true],
      ["2.4", false],
      ["v2.4.1", false],
      ["2.4.1-beta", false],
      ["2.4.1 (153)", false],
      ["12345.0.1", false],
      ["<b>2.4.1</b>", false],
      ["last build from the office", false],
      ["", false],
    ]
    for (const [version, readsAsVersion] of versions) {
      expect(telemetryAccepts(version), `telemetry on «${version}»`).toBe(readsAsVersion)
      registrations = [registration("r1", { appVersion: version })]
      const { body } = await answer()
      expect(body.data, `route on «${version}»`).toEqual({
        notificationsConnected: true,
        platform: "android",
        appVersion: readsAsVersion ? version : null,
        registeredAt: "2026-10-09T05:30:00.000Z",
      })
    }
    // The phone did not say: the line is simply not there.
    registrations = [registration("r1", { appVersion: null })]
    expect((await answer()).body.data).toMatchObject({ notificationsConnected: true, appVersion: null })
  })

  it("names only a platform the registration can have written", async () => {
    registrations = [registration("r1", { platform: "ios" })]
    expect((await answer()).body.data).toMatchObject({ platform: "ios" })
    registrations = [registration("r1", { platform: "Some Phone 14 Pro, serial 0000" })]
    expect((await answer()).body.data).toMatchObject({ notificationsConnected: true, platform: null })
  })

  it("somebody else's employee is answered as one who does not exist, and nothing about him is read", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "mgr-1", role: "MANAGER", scopedAgentIds: ["agent-1"] } as never)
    const refused = await answer("agent-2")
    expect(refused.status).toBe(404)
    expect(refused.body).toEqual({ error: "Agent not found" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmDeviceToken.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmDeviceToken.findMany).not.toHaveBeenCalled()

    // His own employee he does see.
    expect((await answer("agent-1")).status).toBe(200)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "sup-1", role: "SUPERVISOR", scopedAgentIds: ["agent-2"] } as never)
    expect((await answer("agent-1")).status).toBe(404)
    expect((await answer("agent-2")).status).toBe(200)
  })

  it("an employee who is not there — unknown, archived, of another organization — gets the same answer, and no phone is looked up", async () => {
    registrations = [
      registration("left", { agentId: "agent-left" }),
      registration("elsewhere", { agentId: "agent-elsewhere", organizationId: "org-2" }),
    ]
    for (const agentId of ["agent-nobody", "agent-left", "agent-elsewhere"]) {
      const { status, body } = await answer(agentId)
      expect(status, agentId).toBe(404)
      expect(body, agentId).toEqual({ error: "Agent not found" })
    }
    expect(prisma.mtmDeviceToken.findFirst).not.toHaveBeenCalled()
  })

  it("asks whose phone: without an employee it reads nothing", async () => {
    expect((await answer(null)).status).toBe(400)
    expect((await answer("   ")).status).toBe(400)
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmDeviceToken.findFirst).not.toHaveBeenCalled()
  })

  it("is the managers' screen: a field agent is refused, and so is a web user without an MTM card", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] } as never)
    // Not even his own phone: the live map is not his screen.
    expect((await answer("agent-1")).status).toBe(403)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)
    expect((await answer("agent-1")).status).toBe(403)
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmDeviceToken.findFirst).not.toHaveBeenCalled()
  })

  it("is for signed-in people", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await GET(request())).status).toBe(401)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmDeviceToken.findFirst).not.toHaveBeenCalled()
  })

  it("is asked for once per opened card, not on the map's timer: a card a second at most", async () => {
    let last: Response | null = null
    for (let turn = 0; turn < 60; turn += 1) last = await GET(request())
    expect(last?.status).toBe(200)
    last = await GET(request())
    expect(last?.status).toBe(429)
    expect(last?.headers.get("retry-after")).toBe("60")
    // Refused before anything is read.
    expect(vi.mocked(prisma.mtmDeviceToken.findFirst).mock.calls).toHaveLength(60)
  })

  it("a database that fails is an error, not «notifications are not connected»", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(prisma.mtmDeviceToken.findFirst).mockRejectedValue(new Error("connection lost"))
    const { status, body } = await answer()
    expect(status).toBe(500)
    expect(body.data).toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})
