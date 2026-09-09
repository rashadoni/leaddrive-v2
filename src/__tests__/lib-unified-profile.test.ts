/**
 * Tests for G1 Unified Customer Profile slice 1 — identity-keys +
 * profile-merger + profile-aggregator pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import { normalizeIdentity } from "@/lib/unified-profile/identity-keys"
import { decideMerge } from "@/lib/unified-profile/profile-merger"
import {
  aggregateProfile,
  hasSignal,
} from "@/lib/unified-profile/profile-aggregator"
import {
  PROFILE_SOURCE_TYPES,
  type AggregatorInvoiceRow,
  type AggregatorSourceRow,
  type ExistingProfileRow,
  type MergeCandidate,
  type ProfileSourceType,
} from "@/lib/unified-profile/types"

/* ─── normalizeIdentity ───────────────────────────────────────────────── */

describe("G1 — normalizeIdentity", () => {
  it("lowercases + trims email", () => {
    const r = normalizeIdentity({ email: "  Foo@Example.COM  " })
    expect(r.emailNormalized).toBe("foo@example.com")
    expect(r.hasMatchableKey).toBe(true)
  })

  it("rejects malformed email (no @, no dot in domain)", () => {
    for (const bad of ["foo", "foo@bar", "@example.com", "foo@.com", ""]) {
      const r = normalizeIdentity({ email: bad })
      expect(r.emailNormalized).toBeNull()
    }
  })

  it("rejects email over 254 chars (RFC 3696)", () => {
    const local = "a".repeat(250)
    const r = normalizeIdentity({ email: `${local}@example.com` })
    expect(r.emailNormalized).toBeNull()
  })

  it("rejects email containing < or > (XSS-reflector defense, W1.6)", () => {
    for (const bad of ["<script>@x.y", "a@<b>.com", "a@b.c<d>", "foo<bar@x.com"]) {
      expect(normalizeIdentity({ email: bad }).emailNormalized).toBeNull()
    }
  })

  it("rejects null / undefined / whitespace email", () => {
    expect(normalizeIdentity({ email: null }).emailNormalized).toBeNull()
    expect(normalizeIdentity({ email: undefined }).emailNormalized).toBeNull()
    expect(normalizeIdentity({ email: "   " }).emailNormalized).toBeNull()
  })

  it("accepts already-E.164 phone", () => {
    const r = normalizeIdentity({ phone: "+994501234567" })
    expect(r.phoneNormalized).toBe("+994501234567")
  })

  it("strips whitespace + punctuation from E.164 phone", () => {
    const r = normalizeIdentity({ phone: "+994 (50) 123-45-67" })
    expect(r.phoneNormalized).toBe("+994501234567")
  })

  it("rejects E.164 phone with non-digit chars after strip", () => {
    const r = normalizeIdentity({ phone: "+994abc501234567" })
    expect(r.phoneNormalized).toBeNull()
  })

  it("rejects E.164 phone out of length bounds", () => {
    // < 7 digits
    expect(normalizeIdentity({ phone: "+12345" }).phoneNormalized).toBeNull()
    // > 15 digits
    expect(normalizeIdentity({ phone: "+1234567890123456" }).phoneNormalized).toBeNull()
  })

  it("normalizes local-format phone with defaultCountry hint (AZ)", () => {
    const r = normalizeIdentity({ phone: "050 123 45 67", defaultCountry: "AZ" })
    expect(r.phoneNormalized).toBe("+994501234567")
  })

  it("strips SINGLE leading zero (trunk prefix) on local-format phones", () => {
    // "050..." (leading 0) → "+994 50..."
    expect(normalizeIdentity({ phone: "0501234567", defaultCountry: "AZ" }).phoneNormalized).toBe(
      "+994501234567"
    )
  })

  it("does NOT over-strip on '00501234567' — keeps second 0 as significant digit", () => {
    // Architect Suggestion closure: `.replace(/^0+/, "")` would have
    // stripped BOTH leading zeros, producing "+994 501234567" (10
    // digits, same as the previous test). The trunk-prefix-only fix
    // strips ONE zero, keeping the second 0 as a (likely-malformed)
    // significant digit → "+994 0501234567" (11 digits, distinct).
    expect(normalizeIdentity({ phone: "00501234567", defaultCountry: "AZ" }).phoneNormalized).toBe(
      "+9940501234567"
    )
  })

  it("returns null for local-format phone without defaultCountry", () => {
    // Refuses to GUESS country — would be a fraud / fuzzy-match leak.
    const r = normalizeIdentity({ phone: "5551234567" })
    expect(r.phoneNormalized).toBeNull()
  })

  it("returns null for unknown defaultCountry", () => {
    const r = normalizeIdentity({ phone: "5551234567", defaultCountry: "XX" })
    expect(r.phoneNormalized).toBeNull()
  })

  it("collapses whitespace + lowercases name", () => {
    const r = normalizeIdentity({ name: "  John\t\tSmith  " })
    expect(r.nameNormalized).toBe("john smith")
  })

  it("returns null for empty / whitespace-only name", () => {
    expect(normalizeIdentity({ name: "" }).nameNormalized).toBeNull()
    expect(normalizeIdentity({ name: "   " }).nameNormalized).toBeNull()
  })

  it("hasMatchableKey is false when both email + phone are null (name doesn't count)", () => {
    const r = normalizeIdentity({ name: "Just A Name", email: "", phone: "" })
    expect(r.hasMatchableKey).toBe(false)
  })

  it("hasMatchableKey is true with email-only", () => {
    expect(normalizeIdentity({ email: "x@y.com" }).hasMatchableKey).toBe(true)
  })

  it("hasMatchableKey is true with phone-only", () => {
    expect(
      normalizeIdentity({ phone: "+994501234567" }).hasMatchableKey
    ).toBe(true)
  })
})

/* ─── decideMerge ─────────────────────────────────────────────────────── */

function makeCandidate(
  email: string | null,
  phone: string | null,
  sourceType: ProfileSourceType = "contact",
  sourceId: string = "src_1"
): MergeCandidate {
  return {
    identity: {
      emailNormalized: email,
      phoneNormalized: phone,
      nameNormalized: null,
      hasMatchableKey: email !== null || phone !== null,
    },
    sourceType,
    sourceId,
  }
}

describe("G1 — decideMerge", () => {
  it("rejects candidate with no matchable identity", () => {
    const r = decideMerge({
      candidate: makeCandidate(null, null),
      existing: [],
    })
    expect(r.action).toBe("reject")
    if (r.action === "reject") expect(r.reason).toMatch(/no email and no phone/)
  })

  it("returns create_new when no existing profile matches", () => {
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", null),
      existing: [
        { id: "p_1", emailNormalized: "other@bar.com", phoneNormalized: null },
      ],
    })
    expect(r.action).toBe("create_new")
  })

  it("merges into profile when email matches exactly", () => {
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", null),
      existing: [
        { id: "p_1", emailNormalized: "foo@bar.com", phoneNormalized: null },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") {
      expect(r.targetProfileId).toBe("p_1")
      expect(r.reason).toMatch(/Email exact match/)
    }
  })

  it("merges into profile when phone matches exactly (email absent)", () => {
    const r = decideMerge({
      candidate: makeCandidate(null, "+994501234567"),
      existing: [
        { id: "p_1", emailNormalized: null, phoneNormalized: "+994501234567" },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") expect(r.targetProfileId).toBe("p_1")
  })

  it("merges clean when BOTH email + phone match the SAME profile", () => {
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", "+994501234567"),
      existing: [
        {
          id: "p_1",
          emailNormalized: "foo@bar.com",
          phoneNormalized: "+994501234567",
        },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") {
      expect(r.targetProfileId).toBe("p_1")
      expect(r.reason).toMatch(/Email \+ phone both match/)
    }
  })

  it("returns 'ambiguous' when email + phone match DIFFERENT profiles", () => {
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", "+994501234567"),
      existing: [
        { id: "p_A", emailNormalized: "foo@bar.com", phoneNormalized: null },
        { id: "p_B", emailNormalized: null, phoneNormalized: "+994501234567" },
      ],
    })
    expect(r.action).toBe("ambiguous")
    if (r.action === "ambiguous") {
      expect(r.candidateProfileIds).toEqual(["p_A", "p_B"])
      expect(r.reason).toMatch(/needs operator review or G2/)
    }
  })

  it("first-found wins on duplicate-email existing rows (DB violation defensive)", () => {
    // Partial UNIQUE on (org, emailNormalized) prevents this at the DB
    // level; if a future bug ever lands two rows with the same email,
    // merger still produces a deterministic decision (first match wins).
    // ⚠️ Caller-side `orderBy` is REQUIRED — the merger sees whatever
    // order the caller passes. The "first-found" semantics combined
    // with explicit caller ordering (Prisma `orderBy: { id: 'asc' }`)
    // is what makes the path deterministic across cron runs.
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", null),
      existing: [
        { id: "p_1", emailNormalized: "foo@bar.com", phoneNormalized: null },
        { id: "p_2", emailNormalized: "foo@bar.com", phoneNormalized: null },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") expect(r.targetProfileId).toBe("p_1")
  })

  it("respects caller-supplied order (regression for the determinism contract)", () => {
    // Same candidate, same two existing profiles, but ORDER REVERSED.
    // Merger picks the first match in the array — proves the merger
    // does NOT impose its own sort order. Slice-2 cron MUST pass
    // `orderBy: { id: 'asc' }` to get reproducible behavior across
    // refreshes. Mirrors architect's note about Postgres heap-order
    // flipping the chosen profile without explicit ordering.
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", null),
      existing: [
        { id: "p_2", emailNormalized: "foo@bar.com", phoneNormalized: null },
        { id: "p_1", emailNormalized: "foo@bar.com", phoneNormalized: null },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") expect(r.targetProfileId).toBe("p_2")
  })

  it("matches by phone when candidate email matches NOTHING but phone matches", () => {
    const r = decideMerge({
      candidate: makeCandidate("new@bar.com", "+994501234567"),
      existing: [
        { id: "p_1", emailNormalized: "old@bar.com", phoneNormalized: "+994501234567" },
      ],
    })
    expect(r.action).toBe("merge_into")
    if (r.action === "merge_into") expect(r.targetProfileId).toBe("p_1")
  })

  it("only-email candidate vs phone-only profile → create_new (no match)", () => {
    const r = decideMerge({
      candidate: makeCandidate("foo@bar.com", null),
      existing: [
        { id: "p_1", emailNormalized: null, phoneNormalized: "+994501234567" },
      ],
    })
    expect(r.action).toBe("create_new")
  })
})

/* ─── aggregateProfile ────────────────────────────────────────────────── */

const T0 = new Date("2026-01-01T00:00:00Z")
const T1 = new Date("2026-03-15T00:00:00Z")
const T2 = new Date("2026-05-10T00:00:00Z")

function srcRow(
  sourceType: ProfileSourceType,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null
): AggregatorSourceRow {
  return { sourceType, firstSeenAt, lastSeenAt }
}

function inv(
  totalAmount: number,
  currency: string,
  status: string
): AggregatorInvoiceRow {
  return { totalAmount, currency, status }
}

describe("G1 — aggregateProfile", () => {
  it("computes totalSpent from PAID invoices in primaryCurrency only", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [
        inv(100, "USD", "paid"),
        inv(50, "USD", "draft"), // skipped — not paid
        inv(25, "USD", "paid"),
      ],
      primaryCurrency: "USD",
    })
    expect(r.totalSpent).toBe(125)
    expect(r.lifetimeOrderCount).toBe(2)
  })

  it("tracks non-primary-currency invoices in crossCurrencyTotals", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [
        inv(100, "USD", "paid"),
        inv(50, "EUR", "paid"),
        inv(80, "EUR", "paid"),
      ],
      primaryCurrency: "USD",
    })
    expect(r.totalSpent).toBe(100)
    expect(r.crossCurrencyTotals).toEqual({ EUR: 130 })
    // lifetimeOrderCount counts ALL paid orders regardless of currency.
    expect(r.lifetimeOrderCount).toBe(3)
  })

  it("ignores invoices with negative / NaN totalAmount (defensive)", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [
        inv(100, "USD", "paid"),
        inv(-50, "USD", "paid"),
        inv(Number.NaN, "USD", "paid"),
      ],
      primaryCurrency: "USD",
    })
    expect(r.totalSpent).toBe(100)
    expect(r.lifetimeOrderCount).toBe(1)
  })

  it("returns 0 totals on empty inputs", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.totalSpent).toBe(0)
    expect(r.lifetimeOrderCount).toBe(0)
    expect(r.firstSeenAt).toBeNull()
    expect(r.lastSeenAt).toBeNull()
    expect(r.channelsActive).toEqual([])
  })

  it("picks earliest firstSeenAt and latest lastSeenAt across sources", () => {
    const r = aggregateProfile({
      sources: [
        srcRow("contact", T1, T2),
        srcRow("lead", T0, T1),
      ],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.firstSeenAt?.toISOString()).toBe(T0.toISOString())
    expect(r.lastSeenAt?.toISOString()).toBe(T2.toISOString())
  })

  it("handles null timestamps without poisoning the rollup", () => {
    const r = aggregateProfile({
      sources: [
        srcRow("contact", null, T2),
        srcRow("lead", T0, null),
      ],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.firstSeenAt?.toISOString()).toBe(T0.toISOString())
    expect(r.lastSeenAt?.toISOString()).toBe(T2.toISOString())
  })

  it("emits channelsActive as sorted ProfileSourceType[] array (matches Postgres TEXT[] column)", () => {
    const r = aggregateProfile({
      sources: [
        srcRow("web_chat_session", T0, T0),
        srcRow("contact", T0, T0),
        srcRow("mtm_customer", T0, T0),
      ],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.channelsActive).toEqual(["contact", "mtm_customer", "web_chat_session"])
  })

  it("skips sources with no temporal signal from channelsActive", () => {
    const r = aggregateProfile({
      sources: [
        srcRow("contact", T0, T0),
        srcRow("lead", null, null), // no signal — skipped
      ],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.channelsActive).toEqual(["contact"])
  })

  it("channelsActive is EMPTY array (not undefined / null) when no sources have signal", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [],
      primaryCurrency: "USD",
    })
    expect(r.channelsActive).toEqual([])
  })

  it("rounds totalSpent to 2dp", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [
        inv(33.333, "USD", "paid"),
        inv(66.667, "USD", "paid"),
      ],
      primaryCurrency: "USD",
    })
    // 33.333 + 66.667 = 100.000 → 100
    expect(r.totalSpent).toBe(100)
  })

  it("crossCurrencyTotals rounded to 2dp per currency", () => {
    const r = aggregateProfile({
      sources: [],
      invoices: [
        inv(33.333, "EUR", "paid"),
        inv(33.333, "EUR", "paid"),
      ],
      primaryCurrency: "USD",
    })
    // 66.666 → 66.67
    expect(r.crossCurrencyTotals.EUR).toBe(66.67)
  })

  it("hasSignal predicate filters sources correctly", () => {
    expect(hasSignal(srcRow("contact", T0, T0))).toBe(true)
    expect(hasSignal(srcRow("contact", T0, null))).toBe(true)
    expect(hasSignal(srcRow("contact", null, T0))).toBe(true)
    expect(hasSignal(srcRow("contact", null, null))).toBe(false)
  })
})

/* ─── Type-registry completeness drift guard ──────────────────────────── */

describe("G1 — PROFILE_SOURCE_TYPES completeness", () => {
  it("has exactly 5 source types (no silent additions)", () => {
    expect(PROFILE_SOURCE_TYPES).toHaveLength(5)
    expect(PROFILE_SOURCE_TYPES).toEqual([
      "contact",
      "lead",
      "mtm_customer",
      "portal_user",
      "web_chat_session",
    ])
  })
})
