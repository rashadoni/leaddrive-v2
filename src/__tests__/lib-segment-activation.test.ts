/**
 * Tests for G5 Segment Activation slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  activationAllowedNext,
  canActivationTransition,
  canRunTransition,
  isActivationStatus,
  isActivationTerminal,
  isRunStatus,
  isRunTerminal,
  runAllowedNext,
} from "@/lib/segment-activation/state-machine"
import { diffMembers } from "@/lib/segment-activation/member-diff-calculator"
import { allRoutes, routeTarget } from "@/lib/segment-activation/target-payload-router"
import { evaluateSchedule } from "@/lib/segment-activation/schedule-evaluator"
import {
  ACTIVATION_STATUSES,
  ACTIVATION_TARGET_TYPES,
  ACTIVATION_TRANSITIONS,
  DEFAULT_MAX_MEMBERS_PER_RUN,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  TRIGGER_SOURCES,
} from "@/lib/segment-activation/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("G5 — activation state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of ACTIVATION_STATUSES) expect(isActivationStatus(s)).toBe(true)
  })

  it("draft → active / archived", () => {
    expect(canActivationTransition("draft", "active").ok).toBe(true)
    expect(canActivationTransition("draft", "archived").ok).toBe(true)
  })

  it("active → paused / archived / error", () => {
    for (const to of ["paused", "archived", "error"] as const) {
      expect(canActivationTransition("active", to).ok).toBe(true)
    }
  })

  it("error → active (auto-recover) / paused / archived", () => {
    for (const to of ["active", "paused", "archived"] as const) {
      expect(canActivationTransition("error", to).ok).toBe(true)
    }
  })

  it("archived is terminal", () => {
    expect(isActivationTerminal("archived")).toBe(true)
    for (const to of ["draft", "active", "paused", "error"] as const) {
      expect(canActivationTransition("archived", to).ok).toBe(false)
    }
  })

  it("rejects self-transition", () => {
    for (const s of ACTIVATION_STATUSES) {
      expect(canActivationTransition(s, s).ok).toBe(false)
    }
  })

  it("activationAllowedNext matches table", () => {
    for (const s of ACTIVATION_STATUSES) {
      expect(activationAllowedNext(s)).toEqual(ACTIVATION_TRANSITIONS[s])
    }
  })
})

describe("G5 — run state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of RUN_STATUSES) expect(isRunStatus(s)).toBe(true)
  })

  it("pending → running / skipped", () => {
    expect(canRunTransition("pending", "running").ok).toBe(true)
    expect(canRunTransition("pending", "skipped").ok).toBe(true)
  })

  it("pending → succeeded rejected (must pass through running)", () => {
    expect(canRunTransition("pending", "succeeded").ok).toBe(false)
  })

  it("running → succeeded / failed", () => {
    expect(canRunTransition("running", "succeeded").ok).toBe(true)
    expect(canRunTransition("running", "failed").ok).toBe(true)
  })

  it("succeeded / failed / skipped are terminal", () => {
    for (const s of ["succeeded", "failed", "skipped"] as const) {
      expect(isRunTerminal(s)).toBe(true)
    }
  })

  it("runAllowedNext matches table", () => {
    for (const s of RUN_STATUSES) {
      expect(runAllowedNext(s)).toEqual(RUN_TRANSITIONS[s])
    }
  })
})

/* ─── Member diff calculator ──────────────────────────────────────────── */

describe("G5 — member-diff-calculator", () => {
  it("empty + empty → empty diff", () => {
    const r = diffMembers({ previousMembers: [], currentMembers: [] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added).toEqual([])
      expect(r.diff.removed).toEqual([])
      expect(r.diff.unchanged).toEqual([])
      expect(r.diff.currentCount).toBe(0)
    }
  })

  it("empty + new → all added", () => {
    const r = diffMembers({ previousMembers: [], currentMembers: ["a", "b", "c"] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added.sort()).toEqual(["a", "b", "c"])
      expect(r.diff.removed).toEqual([])
      expect(r.diff.currentCount).toBe(3)
    }
  })

  it("all-prev + empty → all removed", () => {
    const r = diffMembers({ previousMembers: ["a", "b"], currentMembers: [] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added).toEqual([])
      expect(r.diff.removed.sort()).toEqual(["a", "b"])
    }
  })

  it("partial overlap", () => {
    const r = diffMembers({
      previousMembers: ["a", "b", "c"],
      currentMembers: ["b", "c", "d"],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added).toEqual(["d"])
      expect(r.diff.removed).toEqual(["a"])
      expect(r.diff.unchanged.sort()).toEqual(["b", "c"])
    }
  })

  it("identical sets → all unchanged", () => {
    const r = diffMembers({
      previousMembers: ["a", "b"],
      currentMembers: ["a", "b"],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.unchanged.sort()).toEqual(["a", "b"])
      expect(r.diff.added).toEqual([])
      expect(r.diff.removed).toEqual([])
    }
  })

  it("output is deterministic (sorted)", () => {
    const r = diffMembers({
      previousMembers: ["z", "y", "x"],
      currentMembers: ["x", "y", "w"],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added).toEqual(["w"])
      expect(r.diff.removed).toEqual(["z"])
      expect(r.diff.unchanged).toEqual(["x", "y"])
    }
  })

  it("dedupes within input arrays via Set semantics", () => {
    const r = diffMembers({
      previousMembers: ["a", "a", "b"],
      currentMembers: ["b", "b", "c"],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.diff.added).toEqual(["c"])
      expect(r.diff.removed).toEqual(["a"])
      expect(r.diff.currentCount).toBe(2) // Set size, not array length
    }
  })

  it("rejects oversized current (>maxMembers)", () => {
    const r = diffMembers({
      previousMembers: [],
      currentMembers: Array.from({ length: 100_001 }, (_, i) => `m${i}`),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds maxMembers/)
  })

  it("respects custom maxMembers", () => {
    const r = diffMembers({
      previousMembers: [],
      currentMembers: ["a", "b", "c"],
      maxMembers: 2,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds maxMembers 2/)
  })

  it("rejects non-array inputs", () => {
    expect(diffMembers({ previousMembers: "string" as never, currentMembers: [] }).ok).toBe(false)
    expect(diffMembers({ previousMembers: [], currentMembers: "string" as never }).ok).toBe(false)
  })

  it("rejects non-string element", () => {
    const r = diffMembers({
      previousMembers: [],
      currentMembers: ["a", 42 as never, "b"],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty-string element", () => {
    const r = diffMembers({
      previousMembers: ["a"],
      currentMembers: ["", "b"],
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Target payload router ───────────────────────────────────────────── */

describe("G5 — target-payload-router", () => {
  it("routes ad_audience_sync → advertising-studio helper", () => {
    const r = routeTarget({ targetType: "ad_audience_sync" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.helper).toBe("advertising-studio.audience-payload-builder")
      expect(r.route.supportsIncremental).toBe(true)
    }
  })

  it("routes mobile_campaign → mobile-studio helper", () => {
    const r = routeTarget({ targetType: "mobile_campaign" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.helper).toBe("mobile-studio.dispatcher")
    }
  })

  it("routes email_campaign → email-campaign helper", () => {
    const r = routeTarget({ targetType: "email_campaign" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.supportsIncremental).toBe(false)
    }
  })

  it("routes webhook → generic poster", () => {
    const r = routeTarget({ targetType: "webhook" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.supportsIncremental).toBe(false)
    }
  })

  it("rejects unknown target type", () => {
    const r = routeTarget({ targetType: "carrier_pigeon" as never })
    expect(r.ok).toBe(false)
  })

  it("allRoutes covers every canonical target type", () => {
    const routes = allRoutes()
    expect(routes).toHaveLength(ACTIVATION_TARGET_TYPES.length)
    for (const t of ACTIVATION_TARGET_TYPES) {
      expect(routes.some((r) => r.targetType === t)).toBe(true)
    }
  })
})

/* ─── Schedule evaluator ──────────────────────────────────────────────── */

describe("G5 — schedule-evaluator", () => {
  const NOW = new Date("2026-05-18T12:00:00Z") // Sun Jun 14, 2026 — wait Mon May 18.

  it("null schedule → never due", () => {
    const r = evaluateSchedule({ schedule: null, lastRunAt: null, asOf: NOW })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.isDue).toBe(false)
      expect(r.evaluation.nextFireAt).toBeNull()
      expect(r.evaluation.parseValid).toBe(true)
    }
  })

  it("parses 5-field cron", () => {
    const r = evaluateSchedule({
      schedule: "0 3 * * *", // daily 03:00 UTC
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(true)
      expect(r.evaluation.nextFireAt).not.toBeNull()
    }
  })

  it("hourly cron is due if last run was 2 hours ago", () => {
    const lastRun = new Date(NOW.getTime() - 2 * 60 * 60 * 1000)
    const r = evaluateSchedule({
      schedule: "0 * * * *", // top of every hour
      lastRunAt: lastRun,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.isDue).toBe(true)
    }
  })

  it("hourly cron is NOT due when last run just fired (current hour)", () => {
    // NOW = 12:00 UTC; lastRun = 12:00 (just fired). Next fire of
    // hourly schedule = 13:00 > asOf → not due. Use asOf slightly
    // after the fire-time so we test the post-fire state.
    const asOf = new Date("2026-05-18T12:05:00Z")
    const lastRun = new Date("2026-05-18T12:00:00Z")
    const r = evaluateSchedule({
      schedule: "0 * * * *",
      lastRunAt: lastRun,
      asOf,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.isDue).toBe(false)
      // Next fire = 13:00.
      expect(r.evaluation.nextFireAt?.getUTCHours()).toBe(13)
    }
  })

  it("supports list syntax (0,15,30,45 * * * *)", () => {
    const r = evaluateSchedule({
      schedule: "0,15,30,45 * * * *",
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(true)
    }
  })

  it("supports range syntax (0-5 * * * *)", () => {
    const r = evaluateSchedule({
      schedule: "0-5 * * * *",
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.evaluation.parseValid).toBe(true)
  })

  it("supports step syntax (*/5 * * * *)", () => {
    const r = evaluateSchedule({
      schedule: "*/5 * * * *",
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.evaluation.parseValid).toBe(true)
  })

  it("rejects cron with wrong field count", () => {
    const r = evaluateSchedule({
      schedule: "0 3 * *", // 4 fields
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(false)
      expect(r.evaluation.parseError).toMatch(/5 space-separated/)
    }
  })

  it("rejects out-of-range value", () => {
    const r = evaluateSchedule({
      schedule: "0 25 * * *", // hour 25 invalid
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(false)
    }
  })

  it("rejects invalid step", () => {
    const r = evaluateSchedule({
      schedule: "*/0 * * * *",
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(false)
    }
  })

  it("rejects garbage values", () => {
    const r = evaluateSchedule({
      schedule: "abc def * * *",
      lastRunAt: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.evaluation.parseValid).toBe(false)
  })

  it("rejects invalid asOf", () => {
    const r = evaluateSchedule({
      schedule: null,
      lastRunAt: null,
      asOf: new Date(NaN),
    })
    expect(r.ok).toBe(false)
  })

  it("ancient lastRunAt does NOT silently render activation never-fire", () => {
    // Architect-pass-1 close-out: a stale lastRunAt (e.g. 1999) used
    // to consume all 366 days of lookahead without finding a match.
    // The clamp `max(lastRunAt+1min, asOf-24h)` now anchors the walk
    // to the recent past, so the schedule still resolves.
    const r = evaluateSchedule({
      schedule: "0 3 * * *", // daily 03:00
      lastRunAt: new Date("1999-01-01T00:00:00Z"), // ancient
      asOf: new Date("2026-05-18T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.evaluation.parseValid).toBe(true)
      expect(r.evaluation.nextFireAt).not.toBeNull()
      // 2026-05-18 12:00 is past today's 03:00 → isDue=true; nextFireAt
      // (display) = next day's 03:00.
      expect(r.evaluation.isDue).toBe(true)
    }
  })

  it("monthly cron pinpoints exact next fire", () => {
    // First-of-month at noon UTC. asOf = May 18, lastRunAt = null →
    // searchStart = max(asOf - 24h, asOf - 24h) = May 17 12:00.
    // First match from May 17 12:00 walking forward = Jun 1 12:00 UTC.
    // (May 1 12:00 is before searchStart, doesn't qualify.)
    // Architect-pass-1 close-out: assert exact year+month+day+hour
    // instead of just "day=1 + hour=12" to catch drift in
    // search-window logic.
    const r = evaluateSchedule({
      schedule: "0 12 1 * *",
      lastRunAt: null,
      asOf: new Date("2026-05-18T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.evaluation.nextFireAt) {
      const next = r.evaluation.nextFireAt
      expect(next.getUTCFullYear()).toBe(2026)
      expect(next.getUTCMonth()).toBe(5) // June (0-indexed)
      expect(next.getUTCDate()).toBe(1)
      expect(next.getUTCHours()).toBe(12)
      expect(next.getUTCMinutes()).toBe(0)
    }
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("G5 — registry drift guards", () => {
  it("ACTIVATION_STATUSES exactly 5", () => {
    expect(ACTIVATION_STATUSES).toEqual(["draft", "active", "paused", "archived", "error"])
  })

  it("RUN_STATUSES exactly 5", () => {
    expect(RUN_STATUSES).toEqual(["pending", "running", "succeeded", "failed", "skipped"])
  })

  it("ACTIVATION_TARGET_TYPES exactly 4", () => {
    expect(ACTIVATION_TARGET_TYPES).toEqual([
      "ad_audience_sync",
      "mobile_campaign",
      "email_campaign",
      "webhook",
    ])
  })

  it("TRIGGER_SOURCES exactly 3", () => {
    expect(TRIGGER_SOURCES).toEqual(["cron", "manual", "api"])
  })

  it("DEFAULT_MAX_MEMBERS_PER_RUN is 100K (FB/Google audience max)", () => {
    expect(DEFAULT_MAX_MEMBERS_PER_RUN).toBe(100_000)
  })

  it("Transition tables cover every status", () => {
    for (const s of ACTIVATION_STATUSES) {
      expect(ACTIVATION_TRANSITIONS[s]).toBeDefined()
    }
    for (const s of RUN_STATUSES) {
      expect(RUN_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal activations = [archived]", () => {
    const terminals = ACTIVATION_STATUSES.filter(
      (s) => ACTIVATION_TRANSITIONS[s].length === 0
    )
    expect(terminals).toEqual(["archived"])
  })

  it("Terminal runs = [succeeded, failed, skipped]", () => {
    const terminals = RUN_STATUSES.filter((s) => RUN_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(["failed", "skipped", "succeeded"])
  })

  it("allRoutes() covers ACTIVATION_TARGET_TYPES (router drift guard)", () => {
    expect(allRoutes().map((r) => r.targetType).sort()).toEqual(
      [...ACTIVATION_TARGET_TYPES].sort()
    )
  })
})
