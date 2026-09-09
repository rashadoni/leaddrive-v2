import { describe, expect, it } from "vitest"
import {
  appendWhatsAppCallAuditNote,
  formatWhatsAppCallAuditLine,
  whatsappCallAuditLines,
} from "@/lib/whatsapp-call-audit"

describe("WhatsApp call audit notes", () => {
  it("formats and appends compact WhatsApp Calling audit lines", () => {
    const line = formatWhatsAppCallAuditLine("action failed", {
      action: "accept",
      providerStatus: 400,
      error: "Invalid call state",
    }, new Date("2026-06-26T10:00:00Z"))

    const notes = appendWhatsAppCallAuditNote("operator note", line)

    expect(notes).toContain("operator note\n[WhatsApp Calling] 2026-06-26T10:00:00.000Z action failed")
    expect(whatsappCallAuditLines(notes)).toEqual([line])
  })

  it("ignores normal operator notes when extracting diagnostics", () => {
    const notes = [
      "customer asked for callback",
      "[WhatsApp Calling] 2026-06-26T10:00:00.000Z webhook call (event=connect)",
      "manual follow-up needed",
    ].join("\n")

    expect(whatsappCallAuditLines(notes)).toEqual([
      "[WhatsApp Calling] 2026-06-26T10:00:00.000Z webhook call (event=connect)",
    ])
  })
})
