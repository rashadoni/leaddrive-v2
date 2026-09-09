import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  findSubject,
  createSubject,
  countSources,
  updateSubject,
  deleteSources,
  createSources,
  findPreservedSources,
  findUpdatedSubject,
  transaction,
} = vi.hoisted(() => ({
  findSubject: vi.fn(),
  createSubject: vi.fn(),
  countSources: vi.fn(),
  updateSubject: vi.fn(),
  deleteSources: vi.fn(),
  createSources: vi.fn(),
  findPreservedSources: vi.fn(),
  findUpdatedSubject: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: {
      findFirst: findSubject,
      findUniqueOrThrow: findUpdatedSubject,
      create: createSubject,
    },
    monitoringSource: { count: countSources },
    $transaction: transaction,
  },
}))

import { createMonitoringSubject, updateMonitoringSubject } from "@/lib/social/monitoring-subjects"

beforeEach(() => {
  vi.clearAllMocks()
  findSubject.mockResolvedValue({
    id: "subject-1",
    name: "Oba Market",
    aliases: [],
  })
  countSources.mockResolvedValue(1)
  createSubject.mockResolvedValue({ id: "subject-new", name: "Oba Market" })
  findUpdatedSubject.mockResolvedValue({ id: "subject-1", name: "Oba Market" })
  transaction.mockImplementation(async callback => callback({
    monitoringSubject: { update: updateSubject },
    monitoringSubjectSource: {
      deleteMany: deleteSources,
      createMany: createSources,
      findMany: findPreservedSources,
    },
  }))
  findPreservedSources.mockResolvedValue([])
})

describe("monitoring subject deprecated source assignments", () => {
  it("does not create MONITORS links from sourceIds", async () => {
    await createMonitoringSubject("org-1", "user-1", {
      type: "BRAND",
      name: "Oba Market",
      sourceIds: ["external-source"],
    })

    expect(createSubject.mock.calls[0]?.[0]?.data).not.toHaveProperty("sources")
    expect(countSources).not.toHaveBeenCalled()
  })

  it("ignores sourceIds on update without changing existing identity or monitoring links", async () => {
    await updateMonitoringSubject("org-1", "subject-1", {
      sourceIds: ["external-source", "official-source"],
    })

    expect(countSources).not.toHaveBeenCalled()
    expect(deleteSources).not.toHaveBeenCalled()
    expect(findPreservedSources).not.toHaveBeenCalled()
    expect(createSources).not.toHaveBeenCalled()
  })
})
