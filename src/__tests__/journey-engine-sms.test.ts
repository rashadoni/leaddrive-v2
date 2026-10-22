import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockRequestOutboundWebhook, mockSendWhatsAppTemplate } = vi.hoisted(() => ({
  mockRequestOutboundWebhook: vi.fn(),
  mockSendWhatsAppTemplate: vi.fn(),
}))

/**
 * Journey engine SMS step — verifies it routes through sendSms() with
 * { to: recipientPhone, message, organizationId } instead of calling
 * api.twilio.com directly. Covers the missing-phone short-circuit and
 * provider-error reporting.
 */

type JourneyWhatsAppConfig = {
  id: string
  organizationId: string
  channelType: string
  isActive: boolean
  settings: { whatsappJourneyDefaultTemplate?: string }
}

const state: {
  smsCalls: any[]
  sendSmsResult: { success: boolean; messageId?: string; error?: string }
  enrollment: any
  contact: any
  journey: any
  organizationActive: boolean
  sendSmsBarrier: Promise<void> | null
  whatsappConfigs: JourneyWhatsAppConfig[]
  whatsappInboundChannels: string[]
} = {
  smsCalls: [],
  sendSmsResult: { success: true, messageId: "sm_1" },
  enrollment: null,
  contact: null,
  journey: null,
  organizationActive: true,
  sendSmsBarrier: null,
  whatsappConfigs: [],
  whatsappInboundChannels: [],
}

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: any) => {
    state.smsCalls.push(opts)
    if (state.sendSmsBarrier) await state.sendSmsBarrier
    return state.sendSmsResult
  }),
}))

vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppTemplate: mockSendWhatsAppTemplate }))

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
      findFirst: vi.fn(async ({ where }: { where: Partial<JourneyWhatsAppConfig> }) =>
        state.whatsappConfigs.find((channel) => Object.entries(where).every(([key, value]) => channel[key as keyof JourneyWhatsAppConfig] === value)) || null),
      findMany: vi.fn(async ({ where, take }: { where: Partial<JourneyWhatsAppConfig>; take?: number }) =>
        state.whatsappConfigs.filter((channel) => Object.entries(where).every(([key, value]) => channel[key as keyof JourneyWhatsAppConfig] === value)).slice(0, take)),
    },
    channelMessage: {
      findMany: vi.fn(async () => state.whatsappInboundChannels.map((channelConfigId) => ({ channelConfigId }))),
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
  state.whatsappConfigs = []
  state.whatsappInboundChannels = []
  vi.clearAllMocks()
  mockSendWhatsAppTemplate.mockResolvedValue({ success: true, messageId: "wa_1" })
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


/** Runs the real journey engine and channel selector through enrollment claiming,
 * step execution and completion; only the final provider boundary is mocked. */
describe("journey-engine — WhatsApp step sender and saved notification choices", () => {
  function setupWhatsApp(config: Record<string, string> = {}) {
    setupBase({ phone: "+994501234567" })
    state.journey.steps[0].stepType = "send_whatsapp"
    state.journey.steps[0].config = config
    state.whatsappConfigs = [
      { id: "wa_a", organizationId: "org_1", channelType: "whatsapp", isActive: true, settings: { whatsappJourneyDefaultTemplate: "office_a_default" } },
      { id: "wa_b", organizationId: "org_1", channelType: "whatsapp", isActive: true, settings: { whatsappJourneyDefaultTemplate: "office_b_default" } },
    ]
  }

  function expectCompletedWithoutSend(result: Awaited<ReturnType<typeof processEnrollmentStep>>) {
    expect(result.status).toBe("completed")
    expect(mockSendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(sendSms).not.toHaveBeenCalled()
    expect(state.enrollment).toMatchObject({ status: "completed", currentStepId: null, processingToken: null })
  }

  it("passes the explicitly selected sender, template and language through the actual step", async () => {
    setupWhatsApp({ channelConfigId: "wa_b", templateName: "step_update", languageCode: "az" })
    state.whatsappInboundChannels = ["wa_a"]

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result.status).toBe("completed")
    expect(result.message).toContain("WhatsApp sent")
    expect(mockSendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(mockSendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1", channelConfigId: "wa_b", to: "+994501234567",
      templateName: "step_update", languageCode: "az", variables: expect.objectContaining({ "1": "Ali" }),
    }))
    expect(state.enrollment).toMatchObject({ status: "completed", processingToken: null })
  })

  it("uses the receiving sender's default, never another active number's template", async () => {
    setupWhatsApp()
    state.whatsappInboundChannels = ["wa_b"]

    const result = await processEnrollmentStep("enr_1", "org_1")

    expect(result.message).toContain("WhatsApp sent")
    expect(mockSendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(mockSendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({
      channelConfigId: "wa_b", templateName: "office_b_default", organizationId: "org_1",
    }))
  })

  it("does not send when the selected sender's default was explicitly turned off", async () => {
    setupWhatsApp({ channelConfigId: "wa_b" })
    state.whatsappConfigs[1].settings.whatsappJourneyDefaultTemplate = ""

    const result = await processEnrollmentStep("enr_1", "org_1")

    expectCompletedWithoutSend(result)
    expect(result.message).toContain("no template configured")
  })

  it("still honors an explicit step template when only the default is turned off", async () => {
    setupWhatsApp({ channelConfigId: "wa_b", templateName: "explicit_step_message" })
    state.whatsappConfigs[1].settings.whatsappJourneyDefaultTemplate = ""

    await processEnrollmentStep("enr_1", "org_1")

    expect(mockSendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({ channelConfigId: "wa_b", templateName: "explicit_step_message" }))
  })

  it("does not send when the customer has written to two business numbers and none was chosen", async () => {
    setupWhatsApp({ templateName: "shared_name" })
    state.whatsappInboundChannels = ["wa_a", "wa_b"]

    const result = await processEnrollmentStep("enr_1", "org_1")

    expectCompletedWithoutSend(result)
    expect(result.message).toContain("choose an active business number")
  })

  it.each(["disabled", "foreign"] as const)("rejects a %s explicit sender without falling back to the active workspace number", async (reason) => {
    setupWhatsApp({ channelConfigId: "wa_b", templateName: "shared_name" })
    if (reason === "disabled") state.whatsappConfigs[1].isActive = false
    else state.whatsappConfigs[1].organizationId = "other_org"

    const result = await processEnrollmentStep("enr_1", "org_1")

    expectCompletedWithoutSend(result)
    expect(result.message).toContain("choose an active business number")
  })
})
