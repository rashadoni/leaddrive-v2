import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { AI_VOICE_ACTION_REGISTRY, AI_VOICE_ACTION_TYPES } from "@/lib/ai/voice/action-registry"
import { visibleReceiptFields } from "@/components/ai/voice-receipt-fields"

/**
 * The receipt is the last place a wrong action can be caught, so an unlabelled
 * field is not cosmetic: it turns a line of the confirmation into a raw
 * payload key the reader has to decode.
 *
 * The registry decides which fields a receipt can contain, and the message
 * catalogs decide how they read. Those are two lists that must not drift, and
 * a list cannot tell you what is missing from it — so this test walks the
 * registry and fails when a field has no label in any supported language.
 */
const LOCALES = ["en", "ru", "az"] as const

function labels(locale: string): Record<string, string> {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
    aiVoiceActions?: { fields?: Record<string, string> }
  }
  return messages.aiVoiceActions?.fields ?? {}
}

function everyPreviewFieldKey(): string[] {
  const keys = new Set<string>()
  for (const actionType of AI_VOICE_ACTION_TYPES) {
    const entry = AI_VOICE_ACTION_REGISTRY[actionType]
    const rendered = entry.renderPreview(
      Object.fromEntries(entry.previewFields.map((field) => [field, "x"])),
      entry.target
        ? { target: { entityType: "lead", id: "lead-1", label: "Lead", before: {} } }
        : undefined,
    )
    for (const field of visibleReceiptFields(rendered.fields)) keys.add(field.key)
  }
  return [...keys].sort()
}

describe("receipt field labels", () => {
  it("labels every field a receipt can display, in every language", () => {
    const keys = everyPreviewFieldKey()
    expect(keys.length).toBeGreaterThan(0)

    for (const locale of LOCALES) {
      const dictionary = labels(locale)
      const missing = keys.filter((key) => !dictionary[key]?.trim())
      expect(missing, `messages/${locale}.json is missing aiVoiceActions.fields`).toEqual([])
    }
  })

  it("does not label fields no receipt renders", () => {
    const keys = new Set(everyPreviewFieldKey())
    const extra = Object.keys(labels("en")).filter((key) => !keys.has(key))
    expect(extra, "stale aiVoiceActions.fields entries").toEqual([])
  })

  it("names every action and its button in every language", () => {
    for (const locale of LOCALES) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
        voice?: { receipt?: { action?: Record<string, string>; confirm?: Record<string, string> } }
      }
      const receipt = messages.voice?.receipt
      for (const actionType of AI_VOICE_ACTION_TYPES) {
        expect(receipt?.action?.[actionType]?.trim(), `${locale} action ${actionType}`).toBeTruthy()
        // The button must name the operation; "Confirm" would tell the reader
        // nothing about what they are confirming.
        expect(receipt?.confirm?.[actionType]?.trim(), `${locale} confirm ${actionType}`).toBeTruthy()
      }
    }
  })
})
