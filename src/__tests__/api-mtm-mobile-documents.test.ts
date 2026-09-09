import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as listDocuments } from "@/app/api/v1/mtm/mobile/documents/route"
import { GET as downloadDocument } from "@/app/api/v1/mtm/mobile/documents/[documentId]/download/route"
import { POST as uploadDocument } from "@/app/api/v1/mtm/mobile/documents/upload/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { _resetPublicAbuseGuardForTests } from "@/lib/public-abuse-guard"

function request(path = "/api/v1/mtm/mobile/documents") {
  return new NextRequest(`http://localhost${path}`, { headers: { Authorization: "Bearer mobile" } })
}

describe("MTM mobile documents API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetPublicAbuseGuardForTests()
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: "org-1",
      agentId: "agent-1",
      userId: "user-1",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
    } as never)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "route-field": true },
    } as never)
    vi.mocked(prisma.mtmDocumentAssignment.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)
  })

  it("loads only active assignments for the authenticated agent", async () => {
    const response = await listDocuments(request())
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmDocumentAssignment.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      organizationId: "org-1",
      agentId: "agent-1",
      document: { deletedAt: null },
    })
    expect(args.where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gte: expect.any(Date) } }])
  })

  it("returns assignment state and an authenticated download URL", async () => {
    vi.mocked(prisma.mtmDocumentAssignment.findMany).mockResolvedValue([{
      id: "assignment-1",
      required: true,
      assignedAt: new Date("2026-07-16T08:00:00.000Z"),
      expiresAt: null,
      readAt: null,
      downloadedAt: null,
      document: {
        id: "document-1",
        clientDocumentId: null,
        title: "Product brief",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1200,
        checksumSha256: "a".repeat(64),
        uploadedByAgentId: null,
        visitId: null,
        taskId: null,
        createdAt: new Date("2026-07-16T08:00:00.000Z"),
        visit: null,
        task: null,
      },
    }] as never)
    const body = await (await listDocuments(request())).json()
    expect(body.data.documents[0]).toMatchObject({
      id: "document-1",
      assignment: { required: true, readAt: null },
      downloadUrl: "/api/v1/mtm/mobile/documents/document-1/download",
    })
  })

  it("masks downloads when the document is not assigned or shared", async () => {
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue(null)
    const response = await downloadDocument(request("/api/v1/mtm/mobile/documents/document-other/download"), {
      params: Promise.resolve({ documentId: "document-other" }),
    })
    expect(response.status).toBe(404)
    const args = vi.mocked(prisma.mtmDocument.findFirst).mock.calls[0][0] as any
    expect(args.where).toMatchObject({ id: "document-other", organizationId: "org-1", deletedAt: null })
  })

  it("replays a durable upload id without writing a second document", async () => {
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue({
      id: "document-1",
      clientDocumentId: "document-client-1",
      title: "Brief",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      checksumSha256: "38523c087796e5d5dd1cf9bad1fb026781a838dd9dd2cf8af58b9f6502a46778",
      visitId: null,
      taskId: null,
      createdAt: new Date("2026-07-16T08:00:00.000Z"),
    } as never)
    const form = new FormData()
    form.set("file", new File(["%PDF-"], "brief.pdf", { type: "application/pdf" }))
    form.set("clientDocumentId", "document-client-1")
    form.set("title", "Brief")
    const response = await uploadDocument(new NextRequest("http://localhost/api/v1/mtm/mobile/documents/upload", {
      method: "POST",
      headers: { Authorization: "Bearer mobile" },
      body: form,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true, data: { id: "document-1" } })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
  })

  it("rejects a reused document id when the bytes differ", async () => {
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue({
      id: "document-1",
      clientDocumentId: "document-client-1",
      title: "Brief",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      checksumSha256: "38523c087796e5d5dd1cf9bad1fb026781a838dd9dd2cf8af58b9f6502a46778",
      visitId: null,
      taskId: null,
      createdAt: new Date("2026-07-16T08:00:00.000Z"),
    } as never)
    const form = new FormData()
    form.set("file", new File(["%PDF-x"], "brief.pdf", { type: "application/pdf" }))
    form.set("clientDocumentId", "document-client-1")
    form.set("title", "Brief")

    const response = await uploadDocument(new NextRequest("http://localhost/api/v1/mtm/mobile/documents/upload", {
      method: "POST",
      headers: { Authorization: "Bearer mobile" },
      body: form,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_DOCUMENT_ID_CONFLICT" })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
  })

  it("does not let an enrolled agent omit its device header and fall back to the legacy document upload path", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T13:00:00.000Z"),
    } as never)
    const form = new FormData()
    form.set("file", new File(["test"], "brief.pdf", { type: "application/pdf" }))
    form.set("clientDocumentId", "document-client-1")

    const response = await uploadDocument(new NextRequest("http://localhost/api/v1/mtm/mobile/documents/upload", {
      method: "POST",
      headers: { Authorization: "Bearer mobile" },
      body: form,
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_MEDIA_DEVICE_COHORT_REQUIRED" })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
  })
})
