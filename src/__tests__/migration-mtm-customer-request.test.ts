import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260713181500_mtm_customer_request_add_stop/migration.sql"), "utf8")

describe("MTM customer request migration", () => {
  it("adds the governed route stop transition", () => {
    expect(sql).toContain("ALTER TYPE \"MtmRouteChangeType\" ADD VALUE IF NOT EXISTS 'ADD_STOP'")
  })

  it("pins route offer acceptance for retry safety", () => {
    expect(sql).toContain("\"routeOfferAcceptedAt\"")
    expect(sql).toContain("\"routeChangeRequestId\"")
  })
})
