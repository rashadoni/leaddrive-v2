import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

const migration = readFileSync(path.join(
  process.cwd(),
  "prisma/migrations/20260811150000_zapier_webhook_api_key_provenance/migration.sql",
), "utf8")
const demoSeed = readFileSync(path.join(process.cwd(), "scripts/seed-tenant-demo.mjs"), "utf8")

describe("Zapier webhook provenance migration", () => {
  it("fails closed for every un-attributable legacy webhook, not only zapier.com URLs", () => {
    expect(migration).toMatch(/WHERE\s+"provenance" = 'legacy_unclassified'\s+AND "isActive" = true;/)
    expect(migration).not.toMatch(/hooks\.zapier\.com/i)
  })

  it("keeps old-bundle writes inactive across cutover and rollback", () => {
    expect(migration).toContain("CREATE TRIGGER \"webhooks_enforce_provenance\"")
    expect(migration).toContain("NEW.\"provenance\" = 'legacy_unclassified'")
    expect(migration).toContain("NEW.\"isActive\" := false")
    expect(migration).toContain("NEW.\"provenance\" = 'zapier' AND NEW.\"createdByApiKeyId\" IS NULL")
  })

  it("makes classified provenance immutable except for explicit legacy review", () => {
    expect(migration).toContain("legacy webhook may only be reviewed as generic")
    expect(migration).toContain("webhook provenance is immutable")
    expect(migration).toContain("webhook creator provenance is immutable")
  })

  it("binds new subscriptions to API-key lifecycle with a cascading FK", () => {
    expect(migration).toContain('FOREIGN KEY ("createdByApiKeyId") REFERENCES "api_keys"("id")')
    expect(migration).toContain("ON DELETE CASCADE")
  })

  it("classifies every demo webhook explicitly instead of relying on the quarantine default", () => {
    const demoWebhookDefinitions = demoSeed.match(
      /const webhooks = \[([\s\S]*?)\n\s*\]/,
    )?.[1] ?? ""
    const demoWebhookSection = demoSeed.match(
      /const webhooks = \[([\s\S]*?)console\.log\(`Webhooks:[\s\S]*?\n\s*}/,
    )?.[0] ?? ""

    expect(demoWebhookDefinitions.match(/url:/g)).toHaveLength(4)
    expect(demoWebhookSection).toContain("for (const webhook of webhooks)")
    // Both the create and existing-row update paths force demo endpoints into
    // the same fail-closed state; classification no longer lives on each
    // redacted fixture object.
    expect(demoWebhookSection.match(/provenance: "generic"/g)).toHaveLength(2)
    expect(demoWebhookSection.match(/isActive: false/g)).toHaveLength(2)
    expect(demoWebhookSection.match(/randomBytes\(32\)/g)).toHaveLength(2)
  })
})
