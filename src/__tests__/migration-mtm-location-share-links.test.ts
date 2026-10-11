/**
 * The table behind «Ссылка на местоположение»: links by which somebody
 * outside the organization sees where one employee is now.
 *
 * A text test: it reads the migration the deploy applies and says what must
 * be in it. That Postgres accepts the file, what its constraints then refuse,
 * and what the policy lets a role without BYPASSRLS read — with no
 * organization, with another one, with the right one and under the bypass —
 * is asked of a real database in mtm-contact-categories-postgres.test.ts
 * («links to an employee's position»).
 */
import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

const FOLDER = "prisma/migrations/20261010150000_mtm_location_share_links"
const TABLE = "mtm_location_share_links"
const migration = readFileSync(`${FOLDER}/migration.sql`, "utf8")
/** What is executed: the file without its `--` comments. */
const sql = migration.replace(/--[^\n]*/g, "")
const schema = readFileSync("prisma/schema.prisma", "utf8")
const model = schema.match(/\nmodel MtmLocationShareLink \{([\s\S]*?)\n\}/)?.[1] ?? ""
/** The table's columns, as the migration declares them: name → the rest of the line. */
const columns = new Map(Array.from(
  sql.matchAll(/^\s+"(\w+)" ((?:TEXT|INTEGER|TIMESTAMP)[^\n]*?),?$/gm),
  (match) => [match[1], match[2]] as const,
))

describe("MTM location share links migration", () => {
  it("is tenant-isolated on the setting the application actually sets, and the table's owner is held to it too", () => {
    expect(sql).toContain(`ALTER TABLE "${TABLE}" ENABLE ROW LEVEL SECURITY`)
    expect(sql).toContain(`ALTER TABLE "${TABLE}" FORCE ROW LEVEL SECURITY`)
    expect(sql).toContain(`CREATE POLICY "tenant_isolation" ON "${TABLE}"`)
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(1)
    // Once for the rows that are read and once for the rows that are written.
    expect(sql.match(/"organizationId" = current_setting\('app\.org_id', true\)/g)).toHaveLength(2)
    expect(migration).not.toContain("app.current_organization_id")
  })

  it("lets the one lookup by token through: the bypass is in what is read and in what is written", () => {
    // The public page knows the token and nothing else. Without this clause in
    // USING every link answers «не работает»; without it in WITH CHECK the
    // organization-less jobs that every other MTM table admits could not write.
    expect(sql.match(/current_setting\('app\.rls_bypass', true\) = 'on'/g)).toHaveLength(2)
    expect(sql).toMatch(/USING \([\s\S]*app\.rls_bypass[\s\S]*WITH CHECK \([\s\S]*app\.rls_bypass/)
    // Never «bypass unless told otherwise»: the clause opens only on the exact word.
    expect(sql).not.toMatch(/rls_bypass', true\) (?:<>|!=|IS NULL|IS NOT)/)
  })

  it("leaves with its organization and with its employee, and can only point at an employee of its own organization", () => {
    expect(sql).toContain('FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE')
    // With the organization in the key, as on mtm_device_tokens.
    expect(sql).toContain('FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(sql).not.toMatch(/ON DELETE (?:SET NULL|RESTRICT|NO ACTION)/)
  })

  it("keeps the hash of a token and no token: no column could hold a link", () => {
    expect([...columns.keys()].sort()).toEqual([
      "agentId", "createdAt", "createdBy", "expiresAt", "id", "lastViewedAt",
      "organizationId", "revokedAt", "revokedBy", "tokenHash", "viewCount",
    ])
    for (const name of columns.keys()) {
      if (name === "tokenHash") continue
      expect(name, name).not.toMatch(/token|url|link|secret|href/i)
    }
    // And the one column that is about the token takes a SHA-256 in lowercase hex and nothing of another shape.
    expect(sql).toContain(`CONSTRAINT "${TABLE}_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')`)
    expect(columns.get("tokenHash")).toBe("TEXT NOT NULL")
  })

  it("finds a link by its hash across every organization: one hash, one row", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "${TABLE}_tokenHash_key" ON "${TABLE}"("tokenHash");`)
    // Not «unique within an organization»: the lookup has no organization to name.
    expect(sql).not.toMatch(/UNIQUE INDEX "[^"]+" ON "[^"]+"\("organizationId", "tokenHash"\)/)
    expect(model).toMatch(/tokenHash\s+String\s+@unique/)
  })

  it("refuses a link that ends before it begins and a count of views below nothing", () => {
    expect(sql).toContain(`CONSTRAINT "${TABLE}_expiresAt_check" CHECK ("expiresAt" > "createdAt")`)
    expect(sql).toContain(`CONSTRAINT "${TABLE}_viewCount_check" CHECK ("viewCount" >= 0)`)
    expect(columns.get("expiresAt")).toBe("TIMESTAMP(3) NOT NULL")
    expect(columns.get("viewCount")).toBe("INTEGER NOT NULL DEFAULT 0")
  })

  it("keeps a revoked link as a row, and does not wait on a busy table for longer than three seconds", () => {
    expect(columns.get("revokedAt")).toBe("TIMESTAMP(3)")
    expect(sql).toContain(`"${TABLE}_organizationId_agentId_expiresAt_idx" ON "${TABLE}"("organizationId", "agentId", "expiresAt")`)
    expect(sql).toContain("SET lock_timeout = '3s'")
    expect(sql.indexOf("SET lock_timeout")).toBeLessThan(sql.indexOf("CREATE TABLE"))
  })

  it("only adds a table: nothing that exists is altered, dropped or granted, and the folder holds the one file", () => {
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(DROP|GRANT|REVOKE|OWNER TO|TRUNCATE|INSERT INTO|DELETE FROM)\b/)
    // «ON UPDATE CASCADE» is the foreign key's own clause; a statement is not.
    expect(sql).not.toMatch(/^\s*UPDATE\s/m)
    for (const altered of sql.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(altered[1]).toBe(TABLE)
    for (const indexed of sql.matchAll(/INDEX "[^"]+" ON "([^"]+)"/g)) expect(indexed[1]).toBe(TABLE)
    expect(readdirSync(FOLDER)).toEqual(["migration.sql"])
  })

  it("sorts after the zones' migration, so the deploy applies it last", () => {
    const folders = readdirSync("prisma/migrations").filter((name) => /^\d{14}_/.test(name)).sort()
    expect(folders.indexOf("20261010150000_mtm_location_share_links")).toBeGreaterThan(folders.indexOf("20261010120000_mtm_map_zones"))
  })

  it("is the model the application reads: mapped to the table, with its organization, its employee and every column", () => {
    expect(model).toContain(`@@map("${TABLE}")`)
    expect(model).toMatch(/organization\s+Organization\s+@relation\(fields: \[organizationId\], references: \[id\], onDelete: Cascade\)/)
    expect(model).toMatch(/agent\s+MtmAgent\s+@relation\(fields: \[organizationId, agentId\], references: \[organizationId, id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/\n\s+mtmLocationShareLinks\s+MtmLocationShareLink\[\]\n/)
    expect(schema).toMatch(/\n\s+locationShareLinks\s+MtmLocationShareLink\[\]\n/)
    // Views are counted on the row itself; an `updatedAt` would move with every one of them.
    expect(model).not.toMatch(/@updatedAt/)
    // The same columns on both sides: a field without a column fails on the
    // first query, a column without a field is never written.
    const fields = Array.from(model.matchAll(/^\s+(\w+)\s+(?:String|Int|DateTime)\??\s/gm), (match) => match[1])
    expect(columns.size).toBe(11)
    expect([...fields].sort()).toEqual([...columns.keys()].sort())
  })
})
