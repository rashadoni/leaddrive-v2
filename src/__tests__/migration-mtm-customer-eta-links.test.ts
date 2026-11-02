/**
 * The columns «агент едет к вам» adds to mtm_location_share_links (the link
 * the bot sends the customer an agent has set off to). A text test of the
 * file the deploy applies; what Postgres then refuses — a bot's row without
 * its stop, a second link for one stop — is asked of a real database in
 * mtm-customer-eta-links-postgres.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

const FOLDER = "prisma/migrations/20261120090000_mtm_customer_eta_links"
const TABLE = "mtm_location_share_links"
const sql = readFileSync(`${FOLDER}/migration.sql`, "utf8").replace(/--[^\n]*/g, "")

describe("MTM customer ETA links migration", () => {
  it("only adds to the links' table: no row is rewritten, and every existing link reads as a manager's", () => {
    expect(sql).not.toMatch(/\b(DROP|GRANT|REVOKE|TRUNCATE|INSERT INTO|DELETE FROM|CREATE TABLE)\b/)
    expect(sql).not.toMatch(/^\s*UPDATE\s/m)
    for (const altered of sql.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(altered[1]).toBe(TABLE)
    expect(sql).toContain(`ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'MANAGER'`)
    // Every other new column may be empty: the previous build writes none of them.
    const added = Array.from(sql.matchAll(/ADD COLUMN "(\w+)" ([^,;]+)/g), (match) => [match[1], match[2].trim()])
    expect(added.map(([name]) => name)).toEqual(["purpose", "routePointId", "customerId", "deliveryChannel", "deliveryStatus", "deliveryError"])
    for (const [name, type] of added.slice(1)) expect(type, name).toBe("TEXT")
    // No column could hold a link or the number it was sent to.
    for (const [name] of added) expect(name, name).not.toMatch(/token|url|link|href|phone|to$/i)
    expect(sql).toContain("SET lock_timeout = '3s'")
    expect(readdirSync(FOLDER)).toEqual(["migration.sql"])
  })

  it("keeps one link per stop, ever, and a bot's link always names its stop and its customer", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "${TABLE}_routePointId_key" ON "${TABLE}"("routePointId");`)
    expect(sql).toContain(`CHECK ("purpose" IN ('MANAGER', 'CUSTOMER_ETA'))`)
    expect(sql).toMatch(/"purpose" = 'CUSTOMER_ETA' AND "routePointId" IS NOT NULL AND "customerId" IS NOT NULL/)
    expect(sql).toMatch(/"purpose" = 'MANAGER' AND "routePointId" IS NULL AND "customerId" IS NULL/)
  })

  it("leaves with its stop, and points only at a customer of its own organization", () => {
    expect(sql).toContain(`FOREIGN KEY ("routePointId") REFERENCES "mtm_route_points"("id") ON DELETE CASCADE`)
    expect(sql).toContain(`FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE`)
  })

  it("sorts after the table it adds to and the tables it points at", () => {
    const folders = readdirSync("prisma/migrations").filter((name) => /^\d{14}_/.test(name)).sort()
    expect(folders.indexOf("20261120090000_mtm_customer_eta_links")).toBeGreaterThan(folders.indexOf("20261010150000_mtm_location_share_links"))
  })
})
