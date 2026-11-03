/**
 * When the WhatsApp agent books by itself and when a person decides. The rule
 * that stops a booking is the one the administrator reads on the request, so
 * which rule wins matters as much as whether one does.
 */
import { describe, expect, it } from "vitest"
import { autonomyVerdict, readAutonomyRules, rulesAreOpen, OPEN_RULES, type AutonomyCandidate } from "@/lib/booking/whatsapp-rules"
import { readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"
import type { WeeklyHours } from "@/lib/booking/availability"

const weekdays = (days: string[], start: string, end: string): WeeklyHours =>
  Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, days.includes(day) ? [{ start, end }] : []])) as WeeklyHours

// Saturday 11:30, a 90-minute colouring at 60 with Leyla, for a client the salon knows.
const candidate = (over: Partial<AutonomyCandidate> = {}): AutonomyCandidate => ({
  serviceId: "colouring", hostId: "leyla", weekday: "6", minuteOfDay: 11 * 60 + 30,
  durationMinutes: 90, price: 60, knownClient: true, ...over,
})

describe("what the rules let through", () => {
  it("lets everything through when the salon has narrowed nothing", () => {
    expect(rulesAreOpen(OPEN_RULES)).toBe(true)
    expect(autonomyVerdict(OPEN_RULES, candidate())).toEqual({ allowed: true })
    expect(autonomyVerdict(OPEN_RULES, candidate({ knownClient: false, price: null, minuteOfDay: 23 * 60 }))).toEqual({ allowed: true })
  })

  it("names the rule that stopped it, first one wins", () => {
    const rules = { ...OPEN_RULES, serviceIds: ["haircut"], hostIds: ["aysel"], maxPrice: 50 }
    // Service is checked before master, master before price: the first «no»
    // is the one the administrator is shown, and it must be stable.
    expect(autonomyVerdict(rules, candidate())).toEqual({ allowed: false, reason: "service" })
    expect(autonomyVerdict({ ...rules, serviceIds: null }, candidate())).toEqual({ allowed: false, reason: "host" })
    expect(autonomyVerdict({ ...rules, serviceIds: null, hostIds: null }, candidate())).toEqual({ allowed: false, reason: "price" })
  })

  it("asks about the hour of the meeting, and wants the whole meeting inside it", () => {
    const rules = { ...OPEN_RULES, hours: weekdays(["1", "2", "3", "4", "5", "6"], "10:00", "18:00") }
    expect(autonomyVerdict(rules, candidate())).toEqual({ allowed: true })
    // 17:00 + 90 minutes ends at 18:30 — half of it is outside the salon's rule.
    expect(autonomyVerdict(rules, candidate({ minuteOfDay: 17 * 60 }))).toEqual({ allowed: false, reason: "hours" })
    expect(autonomyVerdict(rules, candidate({ minuteOfDay: 9 * 60 }))).toEqual({ allowed: false, reason: "hours" })
    // Sunday is not in the rule at all.
    expect(autonomyVerdict(rules, candidate({ weekday: "0" }))).toEqual({ allowed: false, reason: "hours" })
  })

  it("treats a service with no price as unpriced, not as free", () => {
    const rules = { ...OPEN_RULES, maxPrice: 100 }
    expect(autonomyVerdict(rules, candidate({ price: 100 }))).toEqual({ allowed: true })
    expect(autonomyVerdict(rules, candidate({ price: 100.5 }))).toEqual({ allowed: false, reason: "price" })
    expect(autonomyVerdict(rules, candidate({ price: null }))).toEqual({ allowed: false, reason: "price" })
    // Without a limit an unpriced service is nobody's business.
    expect(autonomyVerdict(OPEN_RULES, candidate({ price: null }))).toEqual({ allowed: true })
  })

  it("holds a first-time client only when the salon asked for it", () => {
    expect(autonomyVerdict({ ...OPEN_RULES, newClients: false }, candidate({ knownClient: false }))).toEqual({ allowed: false, reason: "new_client" })
    expect(autonomyVerdict({ ...OPEN_RULES, newClients: false }, candidate())).toEqual({ allowed: true })
  })
})

describe("reading the rules back", () => {
  it("is open by default, and an organization that never opened the screen keeps its old behaviour", () => {
    expect(readAutonomyRules(undefined)).toEqual(OPEN_RULES)
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book" } }).rules).toEqual(OPEN_RULES)
    expect(rulesAreOpen(readAutonomyRules({ serviceIds: [], hostIds: [], hours: {}, maxPrice: null }))).toBe(true)
  })

  it("keeps what it can read and refuses to narrow on nonsense", () => {
    const stored = readAutonomyRules({
      serviceIds: ["a", "a", "b", 7], hostIds: ["leyla"],
      hours: { "6": [{ start: "10:00", end: "18:00" }, { start: "bad", end: "18:00" }], "0": "nope" },
      maxPrice: 50, newClients: false,
    })
    expect(stored.serviceIds).toEqual(["a", "b"])
    expect(stored.hostIds).toEqual(["leyla"])
    expect(stored.hours?.["6"]).toEqual([{ start: "10:00", end: "18:00" }])
    expect(stored.hours?.["0"]).toEqual([])
    expect(stored).toMatchObject({ maxPrice: 50, newClients: false })
    // A rule nobody can read must not silently stop the agent.
    expect(readAutonomyRules({ hours: { "6": [{ start: "18:00", end: "10:00" }] }, maxPrice: -5 })).toMatchObject({ hours: null, maxPrice: null })
  })

  it("saved through the setting, it is what the agent will obey", () => {
    const setting = readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", channelConfigId: "wa-1", rules: { serviceIds: ["haircut"], newClients: false } } })
    expect(setting).toMatchObject({ mode: "book", channelConfigId: "wa-1" })
    expect(setting.rules).toMatchObject({ serviceIds: ["haircut"], newClients: false, hostIds: null, hours: null, maxPrice: null })
    expect(rulesAreOpen(setting.rules)).toBe(false)
  })
})
