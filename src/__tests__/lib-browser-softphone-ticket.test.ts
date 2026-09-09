/**
 * The parking ticket is the only thing standing between a colleague and a call.
 *
 * The call's UUID cannot do that job: every user in the organisation can read
 * it from the ordinary call list. So the ticket has to name one user, one call,
 * and a moment after which it is worthless — and it has to fail closed on every
 * way of being wrong, without saying which way it was.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  browserSoftphoneAllowed,
  issueParkTicket,
  readParkTicket,
  PARK_TICKET_TTL_MS,
} from "@/lib/voip/browser-softphone"

const SECRET = "a".repeat(48)
const CLAIMS = { orgId: "org-1", userId: "user-1", callLogId: "call-1" }

beforeEach(() => {
  process.env.BROWSER_SOFTPHONE_TICKET_SECRET = SECRET
  process.env.BROWSER_SOFTPHONE_ENABLED = "1"
  process.env.SOFTPHONE_RELAY_URL = "wss://relay.example/browser"
})

afterEach(() => {
  delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
  delete process.env.BROWSER_SOFTPHONE_ENABLED
  delete process.env.SOFTPHONE_RELAY_URL
})

describe("park ticket", () => {
  it("round-trips the call it was minted for", () => {
    const now = 1_700_000_000_000
    const ticket = issueParkTicket(CLAIMS, now)!
    expect(ticket).toBeTruthy()
    expect(readParkTicket(ticket, now + 1_000)).toEqual({ ...CLAIMS, expiresAt: now + PARK_TICKET_TTL_MS })
  })

  it("signs the exact inbound claim token into the ticket", () => {
    const now = 1_700_000_000_000
    const claimToken = "11111111-1111-4111-8111-111111111111"
    const ticket = issueParkTicket({ ...CLAIMS, claimToken }, now)!

    expect(readParkTicket(ticket, now + 1_000)).toEqual({
      ...CLAIMS,
      claimToken,
      expiresAt: now + PARK_TICKET_TTL_MS,
    })
  })

  it("expires, so a ticket cannot be circulated", () => {
    const now = 1_700_000_000_000
    const ticket = issueParkTicket(CLAIMS, now)!
    expect(readParkTicket(ticket, now + PARK_TICKET_TTL_MS - 1)).not.toBeNull()
    expect(readParkTicket(ticket, now + PARK_TICKET_TTL_MS)).toBeNull()
  })

  it("refuses a ticket whose claims were edited", () => {
    const now = 1_700_000_000_000
    const ticket = issueParkTicket(CLAIMS, now)!
    const [encoded, signature] = ticket.split(".")
    const body = Buffer.from(encoded, "base64url").toString("utf8")
    // Same signature, someone else's call.
    const forged = `${Buffer.from(body.replace("call-1", "call-2")).toString("base64url")}.${signature}`
    expect(readParkTicket(forged, now + 1_000)).toBeNull()
  })

  it("refuses a ticket signed with another secret", () => {
    const now = 1_700_000_000_000
    const ticket = issueParkTicket(CLAIMS, now)!
    process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "b".repeat(48)
    expect(readParkTicket(ticket, now + 1_000)).toBeNull()
  })

  it.each([undefined, null, "", "not-a-ticket", "a.b.c.d", 42])(
    "refuses malformed input without throwing: %s",
    (value) => {
      expect(readParkTicket(value as unknown)).toBeNull()
    },
  )

  it("mints nothing when the deployment has no signing secret", () => {
    // The feature must stay off rather than fall back to something weaker.
    delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
    expect(issueParkTicket(CLAIMS)).toBeNull()
    expect(readParkTicket("anything")).toBeNull()
  })

  it("needs a short secret to be treated as no secret at all", () => {
    process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "short"
    expect(issueParkTicket(CLAIMS)).toBeNull()
  })
})

describe("both gates ask about the user", () => {
  // The `userId` argument is optional so a caller with no user behaves as
  // before. That convenience is also the trap: a call site that HAS a user and
  // omits it widens the rollout to the whole tenant, silently and in the
  // permissive direction. Asserted at the source, because a route test that
  // mocks the gate would pass either way.
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

  it("the capabilities route passes the session's user", () => {
    const source = read("src/app/api/v1/voip/capabilities/route.ts")
    expect(source).toMatch(/browserSoftphoneAllowed\([^)]*userId\)/)
    expect(source).toContain('checkPermission(role, "voip", "write")')
  })

  it("the call route passes the authenticated user", () => {
    const source = read("src/app/api/v1/calls/route.ts")
    expect(source).toMatch(/browserSoftphoneAllowed\([^)]*auth\.userId\)/)
  })
})

describe("rollout by salesperson", () => {
  // The whole point of a pilot: one person, then the team. Empty list means the
  // organisation flag alone decides, so a deployment that never sets this sees
  // no change at all.
  afterEach(() => { delete process.env.BROWSER_SOFTPHONE_USER_IDS })

  it("means the whole organisation while the list is empty", () => {
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-1")).toBe(true)
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(true)
  })

  it("narrows to the named salespeople once the list is set", () => {
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-1, user-2"
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-1")).toBe(true)
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-2")).toBe(true)
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-3")).toBe(false)
  })

  it("refuses a caller with no user at all once the list is set", () => {
    // A caller that HAS a user and forgets to pass it would otherwise widen the
    // rollout to the whole tenant silently. Failing closed makes that a bug that
    // shows up as "the button is missing" rather than as "everyone got it".
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-1"
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(false)
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "")).toBe(false)
  })

  it("is read fresh, so a changed list does not wait for a restart", () => {
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-1"
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-9")).toBe(false)
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-1,user-9"
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-9")).toBe(true)
  })

  it("never overrides a no from the switches above it", () => {
    // The list is a narrowing, never a grant: being on it cannot turn the kill
    // switch or the tenant's own flag back on.
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-1"
    expect(browserSoftphoneAllowed({ browserSoftphone: false }, "user-1")).toBe(false)
    delete process.env.BROWSER_SOFTPHONE_ENABLED
    expect(browserSoftphoneAllowed({ browserSoftphone: true }, "user-1")).toBe(false)
  })
})

describe("browserSoftphoneAllowed", () => {
  it("needs both the kill switch and the tenant flag", () => {
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(true)
    expect(browserSoftphoneAllowed({ browserSoftphone: false })).toBe(false)
    expect(browserSoftphoneAllowed({})).toBe(false)
    expect(browserSoftphoneAllowed(undefined)).toBe(false)
  })

  it("falls back to the phone path the moment the environment says stop", () => {
    delete process.env.BROWSER_SOFTPHONE_ENABLED
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(false)
  })

  it("refuses when the deployment could not finish the call anyway", () => {
    // Without these the flags would authorise a call, the customer's phone
    // would ring, and only then would the server find it has no secret to mint
    // a ticket with or no relay to name — a real person listening to silence
    // because of a configuration mistake.
    delete process.env.SOFTPHONE_RELAY_URL
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(false)

    process.env.SOFTPHONE_RELAY_URL = "https://not-a-socket.example"
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(false)

    process.env.SOFTPHONE_RELAY_URL = "wss://relay.example/browser"
    delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
    expect(browserSoftphoneAllowed({ browserSoftphone: true })).toBe(false)
  })
})
