import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const readProjectFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

/**
 * H0 compatibility baseline.  These checks deliberately lock the physical
 * MTM tables and legacy adapter paths before Workforce gains additive models.
 * A later change may add a new surface, but it must not silently remove the
 * state machine or transport used by a currently supported APK.
 */
describe("Workforce legacy compatibility contract", () => {
  it("keeps the canonical tenant-scoped work-time and request tables", () => {
    const schema = readProjectFile("prisma/schema.prisma")

    expect(schema).toMatch(/model MtmAgentWorkday \{[\s\S]*?organizationId\s+String[\s\S]*?@@unique\(\[organizationId, agentId, workDate\]\)/)
    expect(schema).toMatch(/model MtmAgentWorkdayEvent \{[\s\S]*?organizationId\s+String[\s\S]*?@@unique\(\[organizationId, agentId, clientEventId\]\)/)
    expect(schema).toMatch(/model MtmHrmRequest \{[\s\S]*?organizationId\s+String[\s\S]*?@@unique\(\[organizationId, agentId, clientRequestId\]\)/)
    expect(schema).toMatch(/model MtmWorkCalendarDay \{[\s\S]*?organizationId\s+String[\s\S]*?@@index\(\[organizationId, date, deletedAt\]\)/)
  })

  it("retains mobile adapter paths around the authoritative workday state machine", () => {
    const workday = readProjectFile("src/app/api/v1/mtm/mobile/workday/route.ts")
    const hrm = readProjectFile("src/app/api/v1/mtm/mobile/hrm/route.ts")
    const syncPush = readProjectFile("src/app/api/v1/mtm/mobile/sync/push/route.ts")
    const stateMachine = readProjectFile("src/lib/mtm/workday.ts")

    expect(workday).toContain("withMobileRls")
    expect(hrm).toContain("withMobileRls")
    expect(syncPush).toContain("withMobileRls")
    expect(syncPush).toContain("applyMtmWorkdayEvent")
    expect(stateMachine).toContain("clientEventId")
    expect(stateMachine).toContain("mtmWorkdayReplayMatches")
  })

  it("keeps the legacy web decision endpoint as a compatibility adapter", () => {
    const decisionRoute = readProjectFile("src/app/api/v1/mtm/operations/hrm/[id]/decision/route.ts")

    expect(decisionRoute).toContain("export const POST")
    expect(decisionRoute).toContain("withWorkforceCompatAuth")
    expect(decisionRoute).toContain("decideWorkforceRequest")
    expect(decisionRoute).toContain("MTM_HRM_ROUTE_CONFLICT")
  })
})
