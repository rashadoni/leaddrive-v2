import { describe, expect, it } from "vitest"

import {
  KNOWN_DIAL_STATUSES,
  KNOWN_HANGUP_CAUSES,
  dialFailureDiagnostic,
  formatDialDiagnostic,
} from "@/lib/calls/dial-diagnostics"

const t = (key: string) => `[${key}]`

describe("dialFailureDiagnostic", () => {
  it("surfaces raw dial evidence for a failed asterisk call", () => {
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "failed",
      providerDialStatus: "CHANUNAVAIL",
      providerHangupCause: "1",
    })).toEqual({ dialStatus: "CHANUNAVAIL", hangupCause: "1" })
  })

  it("stays silent for connected calls, other providers, and empty evidence", () => {
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "connected",
      providerDialStatus: "ANSWER",
    })).toBeNull()
    expect(dialFailureDiagnostic({
      provider: "twilio",
      providerOutcome: "failed",
      providerDialStatus: "CHANUNAVAIL",
    })).toBeNull()
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "failed",
      providerDialStatus: "  ",
      providerHangupCause: null,
    })).toBeNull()
  })

  it("keeps evidence with only one side present", () => {
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "no_answer",
      providerHangupCause: "19",
    })).toEqual({ dialStatus: null, hangupCause: "19" })
  })

  it("canonicalizes a zero-padded cause so it still finds its label", () => {
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "busy",
      providerHangupCause: "017",
    })).toEqual({ dialStatus: null, hangupCause: "17" })
    expect(dialFailureDiagnostic({
      provider: "asterisk",
      providerOutcome: "failed",
      providerHangupCause: "0",
    })).toEqual({ dialStatus: null, hangupCause: "0" })
  })
})

describe("formatDialDiagnostic", () => {
  it("pairs known tokens with their localized label and keeps the raw code", () => {
    expect(formatDialDiagnostic({ dialStatus: "CHANUNAVAIL", hangupCause: "1" }, t)).toBe(
      "CHANUNAVAIL — [dialDiagnostics.status.CHANUNAVAIL] · Q.850 1 — [dialDiagnostics.cause.1]",
    )
  })

  it("renders unknown codes raw instead of dropping them", () => {
    // A cause we did not anticipate is exactly the one worth quoting to the
    // trunk provider, so unknown values must survive formatting untranslated.
    expect(formatDialDiagnostic({ dialStatus: "WEIRDSTATUS", hangupCause: "999" }, t)).toBe(
      "WEIRDSTATUS · Q.850 999",
    )
  })

  it("keeps the known-code sets in sync with the i18n dictionary", async () => {
    // en.json is the source of truth; ru/az parity is check-translations' job,
    // so only the en dictionary needs to prove the sets are neither missing a
    // translated code nor promising a label that does not exist.
    const fs = await import("node:fs")
    const path = await import("node:path")
    const en = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ).voip.dialDiagnostics
    expect(Object.keys(en.status).sort()).toEqual([...KNOWN_DIAL_STATUSES].sort())
    expect(Object.keys(en.cause).sort()).toEqual([...KNOWN_HANGUP_CAUSES].sort())
    expect(typeof en.title).toBe("string")
  })
})
