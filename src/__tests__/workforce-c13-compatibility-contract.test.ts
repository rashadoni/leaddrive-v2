import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
  WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { WORKFORCE_EVIDENCE_ENVELOPE_VERSION } from "@/lib/workforce/evidence-envelope"
import { buildMtmMobileCapabilityManifest } from "@/lib/mtm/mobile-capability-manifest"
import {
  WORKFORCE_MOBILE_BOOTSTRAP_SCHEMA_VERSION,
  WORKFORCE_MOBILE_SCHEMA_SUPPORT,
  WORKFORCE_SITE_TRANSITION_CLAIM_SCHEMA_VERSION,
  WORKFORCE_WORKDAY_RESPONSE_SCHEMA_VERSION,
} from "@/lib/workforce/mobile-schema-support"

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), "utf8")

describe("Workforce C13 additive compatibility contract", () => {
  it("keeps every Workforce migration free of destructive schema/data rewrites", () => {
    const migrationRoot = join(root, "prisma/migrations")
    const migrations = readdirSync(migrationRoot)
      .filter((name) => name.includes("workforce"))
      .sort()

    expect(migrations.length).toBeGreaterThanOrEqual(35)
    for (const migration of migrations) {
      const sql = readFileSync(join(migrationRoot, migration, "migration.sql"), "utf8")
      expect(sql, migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i)
      expect(sql, migration).not.toMatch(/\bRENAME\s+(?:TABLE|COLUMN)\b/i)
      expect(sql, migration).not.toMatch(/\bTRUNCATE\b/i)
      expect(sql, migration).not.toMatch(/\bDELETE\s+FROM\b/i)
      expect(sql, migration).not.toMatch(/^\s*UPDATE\s+/im)
    }
  })

  it("routes both supported workday transports through one canonical state machine", () => {
    const direct = source("src/app/api/v1/mtm/week/workday/route.ts")
    const offline = source("src/app/api/v1/mtm/mobile/sync/push/route.ts")

    for (const adapter of [direct, offline]) {
      expect(adapter).toMatch(/applyMtmWorkdayEvent[\s\S]*from "@\/lib\/mtm\/workday"/)
      expect(adapter).toContain("await applyMtmWorkdayEvent(")
    }
  })

  it("pins current/legacy schemas and refuses to fabricate historical assurance", () => {
    expect(WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION).toBe(1)
    expect(WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION).toBe(5)
    expect(WORKFORCE_EVIDENCE_ENVELOPE_VERSION).toBe(1)
    expect(source("prisma/schema.prisma")).toMatch(
      /attendanceReviewState\s+WorkforceAttendanceClaimReviewState\s+@default\(LEGACY_UNKNOWN\)/,
    )
    expect(source("prisma/migrations/20260830140000_workforce_c1_workday_schema_v3/migration.sql"))
      .toContain("Do not backfill requestHash, provenance, review state, or segment identity")
    expect(source("src/lib/workforce/timesheet-approval-service.ts"))
      .toContain("WORKFORCE_TIMESHEET_APPROVAL_SNAPSHOT_MISSING")
  })

  it("advertises only the exact deployed Workforce wire schemas", () => {
    expect(WORKFORCE_MOBILE_BOOTSTRAP_SCHEMA_VERSION).toBe(1)
    expect(WORKFORCE_WORKDAY_RESPONSE_SCHEMA_VERSION).toBe(1)
    expect(WORKFORCE_SITE_TRANSITION_CLAIM_SCHEMA_VERSION).toBe(1)
    expect(WORKFORCE_MOBILE_SCHEMA_SUPPORT).toEqual({
      bootstrapResponse: { current: 1, supported: [1] },
      workdayRequest: { preferred: 5, supported: [1, 2, 3, 4, 5] },
      workdayResponse: { current: 1, supported: [1] },
      evidenceEnvelope: { preferred: 1, supported: [1] },
      siteTransitionRequest: { preferred: 1, supported: [1] },
    })
  })

  it.each([
    [false, false, []],
    [false, true, ["workforce"]],
    [true, false, ["routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications"]],
    [true, true, ["routes", "routePoints", "visits", "customers", "contacts", "tasks", "notifications", "workforce"]],
  ])("preserves the route=%s workforce=%s server mode", (routeField, workforceHrm, streams) => {
    const manifest = buildMtmMobileCapabilityManifest({
      organization: {
        id: "org-compatibility",
        plan: "enterprise",
        addons: [],
        features: [],
        modules: { "route-field": routeField, "workforce-hrm": workforceHrm },
      },
      auth: {
        agentId: "agent-compatibility",
        role: "AGENT",
        tenantCapabilities: { routeField, workforceHrm },
      } as never,
      timezone: "Asia/Baku",
      now: new Date("2026-09-13T05:00:00.000Z"),
    })

    expect(manifest.modules.routeField.enabled).toBe(routeField)
    expect(manifest.modules.workforceHrm.enabled).toBe(workforceHrm)
    expect(manifest.streams).toEqual(streams)
    expect(manifest.protocol).toEqual({ min: 1, preferred: 1 })
  })
})
