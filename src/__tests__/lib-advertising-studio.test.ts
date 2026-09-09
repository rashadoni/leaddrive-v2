/**
 * Tests for C3 Advertising Studio slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  audienceSyncAllowedNext,
  canAudienceSyncTransition,
  canProviderTransition,
  canTrackingTransition,
  isAudienceSyncStatus,
  isAudienceSyncTerminal,
  isProviderStatus,
  isProviderTerminal,
  isTrackingStatus,
  isTrackingTerminal,
  providerAllowedNext,
  trackingAllowedNext,
} from "@/lib/advertising-studio/state-machine"
import { hashPii } from "@/lib/advertising-studio/pii-hasher"
import { buildAudiencePayload } from "@/lib/advertising-studio/audience-payload-builder"
import { aggregateMetrics } from "@/lib/advertising-studio/metrics-aggregator"
import {
  AD_PROVIDER_TYPES,
  AUDIENCE_SYNC_STATUSES,
  AUDIENCE_SYNC_TRANSITIONS,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  PROVIDER_STATUSES,
  PROVIDER_TRANSITIONS,
  TRACKING_STATUSES,
  TRACKING_TRANSITIONS,
  type AudienceMember,
} from "@/lib/advertising-studio/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("C3 — provider state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of PROVIDER_STATUSES) expect(isProviderStatus(s)).toBe(true)
  })

  it("draft → connected / error", () => {
    expect(canProviderTransition("draft", "connected").ok).toBe(true)
    expect(canProviderTransition("draft", "error").ok).toBe(true)
  })

  it("connected → disconnected / error / expired", () => {
    for (const to of ["disconnected", "error", "expired"] as const) {
      expect(canProviderTransition("connected", to).ok).toBe(true)
    }
  })

  it("disconnected → connected (re-auth)", () => {
    expect(canProviderTransition("disconnected", "connected").ok).toBe(true)
  })

  it("expired → connected (re-auth)", () => {
    expect(canProviderTransition("expired", "connected").ok).toBe(true)
  })

  it("rejects self-transition", () => {
    for (const s of PROVIDER_STATUSES) {
      expect(canProviderTransition(s, s).ok).toBe(false)
    }
  })

  it("no terminal statuses (all can recover)", () => {
    for (const s of PROVIDER_STATUSES) {
      expect(isProviderTerminal(s)).toBe(false)
    }
  })

  it("providerAllowedNext matches table", () => {
    for (const s of PROVIDER_STATUSES) {
      expect(providerAllowedNext(s)).toEqual(PROVIDER_TRANSITIONS[s])
    }
  })
})

describe("C3 — audience-sync state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of AUDIENCE_SYNC_STATUSES) expect(isAudienceSyncStatus(s)).toBe(true)
  })

  it("pending → syncing / deleted", () => {
    expect(canAudienceSyncTransition("pending", "syncing").ok).toBe(true)
    expect(canAudienceSyncTransition("pending", "deleted").ok).toBe(true)
  })

  it("syncing → active / error / deleted", () => {
    for (const to of ["active", "error", "deleted"] as const) {
      expect(canAudienceSyncTransition("syncing", to).ok).toBe(true)
    }
  })

  it("active → stale (source edits) / error / deleted", () => {
    expect(canAudienceSyncTransition("active", "stale").ok).toBe(true)
    expect(canAudienceSyncTransition("active", "error").ok).toBe(true)
  })

  it("stale → syncing (re-push)", () => {
    expect(canAudienceSyncTransition("stale", "syncing").ok).toBe(true)
  })

  it("error → syncing (retry)", () => {
    expect(canAudienceSyncTransition("error", "syncing").ok).toBe(true)
  })

  it("deleted is terminal", () => {
    expect(isAudienceSyncTerminal("deleted")).toBe(true)
  })

  it("audienceSyncAllowedNext matches table", () => {
    for (const s of AUDIENCE_SYNC_STATUSES) {
      expect(audienceSyncAllowedNext(s)).toEqual(AUDIENCE_SYNC_TRANSITIONS[s])
    }
  })
})

describe("C3 — tracking state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of TRACKING_STATUSES) expect(isTrackingStatus(s)).toBe(true)
  })

  it("active → paused / completed / archived", () => {
    for (const to of ["paused", "completed", "archived"] as const) {
      expect(canTrackingTransition("active", to).ok).toBe(true)
    }
  })

  it("paused → active (resume)", () => {
    expect(canTrackingTransition("paused", "active").ok).toBe(true)
  })

  it("completed → archived", () => {
    expect(canTrackingTransition("completed", "archived").ok).toBe(true)
  })

  it("archived is terminal", () => {
    expect(isTrackingTerminal("archived")).toBe(true)
  })

  it("trackingAllowedNext matches table", () => {
    for (const s of TRACKING_STATUSES) {
      expect(trackingAllowedNext(s)).toEqual(TRACKING_TRANSITIONS[s])
    }
  })
})

/* ─── PII hasher ──────────────────────────────────────────────────────── */

describe("C3 — pii-hasher: email", () => {
  it("hashes lowercased trimmed email", () => {
    const r1 = hashPii({ kind: "email", value: "  Jane@Example.COM  " })
    const r2 = hashPii({ kind: "email", value: "jane@example.com" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.sha256Hex).toBe(r2.sha256Hex)
    }
  })

  it("produces deterministic SHA-256", () => {
    const r = hashPii({ kind: "email", value: "jane@example.com" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Known SHA-256 of "jane@example.com"
      expect(r.sha256Hex).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it("rejects malformed email", () => {
    expect(hashPii({ kind: "email", value: "not-an-email" }).ok).toBe(false)
    expect(hashPii({ kind: "email", value: "" }).ok).toBe(false)
  })
})

describe("C3 — pii-hasher: phone", () => {
  it("strips formatting + auto-prefixes +", () => {
    // Caller is expected to pass E.164-friendly raw; helper just
    // strips formatting + ensures + prefix. With identical digits
    // (no country code dropped), formatted/unformatted hash equal.
    const r1 = hashPii({ kind: "phone", value: "+1 (415) 555-1234" })
    const r2 = hashPii({ kind: "phone", value: "+14155551234" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.sha256Hex).toBe(r2.sha256Hex)
    }
  })

  it("auto-prefixes + when missing (caller didn't include country code)", () => {
    // Without leading +, helper prefixes — but the digit string DOESN'T
    // include a country code. Caller is responsible for full E.164.
    const r = hashPii({ kind: "phone", value: "(415) 555-1234" })
    expect(r.ok).toBe(true)
    // Sanity: this hashes to "+4155551234" — a different value than
    // "+14155551234" (the US 1-prefix is the caller's responsibility).
    const ref = hashPii({ kind: "phone", value: "+4155551234" })
    expect(ref.ok).toBe(true)
    if (r.ok && ref.ok) {
      expect(r.sha256Hex).toBe(ref.sha256Hex)
    }
  })

  it("preserves explicit + prefix", () => {
    const r = hashPii({ kind: "phone", value: "+44 20 7946 0958" })
    expect(r.ok).toBe(true)
  })

  it("rejects short phone (<7 digits)", () => {
    expect(hashPii({ kind: "phone", value: "12345" }).ok).toBe(false)
  })

  it("rejects empty phone", () => {
    expect(hashPii({ kind: "phone", value: "" }).ok).toBe(false)
  })
})

describe("C3 — pii-hasher: names", () => {
  it("first_name: strips diacritics + lowercase + letters-only", () => {
    const r1 = hashPii({ kind: "first_name", value: "  Jōsé  " })
    const r2 = hashPii({ kind: "first_name", value: "jose" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) expect(r1.sha256Hex).toBe(r2.sha256Hex)
  })

  it("last_name: strips spaces/hyphens", () => {
    const r1 = hashPii({ kind: "last_name", value: "Van-Der Berg" })
    const r2 = hashPii({ kind: "last_name", value: "vanderberg" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) expect(r1.sha256Hex).toBe(r2.sha256Hex)
  })

  it("rejects name with no letters", () => {
    expect(hashPii({ kind: "first_name", value: "123 !@#" }).ok).toBe(false)
  })
})

describe("C3 — pii-hasher: zip + country", () => {
  it("zip: lowercases + strips spaces", () => {
    const r1 = hashPii({ kind: "zip", value: "SW1A 1AA" })
    const r2 = hashPii({ kind: "zip", value: "sw1a1aa" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) expect(r1.sha256Hex).toBe(r2.sha256Hex)
  })

  it("country: accepts ISO-3166-1 alpha-2 lowercase", () => {
    const r = hashPii({ kind: "country", value: "US" })
    expect(r.ok).toBe(true)
  })

  it("country: rejects non-2-letter codes", () => {
    expect(hashPii({ kind: "country", value: "USA" }).ok).toBe(false)
    expect(hashPii({ kind: "country", value: "U" }).ok).toBe(false)
  })
})

describe("C3 — pii-hasher: cross-cutting", () => {
  it("rejects unknown PII kind", () => {
    const r = hashPii({ kind: "ssn" as never, value: "123" })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string value", () => {
    const r = hashPii({ kind: "email", value: 42 as never })
    expect(r.ok).toBe(false)
  })
})

/* ─── Audience payload builder ────────────────────────────────────────── */

describe("C3 — audience-payload-builder", () => {
  const m1: AudienceMember = {
    email: "alice@example.com",
    phone: "+14155551234",
    firstName: "Alice",
    lastName: "Smith",
    zip: "94103",
    country: "US",
  }
  const m2: AudienceMember = {
    email: "bob@example.com",
    phone: "+14155555678",
  }

  it("facebook: builds 6-field schema", () => {
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "Test Audience",
      members: [m1, m2],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches).toHaveLength(1)
      expect(r.batches[0].schema).toEqual(["EMAIL", "PHONE", "FN", "LN", "ZIP", "COUNTRY"])
      expect(r.batches[0].data).toHaveLength(2)
      // m1 has all 6 fields hashed; m2 has only email+phone.
      expect(r.batches[0].data[1][0].length).toBe(64) // hashed email
      expect(r.batches[0].data[1][2]).toBe("") // no first_name
    }
  })

  it("google: builds 6-field schema, postal_code + country_code unhashed", () => {
    const r = buildAudiencePayload({
      providerType: "google",
      audienceName: "G",
      members: [m1],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches[0].schema).toContain("postal_code")
      expect(r.batches[0].data[0][4]).toBe("94103") // unhashed lowercase
      expect(r.batches[0].data[0][5]).toBe("us") // unhashed lowercase
    }
  })

  it("linkedin: only sha256Email", () => {
    const r = buildAudiencePayload({
      providerType: "linkedin",
      audienceName: "LI",
      members: [m1, m2],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches[0].schema).toEqual(["sha256Email"])
      expect(r.batches[0].data[0]).toHaveLength(1)
    }
  })

  it("tiktok: 2-field schema", () => {
    const r = buildAudiencePayload({
      providerType: "tiktok",
      audienceName: "TT",
      members: [m1],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches[0].schema).toEqual(["EMAIL_SHA256", "PHONE_SHA256"])
    }
  })

  it("twitter: 3-field schema with empty TWITTER_ID", () => {
    const r = buildAudiencePayload({
      providerType: "twitter",
      audienceName: "TW",
      members: [m1],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches[0].data[0][2]).toBe("")
    }
  })

  it("skips unmatchable members (no email/phone)", () => {
    const r = buildAudiencePayload({
      providerType: "linkedin",
      audienceName: "LI",
      members: [m1, { firstName: "NoEmailNoPhone" } as AudienceMember],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.unmatchableCount).toBe(1)
      expect(r.batches[0].data).toHaveLength(1)
    }
  })

  it("batches members per batchSize", () => {
    const members = Array.from({ length: 25_000 }, (_, i) => ({
      email: `user${i}@example.com`,
    }))
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "Big",
      members,
      batchSize: 10_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.batches).toHaveLength(3) // 10k + 10k + 5k
      expect(r.batches[0].data).toHaveLength(10_000)
      expect(r.batches[2].data).toHaveLength(5_000)
    }
  })

  it("rejects unknown provider", () => {
    const r = buildAudiencePayload({
      providerType: "snapchat" as never,
      audienceName: "X",
      members: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty audienceName", () => {
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "",
      members: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects oversize batchSize", () => {
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "X",
      members: [],
      batchSize: MAX_BATCH_SIZE + 1,
    })
    expect(r.ok).toBe(false)
  })

  it("defaults to DEFAULT_BATCH_SIZE", () => {
    const members = Array.from({ length: 15_000 }, (_, i) => ({
      email: `u${i}@x.com`,
    }))
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "X",
      members,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 15000 / 10000 = 2 batches.
      expect(r.batches).toHaveLength(2)
      expect(r.batches[0].data).toHaveLength(DEFAULT_BATCH_SIZE)
    }
  })

  it("zero-member audience produces zero batches", () => {
    const r = buildAudiencePayload({
      providerType: "facebook",
      audienceName: "Empty",
      members: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.batches).toHaveLength(0)
  })
})

/* ─── Metrics aggregator ──────────────────────────────────────────────── */

describe("C3 — metrics-aggregator", () => {
  it("computes totals + ratios for single campaign", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 100_000_00, // $100,000
          impressions: 1_000_000,
          clicks: 20_000,
          conversions: 200,
          conversionValueMinor: 400_000_00, // $400,000
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const a = r.aggregate
      expect(a.totalSpendMinor).toBe(100_000_00)
      expect(a.totalImpressions).toBe(1_000_000)
      expect(a.totalClicks).toBe(20_000)
      expect(a.totalConversions).toBe(200)
      expect(a.ctr).toBeCloseTo(0.02) // 2%
      expect(a.conversionRate).toBeCloseTo(0.01) // 1%
      expect(a.cpaMinor).toBe(50_000) // $500
      expect(a.roas).toBeCloseTo(4) // 4x
      expect(a.cpcMinor).toBe(500) // $5
    }
  })

  it("aggregates across multiple campaigns", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 50_00,
          impressions: 1000,
          clicks: 100,
          conversions: 5,
          conversionValueMinor: 250_00,
          currency: "USD",
        },
        {
          spendMinor: 30_00,
          impressions: 500,
          clicks: 50,
          conversions: 3,
          conversionValueMinor: 150_00,
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aggregate.totalSpendMinor).toBe(80_00)
      expect(r.aggregate.campaignCount).toBe(2)
    }
  })

  it("returns null ratios when divisors are 0 (architect-pass: consistent)", () => {
    // Architect-pass-1 close-out: ALL ratios are nullable now (was
    // mixed 0-vs-null). null distinguishes "no data" from "0%".
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValueMinor: 0,
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aggregate.ctr).toBeNull()
      expect(r.aggregate.conversionRate).toBeNull()
      expect(r.aggregate.cpaMinor).toBeNull()
      expect(r.aggregate.roas).toBeNull()
      expect(r.aggregate.cpcMinor).toBeNull()
    }
  })

  it("rejects mixed currencies", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 100,
          impressions: 10,
          clicks: 1,
          conversions: 0,
          conversionValueMinor: 0,
          currency: "USD",
        },
        {
          spendMinor: 100,
          impressions: 10,
          clicks: 1,
          conversions: 0,
          conversionValueMinor: 0,
          currency: "EUR",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects clicks > impressions", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 0,
          impressions: 100,
          clicks: 150,
          conversions: 0,
          conversionValueMinor: 0,
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conversions > clicks", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: 0,
          impressions: 100,
          clicks: 10,
          conversions: 20,
          conversionValueMinor: 0,
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative values", () => {
    const r = aggregateMetrics({
      baseCurrency: "USD",
      campaigns: [
        {
          spendMinor: -1,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValueMinor: 0,
          currency: "USD",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad baseCurrency", () => {
    const r = aggregateMetrics({ baseCurrency: "usd", campaigns: [] })
    expect(r.ok).toBe(false)
  })

  it("empty campaigns yields zero aggregate", () => {
    const r = aggregateMetrics({ baseCurrency: "USD", campaigns: [] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aggregate.totalSpendMinor).toBe(0)
      expect(r.aggregate.campaignCount).toBe(0)
    }
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("C3 — registry drift guards", () => {
  it("AD_PROVIDER_TYPES exactly 5", () => {
    expect(AD_PROVIDER_TYPES).toEqual([
      "facebook",
      "google",
      "linkedin",
      "tiktok",
      "twitter",
    ])
  })

  it("PROVIDER_STATUSES exactly 5", () => {
    expect(PROVIDER_STATUSES).toEqual([
      "draft",
      "connected",
      "disconnected",
      "error",
      "expired",
    ])
  })

  it("AUDIENCE_SYNC_STATUSES exactly 6", () => {
    expect(AUDIENCE_SYNC_STATUSES).toEqual([
      "pending",
      "syncing",
      "active",
      "stale",
      "error",
      "deleted",
    ])
  })

  it("TRACKING_STATUSES exactly 4", () => {
    expect(TRACKING_STATUSES).toEqual(["active", "paused", "completed", "archived"])
  })

  it("All transition tables cover every status", () => {
    for (const s of PROVIDER_STATUSES) expect(PROVIDER_TRANSITIONS[s]).toBeDefined()
    for (const s of AUDIENCE_SYNC_STATUSES) {
      expect(AUDIENCE_SYNC_TRANSITIONS[s]).toBeDefined()
    }
    for (const s of TRACKING_STATUSES) expect(TRACKING_TRANSITIONS[s]).toBeDefined()
  })

  it("Provider has no terminal statuses (all recover)", () => {
    for (const s of PROVIDER_STATUSES) {
      expect(PROVIDER_TRANSITIONS[s].length).toBeGreaterThan(0)
    }
  })

  it("Terminal audience-sync = [deleted]", () => {
    const terminals = AUDIENCE_SYNC_STATUSES.filter(
      (s) => AUDIENCE_SYNC_TRANSITIONS[s].length === 0
    )
    expect(terminals).toEqual(["deleted"])
  })

  it("Terminal tracking = [archived]", () => {
    const terminals = TRACKING_STATUSES.filter(
      (s) => TRACKING_TRANSITIONS[s].length === 0
    )
    expect(terminals).toEqual(["archived"])
  })

  it("Batch size constants sensible", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(10_000)
    expect(MAX_BATCH_SIZE).toBeGreaterThanOrEqual(DEFAULT_BATCH_SIZE)
  })
})

/* ─── Post-architect fixes ───────────────────────────────────────────── */

describe("C3 — post-architect (invalidCount vs unmatchableCount split)", () => {
  it("malformed members count toward invalidCount, not unmatchableCount", () => {
    const r = buildAudiencePayload({
      providerType: "linkedin",
      audienceName: "X",
      members: [
        { email: "valid@example.com" },
        null as never,
        { firstName: "NoEmail" }, // legit, no match key → unmatchable
        "garbage" as never,
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.invalidCount).toBe(2) // null + string
      expect(r.unmatchableCount).toBe(1) // legit but no email
      expect(r.batches[0].data).toHaveLength(1)
    }
  })

  it("zero invalid + zero unmatchable when all valid + matched", () => {
    const r = buildAudiencePayload({
      providerType: "linkedin",
      audienceName: "X",
      members: [{ email: "a@x.com" }, { email: "b@x.com" }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.invalidCount).toBe(0)
      expect(r.unmatchableCount).toBe(0)
    }
  })
})

describe("C3 — post-architect (ASCII-only name limitation)", () => {
  it("Cyrillic name → null (caller must transliterate)", () => {
    const r = hashPii({ kind: "first_name", value: "Алексей" })
    expect(r.ok).toBe(false)
  })

  it("Chinese name → null", () => {
    const r = hashPii({ kind: "first_name", value: "张伟" })
    expect(r.ok).toBe(false)
  })

  it("Arabic name → null", () => {
    const r = hashPii({ kind: "last_name", value: "محمد" })
    expect(r.ok).toBe(false)
  })

  it("Pre-transliterated name accepted (Aleksey)", () => {
    const r = hashPii({ kind: "first_name", value: "Aleksey" })
    expect(r.ok).toBe(true)
  })
})

describe("C3 — post-architect (Google uses pii-hasher normaliser)", () => {
  it("Google postal_code path produces same normalisation as zip-kind hasher", () => {
    const r = buildAudiencePayload({
      providerType: "google",
      audienceName: "G",
      members: [
        {
          email: "test@example.com",
          zip: "SW1A 1AA",
          country: "GB",
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // postal_code unhashed but normalised — spaces stripped, lowercased.
      expect(r.batches[0].data[0][4]).toBe("sw1a1aa")
      expect(r.batches[0].data[0][5]).toBe("gb")
    }
  })
})
