import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; status: string }>,
  calls: [] as string[],
}))

vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn(async () => {
      state.calls.push("lock")
      return 1
    }),
    monitoringSubject: {
      findMany: vi.fn(async () => {
        state.calls.push("find")
        return state.rows
      }),
      create: vi.fn(async (args: { data: { name: string; status: string } }) => {
        state.calls.push("create")
        const row = { id: `subject-${state.rows.length + 1}`, name: args.data.name, status: args.data.status }
        state.rows.push(row)
        return { id: row.id }
      }),
    },
  }
  return {
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  }
})

import { claimMonitoringSubjectIdentity } from "@/lib/social/monitoring-subjects"

describe("monitoring subject identity claim", () => {
  beforeEach(() => {
    state.rows = []
    state.calls = []
  })

  it("creates the provisioning anchor paused after taking the database lock", async () => {
    const result = await claimMonitoringSubjectIdentity("org-1", "user-1", {
      type: "BRAND",
      name: "Araz Supermarket",
      aliases: [],
    })

    expect(result).toEqual({ subjectId: "subject-1", created: true })
    expect(state.rows[0]).toMatchObject({ name: "Araz Supermarket", status: "paused" })
    expect(state.calls).toEqual(["lock", "find", "create"])
  })

  it("reuses a normalized name instead of creating a concurrent duplicate", async () => {
    state.rows.push({ id: "subject-existing", name: "Araz Supermarket", status: "active" })

    const result = await claimMonitoringSubjectIdentity("org-1", "user-2", {
      type: "BRAND",
      name: "  ARAZ   SUPERMARKET ",
    })

    expect(result).toEqual({ subjectId: "subject-existing", created: false })
    expect(state.rows).toHaveLength(1)
    expect(state.calls).toEqual(["lock", "find"])
  })
})
