import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  createSubject, updateSubject, findFirstSubject, findManySubjects,
  findMonitoringSources,
  claimSubject, getScenarios, createScenario, updateScenario, deleteScenario,
  deleteAliases, deleteSubjectSources, deleteRelations, tombstoneSubject,
  updateSubjectSources, findSubjectSources, updateOrphanSources, invalidateRoutePlans,
} = vi.hoisted(() => ({
  createSubject: vi.fn(),
  updateSubject: vi.fn(),
  findFirstSubject: vi.fn(),
  findManySubjects: vi.fn(),
  findMonitoringSources: vi.fn(),
  claimSubject: vi.fn(),
  getScenarios: vi.fn(),
  createScenario: vi.fn(),
  updateScenario: vi.fn(),
  deleteScenario: vi.fn(),
  deleteAliases: vi.fn(),
  deleteSubjectSources: vi.fn(),
  // Удаление клиента гасит осиротевшие источники и их платные маршруты
  // (#609) — до этого оно ЧИТАЕТ связи, чтобы знать, какие источники трогать.
  findSubjectSources: vi.fn(async () => []),
  updateOrphanSources: vi.fn(),
  invalidateRoutePlans: vi.fn(),
  deleteRelations: vi.fn(),
  tombstoneSubject: vi.fn(),
  updateSubjectSources: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findFirst: findFirstSubject, findMany: findManySubjects },
    monitoringSource: { findMany: findMonitoringSources },
    monitoringSubjectSource: { updateMany: updateSubjectSources },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      monitoringSubjectAlias: { deleteMany: deleteAliases },
      monitoringSubjectRelation: { deleteMany: deleteRelations },
      monitoringSubject: { update: tombstoneSubject },
      monitoringSubjectSource: {
        deleteMany: deleteSubjectSources,
        updateMany: updateSubjectSources,
        findMany: findSubjectSources,
      },
      monitoringSource: { updateMany: updateOrphanSources },
      sourceRoutePlan: { updateMany: invalidateRoutePlans },
    })),
  },
}))
vi.mock("@/lib/social/monitoring-subjects", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-subjects")>()
  return {
    ...original,
    createMonitoringSubject: createSubject,
    claimMonitoringSubjectIdentity: claimSubject,
    updateMonitoringSubject: updateSubject,
  }
})
vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>()
  return {
    ...original,
    getMonitoringScenarios: getScenarios,
    createMonitoringScenario: createScenario,
    updateMonitoringScenario: updateScenario,
    deleteMonitoringScenario: deleteScenario,
  }
})

import {
  createOrUpdateMonitoringProfile,
  deleteMonitoringProfile,
  resumeMonitoringProfile,
  setMonitoringProfileStatus,
} from "@/lib/social/monitoring-profiles"

const arazSubject = {
  id: "subject-araz",
  name: "Araz Supermarket",
  type: "COMPANY",
  status: "active",
  updatedAt: new Date("2026-07-14T00:00:00.000Z"),
  aliases: [
    { kind: "NAME", value: "Araz Supermarket", normalizedValue: "araz supermarket", isNegative: false },
    { kind: "HASHTAG", value: "arazsupermarket", normalizedValue: "arazsupermarket", isNegative: false },
  ],
  sources: [],
}

const arazScenario = {
  id: "scn-araz",
  subjectId: "subject-araz",
  status: "active",
  platforms: ["instagram", "facebook", "tiktok", "web"],
  search: {
    topics: [],
    keywords: ["Araz Supermarket"],
    hashtags: ["arazsupermarket"],
    handles: [],
    urls: [],
    useHashtagFallback: true,
    includeOwnedComments: true,
    includeExternalComments: null,
  },
  ai: { directions: ["general_reputation", "customer_complaints"] },
  archive: { startAt: null, lastBackfilledAt: null, scannedCount: 0, matchedCount: 0, status: "pending" },
  updatedAt: "2026-07-14T00:00:00.000Z",
}

const arazInput = {
  name: "Araz Supermarket",
  platforms: ["instagram", "facebook", "tiktok", "web"] as const,
  directions: ["general_reputation", "customer_complaints"] as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  createSubject.mockResolvedValue(arazSubject)
  claimSubject.mockImplementation(async () => {
    const created = await createSubject()
    return { subjectId: created.id, created: true }
  })
  updateSubject.mockResolvedValue(arazSubject)
  findFirstSubject.mockResolvedValue(arazSubject)
  findManySubjects.mockResolvedValue([])
  findMonitoringSources.mockResolvedValue([])
  getScenarios.mockResolvedValue([])
  createScenario.mockResolvedValue(arazScenario)
  updateScenario.mockResolvedValue(arazScenario)
  deleteScenario.mockResolvedValue(undefined)
  deleteAliases.mockResolvedValue({ count: 0 })
  deleteSubjectSources.mockResolvedValue({ count: 0 })
  deleteRelations.mockResolvedValue({ count: 0 })
  tombstoneSubject.mockResolvedValue({ ...arazSubject, status: "deleted" })
  updateSubjectSources.mockResolvedValue({ count: 0 })
})

describe("Araz Supermarket acceptance — one submission, one collection", () => {
  it("creates exactly one subject and one collection plan", async () => {
    await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    expect(createSubject).toHaveBeenCalledTimes(1)
    expect(createScenario).toHaveBeenCalledTimes(1)
    expect(updateScenario).not.toHaveBeenCalled()
  })

  it("derives the collection query from the subject so the name is never retyped", async () => {
    await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.keywords).toEqual(["Araz Supermarket"])
    expect(scenarioInput.hashtags).toEqual(["arazsupermarket"])
    expect(scenarioInput.subjectId).toBe("subject-araz")
  })

  it("ignores removed page/profile selections and rebuilds only vocabulary sources", async () => {
    await createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput,
      platforms: [...arazInput.platforms],
      directions: [...arazInput.directions],
      sourceIds: ["fb-page", "ig-profile"],
      officialSourceIds: ["ig-profile"],
    })

    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", expect.any(Object))
    expect(updateSubject.mock.calls[0][2]).not.toHaveProperty("sourceIds")
    expect(findMonitoringSources).not.toHaveBeenCalled()
    expect(updateSubjectSources).not.toHaveBeenCalled()
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.keywords).toEqual(["Araz Supermarket"])
    expect(scenarioInput.urls).toEqual([])
    expect(scenarioInput.handles).toEqual([])
  })

  it("keeps existing identity/context links outside scenario selection", async () => {
    updateSubject.mockResolvedValue({
      ...arazSubject,
      sources: [
        {
          relationType: "OFFICIAL",
          source: {
            id: "ig-profile", platform: "instagram", sourceType: "profile", url: "https://www.instagram.com/arazsupermarket",
            handle: null, query: null, status: "active", ownership: "external", collectionMode: "search_index", routePlans: [], collectorRuns: [],
          },
        },
        {
          relationType: "CONTEXT",
          source: {
            id: "context-web", platform: "web", sourceType: "search_url", url: "https://example.com/context",
            handle: null, query: null, status: "active", ownership: "external", collectionMode: "search_index", routePlans: [], collectorRuns: [],
          },
        },
      ],
    })

    await createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput,
      platforms: ["instagram"],
      directions: [...arazInput.directions],
    })

    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", expect.any(Object))
    expect(updateSubject.mock.calls[0][2]).not.toHaveProperty("sourceIds")
    expect(updateSubjectSources).not.toHaveBeenCalled()
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.urls).toEqual([])
  })

  it("does not validate or recreate a legacy official selection", async () => {
    await expect(createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput,
      platforms: ["instagram"],
      directions: [...arazInput.directions],
      sourceIds: [],
      officialSourceIds: ["ig-profile"],
    })).resolves.toMatchObject({ id: "subject-araz" })
    expect(updateSubjectSources).not.toHaveBeenCalled()
  })

  it("passes both directions to the single collection plan", async () => {
    await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.directions).toEqual(["general_reputation", "customer_complaints"])
  })

  it("reuses an existing profile instead of creating a duplicate", async () => {
    getScenarios.mockResolvedValue([arazScenario])
    await createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions],
      subjectId: "subject-araz",
    })
    expect(createSubject).not.toHaveBeenCalled()
    expect(updateSubject).toHaveBeenCalled()
    expect(createScenario).not.toHaveBeenCalled()
    expect(updateScenario).toHaveBeenCalledTimes(1)
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", expect.any(Object))
    expect(updateSubject.mock.calls[0][2]).not.toHaveProperty("sourceIds")
  })

  it("reuses a same-named profile instead of duplicating it on resubmit", async () => {
    // A double-click, or a second operator typing the same brand, must not split
    // the archive across two identically named subjects.
    findManySubjects.mockResolvedValue([{ id: "subject-araz", name: "araz supermarket" }])
    await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    expect(createSubject).not.toHaveBeenCalled()
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", expect.any(Object))
  })

  it("does not absorb a genuinely different name into an existing profile", async () => {
    findManySubjects.mockResolvedValue([{ id: "subject-araz", name: "Araz Supermarket" }])
    await createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions],
      name: "Araz Market Baku",
    })
    expect(createSubject).toHaveBeenCalledTimes(1)
  })

  it("never enables live send", async () => {
    const profile = await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    expect(profile.liveSendAllowed).toBe(false)
  })

  it("leaves the paid-comment choice untouched when the operator made none", async () => {
    await createOrUpdateMonitoringProfile("org-1", "user-1", { ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions] })
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.includeExternalComments).toBeUndefined()
  })
})

describe("compensation when the scenario store fails", () => {
  it("leaves a newly created subject paused rather than active-but-collecting-nothing", async () => {
    createScenario.mockRejectedValue(new Error("channel config write failed"))
    await expect(createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions],
    })).rejects.toThrow("channel config write failed")
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", { status: "paused" })
  })

  it("does not pause a pre-existing subject it did not create", async () => {
    updateScenario.mockRejectedValue(new Error("channel config write failed"))
    getScenarios.mockResolvedValue([arazScenario])
    await expect(createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions],
      subjectId: "subject-araz",
    })).rejects.toThrow("channel config write failed")
    expect(updateSubject).not.toHaveBeenCalledWith("org-1", "subject-araz", { status: "paused" })
  })

  it("surfaces the original failure even if compensation itself fails", async () => {
    createScenario.mockRejectedValue(new Error("channel config write failed"))
    updateSubject
      .mockResolvedValueOnce(arazSubject)
      .mockRejectedValueOnce(new Error("compensation failed too"))
    await expect(createOrUpdateMonitoringProfile("org-1", "user-1", {
      ...arazInput, platforms: [...arazInput.platforms], directions: [...arazInput.directions],
    })).rejects.toThrow("channel config write failed")
  })
})

describe("Bahruz Şiraliyev acceptance — resume without re-collecting", () => {
  const bahruz = {
    ...arazSubject,
    id: "subject-bahruz",
    name: "Bahruz Şiraliyev",
    type: "PERSON",
    status: "paused",
    aliases: [{ kind: "NAME", value: "Bahruz Şiraliyev", normalizedValue: "bahruz şiraliyev", isNegative: false }],
  }

  beforeEach(() => {
    findFirstSubject.mockResolvedValue(bahruz)
    updateSubject.mockResolvedValue({ ...bahruz, status: "active" })
    createScenario.mockResolvedValue({ ...arazScenario, id: "scn-bahruz", subjectId: "subject-bahruz" })
  })

  it("rebuilds the collection plan from the vocabulary already stored", async () => {
    await resumeMonitoringProfile("org-1", "subject-bahruz", "user-1")
    const [, , scenarioInput] = createScenario.mock.calls[0]
    expect(scenarioInput.keywords).toEqual(["Bahruz Şiraliyev"])
    expect(createSubject).not.toHaveBeenCalled()
  })

  it("reactivates the subject", async () => {
    await resumeMonitoringProfile("org-1", "subject-bahruz", "user-1")
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-bahruz", { status: "active" })
  })

  it("resumes an existing scenario without replacing its collection settings", async () => {
    getScenarios.mockResolvedValue([{ ...arazScenario, id: "scn-bahruz", subjectId: "subject-bahruz" }])
    await resumeMonitoringProfile("org-1", "subject-bahruz", "user-1")

    expect(createScenario).not.toHaveBeenCalled()
    expect(updateScenario).toHaveBeenCalledWith("org-1", "scn-bahruz", { status: "active" })
  })

  it("repairs missing automatic YouTube and WEB coverage and returns refreshed sources", async () => {
    const repaired = {
      ...bahruz,
      status: "active",
      sources: [
        {
          relationType: "MONITORS",
          source: {
            id: "youtube-source",
            platform: "youtube",
            sourceType: "keyword",
            url: null,
            handle: null,
            query: "Bahruz Şiraliyev",
            status: "limited",
            ownership: "external",
            collectionMode: "official_api",
            routePlans: [],
            collectorRuns: [],
          },
        },
        {
          relationType: "MONITORS",
          source: {
            id: "web-source",
            platform: "web",
            sourceType: "keyword",
            url: null,
            handle: null,
            query: "Bahruz Şiraliyev",
            status: "active",
            ownership: "external",
            collectionMode: "search_index",
            routePlans: [],
            collectorRuns: [],
          },
        },
      ],
    }
    findFirstSubject
      .mockResolvedValueOnce(bahruz)
      .mockResolvedValueOnce(repaired)
    getScenarios.mockResolvedValue([{ ...arazScenario, id: "scn-bahruz", subjectId: "subject-bahruz" }])
    updateScenario.mockResolvedValue({
      ...arazScenario,
      id: "scn-bahruz",
      subjectId: "subject-bahruz",
      platforms: ["instagram", "facebook", "tiktok", "youtube", "web"],
      search: {
        ...arazScenario.search,
        keywords: ["Bahruz Şiraliyev"],
        hashtags: [],
      },
    })

    const result = await resumeMonitoringProfile("org-1", "subject-bahruz", "user-1", {
      platforms: ["instagram", "facebook", "tiktok", "youtube", "web"],
    })

    expect(updateScenario).toHaveBeenCalledWith("org-1", "scn-bahruz", {
      status: "active",
      platforms: ["instagram", "facebook", "tiktok", "youtube", "web"],
    })
    // Web больше не покрывается каноническим прямым источником: решение
    // владельца 2026-08-01 — веб идёт ТОЛЬКО лентами Google Alerts, и сценарий
    // web-источник не создаёт (monitoring-scenarios: `continue` для web).
    // Ремонт покрытия поэтому возвращает лишь youtube.
    expect(result.sources.map(source => source.platform)).toEqual(["youtube"])
  })

  it("rejects a resume for a profile in another organization", async () => {
    findFirstSubject.mockResolvedValue(null)
    await expect(resumeMonitoringProfile("org-1", "subject-other", "user-1"))
      .rejects.toThrow("Monitoring profile not found")
  })
})

describe("profile lifecycle controls", () => {
  it("pauses the scenario collectors before marking the profile paused", async () => {
    getScenarios.mockResolvedValue([arazScenario])

    await setMonitoringProfileStatus("org-1", "subject-araz", "paused")

    expect(updateScenario).toHaveBeenCalledWith("org-1", "scn-araz", { status: "paused" })
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", { status: "paused" })
    expect(updateScenario.mock.invocationCallOrder[0]).toBeLessThan(updateSubject.mock.invocationCallOrder[0])
  })

  it("stops collection before archiving the profile", async () => {
    getScenarios.mockResolvedValue([arazScenario])

    await setMonitoringProfileStatus("org-1", "subject-araz", "archived")

    expect(updateScenario).toHaveBeenCalledWith("org-1", "scn-araz", { status: "paused" })
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-araz", { status: "archived" })
  })

  it("deletes an inert profile configuration but preserves its historical subject anchor", async () => {
    findFirstSubject.mockResolvedValue({ ...arazSubject, status: "archived" })
    getScenarios.mockResolvedValue([{ ...arazScenario, status: "paused" }])

    await deleteMonitoringProfile("org-1", "subject-araz")

    expect(deleteScenario).toHaveBeenCalledWith("org-1", "scn-araz", expect.any(Object))
    expect(deleteAliases).toHaveBeenCalledWith({ where: { organizationId: "org-1", subjectId: "subject-araz" } })
    expect(deleteSubjectSources).toHaveBeenCalledWith({ where: { organizationId: "org-1", subjectId: "subject-araz" } })
    expect(tombstoneSubject).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "deleted" }),
    }))
  })

  it("does not tombstone or strip a profile when scenario removal fails", async () => {
    findFirstSubject.mockResolvedValue({ ...arazSubject, status: "archived" })
    getScenarios.mockResolvedValue([{ ...arazScenario, status: "paused" }])
    deleteScenario.mockRejectedValueOnce(new Error("scenario write failed"))

    await expect(deleteMonitoringProfile("org-1", "subject-araz"))
      .rejects.toThrow("scenario write failed")

    expect(deleteAliases).not.toHaveBeenCalled()
    expect(deleteSubjectSources).not.toHaveBeenCalled()
    expect(deleteRelations).not.toHaveBeenCalled()
    expect(tombstoneSubject).not.toHaveBeenCalled()
  })

  it("refuses to delete a monitoring that is still collecting", async () => {
    getScenarios.mockResolvedValue([arazScenario])
    await expect(deleteMonitoringProfile("org-1", "subject-araz"))
      .rejects.toThrow("Stop monitoring before deleting it")
    expect(deleteScenario).not.toHaveBeenCalled()
    expect(tombstoneSubject).not.toHaveBeenCalled()
  })

  it("force-deletes a monitoring that is still collecting in one transaction", async () => {
    getScenarios.mockResolvedValue([arazScenario])

    await deleteMonitoringProfile("org-1", "subject-araz", { force: true })

    expect(deleteScenario).toHaveBeenCalledWith("org-1", "scn-araz", expect.any(Object))
    expect(tombstoneSubject).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "deleted" }),
    }))
  })
})
