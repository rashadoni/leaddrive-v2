import { describe, expect, it } from "vitest"
import {
  CUSTOMER_LOCATION_REQUEST_ERROR,
  LOCATION_REQUEST_MAX_ACCURACY_METERS,
  LOCATION_REQUEST_MAX_FIX_AGE_SECONDS,
  LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS,
  LOCATION_REQUEST_MIN_MOVE_METERS,
  customerLocationRequestForAgent,
  customerPinStillAt,
  customerPinUnchangedSince,
  evaluateCustomerLocationRequest,
  sameCustomerLocationRequest,
} from "@/lib/mtm/customer-location-request"

// «Клиент здесь» (owner, 2026-10-12): the agent, standing at a customer whose
// pin is in the wrong place, asks for it to be moved. These are the rules that
// make the question worth a manager's time — and keep it from being a way to
// move a pin to wherever visits would be convenient.

const NOW = new Date("2026-10-12T08:00:00.000Z")
/** About this many metres north of a latitude. */
const north = (latitude: number, meters: number) => latitude + meters / 111_195
// The pin as it stands in the base, and the door the agent is really at — 1.2 km north.
const PIN = { latitude: 40.4, longitude: 49.85 }
const DOOR = { latitude: north(40.4, 1_200), longitude: 49.85 }
const phone = (over: Partial<{ latitude: number; longitude: number; accuracyMeters: number; fixAgeSeconds: number; isMock: boolean | null }> = {}) => ({
  ...DOOR, accuracyMeters: 8, fixAgeSeconds: 4, ...over,
})

describe("a request to move a customer's pin, sent from the spot", () => {
  it("is taken when the phone knows where it is and the pin is put where the agent stands", () => {
    const verdict = evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone() }, PIN, NOW)
    expect(verdict).toEqual({
      ok: true,
      facts: {
        previousLatitude: 40.4, previousLongitude: 49.85,
        proposedLatitude: DOOR.latitude, proposedLongitude: 49.85,
        agentLatitude: DOOR.latitude, agentLongitude: 49.85,
        agentAccuracyMeters: 8,
        // Counted back from the server's clock by what the phone itself said of its fix.
        agentFixAt: new Date("2026-10-12T07:59:56.000Z"),
        movedMeters: 1_200,
        agentToProposedMeters: 0,
      },
    })
  })

  it("lets the agent move the pin to the entrance round the corner — and no further", () => {
    const near = { latitude: north(DOOR.latitude, LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS - 5), longitude: 49.85 }
    const taken = evaluateCustomerLocationRequest({ proposed: near, agent: phone() }, PIN, NOW)
    expect(taken.ok && taken.facts.agentToProposedMeters).toBe(LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS - 5)

    const street = { latitude: north(DOOR.latitude, LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS + 40), longitude: 49.85 }
    expect(evaluateCustomerLocationRequest({ proposed: street, agent: phone() }, PIN, NOW)).toEqual({
      ok: false,
      problem: "pinTooFar",
      details: { distanceMeters: LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS + 40, maxDistanceMeters: LOCATION_REQUEST_MAX_PIN_FROM_AGENT_METERS },
    })
  })

  // The way this would be abused: sit at home and «correct» a customer to there.
  it("refuses a pin the agent is nowhere near, however good his GPS is", () => {
    const home = { latitude: north(40.4, 9_000), longitude: 49.9 }
    const verdict = evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone(home) }, PIN, NOW)
    expect(verdict.ok).toBe(false)
    expect(!verdict.ok && verdict.problem).toBe("pinTooFar")
  })

  it("refuses a phone that does not know where it is", () => {
    expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ accuracyMeters: LOCATION_REQUEST_MAX_ACCURACY_METERS }) }, PIN, NOW).ok).toBe(true)
    expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ accuracyMeters: 350.4 }) }, PIN, NOW)).toEqual({
      ok: false, problem: "accuracy", details: { accuracyMeters: 350, maxAccuracyMeters: LOCATION_REQUEST_MAX_ACCURACY_METERS },
    })
  })

  it("refuses a place the phone was at earlier", () => {
    expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ fixAgeSeconds: LOCATION_REQUEST_MAX_FIX_AGE_SECONDS }) }, PIN, NOW).ok).toBe(true)
    expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ fixAgeSeconds: 900 }) }, PIN, NOW)).toEqual({
      ok: false, problem: "stale", details: { fixAgeSeconds: 900, maxFixAgeSeconds: LOCATION_REQUEST_MAX_FIX_AGE_SECONDS },
    })
  })

  it("refuses a position the phone was told to report — and accuses no phone that does not say", () => {
    expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ isMock: true }) }, PIN, NOW)).toEqual({ ok: false, problem: "mock", details: {} })
    for (const isMock of [false, null, undefined]) {
      expect(evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone({ isMock: isMock as boolean | null }) }, PIN, NOW).ok, String(isMock)).toBe(true)
    }
  })

  it("does not correct a pin that is already there", () => {
    const beside = { latitude: north(40.4, LOCATION_REQUEST_MIN_MOVE_METERS - 6), longitude: 49.85 }
    expect(evaluateCustomerLocationRequest({ proposed: beside, agent: phone(beside) }, PIN, NOW)).toEqual({
      ok: false, problem: "unchanged", details: { distanceMeters: LOCATION_REQUEST_MIN_MOVE_METERS - 6, minDistanceMeters: LOCATION_REQUEST_MIN_MOVE_METERS },
    })
    const further = { latitude: north(40.4, LOCATION_REQUEST_MIN_MOVE_METERS + 6), longitude: 49.85 }
    expect(evaluateCustomerLocationRequest({ proposed: further, agent: phone(further) }, PIN, NOW).ok).toBe(true)
  })

  // A customer with no pin cannot be visited by anybody (owner's decision, 2026-09-05): this is how it gets one in the field.
  it("gives a customer that has no pin its first one: there is nothing to measure the move from", () => {
    for (const pinless of [{ latitude: null, longitude: null }, {}, { latitude: 0, longitude: 0 }, { latitude: 40.4, longitude: null }]) {
      const verdict = evaluateCustomerLocationRequest({ proposed: DOOR, agent: phone() }, pinless, NOW)
      expect(verdict.ok && verdict.facts, JSON.stringify(pinless)).toMatchObject({ previousLatitude: null, previousLongitude: null, movedMeters: null })
    }
  })

  it("has a code for every refusal, and no two the same", () => {
    const codes = Object.values(CUSTOMER_LOCATION_REQUEST_ERROR)
    expect(Object.keys(CUSTOMER_LOCATION_REQUEST_ERROR).sort()).toEqual(["accuracy", "mock", "pinTooFar", "stale", "unchanged"])
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^MTM_LOCATION_REQUEST_[A-Z_]+$/)
  })
})

describe("a request sent twice with one key", () => {
  const stored = { customerId: "c1", proposedLatitude: DOOR.latitude, proposedLongitude: DOOR.longitude }
  it("is the same request only for the same customer and the same pin", () => {
    expect(sameCustomerLocationRequest(stored, "c1", DOOR)).toBe(true)
    expect(sameCustomerLocationRequest(stored, "c2", DOOR)).toBe(false)
    expect(sameCustomerLocationRequest(stored, "c1", { latitude: DOOR.latitude + 0.0001, longitude: DOOR.longitude })).toBe(false)
  })

  // Seen on a real Postgres: what was sent as 40.410791852151625 was read back as 40.41079185215163.
  it("is not made another request by the last digit a coordinate loses on its way through the database", () => {
    const back = { customerId: "c1", proposedLatitude: 40.41079185215163, proposedLongitude: 49.85 }
    expect(sameCustomerLocationRequest(back, "c1", { latitude: 40.410791852151625, longitude: 49.85 })).toBe(true)
    // A metre is another pin.
    expect(sameCustomerLocationRequest(back, "c1", { latitude: 40.410791852151625 + 1 / 111_195, longitude: 49.85 })).toBe(false)
  })
})

describe("a pin somebody moved after the agent asked", () => {
  const asked = { previousLatitude: 40.4, previousLongitude: 49.85 }
  it("is told from one that still stands where it stood", () => {
    expect(customerPinUnchangedSince(asked, { latitude: 40.4, longitude: 49.85 })).toBe(true)
    expect(customerPinUnchangedSince(asked, { latitude: 40.41, longitude: 49.85 })).toBe(false)
    expect(customerPinUnchangedSince(asked, { latitude: null, longitude: null })).toBe(false)
  })
  it("is not called moved for the last digit of a double — and puts the same question to the database", () => {
    expect(customerPinUnchangedSince({ previousLatitude: 40.41079185215163, previousLongitude: 49.85 }, { latitude: 40.410791852151625, longitude: 49.85 })).toBe(true)
    expect(customerPinStillAt({ previousLatitude: 40.4, previousLongitude: 49.85 })).toEqual({
      latitude: { gte: 40.4 - 1e-9, lte: 40.4 + 1e-9 },
      longitude: { gte: 49.85 - 1e-9, lte: 49.85 + 1e-9 },
    })
    // A pin that was not there matches only a pin that still is not.
    expect(customerPinStillAt({ previousLatitude: null, previousLongitude: null })).toEqual({ latitude: null, longitude: null })
  })
  it("knows «had no pin» from «has one now»", () => {
    const pinless = { previousLatitude: null, previousLongitude: null }
    expect(customerPinUnchangedSince(pinless, { latitude: null, longitude: null })).toBe(true)
    // 0,0 is «no coordinates» written as a number.
    expect(customerPinUnchangedSince(pinless, { latitude: 0, longitude: 0 })).toBe(true)
    expect(customerPinUnchangedSince(pinless, { latitude: 40.4, longitude: 49.85 })).toBe(false)
  })
})

describe("what the field app is told about a request", () => {
  const row = {
    id: "r1", status: "REJECTED", requestedByAgentId: "a1",
    proposedLatitude: 40.41, proposedLongitude: 49.85, movedMeters: 1_200,
    decisionComment: "Это склад, а не аптека", submittedAt: new Date("2026-10-12T08:00:00.000Z"), reviewedAt: new Date("2026-10-12T09:00:00.000Z"),
  }
  it("gives whoever asked the manager's words", () => {
    expect(customerLocationRequestForAgent(row, "a1")).toEqual({
      id: "r1", status: "REJECTED", mine: true, proposedLatitude: 40.41, proposedLongitude: 49.85, movedMeters: 1_200,
      decisionComment: "Это склад, а не аптека", submittedAt: "2026-10-12T08:00:00.000Z", reviewedAt: "2026-10-12T09:00:00.000Z",
    })
  })
  it("tells another agent only that a request is there — not who sent it, nor what a manager wrote", () => {
    const seen = customerLocationRequestForAgent({ ...row, status: "SUBMITTED", reviewedAt: null }, "a2")
    expect(seen).toMatchObject({ mine: false, status: "SUBMITTED", decisionComment: null, reviewedAt: null })
    expect(JSON.stringify(seen)).not.toContain("a1")
    expect(JSON.stringify(seen)).not.toContain("склад")
  })
})
