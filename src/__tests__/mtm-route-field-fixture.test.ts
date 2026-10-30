import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { RF, assertRouteFieldOwner, prepareRouteFieldFixture, readRouteFieldFixture,
  routeFieldFailure, validateRouteFieldEvidence } from "../../scripts/mtm-route-field-fixture"

const owned = { id: RF.id, slug: RF.slug, settings: { routeFieldAcceptanceOwner: RF.marker } }
const hash = "$2b$12$" + "x".repeat(53)
describe("separate Route & Field fixture", () => {
  it("refuses customer/Time identities even if a role or one identity field matches", () => {
    expect(() => assertRouteFieldOwner(owned)).not.toThrow()
    for (const patch of [{ id: "mtm-attendance-phone-v1" }, { slug: "zeytun" }, { settings: {} },
      { settings: { routeFieldAcceptanceOwner: "unowned" } }]) {
      expect(() => assertRouteFieldOwner({ ...owned, ...patch })).toThrow("RF_FIXTURE_NOT_OWNED")
    }
    expect(() => assertRouteFieldOwner(null)).toThrow("RF_FIXTURE_NOT_OWNED")
  })
  it("checks ownership/collisions before inserts and never resets an existing fixture", async () => {
    const create = vi.fn()
    const tx = { $executeRaw: vi.fn(), organization: { findMany: vi.fn(), create } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    for (const rows of [[{ ...owned, settings: {} }], [owned, owned]]) {
      tx.organization.findMany.mockResolvedValue(rows)
      await expect(prepareRouteFieldFixture(db, hash)).rejects.toThrow("RF_FIXTURE_NOT_OWNED")
    }
    tx.organization.findMany.mockResolvedValue([owned])
    await expect(prepareRouteFieldFixture(db, hash)).resolves.toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects plaintext or malformed hashes before database access", async () => {
    const transaction = vi.fn()
    for (const input of ["password", "", "$2b$12$short", hash + "\n"]) {
      await expect(prepareRouteFieldFixture({ $transaction: transaction } as unknown as PrismaClient, input))
        .rejects.toThrow("RF_FIXTURE_PASSWORD_INVALID")
    }
    expect(transaction).not.toHaveBeenCalled()
  })
  it("makes the inspection transaction read-only before any lookup", async () => {
    const calls: string[] = []
    const tx = { $executeRawUnsafe: async (sql: string) => { calls.push(sql) }, $executeRaw: async () => { calls.push("scope") },
      organization: { findMany: async () => { calls.push("lookup"); return [] } } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    await expect(readRouteFieldFixture(db)).rejects.toThrow("RF_FIXTURE_NOT_OWNED")
    expect(calls).toEqual(["SET TRANSACTION READ ONLY", "scope", "lookup"])
  })
  it("admits only count-only public evidence with the exact source revision", () => {
    const pass = { version: 1, status: "PASS", artifactSha: "a".repeat(40), tenant: RF.slug, created: true, users: 1, agents: 3, customers: 3 }
    expect(validateRouteFieldEvidence(pass)).toEqual(pass)
    for (const patch of [{ password: "PRIVATE" }, { users: [{ email: "PRIVATE" }] }, { agents: 4 },
      { tenant: "customer" }, { artifactSha: "main" }, { customers: 4 }]) {
      expect(() => validateRouteFieldEvidence({ ...pass, ...patch })).toThrow()
    }
    expect(routeFieldFailure(new Error("database failure with PRIVATE"))).toEqual({ version: 1, status: "FAIL", code: "RF_FIXTURE_FAILED" })
    expect(() => validateRouteFieldEvidence({ version: 1, status: "FAIL", code: "PRIVATE" })).toThrow()
  })
})
