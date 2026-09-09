import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = {
  orgId: string
  userId: string
  role: string
}

type RouteHandler<C = unknown> = (
  req: NextRequest,
  auth: AuthContext,
  context: C,
) => Promise<Response>

const mocks = vi.hoisted(() => {
  class ApplyError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code)
      this.name = "DiscoveryAutoReviewApplyError"
    }
  }

  return {
    role: "admin",
    apply: vi.fn(),
    rollback: vi.fn(),
    ApplyError,
    fenceBlocked: false,
    registrations: [] as Array<{ module: string; action: string }>,
  }
})

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: <C>(
    module: string,
    action: string,
    handler: RouteHandler<C>,
  ) => {
    mocks.registrations.push({ module, action })
    return (req: NextRequest, context: C) => handler(req, {
      orgId: "org-1",
      userId: "user-1",
      role: mocks.role,
    }, context)
  },
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: <C>(
    module: string,
    action: string,
    handler: RouteHandler<C>,
  ) => {
    mocks.registrations.push({ module, action })
    return (req: NextRequest, context: C) => {
      if (mocks.fenceBlocked) {
        return NextResponse.json(
          {
            error: "Social Monitoring is paused for a clean-slate reset",
            code: "social_monitoring_collection_blocked",
          },
          { status: 409 },
        )
      }
      return handler(req, {
        orgId: "org-1",
        userId: "user-1",
        role: mocks.role,
      }, context)
    }
  },
}))

vi.mock("@/lib/social/discovery-auto-review-apply", () => ({
  applyDiscoveryAutoReviewPlan: mocks.apply,
  rollbackDiscoveryAutoReviewRun: mocks.rollback,
  DiscoveryAutoReviewApplyError: mocks.ApplyError,
}))

import { POST as applyReview } from "@/app/api/v1/social/monitoring-profiles/[id]/review-apply/route"
import { POST as rollbackReview } from "@/app/api/v1/social/monitoring-profiles/[id]/review-apply/[runId]/rollback/route"

const applyPayload = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  mode: "REJECT_ONLY" as const,
  resolverVersion: "discovery_auto_review_v1",
  planFingerprint: "a".repeat(64),
  expectedLinks: 3,
  expectedRows: 8,
}

const rollbackPayload = {
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
}

const rejectedMutationCases: Array<{
  name: string
  headers: Record<string, string>
  status: number
  error: string
}> = [
  {
    name: "bearer authorization",
    headers: { authorization: "Bearer api-token" },
    status: 403,
    error: "interactive_session_required",
  },
  {
    name: "non-JSON content",
    headers: { "content-type": "text/plain" },
    status: 415,
    error: "application_json_required",
  },
  {
    name: "cross-site browser metadata",
    headers: { "sec-fetch-site": "cross-site" },
    status: 403,
    error: "cross_origin_request_rejected",
  },
  {
    name: "foreign origin",
    headers: { origin: "https://attacker.example" },
    status: 403,
    error: "cross_origin_request_rejected",
  },
  {
    name: "malformed origin",
    headers: { origin: "not a URL" },
    status: 403,
    error: "cross_origin_request_rejected",
  },
]

const run = {
  id: "run-1",
  state: "APPLIED",
  appliedGroupCount: 3,
  appliedRowCount: 8,
  rollbackUntil: "2026-07-24T12:00:00.000Z",
  createdAt: "2026-07-23T12:00:00.000Z",
  rolledBackAt: null,
  finalizedAt: null,
  rollbackAvailable: true,
}

function request(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://brand.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "https://brand.example",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function applyContext(id = "subject-1") {
  return { params: Promise.resolve({ id }) }
}

function rollbackContext(id = "subject-1", runId = "run-1") {
  return { params: Promise.resolve({ id, runId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = "admin"
  mocks.fenceBlocked = false
  mocks.apply.mockResolvedValue({ run, idempotent: false })
  mocks.rollback.mockResolvedValue({
    run: {
      ...run,
      state: "ROLLED_BACK",
      rolledBackAt: "2026-07-23T12:05:00.000Z",
      rollbackAvailable: false,
    },
    idempotent: false,
  })
})

describe("POST monitoring profile review apply", () => {
  it("does not apply review decisions while clean-slate collection is blocked", async () => {
    mocks.fenceBlocked = true

    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(409)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it("scopes a valid apply to the authenticated tenant and user", async () => {
    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { run },
    })
    expect(mocks.apply).toHaveBeenCalledWith({
      organizationId: "org-1",
      subjectId: "subject-1",
      requestedBy: "user-1",
      ...applyPayload,
    })
  })

  it("accepts the public browser origin behind the production reverse proxy", async () => {
    const path = "/api/v1/social/monitoring-profiles/subject-1/review-apply"
    const response = await applyReview(
      new NextRequest(`http://127.0.0.1:3001${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          origin: "https://brandprotection.leaddrivecrm.org",
          host: "brandprotection.leaddrivecrm.org",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify(applyPayload),
      }),
      applyContext(),
    )

    expect(response.status).toBe(201)
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

  it("does not let x-forwarded-host override the nginx-owned Host header", async () => {
    const path = "/api/v1/social/monitoring-profiles/subject-1/review-apply"
    const response = await applyReview(
      new NextRequest(`http://127.0.0.1:3001${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          origin: "https://attacker.example",
          host: "brandprotection.leaddrivecrm.org",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify(applyPayload),
      }),
      applyContext(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "cross_origin_request_rejected",
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it.each([
    ["invalid forwarded protocol", { host: "brandprotection.leaddrivecrm.org", "x-forwarded-proto": "javascript" }],
    ["invalid Host header", { host: "brandprotection.leaddrivecrm.org/attacker", "x-forwarded-proto": "https" }],
  ])("rejects a proxied request with %s", async (_name, headers) => {
    const path = "/api/v1/social/monitoring-profiles/subject-1/review-apply"
    const response = await applyReview(
      new NextRequest(`http://127.0.0.1:3001${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          origin: "https://brandprotection.leaddrivecrm.org",
          ...headers,
        },
        body: JSON.stringify(applyPayload),
      }),
      applyContext(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "cross_origin_request_rejected",
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it("returns 200 for an idempotent retry", async () => {
    mocks.apply.mockResolvedValueOnce({ run, idempotent: true })

    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

  it("accepts the safe-resolve mode without widening the authenticated scope", async () => {
    const safeResolvePayload = {
      ...applyPayload,
      mode: "SAFE_RESOLVE" as const,
    }

    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        safeResolvePayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(201)
    expect(mocks.apply).toHaveBeenCalledWith({
      organizationId: "org-1",
      subjectId: "subject-1",
      requestedBy: "user-1",
      ...safeResolvePayload,
    })
  })

  it("requires a tenant administrator before parsing or applying", async () => {
    mocks.role = "manager"

    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "admin_required" })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it.each(rejectedMutationCases)(
    "rejects $name before invoking the service",
    async ({ headers, status, error }) => {
    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
        headers,
      ),
      applyContext(),
    )

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
    expect(mocks.apply).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["invalid UUID", { ...applyPayload, idempotencyKey: "retry-1" }],
    ["unsupported mode", { ...applyPayload, mode: "RELEASE_AND_REJECT" }],
    ["invalid fingerprint", { ...applyPayload, planFingerprint: "not-a-digest" }],
    ["zero eligible links", { ...applyPayload, expectedLinks: 0 }],
    ["unknown field", { ...applyPayload, provider: "APIFY" }],
  ])("rejects %s without applying", async (_name, body) => {
    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        body,
      ),
      applyContext(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_review_apply_request",
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it("maps a stale preview to a conflict without hiding the reason", async () => {
    mocks.apply.mockRejectedValueOnce(
      new mocks.ApplyError("review_apply_preview_stale", 409),
    )

    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply",
        applyPayload,
      ),
      applyContext(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "review_apply_preview_stale",
    })
  })

  it("rejects an invalid subject identifier before applying", async () => {
    const response = await applyReview(
      request(
        "/api/v1/social/monitoring-profiles/x/review-apply",
        applyPayload,
      ),
      applyContext("x".repeat(161)),
    )

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})

describe("POST monitoring profile review rollback", () => {
  it("does not roll back review decisions while clean-slate collection is blocked", async () => {
    mocks.fenceBlocked = true

    const response = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
      ),
      rollbackContext(),
    )

    expect(response.status).toBe(409)
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it("scopes rollback to the authenticated tenant, subject, run, and user", async () => {
    const response = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
      ),
      rollbackContext(),
    )

    expect(response.status).toBe(200)
    expect(mocks.rollback).toHaveBeenCalledWith({
      organizationId: "org-1",
      subjectId: "subject-1",
      runId: "run-1",
      requestedBy: "user-1",
      ...rollbackPayload,
    })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        run: {
          id: "run-1",
          state: "ROLLED_BACK",
          rollbackAvailable: false,
        },
      },
    })
  })

  it("uses the same interactive request guard for rollback", async () => {
    const response = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
        { authorization: "Bearer api-token" },
      ),
      rollbackContext(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "interactive_session_required",
    })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it("permits only tenant administrators to roll back a run", async () => {
    mocks.role = "manager"

    const response = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
      ),
      rollbackContext(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "admin_required" })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it("strictly validates rollback input and route identifiers", async () => {
    const invalidBody = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        { ...rollbackPayload, force: true },
      ),
      rollbackContext(),
    )
    expect(invalidBody.status).toBe(400)

    const invalidRoute = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
      ),
      rollbackContext("subject-1", "x".repeat(161)),
    )
    expect(invalidRoute.status).toBe(400)
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it("preserves typed rollback expiry as a 409 conflict", async () => {
    mocks.rollback.mockRejectedValueOnce(
      new mocks.ApplyError("review_apply_rollback_expired", 409),
    )

    const response = await rollbackReview(
      request(
        "/api/v1/social/monitoring-profiles/subject-1/review-apply/run-1/rollback",
        rollbackPayload,
      ),
      rollbackContext(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "review_apply_rollback_expired",
    })
  })
})

describe("review apply route permissions", () => {
  it("registers both mutations on social write permission", () => {
    expect(mocks.registrations).toEqual([
      { module: "social", action: "write" },
      { module: "social", action: "write" },
    ])
  })
})
