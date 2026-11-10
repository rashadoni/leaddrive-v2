/**
 * Two stands rebuild the booking tables from the migrations themselves rather
 * than from `db push`, so that the real DDL — constraints, row-level security,
 * triggers — is what the test runs against: the role sandbox
 * (.github/workflows/booking-role-sandbox.yml) and the online booking suite
 * (online-booking-postgres.test.ts). Each holds its own hand-written list of
 * migration folders, and until 2026-11-10 nothing compared either list with
 * what is on disk.
 *
 * A migration left out of them does not fail the migration: it fails the stand,
 * at seed, with a bare `PrismaClientKnownRequestError` and no column name —
 * the generated client writes a column the rebuilt table does not have. That
 * is 25 minutes of CI to learn one word. The list is derived here instead, from
 * the migrations that actually touch a booking table, and both copies must
 * match it exactly and in order.
 *
 * Adding a booking migration: put its folder at the end of both lists.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const MIGRATIONS = path.join(ROOT, "prisma/migrations")

/** Exactly the tables both stands drop before replaying the migrations. */
const BOOKING_TABLES = [
  "bookings", "booking_pages", "booking_secrets", "booking_coordinator_grants",
  "booking_integration_bindings", "booking_change_notes", "booking_offers", "booking_reminders",
]

function touchesBookingTable(sql: string): boolean {
  return BOOKING_TABLES.some((table) =>
    new RegExp(`(CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE UNIQUE INDEX)[^;]*?"${table}"`, "is").test(sql))
}

/** The migrations that build the booking tables, oldest first — the folder names sort by date. */
function bookingMigrations(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => statSync(path.join(MIGRATIONS, name)).isDirectory())
    .sort()
    .filter((name) => {
      const file = path.join(MIGRATIONS, name, "migration.sql")
      try { return touchesBookingTable(readFileSync(file, "utf8")) } catch { return false }
    })
}

/** The folder names a stand replays, in the order it replays them. */
function listedIn(file: string, pattern: RegExp): string[] {
  const source = readFileSync(path.join(ROOT, file), "utf8")
  const line = pattern.exec(source)
  expect(line, `no migration replay list found in ${file}`).not.toBeNull()
  return [...line![1].matchAll(/\d{14}_[a-z0-9_]+/g)].map((match) => match[0])
}

describe("the booking migrations both stands replay", () => {
  const expected = bookingMigrations()

  it("is not empty — the scan itself must keep working", () => {
    expect(expected.length).toBeGreaterThan(5)
    expect(expected[0]).toMatch(/_online_booking$/)
  })

  it("is listed in full, and in order, by the role sandbox workflow", () => {
    expect(listedIn(".github/workflows/booking-role-sandbox.yml", /for migration in ([^;]+); do/)).toEqual(expected)
  })

  it("is listed in full, and in order, by the online booking suite", () => {
    expect(listedIn("src/__tests__/online-booking-postgres.test.ts", /for \(const migration of \[([^\]]+)\]\)/)).toEqual(expected)
  })
})
