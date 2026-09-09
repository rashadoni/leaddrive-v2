import { describe, it, expect } from "vitest"
import { WORKFLOW_TEMPLATES, getTemplateById } from "@/lib/workflow-templates"

describe("WORKFLOW_TEMPLATES", () => {
  it("has at least the core seven Phase 1 templates", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id)
    for (const expected of [
      "welcome-new-lead",
      "auto-assign-lead",
      "deal-won-thank-you",
      "new-ticket-acknowledge",
      "high-priority-alert",
      "deal-stuck-followup",
      "missed-call-sms",
    ]) {
      expect(ids).toContain(expected)
    }
  })

  it("all templates have unique ids", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every template declares required fields and at least one action", () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.id, `id for ${tpl.nameKey}`).toBeTruthy()
      expect(tpl.nameKey).toMatch(/^items\./)
      expect(tpl.descriptionKey).toMatch(/^items\./)
      expect(["sales", "support", "marketing", "operations"]).toContain(tpl.category)
      expect(tpl.entityType).toBeTruthy()
      expect(tpl.triggerEvent).toBeTruthy()
      expect(tpl.actions.length).toBeGreaterThan(0)
    }
  })

  it("actions use known action types supported by workflow-engine", () => {
    const SUPPORTED_ACTIONS = new Set([
      "send_notification",
      "notify",
      "create_task",
      "send_email",
      "send_sms",
      "send_slack",
      "slack_notify",
      "update_field",
      "fire_webhooks",
      "webhook",
      "auto_assign",
      "assign_to",
    ])
    for (const tpl of WORKFLOW_TEMPLATES) {
      for (const action of tpl.actions) {
        expect(SUPPORTED_ACTIONS.has(action.actionType), `${tpl.id}: ${action.actionType}`).toBe(true)
      }
    }
  })

  it("missed-call-sms template fires send_sms on call.missed", () => {
    const tpl = getTemplateById("missed-call-sms")
    expect(tpl).toBeDefined()
    expect(tpl!.entityType).toBe("call")
    expect(tpl!.triggerEvent).toBe("missed")
    const actionTypes = tpl!.actions.map((a) => a.actionType)
    expect(actionTypes).toContain("send_sms")
  })

  it("deal-won template is gated by status=won condition", () => {
    const tpl = getTemplateById("deal-won-thank-you")
    expect(tpl).toBeDefined()
    const rules = (tpl!.conditions as any).rules
    expect(rules).toBeDefined()
    expect(rules[0]).toMatchObject({ field: "status", operator: "equals", value: "won" })
  })

  it("action order is non-negative integers", () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      for (const action of tpl.actions) {
        expect(Number.isInteger(action.actionOrder)).toBe(true)
        expect(action.actionOrder).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe("getTemplateById", () => {
  it("returns the template when id exists", () => {
    const tpl = getTemplateById("welcome-new-lead")
    expect(tpl).toBeDefined()
    expect(tpl!.id).toBe("welcome-new-lead")
  })

  it("returns undefined for unknown ids", () => {
    expect(getTemplateById("nonexistent-template")).toBeUndefined()
  })
})
