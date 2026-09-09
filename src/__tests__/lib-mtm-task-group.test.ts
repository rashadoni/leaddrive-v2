import { describe, expect, it, vi } from "vitest"

import { contactDictionaryHash, type ContactDictionaryEntry } from "@/lib/mtm/contact-dictionary"
import {
  activeMtmTaskGroupCatalog,
  MtmTaskGroupError,
  parseMtmTaskGroupCatalog,
  resolveMtmTaskGroupSelection,
  storedMtmTaskGroup,
} from "@/lib/mtm/task-group"

const entries: ContactDictionaryEntry[] = [
  { code: "CYCLE_MEETING", order: 20, labels: { ru: "Цикловое совещание", az: "Sikl görüşü", en: "Cycle meeting" } },
  { code: "FIELD_VISIT", order: 10, labels: { ru: "Полевой визит", az: "Sahə ziyarəti", en: "Field visit" } },
]

function dictionary(overrides: Record<string, unknown> = {}) {
  return {
    id: "dictionary-1",
    version: 3,
    status: "ACTIVE",
    entries,
    entriesHash: contactDictionaryHash(entries),
    approvalReference: "SWISSMED-APPROVAL-42",
    signedByUserId: "user-admin",
    signedAt: new Date("2026-08-09T10:00:00.000Z"),
    activatedAt: new Date("2026-08-09T10:00:00.000Z"),
    retiredAt: null,
    ...overrides,
  }
}

describe("governed MTM task groups", () => {
  it("orders verified signed entries and pins their dictionary version", () => {
    expect(parseMtmTaskGroupCatalog(dictionary())).toEqual({
      dictionaryId: "dictionary-1",
      dictionaryVersion: 3,
      entries: [
        expect.objectContaining({ code: "FIELD_VISIT", dictionaryId: "dictionary-1", dictionaryVersion: 3 }),
        expect.objectContaining({ code: "CYCLE_MEETING", dictionaryId: "dictionary-1", dictionaryVersion: 3 }),
      ],
    })
  })

  it("fails closed when signed entries do not match their hash", () => {
    expect(parseMtmTaskGroupCatalog(dictionary({ entriesHash: "0".repeat(64) }))).toBeNull()
  })

  it("keeps a retired historical group readable", () => {
    expect(storedMtmTaskGroup(dictionary({
      status: "RETIRED",
      retiredAt: new Date("2026-08-10T10:00:00.000Z"),
    }), "FIELD_VISIT")).toEqual(expect.objectContaining({ code: "FIELD_VISIT", dictionaryVersion: 3 }))
  })

  it("rejects a code absent from the active signed catalog", async () => {
    const client = { mtmContactDictionary: { findMany: vi.fn().mockResolvedValue([dictionary()]) } }
    await expect(resolveMtmTaskGroupSelection(client as never, "org-1", "UNKNOWN"))
      .rejects.toMatchObject({ code: "MTM_TASK_GROUP_NOT_FOUND" } satisfies Partial<MtmTaskGroupError>)
  })

  it("reports an unavailable catalog without inventing groups", async () => {
    const client = { mtmContactDictionary: { findMany: vi.fn().mockResolvedValue([]) } }
    await expect(resolveMtmTaskGroupSelection(client as never, "org-1", "FIELD_VISIT"))
      .rejects.toMatchObject({ code: "MTM_TASK_GROUP_CATALOG_UNAVAILABLE" } satisfies Partial<MtmTaskGroupError>)
    await expect(activeMtmTaskGroupCatalog(client as never, "org-1")).resolves.toBeNull()
  })
})
