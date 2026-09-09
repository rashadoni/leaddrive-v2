import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260809120000_voip_insights_module/migration.sql"),
  "utf8",
)

describe("VoIP standalone analytics entitlement migration", () => {
  it("preserves every existing VoIP grant path without overriding an explicit deny", () => {
    expect(migration).toContain(`feats @> '["voip"]'::jsonb`)
    expect(migration).toContain(`org."modules" ->> 'voip' = 'true'`)
    expect(migration).toContain(`'voip' = ANY(org."addons")`)
    expect(migration).toContain(`org."modules" ->> 'voip' <> 'false'`)
  })

  it("backfills both tenant state and the enterprise plan template", () => {
    expect(migration).toContain(`jsonb_set("modules", '{voip}', 'true'::jsonb)`)
    expect(migration).toContain(`array_append("features", 'voip')`)
    expect(migration).toContain(`UPDATE "plan_templates"`)
  })
})
