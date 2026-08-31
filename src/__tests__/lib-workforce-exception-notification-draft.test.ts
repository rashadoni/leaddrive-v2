import { describe, expect, it } from "vitest"
import { planWorkforceExceptionNotification } from "@/lib/workforce/exception-notification-draft"

function input(overrides: Record<string, unknown> = {}) {
  const base = {
    organizationId: "org-a",
    caseId: "case-a",
    recipient: { agentId: "agent-a", audience: "EMPLOYEE", inAppPreference: "ENABLED" },
    case: { employeeVisibility: "VISIBLE", lifecycle: "AWAITING_EMPLOYEE" },
    priorDelivery: "NONE",
  }
  return {
    ...base,
    ...overrides,
    recipient: { ...base.recipient, ...((overrides.recipient as Record<string, unknown> | undefined) ?? {}) },
    case: { ...base.case, ...((overrides.case as Record<string, unknown> | undefined) ?? {}) },
  } as Parameters<typeof planWorkforceExceptionNotification>[0]
}

describe("Workforce exception notification draft", () => {
  it("plans a generic, private in-app employee action without raw case identifiers", () => {
    const result = planWorkforceExceptionNotification(input())

    expect(result).toMatchObject({
      outcome: "PLAN_IN_APP",
      channel: "IN_APP",
      audience: "EMPLOYEE",
      kind: "EMPLOYEE_ACTION_REQUIRED",
      copy: {
        titleKey: "workforce.exceptionNotification.actionRequired",
        bodyKey: "workforce.exceptionNotification.openWorkforce",
      },
      metadata: {
        domain: "workforce",
        notificationKind: "EMPLOYEE_ACTION_REQUIRED",
        reference: "WORKFORCE_EXCEPTION",
      },
    })
    expect(JSON.stringify(result)).not.toContain("case-a")
    expect(JSON.stringify(result)).not.toMatch(/reason|location|coordinates|qr|device/i)
  })

  it("uses an opaque stable dedupe key rather than sending duplicates", () => {
    const first = planWorkforceExceptionNotification(input())
    const same = planWorkforceExceptionNotification(input())
    const differentRecipient = planWorkforceExceptionNotification(input({ recipient: { agentId: "agent-b" } }))

    expect(first).toMatchObject({ outcome: "PLAN_IN_APP" })
    expect(same).toMatchObject({ outcome: "PLAN_IN_APP" })
    expect(differentRecipient).toMatchObject({ outcome: "PLAN_IN_APP" })
    if (first.outcome !== "PLAN_IN_APP" || same.outcome !== "PLAN_IN_APP" || differentRecipient.outcome !== "PLAN_IN_APP") return
    expect(first.dedupeKey).toMatch(/^[a-f0-9]{64}$/)
    expect(first.dedupeKey).toBe(same.dedupeKey)
    expect(first.dedupeKey).not.toBe(differentRecipient.dedupeKey)
  })

  it("suppresses delivery for disabled or unknown preferences and prior delivery", () => {
    expect(planWorkforceExceptionNotification(input({ recipient: { inAppPreference: "DISABLED" } }))).toEqual({
      outcome: "SUPPRESS",
      code: "WORKFORCE_EXCEPTION_NOTIFICATION_PREFERENCE_DISABLED",
    })
    expect(planWorkforceExceptionNotification(input({ recipient: { inAppPreference: "UNKNOWN" } }))).toEqual({
      outcome: "SUPPRESS",
      code: "WORKFORCE_EXCEPTION_NOTIFICATION_PREFERENCE_DISABLED",
    })
    expect(planWorkforceExceptionNotification(input({ priorDelivery: "DELIVERED" }))).toEqual({
      outcome: "SUPPRESS",
      code: "WORKFORCE_EXCEPTION_NOTIFICATION_ALREADY_PLANNED",
    })
  })

  it("requires employee visibility and a matching accountable audience", () => {
    expect(planWorkforceExceptionNotification(input({ case: { employeeVisibility: "NOT_VISIBLE" } }))).toEqual({
      outcome: "SUPPRESS",
      code: "WORKFORCE_EXCEPTION_NOTIFICATION_EMPLOYEE_NOT_VISIBLE",
    })
    expect(planWorkforceExceptionNotification(input({ recipient: { audience: "HR_REVIEWER" } }))).toEqual({
      outcome: "SUPPRESS",
      code: "WORKFORCE_EXCEPTION_NOTIFICATION_LIFECYCLE_INELIGIBLE",
    })
    expect(planWorkforceExceptionNotification(input({
      recipient: { audience: "HR_REVIEWER" },
      case: { lifecycle: "AWAITING_HR_REVIEW" },
    }))).toMatchObject({
      outcome: "PLAN_IN_APP",
      audience: "HR_REVIEWER",
      kind: "HR_REVIEW_AGING",
    })
  })
})
