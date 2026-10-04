import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir } from "node:fs/promises"

assert.equal(process.env.GITHUB_ACTIONS, "true")
assert.equal(process.env.CI, "true")
assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1")
const directory = "artifacts/workforce-policy-restore"
await mkdir(directory, { recursive: true })
const foundationPath = "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql"
const lifecyclePath = "prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql"
const foundation = await readFile(foundationPath, "utf8"), lifecycle = await readFile(lifecyclePath, "utf8")
function exactBlock(text, marker, end) {
  const start = text.indexOf(marker)
  assert.ok(start >= 0 && text.indexOf(marker, start + marker.length) === -1, "Canonical SQL block must be unique")
  const stop = text.indexOf(end, start)
  assert.ok(stop > start, "Canonical SQL terminator required")
  return text.slice(start, stop + end.length)
}
const sql = ["BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';",
  exactBlock(foundation, "CREATE OR REPLACE FUNCTION workforce_guard_published_definition_delete()", "$$;"),
  exactBlock(foundation, "CREATE TRIGGER workforce_policies_published_definition_delete_guard", ";"),
  exactBlock(lifecycle, "CREATE OR REPLACE FUNCTION workforce_guard_published_policy_definition()", "$$;"),
  exactBlock(lifecycle, "CREATE OR REPLACE TRIGGER workforce_policies_published_definition_guard", ";"), "COMMIT;"].join("\n") + "\n"
await writeFile(directory + "/selected-canonical-guards.sql", sql, { flag: "wx" })
const paths = [foundationPath, lifecyclePath, "scripts/ci/fixtures/workforce-manager-today-browser.sql",
  "scripts/ci/fixtures/workforce-policy-version-browser.sql", "scripts/ci/fixtures/workforce-policy-restore-writer.sql",
  "prisma/migrations/20261004073000_workforce_policy_restore_operation_anchor/migration.sql", "prisma/schema.prisma",
  "scripts/ci/workforce-policy-restore-fixture.mjs"]
const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
await writeFile(directory + "/selected-baseline-source-bindings.json", JSON.stringify({ sourceBindings,
  selectedSql: { path: "selected-canonical-guards.sql", bytes: Buffer.byteLength(sql), sha256: createHash("sha256").update(sql).digest("hex") },
  boundary: "Selected baseline CHECK/version/GiST/RLS fixtures and exact published UPDATE/DELETE functions; not full historical migration replay." }, null, 2) + "\n", { flag: "wx" })
