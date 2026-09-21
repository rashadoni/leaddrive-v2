import { describe, expect, it } from "vitest"
import {
  AI_VOICE_ACTION_REGISTRY,
  AI_VOICE_ACTION_TYPES,
  getAiVoiceActionDefinition,
  isAiVoiceActionType,
  parseAiVoiceActionPayload,
} from "@/lib/ai/voice/action-registry"

describe("AI voice action registry", () => {
  // Seven since 2026-09-21: the owner asked for tasks and deals to be edited
  // by voice like leads. Growing this list is a decision, so it stays pinned.
  it("is a closed seven-action allowlist with no executable callback", () => {
    expect(AI_VOICE_ACTION_TYPES).toEqual([
      "create_task",
      "create_lead",
      "update_lead",
      "create_deal",
      "convert_lead_to_deal",
      "update_task",
      "update_deal",
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

  it("binds task and deal updates to their record and its version, like a lead update", () => {
    for (const [actionType, entityType, command] of [
      ["update_task", "task", "updateTaskCommand"],
      ["update_deal", "deal", "updateDealCommand"],
    ] as const) {
      expect(getAiVoiceActionDefinition(actionType)).toMatchObject({
        command,
        risk: "sensitive",
        dedupePolicy: "target_revision",
        operation: "update",
        resultEntityType: entityType,
        target: { entityType, requestField: "targetEntityId", bindExpectedUpdatedAt: true },
      })
    }
  })

  // A stage move can mark a deal won: cashback, surveys, loyalty. Not by voice.
  it("keeps stage, pipeline and probability out of a voice deal update", () => {
    const fields = getAiVoiceActionDefinition("update_deal").allowedFields
    for (const field of ["stage", "pipelineId", "probability", "lostReason", "meddpicc"]) {
      expect(fields, field).not.toContain(field)
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

    // Status is inside the voice allow-list since 2026-09-20 (the owner asked
    // to change it by voice). Score is not: it is a system field.
    expect(parseAiVoiceActionPayload("update_lead", {
      notes: "Call on Monday",
      status: "qualified",
    })).toMatchObject({ success: true })

    const update = parseAiVoiceActionPayload("update_lead", {
      notes: "Call on Monday",
      score: 100,
    })
    expect(update).toMatchObject({ success: false })
    if (!update.success) {
      expect(update.issues.map((issue) => issue.path[0])).toEqual(["score"])
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
