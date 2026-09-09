import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourcePath = new URL("../../scripts/seeds/zeytunpharm-swissmed-evidence.mjs", import.meta.url)
const rlsHelperPath = new URL("../../scripts/_rls.mjs", import.meta.url)

describe("SwissMed evidence seed", () => {
  it("parses as an executable Node.js module", () => {
    expect(() => execFileSync(process.execPath, ["--check", fileURLToPath(sourcePath)]))
      .not.toThrow()
  })

  it("is restricted to explicitly confirmed tenants and exact secret-managed QA principals", async () => {
    const source = await readFile(sourcePath, "utf8")
    expect(source).toContain('confirmation: "leaddrive-swissmed-evidence"')
    expect(source).toContain('confirmation: "zeytunpharm-swissmed-evidence"')
    expect(source).toContain('adminEmail: "qa.swissmed.admin@leaddrivecrm.org"')
    expect(source).toContain('agentEmail: "qa.swissmed.agent@leaddrivecrm.org"')
    expect(source).toContain("Object.hasOwn(ALLOWED_TENANTS, organizationSlug)")
    expect(source).toContain("process.env.CONFIRM_PROD !== target.confirmation")
    expect(source).toContain("adminEmail !== target.adminEmail || agentEmail !== target.agentEmail")
    expect(source).toContain("passwordPolicyError(password)")
    expect(source).toContain("[...password].length < 24")
  })

  it("does not create, update or delete the tenant and keeps fixture writes explicitly scoped", async () => {
    const [source, rlsHelper] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(rlsHelperPath, "utf8"),
    ])
    expect(source).toContain('const QA_MARKER = "[QA-SWISSMED]"')
    expect(source).toContain("prisma.organization.findUnique")
    expect(source).not.toContain("prisma.organization.create")
    expect(source).not.toContain("prisma.organization.update")
    expect(source).not.toContain("deleteMany")
    expect(source).toContain('sourceKey: "qa-swissmed:swm-09:fixture-ready"')
    expect(source).toContain('eventType: "EXECUTION_SUBMITTED"')
    expect(source).not.toContain('eventType: "QA_ACCEPTANCE_FIXTURE_READY"')
    expect(source).toContain('description: "Enabled for the explicitly confirmed SwissMed SWM-09 acceptance workflow"')
    expect(rlsHelper).toContain("set_config('app.rls_bypass', 'on', false)")
  })

  it("provides web principals and resources for detail, route, task, promotion and map evidence", async () => {
    const source = await readFile(sourcePath, "utf8")
    expect(source).toContain("prisma.user.upsert")
    expect(source).toContain("const passwordChangedAt = new Date()")
    expect(source.match(/passwordChangedAt/g)?.length).toBeGreaterThanOrEqual(5)
    expect(source).toContain("userId: adminUser.id")
    expect(source).toContain("userId: agentUser.id")
    expect(source).toContain("prisma.mtmContact.upsert")
    expect(source).toContain("prisma.mtmRoute.upsert")
    expect(source).toContain("prisma.mtmVisit")
    expect(source).toContain("prisma.mtmTask")
    expect(source).toContain("prisma.mtmPharmacyPromotionExecution.upsert")
    expect(source).toContain('status: "DRAFT", l1State: "NOT_READY", l2State: "NOT_READY", version: 1')
    expect(source).toContain('if (execution.status === "DRAFT")')
    expect(source).toContain("prisma.mtmPharmacyPromotionExecution.update")
    expect(source).toContain("where: { organizationId_id: { organizationId: organization.id, id: execution.id } }")
    expect(source).toContain('status: "READY", l1State: "READY", l2State: "NOT_READY", version: execution.version + 1')
    expect(source).toContain('clientExecutionId: "QA-SWM-EXECUTION-REVIEW-01"')
    expect(source).toContain('code: "QA-SWM-PROMO"')
    expect(source).toContain("eligibilityDefinitionHash")
    expect(source).toContain('promotionTarget.status !== "CONNECTED"')
    expect(source).toContain('promotionTarget.eligibilityStatus !== "ELIGIBLE"')
    expect(source).toContain('key: "pharmacyPromotionPostingEnabled"')
    expect(source).toContain("value: true")
    expect(source).toContain("prisma.mtmAgentLocation.upsert")
    expect(source).toContain('const TENANT_TIME_ZONE = "Asia/Baku"')
    expect(source).toContain("tenantCalendarDate(new Date())")
    expect(source).toContain("historyDate.setUTCDate(historyDate.getUTCDate() - 1)")
    expect(source).toContain("recordedAt: at(historyDate, 9, 0)")
    expect(source).toContain('id: "QA-SWM-LIVE-01"')
    expect(source).toContain("recordedAt: new Date()")
  })
})
