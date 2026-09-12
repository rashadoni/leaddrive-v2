import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const seed = readFileSync("scripts/seed-support-ux-evidence.ts", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")

describe("Support UX evidence seed safety contract", () => {
  it("refuses production, non-CI and non-local databases", () => {
    expect(seed).toContain('process.env.CI !== "true"')
    expect(seed).toContain('process.env.NODE_ENV === "production"')
    expect(seed).toContain("LOCAL_DATABASE_HOSTS")
    expect(seed).toContain("Support evidence seed refuses non-local database host")
    expect(seed).toContain("ephemeral-support-ux-v1")
    expect(seed).toContain("support_ux_evidence")
  })

  it("uses generated credentials without committing or logging them", () => {
    for (const name of [
      "SUPPORT_EVIDENCE_AGENT_PASSWORD",
      "SUPPORT_EVIDENCE_MANAGER_PASSWORD",
      "SUPPORT_EVIDENCE_ADMIN_PASSWORD",
      "SUPPORT_EVIDENCE_PORTAL_PASSWORD",
    ]) {
      expect(seed).toContain(`requiredEnv("${name}")`)
      expect(workflow).toContain(name)
    }
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_AGENT_PASSWORD")
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_MANAGER_PASSWORD")
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_ADMIN_PASSWORD")
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_PORTAL_PASSWORD")
    expect(workflow).toContain('tenant_pii_key="$(openssl rand -hex 32)"')
    expect(workflow).toContain("::add-mask::")
    expect(seed).not.toMatch(/password:\s*["'][^"']+["']/)
    expect(seed).not.toContain("console.log")
  })

  it("creates only clearly synthetic tenant, role and Support fixtures", () => {
    expect(seed).toContain('const DEMO_ORGANIZATION = "Northstar Support Lab"')
    expect(seed).toContain('const DEMO_SLUG = "support-evidence"')
    expect(seed).toContain("@support-evidence.invalid")
    expect(seed).toContain('"analytics", "voip", "ai", "complaints_register"')
    expect(seed).toContain("analytics: true")
    expect(seed).not.toContain("reports: true")
    for (const model of [
      "organization", "user", "contact", "ticketQueue", "ticketCategory",
      "slaPolicy", "ticket", "complaintMeta", "ticketComment", "kbArticle",
      "callLog", "entitlement", "entitlementMilestoneTemplate",
      "ticketClosureRequest",
    ]) {
      expect(seed).toContain(`prisma.${model}.`)
    }
    expect(seed).toContain("index % 5 === 0 ? null")
  })

  it("keeps the fixture manifest private and removes it before artifact upload", () => {
    expect(seed).toContain("SUPPORT_EVIDENCE_FIXTURE_MANIFEST")
    expect(seed).toContain("{ mode: 0o600 }")
    expect(workflow).toContain('rm -f "$SUPPORT_EVIDENCE_FIXTURE_MANIFEST"')
    expect(workflow.indexOf('rm -f "$SUPPORT_EVIDENCE_FIXTURE_MANIFEST"')).toBeLessThan(
      workflow.indexOf("Upload non-secret evidence"),
    )
  })

  it("supports a genuine empty ticket profile for section-scoped list evidence", () => {
    expect(seed).toContain("if (count === 0)")
    expect(seed).toContain("fixtures: {}")
    expect(workflow).toContain(".fixtures.ticketId // empty")
    expect(workflow).toContain(".fixtures.complaintId // empty")
    expect(workflow).toContain(".fixtures.portalTicketId // empty")
    expect(workflow).toContain(".fixtures.kbArticleId // empty")
    expect(workflow).toContain(".fixtures.ticketCategoryId // empty")
    expect(workflow).toContain(".fixtures.slaPolicyId // empty")
    expect(workflow).toContain(".fixtures.entitlementId // empty")
  })
})
