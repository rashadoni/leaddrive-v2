import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const {
  listProfiles, createOrUpdateProfile, findCandidates, resumeProfile, setStatus, deleteProfile, logAudit,
  collectionFenceBlocked,
} = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  createOrUpdateProfile: vi.fn(),
  findCandidates: vi.fn(),
  resumeProfile: vi.fn(),
  setStatus: vi.fn(),
  deleteProfile: vi.fn(),
  logAudit: vi.fn(),
  collectionFenceBlocked: vi.fn(() => false),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { orgId: "org-1", userId: "user-1" }, context),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (
    _module: string,
    _action: string,
    handler: (...args: unknown[]) => unknown,
  ) => (req: NextRequest, context?: unknown) => (
    collectionFenceBlocked()
      ? NextResponse.json(
          {
            error: "Social Monitoring is paused for a clean-slate reset",
            code: "social_monitoring_collection_blocked",
          },
          { status: 409 },
        )
      : handler(req, { orgId: "org-1", userId: "user-1" }, context)
  ),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit }))
vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>()
  return { ...original, getMonitoringScenarios: vi.fn().mockResolvedValue([]) }
})
vi.mock("@/lib/social/monitoring-profiles", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-profiles")>()
  return {
    ...original,
    listMonitoringProfiles: listProfiles,
    createOrUpdateMonitoringProfile: createOrUpdateProfile,
    findProfileCandidates: findCandidates,
    resumeMonitoringProfile: resumeProfile,
    setMonitoringProfileStatus: setStatus,
    deleteMonitoringProfile: deleteProfile,
  }
})

import { GET, POST } from "@/app/api/v1/social/monitoring-profiles/route"
import { DELETE, PATCH } from "@/app/api/v1/social/monitoring-profiles/[id]/route"

function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`http://localhost/api/v1/social/monitoring-profiles${query}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: "subject-1" }) }

const arazPayload = {
  name: "Araz Supermarket",
  platforms: ["instagram", "facebook", "tiktok", "web"],
  directions: ["general_reputation", "customer_complaints"],
}

beforeEach(() => {
  vi.clearAllMocks()
  collectionFenceBlocked.mockReturnValue(false)
  listProfiles.mockResolvedValue([])
  findCandidates.mockResolvedValue([])
  createOrUpdateProfile.mockResolvedValue({ id: "subject-1", name: "Araz Supermarket", status: "active", liveSendAllowed: false })
  resumeProfile.mockResolvedValue({ id: "subject-1", name: "Bahruz Şiraliyev", status: "active" })
  setStatus.mockResolvedValue(undefined)
  deleteProfile.mockResolvedValue(undefined)
})

describe("monitoring profiles API — listing", () => {
  it("counts profiles by derived status", async () => {
    listProfiles.mockResolvedValue([
      { id: "1", status: "active" },
      { id: "2", status: "paused" },
      { id: "3", status: "needs_resume" },
      { id: "4", status: "archived" },
    ])
    const response = await GET(request("GET"))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { stats: { total: 4, active: 1, paused: 1, needsResume: 1, archived: 1 } },
    })
  })
})

describe("monitoring profiles API — step 1 lookup", () => {
  it("returns local spelling suggestions without any provider call", async () => {
    const response = await GET(request("GET", undefined, "?name=Araz%20Supermarket"))
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.suggestions.some((item: { kind: string }) => item.kind === "HASHTAG")).toBe(true)
  })

  it("surfaces an existing profile instead of letting a duplicate be created", async () => {
    findCandidates.mockResolvedValue([{
      id: "subject-1", name: "Araz Supermarket", type: "COMPANY", status: "active",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"), aliases: [], sources: [],
    }])
    const response = await GET(request("GET", undefined, "?name=Araz"))
    const body = await response.json()
    expect(body.data.matches).toHaveLength(1)
    expect(body.data.matches[0].name).toBe("Araz Supermarket")
  })
})

describe("monitoring profiles API — creation", () => {
  it("does not create a profile while clean-slate collection is blocked", async () => {
    collectionFenceBlocked.mockReturnValue(true)

    const response = await POST(request("POST", arazPayload))

    expect(response.status).toBe(409)
    expect(createOrUpdateProfile).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("saves the Araz profile from one submission without running collection", async () => {
    const response = await POST(request("POST", arazPayload))
    expect(response.status).toBe(201)
    expect(createOrUpdateProfile).toHaveBeenCalledWith("org-1", "user-1", expect.objectContaining({
      name: "Araz Supermarket",
      directions: ["general_reputation", "customer_complaints"],
    }))
  })

  it("rejects a payload with no direction", async () => {
    const response = await POST(request("POST", { ...arazPayload, directions: [] }))
    expect(response.status).toBe(400)
    expect(createOrUpdateProfile).not.toHaveBeenCalled()
  })

  it("rejects a payload with no platform", async () => {
    const response = await POST(request("POST", { ...arazPayload, platforms: [] }))
    expect(response.status).toBe(400)
  })

  it("rejects an unknown field rather than silently ignoring it", async () => {
    const response = await POST(request("POST", { ...arazPayload, liveSendAllowed: true }))
    expect(response.status).toBe(400)
  })

  it("keeps the operator's configuration recoverable when orchestration fails", async () => {
    createOrUpdateProfile.mockRejectedValue(new Error("scenario store unavailable"))
    const response = await POST(request("POST", arazPayload))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "scenario store unavailable" })
  })

  it("omits includeExternalComments when the operator made no choice", async () => {
    await POST(request("POST", arazPayload))
    const [, , input] = createOrUpdateProfile.mock.calls[0]
    expect(input.includeExternalComments).toBeUndefined()
  })

  it("ignores removed page/profile selections from rolling clients", async () => {
    const response = await POST(request("POST", {
      ...arazPayload,
      sourceIds: ["legacy-facebook-page"],
      officialSourceIds: ["legacy-instagram-profile"],
    }))

    expect(response.status).toBe(201)
    const [, , input] = createOrUpdateProfile.mock.calls[0]
    expect(input).not.toHaveProperty("sourceIds")
    expect(input).not.toHaveProperty("officialSourceIds")
  })
})

describe("monitoring profiles API — lifecycle", () => {
  it("does not resume a profile while clean-slate collection is blocked", async () => {
    collectionFenceBlocked.mockReturnValue(true)

    const response = await PATCH(request("PATCH", { action: "resume" }), context)

    expect(response.status).toBe(409)
    expect(resumeProfile).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("resumes a profile whose collection plan was deleted", async () => {
    const response = await PATCH(request("PATCH", { action: "resume" }), context)
    expect(response.status).toBe(200)
    expect(resumeProfile).toHaveBeenCalledWith("org-1", "subject-1", "user-1", expect.any(Object))
  })

  it("pauses a profile", async () => {
    await PATCH(request("PATCH", { action: "pause" }), context)
    expect(setStatus).toHaveBeenCalledWith("org-1", "subject-1", "paused")
  })

  it("archives a profile on stop", async () => {
    await PATCH(request("PATCH", { action: "stop" }), context)
    expect(setStatus).toHaveBeenCalledWith("org-1", "subject-1", "archived")
  })

  it("refuses a patch with no action instead of defaulting to pause", async () => {
    const response = await PATCH(request("PATCH", { platforms: ["instagram"] }), context)
    expect(response.status).toBe(400)
    expect(setStatus).not.toHaveBeenCalled()
  })

  it("permanently removes an archived monitoring configuration", async () => {
    const response = await DELETE(request("DELETE"), context)
    expect(response.status).toBe(200)
    expect(deleteProfile).toHaveBeenCalledWith("org-1", "subject-1", { force: false })
    expect(logAudit).toHaveBeenCalledWith("org-1", "delete", "monitoring_profile", "subject-1", "deleted")
  })

  it("passes the explicit force flag through to a direct delete", async () => {
    const response = await DELETE(request("DELETE", undefined, "?force=1"), context)
    expect(response.status).toBe(200)
    expect(deleteProfile).toHaveBeenCalledWith("org-1", "subject-1", { force: true })
    expect(logAudit).toHaveBeenCalledWith("org-1", "delete", "monitoring_profile", "subject-1", "deleted:force")
  })

  it("surfaces the stop-first guard from a non-forced delete", async () => {
    deleteProfile.mockRejectedValueOnce(new Error("Stop monitoring before deleting it"))
    const response = await DELETE(request("DELETE"), context)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe("Stop monitoring before deleting it")
  })
})
