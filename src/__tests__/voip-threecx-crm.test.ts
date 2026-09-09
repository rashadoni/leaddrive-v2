import { describe, expect, it } from "vitest"

import {
  THREECX_CRM_TEMPLATE_NAME,
  buildThreeCxCrmTemplate,
  mapThreeCxCallType,
  parseThreeCxDateTime,
  parseThreeCxDuration,
  threeCxJournalUrl,
  threeCxLookupUrl,
  threeCxDialNumber,
  threeCxPhoneVariants,
  threeCxSecretMatches,
} from "@/lib/voip/threecx-crm"

describe("threeCxDialNumber", () => {
  // The trunk we ship against routes on Prefix 0 / Length 10. Contacts are
  // stored in E.164, which matches no rule — the call dies before the carrier.
  it("rewrites a stored E.164 AZ number into the national dial form", () => {
    expect(threeCxDialNumber("+994512060838")).toBe("0512060838")
  })

  it("accepts the same number without a plus", () => {
    expect(threeCxDialNumber("994512060838")).toBe("0512060838")
  })

  it("treats the 00 international prefix like a plus", () => {
    expect(threeCxDialNumber("00994512060838")).toBe("0512060838")
  })

  it("adds the trunk zero to a bare subscriber number", () => {
    expect(threeCxDialNumber("512060838")).toBe("0512060838")
  })

  it("strips the spacing humans type", () => {
    expect(threeCxDialNumber("+994 (51) 206-08-38")).toBe("0512060838")
  })

  it("leaves an already-national number alone", () => {
    expect(threeCxDialNumber("0512060838")).toBe("0512060838")
  })

  it("never touches an internal extension", () => {
    expect(threeCxDialNumber("101")).toBe("101")
    expect(threeCxDialNumber("800")).toBe("800")
  })

  it("passes foreign numbers through rather than mangling them", () => {
    // Not an AZ number — a different outbound rule owns it.
    expect(threeCxDialNumber("+13509005853")).toBe("+13509005853")
    expect(threeCxDialNumber("+905321234567")).toBe("+905321234567")
  })

  it("does not mistake a 9-digit foreign E.164 number for a bare AZ subscriber", () => {
    // Andorra (+376) and the Faroes (+298): 3-digit country code + 6-digit
    // subscriber = 9 digits after the prefix — the same length as a bare AZ
    // number. The international prefix is the tell; rewriting these would
    // silently dial a wrong domestic number and report success.
    expect(threeCxDialNumber("+376312345")).toBe("+376312345")
    expect(threeCxDialNumber("+298123456")).toBe("+298123456")
    expect(threeCxDialNumber("00376312345")).toBe("00376312345")
  })

  it("honours as-is for a PBX whose dial plan wants E.164", () => {
    expect(threeCxDialNumber("+994512060838", "as-is")).toBe("+994512060838")
  })

  it("returns empty for a blank number instead of inventing one", () => {
    expect(threeCxDialNumber("")).toBe("")
    expect(threeCxDialNumber("   ")).toBe("")
  })

  it("leaves non-numeric junk untouched", () => {
    expect(threeCxDialNumber("not-a-number")).toBe("not-a-number")
  })
})

describe("threeCxSecretMatches", () => {
  it("accepts an exact match", () => {
    expect(threeCxSecretMatches("a".repeat(32), "a".repeat(32))).toBe(true)
  })

  it("rejects a wrong secret of the same length", () => {
    expect(threeCxSecretMatches("a".repeat(32), "b".repeat(32))).toBe(false)
  })

  it("rejects a length mismatch without throwing", () => {
    expect(threeCxSecretMatches("short", "a".repeat(32))).toBe(false)
  })

  it("fails closed when no secret is configured", () => {
    expect(threeCxSecretMatches("anything", null)).toBe(false)
    expect(threeCxSecretMatches("anything", "")).toBe(false)
    expect(threeCxSecretMatches(null, "a".repeat(32))).toBe(false)
  })
})

describe("mapThreeCxCallType", () => {
  it("maps the four 3CX call types onto direction + status", () => {
    expect(mapThreeCxCallType("Inbound")).toEqual({ direction: "inbound", status: "completed", answered: true })
    expect(mapThreeCxCallType("Outbound")).toEqual({ direction: "outbound", status: "completed", answered: true })
    // Missed = nobody picked up an inbound call.
    expect(mapThreeCxCallType("Missed")).toEqual({ direction: "inbound", status: "no-answer", answered: false })
    // Unanswered = the far end never picked up our outbound call.
    expect(mapThreeCxCallType("Unanswered")).toEqual({ direction: "outbound", status: "no-answer", answered: false })
  })

  it("is case-insensitive and fails closed for missing or unknown types", () => {
    expect(mapThreeCxCallType("missed")).toEqual({ direction: "inbound", status: "no-answer", answered: false })
    expect(mapThreeCxCallType(undefined)).toBeNull()
    expect(mapThreeCxCallType("")).toBeNull()
    expect(mapThreeCxCallType("Connected")).toBeNull()
  })
})

describe("parseThreeCxDuration", () => {
  it("parses the hh:mm:ss form 3CX sends", () => {
    expect(parseThreeCxDuration("00:01:23")).toBe(83)
    expect(parseThreeCxDuration("01:00:00")).toBe(3600)
  })

  it("parses mm:ss and plain seconds", () => {
    expect(parseThreeCxDuration("02:30")).toBe(150)
    expect(parseThreeCxDuration("45")).toBe(45)
  })

  it("returns undefined for zero, empty and garbage so it never overwrites a real duration", () => {
    expect(parseThreeCxDuration("00:00:00")).toBeUndefined()
    expect(parseThreeCxDuration("")).toBeUndefined()
    expect(parseThreeCxDuration(null)).toBeUndefined()
    expect(parseThreeCxDuration("not-a-duration")).toBeUndefined()
  })
})

describe("parseThreeCxDateTime", () => {
  it("parses the space-separated PBX format", () => {
    const parsed = parseThreeCxDateTime("2026-07-29 18:46:12")
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(6)
    expect(parsed?.getDate()).toBe(29)
  })

  it("returns undefined for unparseable input", () => {
    expect(parseThreeCxDateTime("whenever")).toBeUndefined()
    expect(parseThreeCxDateTime("")).toBeUndefined()
  })
})

describe("threeCxPhoneVariants", () => {
  it("returns only deterministic exact variants for an Azerbaijani mobile", () => {
    const { exact, canonicalE164, last9 } = threeCxPhoneVariants("+994 50 123-45-67")
    expect(exact).toEqual(["+994501234567", "994501234567", "0501234567"])
    expect(canonicalE164).toBe("+994501234567")
    expect(last9).toBe("501234567")
  })

  it("canonicalizes the unambiguous AZ national form without inventing a bare subscriber variant", () => {
    const { exact, canonicalE164, last9 } = threeCxPhoneVariants("0501234567")
    expect(exact).toEqual(["+994501234567", "994501234567", "0501234567"])
    expect(exact).not.toContain("501234567")
    expect(canonicalE164).toBe("+994501234567")
    expect(last9).toBe("501234567")
  })

  it("accepts an explicit international prefix deterministically", () => {
    expect(threeCxPhoneVariants("00994501234567")).toMatchObject({
      canonicalE164: "+994501234567",
      exact: ["+994501234567", "994501234567", "0501234567"],
    })
    expect(threeCxPhoneVariants("+905321234567")).toMatchObject({
      canonicalE164: "+905321234567",
      exact: ["+905321234567", "905321234567"],
    })
  })

  it("returns nothing usable for empty input", () => {
    expect(threeCxPhoneVariants("").exact).toHaveLength(0)
    expect(threeCxPhoneVariants("   ").last9).toBeUndefined()
  })

  it("fails closed for short extensions, ambiguous bare subscribers, and junk", () => {
    expect(threeCxPhoneVariants("101")).toEqual({ exact: [] })
    expect(threeCxPhoneVariants("501234567")).toEqual({ exact: [] })
    expect(threeCxPhoneVariants("not-a-number")).toEqual({ exact: [] })
  })
})

describe("buildThreeCxCrmTemplate", () => {
  const opts = {
    appUrl: "https://app.leaddrivecrm.org",
    organizationId: "org_123",
    secret: "s3cr3t",
  }

  it("emits both scenarios the PBX needs", () => {
    const xml = buildThreeCxCrmTemplate(opts)
    expect(xml).toContain(`Name="${THREECX_CRM_TEMPLATE_NAME}"`)
    // Contact lookup runs as the unnamed scenario; journaling is the reserved id.
    expect(xml).toContain('<Scenario Id="" Type="REST">')
    expect(xml).toContain('<Scenario Id="ReportCall" Type="REST">')
  })

  it("escapes query separators so the XML stays well-formed", () => {
    const xml = buildThreeCxCrmTemplate(opts)
    expect(xml).toContain("orgId=[OrgId]&amp;secret=[ApiSecret]")
    // A raw ampersand inside an attribute would make 3CX reject the upload.
    expect(xml).not.toMatch(/Url="[^"]*&(?!amp;|lt;|gt;|quot;|apos;)/)
  })

  it("bakes the org and secret in as parameter defaults", () => {
    const xml = buildThreeCxCrmTemplate(opts)
    expect(xml).toContain('Name="OrgId" Type="String" Title="Organization ID:" Default="org_123"')
    expect(xml).toContain('Default="s3cr3t"')
    expect(xml).toContain('Default="https://app.leaddrivecrm.org"')
  })

  it("maps the journaling fields our webhook reads", () => {
    const xml = buildThreeCxCrmTemplate(opts)
    for (const key of ["callType", "number", "agent", "duration", "dateTime"]) {
      expect(xml).toContain(`<Value Key="${key}">`)
    }
    expect(xml).toContain("[CallType]")
    expect(xml).toContain("[Number]")
  })

  it("escapes XML metacharacters coming from configuration", () => {
    const xml = buildThreeCxCrmTemplate({ ...opts, secret: 'a"b&c<d' })
    expect(xml).toContain("a&quot;b&amp;c&lt;d")
    expect(xml).not.toContain('a"b&c<d')
  })
})

describe("endpoint URLs", () => {
  const opts = { appUrl: "https://app.leaddrivecrm.org/", organizationId: "org_1", secret: "sec" }

  it("builds the lookup URL with a trailing number parameter for 3CX to append", () => {
    expect(threeCxLookupUrl(opts)).toBe(
      "https://app.leaddrivecrm.org/api/v1/calls/threecx/lookup?orgId=org_1&secret=sec&number=",
    )
  })

  it("builds the journal URL and strips the duplicate slash", () => {
    expect(threeCxJournalUrl(opts)).toBe(
      "https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?orgId=org_1&secret=sec",
    )
  })

  it("url-encodes values that would break the query string", () => {
    const url = threeCxJournalUrl({ ...opts, secret: "a b&c" })
    expect(url).toContain("secret=a%20b%26c")
  })
})
