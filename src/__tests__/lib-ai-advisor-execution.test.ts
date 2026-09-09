import { beforeEach, describe, expect, it, vi } from "vitest"

const db = {
  taskFindFirst: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateMany: vi.fn(),
  dealUpdateMany: vi.fn(),
  leadUpdateMany: vi.fn(),
  ticketUpdateMany: vi.fn(),
  activityFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  userFindMany: vi.fn(),
  notificationCreate: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiShadowAction: {
      updateMany: vi.fn(),
    },
    task: {
      findFirst: (...args: unknown[]) => db.taskFindFirst(...args),
      create: (...args: unknown[]) => db.taskCreate(...args),
      updateMany: (...args: unknown[]) => db.taskUpdateMany(...args),
    },
    deal: {
      updateMany: (...args: unknown[]) => db.dealUpdateMany(...args),
    },
    lead: {
      updateMany: (...args: unknown[]) => db.leadUpdateMany(...args),
    },
    ticket: {
      updateMany: (...args: unknown[]) => db.ticketUpdateMany(...args),
    },
    activity: {
      findFirst: (...args: unknown[]) => db.activityFindFirst(...args),
      create: (...args: unknown[]) => db.activityCreate(...args),
    },
    user: {
      findMany: (...args: unknown[]) => db.userFindMany(...args),
    },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => db.notificationCreate(...args),
}))

import {
  advisorAlertNotificationType,
  advisorShadowActionAuditName,
  advisorShadowExecutionAuditValue,
  advisorTicketPriority,
  advisorTaskPriority,
  claimAdvisorShadowActionForExecution,
  executeAdvisorShadowAction,
  isAdvisorEditablePayload,
  validateAdvisorEditedPayload,
} from "@/lib/ai/advisor/execution"
import {
  advisorPreviewValue,
  buildAdvisorActionPreviewEntries,
  buildAdvisorEditablePayloadFields,
  type AdvisorActionPreviewLabels,
} from "@/lib/ai/advisor/action-preview"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  db.taskFindFirst.mockResolvedValue(null)
  db.taskCreate.mockResolvedValue({ id: "task-1" })
  db.taskUpdateMany.mockResolvedValue({ count: 1 })
  db.dealUpdateMany.mockResolvedValue({ count: 1 })
  db.leadUpdateMany.mockResolvedValue({ count: 1 })
  db.ticketUpdateMany.mockResolvedValue({ count: 1 })
  db.activityFindFirst.mockResolvedValue(null)
  db.activityCreate.mockResolvedValue({ id: "activity-1" })
  db.userFindMany.mockResolvedValue([{ id: "manager-1" }])
  db.notificationCreate.mockResolvedValue({ id: "notification-1" })
})

const previewLabels: AdvisorActionPreviewLabels = {
  taskTitle: "Task",
  alertTitle: "Alert",
  noteSubject: "Note",
  followupSubject: "Subject",
  budgetTitle: "Budget review",
  description: "Description",
  message: "Message",
  body: "Draft",
  assignee: "Assignee",
  priority: "Priority",
  amount: "Amount",
  relatedRecord: "Related record",
  company: "Company",
  invoice: "Invoice",
  daysOverdue: "Days overdue",
}

describe("advisor execution helpers", () => {
  it("derives task priority from advisor severity and shadow action risk", () => {
    expect(advisorTaskPriority("medium", { advisor: { severity: "critical" } })).toBe("urgent")
    expect(advisorTaskPriority("high", { advisor: { severity: "medium" } })).toBe("high")
    expect(advisorTaskPriority("low", { advisor: { risk: "low" } })).toBe("low")
    expect(advisorTaskPriority("medium", { daysSinceActivity: 20 })).toBe("high")
  })

  it("preserves explicit task priority from payload", () => {
    expect(advisorTaskPriority("medium", { priority: "high", advisor: { severity: "low" } })).toBe("high")
  })

  it("derives alert notification type from advisor severity and risk", () => {
    expect(advisorAlertNotificationType("medium", { advisor: { severity: "critical" } })).toBe("warning")
    expect(advisorAlertNotificationType("high", { advisor: { severity: "medium" } })).toBe("warning")
    expect(advisorAlertNotificationType("low", { advisor: { risk: "low" } })).toBe("info")
  })

  it("derives ticket priority updates from Advisor severity, risk and explicit payload", () => {
    expect(advisorTicketPriority("medium", { priority: "critical" })).toBe("critical")
    expect(advisorTicketPriority("dangerous", { advisor: { severity: "high" } })).toBe("critical")
    expect(advisorTicketPriority("high", { advisor: { risk: "medium" } })).toBe("urgent")
    expect(advisorTicketPriority("low", { advisor: { risk: "low" } })).toBe("medium")
    expect(advisorTicketPriority("medium", {})).toBe("high")
  })

  it("accepts only JSON objects as editable Advisor action payloads", () => {
    expect(isAdvisorEditablePayload({ title: "Follow up" })).toBe(true)
    expect(isAdvisorEditablePayload([])).toBe(false)
    expect(isAdvisorEditablePayload(null)).toBe(false)
    expect(isAdvisorEditablePayload("bad")).toBe(false)
  })

  it("validates typed Advisor edits without allowing target retargeting", () => {
    const action = {
      featureName: "advisor_signal",
      actionType: "create_task",
      entityType: "deal",
      entityId: "deal-1",
      payload: {
        title: "Follow up",
        description: "Confirm next step",
        relatedType: "deal",
        relatedId: "deal-1",
        advisor: { signalId: "sales:deal-1" },
      },
    }

    expect(validateAdvisorEditedPayload(action, {
      title: "Follow up today",
      description: "Confirm next step and update close plan",
      assignedTo: "user-2",
      relatedType: "deal",
      relatedId: "deal-1",
      advisor: { signalId: "sales:deal-1" },
    })).toMatchObject({
      ok: true,
      payload: expect.objectContaining({
        title: "Follow up today",
        relatedId: "deal-1",
      }),
    })

    expect(validateAdvisorEditedPayload(action, {
      title: "Retarget",
      description: "Move this action",
      relatedType: "deal",
      relatedId: "deal-2",
    })).toEqual({
      ok: false,
      error: "Advisor action target cannot be changed",
    })
  })

  it("rejects unsupported Advisor action schemas before approval", () => {
    expect(validateAdvisorEditedPayload({
      featureName: "advisor_signal",
      actionType: "send_money",
      entityType: "invoice",
      entityId: "invoice-1",
      payload: { advisor: true },
    }, { title: "Pay now", relatedType: "invoice", relatedId: "invoice-1" })).toEqual({
      ok: false,
      error: "Unsupported Advisor action type: send_money",
    })
  })

  it("executes Advisor invoice and route actions as real tasks", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")

    await expect(executeAdvisorShadowAction({
      id: "shadow-1",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "invoice_reminder",
      entityType: "invoice",
      entityId: "invoice-1",
      riskLevel: "high",
      payload: {
        title: "Collect overdue invoice",
        message: "Confirm payment plan.",
        relatedType: "invoice",
        relatedId: "invoice-1",
        advisor: { severity: "high" },
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-2",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "flag_route_issue",
      entityType: "mtm_route",
      entityId: "route-1",
      riskLevel: "medium",
      payload: {
        title: "Route has missed stops",
        description: "Supervisor should review missed stops.",
        relatedType: "mtm_route",
        relatedId: "route-1",
        advisor: { severity: "medium" },
      },
    }, now)).resolves.toBe(true)

    expect(db.taskCreate).toHaveBeenCalledTimes(2)
    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        title: "Collect overdue invoice",
        relatedType: "invoice",
        relatedId: "invoice-1",
        priority: "high",
        status: "pending",
      }),
    })
    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Route has missed stops",
        relatedType: "mtm_route",
        relatedId: "route-1",
      }),
    })
  })

  it("executes Advisor assign_task without creating duplicate tasks", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")

    await expect(executeAdvisorShadowAction({
      id: "shadow-assign",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "assign_task",
      entityType: "task",
      entityId: "task-1",
      riskLevel: "medium",
      payload: {
        assignedTo: "user-2",
        relatedType: "task",
        relatedId: "task-1",
        advisor: { severity: "medium" },
      },
    }, now)).resolves.toBe(true)

    expect(db.taskUpdateMany).toHaveBeenCalledWith({
      where: { id: "task-1", organizationId: "org-1" },
      data: { assignedTo: "user-2" },
    })
    expect(db.taskCreate).not.toHaveBeenCalled()
  })

  it("executes Advisor notes and alerts as real artifacts", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")

    await expect(executeAdvisorShadowAction({
      id: "shadow-note",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "create_note",
      entityType: "deal",
      entityId: "deal-1",
      riskLevel: "low",
      payload: {
        subject: "Advisor risk note",
        description: "Deal has no next step.",
        relatedType: "deal",
        relatedId: "deal-1",
        advisor: { severity: "medium" },
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-alert",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "create_alert",
      entityType: "ticket",
      entityId: "ticket-1",
      riskLevel: "high",
      payload: {
        title: "SLA risk",
        message: "Escalate before breach.",
        relatedType: "ticket",
        relatedId: "ticket-1",
        advisor: { severity: "high" },
      },
    }, now)).resolves.toBe(true)

    expect(db.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "note",
        subject: "Advisor risk note",
        description: "Deal has no next step.",
        relatedType: "deal",
        relatedId: "deal-1",
      }),
    })
    expect(db.notificationCreate).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "manager-1",
      type: "warning",
      title: "SLA risk",
      message: "Escalate before breach.",
      entityType: "ticket",
      entityId: "ticket-1",
    })
  })

  it("executes module-specific Advisor actions with safe artifacts", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")

    await expect(executeAdvisorShadowAction({
      id: "shadow-contract",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "contract_review",
      entityType: "contract",
      entityId: "contract-1",
      riskLevel: "medium",
      payload: {
        title: "Review contract renewal",
        description: "Prepare renewal plan before end date.",
        relatedType: "contract",
        relatedId: "contract-1",
        advisor: { severity: "high" },
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-support",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "support_escalation",
      entityType: "ticket",
      entityId: "ticket-1",
      riskLevel: "high",
      payload: {
        title: "SLA risk",
        message: "Escalate this ticket today.",
        relatedType: "ticket",
        relatedId: "ticket-1",
        advisor: { severity: "critical" },
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-kpi",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "kpi_plan_review",
      entityType: "user",
      entityId: "user-1",
      riskLevel: "low",
      payload: {
        title: "Review manager action plan",
        description: "Check overdue work and response gaps.",
        assignedTo: "user-1",
        relatedType: "user",
        relatedId: "user-1",
        advisor: { severity: "medium" },
      },
    }, now)).resolves.toBe(true)

    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Review contract renewal",
        relatedType: "contract",
        relatedId: "contract-1",
      }),
    })
    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "SLA risk",
        relatedType: "ticket",
        relatedId: "ticket-1",
        priority: "urgent",
      }),
    })
    expect(db.notificationCreate).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "manager-1",
      type: "warning",
      title: "SLA risk",
      message: "Escalate this ticket today.",
      entityType: "ticket",
      entityId: "ticket-1",
    })
    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Review manager action plan",
        assignedTo: "user-1",
        relatedType: "user",
        relatedId: "user-1",
      }),
    })
  })

  it("validates production Advisor action aliases before approval", () => {
    const aliasPayloads: Array<{ actionType: string; payload: Record<string, unknown> }> = [
      { actionType: "create_followup_task", payload: { title: "Follow up", description: "Call customer", relatedType: "contact", relatedId: "contact-1" } },
      { actionType: "assign_owner", payload: { assignedTo: "owner-1", relatedType: "contact", relatedId: "contact-1" } },
      { actionType: "update_health_note", payload: { subject: "Health risk", description: "Customer is idle.", relatedType: "contact", relatedId: "contact-1" } },
      { actionType: "stage_alert", payload: { title: "Stage risk", message: "Deal is stuck.", relatedType: "deal", relatedId: "deal-1" } },
      { actionType: "quote_reminder", payload: { title: "Quote reminder", description: "Confirm buyer decision.", relatedType: "quote", relatedId: "quote-1" } },
      { actionType: "approval_escalation", payload: { title: "Approval blocked", description: "Escalate reviewer.", relatedType: "contract", relatedId: "contract-1" } },
      { actionType: "signature_reminder", payload: { title: "Signature reminder", description: "Confirm signer status.", relatedType: "contract", relatedId: "contract-1" } },
      { actionType: "segment_review_task", payload: { title: "Review segment", description: "No clicks after sends.", relatedType: "campaign", relatedId: "campaign-1" } },
      { actionType: "unblock_task", payload: { title: "Unblock task", description: "Review owner and blocker.", relatedType: "task", relatedId: "task-1" } },
      { actionType: "escalate_overdue_task", payload: { title: "Escalate overdue", description: "Task is overdue.", relatedType: "task", relatedId: "task-1" } },
      { actionType: "bill_payment_escalation", payload: { title: "Payment escalation", description: "Bill is overdue.", relatedType: "bill", relatedId: "bill-1" } },
      { actionType: "assign_ticket_owner", payload: { assignedTo: "support-1", relatedType: "ticket", relatedId: "ticket-1" } },
      { actionType: "priority_update", payload: { title: "Priority risk", message: "Review ticket priority.", relatedType: "ticket", relatedId: "ticket-1" } },
      { actionType: "route_issue", payload: { title: "Route issue", description: "Route is behind plan.", relatedType: "mtm_route", relatedId: "route-1" } },
      { actionType: "missed_visit_task", payload: { title: "Missed visit", description: "Confirm skipped stop.", relatedType: "mtm_visit", relatedId: "visit-1" } },
      { actionType: "coaching_task", payload: { title: "Coaching task", description: "Review manager plan.", relatedType: "user", relatedId: "user-1" } },
    ]

    for (const item of aliasPayloads) {
      expect(validateAdvisorEditedPayload({
        featureName: "advisor_signal",
        actionType: item.actionType,
        entityType: String(item.payload.relatedType),
        entityId: String(item.payload.relatedId),
        payload: item.payload,
      }, item.payload)).toMatchObject({ ok: true })
    }
  })

  it("executes production Advisor aliases through audited safe primitives", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")

    await expect(executeAdvisorShadowAction({
      id: "shadow-assign-owner",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "assign_owner",
      entityType: "contact",
      entityId: "contact-1",
      riskLevel: "low",
      payload: {
        assignedTo: "owner-1",
        relatedType: "contact",
        relatedId: "contact-1",
        advisor: { severity: "medium" },
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-approval",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "approval_escalation",
      entityType: "contract",
      entityId: "contract-1",
      riskLevel: "medium",
      payload: {
        title: "Approval blocked",
        description: "Escalate the reviewer and unblock the contract.",
        relatedType: "contract",
        relatedId: "contract-1",
      },
    }, now)).resolves.toBe(true)

    await expect(executeAdvisorShadowAction({
      id: "shadow-health-note",
      organizationId: "org-1",
      featureName: "advisor_signal",
      actionType: "update_health_note",
      entityType: "contact",
      entityId: "contact-1",
      riskLevel: "low",
      payload: {
        subject: "Advisor health risk",
        description: "Customer is idle and needs owner review.",
        relatedType: "contact",
        relatedId: "contact-1",
      },
    }, now)).resolves.toBe(true)

    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Assign owner for contact",
        assignedTo: "owner-1",
        relatedType: "contact",
        relatedId: "contact-1",
      }),
    })
    expect(db.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Approval blocked",
        relatedType: "contract",
        relatedId: "contract-1",
      }),
    })
    expect(db.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "note",
        subject: "Advisor health risk",
        relatedType: "contact",
        relatedId: "contact-1",
      }),
    })
  })

  it("executes every production Advisor action type through approval-safe side effects", async () => {
    const now = new Date("2026-06-27T08:00:00.000Z")
    const cases: Array<{
      actionType: string
      entityType: string
      entityId: string
      payload: Record<string, unknown>
      sideEffect: "task" | "task_update" | "owner_update" | "ticket_owner_update" | "ticket_priority_update" | "note" | "notification" | "task_and_notification"
      expectedTitle?: string
      expectedSubject?: string
    }> = [
      { actionType: "create_task", entityType: "deal", entityId: "deal-1", payload: { title: "Sales follow-up", description: "Call buyer.", relatedType: "deal", relatedId: "deal-1" }, sideEffect: "task", expectedTitle: "Sales follow-up" },
      { actionType: "create_followup_task", entityType: "contact", entityId: "contact-1", payload: { title: "CRM follow-up", description: "Reconnect contact.", relatedType: "contact", relatedId: "contact-1" }, sideEffect: "task", expectedTitle: "CRM follow-up" },
      { actionType: "quote_reminder", entityType: "quote", entityId: "quote-1", payload: { title: "Quote reminder", description: "Confirm quote status.", relatedType: "quote", relatedId: "quote-1" }, sideEffect: "task", expectedTitle: "Quote reminder" },
      { actionType: "unblock_task", entityType: "task", entityId: "task-blocked", payload: { title: "Unblock task", description: "Remove blocker.", relatedType: "task", relatedId: "task-blocked" }, sideEffect: "task", expectedTitle: "Unblock task" },
      { actionType: "escalate_overdue_task", entityType: "task", entityId: "task-overdue", payload: { title: "Escalate overdue task", description: "Manager review.", relatedType: "task", relatedId: "task-overdue" }, sideEffect: "task", expectedTitle: "Escalate overdue task" },
      { actionType: "bill_payment_escalation", entityType: "bill", entityId: "bill-1", payload: { title: "Bill payment escalation", description: "Vendor payment is overdue.", relatedType: "bill", relatedId: "bill-1" }, sideEffect: "task", expectedTitle: "Bill payment escalation" },
      { actionType: "missed_visit_task", entityType: "mtm_visit", entityId: "visit-1", payload: { title: "Missed visit follow-up", description: "Confirm skipped stop.", relatedType: "mtm_visit", relatedId: "visit-1" }, sideEffect: "task", expectedTitle: "Missed visit follow-up" },
      { actionType: "coaching_task", entityType: "user", entityId: "manager-1", payload: { title: "Coaching task", description: "Review action plan.", relatedType: "user", relatedId: "manager-1" }, sideEffect: "task", expectedTitle: "Coaching task" },
      { actionType: "assign_task", entityType: "task", entityId: "task-assign", payload: { assignedTo: "owner-1", relatedType: "task", relatedId: "task-assign" }, sideEffect: "task_update" },
      { actionType: "assign_owner", entityType: "deal", entityId: "deal-owner", payload: { title: "Assign CRM owner", description: "Set deal owner.", assignedTo: "owner-1", relatedType: "deal", relatedId: "deal-owner" }, sideEffect: "owner_update" },
      { actionType: "assign_ticket_owner", entityType: "ticket", entityId: "ticket-assign", payload: { title: "Assign ticket owner", description: "Set support owner.", assignedTo: "support-1", relatedType: "ticket", relatedId: "ticket-assign" }, sideEffect: "ticket_owner_update" },
      { actionType: "create_alert", entityType: "deal", entityId: "deal-alert", payload: { title: "Deal stage alert", message: "Deal is stuck.", relatedType: "deal", relatedId: "deal-alert" }, sideEffect: "notification", expectedTitle: "Deal stage alert" },
      { actionType: "stage_alert", entityType: "deal", entityId: "deal-stage", payload: { title: "Stage risk", message: "No movement.", relatedType: "deal", relatedId: "deal-stage" }, sideEffect: "notification", expectedTitle: "Stage risk" },
      { actionType: "priority_update", entityType: "ticket", entityId: "ticket-priority", payload: { title: "Ticket priority review", message: "Raise priority if SLA is at risk.", priority: "critical", relatedType: "ticket", relatedId: "ticket-priority" }, sideEffect: "ticket_priority_update", expectedTitle: "Ticket priority review" },
      { actionType: "create_note", entityType: "deal", entityId: "deal-note", payload: { subject: "Advisor note", description: "Health risk.", relatedType: "deal", relatedId: "deal-note" }, sideEffect: "note", expectedSubject: "Advisor note" },
      { actionType: "update_health_note", entityType: "contact", entityId: "contact-note", payload: { subject: "Health risk note", description: "Customer is idle.", relatedType: "contact", relatedId: "contact-note" }, sideEffect: "note", expectedSubject: "Health risk note" },
      { actionType: "draft_followup", entityType: "invoice", entityId: "invoice-draft", payload: { subject: "Payment reminder", body: "Please review the overdue invoice.", relatedType: "invoice", relatedId: "invoice-draft" }, sideEffect: "task", expectedTitle: "Draft follow-up: Payment reminder" },
      { actionType: "invoice_reminder", entityType: "invoice", entityId: "invoice-2", payload: { title: "Invoice reminder", message: "Confirm payment plan.", relatedType: "invoice", relatedId: "invoice-2" }, sideEffect: "task", expectedTitle: "Invoice reminder" },
      { actionType: "flag_route_issue", entityType: "mtm_route", entityId: "route-2", payload: { title: "Route issue", description: "Route is late.", relatedType: "mtm_route", relatedId: "route-2" }, sideEffect: "task", expectedTitle: "Route issue" },
      { actionType: "route_issue", entityType: "mtm_route", entityId: "route-3", payload: { title: "Route deviation", description: "Missed planned stop.", relatedType: "mtm_route", relatedId: "route-3" }, sideEffect: "task", expectedTitle: "Route deviation" },
      { actionType: "suggest_budget_change", entityType: "campaign", entityId: "campaign-budget", payload: { title: "Review campaign budget", reasoning: "Spend has no response.", relatedType: "campaign", relatedId: "campaign-budget" }, sideEffect: "task", expectedTitle: "Review campaign budget" },
      { actionType: "contract_review", entityType: "contract", entityId: "contract-2", payload: { title: "Contract review", description: "Review unsigned contract.", relatedType: "contract", relatedId: "contract-2" }, sideEffect: "task", expectedTitle: "Contract review" },
      { actionType: "approval_escalation", entityType: "contract", entityId: "contract-approval", payload: { title: "Approval escalation", description: "Reviewer is blocking.", relatedType: "contract", relatedId: "contract-approval" }, sideEffect: "task", expectedTitle: "Approval escalation" },
      { actionType: "signature_reminder", entityType: "contract", entityId: "contract-sign", payload: { title: "Signature reminder", description: "Signer has not completed.", relatedType: "contract", relatedId: "contract-sign" }, sideEffect: "task", expectedTitle: "Signature reminder" },
      { actionType: "campaign_review", entityType: "campaign", entityId: "campaign-2", payload: { title: "Campaign review", description: "No response after sends.", relatedType: "campaign", relatedId: "campaign-2" }, sideEffect: "task", expectedTitle: "Campaign review" },
      { actionType: "segment_review_task", entityType: "campaign", entityId: "campaign-segment", payload: { title: "Segment review", description: "Segment is stale.", relatedType: "campaign", relatedId: "campaign-segment" }, sideEffect: "task", expectedTitle: "Segment review" },
      { actionType: "support_escalation", entityType: "ticket", entityId: "ticket-sla", payload: { title: "SLA escalation", message: "Escalate before breach.", assignedTo: "support-1", relatedType: "ticket", relatedId: "ticket-sla" }, sideEffect: "task_and_notification", expectedTitle: "SLA escalation" },
      { actionType: "kpi_plan_review", entityType: "user", entityId: "manager-kpi", payload: { title: "KPI plan review", description: "Manager needs plan review.", assignedTo: "manager-kpi", relatedType: "user", relatedId: "manager-kpi" }, sideEffect: "task", expectedTitle: "KPI plan review" },
    ]

    for (const item of cases) {
      expect(validateAdvisorEditedPayload({
        featureName: "advisor_signal",
        actionType: item.actionType,
        entityType: item.entityType,
        entityId: item.entityId,
        payload: item.payload,
      }, item.payload)).toMatchObject({ ok: true })

      await expect(executeAdvisorShadowAction({
        id: `shadow-${item.actionType}`,
        organizationId: "org-1",
        featureName: "advisor_signal",
        actionType: item.actionType,
        entityType: item.entityType,
        entityId: item.entityId,
        riskLevel: "medium",
        payload: item.payload,
      }, now)).resolves.toBe(true)
    }

    for (const item of cases) {
      if (item.sideEffect === "task" || item.sideEffect === "task_and_notification") {
        expect(db.taskCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            title: item.expectedTitle,
            relatedType: item.payload.relatedType,
            relatedId: item.payload.relatedId,
          }),
        })
      }
      if (item.sideEffect === "task_update") {
        expect(db.taskUpdateMany).toHaveBeenCalledWith({
          where: { id: item.entityId, organizationId: "org-1" },
          data: { assignedTo: item.payload.assignedTo },
        })
      }
      if (item.sideEffect === "owner_update") {
        expect(db.dealUpdateMany).toHaveBeenCalledWith({
          where: { id: item.entityId, organizationId: "org-1" },
          data: { assignedTo: item.payload.assignedTo },
        })
      }
      if (item.sideEffect === "ticket_owner_update") {
        expect(db.ticketUpdateMany).toHaveBeenCalledWith({
          where: { id: item.entityId, organizationId: "org-1" },
          data: { assignedTo: item.payload.assignedTo },
        })
      }
      if (item.sideEffect === "ticket_priority_update") {
        expect(db.ticketUpdateMany).toHaveBeenCalledWith({
          where: { id: item.entityId, organizationId: "org-1" },
          data: { priority: item.payload.priority },
        })
        expect(db.notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
          organizationId: "org-1",
          title: item.expectedTitle,
          entityType: item.payload.relatedType,
          entityId: item.payload.relatedId,
        }))
      }
      if (item.sideEffect === "note") {
        expect(db.activityCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            subject: item.expectedSubject,
            relatedType: item.payload.relatedType,
            relatedId: item.payload.relatedId,
          }),
        })
      }
      if (item.sideEffect === "notification" || item.sideEffect === "task_and_notification") {
        expect(db.notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
          organizationId: "org-1",
          title: item.expectedTitle,
          entityType: item.payload.relatedType,
          entityId: item.payload.relatedId,
        }))
      }
    }
  })

  it("skips legacy non-Advisor shadow actions so the cron can handle them normally", async () => {
    await expect(executeAdvisorShadowAction({
      id: "legacy-1",
      organizationId: "org-1",
      featureName: "ai_auto_followup",
      actionType: "create_task",
      entityType: "deal",
      entityId: "deal-1",
      riskLevel: "medium",
      payload: { title: "Legacy follow-up", description: "Old automation path" },
    }, new Date("2026-06-27T08:00:00.000Z"))).resolves.toBe(false)

    expect(db.taskCreate).not.toHaveBeenCalled()
  })

  it("builds typed business previews for approval queue action payloads", () => {
    const cases = [
      {
        actionType: "create_task",
        payload: { title: "Follow up stalled deal", description: "Confirm next step", assignedTo: "user-1", relatedType: "deal", relatedId: "deal-1" },
        expected: ["Task:Follow up stalled deal", "Description:Confirm next step", "Assignee:user-1", "Related record:deal:deal-1"],
      },
      {
        actionType: "create_alert",
        payload: { title: "SLA risk", message: "Escalate before breach", relatedType: "ticket", relatedId: "ticket-1" },
        expected: ["Alert:SLA risk", "Message:Escalate before breach", "Related record:ticket:ticket-1"],
      },
      {
        actionType: "priority_update",
        payload: { title: "SLA priority", priority: "critical", message: "Raise before breach", relatedType: "ticket", relatedId: "ticket-1" },
        expected: ["Priority:critical", "Message:Raise before breach", "Related record:ticket:ticket-1"],
      },
      {
        actionType: "assign_task",
        payload: { assignedTo: "user-2", relatedType: "task", relatedId: "task-1" },
        expected: ["Assignee:user-2", "Related record:task:task-1"],
      },
      {
        actionType: "invoice_reminder",
        payload: { title: "Collect overdue invoice", message: "Confirm payment plan", relatedType: "invoice", relatedId: "invoice-1" },
        expected: ["Task:Collect overdue invoice", "Message:Confirm payment plan", "Related record:invoice:invoice-1"],
      },
      {
        actionType: "flag_route_issue",
        payload: { title: "Missed route stops", description: "Supervisor should review", relatedType: "mtm_route", relatedId: "route-1" },
        expected: ["Alert:Missed route stops", "Message:Supervisor should review", "Related record:mtm_route:route-1"],
      },
      {
        actionType: "create_note",
        payload: { subject: "Advisor risk", description: "Offer is idle", relatedType: "offer", relatedId: "offer-1" },
        expected: ["Note:Advisor risk", "Description:Offer is idle", "Related record:offer:offer-1"],
      },
      {
        actionType: "draft_followup",
        payload: { subject: "Payment reminder", body: "Please review overdue invoice.", relatedType: "invoice", relatedId: "invoice-1" },
        expected: ["Subject:Payment reminder", "Draft:Please review overdue invoice.", "Related record:invoice:invoice-1"],
      },
      {
        actionType: "suggest_budget_change",
        payload: { title: "Review campaign budget", reasoning: "No clicks after sends", relatedType: "campaign", relatedId: "campaign-1" },
        expected: ["Budget review:Review campaign budget", "Description:No clicks after sends", "Related record:campaign:campaign-1"],
      },
      {
        actionType: "contract_review",
        payload: { title: "Review contract", description: "Unblock signature", assignedTo: "user-1", relatedType: "contract", relatedId: "contract-1" },
        expected: ["Task:Review contract", "Description:Unblock signature", "Assignee:user-1", "Related record:contract:contract-1"],
      },
      {
        actionType: "support_escalation",
        payload: { title: "SLA risk", message: "Escalate before breach", assignedTo: "support-1", relatedType: "ticket", relatedId: "ticket-1" },
        expected: ["Alert:SLA risk", "Message:Escalate before breach", "Assignee:support-1", "Related record:ticket:ticket-1"],
      },
      {
        actionType: "approval_escalation",
        payload: { title: "Approval blocked", description: "Escalate reviewer", relatedType: "contract", relatedId: "contract-1" },
        expected: ["Task:Approval blocked", "Description:Escalate reviewer", "Related record:contract:contract-1"],
      },
    ]

    for (const item of cases) {
      const preview = buildAdvisorActionPreviewEntries({
        actionType: item.actionType,
        entityType: "fallback",
        entityId: "fallback-1",
        payload: item.payload,
      }, previewLabels)
      expect(preview.map((entry) => `${entry.label}:${entry.value}`)).toEqual(item.expected)
    }
  })

  it("keeps raw JSON as fallback by exposing typed editable fields only for supported Advisor actions", () => {
    expect(buildAdvisorEditablePayloadFields("create_task", { title: "Task" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "description",
      "assignedTo",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("assign_task", { assignedTo: "user-1" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "description",
      "assignedTo",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("priority_update", { message: "Raise" }, previewLabels).map((field) => field.key)).toEqual([
      "priority",
      "title",
      "message",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("invoice_reminder", { message: "Pay" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "message",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("flag_route_issue", { description: "Review" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "description",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("contract_review", { description: "Review" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "description",
      "assignedTo",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("support_escalation", { message: "Escalate" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "message",
      "assignedTo",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("approval_escalation", { description: "Escalate" }, previewLabels).map((field) => field.key)).toEqual([
      "title",
      "description",
      "assignedTo",
      "relatedType",
      "relatedId",
    ])
    expect(buildAdvisorEditablePayloadFields("unknown_action", { title: "Fallback" }, previewLabels)).toEqual([])
  })

  it("normalizes preview values for compact UI rows", () => {
    expect(advisorPreviewValue(null)).toBe("—")
    expect(advisorPreviewValue(["a", "b"])).toBe("2 items")
    expect(advisorPreviewValue({ status: "queued" })).toBe('{"status":"queued"}')
  })

  it("builds readable audit names from advisor payloads", () => {
    expect(advisorShadowActionAuditName({
      actionType: "create_task",
      entityId: "deal-1",
      payload: { advisor: { title: "Deal has no next step" }, title: "Fallback title" },
    })).toBe("Deal has no next step")

    expect(advisorShadowActionAuditName({
      actionType: "create_note",
      entityId: "ticket-1",
      payload: { subject: "SLA response gap" },
    })).toBe("SLA response gap")

    expect(advisorShadowActionAuditName({
      actionType: "create_alert",
      entityId: "route-1",
      payload: {},
    })).toBe("create_alert:route-1")
  })

  it("builds execution audit payloads for executed and failed actions", () => {
    const action = {
      id: "shadow-1",
      featureName: "advisor_signals",
      actionType: "create_task",
      entityType: "deal",
      entityId: "deal-1",
      riskLevel: "high",
      approved: true,
      executionStatus: "queued",
      reviewedBy: "manager-1",
    }

    expect(advisorShadowExecutionAuditValue(action, "executed", { executedAt: "2026-06-27T00:00:00.000Z" })).toEqual({
      shadowActionId: "shadow-1",
      featureName: "advisor_signals",
      actionType: "create_task",
      target: { entityType: "deal", entityId: "deal-1" },
      riskLevel: "high",
      approved: true,
      previousExecutionStatus: "queued",
      executionStatus: "executed",
      reviewerId: "manager-1",
      executedAt: "2026-06-27T00:00:00.000Z",
    })

    expect(advisorShadowExecutionAuditValue({ ...action, executionStatus: "executing", reviewedBy: null }, "failed", { failureReason: "Unsupported action" })).toMatchObject({
      previousExecutionStatus: "executing",
      executionStatus: "failed",
      reviewerId: "system",
      failureReason: "Unsupported action",
    })
  })

  it("atomically claims approved shadow actions before execution", async () => {
    vi.mocked(prisma.aiShadowAction.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(claimAdvisorShadowActionForExecution({
      id: "shadow-1",
      organizationId: "org-1",
      approved: true,
      executedAt: null,
      executionStatus: "queued",
    })).resolves.toBe(true)

    expect(prisma.aiShadowAction.updateMany).toHaveBeenCalledWith({
      where: {
        id: "shadow-1",
        organizationId: "org-1",
        approved: true,
        executedAt: null,
        executionStatus: { in: ["queued", "approved", "pending"] },
      },
      data: {
        executionStatus: "executing",
        failureReason: null,
      },
    })
  })

  it("does not claim already executed or concurrently claimed shadow actions", async () => {
    await expect(claimAdvisorShadowActionForExecution({
      id: "shadow-1",
      organizationId: "org-1",
      approved: true,
      executedAt: new Date("2026-06-27T00:00:00.000Z"),
      executionStatus: "executed",
    })).resolves.toBe(false)
    expect(prisma.aiShadowAction.updateMany).not.toHaveBeenCalled()

    vi.mocked(prisma.aiShadowAction.updateMany).mockResolvedValue({ count: 0 } as never)
    await expect(claimAdvisorShadowActionForExecution({
      id: "shadow-2",
      organizationId: "org-1",
      approved: true,
      executedAt: null,
      executionStatus: "approved",
    })).resolves.toBe(false)
  })
})
