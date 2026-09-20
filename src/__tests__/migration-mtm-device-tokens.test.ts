import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync("prisma/migrations/20260920190000_mtm_device_tokens/migration.sql", "utf8")
const schema = readFileSync("prisma/schema.prisma", "utf8")

describe("MTM device token migration", () => {
  it("is tenant-isolated on the setting the application actually sets", () => {
    expect(migration).toContain('ALTER TABLE "mtm_device_tokens" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_device_tokens" FORCE ROW LEVEL SECURITY')
    expect(migration.match(/current_setting\('app\.org_id', true\)/g)).toHaveLength(2)
    expect(migration).not.toContain("app.current_organization_id")
  })

  it("keeps one row per token and cascades with its tenant and agent", () => {
    expect(migration).toContain('UNIQUE ("organizationId", "token")')
    expect(migration).toContain('FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE')
    expect(schema).toContain("model MtmDeviceToken")
  })

  it("can retire a token without losing the row", () => {
    expect(migration).toContain('"disabledAt" TIMESTAMP(3)')
    expect(migration).toContain('"mtm_device_tokens_org_agent_active_idx"')
  })
})
