/**
 * Tests for C2 Mobile Studio slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  campaignAllowedNext,
  canCampaignTransition,
  canDeliveryTransition,
  deliveryAllowedNext,
  isCampaignStatus,
  isCampaignTerminal,
  isDeliveryStatus,
  isDeliveryTerminal,
} from "@/lib/mobile-studio/state-machine"
import { validateAudienceFilter } from "@/lib/mobile-studio/audience-filter-validator"
import { validateContent } from "@/lib/mobile-studio/content-validator"
import { checkDelivery } from "@/lib/mobile-studio/delivery-scheduler"
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRANSITIONS,
  DEFAULT_CONTENT_LIMITS,
  DELIVERY_STATUSES,
  DELIVERY_TRANSITIONS,
  MOBILE_CHANNELS,
} from "@/lib/mobile-studio/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("C2 — campaign state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of CAMPAIGN_STATUSES) expect(isCampaignStatus(s)).toBe(true)
  })

  it("rejects unknown values", () => {
    for (const s of ["", "Draft", "ACTIVE", 42, null]) {
      expect(isCampaignStatus(s)).toBe(false)
    }
  })

  it("draft → scheduled / cancelled", () => {
    expect(canCampaignTransition("draft", "scheduled").ok).toBe(true)
    expect(canCampaignTransition("draft", "cancelled").ok).toBe(true)
  })

  it("draft → in_flight rejected (must schedule first)", () => {
    expect(canCampaignTransition("draft", "in_flight").ok).toBe(false)
  })

  it("scheduled → in_flight / cancelled / failed", () => {
    for (const to of ["in_flight", "cancelled", "failed"] as const) {
      expect(canCampaignTransition("scheduled", to).ok).toBe(true)
    }
  })

  it("in_flight → completed / failed", () => {
    expect(canCampaignTransition("in_flight", "completed").ok).toBe(true)
    expect(canCampaignTransition("in_flight", "failed").ok).toBe(true)
  })

  it("in_flight → cancelled rejected (too late)", () => {
    expect(canCampaignTransition("in_flight", "cancelled").ok).toBe(false)
  })

  it("completed / cancelled / failed are terminal", () => {
    for (const s of ["completed", "cancelled", "failed"] as const) {
      expect(isCampaignTerminal(s)).toBe(true)
    }
  })

  it("rejects self-transition", () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(canCampaignTransition(s, s).ok).toBe(false)
    }
  })

  it("campaignAllowedNext matches table", () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(campaignAllowedNext(s)).toEqual(CAMPAIGN_TRANSITIONS[s])
    }
  })
})

describe("C2 — delivery state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of DELIVERY_STATUSES) expect(isDeliveryStatus(s)).toBe(true)
  })

  it("pending → sent / suppressed", () => {
    expect(canDeliveryTransition("pending", "sent").ok).toBe(true)
    expect(canDeliveryTransition("pending", "suppressed").ok).toBe(true)
  })

  it("pending → delivered rejected (must pass through sent)", () => {
    expect(canDeliveryTransition("pending", "delivered").ok).toBe(false)
  })

  it("sent → delivered / failed / bounced", () => {
    for (const to of ["delivered", "failed", "bounced"] as const) {
      expect(canDeliveryTransition("sent", to).ok).toBe(true)
    }
  })

  it("delivered / failed / bounced / suppressed are terminal", () => {
    for (const s of ["delivered", "failed", "bounced", "suppressed"] as const) {
      expect(isDeliveryTerminal(s)).toBe(true)
    }
  })

  it("deliveryAllowedNext matches table", () => {
    for (const s of DELIVERY_STATUSES) {
      expect(deliveryAllowedNext(s)).toEqual(DELIVERY_TRANSITIONS[s])
    }
  })
})

/* ─── Audience filter validator ───────────────────────────────────────── */

describe("C2 — audience-filter-validator", () => {
  it("accepts empty filter", () => {
    const r = validateAudienceFilter({ filter: {} })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.filter).toEqual({})
  })

  it("accepts complete filter", () => {
    const r = validateAudienceFilter({
      filter: {
        contactTags: ["vip", "newsletter"],
        segmentSlugs: ["high-value-customers"],
        channelOptIn: "push",
        excludeContactIds: ["contact_abc", "contact_def"],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects non-object filter", () => {
    expect(validateAudienceFilter({ filter: "not-an-object" as never }).ok).toBe(false)
    expect(validateAudienceFilter({ filter: [] as never }).ok).toBe(false)
  })

  it("rejects __proto__ top-level key (defense-in-depth)", () => {
    // JSON.parse creates `__proto__` as an own property (modern engines)
    // — different from object-literal sugar where `__proto__` is a setter
    // and doesn't enumerate. Our FORBIDDEN_KEYS check on Object.keys
    // catches it here.
    const r = validateAudienceFilter({
      filter: JSON.parse('{"__proto__":{"polluted":true}}'),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/reserved/)
  })

  it("rejects non-array contactTags", () => {
    const r = validateAudienceFilter({ filter: { contactTags: "vip" } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/array/)
  })

  it("rejects oversize contactTags (>256)", () => {
    const r = validateAudienceFilter({
      filter: { contactTags: Array.from({ length: 257 }, (_, i) => `t${i}`) },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects long tag string", () => {
    const r = validateAudienceFilter({
      filter: { contactTags: ["x".repeat(200)] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string tag entry", () => {
    const r = validateAudienceFilter({ filter: { contactTags: [42 as never] } })
    expect(r.ok).toBe(false)
  })

  it("rejects bad segment slug shape", () => {
    const r = validateAudienceFilter({
      filter: { segmentSlugs: ["has spaces"] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown channelOptIn", () => {
    const r = validateAudienceFilter({
      filter: { channelOptIn: "fax" },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts each canonical channel", () => {
    for (const channel of MOBILE_CHANNELS) {
      const r = validateAudienceFilter({ filter: { channelOptIn: channel } })
      expect(r.ok).toBe(true)
    }
  })

  it("rejects oversize excludeContactIds (>10000)", () => {
    const r = validateAudienceFilter({
      filter: { excludeContactIds: Array.from({ length: 10_001 }, (_, i) => `c${i}`) },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects forbidden string values (constructor / __proto__)", () => {
    const r = validateAudienceFilter({
      filter: { contactTags: ["constructor"] },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Content validator ───────────────────────────────────────────────── */

describe("C2 — content-validator: push", () => {
  it("accepts well-formed push content", () => {
    const r = validateContent({
      content: {
        channel: "push",
        title: "Hello!",
        body: "You have a new message",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("requires title for push", () => {
    const r = validateContent({
      content: { channel: "push", body: "body only" },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects oversize push title (>100)", () => {
    const r = validateContent({
      content: { channel: "push", title: "x".repeat(101), body: "ok" },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects oversize push body (>240)", () => {
    const r = validateContent({
      content: { channel: "push", title: "Title", body: "x".repeat(241) },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts optional deep-link", () => {
    const r = validateContent({
      content: {
        channel: "push",
        title: "T",
        body: "B",
        deepLinkUrl: "https://example.com/app/page",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects javascript: deep-link", () => {
    const r = validateContent({
      content: {
        channel: "push",
        title: "T",
        body: "B",
        deepLinkUrl: "javascript:alert(1)",
      },
    })
    expect(r.ok).toBe(false)
  })
})

describe("C2 — content-validator: in_app", () => {
  it("accepts well-formed in_app", () => {
    const r = validateContent({
      content: {
        channel: "in_app",
        title: "Welcome",
        body: "<p>Welcome to our app!</p>",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects in_app body > 5000", () => {
    const r = validateContent({
      content: {
        channel: "in_app",
        title: "T",
        body: "x".repeat(5001),
      },
    })
    expect(r.ok).toBe(false)
  })

  it("requires title for in_app", () => {
    const r = validateContent({
      content: { channel: "in_app", body: "body" },
    })
    expect(r.ok).toBe(false)
  })
})

describe("C2 — content-validator: sms", () => {
  it("accepts well-formed SMS", () => {
    const r = validateContent({
      content: { channel: "sms", body: "Your code: 1234" },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects SMS with title", () => {
    const r = validateContent({
      content: { channel: "sms", title: "subject", body: "body" },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects SMS body > 1600", () => {
    const r = validateContent({
      content: { channel: "sms", body: "x".repeat(1601) },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty body", () => {
    const r = validateContent({ content: { channel: "sms", body: "" } })
    expect(r.ok).toBe(false)
  })
})

describe("C2 — content-validator: cross-cutting", () => {
  it("rejects unknown channel", () => {
    const r = validateContent({
      content: { channel: "fax" as never, body: "ok" },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative limits", () => {
    const r = validateContent({
      content: { channel: "push", title: "T", body: "B" },
      limits: { pushBodyMax: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("respects custom limit override", () => {
    const r = validateContent({
      content: { channel: "push", title: "T", body: "long body here" },
      limits: { pushBodyMax: 5 },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Delivery scheduler ──────────────────────────────────────────────── */

describe("C2 — delivery-scheduler", () => {
  it("allows delivery when no quiet hours configured", () => {
    const r = checkDelivery({
      window: {},
      asOf: new Date("2026-05-18T03:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.check.canDeliver).toBe(true)
  })

  it("allows delivery outside quiet hours (UTC)", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8, timezone: "UTC" },
      asOf: new Date("2026-05-18T15:00:00Z"), // 15:00 UTC
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.check.canDeliver).toBe(true)
      expect(r.check.localHourAtAsOf).toBe(15)
    }
  })

  it("blocks delivery during quiet hours (UTC wrap-around)", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8, timezone: "UTC" },
      asOf: new Date("2026-05-18T03:00:00Z"), // 3 AM UTC, in quiet
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.check.canDeliver).toBe(false)
      expect(r.check.localHourAtAsOf).toBe(3)
      // Next delivery should be 5 hours later (3 → 8).
      expect(r.check.nextDeliveryAt).not.toBeNull()
    }
  })

  it("blocks delivery just-before-end of wrap window", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8, timezone: "UTC" },
      asOf: new Date("2026-05-18T23:00:00Z"), // 23:00 UTC, in quiet (past 22)
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.check.canDeliver).toBe(false)
      // 23 → 8 = (24-23)+8 = 9 hours
    }
  })

  it("non-wrap quiet hours (e.g. 12..14 lunch break)", () => {
    const r1 = checkDelivery({
      window: { quietHoursStart: 12, quietHoursEnd: 14, timezone: "UTC" },
      asOf: new Date("2026-05-18T13:00:00Z"),
    })
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.check.canDeliver).toBe(false)

    const r2 = checkDelivery({
      window: { quietHoursStart: 12, quietHoursEnd: 14, timezone: "UTC" },
      asOf: new Date("2026-05-18T15:00:00Z"),
    })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.check.canDeliver).toBe(true)
  })

  it("start === end treated as no quiet hours", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 10, quietHoursEnd: 10, timezone: "UTC" },
      asOf: new Date("2026-05-18T10:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.check.canDeliver).toBe(true)
  })

  it("rejects partial quiet-hour config (only start)", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22 },
      asOf: new Date("2026-05-18T03:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects out-of-range hour", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 25, quietHoursEnd: 8 },
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-integer hour", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 10.5 as never, quietHoursEnd: 14 },
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects invalid timezone", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8, timezone: "Not/A/Real/Zone" },
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("defaults to UTC when timezone omitted", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8 },
      asOf: new Date("2026-05-18T15:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.check.canDeliver).toBe(true)
  })

  it("respects non-UTC timezone", () => {
    // 15:00 UTC = 11:00 EST (UTC-4 in May; DST). 11 is outside quiet 22-8.
    const r = checkDelivery({
      window: {
        quietHoursStart: 22,
        quietHoursEnd: 8,
        timezone: "America/New_York",
      },
      asOf: new Date("2026-05-18T15:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.check.canDeliver).toBe(true)
      expect(r.check.localHourAtAsOf).toBe(11)
    }
  })

  it("rejects invalid asOf Date", () => {
    const r = checkDelivery({
      window: { quietHoursStart: 22, quietHoursEnd: 8 },
      asOf: new Date(NaN),
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("C2 — registry drift guards", () => {
  it("MOBILE_CHANNELS exactly 3", () => {
    expect(MOBILE_CHANNELS).toEqual(["push", "in_app", "sms"])
  })

  it("CAMPAIGN_STATUSES exactly 6", () => {
    expect(CAMPAIGN_STATUSES).toEqual([
      "draft",
      "scheduled",
      "in_flight",
      "completed",
      "cancelled",
      "failed",
    ])
  })

  it("DELIVERY_STATUSES exactly 6", () => {
    expect(DELIVERY_STATUSES).toEqual([
      "pending",
      "sent",
      "delivered",
      "failed",
      "bounced",
      "suppressed",
    ])
  })

  it("CAMPAIGN_TRANSITIONS covers every status", () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(CAMPAIGN_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("DELIVERY_TRANSITIONS covers every status", () => {
    for (const s of DELIVERY_STATUSES) {
      expect(DELIVERY_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal campaign statuses = [completed, cancelled, failed]", () => {
    const terminals = CAMPAIGN_STATUSES.filter(
      (s) => CAMPAIGN_TRANSITIONS[s].length === 0
    )
    expect(terminals.sort()).toEqual(["cancelled", "completed", "failed"])
  })

  it("Terminal delivery statuses = [delivered, failed, bounced, suppressed]", () => {
    const terminals = DELIVERY_STATUSES.filter(
      (s) => DELIVERY_TRANSITIONS[s].length === 0
    )
    expect(terminals.sort()).toEqual(["bounced", "delivered", "failed", "suppressed"])
  })

  it("DEFAULT_CONTENT_LIMITS all positive", () => {
    for (const [, v] of Object.entries(DEFAULT_CONTENT_LIMITS)) {
      expect(v).toBeGreaterThan(0)
    }
  })
})
