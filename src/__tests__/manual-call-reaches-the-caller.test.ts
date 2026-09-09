import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A click-to-call must ring the person who clicked.
 *
 * The Asterisk path sends the answered leg back into the outbound context at a
 * fixed extension, and that extension came from one organisation-wide setting —
 * so every salesperson's manual call rang the same phone. Their own number now
 * decides, with the org value as the fallback.
 */
const ROUTE = readFileSync(join(process.cwd(), "src/app/api/v1/calls/route.ts"), "utf8")
const PROVIDER = readFileSync(join(process.cwd(), "src/lib/voip/providers/asterisk.ts"), "utf8")
const CARD = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/leads/[id]/page.tsx"),
  "utf8",
)

describe("manual call", () => {
  it("dials the caller's own number, falling back to the org extension", () => {
    expect(PROVIDER).toMatch(/params\.agentNumber \|\| this\.callerExtension/)
    // One answered call, three possible destinations, and the station chooses
    // none of them: the AI bridge, the browser bridge, or a second phone. Both
    // bridges take the "s" extension; only a phone leg takes a number.
    expect(PROVIDER).toMatch(/params\.voiceAgent \|\| params\.browserAudio\s*\n?\s*\?\s*"s"/)
    expect(PROVIDER).toContain('? "fanum-ai-bridge"')
    expect(PROVIDER).toContain('? "fanum-human-bridge"')
  })

  it("takes the number from the caller's profile, normalised like any other", () => {
    expect(ROUTE).toMatch(/where: \{ id: auth\.userId, organizationId: orgId \}/)
    expect(ROUTE).toMatch(/normalizeManualLeadPhone\(caller\?\.verifiedPhone \|\| caller\?\.phone\)/)
    expect(ROUTE).toMatch(/agentNumber,/)
  })

  it("is reachable from the lead card, not only as a tel: link", () => {
    // The tel: link hands the call to the operating system, where nothing is
    // recorded, analysed, or turned into a task.
    expect(CARD).toContain("LeadManualCallAction")
  })
})
