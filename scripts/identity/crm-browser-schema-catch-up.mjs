/**
 * Disposable CRM browser database only: after the frozen pre-identity base and
 * the actual identity migrations, add what the CURRENT schema.prisma declares
 * and the database still lacks (tables, columns, enums, indexes, foreign keys).
 *
 * Later migrations cannot be replayed on a db-push base (they alter CHECKs and
 * triggers that only earlier raw SQL created), and a db push on top would drop
 * the identity SQL guards Prisma does not model. So the diff is applied
 * additively: every DROP, RENAME or ALTER COLUMN is skipped and listed, the
 * guards stay, and a second diff must show nothing additive left.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const ownerUrl = new URL(process.env.ADMIN_DATABASE_URL ?? "")
assert.equal(ownerUrl.hostname, "127.0.0.1"); assert.equal(ownerUrl.pathname, "/identity_crm_browser_test")

const diff = () => execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", ownerUrl.href,
  "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "inherit"] })

export function splitAdditive(script) {
  const statements = script.split("\n").filter(line => !line.startsWith("--")).join("\n")
    .split(/;\s*(?:\n|$)/).map(statement => statement.trim()).filter(Boolean)
  const apply = [], skip = []
  for (const statement of statements) {
    if (/^CREATE (TYPE|TABLE|INDEX|UNIQUE INDEX) /.test(statement)
      || /^ALTER TYPE "[^"]+" ADD VALUE /.test(statement)
      || /^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" FOREIGN KEY /.test(statement)) { apply.push(statement); continue }
    const alter = /^ALTER TABLE ("[^"]+") ([\s\S]+)$/.exec(statement)
    const clauses = alter ? alter[2].split(/,\n/).map(clause => clause.trim()) : []
    const added = clauses.filter(clause => clause.startsWith("ADD COLUMN "))
    if (added.length) apply.push(`ALTER TABLE ${alter[1]} ${added.join(",\n")}`)
    if (added.length !== clauses.length || !alter) skip.push(alter ? `ALTER TABLE ${alter[1]} ${clauses.filter(clause => !added.includes(clause)).join(", ")}` : statement)
  }
  return { apply, skip }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { apply, skip } = splitAdditive(diff())
  if (apply.length) execFileSync("psql", [ownerUrl.href, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: apply.map(statement => `${statement};\n`).join(""), stdio: ["pipe", "inherit", "inherit"], timeout: 120_000,
  })
  console.log(`IDENTITY_CRM_SCHEMA_CATCH_UP applied=${apply.length} skipped=${skip.length}`)
  for (const statement of skip) console.log(`  kept (not applied): ${statement.split("\n")[0].slice(0, 200)}`)
  const remaining = splitAdditive(diff()).apply
  assert.deepEqual(remaining, [], "current schema.prisma still has objects the disposable database lacks")
}
