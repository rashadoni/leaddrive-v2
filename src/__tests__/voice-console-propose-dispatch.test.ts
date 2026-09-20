import { describe, expect, it } from "vitest"

import { RECORD_TYPE_NAMES, recordFromPath, recordRoute } from "@/lib/ai/voice/record-types"
import {
  isVoiceProposeToolName,
  VOICE_PROPOSE_TOOL_NAMES,
  VOICE_PROPOSE_SCHEMAS,
} from "@/lib/ai/voice/propose-tools"

/**
 * "Change the phone" has to find its lead somewhere, and the one place it may
 * not come from is the model. `recordFromPath` reads the browser's own
 * location, which is why these cases matter: a wrong answer here silently
 * points a confirmed write at a different record.
 */
describe("which record the screen is showing", () => {
  it("recognises a detail page for every record type it can open", () => {
    for (const type of RECORD_TYPE_NAMES) {
      const path = recordRoute(type, "abc123def")
      expect(path, type).not.toBeNull()
      expect(recordFromPath(path as string), type).toEqual({ type, id: "abc123def" })
    }
  })

  it("is not fooled by a list, a sub-route or a named page", () => {
    for (const path of [
      "/leads",
      "/leads/",
      "/leads/abc123def/edit",
      "/tasks/board",
      "/dashboard",
      "/",
      "/leads/short",
    ]) {
      expect(recordFromPath(path), path).toBeNull()
    }
  })

  it("rejects an id that is not id-shaped", () => {
    expect(recordFromPath("/leads/..%2F..%2Fetc")).toBeNull()
    expect(recordFromPath("/leads/abc 123 def")).toBeNull()
  })

  it("round-trips whatever recordRoute produces", () => {
    const back = recordFromPath(recordRoute("deal", "deal-0001") as string)
    expect(back).toEqual({ type: "deal", id: "deal-0001" })
  })
})

describe("which tool names the console treats as proposals", () => {
  it("accepts exactly the registered proposal tools", () => {
    for (const name of VOICE_PROPOSE_TOOL_NAMES) {
      expect(isVoiceProposeToolName(name)).toBe(true)
    }
  })

  it("does not accept a lookalike a model might emit", () => {
    for (const name of [
      "commit_create_task",
      "propose",
      "propose_delete_lead",
      "propose_create_deal",
      "list_tasks",
      "",
    ]) {
      expect(isVoiceProposeToolName(name), name).toBe(false)
    }
  })

  it("declares a strict schema for every proposal tool", () => {
    for (const name of VOICE_PROPOSE_TOOL_NAMES) {
      const parsed = VOICE_PROPOSE_SCHEMAS[name].safeParse({ surpriseField: 1 })
      expect(parsed.success, name).toBe(false)
    }
  })
})
