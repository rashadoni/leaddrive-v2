import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { listDashboard, submitLead, getPolicy, updatePolicy, logAudit } = vi.hoisted(() => ({
  listDashboard: vi.fn(),
  submitLead: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest) => handler(request, { orgId: "org-1", userId: "user-1" }),
}))
vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (
    _module: string,
    _action: string,
    handler: (...args: unknown[]) => unknown,
  ) => (request: NextRequest) => handler(
    request,
    { orgId: "org-1", userId: "user-1" },
  ),
}))
vi.mock("@/lib/prisma", () => ({ logAudit }))
vi.mock("@/lib/social/media-observations", () => ({
  listMediaDashboard: listDashboard,
  submitDiscoveryLead: submitLead,
  getOrCreateMediaPolicy: getPolicy,
  updateMediaPolicy: updatePolicy,
}))

import { GET as getDashboard, POST as postLead } from "@/app/api/v1/social/media-discovery/route"
import { GET as getMediaPolicy, PATCH as patchMediaPolicy } from "@/app/api/v1/social/media-policy/route"

function request(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  listDashboard.mockResolvedValue({ policy: { enabled: false }, leads: [], observations: [], costs: { totalUsd: 0 } })
  getPolicy.mockResolvedValue({ id: "policy-1", enabled: false, policyVersion: 1 })
  updatePolicy.mockResolvedValue({ id: "policy-1", enabled: true, policyVersion: 2 })
  submitLead.mockResolvedValue({
    lead: { id: "lead-1", canonicalUrl: "https://example.com/video/1" },
    observation: { id: "observation-1", status: "BLOCKED" },
  })
})

describe("social media discovery API", () => {
  it("returns tenant dashboard with fail-closed policy", async () => {
    const response = await getDashboard(request("GET", "/api/v1/social/media-discovery"))
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { policy: { enabled: false } } })
    expect(listDashboard).toHaveBeenCalledWith("org-1", { sentiment: undefined })
  })

  it("validates and forwards a server-side media sentiment filter", async () => {
    const response = await getDashboard(request("GET", "/api/v1/social/media-discovery?sentiment=negative"))
    expect(response.status).toBe(200)
    expect(listDashboard).toHaveBeenCalledWith("org-1", { sentiment: "negative" })

    const invalid = await getDashboard(request("GET", "/api/v1/social/media-discovery?sentiment=angry"))
    expect(invalid.status).toBe(400)
    expect(listDashboard).toHaveBeenCalledTimes(1)
  })

  it("accepts a public manual lead and audits it", async () => {
    const response = await postLead(request("POST", "/api/v1/social/media-discovery", {
      submittedUrl: "https://example.com/video/1",
      platformHint: "tiktok",
      mediaType: "VIDEO",
    }))
    expect(response.status).toBe(201)
    expect(submitLead).toHaveBeenCalledWith("org-1", "user-1", expect.objectContaining({ mediaType: "VIDEO" }))
    expect(logAudit).toHaveBeenCalledWith("org-1", "create", "social_discovery_lead", "lead-1", "https://example.com/video/1")
  })

  it("does not finish a discovery submission before its audit write settles", async () => {
    let releaseAudit!: () => void
    const auditPending = new Promise<void>((resolve) => {
      releaseAudit = resolve
    })
    logAudit.mockReturnValueOnce(auditPending)

    let settled = false
    const responsePromise = postLead(request(
      "POST",
      "/api/v1/social/media-discovery",
      { submittedUrl: "https://example.com/video/1" },
    )).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(logAudit).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    releaseAudit()
    await expect(responsePromise).resolves.toMatchObject({ status: 201 })
  })

  it("rejects malformed and local URLs before the service", async () => {
    const malformed = await postLead(request("POST", "/api/v1/social/media-discovery", { submittedUrl: "not-a-url" }))
    expect(malformed.status).toBe(400)
    expect(submitLead).not.toHaveBeenCalled()
  })

  it("validates and versions media budget policy updates", async () => {
    const getResponse = await getMediaPolicy(request("GET", "/api/v1/social/media-policy"))
    expect(getResponse.status).toBe(200)
    const patchResponse = await patchMediaPolicy(request("PATCH", "/api/v1/social/media-policy", {
      enabled: true,
      dailyBudgetUsd: 1,
      monthlyBudgetUsd: 10,
      perObservationBudgetUsd: 0.1,
    }))
    expect(patchResponse.status).toBe(200)
    expect(updatePolicy).toHaveBeenCalledWith("org-1", "user-1", expect.objectContaining({ dailyBudgetUsd: 1 }))
    expect(logAudit).toHaveBeenCalledWith("org-1", "update", "social_media_policy", "policy-1", "version:2")
  })
})
