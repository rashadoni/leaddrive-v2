import { describe, expect, it } from "vitest"
import {
  AI_VOICE_ACTION_REGISTRY,
  AI_VOICE_ACTION_TYPES,
  getAiVoiceActionDefinition,
  isAiVoiceActionType,
  parseAiVoiceActionPayload,
} from "@/lib/ai/voice/action-registry"

describe("AI voice action registry", () => {
  it("is a closed five-action allowlist with no executable callback", () => {
    expect(AI_VOICE_ACTION_TYPES).toEqual([
      "create_task",
      "create_lead",
      "update_lead",
      "create_deal",
      "convert_lead_to_deal",
    ])
    expect(Object.keys(AI_VOICE_ACTION_REGISTRY)).toEqual(AI_VOICE_ACTION_TYPES)
    expect(isAiVoiceActionType("create_lead")).toBe(true)
    expect(isAiVoiceActionType("delete_lead")).toBe(false)

    for (const definition of Object.values(AI_VOICE_ACTION_REGISTRY)) {
      expect(definition).not.toHaveProperty("execute")
      expect(definition.permissions.length).toBeGreaterThan(0)
      expect(definition.ttlMs).toBeGreaterThan(0)
    }
  })

  it("maps every action to its canonical CRM command and risk policy", () => {
    expect(getAiVoiceActionDefinition("create_task")).toMatchObject({
      command: "createTaskCommand",
      risk: "standard",
      dedupePolicy: "idempotency_key",
    })
    expect(getAiVoiceActionDefinition("create_lead")).toMatchObject({
      command: "createLeadCommand",
      dedupePolicy: "lead_contact_coordinates",
    })
    expect(getAiVoiceActionDefinition("update_lead")).toMatchObject({
      command: "updateLeadCommand",
      risk: "sensitive",
      dedupePolicy: "target_revision",
      target: { entityType: "lead", bindExpectedUpdatedAt: true },
    })
    expect(getAiVoiceActionDefinition("create_deal")).toMatchObject({
      command: "createDealCommand",
      dedupePolicy: "deal_name_and_relations",
    })
    expect(getAiVoiceActionDefinition("convert_lead_to_deal")).toMatchObject({
      command: "convertLeadToDealCommand",
      risk: "sensitive",
      dedupePolicy: "target_revision",
    })
  })

  it("accepts canonical payloads and rejects fields outside the voice allowlist", () => {
    expect(parseAiVoiceActionPayload("create_lead", {
      contactName: "Ali Mammadov",
      phone: "+994501234567",
      priority: "high",
    })).toMatchObject({ success: true })

    const update = parseAiVoiceActionPayload("update_lead", {
      notes: "Call on Monday",
      status: "converted",
      score: 100,
    })
    expect(update).toMatchObject({ success: false })
    if (!update.success) {
      expect(update.issues.map((issue) => issue.path[0])).toEqual(["status", "score"])
    }

    const task = parseAiVoiceActionPayload("create_task", {
      title: "Follow up",
      recurrenceRule: "daily",
    })
    expect(task).toMatchObject({ success: false })
  })

  it("renders stable translation keys and before/after values without HTML", () => {
    const definition = getAiVoiceActionDefinition("update_lead")
    const preview = definition.renderPreview(
      { contactName: "New name", notes: "Updated", expectedUpdatedAt: "2026-09-19T12:00:00.000Z" },
      {
        target: {
          entityType: "lead",
          id: "lead-1",
          label: "Old name",
          before: { contactName: "Old name", notes: null },
        },
      },
    )

    expect(preview).toMatchObject({
      contract: 1,
      titleKey: "ai.voice.actions.update_lead.title",
      target: { entityType: "lead", id: "lead-1", label: "Old name" },
    })
    expect(preview.fields).toEqual([
      {
        key: "contactName",
        labelKey: "ai.voice.actions.fields.contactName",
        before: "Old name",
        after: "New name",
      },
      {
        key: "notes",
        labelKey: "ai.voice.actions.fields.notes",
        before: null,
        after: "Updated",
      },
    ])
  })
})
