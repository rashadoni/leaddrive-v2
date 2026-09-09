import { describe, it, expect } from "vitest"
import { notDeletedWhere } from "@/lib/prisma"

// The Prisma client soft-delete extension injects `notDeletedWhere(args.where)`
// on every NON-transaction task READ (findMany/findFirst/count/aggregate/groupBy).
// IMPORTANT: query-extensions do NOT apply to the tx client inside $transaction,
// so transaction-wrapped reads (e.g. project-rollup) filter deletedAt explicitly.
// There is no DB-backed integration test yet; here we lock the pure where-helper
// invariant that the whole soft-delete guarantee rests on.
describe("notDeletedWhere (soft-delete where-helper)", () => {
  it("adds deletedAt:null to an empty / undefined where", () => {
    expect(notDeletedWhere(undefined)).toEqual({ deletedAt: null })
    expect(notDeletedWhere({})).toEqual({ deletedAt: null })
  })

  it("preserves other where fields and adds deletedAt:null", () => {
    expect(notDeletedWhere({ organizationId: "o1", status: "todo" })).toEqual({
      organizationId: "o1",
      status: "todo",
      deletedAt: null,
    })
  })

  it("escape hatch: leaves where untouched when deletedAt is already referenced", () => {
    // include-deleted / restore flows pass an explicit deletedAt and must NOT be
    // overridden back to null.
    expect(notDeletedWhere({ deletedAt: { not: null } })).toEqual({ deletedAt: { not: null } })
    expect(notDeletedWhere({ deletedAt: null })).toEqual({ deletedAt: null })
    expect(notDeletedWhere({ organizationId: "o1", deletedAt: { not: null } })).toEqual({
      organizationId: "o1",
      deletedAt: { not: null },
    })
  })
})
