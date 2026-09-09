import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

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

import { PUT as replaceAssignments } from "@/app/api/v1/mtm/contacts/[id]/dictionary-assignments/route"
import { POST as submitChange } from "@/app/api/v1/mtm/contacts/[id]/change-requests/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { contactDictionaryHash } from "@/lib/mtm/contact-dictionary"
import { contactDictionaryAssignmentStateHash } from "@/lib/mtm/contact-dictionary-assignment"

const ORG = "org-1"
const CONTACT_ID = "cm000000000000000000001"
const AGENT_ID = "cm000000000000000000002"
const MANAGER_ID = "cm000000000000000000003"
const DICTIONARY_ID = "cm000000000000000000004"
const UPDATED_AT = new Date("2026-08-09T10:00:00.000Z")
const NOW = new Date("2026-08-09T11:00:00.000Z")
const entries = [{ code: "CALM", order: 1, labels: { ru: "Спокойный", az: "Sakit", en: "Calm" } }]
const emptyHash = contactDictionaryAssignmentStateHash([])

const ADMIN_AUTH: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const AGENT_AUTH: AuthResult = { orgId: ORG, userId: "agent-user", role: "sales", email: "agent@example.com", name: "Agent" }

function dictionary() {
  return {
    id: DICTIONARY_ID,
    organizationId: ORG,
    kind: "PSYCHOTYPE",
    version: 3,
    status: "ACTIVE",
    entries,
    entriesHash: contactDictionaryHash(entries),
    approvalReference: "SWISSMED-MD-2026-03",
    signedByUserId: "admin-user",
    signedAt: NOW,
    activatedAt: NOW,
    retiredAt: null,
  }
}

function request(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function payload() {
  return {
    expectedStateHash: emptyHash,
    reason: "Confirmed against the approved directory",
    psychotype: { dictionaryId: DICTIONARY_ID, code: "CALM" },
    productCategories: null,
    brandCategories: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("SWM03 contact dictionary assignment API", () => {
  it("lets a manager replace the governed state against an exact signed version", async () => {
    const created = {
      id: "assignment-1",
      dictionaryId: DICTIONARY_ID,
      kind: "PSYCHOTYPE",
      entryCode: "CALM",
      effectiveFrom: NOW,
      effectiveTo: null,
      updatedAt: NOW,
    }
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT_ID, updatedAt: UPDATED_AT } as never)
    vi.mocked(prisma.mtmContactDictionaryAssignment.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created] as never)
    vi.mocked(prisma.mtmContactDictionary.findMany).mockResolvedValue([dictionary()] as never)
    vi.mocked(prisma.mtmContactDictionaryAssignment.createMany).mockResolvedValue({ count: 1 } as never)

    const response = await replaceAssignments(
      request(`/api/v1/mtm/contacts/${CONTACT_ID}/dictionary-assignments`, "PUT", {
        ...payload(),
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { ended: 0, created: 1 } })
    expect(prisma.mtmContactDictionaryAssignment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ dictionaryId: DICTIONARY_ID, entryCode: "CALM", kind: "PSYCHOTYPE" })],
    })
  })

  it("keeps an agent proposal pending and does not write assignment facts", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst)
      .mockResolvedValueOnce({ id: AGENT_ID, role: "AGENT" } as never)
      .mockResolvedValueOnce({ id: AGENT_ID, name: "Field Agent", managerId: MANAGER_ID } as never)
    vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      displayName: "Doctor One",
      updatedAt: UPDATED_AT,
    } as never)
    vi.mocked(prisma.mtmContactDictionaryAssignment.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmContactDictionary.findMany).mockResolvedValue([dictionary()] as never)
    vi.mocked(prisma.mtmContactChangeRequest.create).mockResolvedValue({
      id: "request-1",
      kind: "DICTIONARY_ASSIGNMENTS",
      status: "SUBMITTED",
    } as never)
    vi.mocked(prisma.mtmNotification.create).mockResolvedValue({ id: "notification-1" } as never)

    const response = await submitChange(
      request(`/api/v1/mtm/contacts/${CONTACT_ID}/change-requests`, "POST", {
        idempotencyKey: "contact-dictionary-op-0001",
        reason: payload().reason,
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        kind: "DICTIONARY_ASSIGNMENTS",
        payload: payload(),
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmContactDictionaryAssignment.createMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "DICTIONARY_ASSIGNMENTS", payload: payload() }),
    }))
  })
})
