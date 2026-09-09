import { describe, expect, it } from "vitest"
import {
  buildMtmMobileCapabilityManifest,
  mtmMobileModuleForSyncEntity,
  resolveMtmMobileTenantModules,
} from "@/lib/mtm/mobile-capability-manifest"

const baseOrganization = {
  id: "org-1",
  plan: "enterprise",
  addons: [],
  features: ["mtm"],
  modules: { mtm: true },
}

function manifest(modules: Record<string, boolean>, role = "AGENT") {
  return buildMtmMobileCapabilityManifest({
    organization: { ...baseOrganization, modules },
    auth: { agentId: "agent-1", role } as never,
    timezone: "Asia/Baku",
    now: new Date("2026-08-28T12:00:00.000Z"),
  })
}

describe("MTM mobile capability manifest", () => {
  it("keeps legacy MTM tenants compatible until a split key is explicitly set", () => {
    expect(resolveMtmMobileTenantModules(baseOrganization)).toEqual({
      routeField: true,
      workforceHrm: true,
      commercial: false,
    })
  })

  it.each([
    [true, true, ["routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications", "workforce"]],
    [true, false, ["routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications"]],
    [false, true, ["workforce"]],
    [false, false, []],
  ])("emits the four tenant module modes (%s route, %s workforce)", (routeField, workforceHrm, streams) => {
    const value = manifest({ mtm: true, "route-field": routeField, "workforce-hrm": workforceHrm })

    expect(value.protocol).toEqual({ min: 1, preferred: 1 })
    expect(value.modules).toEqual({
      routeField: { enabled: routeField, scopeVersion: null },
      workforceHrm: { enabled: workforceHrm, scopeVersion: null },
      commercial: { enabled: false, scopeVersion: null },
    })
    expect(value.streams).toEqual(streams)
    expect(value.policiesVersion).toBeNull()
    expect(value.gps).toEqual({ batches: false, batchesEpoch: null })
    expect(value.media).toEqual({ uploads: false, uploadsEpoch: null })
    expect(value.serverTime).toBe("2026-08-28T12:00:00.000Z")
  })

  it("lets explicit split denials override the legacy parent entitlement", () => {
    expect(resolveMtmMobileTenantModules({
      ...baseOrganization,
      modules: { mtm: true, "route-field": false, "workforce-hrm": false },
    })).toMatchObject({ routeField: false, workforceHrm: false })
  })

  it("does not require the legacy MTM module for a newly provisioned routes-only tenant", () => {
    expect(resolveMtmMobileTenantModules({
      ...baseOrganization,
      features: [],
      modules: { mtm: false, "route-field": true, "workforce-hrm": false },
    })).toEqual({
      routeField: true,
      workforceHrm: false,
      commercial: false,
    })
  })

  it("advertises the granular route and workforce permissions available to a manager", () => {
    const value = manifest({ mtm: true }, "MANAGER")

    expect(value.modules).toEqual({
      routeField: { enabled: true, scopeVersion: null },
      workforceHrm: { enabled: true, scopeVersion: null },
      commercial: { enabled: false, scopeVersion: null },
    })
    expect(value.streams).toEqual(["routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications", "workforce"])
  })

  it("uses the authenticated entitlement snapshot over a stale Organization read", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: {
        agentId: "agent-1",
        role: "AGENT",
        tenantCapabilities: { routeField: false, workforceHrm: true },
      } as never,
      timezone: "Asia/Baku",
      now: new Date("2026-08-28T12:00:00.000Z"),
    })

    expect(value.modules).toEqual({
      routeField: { enabled: false, scopeVersion: null },
      workforceHrm: { enabled: true, scopeVersion: null },
      commercial: { enabled: false, scopeVersion: null },
    })
    expect(value.streams).toEqual(["workforce"])
  })

  it("prefers v2 only after the server enrolls the exact route-pilot cohort", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      routeSyncV2Pilot: { enrolled: true, scopeRevision: 12n, cohortEpoch: "2026-08-28T12:00:00.000Z" },
      now: new Date("2026-08-28T12:00:00.000Z"),
    })

    expect(value.protocol).toEqual({ min: 1, preferred: 2 })
    expect(value.syncV2).toEqual({
      routes: true,
      routesEpoch: "2026-08-28T12:00:00.000Z:routes:12",
      visits: false,
      visitsEpoch: null,
      tasks: false,
      tasksEpoch: null,
      workforce: false,
      workforceEpoch: null,
    })
    expect(value.gps).toEqual({ batches: false, batchesEpoch: null })
    expect(value.media).toEqual({ uploads: false, uploadsEpoch: null })
    expect(value.modules.routeField.scopeVersion).toBe("routes:12")
  })

  it("advertises media isolation from a separate cohort without upgrading route pull", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      mediaUploadPilot: { enrolled: true, cohortEpoch: "2026-08-28T13:00:00.000Z" },
      now: new Date("2026-08-28T12:00:00.000Z"),
    })

    expect(value.protocol).toEqual({ min: 1, preferred: 1 })
    expect(value.media).toEqual({ uploads: true, uploadsEpoch: "2026-08-28T13:00:00.000Z:media" })
  })

  it("advertises GPS batching from its own cohort and prefers v2 without enabling route pull", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      gpsBatchPilot: { enrolled: true, cohortEpoch: "2026-08-28T14:00:00.000Z" },
      now: new Date("2026-08-28T12:00:00.000Z"),
    })

    expect(value.protocol).toEqual({ min: 1, preferred: 2 })
    expect(value.syncV2).toEqual({
      routes: false,
      routesEpoch: null,
      visits: false,
      visitsEpoch: null,
      tasks: false,
      tasksEpoch: null,
      workforce: false,
      workforceEpoch: null,
    })
    expect(value.gps).toEqual({ batches: true, batchesEpoch: "2026-08-28T14:00:00.000Z:gps" })
  })

  it("keeps the cohort epoch stable across bootstrap time but changes it for a real cohort revision", () => {
    const common = {
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      routeSyncV2Pilot: {
        enrolled: true,
        scopeRevision: 12n,
        cohortEpoch: "2026-08-28T12:00:00.000Z",
      },
    }
    const first = buildMtmMobileCapabilityManifest({ ...common, now: new Date("2026-08-28T12:01:00.000Z") })
    const laterBootstrap = buildMtmMobileCapabilityManifest({ ...common, now: new Date("2026-08-28T14:01:00.000Z") })
    const reenrolled = buildMtmMobileCapabilityManifest({
      ...common,
      routeSyncV2Pilot: { ...common.routeSyncV2Pilot, cohortEpoch: "2026-08-29T12:00:00.000Z" },
    })

    expect(laterBootstrap.syncV2.routesEpoch).toBe(first.syncV2.routesEpoch)
    expect(reenrolled.syncV2.routesEpoch).not.toBe(first.syncV2.routesEpoch)
  })

  it("advertises visits/tasks only for their own exact cohort and scope revision", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      visitSyncV2Pilot: { enrolled: true, scopeRevision: 7n, cohortEpoch: "2026-08-29T09:00:00.000Z" },
      taskSyncV2Pilot: { enrolled: true, scopeRevision: 11n, cohortEpoch: "2026-08-29T09:01:00.000Z" },
      now: new Date("2026-08-29T10:00:00.000Z"),
    })

    expect(value.protocol).toEqual({ min: 1, preferred: 2 })
    expect(value.syncV2).toEqual({
      routes: false,
      routesEpoch: null,
      visits: true,
      visitsEpoch: "2026-08-29T09:00:00.000Z:visits:7",
      tasks: true,
      tasksEpoch: "2026-08-29T09:01:00.000Z:tasks:11",
      workforce: false,
      workforceEpoch: null,
    })
    // Route scope is not repurposed as a cross-stream authority.
    expect(value.modules.routeField.scopeVersion).toBeNull()
  })

  it("advertises active-workday sync only for its workforce cohort and scope", () => {
    const value = buildMtmMobileCapabilityManifest({
      organization: baseOrganization,
      auth: { agentId: "agent-1", role: "AGENT" } as never,
      timezone: "Asia/Baku",
      workforceSyncV2Pilot: { enrolled: true, scopeRevision: 9n, cohortEpoch: "2026-08-29T10:00:00.000Z" },
      now: new Date("2026-08-29T10:01:00.000Z"),
    })

    expect(value.protocol).toEqual({ min: 1, preferred: 2 })
    expect(value.syncV2).toEqual({
      routes: false,
      routesEpoch: null,
      visits: false,
      visitsEpoch: null,
      tasks: false,
      tasksEpoch: null,
      workforce: true,
      workforceEpoch: "2026-08-29T10:00:00.000Z:workforce:9",
    })
    expect(value.modules.workforceHrm.scopeVersion).toBe("workforce:9")
    expect(value.modules.routeField.scopeVersion).toBeNull()
  })

  it("has a deliberate v1 ownership map for every currently batched business mutation", () => {
    expect(mtmMobileModuleForSyncEntity("visits")).toBe("routeField")
    expect(mtmMobileModuleForSyncEntity("messages")).toBe("routeField")
    expect(mtmMobileModuleForSyncEntity("documentStates")).toBe("routeField")
    expect(mtmMobileModuleForSyncEntity("workdays")).toBe("workforceHrm")
    expect(mtmMobileModuleForSyncEntity("hrmRequests")).toBe("workforceHrm")
    // GPS/media do not enter the v1 business-sync envelope and remain on their
    // dedicated existing boundaries until their owner policies are approved.
    expect(mtmMobileModuleForSyncEntity("locations")).toBeNull()
    expect(mtmMobileModuleForSyncEntity("unknown")).toBeNull()
  })
})
