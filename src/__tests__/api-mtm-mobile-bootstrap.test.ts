import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/bootstrap/route"
import { resolveMobileAuth, type MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"
const mobileAuth = (role: string): MobileAuthResult => ({
  orgId: ORG,
  agentId: AGENT,
  userId: "user-1",
  email: "agent@example.test",
  name: "Agent",
  role,
  tenantCapabilities: {
    routeField: true,
    workforceHrm: true,
    attendanceQr: false,
    attendanceDeviceTrust: false,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("AGENT"))
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT,
    name: "Agent",
    email: "agent@example.test",
    role: "AGENT",
    canPlanOwnRoutes: true,
    canSelfPublishRoutes: false,
  } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
    settings: {},
  } as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    name: "Mars",
    slug: "mars",
    plan: "enterprise",
    addons: [],
    features: ["mtm", "workforce-hrm"],
    modules: { mtm: true, "workforce-hrm": true },
  } as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

const request = () => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/bootstrap", {
  headers: { Authorization: "Bearer valid-token" },
})

const v2Request = () => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/bootstrap", {
  headers: { Authorization: "Bearer valid-token", "x-field-device-id": "device-1" },
})

describe("GET /api/v1/mtm/mobile/bootstrap", () => {
  it("returns tenant, principal, capabilities and explicit unversioned state", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toMatchObject({
      tenant: { id: ORG, slug: "mars" },
      principal: { id: AGENT, role: "AGENT" },
      schemaVersion: 1,
      permissions: ["ROUTE_SELF_READ", "ROUTE_EXECUTE", "ROUTE_SELF_PLAN", "WORKTIME_SELF_READ", "WORKTIME_SELF_MUTATE"],
      capabilities: ["FIELD_EXECUTE", "FIELD_TRACK"],
      modules: {
        routeField: { enabled: true, scopeVersion: null },
        workforceHrm: { enabled: true, scopeVersion: null },
        workforce: { enabled: true, capabilityId: "workforce-hrm" },
        routes: { enabled: true, capabilityId: "route-field" },
      },
      policies: { canPlanOwnRoutes: true, canSelfPublishRoutes: false, workforce: { enabled: true } },
      routeTargetTypes: expect.arrayContaining([
        expect.objectContaining({ id: "doctors", direction: "DOCTOR" }),
        expect.objectContaining({ id: "pharmacies", direction: "PHARMACY" }),
      ]),
      sync: {
        horizon: "ACTIVE_FIELD_SCOPE",
        scopeVersion: null,
        configVersion: null,
        offlineHorizon: { routeDays: 7, terminalHistoryDays: 0 },
      },
      manifest: {
        version: 1,
        protocol: { min: 1, preferred: 1 },
        tenant: { id: ORG, timezone: "Asia/Baku" },
        principal: { id: AGENT, role: "AGENT" },
        modules: {
          routeField: { enabled: true, scopeVersion: null },
          workforceHrm: { enabled: true, scopeVersion: null },
          commercial: { enabled: false, scopeVersion: null },
        },
        policiesVersion: null,
      },
    })
  })

  it("hands the field app the CARTO basemap key of this build (audit B16)", async () => {
    vi.stubEnv("NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY", " carto-test-key ")
    try {
      const json = await (await GET(request())).json()
      expect(json.data.maps).toEqual({ cartoBasemapsApiKey: "carto-test-key" })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("returns no map key when the build has none", async () => {
    vi.stubEnv("NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY", "")
    try {
      const json = await (await GET(request())).json()
      expect(json.data.maps).toEqual({ cartoBasemapsApiKey: null })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("keeps an older APK on the v1 manifest while recording only a safe census observation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const legacy = new NextRequest("http://localhost:3000/api/v1/mtm/mobile/bootstrap", {
      headers: { Authorization: "Bearer valid-token", "x-field-apk-version": "1.0.0" },
    })

    const response = await GET(legacy)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.manifest.protocol).toEqual({ min: 1, preferred: 1 })
    expect(String(info.mock.calls.find(([prefix]) => prefix === "[mtm-mobile-apk-telemetry]")?.[1] ?? "")).toContain('"apkVersion":"1.0.0"')
  })

  it("adds the split manifest without changing legacy v1 sync fields", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: { routeField: false, workforceHrm: true },
    })
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      name: "Mars",
      slug: "mars",
      plan: "enterprise",
      addons: [],
      features: ["mtm", "workforce-hrm"],
      modules: { mtm: true, "route-field": false, "workforce-hrm": true },
    } as never)

    const json = await (await GET(request())).json()

    expect(json.data.sync).toMatchObject({ horizon: "ACTIVE_FIELD_SCOPE", scopeVersion: null, configVersion: null })
    expect(json.data.manifest.modules).toEqual({
      routeField: { enabled: false, scopeVersion: null },
      workforceHrm: { enabled: true, scopeVersion: null },
      commercial: { enabled: false, scopeVersion: null },
    })
    expect(json.data.manifest.streams).toEqual(["workforce"])
  })

  it("advertises route sync v2 only for an exact enrolled device cohort", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockImplementation(async (args: any) => (
      args.where.stream === "routes"
        ? { updatedAt: new Date("2026-08-28T12:00:00.000Z") } as never
        : null as never
    ))
    vi.mocked(prisma.mtmMobileSyncAgentScope.findUnique).mockResolvedValue({ scopeRevision: 4n } as never)

    const json = await (await GET(v2Request())).json()

    expect(json.data.sync).toMatchObject({ horizon: "ACTIVE_FIELD_SCOPE", scopeVersion: null, configVersion: null })
    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 2 },
      syncV2: { routes: true, routesEpoch: "2026-08-28T12:00:00.000Z:routes:4" },
      media: { uploads: false, uploadsEpoch: null },
      modules: { routeField: { enabled: true, scopeVersion: "routes:4" } },
    })
  })

  it("advertises visits/tasks only for their own exact cohort and never reuses route scope", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockImplementation(async (args: any) => {
      if (args.where.stream === "visits") return { updatedAt: new Date("2026-08-29T09:00:00.000Z") } as never
      if (args.where.stream === "tasks") return { updatedAt: new Date("2026-08-29T09:01:00.000Z") } as never
      return null as never
    })
    vi.mocked(prisma.mtmMobileSyncAgentScope.findUnique).mockImplementation(async (args: any) => ({
      scopeRevision: args.where.organizationId_stream_agentId.stream === "visits" ? 7n : 11n,
    } as never))

    const json = await (await GET(v2Request())).json()

    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 2 },
      syncV2: {
        routes: false,
        routesEpoch: null,
        visits: true,
        visitsEpoch: "2026-08-29T09:00:00.000Z:visits:7",
        tasks: true,
        tasksEpoch: "2026-08-29T09:01:00.000Z:tasks:11",
      },
      modules: { routeField: { enabled: true, scopeVersion: null } },
    })
  })

  it("advertises active-workday v2 only for its exact workforce cohort", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockImplementation(async (args: any) => (
      args.where.stream === "workforce"
        ? { updatedAt: new Date("2026-08-29T10:00:00.000Z") } as never
        : null as never
    ))
    vi.mocked(prisma.mtmMobileSyncAgentScope.findUnique).mockImplementation(async (args: any) => (
      args.where.organizationId_stream_agentId.stream === "workforce"
        ? { scopeRevision: 9n } as never
        : null as never
    ))

    const json = await (await GET(v2Request())).json()

    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 2 },
      syncV2: {
        routes: false,
        visits: false,
        tasks: false,
        workforce: true,
        workforceEpoch: "2026-08-29T10:00:00.000Z:workforce:9",
      },
      modules: { workforceHrm: { enabled: true, scopeVersion: "workforce:9" } },
    })
  })

  it("advertises isolated media only for its own exact server cohort", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockImplementation(async (args: any) => (
      args.where.stream === "media"
        ? { updatedAt: new Date("2026-08-28T13:00:00.000Z") } as never
        : null as never
    ))

    const json = await (await GET(v2Request())).json()

    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 1 },
      syncV2: { routes: false, routesEpoch: null },
      media: { uploads: true, uploadsEpoch: "2026-08-28T13:00:00.000Z:media" },
    })
  })

  it("advertises GPS batching only for its own exact server cohort", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockImplementation(async (args: any) => (
      args.where.stream === "gps"
        ? { updatedAt: new Date("2026-08-28T14:00:00.000Z") } as never
        : null as never
    ))

    const json = await (await GET(v2Request())).json()

    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 2 },
      syncV2: { routes: false, routesEpoch: null },
      gps: { batches: true, batchesEpoch: "2026-08-28T14:00:00.000Z:gps" },
      media: { uploads: false, uploadsEpoch: null },
    })
  })

  it("fails safe to the v1 manifest while an additive v2 table is not deployed yet", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockRejectedValue({ code: "P2021" } as never)

    const response = await GET(v2Request())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.manifest).toMatchObject({
      protocol: { min: 1, preferred: 1 },
      syncV2: { routes: false, routesEpoch: null },
      gps: { batches: false, batchesEpoch: null },
      media: { uploads: false, uploadsEpoch: null },
      modules: { routeField: { enabled: true, scopeVersion: null } },
    })
  })

  it("returns a split HRM-only manifest without route data and retains the workday query", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: { routeField: false, workforceHrm: true },
    })
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true },
      settings: {},
    } as never)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      name: "Mars",
      slug: "mars",
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { mtm: false, "route-field": false, "workforce-hrm": true },
    } as never)

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.modules).toMatchObject({
      routeField: { enabled: false },
      workforceHrm: { enabled: true },
      routes: { enabled: false },
      workforce: { enabled: true },
    })
    expect(json.data.routeTargetTypes).toEqual([])
    expect(json.data.permissions).toEqual(["WORKTIME_SELF_READ", "WORKTIME_SELF_MUTATE"])
    expect(json.data.sync.streams).toBeUndefined()
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledTimes(1)
  })

  it("lets a manager discover self-location sharing without granting field tracking", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("MANAGER"))
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: AGENT,
      name: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
      canPlanOwnRoutes: false,
      canSelfPublishRoutes: false,
    } as never)

    const json = await (await GET(request())).json()
    expect(json.data.capabilities).toEqual(["TEAM_READ", "TEAM_DECIDE", "SELF_LOCATION_SHARE"])
    expect(json.data.capabilities).not.toContain("FIELD_TRACK")
  })

  it("fails closed when the principal or tenant is inactive", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    expect((await GET(request())).status).toBe(403)
  })

  it("reports the photo watermark as off for a tenant that never configured it", async () => {
    // The plaque burns a customer name and GPS into the image itself, so the
    // default must be off — a tenant has to opt in, never inherit it silently.
    const json = await (await GET(request())).json()
    expect(json.data.policies).toMatchObject({
      photoWatermark: false,
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
      workforce: { enabled: true },
    })
  })

  it("reports the photo watermark as on once the tenant enables it", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "photoWatermarkEnabled", value: "true" },
    ] as never)
    const json = await (await GET(request())).json()
    expect(json.data.policies).toMatchObject({
      photoWatermark: true,
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
      workforce: { enabled: true },
    })
  })

  it("advertises enabled attendance add-ons without claiming an enforcement policy", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: {
        routeField: true,
        workforceHrm: true,
        attendanceQr: true,
        attendanceDeviceTrust: true,
      },
    })

    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "attendance-policy-1",
      teamId: null,
      version: 4,
      status: "ACTIVE",
      name: "Attendance policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveTo: null,
      activatedAt: new Date("2020-01-01T00:00:00.000Z"),
      retiredAt: null,
      definition: {
        attendance: {
          enforcementVersion: 1,
          qr: { requiredActions: ["START"] },
          deviceTrust: {
            requiredActions: ["START", "FINISH"],
          },
        },
      },
      definitionHash: "a".repeat(64),
    }] as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules.workforce.attendance).toEqual({
      qrEnabled: true,
      deviceTrustEnabled: true,
      status: "ACTIVE",
      enforcementVersion: 1,
      configVersion: `attendance-policy-1:4:${"a".repeat(64)}`,
      qrRequiredActions: ["START"],
      deviceTrustRequiredActions: ["START", "FINISH"],
      biometricRequiredActions: [],
    })
    expect(json.data.policies.workforce.attendance).toEqual(json.data.modules.workforce.attendance)
  })

  it("fails closed in the manifest when an enabled attendance policy is malformed", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: {
        routeField: true,
        workforceHrm: true,
        attendanceQr: true,
        attendanceDeviceTrust: false,
      },
    })
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "attendance-policy-invalid",
      teamId: null,
      version: 1,
      status: "ACTIVE",
      name: "Malformed attendance policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveTo: null,
      activatedAt: new Date("2020-01-01T00:00:00.000Z"),
      retiredAt: null,
      definition: { attendance: { enforcementVersion: 2 } },
      definitionHash: "b".repeat(64),
    }] as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules.workforce.attendance).toEqual({
      qrEnabled: true,
      deviceTrustEnabled: false,
      status: "INVALID",
      enforcementVersion: null,
      configVersion: `attendance-policy-invalid:1:${"b".repeat(64)}`,
      qrRequiredActions: [],
      deviceTrustRequiredActions: [],
      biometricRequiredActions: [],
    })
  })

  it("fails closed when an active policy requires an attendance add-on the tenant lacks", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: {
        routeField: true,
        workforceHrm: true,
        attendanceQr: false,
        attendanceDeviceTrust: true,
      },
    })
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "attendance-policy-mismatch",
      teamId: null,
      version: 2,
      status: "ACTIVE",
      name: "QR-required attendance policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveTo: null,
      activatedAt: new Date("2020-01-01T00:00:00.000Z"),
      retiredAt: null,
      definition: {
        attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } },
      },
      definitionHash: "c".repeat(64),
    }] as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules.workforce.attendance).toEqual({
      qrEnabled: false,
      deviceTrustEnabled: true,
      status: "INVALID",
      enforcementVersion: null,
      configVersion: `attendance-policy-mismatch:2:${"c".repeat(64)}`,
      qrRequiredActions: [],
      deviceTrustRequiredActions: [],
      biometricRequiredActions: [],
    })
  })

  it("fails closed in the manifest when a published policy remains after both add-ons are disabled", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: {
        routeField: true,
        workforceHrm: true,
        attendanceQr: false,
        attendanceDeviceTrust: false,
      },
    })
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "attendance-policy-disabled",
      teamId: null,
      version: 3,
      status: "ACTIVE",
      name: "QR-required attendance policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveTo: null,
      activatedAt: new Date("2020-01-01T00:00:00.000Z"),
      retiredAt: null,
      definition: {
        attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } },
      },
      definitionHash: "d".repeat(64),
    }] as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules.workforce.attendance).toEqual({
      qrEnabled: false,
      deviceTrustEnabled: false,
      status: "INVALID",
      enforcementVersion: null,
      configVersion: `attendance-policy-disabled:3:${"d".repeat(64)}`,
      qrRequiredActions: [],
      deviceTrustRequiredActions: [],
      biometricRequiredActions: [],
    })
  })

  it("honestly hides self-planning when an administrator disables it for an agent", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: AGENT,
      name: "Agent",
      email: "agent@example.test",
      role: "AGENT",
      canPlanOwnRoutes: false,
      canSelfPublishRoutes: true,
    } as never)

    const json = await (await GET(request())).json()
    expect(json.data.policies.canPlanOwnRoutes).toBe(false)
    expect(json.data.policies.canSelfPublishRoutes).toBe(false)
  })

  it("advertises self-publishing only after both the tenant and manager allow this agent", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: AGENT,
      name: "Agent",
      email: "agent@example.test",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
    } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "routeSelfPublish", value: true },
    ] as never)

    const json = await (await GET(request())).json()

    expect(json.data.policies).toMatchObject({
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
    })
    expect(json.data.permissions).toContain("ROUTE_SELF_PUBLISH")
  })

  it("restores a still-open shift from a previous tenant date", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-yesterday",
      workDate: new Date("2026-08-22T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-08-22T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
    } as never)

    const json = await (await GET(request())).json()

    expect(json.data.workday).toMatchObject({
      id: "workday-yesterday",
      status: "STARTED",
      completedAt: null,
    })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT,
        OR: expect.arrayContaining([
          { status: { in: ["STARTED", "PAUSED"] } },
          expect.objectContaining({ workDate: expect.any(Date) }),
        ]),
      }),
    }))
  })

  it("advertises HRM-only mode without route UI data or route capability", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: { routeField: false, workforceHrm: true },
    })
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      name: "Mars",
      slug: "mars",
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { mtm: false, "workforce-hrm": true },
    } as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules).toMatchObject({
      workforce: { enabled: true },
      routes: { enabled: false },
    })
    expect(json.data.permissions).toEqual(["WORKTIME_SELF_READ", "WORKTIME_SELF_MUTATE"])
    expect(json.data.policies).toMatchObject({ canPlanOwnRoutes: false, workforce: { enabled: true } })
    expect(json.data.routeTargetTypes).toEqual([])
  })

  it("preserves workday bootstrap data for an old MTM-only tenant", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: { routeField: true, workforceHrm: true },
    })
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      name: "Mars",
      slug: "mars",
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true },
    } as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules).toMatchObject({
      workforce: { enabled: true },
      routes: { enabled: true },
    })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns only the agent's field-session workday after an explicit Routes-only split", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...mobileAuth("AGENT"),
      tenantCapabilities: { routeField: true, workforceHrm: false },
    })
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      name: "Mars",
      slug: "mars",
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "route-session-1",
      workDate: new Date("2026-08-30T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-08-30T08:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
    } as never)

    const json = await (await GET(request())).json()

    expect(json.data.modules).toMatchObject({
      workforce: { enabled: false },
      routes: { enabled: true },
    })
    expect(json.data.permissions).toEqual(["ROUTE_SELF_READ", "ROUTE_EXECUTE", "ROUTE_SELF_PLAN"])
    expect(json.data.workday).toMatchObject({ id: "route-session-1", status: "STARTED" })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledTimes(1)
  })
})
