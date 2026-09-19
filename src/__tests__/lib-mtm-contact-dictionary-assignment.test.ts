import { describe, expect, it, vi } from "vitest"
import { contactDictionaryHash, type ContactDictionaryEntry } from "@/lib/mtm/contact-dictionary"
import {
  applyContactDictionaryAssignmentSet,
  contactDictionaryAssignmentStateHash,
  verifiedContactDictionaryEntries,
} from "@/lib/mtm/contact-dictionary-assignment"

const NOW = new Date("2026-08-09T12:00:00.000Z")
const entries: ContactDictionaryEntry[] = [
  { code: "CALM", order: 1, labels: { ru: "Спокойный", az: "Sakit", en: "Calm" } },
]

function dictionary(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm000000000000000000101",
    organizationId: "org-1",
    kind: "PSYCHOTYPE",
    status: "ACTIVE",
    entries,
    entriesHash: contactDictionaryHash(entries),
    approvalReference: "MED-2026-17",
    signedByUserId: "user-1",
    signedAt: NOW,
    activatedAt: NOW,
    retiredAt: null,
    ...overrides,
  }
}

describe("SWM03 governed contact category assignments", () => {
  it("accepts entries only when the signed dictionary hash is coherent", () => {
    expect(verifiedContactDictionaryEntries(dictionary() as never)).toEqual(entries)
    expect(verifiedContactDictionaryEntries(dictionary({ entriesHash: "0".repeat(64) }) as never)).toBeNull()
    expect(verifiedContactDictionaryEntries(dictionary({ signedAt: null }) as never)).toBeNull()
  })

  it("hashes the active assignment state deterministically", () => {
    const row = {
      id: "assignment-1",
      dictionaryId: "dictionary-1",
      kind: "PSYCHOTYPE",
      entryCode: "CALM",
      effectiveFrom: NOW,
      effectiveTo: null,
      updatedAt: NOW,
    }
    expect(contactDictionaryAssignmentStateHash([row])).toBe(contactDictionaryAssignmentStateHash([{ ...row }]))
    expect(contactDictionaryAssignmentStateHash([{ ...row, effectiveTo: new Date("2026-08-10T00:00:00.000Z") }])).toBe(
      contactDictionaryAssignmentStateHash([]),
    )
  })

  it("replaces the active state under a lock and binds new rows to the exact dictionary", async () => {
    const emptyHash = contactDictionaryAssignmentStateHash([])
    const createdRow = {
      id: "assignment-2",
      dictionaryId: "cm000000000000000000101",
      kind: "PSYCHOTYPE",
      entryCode: "CALM",
      effectiveFrom: NOW,
      effectiveTo: null,
      updatedAt: NOW,
    }
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mtmContact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      mtmContactDictionary: { findMany: vi.fn().mockResolvedValue([dictionary()]) },
      mtmContactDictionaryAssignment: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([createdRow]),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    const result = await applyContactDictionaryAssignmentSet(client as never, {
      organizationId: "org-1",
      contactId: "cm000000000000000000001",
      input: {
        expectedStateHash: emptyHash,
        reason: "Verified by manager",
        psychotype: { dictionaryId: dictionary().id, code: "CALM" },
        productCategories: null,
        brandCategories: null,
      },
      source: "ADMIN",
      createdByUserId: "user-1",
      approvedByUserId: "user-1",
      now: NOW,
    })

    expect(result).toMatchObject({ ended: 0, created: 1 })
    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
    expect(client.mtmContactDictionaryAssignment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        dictionaryId: dictionary().id,
        kind: "PSYCHOTYPE",
        entryCode: "CALM",
        effectiveFrom: NOW,
      })],
    })
    expect(client.mtmContact.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "cm000000000000000000001", deletedAt: null },
      data: { categoryData: {} },
    })
  })

  it("stores only fields governed by the selected client type", async () => {
    const clientTypeEntries: ContactDictionaryEntry[] = [{
      code: "DOCTOR",
      order: 1,
      labels: { ru: "Врач", az: "Həkim", en: "Doctor" },
      fields: [{
        key: "specialty",
        order: 1,
        type: "TEXT",
        required: true,
        labels: { ru: "Специальность", az: "İxtisas", en: "Specialty" },
      }],
    }]
    const clientTypeDictionary = dictionary({
      id: "cm000000000000000000202",
      kind: "CLIENT_TYPE",
      entries: clientTypeEntries,
      entriesHash: contactDictionaryHash(clientTypeEntries),
    })
    const emptyHash = contactDictionaryAssignmentStateHash([])
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mtmContact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      mtmContactDictionary: { findMany: vi.fn().mockResolvedValue([clientTypeDictionary]) },
      mtmContactDictionaryAssignment: {
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    await applyContactDictionaryAssignmentSet(client as never, {
      organizationId: "org-1",
      contactId: "cm000000000000000000001",
      input: {
        expectedStateHash: emptyHash,
        reason: "Set doctor category",
        clientType: { dictionaryId: clientTypeDictionary.id, code: "DOCTOR", values: { specialty: "Cardiology" } },
        psychotype: null,
        productCategories: null,
        brandCategories: null,
      },
      source: "ADMIN",
    })

    expect(client.mtmContact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { categoryData: { specialty: "Cardiology" } },
    }))
  })

  it("fails closed when the state changed before save", async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mtmContactDictionary: { findMany: vi.fn() },
      mtmContactDictionaryAssignment: {
        findMany: vi.fn().mockResolvedValue([{
          id: "assignment-1",
          dictionaryId: dictionary().id,
          kind: "PSYCHOTYPE",
          entryCode: "CALM",
          effectiveFrom: NOW,
          effectiveTo: null,
          updatedAt: NOW,
        }]),
      },
    }

    await expect(applyContactDictionaryAssignmentSet(client as never, {
      organizationId: "org-1",
      contactId: "cm000000000000000000001",
      input: {
        expectedStateHash: contactDictionaryAssignmentStateHash([]),
        reason: "Outdated form",
        psychotype: null,
        productCategories: null,
        brandCategories: null,
      },
      source: "ADMIN",
    })).rejects.toMatchObject({
      code: "MTM_CONTACT_DICTIONARY_ASSIGNMENT_CONFLICT",
    })
  })
})
