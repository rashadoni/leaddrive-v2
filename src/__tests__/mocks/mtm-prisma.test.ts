import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { makeMtmPrismaMock, type MtmPrismaMock } from "./mtm-prisma"

/**
 * Self-test for the shared MTM prisma mock factory. Pinning the surface
 * shape so a future "let me trim the mock to save bytes" PR can't quietly
 * remove a model that some test file depends on.
 *
 * Model list is auto-derived from `prisma/schema.prisma` at test time
 * (architect M1-5b.6 follow-up Предложение). When `prisma migrate` adds
 * a new MtmFoo model, this test fails on the next run → developer adds
 * the model to the factory → CI green again. No manual list to maintain.
 */
const SCHEMA_PATH = resolve(__dirname, "../../../prisma/schema.prisma")

function extractMtmModelsFromSchema(): string[] {
  const schema = readFileSync(SCHEMA_PATH, "utf8")
  // `model Mtm<Name> {` — captures `MtmAgent`, `MtmRepairRequest`, etc.
  const matches = schema.matchAll(/^model (Mtm[A-Za-z0-9]+)\s*\{/gm)
  // Prisma model names are PascalCase; the factory uses camelCase keys.
  return Array.from(matches, m => m[1][0].toLowerCase() + m[1].slice(1)).sort()
}

describe("makeMtmPrismaMock()", () => {
  it("exposes every MTM model from prisma/schema.prisma with the full CRUD surface", () => {
    const prisma = makeMtmPrismaMock()
    const expectedModels = extractMtmModelsFromSchema()
    // Sanity: the regex actually matched something. If the schema moves or
    // changes the model keyword, this would silently turn into an empty
    // array — bail loudly instead of declaring "0 models all present".
    expect(expectedModels.length).toBeGreaterThanOrEqual(16)
    const expectedMethods = [
      "findFirst",
      "findUnique",
      "findMany",
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
      "count",
      "groupBy",
      "aggregate",
    ] as const
    for (const model of expectedModels) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (prisma as any)[model]
      expect(m).toBeDefined()
      for (const method of expectedMethods) {
        expect(typeof m[method]).toBe("function")
      }
    }
  })

  it("count defaults to resolving 0 — prevents the M3-5b burst-detection regression", async () => {
    const prisma = makeMtmPrismaMock()
    // POST /photos pattern: `prisma.mtmPhoto.count(...).then(n => ...)`.
    // Without the default resolve(0), the unmocked promise was rejecting
    // and crashing the route handler. This test pins the default.
    await expect(prisma.mtmPhoto.count({ where: {} })).resolves.toBe(0)
  })

  it("$transaction callback form: tx is the SAME outer instance — mockResolvedValue overrides flow through", async () => {
    // Architect M1-5b.6 review caught this: if callback gets a FRESH
    // mock, test-author overrides on `prisma.mtmVisit.update` won't
    // reach `tx.mtmVisit.update` inside the route's transaction.
    const prisma = makeMtmPrismaMock()
    prisma.mtmVisit.update.mockResolvedValue({ id: "v1", status: "CHECKED_OUT" })
    const result = await prisma.$transaction(async (tx: MtmPrismaMock) => {
      // Same instance check
      expect(tx).toBe(prisma)
      // Override set on the outer mock must be visible inside tx
      const updated = await tx.mtmVisit.update({ where: { id: "v1" }, data: {} })
      return updated
    })
    expect(result).toEqual({ id: "v1", status: "CHECKED_OUT" })
    expect(prisma.mtmVisit.update).toHaveBeenCalledTimes(1)
  })

  it("$transaction array form: returns Promise.all(arr) — matches real Prisma semantics", async () => {
    const prisma = makeMtmPrismaMock()
    const result = await prisma.$transaction([
      Promise.resolve({ id: "a" }),
      Promise.resolve({ id: "b" }),
      Promise.resolve({ id: "c" }),
    ])
    expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
  })

  it("each factory invocation returns FRESH mocks (no cross-test bleed)", () => {
    const a = makeMtmPrismaMock()
    const b = makeMtmPrismaMock()
    expect(a.mtmAgent.findFirst).not.toBe(b.mtmAgent.findFirst)
  })

  it("user + organization models are present (commonly mocked alongside MTM)", () => {
    const prisma = makeMtmPrismaMock()
    expect(typeof prisma.user.findUnique).toBe("function")
    expect(typeof prisma.organization.findFirst).toBe("function")
  })

  it("works as a drop-in vi.mock target", () => {
    // Smoke check: the consumer pattern `vi.mock(..., () => ({ prisma: makeMtmPrismaMock() }))`
    // is the documented usage. Verify the returned object survives being
    // wrapped that way without type errors.
    const wrapped = { prisma: makeMtmPrismaMock() }
    expect(wrapped.prisma.mtmTask.create).toBeDefined()
    // Override a specific method as a real test would. `vi.fn()` already
    // exposes `mockResolvedValue` directly — no need for `vi.mocked()`.
    wrapped.prisma.mtmAgent.findFirst.mockResolvedValue({ id: "a1", name: "Test" })
    expect(wrapped.prisma.mtmAgent.findFirst).toBeDefined()
  })
})
