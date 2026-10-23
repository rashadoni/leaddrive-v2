/**
 * What goes to Meta's Conversions API: normalised and hashed contact data,
 * the action source, and a form's attribution read without trusting it.
 */
import { createHash } from "crypto"
import { describe, expect, it } from "vitest"
import { buildMetaEvent, normaliseEmail, normalisePhone } from "@/lib/ad-conversions/meta"
import { readAttribution } from "@/lib/ad-conversions/attribution"
import { isInboundLead } from "@/lib/ad-conversions/worker"

const sha = (value: string) => createHash("sha256").update(value).digest("hex")

describe("normalising contact data for Meta", () => {
  it("writes an Azerbaijani phone as digits with 994 and no plus", () => {
    expect(normalisePhone("050 123 45 67")).toBe("994501234567")
    expect(normalisePhone("501234567")).toBe("994501234567")
    expect(normalisePhone("+994 (50) 123-45-67")).toBe("994501234567")
    expect(normalisePhone("00994501234567")).toBe("994501234567")
    expect(normalisePhone("+7 916 123 45 67")).toBe("79161234567")
    expect(normalisePhone("12345")).toBeNull()
  })

  it("lower-cases and trims an e-mail, and drops a non-address", () => {
    expect(normaliseEmail("  Nigar@Example.AZ ")).toBe("nigar@example.az")
    expect(normaliseEmail("not an email")).toBeNull()
  })
})

describe("building an event", () => {
  const time = new Date("2026-10-23T10:00:00Z")

  it("hashes contact data and never sends it in the clear", () => {
    const event = buildMetaEvent({ eventId: "leaddrive:lead:1", eventName: "Lead", eventTime: time, email: "Nigar@Example.AZ", phone: "050 123 45 67" })
    expect(event?.user_data).toEqual({ em: [sha("nigar@example.az")], ph: [sha("994501234567")] })
    expect(JSON.stringify(event)).not.toMatch(/nigar|994501234567/i)
    expect(event).toMatchObject({ event_name: "Lead", event_time: 1792749600, event_id: "leaddrive:lead:1", action_source: "other" })
  })

  it("marks a lead captured on a web page as a website event, with the page and the browser", () => {
    const event = buildMetaEvent({
      eventId: "e", eventName: "Lead", eventTime: time, email: "a@b.az",
      attribution: { fbc: "fb.1.1792749000000.AbC", fbp: "fb.1.1792749000000.123", pageUrl: "https://shop.az/x", userAgent: "Mozilla/5.0" },
    })
    expect(event).toMatchObject({ action_source: "website", event_source_url: "https://shop.az/x" })
    expect(event?.user_data).toMatchObject({ fbc: "fb.1.1792749000000.AbC", fbp: "fb.1.1792749000000.123", client_user_agent: "Mozilla/5.0" })
  })

  it("sends a won deal as a Purchase with its amount and currency", () => {
    const event = buildMetaEvent({ eventId: "d", eventName: "Purchase", eventTime: time, phone: "0501234567", value: 4800.456, currency: "azn" })
    expect(event).toMatchObject({ action_source: "other", custom_data: { value: 4800.46, currency: "AZN" } })
  })

  it("builds nothing when there is nothing to match the person by", () => {
    expect(buildMetaEvent({ eventId: "x", eventName: "Lead", eventTime: time, email: "bad", phone: "1" })).toBeNull()
  })
})

describe("reading a form's attribution", () => {
  it("keeps valid fields, drops malformed ones, and builds fbc from a click id", () => {
    const now = new Date("2026-10-23T10:00:00Z")
    const result = readAttribution({
      fbclid: "IwAR0abc", fbp: "fb.1.1792749000000.98765", gclid: "Cj0KCQ", gaClientId: "123.456",
      utmSource: "instagram", utmCampaign: "oktyabr", pageUrl: "https://shop.az/form?x=1",
      fbc: "<script>", evil: "x", gaClientIdBad: 1,
    }, { userAgent: "UA", now })
    expect(result).toEqual({
      fbclid: "IwAR0abc", fbc: `fb.1.${now.getTime()}.IwAR0abc`, fbp: "fb.1.1792749000000.98765", gclid: "Cj0KCQ", gaClientId: "123.456",
      utmSource: "instagram", utmCampaign: "oktyabr", pageUrl: "https://shop.az/form?x=1", userAgent: "UA", capturedAt: now.toISOString(),
    })
  })

  it("stores nothing when the form sent nothing useful", () => {
    expect(readAttribution({ pageUrl: "javascript:alert(1)" })).toBeNull()
    expect(readAttribution("nope")).toBeNull()
  })
})

describe("which leads count as an ad's doing", () => {
  it("counts tracked and inbound leads, not calls, referrals or imports", () => {
    expect(isInboundLead({ source: "cold_call", adAttribution: { fbclid: "x" } })).toBe(true)
    expect(isInboundLead({ source: "Instagram", adAttribution: null })).toBe(true)
    expect(isInboundLead({ source: "form:contact-us", adAttribution: null })).toBe(true)
    expect(isInboundLead({ source: "booking:tanisliq", adAttribution: null })).toBe(true)
    for (const source of ["cold_call", "referral", "exhibition", "tiktok", "import", null]) {
      expect(isInboundLead({ source, adAttribution: null })).toBe(false)
    }
  })
})
