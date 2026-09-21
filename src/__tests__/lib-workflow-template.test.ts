/**
 * Workflow message variables.
 *
 * Before 2026-09-21 `send_email` sent its body exactly as stored: a welcome
 * that began "Hi {{firstName}}," reached real people with the braces in it,
 * and a lead has no `firstName` field for the SMS path to find either. These
 * tests pin the renderer and prove the engine actually uses it for both the
 * immediate and the delayed path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSendEmail = vi.hoisted(() => vi.fn())
const mockSendSms = vi.hoisted(() => vi.fn())
const mockFindRules = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowRule: { findMany: mockFindRules },
    scheduledAction: { create: vi.fn() },
  },
}))
vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }))
vi.mock("@/lib/sms", () => ({ sendSms: mockSendSms }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn() }))
vi.mock("@/lib/integrations/webhook-url-guard", () => ({ requestOutboundWebhook: vi.fn() }))
vi.mock("@/lib/slack", () => ({ sendSlackNotification: vi.fn(), formatGenericNotification: vi.fn() }))
vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({ recordStageTransition: vi.fn() }))

import { renderWorkflowTemplate, workflowVariableValue } from "@/lib/workflow-template"
import { executeWorkflows, runScheduledAction } from "@/lib/workflow-engine"

const lead = {
  id: "lead-1",
  contactName: "Nigar Əliyeva",
  companyName: "Xəzər Logistika MMC",
  email: "nigar@example.az",
  phone: "+994501234567",
  source: "demo",
}

describe("renderWorkflowTemplate", () => {
  it("gives a lead a first name, which it does not store", () => {
    expect(renderWorkflowTemplate("Salam, {{firstName}}!", lead, "html")).toBe("Salam, Nigar!")
  })

  it("prefers a real firstName field where the record has one", () => {
    const contact = { firstName: "Rəşad", contactName: "Başqa Ad" }
    expect(workflowVariableValue(contact, "firstName")).toBe("Rəşad")
  })

  it("falls back to the contact name when firstName is present but empty", () => {
    expect(workflowVariableValue({ firstName: "", contactName: "Nigar Əliyeva" }, "firstName")).toBe("Nigar")
  })

  it("never leaves braces for a customer to read", () => {
    const rendered = renderWorkflowTemplate("Hi {{firstName}}, {{noSuchField}} {{ companyName }}", lead, "html")
    expect(rendered).toBe("Hi Nigar,  Xəzər Logistika MMC")
    expect(rendered).not.toContain("{{")
  })

  it("escapes values in HTML, because a lead's name is written by outsiders", () => {
    const hostile = { contactName: `<img src=x onerror=alert(1)> Nigar`, companyName: `"ACME" & Co` }
    const rendered = renderWorkflowTemplate("<p>{{contactName}} — {{companyName}}</p>", hostile, "html")
    expect(rendered).toBe("<p>&lt;img src=x onerror=alert(1)&gt; Nigar — &quot;ACME&quot; &amp; Co</p>")
  })

  it("keeps the author's own markup: only substituted values are escaped", () => {
    expect(renderWorkflowTemplate("<b>{{firstName}}</b>", lead, "html")).toBe("<b>Nigar</b>")
  })

  it("flattens line breaks in a header, where the mailer would refuse the whole email", () => {
    const rendered = renderWorkflowTemplate("Welcome, {{companyName}}", { companyName: "ACME\r\nBcc: x@y.z" }, "header")
    expect(rendered).toBe("Welcome, ACME Bcc: x@y.z")
    expect(rendered).not.toMatch(/[\r\n]/)
  })

  it("leaves SMS text as written, where there is no markup to break", () => {
    expect(renderWorkflowTemplate("{{contactName}}", { contactName: "A & <B>" }, "text")).toBe("A & <B>")
  })
})

describe("the workflow engine uses it", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendEmail.mockResolvedValue({ success: true })
    mockSendSms.mockResolvedValue({ success: true })
  })

  it("renders subject and body of an immediate send_email", async () => {
    mockFindRules.mockResolvedValue([
      {
        id: "rule-1",
        conditions: { rules: [{ field: "source", operator: "equals", value: "demo" }] },
        actions: [
          {
            actionType: "send_email",
            actionOrder: 0,
            actionConfig: { subject: "{{firstName}}, xoş gəldiniz!", body: "<p>Salam, {{firstName}}!</p>" },
          },
        ],
      },
    ])

    await executeWorkflows("org-1", "lead", "created", lead)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: "nigar@example.az",
      subject: "Nigar, xoş gəldiniz!",
      html: "<p>Salam, Nigar!</p>",
    })
  })

  it("renders a delayed send_email the same way", async () => {
    await runScheduledAction("org-1", "lead", "send_email", { subject: "Hi {{firstName}}", body: "Hi {{firstName}}" }, lead)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ subject: "Hi Nigar", html: "Hi Nigar" })
  })

  it("gives SMS the same variables it always had, plus firstName", async () => {
    await runScheduledAction("org-1", "lead", "send_sms", { message: "{{firstName}}, {{companyName}}" }, lead)
    expect(mockSendSms.mock.calls[0][0]).toMatchObject({ message: "Nigar, Xəzər Logistika MMC" })
  })
})
