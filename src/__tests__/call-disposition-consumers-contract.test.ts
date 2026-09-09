import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8")
}

describe("call disposition consumers use the canonical vocabulary", () => {
  it("derives the human non-callback schema from the canonical enum", () => {
    const route = source("src/app/api/v1/calls/[id]/disposition/route.ts")
    expect(route.includes('z.enum(CALL_DISPOSITIONS).exclude(["callback"])')).toBe(true)
    expect(route.includes("NON_CALLBACK_CALL_DISPOSITIONS")).toBe(false)
  })

  it("drives AI validation and the provider JSON schema from the shared values", () => {
    const postCall = source("src/lib/voice-agent/post-call.ts")
    expect(postCall.includes('from "@/lib/calls/disposition"')).toBe(true)
    expect(postCall.includes("z.enum(CALL_DISPOSITIONS)")).toBe(true)
    expect(postCall.includes("enum: [...CALL_DISPOSITIONS]")).toBe(true)
  })

  it("drives the fast leads-queue picker from the canonical quick subset", () => {
    const leadAction = source("src/components/leads/lead-browser-call-action.tsx")
    expect(leadAction.includes('from "@/lib/calls/disposition"')).toBe(true)
    expect(leadAction.includes("QUICK_CALL_DISPOSITIONS.map")).toBe(true)
    expect(leadAction.includes("const OUTCOMES =")).toBe(false)
  })

  it("drives the complete call widget picker from the canonical set", () => {
    const widget = source("src/components/call-widget.tsx")
    expect(widget.includes('from "@/lib/calls/disposition"')).toBe(true)
    expect(widget.includes("CALL_DISPOSITIONS.map")).toBe(true)
  })

  it("translates only canonical values in the VoIP call list", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page.includes('from "@/lib/calls/disposition"')).toBe(true)
    expect(page.includes("isCallDisposition(call.disposition)")).toBe(true)
    expect(page.includes("const dispositionKey")).toBe(false)
  })

  it("translates a raw disposition before rendering either entity timeline", () => {
    const timeline = source("src/components/interaction-timeline.tsx")
    expect(timeline.includes('from "@/lib/calls/disposition"')).toBe(true)
    expect(timeline.includes('useTranslations("voip")')).toBe(true)
    expect(timeline.includes("isCallDisposition(e.meta?.disposition)")).toBe(true)
    expect(timeline.includes("CALL_DISPOSITION_I18N_KEYS[e.meta.disposition]")).toBe(true)
  })
})
