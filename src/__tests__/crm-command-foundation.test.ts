import { describe, expect, it } from "vitest"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { requireWritableFields } from "@/lib/crm-commands/field-permissions"
import { createTaskCommandSchema } from "@/lib/crm-commands/schemas/task"

describe("CRM command foundation", () => {
  it("builds trusted REST actor context without accepting payload identity", () => {
    expect(createRestActorContext({
      organizationId: "org-1",
      userId: "user-1",
      role: "sales",
      requestId: "request-1",
    })).toEqual({
      organizationId: "org-1",
      userId: "user-1",
      role: "sales",
      source: "rest",
      requestId: "request-1",
    })
  })

  it("rejects unknown task fields", () => {
    const result = createTaskCommandSchema.safeParse({
      title: "Call customer",
      organizationId: "model-invented-tenant",
    })
    expect(result.success).toBe(false)
  })

  it("requires related type and id as one pair", () => {
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      relatedType: "lead",
    }).success).toBe(false)
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      relatedType: "lead",
      relatedId: "lead-1",
    }).success).toBe(true)
  })

  it("accepts existing date-only REST values while rejecting invalid dates", () => {
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      dueDate: "2026-09-20",
    }).success).toBe(true)
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      dueDate: "tomorrow-ish",
    }).success).toBe(false)
  })

  it("accepts JSON custom fields and rejects non-JSON command values", () => {
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      customFields: {
        channel: "voice",
        score: 7,
        qualified: true,
        notes: null,
        tags: ["priority", "follow-up"],
        metadata: { locale: "ru" },
      },
    }).success).toBe(true)
    expect(createTaskCommandSchema.safeParse({
      title: "Call customer",
      customFields: { invalid: undefined },
    }).success).toBe(false)
  })

  it("reports forbidden fields instead of silently removing them", () => {
    expect(() => requireWritableFields(
      { title: "Visible", description: "Not editable" },
      { description: "visible" },
      "sales",
    )).toThrowError(CrmCommandError)

    try {
      requireWritableFields(
        { title: "Visible", description: "Not editable" },
        { description: "visible" },
        "sales",
      )
    } catch (error) {
      expect(error).toMatchObject({
        code: "FORBIDDEN_FIELD",
        status: 403,
        safeDetails: { fields: ["description"] },
      })
    }
  })
})
