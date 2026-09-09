import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { listSubjects, createSubject, updateSubject, archiveSubject, logAudit } = vi.hoisted(() => ({
  listSubjects: vi.fn(),
  createSubject: vi.fn(),
  updateSubject: vi.fn(),
  archiveSubject: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { orgId: "org-1", userId: "user-1" }, context),
}))

vi.mock("@/lib/prisma", () => ({ logAudit }))
vi.mock("@/lib/social/monitoring-subjects", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-subjects")>()
  return {
    ...original,
    listMonitoringSubjects: listSubjects,
    createMonitoringSubject: createSubject,
    updateMonitoringSubject: updateSubject,
    archiveMonitoringSubject: archiveSubject,
  }
})

import { GET, POST } from "@/app/api/v1/social/monitoring-subjects/route"
import { DELETE, PATCH } from "@/app/api/v1/social/monitoring-subjects/[id]/route"

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/monitoring-subjects", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: "subject-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  listSubjects.mockResolvedValue([])
  createSubject.mockResolvedValue({ id: "subject-1", name: "LeadDrive", type: "BRAND", status: "active" })
  updateSubject.mockResolvedValue({ id: "subject-1", name: "LeadDrive CRM", type: "BRAND", status: "active" })
  archiveSubject.mockResolvedValue(undefined)
})

describe("monitoring subjects API", () => {
  it("returns subject counts by active, brand and person", async () => {
    listSubjects.mockResolvedValue([
      { id: "b", type: "BRAND", status: "active" },
      { id: "p", type: "PERSON", status: "paused" },
    ])
    const response = await GET(request("GET"))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { stats: { total: 2, active: 1, brands: 1, people: 1 } },
    })
  })

  it("creates a subject while stripping deprecated source mappings", async () => {
    const response = await POST(request("POST", {
      type: "BRAND",
      name: "LeadDrive",
      aliases: [{ kind: "HANDLE", value: "@leaddrive" }],
      requiredContext: ["CRM"],
      exclusions: ["driving school"],
      sourceIds: ["source-1"],
      replyIdentities: [{ socialAccountId: "account-1", allowOwnedReply: true, allowExternalReply: false }],
      relations: [{ relatedSubjectId: "company-1", relationType: "BRAND_OF", weight: 0.9 }],
    }))

    expect(response.status).toBe(201)
    expect(createSubject).toHaveBeenCalledWith("org-1", "user-1", expect.objectContaining({
      type: "BRAND",
      name: "LeadDrive",
      relations: [{ relatedSubjectId: "company-1", relationType: "BRAND_OF", weight: 0.9 }],
    }))
    expect(createSubject.mock.calls[0]?.[2]).not.toHaveProperty("sourceIds")
    expect(logAudit).toHaveBeenCalledWith("org-1", "create", "monitoring_subject", "subject-1", "LeadDrive")
  })

  it("rejects invalid types before persistence", async () => {
    const response = await POST(request("POST", { type: "UNKNOWN", name: "Bad" }))
    expect(response.status).toBe(400)
    expect(createSubject).not.toHaveBeenCalled()
  })

  it("rejects unknown relationship types before persistence", async () => {
    const response = await POST(request("POST", {
      type: "BRAND",
      name: "LeadDrive",
      relations: [{ relatedSubjectId: "company-1", relationType: "OWNS" }],
    }))
    expect(response.status).toBe(400)
    expect(createSubject).not.toHaveBeenCalled()
  })

  it("updates and archives only within the authenticated tenant service boundary", async () => {
    const patchResponse = await PATCH(request("PATCH", {
      name: "LeadDrive CRM",
      sourceIds: ["legacy-source"],
    }), context)
    expect(patchResponse.status).toBe(200)
    expect(updateSubject).toHaveBeenCalledWith("org-1", "subject-1", { name: "LeadDrive CRM" })

    const deleteResponse = await DELETE(request("DELETE"), context)
    expect(deleteResponse.status).toBe(200)
    expect(archiveSubject).toHaveBeenCalledWith("org-1", "subject-1")
  })
})
