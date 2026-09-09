import { beforeEach, describe, expect, it, vi } from "vitest"

type AliasRow = {
  kind: string
  value: string
  normalizedValue: string
  weight: number
  isNegative: boolean
  isAmbiguous: boolean
  language?: string | null
}

const state = vi.hoisted(() => ({
  createdAliases: [] as AliasRow[],
  existing: { id: "subject-1", name: "", aliases: [] as AliasRow[] },
}))

vi.mock("@/lib/prisma", () => {
  const tx = {
    monitoringSubject: {
      update: vi.fn(async () => ({ id: "subject-1" })),
    },
    monitoringSubjectAlias: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async (args: { data: AliasRow[] }) => {
        state.createdAliases = args.data
        return { count: args.data.length }
      }),
    },
    socialReplyIdentity: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    monitoringSubjectRelation: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
  }
  return {
    prisma: {
      monitoringSubject: {
        findFirst: vi.fn(async () => state.existing),
        findUniqueOrThrow: vi.fn(async () => ({ id: "subject-1" })),
        create: vi.fn(async (args: { data: { aliases: { create: AliasRow[] } } }) => {
          state.createdAliases = args.data.aliases.create
          return { id: "subject-1" }
        }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  }
})

import { createMonitoringSubject, updateMonitoringSubject } from "@/lib/social/monitoring-subjects"

const aliasByValue = (normalizedValue: string) =>
  state.createdAliases.find(alias => alias.normalizedValue === normalizedValue)

// #636 review: the synthetic primary-name candidate is prepended flagless and
// dedupe keeps the first row, so an explicit operator flag on an alias equal
// to the subject's own name was silently discarded.
describe("alias ambiguity flags across save paths", () => {
  beforeEach(() => {
    state.createdAliases = []
    state.existing = { id: "subject-1", name: "", aliases: [] }
  })

  it("honours an explicit ambiguous mark on the subject's own multi-word name", async () => {
    await createMonitoringSubject("org-1", "user-1", {
      type: "BRAND",
      name: "Bravo Supermarket",
      aliases: [{ kind: "NAME", value: "Bravo Supermarket", isAmbiguous: true }],
    })

    expect(aliasByValue("bravo supermarket")).toMatchObject({ kind: "NAME", isAmbiguous: true })
  })

  it("honours an explicit non-ambiguous mark on a short single-word name", async () => {
    await createMonitoringSubject("org-1", "user-1", {
      type: "BRAND",
      name: "Bravo",
      aliases: [{ kind: "NAME", value: "Bravo", isAmbiguous: false }],
    })

    expect(aliasByValue("bravo")).toMatchObject({ kind: "NAME", isAmbiguous: false })
  })

  it("defaults the primary name by the single-token rule when nothing explicit is sent", async () => {
    await createMonitoringSubject("org-1", "user-1", { type: "BRAND", name: "Bravo" })

    expect(aliasByValue("bravo")).toMatchObject({ kind: "NAME", isAmbiguous: true })
  })

  // #636 review: the profile wizard resubmits aliases with no flags; a
  // flagless re-save must not silently downgrade a stored ambiguous mark.
  it("preserves a stored ambiguous mark across a flagless re-save", async () => {
    state.existing = {
      id: "subject-1",
      name: "Araz Supermarket",
      aliases: [{
        kind: "NAME", value: "Araz Filiali", normalizedValue: "araz filiali",
        weight: 0.9, isNegative: false, isAmbiguous: true,
      }],
    }

    await updateMonitoringSubject("org-1", "subject-1", {
      aliases: [{ kind: "NAME", value: "Araz Filiali" }],
    })

    expect(aliasByValue("araz filiali")).toMatchObject({ isAmbiguous: true })
  })

  it("lets an explicit incoming flag lift a stored ambiguous mark", async () => {
    state.existing = {
      id: "subject-1",
      name: "Araz Supermarket",
      aliases: [{
        kind: "NAME", value: "Araz Filiali", normalizedValue: "araz filiali",
        weight: 0.9, isNegative: false, isAmbiguous: true,
      }],
    }

    await updateMonitoringSubject("org-1", "subject-1", {
      aliases: [{ kind: "NAME", value: "Araz Filiali", isAmbiguous: false }],
    })

    expect(aliasByValue("araz filiali")).toMatchObject({ isAmbiguous: false })
  })
})
