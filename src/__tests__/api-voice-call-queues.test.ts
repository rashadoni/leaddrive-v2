import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => {
  class VoiceQueueError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }

  return {
    auth: { orgId: "org-1", userId: "seller-1", role: "sales" },
    authGateCalls: [] as Array<{ module: string; action: string }>,
    checkPermission: vi.fn(() => true),
    feature: vi.fn(),
    preview: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    skip: vi.fn(),
    resolveUncertain: vi.fn(),
    getVoipProvider: vi.fn(),
    VoiceQueueError,
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/permissions", () => ({ checkPermission: mocks.checkPermission }))
vi.mock("@/lib/constants", () => ({
  isManagerOrAbove: (role: string) => ["manager", "admin", "superadmin"].includes(role),
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    module: string,
    action: string,
    handler: (request: NextRequest, auth: typeof mocks.auth, context: unknown) => Promise<Response>,
  ) => async (request: NextRequest, context: unknown) => {
    mocks.authGateCalls.push({ module, action })
    return handler(request, mocks.auth, context)
  },
}))
vi.mock("@/lib/voip", () => ({ getVoipProvider: mocks.getVoipProvider }))
vi.mock("@/lib/voice-agent/queue-service", () => ({
  VOICE_QUEUE_MAX_SELECTED_LEADS: 100,
  VoiceQueueError: mocks.VoiceQueueError,
  voiceQueueErrorStatus: (code: string) => ({
    invalid_selection: 400,
    consent_required: 400,
    owner_scope_required: 400,
    idempotency_conflict: 409,
    voice_queue_disabled: 409,
    queue_not_found: 404,
    queue_not_mutable: 409,
    item_not_skippable: 409,
    uncertain_resolution_too_early: 409,
    uncertain_call_still_active: 409,
    uncertain_status_unavailable: 409,
    uncertain_item_stale: 409,
  })[code] ?? 500,
  evaluateVoiceQueueFeature: mocks.feature,
  previewSelectedVoiceQueue: mocks.preview,
  createSelectedVoiceQueue: mocks.create,
  listVoiceQueues: mocks.list,
  getVoiceQueue: mocks.detail,
  startVoiceQueue: mocks.start,
  pauseVoiceQueue: mocks.pause,
  resumeVoiceQueue: mocks.resume,
  cancelVoiceQueue: mocks.cancel,
  skipVoiceQueueItem: mocks.skip,
  resolveUncertainVoiceQueueItem: mocks.resolveUncertain,
}))

import { POST as previewQueue } from "@/app/api/v1/voice-call-queues/preview/route"
import {
  GET as listQueues,
  POST as createQueue,
} from "@/app/api/v1/voice-call-queues/route"
import { GET as getQueue } from "@/app/api/v1/voice-call-queues/[id]/route"
import { POST as startQueue } from "@/app/api/v1/voice-call-queues/[id]/start/route"
import { POST as pauseQueue } from "@/app/api/v1/voice-call-queues/[id]/pause/route"
import { POST as skipQueueItem } from "@/app/api/v1/voice-call-queues/[id]/items/[itemId]/skip/route"
import { POST as resolveUncertainQueueItem } from "@/app/api/v1/voice-call-queues/[id]/resolve-uncertain/route"

const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000001"

function request(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  headers?: Record<string, string>,
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function queueContext(id = "queue-1") {
  return { params: Promise.resolve({ id }) }
}

function itemContext(id = "queue-1", itemId = "item-1") {
  return { params: Promise.resolve({ id, itemId }) }
}

const queue = {
  id: "queue-1",
  ownerUserId: "seller-1",
  createdByUserId: "seller-1",
  source: "selected",
  name: null,
  status: "prepared",
  totalItems: 1,
  counts: { pending: 1 },
  startedAt: null,
  pausedAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  selectionHash: "must-not-leak",
  idempotencyKey: IDEMPOTENCY_KEY,
  consentAudit: { actor: "seller-1" },
  provider: "asterisk",
  targetPhoneE164: "+00000000000",
}

const item = {
  id: "item-1",
  leadId: "lead-1",
  position: 0,
  status: "pending",
  outcome: null,
  blockReason: null,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  eligibilitySnapshot: { targetPhoneE164: "+00000000000" },
  voiceCallSessionId: "session-secret",
  providerCallId: "provider-secret",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authGateCalls.length = 0
  Object.assign(mocks.auth, { orgId: "org-1", userId: "seller-1", role: "sales" })
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-1"
  mocks.checkPermission.mockReturnValue(true)
  mocks.feature.mockResolvedValue({ enabled: false, blocker: "voice_queue_disabled" })
  mocks.preview.mockResolvedValue({
    enabled: false,
    blocker: "voice_queue_disabled",
    blockers: ["voice_queue_disabled"],
    ownerUserId: "seller-1",
    total: 1,
    eligible: 1,
    items: [{ leadId: "lead-1", position: 0, eligible: true, blockers: [] }],
    limits: { userRemaining: 5, organizationRemaining: 20 },
    providerSettings: { password: "must-not-leak" },
  })
  mocks.create.mockResolvedValue({ queue: { ...queue, items: [item] }, replayed: false })
  mocks.list.mockResolvedValue({ queues: [queue], nextCursor: null })
  mocks.detail.mockResolvedValue({ ...queue, items: [item] })
  mocks.start.mockResolvedValue({ ...queue, status: "running" })
  mocks.pause.mockResolvedValue({ ...queue, status: "paused" })
  mocks.resume.mockResolvedValue({ ...queue, status: "running" })
  mocks.cancel.mockResolvedValue({ ...queue, status: "cancelled" })
  mocks.skip.mockResolvedValue({
    ...queue,
    items: [{ ...item, status: "skipped", outcome: "skipped" }],
  })
  mocks.resolveUncertain.mockResolvedValue({ ...queue, status: "paused" })
})

describe("voice call queue authentication and RBAC", () => {
  it("rejects bearer/API-key use before auth and preview evaluation", async () => {
    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1"] },
      { authorization: "Bearer ld_example" },
    ))

    expect(response.status).toBe(403)
    expect(mocks.authGateCalls).toEqual([])
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it("hides every queue endpoint outside the pilot organization", async () => {
    process.env.VOICE_AGENT_ORGANIZATION_ID = "another-org"
    const response = await listQueues(request("/api/v1/voice-call-queues", "GET"))

    expect(response.status).toBe(404)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("uses leads-read plus VoIP-read for preview", async () => {
    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1"] },
    ))

    expect(response.status).toBe(200)
    expect(mocks.authGateCalls).toEqual([{ module: "voip", action: "read" }])
    expect(mocks.checkPermission).toHaveBeenCalledWith("sales", "leads", "read")
    const payload = await response.json()
    expect(payload.data).toMatchObject({
      requestedCount: 1,
      eligible: [{ leadId: "lead-1", position: 1 }],
      blockers: ["voice_queue_disabled"],
    })
    expect(JSON.stringify(payload)).not.toContain("providerSettings")
  })

  it("groups documented connected and already-queued exclusions without phone data", async () => {
    mocks.preview.mockResolvedValueOnce({
      enabled: false,
      blocker: "voice_queue_disabled",
      blockers: ["voice_queue_disabled"],
      ownerUserId: "seller-1",
      total: 3,
      eligible: 1,
      items: [
        { leadId: "lead-1", position: 0, eligible: false, blockers: ["connected_before"] },
        { leadId: "lead-2", position: 1, eligible: false, blockers: ["already_queued"] },
        { leadId: "lead-3", position: 2, eligible: true, blockers: [] },
      ],
      limits: { userRemaining: 5, organizationRemaining: 20 },
    })

    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1", "lead-2", "lead-3"] },
    ))
    const payload = await response.json()

    expect(payload.data.eligible).toEqual([{ leadId: "lead-3", position: 1 }])
    expect(payload.data.excludedGroups).toEqual([
      { code: "connected_before", count: 1 },
      { code: "already_queued", count: 1 },
    ])
    expect(payload.data.blockers).toEqual(["voice_queue_disabled"])
  })

  it("requires leads-write plus VoIP-write for queue creation", async () => {
    const response = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      {
        leadIds: ["lead-1"],
        idempotencyKey: IDEMPOTENCY_KEY,
        consentConfirmed: true,
      },
    ))

    expect(response.status).toBe(201)
    expect(mocks.authGateCalls).toEqual([{ module: "voip", action: "write" }])
    expect(mocks.checkPermission).toHaveBeenCalledWith("sales", "leads", "write")
  })

  it("blocks a state change when leads-write permission is absent", async () => {
    mocks.checkPermission.mockReturnValue(false)
    const response = await startQueue(request(
      "/api/v1/voice-call-queues/queue-1/start",
      "POST",
      {},
    ), queueContext())

    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })
})

describe("voice call queue owner scope", () => {
  it("forces a seller to self and returns 404 for another requested owner", async () => {
    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1"], ownerUserId: "seller-2" },
    ))

    expect(response.status).toBe(404)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it("requires a manager to state one exact owner scope", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" })
    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1"] },
    ))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "owner_scope_required" })
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it("passes a manager's explicit owner to core instead of widening to the team", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" })
    const response = await previewQueue(request(
      "/api/v1/voice-call-queues/preview",
      "POST",
      { leadIds: ["lead-1"], ownerUserId: "seller-2" },
    ))

    expect(response.status).toBe(200)
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "seller-2",
      leadIds: ["lead-1"],
    }))
  })

  it("requires an explicit owner for a manager queue list", async () => {
    Object.assign(mocks.auth, { role: "admin", userId: "admin-1" })
    const response = await listQueues(request("/api/v1/voice-call-queues", "GET"))

    expect(response.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/voice-call-queues", () => {
  it("requires literal per-batch consent and rejects destination injection", async () => {
    const missingConsent = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      { leadIds: ["lead-1"], idempotencyKey: IDEMPOTENCY_KEY },
    ))
    const injectedDestination = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      {
        leadIds: ["lead-1"],
        idempotencyKey: IDEMPOTENCY_KEY,
        consentConfirmed: true,
        toNumber: "+00000000000",
      },
    ))

    expect(missingConsent.status).toBe(400)
    expect(await missingConsent.json()).toMatchObject({ code: "consent_required" })
    expect(injectedDestination.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("returns only the safe immutable queue projection", async () => {
    const response = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      {
        leadIds: ["lead-1"],
        idempotencyKey: IDEMPOTENCY_KEY,
        consentConfirmed: true,
      },
    ))
    const payload = await response.json()
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(payload.data.queue).toMatchObject({ id: "queue-1", status: "prepared" })
    expect(payload.data.items[0]).toMatchObject({ id: "item-1", leadId: "lead-1" })
    expect(serialized).not.toContain("targetPhoneE164")
    expect(serialized).not.toContain("providerCallId")
    expect(serialized).not.toContain("eligibilitySnapshot")
    expect(serialized).not.toContain("consentAudit")
    expect(serialized).not.toContain("selectionHash")
    expect(mocks.getVoipProvider).not.toHaveBeenCalled()
  })

  it("returns an idempotent replay as 200 and maps conflicting key reuse to 409", async () => {
    mocks.create.mockResolvedValueOnce({
      queue: { ...queue, items: [item] },
      replayed: true,
    })
    const replay = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      {
        leadIds: ["lead-1"],
        idempotencyKey: IDEMPOTENCY_KEY,
        consentConfirmed: true,
      },
    ))

    mocks.create.mockRejectedValueOnce(new mocks.VoiceQueueError("idempotency_conflict"))
    const conflict = await createQueue(request(
      "/api/v1/voice-call-queues",
      "POST",
      {
        leadIds: ["lead-2"],
        idempotencyKey: IDEMPOTENCY_KEY,
        consentConfirmed: true,
      },
    ))

    expect(replay.status).toBe(200)
    expect((await replay.json()).data.replayed).toBe(true)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      code: "idempotency_conflict",
      blockers: ["idempotency_conflict"],
    })
  })
})

describe("queue reads and actions", () => {
  it("returns detail with a one-based order and the read-only execution blocker", async () => {
    const response = await getQueue(request(
      "/api/v1/voice-call-queues/queue-1",
      "GET",
    ), queueContext())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.items[0]).toMatchObject({ leadId: "lead-1", position: 1 })
    expect(payload.data.blockers).toEqual(["voice_queue_disabled"])
    expect(mocks.feature).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
    }))
  })

  it("maps an inaccessible detail to 404 without exposing another queue", async () => {
    mocks.detail.mockRejectedValueOnce(new mocks.VoiceQueueError("queue_not_found"))
    const response = await getQueue(request(
      "/api/v1/voice-call-queues/foreign",
      "GET",
    ), queueContext("foreign"))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "queue_not_found" })
  })

  it("starts by a state transition only and never dispatches from the HTTP request", async () => {
    const response = await startQueue(request(
      "/api/v1/voice-call-queues/queue-1/start",
      "POST",
      {},
    ), queueContext())

    expect(response.status).toBe(200)
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      queueId: "queue-1",
      ownerUserId: "seller-1",
    }))
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.getVoipProvider).not.toHaveBeenCalled()
  })

  it("rejects bearer credentials for pause before a transition", async () => {
    const response = await pauseQueue(request(
      "/api/v1/voice-call-queues/queue-1/pause",
      "POST",
      {},
      { authorization: "Bearer ld_example" },
    ), queueContext())

    expect(response.status).toBe(403)
    expect(mocks.pause).not.toHaveBeenCalled()
  })

  it("requires a stable skip reason and seller ownership", async () => {
    const invalidReason = await skipQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/items/item-1/skip",
      "POST",
      { reason: "free-form phone details" },
    ), itemContext())
    const foreignOwner = await skipQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/items/item-1/skip",
      "POST",
      { reason: "seller_skipped", ownerUserId: "seller-2" },
    ), itemContext())
    const accepted = await skipQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/items/item-1/skip",
      "POST",
      { reason: "seller_skipped" },
    ), itemContext())

    expect(invalidReason.status).toBe(400)
    expect(foreignOwner.status).toBe(404)
    expect(accepted.status).toBe(200)
    expect(mocks.skip).toHaveBeenCalledTimes(1)
  })

  it("keeps dispatch-uncertain resolution manager-only and requires explicit no-redial acknowledgement", async () => {
    const seller = await resolveUncertainQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/resolve-uncertain",
      "POST",
      {
        itemId: "item-1",
        resolution: "unknown_no_redial",
        acknowledgeNoRedial: true,
      },
    ), queueContext())
    expect(seller.status).toBe(403)
    expect(mocks.resolveUncertain).not.toHaveBeenCalled()

    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" })
    const missingAcknowledgement = await resolveUncertainQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/resolve-uncertain",
      "POST",
      {
        ownerUserId: "seller-1",
        itemId: "item-1",
        resolution: "unknown_no_redial",
        acknowledgeNoRedial: false,
      },
    ), queueContext())
    expect(missingAcknowledgement.status).toBe(400)
    expect(mocks.resolveUncertain).not.toHaveBeenCalled()

    const accepted = await resolveUncertainQueueItem(request(
      "/api/v1/voice-call-queues/queue-1/resolve-uncertain",
      "POST",
      {
        ownerUserId: "seller-1",
        itemId: "item-1",
        resolution: "unknown_no_redial",
        acknowledgeNoRedial: true,
      },
    ), queueContext())
    expect(accepted.status).toBe(200)
    expect(mocks.resolveUncertain).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
    }))
    expect(mocks.getVoipProvider).not.toHaveBeenCalled()
  })
})
