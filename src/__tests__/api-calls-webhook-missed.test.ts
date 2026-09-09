import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Synthetic E2E test for the missed-call → SMS workflow.
 *
 * Simulates Twilio's POST to /api/v1/calls/webhook with CallStatus=no-answer
 * and verifies that:
 *   1. The CallLog is updated to status="no-answer"
 *   2. executeWorkflows is called with ("call", "missed", entity) — only for inbound
 *   3. When a WorkflowRule with send_sms action exists, sendSms is invoked
 *      with the caller's fromNumber
 *
 * This removes the "never actually run" risk for the missed-call template
 * without needing a real Twilio number and physical phone call.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const state: { callLog: any; rules: any[]; smsCalls: any[]; activities: any[] } = {
  callLog: null,
  rules: [],
  smsCalls: [],
  activities: [],
}

const { validateTwilioRequest } = vi.hoisted(() => ({
  validateTwilioRequest: vi.fn(() => true),
}))

vi.mock("twilio", () => ({
  default: { validateRequest: validateTwilioRequest },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // orgStageVocabulary resolves won/lost spellings before the route's own
    // query; both of these must answer for any deal-touching route.
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]) },
    deal: { groupBy: vi.fn().mockResolvedValue([]) },
    callLog: {
      findFirst: vi.fn(async () => state.callLog),
      findUnique: vi.fn(async () => state.callLog),
      update: vi.fn(async ({ data }: any) => {
        state.callLog = { ...state.callLog, ...data }
        return state.callLog
      }),
    },
    activity: {
      create: vi.fn(async ({ data }: any) => {
        const act = { id: "act_1", ...data }
        state.activities.push(act)
        return act
      }),
    },
    workflowRule: {
      findMany: vi.fn(async () => state.rules),
    },
    task: { create: vi.fn(async () => ({ id: "task_1" })) },
    channelConfig: {
      findFirst: vi.fn(async () => ({
        id: "twilio-config",
        configName: "Twilio",
        phoneNumber: "+15550000000",
        apiKey: "test-auth-token",
        settings: {
          provider: "twilio",
          accountSid: "AC_TEST",
          authToken: "test-auth-token",
          twilioNumber: "+15550000000",
        },
        isActive: true,
      })),
      findMany: vi.fn(async () => []),
    },
  },
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn(async () => {}),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(async () => {}),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/slack", () => ({
  sendSlackNotification: vi.fn(async () => {}),
  formatGenericNotification: vi.fn(() => "msg"),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn(async () => {}),
}))

vi.mock("@/lib/url-validation", () => ({
  isPrivateUrl: vi.fn(() => false),
}))

// Spy on sendSms at the library boundary — this is the critical assertion.
vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: any) => {
    state.smsCalls.push(opts)
    return { success: true, messageId: "SM_TEST" }
  }),
  isSmsConfigured: vi.fn(async () => true),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

import { POST as webhookPOST } from "@/app/api/v1/calls/webhook/route"
import { sendSms } from "@/lib/sms"

function formRequest(body: Record<string, string>): NextRequest {
  const fd = new URLSearchParams(body)
  return new NextRequest("https://example.com/api/v1/calls/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": "valid-test-signature",
    },
    body: fd.toString(),
  })
}

beforeEach(() => {
  state.callLog = null
  state.rules = []
  state.smsCalls = []
  state.activities = []
  vi.clearAllMocks()
  validateTwilioRequest.mockReturnValue(true)
})

describe("POST /api/v1/calls/webhook — missed call trigger", () => {
  it("rejects a Twilio callback whose signature is not valid", async () => {
    state.callLog = {
      id: "call_invalid_signature",
      callSid: "CA_INVALID",
      organizationId: "org_1",
      channelConfigId: "twilio-config",
      direction: "inbound",
      fromNumber: "+15551112222",
      toNumber: "+15553334444",
    }
    validateTwilioRequest.mockReturnValueOnce(false)

    const res = await webhookPOST(formRequest({
      CallSid: "CA_INVALID",
      CallStatus: "completed",
      CallDuration: "12",
    }))

    expect(res.status).toBe(403)
    expect(state.callLog.status).toBeUndefined()
    expect(state.activities).toHaveLength(0)
  })

  it("fires executeWorkflows('call','missed') + send_sms action for inbound no-answer", async () => {
    // Seed a CallLog the webhook will find by CallSid
    state.callLog = {
      id: "call_1",
      callSid: "CA_TEST",
      organizationId: "org_1",
      channelConfigId: "twilio-config",
      direction: "inbound",
      fromNumber: "+15551112222",
      toNumber: "+15553334444",
      contactId: null,
    }

    // Seed a WorkflowRule matching call.missed that sends an SMS back
    state.rules = [
      {
        id: "rule_1",
        organizationId: "org_1",
        entityType: "call",
        triggerEvent: "missed",
        conditions: {},
        isActive: true,
        actions: [
          {
            id: "a1",
            actionType: "send_sms",
            actionConfig: { message: "We missed your call. Calling back soon." },
            actionOrder: 0,
          },
        ],
      },
    ]

    const req = formRequest({
      CallSid: "CA_TEST",
      CallStatus: "no-answer",
      CallDuration: "0",
    })

    const res = await webhookPOST(req)

    expect(res.status).toBe(200)
    // CallLog status was updated
    expect(state.callLog.status).toBe("no-answer")
    expect(state.callLog.wasAnswered).toBe(false)
    expect(state.callLog.providerOutcome).toBe("no_answer")
    expect(state.callLog.targetPhoneE164).toBe("+15551112222")
    // An activity was logged for the terminal status
    expect(state.activities.length).toBe(1)

    // Allow the deferred workflow promise to run
    await new Promise((r) => setTimeout(r, 10))

    // sendSms was invoked with the caller's number (fromNumber becomes the SMS recipient)
    expect(sendSms).toHaveBeenCalledTimes(1)
    const smsArg = (sendSms as any).mock.calls[0][0]
    expect(smsArg.to).toBe("+15551112222")
    expect(smsArg.organizationId).toBe("org_1")
    expect(smsArg.message).toContain("missed your call")
  })

  it("does NOT fire missed-call workflow for outbound calls", async () => {
    state.callLog = {
      id: "call_2",
      callSid: "CA_OUT",
      organizationId: "org_1",
      channelConfigId: "twilio-config",
      direction: "outbound", // ← outbound should be skipped
      fromNumber: "+15550000000",
      toNumber: "+15551112222",
    }
    state.rules = [
      {
        id: "rule_1",
        organizationId: "org_1",
        entityType: "call",
        triggerEvent: "missed",
        conditions: {},
        isActive: true,
        actions: [{ actionType: "send_sms", actionConfig: { message: "x" }, actionOrder: 0 }],
      },
    ]

    const req = formRequest({ CallSid: "CA_OUT", CallStatus: "no-answer", CallDuration: "0" })
    await webhookPOST(req)
    await new Promise((r) => setTimeout(r, 10))

    expect(sendSms).not.toHaveBeenCalled()
  })

  it("does NOT fire missed-call workflow for non-terminal or answered statuses", async () => {
    state.callLog = {
      id: "call_3",
      callSid: "CA_OK",
      organizationId: "org_1",
      channelConfigId: "twilio-config",
      direction: "inbound",
      fromNumber: "+15551112222",
      toNumber: "+15553334444",
    }
    state.rules = [
      {
        id: "rule_1",
        organizationId: "org_1",
        entityType: "call",
        triggerEvent: "missed",
        conditions: {},
        isActive: true,
        actions: [{ actionType: "send_sms", actionConfig: { message: "x" }, actionOrder: 0 }],
      },
    ]

    const req = formRequest({ CallSid: "CA_OK", CallStatus: "completed", CallDuration: "42" })
    await webhookPOST(req)
    await new Promise((r) => setTimeout(r, 10))

    expect(sendSms).not.toHaveBeenCalled()
    expect(state.callLog.wasAnswered).toBe(true)
    expect(state.callLog.providerOutcome).toBe("connected")
    expect(state.callLog.targetPhoneE164).toBe("+15551112222")
  })

  it.each([
    ["busy", "busy"],
    ["failed", "failed"],
    ["canceled", "cancelled"],
  ])("maps Twilio terminal %s without claiming it was answered", async (status, providerOutcome) => {
    state.callLog = {
      id: "call_terminal",
      callSid: "CA_TERMINAL",
      organizationId: "org_1",
      channelConfigId: "twilio-config",
      direction: "outbound",
      fromNumber: "+15550000000",
      toNumber: "+15551112222",
      contactId: null,
    }

    await webhookPOST(formRequest({
      CallSid: "CA_TERMINAL",
      CallStatus: status,
      CallDuration: "0",
    }))

    expect(state.callLog.wasAnswered).toBe(false)
    expect(state.callLog.providerOutcome).toBe(providerOutcome)
    expect(state.callLog.targetPhoneE164).toBe("+15551112222")
  })
})
