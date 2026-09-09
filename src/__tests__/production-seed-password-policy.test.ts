import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

const productionSeeds = [
  read("scripts/seeds/brandprotection.mjs"),
  read("scripts/seeds/afigroup.mjs"),
  read("scripts/seeds/mars.mjs"),
]
const tenantDemoSeed = read("scripts/seed-tenant-demo.mjs")
const brandWorkflow = read(".github/workflows/seed-brandprotection.yml")
const tenantAdminRoute = read("src/app/api/v1/admin/tenants/route.ts")

describe("production seed password safety", () => {
  it("requires an exact production confirmation and the shared password policy", () => {
    for (const seed of productionSeeds) {
      expect(seed).toContain('process.env.CONFIRM_PROD !== "1"')
      expect(seed).toContain("passwordPolicyError")
      expect(seed).toContain("process.env.SEED_PASSWORD ?? getArg(\"password\")")
    }

    expect(tenantDemoSeed).toContain('const REQUIRED_CONFIRMATION = "tenant-demo-seed-v1"')
    expect(tenantDemoSeed).toContain("process.env.CONFIRM_PROD !== REQUIRED_CONFIRMATION")
    expect(tenantDemoSeed).toContain("passwordPolicyError")
  })

  it("contains no known seed password or plaintext password log", () => {
    for (const seed of [...productionSeeds, tenantDemoSeed]) {
      expect(seed).not.toMatch(/Demo2026!|Demo1234!|Secret123!/u)
      expect(seed).not.toContain("${password}")
      expect(seed).not.toContain("${SEED_PASSWORD}")
    }
  })

  it("invalidates CRM sessions whenever a seed resets a CRM password", () => {
    expect(productionSeeds[0]).toContain("passwordChangedAt: new Date()")
    expect(productionSeeds[1]).toContain("passwordChangedAt: new Date()")
    expect(productionSeeds[2].match(/passwordChangedAt: new Date\(\)/gu)?.length).toBeGreaterThanOrEqual(2)
    expect(tenantDemoSeed).toContain("passwordChangedAt: new Date()")
  })

  it("generates and validates the Brand credential on the server without a password argument", () => {
    expect(brandWorkflow).toContain("scripts/password-policy.mjs")
    expect(brandWorkflow).toContain("generateStrongTemporaryPassword(crypto.randomBytes)")
    expect(brandWorkflow).toContain("passwordPolicyError(password)")
    expect(brandWorkflow).toContain('SEED_PASSWORD="$PASSWORD"')
    expect(brandWorkflow).not.toContain('--password="$PASSWORD"')
    expect(brandWorkflow).not.toContain("openssl rand -hex 12")
  })

  it("authorizes tenant demo seeding only through the admin route child environment", () => {
    expect(tenantAdminRoute).toContain('const TENANT_DEMO_SEED_CONFIRMATION = "tenant-demo-seed-v1"')
    expect(tenantAdminRoute).toContain("CONFIRM_PROD: TENANT_DEMO_SEED_CONFIRMATION")
    expect(tenantAdminRoute).toContain("SEED_PASSWORD: result.tempPassword")
    expect(tenantAdminRoute).not.toContain("`--password=${result.tempPassword}`")
  })

  it("does not widen a tenant's module contract while adding demo content", () => {
    expect(tenantDemoSeed).toContain("Features: unchanged (demo content respects the tenant plan)")
    expect(tenantDemoSeed).not.toContain("features: allFeatures")
    expect(tenantDemoSeed).not.toContain("aiDailyBudgetUsd: 10")
  })

  it("can preserve an existing tenant admin password during a repair seed", () => {
    expect(tenantDemoSeed).toContain('process.env.SEED_PRESERVE_EXISTING_ADMIN_PASSWORD === "true"')
    expect(tenantDemoSeed).toContain("password preserved")
  })

  it("seeds only inert webhooks with freshly generated secrets", () => {
    const webhookSection = tenantDemoSeed.slice(
      tenantDemoSeed.indexOf("// ─── 79. Webhook"),
      tenantDemoSeed.indexOf("// ─── 80. CustomDomain"),
    )
    expect(webhookSection).toContain('randomBytes(32).toString("base64url")')
    expect(webhookSection).toContain("isActive: false")
    expect(webhookSection).toContain("prisma.webhook.update")
    expect(webhookSection).toContain("throw new Error")
    expect(webhookSection).not.toContain("isActive: true")
    expect(webhookSection).not.toMatch(/whsec_(?:slack|api|zapier|n8n)_demo_secret/u)
    expect(webhookSection).not.toMatch(/console\.log\([^\n]*(?:whsec_|randomBytes)/iu)
  })
})
