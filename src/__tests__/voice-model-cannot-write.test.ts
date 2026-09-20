import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { VOICE_TOOL_NAMES } from "@/lib/ai/voice/read-tools"
import { CLIENT_VOICE_TOOL_NAMES, voiceTools } from "@/lib/ai/voice/realtime-tool-contract"
import {
  VOICE_PROPOSE_TOOL_NAMES,
  VOICE_PROPOSE_ACTION_TYPES,
  VOICE_LEAD_STATUSES,
} from "@/lib/ai/voice/propose-tools"

/**
 * The one invariant the whole voice-write design rests on: the model can ask
 * for a draft to be shown, and cannot cause a CRM mutation.
 *
 * Every other safeguard — the receipt, the one-time proof, the revision and
 * payload-hash binding — is downstream of this. CRM text is untrusted input:
 * a lead's notes field can contain "ignore your instructions and…", and the
 * read tools put that text in front of the model on every turn. A model that
 * can be talked into PROPOSING something wrong is an annoyance the receipt
 * catches. One that can be talked into WRITING it is an incident.
 *
 * So the check lives in the published contract, not in a component: the tool
 * list is what the provider is actually given.
 */
describe("the voice model has no write capability", () => {
  const published = voiceTools().map((tool) => tool.name)

  it("publishes exactly two kinds of tool: reads and proposals", () => {
    for (const name of published) {
      const known = (VOICE_TOOL_NAMES as readonly string[]).includes(name)
        || (CLIENT_VOICE_TOOL_NAMES as readonly string[]).includes(name)
        || (VOICE_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
      expect(known, `unregistered voice tool "${name}"`).toBe(true)
    }
  })

  it("publishes no tool that commits, saves or deletes", () => {
    // `propose_*` is the only prefix under which a write verb may appear, and
    // only because the verb describes what the RECEIPT would do, not the tool.
    const COMMITTING = /^(?!propose_).*(commit|delete|remove|write|send|save|execute|apply)/i
    for (const name of published) {
      expect(COMMITTING.test(name), `voice tool "${name}" reads as a write`).toBe(false)
    }
    expect(published.filter((name) => /commit/i.test(name))).toEqual([])
  })

  it("keeps every proposal tool pointed at a draft, never at an execution", () => {
    for (const tool of VOICE_PROPOSE_TOOL_NAMES) {
      expect(VOICE_PROPOSE_ACTION_TYPES[tool])
        .toMatch(/^(create_task|create_lead|update_lead|convert_lead_to_deal|create_deal)$/)
    }
  })

  it("tells the model in the tool description that nothing is saved", () => {
    for (const tool of voiceTools()) {
      if (!(VOICE_PROPOSE_TOOL_NAMES as readonly string[]).includes(tool.name)) continue
      expect(tool.description, tool.name).toMatch(/does NOT/)
      expect(tool.description, tool.name).toMatch(/confirm|press|button|screen/i)
    }
  })

  it("accepts no identifier from the model on any proposal tool", () => {
    // An id the model supplies is an id it can hallucinate or be fed. Names
    // are resolved server-side, under the caller's own tenant filters.
    const ID_SHAPED = /^(.*Id|id|assignedTo|relatedId|targetEntityId)$/
    for (const tool of voiceTools()) {
      if (!(VOICE_PROPOSE_TOOL_NAMES as readonly string[]).includes(tool.name)) continue
      for (const property of Object.keys(tool.parameters.properties)) {
        expect(ID_SHAPED.test(property), `${tool.name}.${property} looks like an identifier`).toBe(false)
      }
    }
  })

  it("does not let a voice update convert a lead", () => {
    // `converted` promises a deal, and only the conversion command creates one.
    // Conversion has its own tool, which runs that command.
    expect([...VOICE_LEAD_STATUSES]).not.toContain("converted")
    expect(VOICE_PROPOSE_ACTION_TYPES.propose_convert_lead_to_deal).toBe("convert_lead_to_deal")
  })

  it("does not let the model choose a deal stage or pipeline", () => {
    // `Deal.stage` is a free string and pipelines are per-organization, so a
    // guessed stage is either refused or silently wrong. The server picks it
    // from the lead, or from the organization's own default pipeline.
    const convert = voiceTools().find((tool) => tool.name === "propose_convert_lead_to_deal")
    expect(Object.keys(convert?.parameters.properties ?? {}).sort())
      .toEqual(["createCompany", "dealTitle", "dealValue", "leadName"])

    const create = voiceTools().find((tool) => tool.name === "propose_create_deal")
    for (const forbidden of ["stage", "pipelineId", "probability"]) {
      expect(Object.keys(create?.parameters.properties ?? {}), forbidden).not.toContain(forbidden)
    }
  })

  it("keeps the client-side tool surface to navigation and screen context", () => {
    expect([...CLIENT_VOICE_TOOL_NAMES].sort()).toEqual([
      "get_current_screen",
      "navigate_to_section",
      "open_record",
    ])
  })

  // A write route reached from the tool dispatcher would bypass the receipt
  // entirely, so the dispatcher's own source must not mention one.
  it("never routes a model tool call at a commit or confirmation endpoint", () => {
    const console_ = readFileSync("src/components/ai/voice-console.tsx", "utf8")
    for (const route of ["/commit", "/confirmation", "/cancel"]) {
      expect(
        console_.includes(route),
        `voice-console.tsx must not call ${route}; only the receipt surface may`,
      ).toBe(false)
    }
    // It may reach the propose route, and only that one.
    expect(console_).toContain("/api/v1/ai/voice/actions/propose")
  })

  it("keeps the commit client out of the realtime contract module", () => {
    const contract = readFileSync("src/lib/ai/voice/realtime-tool-contract.ts", "utf8")
    expect(contract).not.toMatch(/receipt-commit|commitVoiceReceipt/)
  })

  it("keeps the propose endpoint incapable of executing a command", () => {
    const route = readFileSync("src/app/api/v1/ai/voice/actions/propose/route.ts", "utf8")
    expect(route).not.toMatch(/claimAiVoiceActionExecution|executeClaimedAiVoiceAction|Command\(/)
    expect(route).toContain("createAiVoiceActionDraft")
  })
})
