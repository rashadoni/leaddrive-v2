/**
 * The table behind «Свои зоны» of the live map: named areas a manager draws
 * by hand (owner, 2026-10-09: «бери почти всё, чего у нас нет»).
 *
 * A text test: it reads the migration the deploy applies and says what must
 * be in it. That Postgres accepts the file, and what its constraint then
 * refuses, is asked of a real database in
 * mtm-contact-categories-postgres.test.ts («zones drawn on the live map»).
 * The tenant policy is proved nowhere but here, as text: that suite connects
 * as a superuser, which no policy holds.
 */
import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

const FOLDER = "prisma/migrations/20261010120000_mtm_map_zones"
const migration = readFileSync(`${FOLDER}/migration.sql`, "utf8")
/** What is executed: the file without its `--` comments. */
const sql = migration.replace(/--[^\n]*/g, "")
const schema = readFileSync("prisma/schema.prisma", "utf8")
const model = schema.match(/\nmodel MtmMapZone \{([\s\S]*?)\n\}/)?.[1] ?? ""

describe("MTM map zones migration", () => {
  it("is tenant-isolated on the setting the application actually sets, and the table's owner is held to it too", () => {
    expect(sql).toContain('ALTER TABLE "mtm_map_zones" ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE "mtm_map_zones" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY "tenant_isolation" ON "mtm_map_zones"')
    // Once for the rows that are read and once for the rows that are written.
    expect(sql.match(/"organizationId" = current_setting\('app\.org_id', true\)/g)).toHaveLength(2)
    expect(sql.match(/current_setting\('app\.rls_bypass', true\) = 'on'/g)).toHaveLength(2)
    expect(sql).toMatch(/USING \([\s\S]*app\.rls_bypass[\s\S]*WITH CHECK \([\s\S]*app\.rls_bypass/)
    expect(migration).not.toContain("app.current_organization_id")
  })

  it("leaves with its organization: deleting a tenant relies on this cascade alone", () => {
    expect(sql).toContain('FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE')
  })

  it("stores one whole shape per row — a circle with its centre and radius, or an outline and nothing of a circle", () => {
    expect(sql).toContain(`CONSTRAINT "mtm_map_zones_kind_check" CHECK ("kind" IN ('CIRCLE', 'POLYGON'))`)
    const shape = sql.match(/CONSTRAINT "mtm_map_zones_shape_check" CHECK \(([\s\S]*?)\n\);/)?.[1] ?? ""
    const [circle, outline] = shape.split(/\n\s*OR\s*\n/)
    expect(circle).toContain(`"kind" = 'CIRCLE' AND "polygon" IS NULL`)
    // A CHECK passes when its expression is NULL, and `NULL BETWEEN …` is
    // NULL: without these three terms a circle with no centre is storable.
    for (const column of ["centerLatitude", "centerLongitude", "radiusMeters"]) {
      expect(circle).toContain(`"${column}" IS NOT NULL`)
      expect(outline).toContain(`"${column}" IS NULL`)
    }
    expect(circle).toContain('"centerLatitude" BETWEEN -90 AND 90')
    expect(circle).toContain('"centerLongitude" BETWEEN -180 AND 180')
    expect(circle).toContain('"radiusMeters" BETWEEN 25 AND 100000')
    expect(outline).toContain(`"kind" = 'POLYGON' AND "polygon" IS NOT NULL AND jsonb_typeof("polygon") = 'object'`)
  })

  it("refuses a zone without a name and one whose name is longer than the form allows", () => {
    expect(sql).toContain('CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)')
  })

  it("keeps a removed zone as a row, and does not wait on a busy table for longer than three seconds", () => {
    expect(sql).toContain('"deletedAt" TIMESTAMP(3)')
    expect(sql).toContain('"mtm_map_zones_organizationId_deletedAt_idx" ON "mtm_map_zones"("organizationId", "deletedAt")')
    expect(sql).toContain("SET lock_timeout = '3s'")
    expect(sql.indexOf("SET lock_timeout")).toBeLessThan(sql.indexOf("CREATE TABLE"))
  })

  it("only adds a table: nothing that exists is altered, dropped or granted, and the folder holds the one file", () => {
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(DROP|GRANT|REVOKE|OWNER TO|TRUNCATE|INSERT INTO|DELETE FROM)\b/)
    // «ON UPDATE CASCADE» is the foreign key's own clause; a statement is not.
    expect(sql).not.toMatch(/^\s*UPDATE\s/m)
    for (const altered of sql.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(altered[1]).toBe("mtm_map_zones")
    expect(readdirSync(FOLDER)).toEqual(["migration.sql"])
  })

  it("is the model the application reads: mapped to the table, with its organization and every column", () => {
    expect(model).toContain('@@map("mtm_map_zones")')
    expect(model).toMatch(/organization\s+Organization\s+@relation\(fields: \[organizationId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/\n\s+mtmMapZones\s+MtmMapZone\[\]\n/)
    // The same columns on both sides: a field without a column fails on the
    // first query, a column without a field is never written.
    const columns = Array.from(sql.matchAll(/^\s+"(\w+)" (?:TEXT|DOUBLE PRECISION|INTEGER|JSONB|TIMESTAMP)/gm), (match) => match[1])
    const fields = Array.from(model.matchAll(/^\s+(\w+)\s+(?:String|Float|Int|Json|DateTime)\??\s/gm), (match) => match[1])
    expect(columns.length).toBeGreaterThan(10)
    expect([...fields].sort()).toEqual([...columns].sort())
  })
})
