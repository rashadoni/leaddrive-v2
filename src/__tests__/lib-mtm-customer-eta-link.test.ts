/**
 * «Агент едет к вам» — the pure rules (src/lib/mtm/customer-eta-link.ts):
 * which stop he is driving to, whether now is the moment, to which number,
 * in what words. What reaches a phone, and the table, is held on a real
 * Postgres by mtm-customer-eta-links-postgres.test.ts.
 */
import { describe, expect, it } from "vitest"
import {
  customerEtaArrivesAt,
  customerEtaCountryCode,
  customerEtaDue,
  customerEtaFailure,
  customerEtaLanguage,
  customerEtaPhone,
  customerEtaRecipient,
  customerEtaSmsText,
  customerEtaWhatsAppVariables,
  nextCustomerEtaStop,
} from "@/lib/mtm/customer-eta-link"

const stop = (id: string, orderIndex: number, status = "PENDING") => ({ id, orderIndex, status, plannedTime: null })
const NOW = new Date("2026-11-02T07:02:00.000Z")

describe("which stop he is driving to", () => {
  it("is the first one still to do after the last one he has been to — a stop he passed by does not hold the rest back", () => {
    const stops = [stop("a", 0, "VISITED"), stop("b", 1), stop("c", 2, "VISITED"), stop("d", 3), stop("e", 4)]
    expect(nextCustomerEtaStop(stops, null)?.id).toBe("b")
    expect(nextCustomerEtaStop(stops, 2)?.id).toBe("d")
    expect(nextCustomerEtaStop(stops, 4)).toBeNull()
    expect(nextCustomerEtaStop([stop("x", 0, "SKIPPED")], null)).toBeNull()
  })
})

describe("whether now is the moment", () => {
  const agent = { latitude: 40.392, longitude: 49.85 }
  const customer = { latitude: 40.4093, longitude: 49.8671 }

  it("is not an hour and a half or more before the stop was planned, and not at the customer's door", () => {
    expect(customerEtaDue({ stop: { plannedTime: null }, agent, customer, now: NOW })).toBe(true)
    expect(customerEtaDue({ stop: { plannedTime: new Date(NOW.getTime() + 89 * 60_000) }, agent, customer, now: NOW })).toBe(true)
    expect(customerEtaDue({ stop: { plannedTime: new Date(NOW.getTime() + 91 * 60_000) }, agent, customer, now: NOW })).toBe(false)
    expect(customerEtaDue({ stop: { plannedTime: null }, agent: { latitude: 40.4096, longitude: 49.8671 }, customer, now: NOW })).toBe(false)
  })

  it("promises the arrival rounded up to five minutes, and nothing for an absent or implausible trip", () => {
    expect(customerEtaArrivesAt(19 * 60, NOW)?.toISOString()).toBe("2026-11-02T07:25:00.000Z")
    expect(customerEtaArrivesAt(18 * 60, NOW)?.toISOString()).toBe("2026-11-02T07:20:00.000Z")
    expect(customerEtaArrivesAt(null, NOW)).toBeNull()
    expect(customerEtaArrivesAt(Number.NaN, NOW)).toBeNull()
    expect(customerEtaArrivesAt(4 * 60 * 60, NOW)).toBeNull()
  })
})

describe("to which number", () => {
  const contact = { mobilePhone: "050 111 22 33", whatsappPhone: "+994 (55) 999-88-77", phone: null }
  it("SMS goes to the contact's mobile, WhatsApp to his WhatsApp, then the customer's own phone; a scrap of digits is no number", () => {
    expect(customerEtaRecipient("sms", contact, { phone: "+994125550000" }, "994")).toBe("+994501112233")
    expect(customerEtaRecipient("whatsapp", contact, null, "994")).toBe("+994559998877")
    expect(customerEtaRecipient("sms", { mobilePhone: "12-34" }, { phone: "+994 12 555 00 00" })).toBe("+994125550000")
    expect(customerEtaRecipient("sms", null, { phone: "" })).toBeNull()
  })

  it("places a number written without its country only where the company's country is known", () => {
    expect(customerEtaCountryCode("Asia/Baku")).toBe("994")
    expect(customerEtaCountryCode("Europe/Berlin")).toBeNull()
    expect(customerEtaPhone("050 111 22 33", "994")).toBe("+994501112233")
    expect(customerEtaPhone("994501112233", "994")).toBe("+994501112233")
    expect(customerEtaPhone("00994501112233")).toBe("+994501112233")
    // Elsewhere a national number is not guessed at: the SMS would go to somebody else.
    expect(customerEtaPhone("050 111 22 33")).toBeNull()
    expect(customerEtaPhone("0501112233", null)).toBeNull()
  })
})

describe("in what words", () => {
  const words = { organization: " NovaMed ", agent: "Elçin Məmmədov", time: "11:40", url: "https://app.example.test/share/location/x?lang=az" }
  it("in the agent's language, Azerbaijani when it is not one of ours, with or without the time", () => {
    expect(customerEtaLanguage("ru-RU")).toBe("ru")
    expect(customerEtaLanguage(null)).toBe("az")
    expect(customerEtaSmsText("az", words)).toBe("NovaMed: nümayəndəniz Elçin Məmmədov sizə tərəf yoldadır, təxminən 11:40 çatacaq. Harada olduğunu buradan görün: https://app.example.test/share/location/x?lang=az")
    expect(customerEtaSmsText("ru", { ...words, time: null })).toBe("NovaMed: ваш представитель Elçin Məmmədov едет к вам. Где он сейчас: https://app.example.test/share/location/x?lang=az")
    expect(customerEtaWhatsAppVariables({ ...words, time: null })).toEqual(["NovaMed", "Elçin Məmmədov", "—", words.url])
  })

  it("keeps a provider's failure short and without the number it was sent to", () => {
    expect(customerEtaFailure("Invalid 'To' Phone Number: +994 50 111 22 33")).toBe("Invalid 'To' Phone Number: …")
    expect(customerEtaFailure(new Error("x".repeat(500)))).toHaveLength(200)
  })
})
