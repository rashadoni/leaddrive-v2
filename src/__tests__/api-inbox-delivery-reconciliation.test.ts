import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  findConversation: vi.fn(),
  findAttempt: vi.fn(),
  updateAttempt: vi.fn(),
  updateConversation: vi.fn(),
  updateContact: vi.fn(),
}))

const tx = {
  $executeRaw: mocks.executeRaw,
  socialConversation: {
    findFirst: mocks.findConversation,
    updateMany: mocks.updateConversation,
  },
  channelMessage: {
    findFirst: mocks.findAttempt,
    updateMany: mocks.updateAttempt,
  },
  contact: { updateMany: mocks.updateContact },
}

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, {
      orgId: "org-1",
      userId: "user-1",
      role: "support",
    }, ctx),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}))

import { POST } from "@/app/api/v1/inbox/conversations/[id]/delivery-reconciliation/route"

const ctx = { params: Promise.resolve({ id: "conv-1" }) }
function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/inbox/conversations/conv-1/delivery-reconciliation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeRaw.mockResolvedValue(1)
  mocks.findConversation.mockResolvedValue({ id: "conv-1" })
  mocks.findAttempt.mockResolvedValue({
    id: "attempt-1",
    status: "failed",
    body: "hello",
    contactId: "contact-1",
    createdAt: new Date("2026-08-13T18:00:00.000Z"),
    metadata: { deliveryAttempted: true, deliveryUnknown: true },
  })
  mocks.updateAttempt.mockResolvedValue({ count: 1 })
  mocks.updateConversation.mockResolvedValue({ count: 1 })
  mocks.updateContact.mockResolvedValue({ count: 1 })
})

describe("POST Chatwoot delivery reconciliation", () => {
  it("marks a provider-verified delivery and repairs local projections under the lock", async () => {
    const res = await POST(request({
      attemptId: "attempt-1",
      outcome: "delivered",
      confirmation: "verified_in_chatwoot",
    }), ctx as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      data: { messageId: "attempt-1", outcome: "delivered", replayed: false },
    })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    expect(mocks.updateAttempt).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attempt-1", organizationId: "org-1" },
      data: expect.objectContaining({
        status: "delivered",
        metadata: expect.objectContaining({
          deliveryUnknown: false,
          deliveryConfirmed: true,
          deliveryReconciliation: expect.objectContaining({
            outcome: "delivered",
            method: "operator_chatwoot_check",
            verifiedBy: "user-1",
          }),
        }),
      }),
    }))
    expect(mocks.updateConversation).toHaveBeenCalledTimes(1)
    expect(mocks.updateContact).toHaveBeenCalledTimes(1)
  })

  it("records verified non-delivery without projecting a sent message", async () => {
    const res = await POST(request({
      attemptId: "attempt-1",
      outcome: "not_delivered",
      confirmation: "verified_in_chatwoot",
    }), ctx as never)

    expect(res.status).toBe(200)
    expect(mocks.updateAttempt).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({
          deliveryUnknown: false,
          deliveryConfirmed: false,
          deliveryReconciliation: expect.objectContaining({ outcome: "not_delivered" }),
        }),
      }),
    }))
    expect(mocks.updateConversation).not.toHaveBeenCalled()
    expect(mocks.updateContact).not.toHaveBeenCalled()
  })

  it("rejects a request without the explicit Chatwoot confirmation", async () => {
    const res = await POST(request({
      attemptId: "attempt-1",
      outcome: "not_delivered",
      confirmation: "yes",
    }), ctx as never)

    expect(res.status).toBe(400)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    expect(mocks.updateAttempt).not.toHaveBeenCalled()
  })

  it("rejects an oversized reconciliation body before opening a transaction", async () => {
    const oversizedRequest = new NextRequest(
      "http://localhost/api/v1/inbox/conversations/conv-1/delivery-reconciliation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId: "attempt-1",
          outcome: "not_delivered",
          confirmation: "verified_in_chatwoot",
          padding: "x".repeat(8 * 1024),
        }),
      },
    )

    const res = await POST(oversizedRequest, ctx as never)

    expect(res.status).toBe(413)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    expect(mocks.updateAttempt).not.toHaveBeenCalled()
  })

  it("cannot clear a resolved or unrelated attempt", async () => {
    mocks.findAttempt.mockResolvedValueOnce({
      id: "attempt-1",
      status: "delivered",
      body: "hello",
      contactId: null,
      createdAt: new Date("2026-08-13T18:00:00.000Z"),
      metadata: { deliveryAttempted: true },
    })

    const res = await POST(request({
      attemptId: "attempt-1",
      outcome: "not_delivered",
      confirmation: "verified_in_chatwoot",
    }), ctx as never)

    expect(res.status).toBe(409)
    expect(mocks.updateAttempt).not.toHaveBeenCalled()
  })

  it("will not reconcile an attempt that can still be in flight", async () => {
    mocks.findAttempt.mockResolvedValueOnce({
      id: "attempt-1",
      status: "pending",
      body: "hello",
      contactId: null,
      createdAt: new Date(),
      metadata: { deliveryAttempted: true },
    })

    const res = await POST(request({
      attemptId: "attempt-1",
      outcome: "not_delivered",
      confirmation: "verified_in_chatwoot",
    }), ctx as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Wait one minute") })
    expect(mocks.updateAttempt).not.toHaveBeenCalled()
  })
})
