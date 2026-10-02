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

import { GET, PUT } from "@/app/api/v1/mtm/contact-categories/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  ContactDictionaryEntriesSchema,
  contactDictionaryHash,
  contactDictionarySignatureIsCoherent,
} from "@/lib/mtm/contact-dictionary"
import { verifiedContactDictionaryEntries } from "@/lib/mtm/contact-dictionary-assignment"
import { defaultContactCategories, normalizeContactCategories } from "@/lib/mtm/contact-category-editor"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"

/** What the settings editor sends after "add a patient-count field to doctors". */
function categoriesWithPatientCount() {
  const categories = defaultContactCategories()
  categories[0].fields = [{
    key: "xeste_sayi",
    order: 1,
    type: "NUMBER",
    required: false,
    labels: { ru: "Xəstə sayı", az: "Xəstə sayı", en: "Xəstə sayı" },
  }]
  return normalizeContactCategories(categories, "az")
}

function activeDictionary(entries: unknown[], overrides: Record<string, unknown> = {}) {
  const signedAt = new Date("2026-10-01T09:00:00Z")
  return {
    id: "dictionary-active",
    organizationId: ORG,
    kind: "CLIENT_TYPE",
    version: 3,
    nameRu: "Категории клиентов",
    nameAz: "Müştəri kateqoriyaları",
    nameEn: "Client categories",
    schemaVersion: 1,
    entries,
    entriesHash: contactDictionaryHash(ContactDictionaryEntriesSchema.parse(entries)),
    approvalReference: "Module settings",
    sourceSystem: "LeadDrive settings",
    sourceReference: null,
    sourceObservedAt: signedAt,
    effectiveFrom: new Date("2026-10-01T00:00:00Z"),
    status: "ACTIVE",
    createdByUserId: "admin-user",
    signedByUserId: "admin-user",
    signedAt,
    activatedAt: signedAt,
    retiredAt: null,
    createdAt: signedAt,
    updatedAt: signedAt,
    ...overrides,
  }
}

function put(body: unknown): Promise<Response> {
  return PUT(new NextRequest("http://localhost:3000/api/v1/mtm/contact-categories", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

function get(): Promise<Response> {
  return GET(new NextRequest("http://localhost:3000/api/v1/mtm/contact-categories"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-02T11:35:00.000Z"))
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactDictionary.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmContactDictionary.create).mockImplementation((async (args: { data: Record<string, unknown> }) => ({
    id: "dictionary-new",
    ...args.data,
    retiredAt: null,
  })) as never)
  vi.mocked(prisma.mtmContactDictionaryAssignment.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmContact.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("MTM client categories: reading", () => {
  it("gives a tenant that configured nothing the three built-in types", async () => {
    const response = await get()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.dictionaryId).toBeNull()
    expect(body.data.configured).toBe(false)
    expect(body.data.categories.map((category: { code: string }) => category.code))
      .toEqual(["DOCTOR", "PHARMACIST", "OTHER"])
    expect(body.data.capabilities.canConfigure).toBe(true)
  })

  it("counts contacts under their assigned category, or their built-in type when never assigned", async () => {
    vi.mocked(prisma.mtmContactDictionaryAssignment.groupBy).mockResolvedValue([
      { entryCode: "DOCTOR", _count: { _all: 2 } },
      { entryCode: "TIBB_BACISI", _count: { _all: 5 } },
    ] as never)
    vi.mocked(prisma.mtmContact.groupBy).mockResolvedValue([
      { type: "DOCTOR", _count: { _all: 40 } },
      { type: "PHARMACIST", _count: { _all: 7 } },
    ] as never)
    const body = await (await get()).json()
    expect(body.data.usage).toEqual({ DOCTOR: 42, TIBB_BACISI: 5, PHARMACIST: 7 })
  })

  it("lets a field agent read the categories but hides tenant-wide counts and editing", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: new Set(["agent-1"]) } as never)
    vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(activeDictionary(categoriesWithPatientCount()) as never)
    const body = await (await get()).json()
    expect(body.data.categories[0].fields[0].key).toBe("xeste_sayi")
    expect(body.data.usage).toBeNull()
    expect(body.data.capabilities.canConfigure).toBe(false)
    expect(prisma.mtmContact.groupBy).not.toHaveBeenCalled()
  })
})

describe("MTM client categories: saving", () => {
  it("activates the first version in one step, with a signature the rest of the system accepts", async () => {
    const categories = categoriesWithPatientCount()
    const response = await put({ expectedDictionaryId: null, categories })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ dictionaryId: "dictionary-new", version: 1, changed: true })
    expect(prisma.mtmContactDictionary.updateMany).not.toHaveBeenCalled()

    const created = vi.mocked(prisma.mtmContactDictionary.create).mock.calls[0][0].data as Record<string, unknown>
    expect(created).toMatchObject({
      organizationId: ORG,
      kind: "CLIENT_TYPE",
      version: 1,
      status: "ACTIVE",
      signedByUserId: "admin-user",
      // 11:35 UTC is still 2 October in the tenant's default timezone.
      effectiveFrom: new Date("2026-10-02T00:00:00.000Z"),
    })
    // The contact form, the contact card and mobile sync all refuse a
    // dictionary whose signature or hash does not hold — the row written here
    // must pass that very check, not a look-alike of it.
    const row = { id: "dictionary-new", retiredAt: null, ...created } as never
    expect(contactDictionarySignatureIsCoherent(row)).toBe(true)
    expect(verifiedContactDictionaryEntries(row, { requireActive: true })?.[0].fields?.[0]).toMatchObject({
      key: "xeste_sayi",
      type: "NUMBER",
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("retires the previous version before the new one becomes active", async () => {
    const previous = activeDictionary(defaultContactCategories())
    vi.mocked(prisma.mtmContactDictionary.findFirst)
      .mockResolvedValueOnce(previous as never)
      .mockResolvedValueOnce({ version: 3 } as never)

    const response = await put({ expectedDictionaryId: "dictionary-active", categories: categoriesWithPatientCount() })

    expect(response.status).toBe(200)
    expect(prisma.mtmContactDictionary.updateMany).toHaveBeenCalledWith({
      where: { id: "dictionary-active", organizationId: ORG, status: "ACTIVE" },
      data: { status: "RETIRED", retiredAt: new Date("2026-10-02T11:35:00.000Z") },
    })
    expect(vi.mocked(prisma.mtmContactDictionary.updateMany).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmContactDictionary.create).mock.invocationCallOrder[0])
    expect(vi.mocked(prisma.mtmContactDictionary.create).mock.calls[0][0].data).toMatchObject({ version: 4, status: "ACTIVE" })
  })

  it("writes nothing when the categories are unchanged", async () => {
    const categories = categoriesWithPatientCount()
    vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(activeDictionary(categories) as never)
    const response = await put({ expectedDictionaryId: "dictionary-active", categories })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ dictionaryId: "dictionary-active", changed: false })
    expect(prisma.mtmContactDictionary.create).not.toHaveBeenCalled()
    expect(prisma.mtmContactDictionary.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a save made on top of categories someone else has already changed", async () => {
    vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(activeDictionary(defaultContactCategories()) as never)
    const response = await put({ expectedDictionaryId: "dictionary-older", categories: categoriesWithPatientCount() })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_CONTACT_CATEGORIES_STALE")
    expect(prisma.mtmContactDictionary.create).not.toHaveBeenCalled()
  })

  it("refuses to remove a category that still has contacts, and says how many", async () => {
    vi.mocked(prisma.mtmContact.groupBy).mockResolvedValue([{ type: "PHARMACIST", _count: { _all: 7 } }] as never)
    const categories = categoriesWithPatientCount().filter((category) => category.code !== "PHARMACIST")
      .map((category, index) => ({ ...category, order: index + 1 }))
    const response = await put({ expectedDictionaryId: null, categories })
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe("MTM_CONTACT_CATEGORY_IN_USE")
    expect(body.data.inUse).toEqual([{ code: "PHARMACIST", contacts: 7 }])
    expect(prisma.mtmContactDictionary.create).not.toHaveBeenCalled()
  })

  it("allows removing a category nobody is in", async () => {
    const categories = categoriesWithPatientCount().filter((category) => category.code !== "PHARMACIST")
      .map((category, index) => ({ ...category, order: index + 1 }))
    const response = await put({ expectedDictionaryId: null, categories })
    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.mtmContactDictionary.create).mock.calls[0][0].data.entries)
      .toEqual(categories)
  })

  it("rejects a list field without options and two fields sharing a key", async () => {
    const noOptions = defaultContactCategories()
    noOptions[0].fields = [{ key: "level", order: 1, type: "SELECT", required: false, labels: { ru: "У", az: "S", en: "L" } }]
    expect((await put({ expectedDictionaryId: null, categories: noOptions })).status).toBe(400)

    const duplicateKey = categoriesWithPatientCount()
    duplicateKey[0].fields = [duplicateKey[0].fields![0], { ...duplicateKey[0].fields![0], order: 2 }]
    expect((await put({ expectedDictionaryId: null, categories: duplicateKey })).status).toBe(400)
    expect(prisma.mtmContactDictionary.create).not.toHaveBeenCalled()
  })

  it("is closed to a field agent", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: new Set(["agent-1"]) } as never)
    const response = await put({ expectedDictionaryId: null, categories: categoriesWithPatientCount() })
    expect(response.status).toBe(403)
    expect(prisma.mtmContactDictionary.create).not.toHaveBeenCalled()
  })
})
