import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST as CREATE_DICTIONARY } from "@/app/api/v1/mtm/contact-dictionaries/route"
import { POST as ACTIVATE_DICTIONARY } from "@/app/api/v1/mtm/contact-dictionaries/[id]/activate/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactDictionaryHash } from "@/lib/mtm/contact-dictionary"
import { prisma } from "@/lib/prisma"

const entries = [{
  code: "ANALYTICAL",
  order: 1,
  labels: { ru: "Аналитический", az: "Analitik", en: "Analytical" },
}]

function dictionary(overrides: Record<string, unknown> = {}) {
  return {
    id: "dictionary-1",
    organizationId: "org-1",
    kind: "PSYCHOTYPE",
    version: 1,
    nameRu: "Психотип",
    nameAz: "Psixotip",
    nameEn: "Psychotype",
    schemaVersion: 1,
    entries,
    entriesHash: contactDictionaryHash(entries),
    approvalReference: null,
    sourceSystem: "SwissMed master data",
    sourceReference: "SWM03-DICT-1",
    sourceObservedAt: new Date("2026-08-08T08:00:00Z"),
    effectiveFrom: new Date("2026-08-08T00:00:00Z"),
    status: "DRAFT",
    createdByUserId: "admin-user",
    signedByUserId: null,
    signedAt: null,
    activatedAt: null,
    retiredAt: null,
    createdAt: new Date("2026-08-08T08:00:00Z"),
    updatedAt: new Date("2026-08-08T08:00:00Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
})

describe("MTM contact dictionary configuration", () => {
  it("creates an immutable draft with a server-computed hash", async () => {
    const draft = dictionary()
    vi.mocked(prisma.mtmContactDictionary.create).mockResolvedValue(draft as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
    const response = await CREATE_DICTIONARY(new NextRequest("http://localhost:3000/api/v1/mtm/contact-dictionaries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "PSYCHOTYPE",
        version: 1,
        nameRu: "Психотип",
        nameAz: "Psixotip",
        nameEn: "Psychotype",
        entries,
        sourceSystem: "SwissMed master data",
        sourceReference: "SWM03-DICT-1",
        sourceObservedAt: "2026-08-08T08:00:00.000Z",
        effectiveFrom: "2026-08-08",
      }),
    }))
    expect(response.status).toBe(201)
    expect(prisma.mtmContactDictionary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", entriesHash: contactDictionaryHash(entries) }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("retires only the previous active version of the same kind", async () => {
    const draft = dictionary()
    const signedAt = new Date("2026-08-08T10:00:00Z")
    const active = dictionary({
      status: "ACTIVE",
      approvalReference: "SwissMed approval SWM03-DICT-1",
      signedByUserId: "admin-user",
      signedAt,
      activatedAt: signedAt,
    })
    vi.mocked(prisma.mtmContactDictionary.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce({ id: "dictionary-old", version: 0 } as never)
      .mockResolvedValueOnce(active as never)
    vi.mocked(prisma.mtmContactDictionary.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
    const response = await ACTIVATE_DICTIONARY(new NextRequest("http://localhost:3000/api/v1/mtm/contact-dictionaries/dictionary-1/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedEntriesHash: draft.entriesHash,
        approvalReference: "SwissMed approval SWM03-DICT-1",
      }),
    }), { params: Promise.resolve({ id: "dictionary-1" }) })
    expect(response.status).toBe(200)
    expect(prisma.mtmContactDictionary.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ kind: "PSYCHOTYPE", status: "ACTIVE" }),
      data: expect.objectContaining({ status: "RETIRED" }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("fails closed when persisted entries no longer match their hash", async () => {
    const draft = dictionary({ entries: [{ ...entries[0], labels: { ...entries[0].labels, en: "Changed" } }] })
    vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValueOnce(draft as never)
    const response = await ACTIVATE_DICTIONARY(new NextRequest("http://localhost:3000/api/v1/mtm/contact-dictionaries/dictionary-1/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedEntriesHash: draft.entriesHash,
        approvalReference: "SwissMed approval SWM03-DICT-1",
      }),
    }), { params: Promise.resolve({ id: "dictionary-1" }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_DICTIONARY_SIGNATURE_INCOHERENT" })
    expect(prisma.mtmContactDictionary.updateMany).not.toHaveBeenCalled()
  })
})
