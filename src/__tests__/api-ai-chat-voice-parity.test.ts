/**
 * The chat assistant carries the voice assistant's read tools.
 *
 * For months the two surfaces answered the same question differently because
 * they had different tools, and the chat's own prompt ordered it to recite
 * database field names at users. These pins hold the cure in place: one shared
 * executor, two deliberate exclusions, and a prompt that forbids internal
 * identifiers instead of demanding them.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { VOICE_SUMMARY_TOOLS } from "@/lib/ai/voice/read-tools"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"

const CHAT_ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/v1/ai/chat/route.ts"),
  "utf8",
)

describe("chat/voice parity", () => {
  it("executes voice read tools through the shared executor", () => {
    expect(CHAT_ROUTE).toContain("executeVoiceReadTool")
    // The results reach the model masked, like every other tool result here.
    expect(CHAT_ROUTE).toMatch(/piiMasker\.mask\(JSON\.stringify\(out\.body\)\)/)
  })

  it("keeps period sales and section guides on chat's own evidence paths", () => {
    // get_crm_period_report has timezone-forced evidence; two period tools
    // would let the model pick the ungated one.
    expect(CHAT_ROUTE).toContain('name !== "get_sales_in_period"')
    expect(CHAT_ROUTE).toContain('name !== "explain_section"')
  })

  it("gates the voice toolset exactly like Smart AI Search", () => {
    expect(CHAT_ROUTE).toMatch(/smartSearchEnabled && isManagerOrAbove\(session\.role\)/)
  })

  it("grounds advisory questions in the tenant's data, not the model's erudition", () => {
    // "Why don't leads convert" carries no period and no ranking, so the
    // verified-analytics detector never fires; without this contract the model
    // answers such questions from general sales wisdom. The route must force
    // the grounding read tool on round 0 — and only through the read tools,
    // never the analytics evidence path, whose deterministic renderer would
    // replace the advice itself with a number template.
    expect(CHAT_ROUTE).toMatch(/advisoryGroundingTool\(String\(message\)\)/)
    // A state question ("how many leads do we have") grounds first; advice is
    // only considered when neither the analytics path nor a snapshot claimed
    // the message, so no message can be forced onto two tools at once.
    expect(CHAT_ROUTE).toMatch(/requiredAnalyticsTool \|\| stateGrounding\s*\n?\s*\?\s*null\s*\n?\s*:\s*advisoryGroundingTool/)
    expect(CHAT_ROUTE).toMatch(/advisoryTool && tools\.some\(\(t\) => t\.name === advisoryTool\)/)
    expect(CHAT_ROUTE).toMatch(/requiredAnalyticsTool \|\| groundedForcedTool/)
    expect(CHAT_ROUTE).toContain("${ADVISORY_GROUNDING_RULES}")
    expect(CHAT_ROUTE).toContain("${CURRENT_STATE_GROUNDING_RULES}")
  })

  it("orders human answers and bans internal identifiers", () => {
    // The old rule literally instructed the model to state the data-field
    // basis, which is how "PipelineStageTransition.transitionedAt" ended up in
    // a customer-facing answer about July sales.
    expect(CHAT_ROUTE).not.toContain("state the metric definition, data field/event basis")
    expect(CHAT_ROUTE).toContain("NEVER mention internal identifiers")
    expect(CHAT_ROUTE).toContain("read_record with the returned id")
  })

  it("has a schema for every tool it would hand the chat", () => {
    const offered = voiceTools()
      .filter((t) => (VOICE_SUMMARY_TOOLS as readonly string[]).includes(t.name))
      .filter((t) => t.name !== "get_sales_in_period" && t.name !== "explain_section")
    // Every offered tool carries a JSON schema the Anthropic API will accept.
    for (const tool of offered) {
      expect(tool.parameters, tool.name).toBeTruthy()
      expect(tool.parameters.type, tool.name).toBe("object")
    }
    expect(offered.map((t) => t.name)).toContain("read_record")
    expect(offered.map((t) => t.name)).toContain("find_record")
  })
})
