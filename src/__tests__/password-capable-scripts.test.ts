import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const paths = {
  importV1: new URL("../../scripts/import-v1.ts", import.meta.url),
  seedDemo: new URL("../../scripts/seed-demo.mjs", import.meta.url),
  advisorSeed: new URL("../../scripts/seeds/advisor-demo.mjs", import.meta.url),
  advisorReadiness: new URL("../../scripts/check-advisor-qa-readiness.mjs", import.meta.url),
  pilotSeed: new URL("../../scripts/mtm-routes-phase1-pilot-seed.mjs", import.meta.url),
  evidenceSeed: new URL("../../scripts/seeds/zeytunpharm-swissmed-evidence.mjs", import.meta.url),
  kanbanSeed: new URL("../../prisma/seed/kanban-demo.ts", import.meta.url),
}

async function sources() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
    ),
  ) as Record<keyof typeof paths, string>
}

describe("password-capable import and demo scripts", () => {
  it("uses the shared password policy without known fallback credentials", async () => {
    const source = await sources()
    for (const [name, content] of Object.entries(source)) {
      expect(content, `${name} should use the shared policy`).toContain("passwordPolicyError")
    }

    const combined = Object.values(source).join("\n")
    for (const knownCredential of [
      "changeme123",
      'ADMIN_PASSWORD || "changeme"',
      "Demo1234!",
      "demo1234",
      "AdvisorDemo2026!",
      "DEFAULT_DEMO_PASSWORD",
    ]) {
      expect(combined, `known credential remains: ${knownCredential}`).not.toContain(knownCredential)
    }
  })

  it("quarantines imported legacy credentials and provisions only the explicit admin", async () => {
    const source = await readFile(paths.importV1, "utf8")
    expect(source).toContain('const REQUIRED_PROD_CONFIRMATION = "import-v1:leaddrive"')
    expect(source).toContain("generateStrongTemporaryPassword(randomBytes)")
    expect(source).toContain("update: disabledCredentialData")
    expect(source).toContain("isActive: false")
    expect(source).toContain("passwordChangedAt: new Date()")
    expect(source).toContain("ADMIN_PASSWORD rejected")
    expect(source).not.toContain("u.password_hash")
    expect(source).not.toContain("u.totp_secret")
    expect(source).not.toContain("passwords preserved")
  })

  it("guards demo writes and never logs a generated or supplied password", async () => {
    const source = await sources()
    expect(source.seedDemo).toContain("CONFIRM_PROD !== requiredConfirmation")
    expect(source.seedDemo).toContain("passwordChangedAt: new Date()")
    expect(source.advisorSeed).toContain("CONFIRM_PROD !== requiredConfirmation")
    expect(source.advisorSeed).toContain("process.env.ADVISOR_DEMO_PASSWORD")
    expect(source.advisorSeed).toContain("passwordChangedAt: new Date()")
    expect(source.advisorSeed).not.toMatch(/console\.log\([^\n]*advisorPassword/i)
    expect(source.kanbanSeed).toContain("restricted to a non-production local database")
    expect(source.kanbanSeed).toContain("process.env.ADMIN_PASSWORD")
    expect(source.kanbanSeed).toContain("passwordChangedAt")
  })

  it("keeps production fixtures confirmed and invalidates CRM sessions on credential rotation", async () => {
    const source = await sources()
    expect(source.pilotSeed).toContain('const REQUIRED_CONFIRMATION = "zeytun-phase1-closeout"')
    expect(source.pilotSeed).toContain("passwordPolicyError(pilotPassword)")
    expect(source.evidenceSeed).toContain('confirmation: "leaddrive-swissmed-evidence"')
    expect(source.evidenceSeed).toContain('confirmation: "zeytunpharm-swissmed-evidence"')
    expect(source.evidenceSeed).toContain("process.env.CONFIRM_PROD !== target.confirmation")
    expect(source.evidenceSeed).toContain("passwordPolicyError(password)")
    expect(source.evidenceSeed.match(/passwordChangedAt/g)?.length).toBeGreaterThanOrEqual(5)
    expect(source.advisorReadiness).not.toContain("DEFAULT_DEMO_PASSWORD")
    expect(source.advisorReadiness).toContain("passwordPolicyError(password)")
  })
})
