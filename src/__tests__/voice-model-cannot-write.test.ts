import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { VOICE_TOOL_NAMES } from "@/lib/ai/voice/read-tools"
import { CLIENT_VOICE_TOOL_NAMES } from "@/lib/ai/voice/realtime-tool-contract"

/**
 * The one invariant the whole voice-write design rests on: the model can ask
 * for a draft to be shown, and cannot cause a CRM mutation.
 *
 * Every other safeguard — the receipt, the one-time proof, the revision and
 * payload-hash binding — is downstream of this. Once a `commit_*` tool exists,
 * an instruction hidden in a lead's notes field can invoke it, and no amount of
 * UI is between that and the database. So the check lives in the contract, not
 * in a component: the tool list is what the provider is actually given.
 */
describe("the voice model has no write capability", () => {
  const WRITE_SHAPED = /commit|create|update|delete|remove|write|send|save|assign|convert|execute|apply|set_/i

  it("publishes no write-shaped tool name to the provider", () => {
    for (const name of [...VOICE_TOOL_NAMES, ...CLIENT_VOICE_TOOL_NAMES]) {
      expect(
        WRITE_SHAPED.test(name),
        `voice tool "${name}" reads as a write; a model tool must never mutate the CRM`,
      ).toBe(false)
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
  it("never routes a model tool call at a write endpoint", () => {
    const console_ = readFileSync("src/components/ai/voice-console.tsx", "utf8")
    for (const route of ["/commit", "/confirmation", "/actions/draft", "/cancel"]) {
      expect(
        console_.includes(route),
        `voice-console.tsx must not call ${route}; only the receipt surface may`,
      ).toBe(false)
    }
  })

  it("keeps the commit client out of the realtime contract module", () => {
    const contract = readFileSync("src/lib/ai/voice/realtime-tool-contract.ts", "utf8")
    expect(contract).not.toMatch(/receipt-commit|commitVoiceReceipt/)
  })
})
