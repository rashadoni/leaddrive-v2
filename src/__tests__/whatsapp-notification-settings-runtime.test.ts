import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", () => ({ prisma: {
  survey: { findFirst: vi.fn(), update: vi.fn() },
  channelConfig: { findFirst: vi.fn(), findMany: vi.fn() },
  channelMessage: { findMany: vi.fn() },
} }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(async () => ({ success: true })) }))
import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendSurveyInvite } from "@/lib/survey-triggers"
const input = { surveyId: "survey", organizationId: "org_1", phone: "+994501234567", channel: "whatsapp" as const, baseUrl: "https://example.test" }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.survey.findFirst).mockResolvedValue({ id: "survey", name: "How was it?", publicSlug: "feedback" } as never)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ channelConfigId: "wa_b" }] as never)
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "wa_b", settings: {} } as never)
})
describe("saved WhatsApp notification choices", () => {
  it("does not send plain text after an explicit Do not send choice", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "wa_b", settings: { whatsappSurveyTemplate: "" } } as never)
    expect(await sendSurveyInvite(input)).toEqual({ ok: false, error: "WhatsApp survey notifications disabled" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prisma.survey.update).not.toHaveBeenCalled()
  })
  it("sends the selected template from the business number that received the customer", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "wa_b", settings: { whatsappSurveyTemplate: "survey_b" } } as never)
    expect(await sendSurveyInvite(input)).toEqual({ ok: true })
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ channelConfigId: "wa_b", templateName: "survey_b", organizationId: "org_1" }))
  })
  it("preserves legacy session-text behavior until the owner saves new choices", async () => {
    expect(await sendSurveyInvite(input)).toEqual({ ok: true })
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ channelConfigId: "wa_b", message: expect.stringContaining("How was it?") }))
  })
  it("does not guess an automation sender for a customer of two numbers", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ channelConfigId: "wa_a" }, { channelConfigId: "wa_b" }] as never)
    expect(await sendSurveyInvite(input)).toEqual({ ok: false, error: "whatsapp_channel_required" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
