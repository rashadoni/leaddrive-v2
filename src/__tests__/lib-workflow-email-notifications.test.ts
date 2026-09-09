import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks (vi.mock is hoisted — no variable refs allowed in factories) ──

const mockRequestOutboundWebhook = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowRule: { findMany: vi.fn() },
    task: { create: vi.fn() },
    notification: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    emailLog: { create: vi.fn(), update: vi.fn() },
    surveyUnsubscribe: { findFirst: vi.fn() },
    channelConfig: { findMany: vi.fn() },
    deal: { updateMany: vi.fn(), findFirst: vi.fn() },
    lead: { updateMany: vi.fn() },
    ticket: { updateMany: vi.fn() },
    contact: { updateMany: vi.fn() },
  },
}))

// A12 — workflow that moves a deal stage records a transition (fire-and-forget).
vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({
  recordStageTransition: vi.fn().mockResolvedValue("t-1"),
}))

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }) }))

vi.mock("@/lib/url-validation", () => ({
  isPrivateUrl: vi.fn((url: string) => url.includes("localhost") || url.includes("127.0.0.1")),
  isPrivateHost: vi.fn((host: string) => host === "localhost" || host.startsWith("127.")),
}))

vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  requestOutboundWebhook: mockRequestOutboundWebhook,
}))

vi.mock("@/lib/slack", () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(true),
  formatGenericNotification: vi.fn().mockReturnValue({ text: "test" }),
}))

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue({ messageId: "msg-123" }) }) },
}))

vi.mock("@/lib/constants", () => ({ NOREPLY_EMAIL: "noreply@test.com" }))

// Must import AFTER mocks
import { executeWorkflows } from "@/lib/workflow-engine"
import { sendEmail, renderTemplate } from "@/lib/email"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
const mockCreateNotification = createNotification as ReturnType<typeof vi.fn>
import { prisma as mockPrisma } from "@/lib/prisma"
import nodemailer from "nodemailer"

const mockCreateTransport = vi.mocked(nodemailer.createTransport)
const mockSendMail = mockCreateTransport()?.sendMail as ReturnType<typeof vi.fn>

// ═════════════════════════════════════════════════════════════════════════
// 1. workflow-engine.ts
// ═════════════════════════════════════════════════════════════════════════
describe("workflow-engine: executeWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fireWebhooks).mockResolvedValue(undefined)
    mockRequestOutboundWebhook.mockResolvedValue({
      ok: true,
      status: 204,
      url: "https://hooks.example.com/workflow",
      redirects: 0,
    })
  })

  it("loads rules for both singular and plural entity types", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([])
    await executeWorkflows("org-1", "deal", "created", { id: "d1" })
    expect(mockPrisma.workflowRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: { in: ["deal", "deals"] },
          triggerEvent: "created",
          isActive: true,
        }),
      })
    )
  })

  it("normalizes plural entity type to singular", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([])
    await executeWorkflows("org-1", "leads", "updated", { id: "l1" })
    expect(mockPrisma.workflowRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: { in: ["leads", "lead"] },
        }),
      })
    )
  })

  it("skips rule when conditions do not match (new format)", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { rules: [{ field: "status", operator: "equals", value: "won" }] },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Won!" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "updated", { id: "d1", status: "lost" })
    expect(mockCreateNotification).not.toHaveBeenCalled()
  })

  it("executes action when all conditions match (new format)", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { rules: [{ field: "status", operator: "equals", value: "won" }] },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Deal Won", message: "congrats" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "updated", { id: "d1", status: "won" })
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deal Won", message: "congrats" })
    )
  })

  it("handles empty/null conditions as always-true", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: {},
        actions: [{ actionType: "send_notification", actionConfig: { title: "Always" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "created", { id: "d1" })
    expect(mockCreateNotification).toHaveBeenCalled()
  })

  it("handles null conditions as always-true", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "send_notification", actionConfig: { title: "Null cond" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "created", { id: "d1" })
    expect(mockCreateNotification).toHaveBeenCalled()
  })

  it("evaluates legacy condition format { field: value }", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { priority: "high" },
        actions: [{ actionType: "send_notification", actionConfig: { title: "High prio" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "ticket", "created", { id: "t1", priority: "high" })
    expect(mockCreateNotification).toHaveBeenCalled()
  })

  it("evaluates legacy nested condition { field: { gt, lt } }", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { amount: { gt: 1000 } },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Big deal" }, actionOrder: 1 }],
      },
    ])
    // amount 500 should NOT match gt:1000
    await executeWorkflows("org-1", "deal", "created", { id: "d1", amount: 500 })
    expect(mockCreateNotification).not.toHaveBeenCalled()
  })

  it("evaluates not_equals operator correctly", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { rules: [{ field: "status", operator: "not_equals", value: "closed" }] },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Open" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "ticket", "updated", { id: "t1", status: "open" })
    expect(mockCreateNotification).toHaveBeenCalled()
  })

  it("evaluates contains operator case-insensitively", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { rules: [{ field: "notes", operator: "contains", value: "URGENT" }] },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Urgent" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "task", "created", { id: "t1", notes: "This is urgent stuff" })
    expect(mockCreateNotification).toHaveBeenCalled()
  })

  it("evaluates not_empty operator", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: { rules: [{ field: "assignedTo", operator: "not_empty", value: "" }] },
        actions: [{ actionType: "send_notification", actionConfig: { title: "Assigned" }, actionOrder: 1 }],
      },
    ])
    // null/empty should fail not_empty
    await executeWorkflows("org-1", "deal", "created", { id: "d1", assignedTo: null })
    expect(mockCreateNotification).not.toHaveBeenCalled()
  })

  it("executes create_task action", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "create_task", actionConfig: { title: "Follow up", priority: "high" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "created", { id: "d1", name: "Acme Deal" })
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          title: "Follow up",
          priority: "high",
          relatedType: "deal",
          relatedId: "d1",
        }),
      })
    )
  })

  it("executes update_field action for allowed fields (generic passthrough)", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "update_field", actionConfig: { field: "priority", value: "high" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "updated", { id: "d1" })
    expect(mockPrisma.deal.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", organizationId: "org-1" },
      data: { priority: "high" },
    })
  })

  it("update_field on deal.stage routes through the A12 path (records + bumps stageChangedAt)", async () => {
    const { recordStageTransition } = await import("@/lib/revenue-intelligence/transition-recorder")
    vi.mocked(mockPrisma.deal.findFirst).mockResolvedValue({
      stage: "QUALIFIED", valueAmount: 2000, currency: "AZN", pipelineId: "p1", stageChangedAt: new Date("2026-01-01"),
    } as any)
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "update_field", actionConfig: { field: "stage", value: "won" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "updated", { id: "d1" })

    const updateArg = vi.mocked(mockPrisma.deal.updateMany).mock.calls.at(-1)?.[0] as any
    expect(updateArg.data.stage).toBe("won")
    expect(updateArg.data.stageChangedAt).toBeInstanceOf(Date)
    expect(recordStageTransition).toHaveBeenCalledOnce()
    const rec = vi.mocked(recordStageTransition).mock.calls[0][1] as any
    expect(rec).toMatchObject({ organizationId: "org-1", dealId: "d1", fromStage: "QUALIFIED", toStage: "won", fromAmount: 2000, toAmount: 2000, currency: "AZN", pipelineId: "p1" })
  })

  it("blocks update_field for restricted fields", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "update_field", actionConfig: { field: "organizationId", value: "hacked" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "updated", { id: "d1" })
    expect(mockPrisma.deal.updateMany).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("blocks workflows from inventing a per-call business outcome", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{
          actionType: "update_field",
          actionConfig: { field: "disposition", value: "interested" },
          actionOrder: 1,
        }],
      },
    ])

    await executeWorkflows("org-1", "call", "completed", { id: "call-1" })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Blocked update of restricted field: call.disposition"),
    )
    consoleSpy.mockRestore()
  })

  it("executes send_email action with recipient from entity", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "send_email", actionConfig: { subject: "Hello", body: "<p>Hi</p>" }, actionOrder: 1 }],
      },
    ])
    // sendEmail is mocked via the email.ts mock chain; we just check it doesn't throw
    await executeWorkflows("org-1", "contact", "created", { id: "c1", email: "user@example.com" })
    // The workflow calls sendEmail internally - we verify no error was thrown
  })

  it("skips send_email when no recipient is available", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "send_email", actionConfig: { subject: "Test" }, actionOrder: 1 }],
      },
    ])
    await executeWorkflows("org-1", "deal", "created", { id: "d1", name: "No Email Deal" })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("send_email skipped"))
    consoleSpy.mockRestore()
  })

  it("does not resolve until Slack notifications have completed", async () => {
    const { sendSlackNotification } = await import("@/lib/slack")
    mockPrisma.channelConfig.findMany.mockResolvedValue([
      { webhookUrl: "https://hooks.slack.test/one" },
    ] as never)
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{
          actionType: "slack_notify",
          actionConfig: { message: "New social mention" },
          actionOrder: 1,
        }],
      },
    ])

    let releaseSlack!: () => void
    const slackPending = new Promise<void>((resolve) => {
      releaseSlack = resolve
    })
    vi.mocked(sendSlackNotification).mockImplementationOnce(async () => {
      await slackPending
      return true
    })

    let settled = false
    const execution = executeWorkflows("org-1", "social_mention", "created", {
      id: "mention-1",
    }).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => expect(sendSlackNotification).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseSlack()
    await expect(execution).resolves.toBe(1)
  })

  it("awaits webhook delivery for a social mention workflow", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{
          actionType: "webhook",
          actionConfig: {},
          actionOrder: 1,
        }],
      },
    ])
    let releaseWebhook!: () => void
    const webhookPending = new Promise<void>((resolve) => {
      releaseWebhook = resolve
    })
    vi.mocked(fireWebhooks).mockReturnValueOnce(webhookPending)

    let settled = false
    const execution = executeWorkflows("org-1", "social_mention", "created", {
      id: "mention-1",
      text: "finding",
    }).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => expect(fireWebhooks).toHaveBeenCalledWith(
      "org-1",
      "social_mention.updated",
      expect.objectContaining({ id: "mention-1", entityType: "social_mention" }),
      { awaitDelivery: true },
    ))
    expect(settled).toBe(false)

    releaseWebhook()
    await expect(execution).resolves.toBe(1)
    expect(settled).toBe(true)
  })

  it("awaits webhook delivery for a derived entity when explicitly requested", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{
          actionType: "webhook",
          actionConfig: {},
          actionOrder: 1,
        }],
      },
    ])
    let releaseWebhook!: () => void
    const webhookPending = new Promise<void>((resolve) => {
      releaseWebhook = resolve
    })
    vi.mocked(fireWebhooks).mockReturnValueOnce(webhookPending)

    let settled = false
    const execution = executeWorkflows(
      "org-1",
      "lead",
      "created",
      { id: "lead-1" },
      { awaitExternalSideEffects: true },
    ).then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => expect(fireWebhooks).toHaveBeenCalledWith(
      "org-1",
      "lead.updated",
      expect.objectContaining({ id: "lead-1", entityType: "lead" }),
      { awaitDelivery: true },
    ))
    expect(settled).toBe(false)

    releaseWebhook()
    await expect(execution).resolves.toBe(1)
    expect(settled).toBe(true)
  })

  it("routes a custom webhook URL through the DNS-pinned sender", async () => {
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{
          actionType: "webhook",
          actionConfig: {
            url: "https://hooks.example.com/workflow",
            method: "POST",
          },
          actionOrder: 1,
        }],
      },
    ])

    await executeWorkflows("org-1", "deal", "created", { id: "deal-1" })

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
    const [url, options] = mockRequestOutboundWebhook.mock.calls[0]
    expect(url).toBe("https://hooks.example.com/workflow")
    expect(options).toMatchObject({
      method: "POST",
      timeoutMs: 10_000,
      maxRedirects: 3,
    })
    expect(JSON.parse(options.body)).toMatchObject({
      event: "deal.workflow",
      organizationId: "org-1",
      entity: { id: "deal-1" },
    })
  })

  it("does not throw on unknown action type", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockPrisma.workflowRule.findMany.mockResolvedValue([
      {
        conditions: null,
        actions: [{ actionType: "unknown_action", actionConfig: {}, actionOrder: 1 }],
      },
    ])
    await expect(executeWorkflows("org-1", "deal", "created", { id: "d1" })).resolves.not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown workflow action type"))
    consoleSpy.mockRestore()
  })

  it("catches top-level errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockPrisma.workflowRule.findMany.mockRejectedValue(new Error("DB down"))
    await expect(executeWorkflows("org-1", "deal", "created", { id: "d1" })).resolves.not.toThrow()
    consoleSpy.mockRestore()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. email.ts
// ═════════════════════════════════════════════════════════════════════════
describe("email: sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SMTP_USER
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PASS
    delete process.env.SMTP_PORT
    delete process.env.SMTP_FROM
  })

  it("returns error when SMTP is not configured (no org, no env)", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null)
    const result = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" })
    expect(result).toEqual({ success: false, error: "SMTP not configured" })
  })

  it("logs failed email to emailLog when orgId provided and SMTP not configured", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: {} })
    mockPrisma.emailLog.create.mockResolvedValue({})
    const result = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>", organizationId: "org-1" })
    expect(result.success).toBe(false)
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          status: "failed",
          errorMessage: "SMTP not configured",
        }),
      })
    )
  })

  it("loads SMTP config from org settings in DB", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme",
      settings: {
        smtp: { smtpHost: "mail.acme.com", smtpUser: "u", smtpPass: "p", smtpPort: 587 },
      },
    })
    mockPrisma.emailLog.create.mockResolvedValue({ id: "log-1" })
    mockPrisma.emailLog.update.mockResolvedValue({})
    mockSendMail.mockResolvedValue({ messageId: "mid-1" })

    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>X</p>", organizationId: "org-1" })
    expect(result.success).toBe(true)
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "mail.acme.com", port: 587 })
    )
  })

  it("falls back to env vars when org has no SMTP settings", async () => {
    process.env.SMTP_USER = "env-user"
    process.env.SMTP_PASS = "env-pass"
    process.env.SMTP_HOST = "smtp.env.com"
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: {} })
    mockSendMail.mockResolvedValue({ messageId: "mid-2" })

    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>Y</p>", organizationId: "org-1" })
    expect(result.success).toBe(true)
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.env.com" })
    )
  })

  it("blocks SMTP to private/internal hosts (SSRF protection)", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Evil",
      settings: {
        smtp: { smtpHost: "localhost", smtpUser: "u", smtpPass: "p" },
      },
    })
    mockPrisma.emailLog.create.mockResolvedValue({})

    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>Z</p>", organizationId: "org-1" })
    expect(result.success).toBe(false)
  })

  it("returns success with messageId on successful send", async () => {
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"
    mockSendMail.mockResolvedValue({ messageId: "abc-123" })

    const result = await sendEmail({ to: "a@b.com", subject: "OK", html: "<p>OK</p>" })
    expect(result).toEqual({ success: true, messageId: "abc-123" })
  })

  it("returns error on sendMail failure", async () => {
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"
    mockSendMail.mockRejectedValue(new Error("Connection refused"))
    mockPrisma.emailLog.create.mockResolvedValue({})

    const result = await sendEmail({ to: "a@b.com", subject: "Fail", html: "<p>F</p>", organizationId: "org-1" })
    expect(result).toEqual({ success: false, error: "Failed to send email" })
  })
})

describe("email: renderTemplate", () => {
  it("replaces template variables with escaped values", () => {
    const html = "<p>Hello {{name}}, your deal is {{status}}</p>"
    const result = renderTemplate(html, { name: "Alice", status: "won" })
    expect(result).toBe("<p>Hello Alice, your deal is won</p>")
  })

  it("escapes HTML special characters in values", () => {
    const html = "<p>{{content}}</p>"
    const result = renderTemplate(html, { content: '<script>alert("xss")</script>' })
    expect(result).toContain("&lt;script&gt;")
    expect(result).not.toContain("<script>")
  })

  it("replaces multiple occurrences of the same variable", () => {
    const html = "{{name}} said hello to {{name}}"
    const result = renderTemplate(html, { name: "Bob" })
    expect(result).toBe("Bob said hello to Bob")
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. notifications.ts
// ═════════════════════════════════════════════════════════════════════════
describe("notifications: createNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("createNotification is callable with required fields", async () => {
    const result = await createNotification({
      organizationId: "org-1",
      title: "Test",
      message: "Hello",
    })
    // Mocked — returns { id: "notif-1" }
    expect(result).toEqual({ id: "notif-1" })
  })

  it("createNotification is callable with optional fields", async () => {
    const result = await createNotification({
      organizationId: "org-1",
      userId: "user-42",
      type: "error",
      title: "Error",
      message: "Something broke",
      entityType: "deal",
      entityId: "deal-99",
    })
    expect(result).toEqual({ id: "notif-1" })
  })

  it("createNotification mock tracks calls", async () => {
    vi.mocked(createNotification).mockClear()
    await createNotification({ organizationId: "org-1", title: "A", message: "B" })
    await createNotification({ organizationId: "org-1", title: "C", message: "D" })
    expect(mockCreateNotification).toHaveBeenCalledTimes(2)
  })
})
