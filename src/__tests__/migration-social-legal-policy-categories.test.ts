import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(
    "prisma/migrations/20260730010000_expand_social_legal_review_categories/migration.sql",
  ),
  "utf8",
)

describe("social legal policy category migration", () => {
  it("expands the default without overwriting customized tenant policies", () => {
    expect(migration).toContain(
      `SET DEFAULT ARRAY[
    'insult',
    'defamation',
    'false_accusation',
    'threat',
    'complaint',
    'reputation_risk'
  ]::TEXT[]`,
    )
    expect(migration).toContain(
      `WHERE "allowedCategories" = ARRAY[
  'insult',
  'defamation',
  'false_accusation',
  'threat'
]::TEXT[]`,
    )
    expect(migration).not.toContain(`FROM unnest(`)
  })
})
