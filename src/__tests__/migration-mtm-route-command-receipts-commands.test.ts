import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The receipt table's CHECK must allow every command the server accepts.
 * START was added to the TypeScript grammar and not to the check: every route
 * start from the field app failed in production with 23514 and reached agents
 * as "no connection" (2026-09-14). This test reads the grammar and the newest
 * migration that defines the check, so the two cannot drift apart again.
 */
const root = process.cwd()
const receipt = readFileSync(join(root, "src/lib/mtm/mobile-route-command-receipt.ts"), "utf8")
const grammar = (receipt.match(/export type MtmMobileRouteCommandName = ([^\n]+)/)?.[1] ?? "")
  .split("|")
  .map((part) => part.trim().replace(/^"|"$/g, ""))
  .filter(Boolean)

const migrationsDir = join(root, "prisma/migrations")
const latestCheck = readdirSync(migrationsDir)
  .sort()
  .map((dir) => {
    try {
      return readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8")
    } catch {
      return ""
    }
  })
  .map((sql) => sql.match(/"mtm_mobile_route_command_receipts_command"\s*CHECK \("command" IN \(([^)]*)\)\)/)?.[1])
  .filter((values): values is string => Boolean(values))
  .pop() ?? ""
const allowed = latestCheck.split(",").map((value) => value.trim().replace(/^'|'$/g, ""))

describe("route-command receipts accept every command the server parses", () => {
  it("reads a non-empty grammar and check", () => {
    expect(grammar).toEqual(["CREATE_DRAFT", "UPDATE_DRAFT", "PUBLISH", "START"])
    expect(allowed.length).toBeGreaterThan(0)
  })

  it("allows each grammar command in the newest check", () => {
    expect(grammar.filter((command) => !allowed.includes(command))).toEqual([])
  })
})
