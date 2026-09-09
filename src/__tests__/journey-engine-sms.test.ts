import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockRequestOutboundWebhook } = vi.hoisted(() => ({
  mockRequestOutboundWebhook: vi.fn(),
}))

/**
 * Journey engine SMS step — verifies it routes through sendSms() with
 * { to: recipientPhone, message, organizationId } instead of calling
 * api.twilio.com directly. Covers the missing-phone short-circuit and
 * provider-error reporting.
 */

const state: {
  smsCalls: any[]
  sendSmsResult: { success: boolean; messageId?: string; error?: string }
  enrollment: any
  contact: any
  journey: any
  organizationActive: boolean
  sendSmsBarrier: Promise<void> | null
} = {
  smsCalls: [],
  sendSmsResult: { success: true, messageId: "sm_1" },
  enrollment: null,
  contact: null,
  journey: null,
  organizationActive: true,
  sendSmsBarrier: null,
}

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: any) => {
    state.smsCalls.push(opts)
    if (state.sendSmsBarrier) await state.sendSmsBarrier
    return state.sendSmsResult
  }),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  requestOutboundWebhook: mockRequestOutboundWebhook,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    journeyEnrollment: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (!state.enrollment) return null
        if (where.processingToken && where.processingToken !== state.enrollment.processingToken) return null
        return state.enrollment
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!state.enrollment) return { count: 0 }
        if (where.OR && data.processingToken) {
          const lease = state.enrollment.processingLeaseUntil as Date | null
          if (lease && lease.getTime() > Date.now()) return { count: 0 }
        } else if (where.processingToken && where.processingToken !== state.enrollment.processingToken) {
          return { count: 0 }
        }
        Object.assign(state.enrollment, data)
        return { count: 1 }
      }),
    },
    organization: {
      findFirst: vi.fn(async () => state.organizationActive ? { id: "org_1" } : null),
    },
    journey: {
      findFirst: vi.fn(async () => state.journey),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    journeyStep: {
      update: vi.fn(async () => ({})),
    },
    contact: {
      findFirst: vi.fn(async () => state.contact),
      updateMany: vi.fn(async () => ({ count: state.contact ? 1 : 0 })),
    },
    lead: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    invoice: {
      findFirst: vi.fn(async () => null),
    },
    company: {
      findFirst: vi.fn(async () => null),
    },
    task: {
      create: vi.fn(async () => ({ id: "t_1" })),
    },
    channelConfig: {
      findFirst: vi.fn(async () => null),
    },
  },
}))

import { processEnrollmentStep } from "@/lib/journey-engine"
import { sendSms } from "@/lib/sms"
import { prisma } from "@/lib/prisma"

function setupBase({ phone, message = "Hi" }: { phone: string | null; message?: string }) {
  const step = {
    id: "step_1",
    journeyId: "j1",
    stepType: "sms",
    stepOrder: 0,
    config: { message },
    yesNextStepId: null,
    noNextStepId: null,
  }
  state.enrollment = {
    id: "enr_1",
    organizationId: "org_1",
    status: "active",
    currentStepId: "step_1",
    journeyId: "j1",
    leadId: null,
    contactId: "c1",
    invoiceId: null,
    nextActionAt: new Date(Date.now() - 1_000),
    processingToken: null,
    processingLeaseUntil: null,
    enrolledAt: new Date(),
  }
  state.contact = { id: "c1", phone, fullName: "Ali", email: null }
  state.journey = {
    id: "j1",
    organizationId: "org_1",
    isActive: true,
    steps: [step],
  }
}

beforeEach(() => {
  state.smsCalls = []
  state.sendSmsResult = { success: true, messageId: "sm_1" }
  state.organizationActive = true
  state.sendSmsBarrier = null
  vi.clearAllMocks()
  mockRequestOutboundWebhook.mockResolvedValue({
    ok: true,
    status: 204,
    url: "https://hooks.example.com/journey",
    redirects: 0,
  })
})

describe("journey-engine — SMS step", () => {
  it("calls sendSms with recipient phone, the step message, and orgId", async () => {
    setupBase({ phone: "+994501234567", message: "Hi, we have news" })

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(state.smsCalls[0]).toEqual({
      to: "+994501234567",
      message: "Hi, we have news",
      organizationId: "org_1",
    })
    expect(result.status).toBe("completed")
    expect(result.message).toContain("SMS sent to +994501234567")
  })

  it("skips the send when contact has no phone — still marks step completed", async () => {
    setupBase({ phone: null, message: "Hi" })

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(sendSms).not.toHaveBeenCalled()
    expect(result.status).toBe("completed")
    expect(result.message).toMatch(/SMS skipped/)
  })

  it("reports provider failure in the step message (does not throw)", async () => {
    setupBase({ phone: "+994501234567", message: "Hi" })
    state.sendSmsResult = { success: false, error: "ATL 118: not enough units" }

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result.status).toBe("completed")
    expect(result.message).toContain("SMS error: ATL 118")
  })

  it("allows only one concurrent claimant to send the same step", async () => {
    setupBase({ phone: "+994501234567", message: "Only once" })
    let releaseSms!: () => void
    state.sendSmsBarrier = new Promise<void>((resolve) => { releaseSms = resolve })

    const first = processEnrollmentStep("enr_1", "org_1")
    await vi.waitFor(() => expect(sendSms).toHaveBeenCalledTimes(1))

    const duplicate = await processEnrollmentStep("enr_1", "org_1")
    expect(duplicate).toMatchObject({ status: "skipped", message: "Enrollment is already claimed" })
    expect(sendSms).toHaveBeenCalledTimes(1)

    releaseSms()
    await first
  })

  it("keeps one claim across immediate internal step recursion", async () => {
    setupBase({ phone: "+994501234567", message: "Step one" })
    state.journey.steps.push({
      ...state.journey.steps[0],
      id: "step_2",
      stepOrder: 1,
      config: { message: "Step two" },
    })

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result.status).toBe("completed")
    expect(sendSms).toHaveBeenCalledTimes(2)
    const claimAcquisitions = vi.mocked(prisma.journeyEnrollment.updateMany).mock.calls
      .filter(([args]: any[]) => Array.isArray(args.where?.OR))
    expect(claimAcquisitions).toHaveLength(1)
  })

  it("terminalizes an inactive organization before sending", async () => {
    setupBase({ phone: "+994501234567", message: "Do not send" })
    state.organizationActive = false

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result).toMatchObject({ status: "failed", message: "Organization is inactive" })
    expect(sendSms).not.toHaveBeenCalled()
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        exitReason: "inactive_organization",
        nextActionAt: null,
        processingToken: null,
      }),
    }))
  })

  it("terminalizes a missing journey so it cannot remain at the head of the batch", async () => {
    setupBase({ phone: "+994501234567" })
    state.journey = null

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result).toMatchObject({ status: "failed", message: "Journey not found" })
    expect(sendSms).not.toHaveBeenCalled()
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        exitReason: "invalid_journey",
        nextActionAt: null,
      }),
    }))
  })
})

describe("journey-engine — webhook step", () => {
  it("routes delivery through the DNS-pinned outbound webhook sender", async () => {
    setupBase({ phone: null })
    state.contact.email = "ali@example.com"
    state.journey.steps[0] = {
      ...state.journey.steps[0],
      stepType: "webhook",
      config: { url: "https://hooks.example.com/journey" },
    }

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
    const [url, options] = mockRequestOutboundWebhook.mock.calls[0]
    expect(url).toBe("https://hooks.example.com/journey")
    expect(options).toMatchObject({
      method: "POST",
      timeoutMs: 10_000,
      maxRedirects: 3,
    })
    expect(JSON.parse(options.body)).toMatchObject({
      enrollmentId: "enr_1",
      journeyId: "j1",
      contactId: "c1",
      recipientEmail: "ali@example.com",
    })
    expect(result.message).toContain("Webhook sent")
  })

  it("fails closed before delivery when the enrollment target is not owned by the tenant", async () => {
    setupBase({ phone: null })
    state.contact = null
    state.journey.steps[0] = {
      ...state.journey.steps[0],
      stepType: "webhook",
      config: { url: "https://hooks.example.com/journey" },
    }

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", organizationId: "org_1" },
    })
    expect(result).toMatchObject({ status: "failed", message: "Enrollment target not found" })
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        exitReason: "invalid_target",
        nextActionAt: null,
      }),
    }))
  })
})
