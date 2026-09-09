import { describe, expect, it } from "vitest"
import {
  ContactDictionaryCreateSchema,
  ContactDictionaryEntriesSchema,
  contactDictionaryHash,
  contactDictionarySignatureIsCoherent,
} from "@/lib/mtm/contact-dictionary"

const entries = [
  { code: "B", order: 2, labels: { ru: "Б", az: "B", en: "B" } },
  { code: "A", order: 1, labels: { ru: "А", az: "A", en: "A" } },
]

describe("MTM contact dictionary contract", () => {
  it("hashes canonical entry order rather than request order", () => {
    expect(contactDictionaryHash(entries)).toBe(contactDictionaryHash([...entries].reverse()))
  })

  it("rejects duplicate codes and order positions", () => {
    expect(ContactDictionaryEntriesSchema.safeParse([
      entries[0],
      { ...entries[0], labels: { ru: "Дубль", az: "Dubl", en: "Duplicate" } },
    ]).success).toBe(false)
  })

  it("accepts only explicit supported kinds and source evidence", () => {
    expect(ContactDictionaryCreateSchema.safeParse({
      kind: "PSYCHOTYPE",
      version: 1,
      nameRu: "Психотип",
      nameAz: "Psixotip",
      nameEn: "Psychotype",
      entries,
      sourceSystem: "SwissMed master data",
      sourceObservedAt: "2026-08-08T10:00:00.000Z",
      effectiveFrom: "2026-08-08",
    }).success).toBe(true)
    expect(ContactDictionaryCreateSchema.safeParse({
      kind: "CONTACT_CATEGORY",
      version: 1,
      entries,
    }).success).toBe(false)
  })

  it("recognizes only complete signed lifecycle states", () => {
    const active = {
      status: "ACTIVE",
      approvalReference: "SWM-03 approval",
      signedByUserId: "admin-1",
      signedAt: new Date(),
      activatedAt: new Date(),
      retiredAt: null,
    }
    expect(contactDictionarySignatureIsCoherent(active)).toBe(true)
    expect(contactDictionarySignatureIsCoherent({ ...active, approvalReference: null })).toBe(false)
  })
})
