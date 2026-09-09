/**
 * Exhaustive unit tests for the Slice 3e-1 parallel approval router.
 *
 * Coverage matrix:
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │ backward_compat   — single-stage levels == old sequential (all modes)    │
 *  │ all_mode          — 2-stage + 3-stage levels                             │
 *  │ any_mode          — first approve wins; all-reject fails                 │
 *  │ quorum_mode       — K-of-N: pass / fail / partial undecided              │
 *  │ multi_level       — mixed level types across a full chain                │
 *  │ guards            — non-current-level, non-pending, missing stage, etc.  │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * No DB — pure synchronous function calls.
 */
import { describe, expect, it } from "vitest"
import { routeApproval } from "@/lib/contract-lifecycle/approval-router"
import type { ApprovalStageState } from "@/lib/contract-lifecycle/types"

const NOW = new Date("2026-06-07T10:00:00Z")
const BY = "user-a"

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a simple sequential chain (one stage per order, all pending, all-mode).
 * Mirrors the legacy `freshChainOfN` used in lib-contract-lifecycle.test.ts.
 */
function seqChain(n: number): ApprovalStageState[] {
  return Array.from({ length: n }, (_, i) => ({
    stageId: `s${i + 1}`,
    order: i + 1,
    status: "pending" as const,
    parallelMode: "all" as const,
  }))
}

/** Build a parallel level — all stages share the same order and parallelMode. */
function parallelLevel(
  order: number,
  count: number,
  mode: "all" | "any" | "quorum",
  quorumThreshold?: number,
  statuses?: ("pending" | "approved" | "rejected" | "skipped")[]
): ApprovalStageState[] {
  return Array.from({ length: count }, (_, i) => ({
    stageId: `o${order}-s${i + 1}`,
    order,
    status: (statuses?.[i] ?? "pending") as ApprovalStageState["status"],
    parallelMode: mode,
    quorumThreshold: quorumThreshold ?? null,
  }))
}

// ── BACKWARD-COMPAT ──────────────────────────────────────────────────────────

describe("backward_compat — single-stage all-mode levels == sequential", () => {
  it("approving the first stage of a 3-stage chain advances to order 2", () => {
    const r = routeApproval({
      stages: seqChain(3),
      stageId: "s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.chainRejected).toBe(false)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBe(2)
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ stageId: "s1", order: 1, status: "approved", decidedBy: BY })
  })

  it("approving the last stage of a 3-stage chain sets chainApproved", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "s2", order: 2, status: "approved", decidedBy: "u2", decidedAt: NOW, parallelMode: "all" },
      { stageId: "s3", order: 3, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({ stages, stageId: "s3", stageOrder: 3, decision: "approve", decidedBy: BY, at: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
    expect(r.chainRejected).toBe(false)
    expect(r.nextPendingOrder).toBeNull()
    expect(r.levelComplete).toBe(true)
    expect(r.updates[0]).toMatchObject({ stageId: "s3", order: 3, status: "approved" })
  })

  it("rejecting the first stage shorts the chain (orders 2,3 → skipped)", () => {
    const r = routeApproval({
      stages: seqChain(3),
      stageId: "s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.chainApproved).toBe(false)
    expect(r.nextPendingOrder).toBeNull()
    expect(r.updates).toHaveLength(3)
    expect(r.updates.find((u) => u.order === 1)?.status).toBe("rejected")
    expect(r.updates.find((u) => u.order === 2)?.status).toBe("skipped")
    expect(r.updates.find((u) => u.order === 3)?.status).toBe("skipped")
  })

  it("single-stage chain: approve → chainApproved, no updates except the stage", () => {
    const r = routeApproval({
      stages: [{ stageId: "s1", order: 1, status: "pending", parallelMode: "all" }],
      stageId: "s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.updates).toHaveLength(1)
  })

  it("single-stage chain: reject → chainRejected immediately", () => {
    const r = routeApproval({
      stages: [{ stageId: "s1", order: 1, status: "pending", parallelMode: "all" }],
      stageId: "s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBeNull()
  })

  it("backward-compat: stages without stageId or parallelMode work (all fields optional)", () => {
    // Legacy caller — no stageId, no parallelMode (pure order-based)
    const r = routeApproval({
      stages: [
        { order: 1, status: "pending" },
        { order: 2, status: "pending" },
      ],
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.nextPendingOrder).toBe(2)
  })
})

// ── ALL MODE ─────────────────────────────────────────────────────────────────

describe("all_mode — 2-stage parallel level", () => {
  const twoStageLevel: ApprovalStageState[] = parallelLevel(1, 2, "all")
  // [order1-s1, order1-s2], both pending

  it("approving one stage → level undecided (levelComplete=false)", () => {
    const r = routeApproval({
      stages: twoStageLevel,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.chainRejected).toBe(false)
    expect(r.levelComplete).toBe(false)
    expect(r.nextPendingOrder).toBe(1) // still the same level
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ stageId: "o1-s1", status: "approved" })
  })

  it("approving both stages (second after first) → level approved, chainApproved", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s2",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBeNull()
  })

  it("rejecting one stage → level rejected immediately, chainRejected", () => {
    const r = routeApproval({
      stages: twoStageLevel,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBeNull()
    // Only the rejected stage in updates (the other was still pending,
    // but there are no later-level pending stages to skip — single level).
    expect(r.updates.find((u) => u.stageId === "o1-s1")?.status).toBe("rejected")
  })

  it("3-stage all-mode: two approved, reject third → chainRejected", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "o1-s2", order: 1, status: "approved", decidedBy: "u2", decidedAt: NOW, parallelMode: "all" },
      { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s3",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.updates.find((u) => u.stageId === "o1-s3")?.status).toBe("rejected")
  })

  it("3-stage all-mode: approving first two doesn't complete level (third still pending)", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "all" },
      { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s2",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.levelComplete).toBe(false)
    expect(r.nextPendingOrder).toBe(1)
  })
})

// ── ANY MODE ─────────────────────────────────────────────────────────────────

describe("any_mode — first approve passes, all-reject fails", () => {
  const anyLevel: ApprovalStageState[] = parallelLevel(1, 3, "any")

  it("first approve → level approved, other 2 pending → skipped", () => {
    const r = routeApproval({
      stages: anyLevel,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.updates.find((u) => u.stageId === "o1-s1")?.status).toBe("approved")
    expect(r.updates.find((u) => u.stageId === "o1-s2")?.status).toBe("skipped")
    expect(r.updates.find((u) => u.stageId === "o1-s3")?.status).toBe("skipped")
    expect(r.nextPendingOrder).toBeNull()
  })

  it("first reject alone → level undecided (two others still pending)", () => {
    const r = routeApproval({
      stages: anyLevel,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.levelComplete).toBe(false)
    expect(r.chainRejected).toBe(false)
    expect(r.nextPendingOrder).toBe(1)
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ stageId: "o1-s1", status: "rejected" })
  })

  it("two rejects → still undecided (one pending left)", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "any" },
      { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "any" },
      { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "any" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s2",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.levelComplete).toBe(false)
    expect(r.chainRejected).toBe(false)
    expect(r.nextPendingOrder).toBe(1)
  })

  it("all three reject → level rejected, chainRejected", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "any" },
      { stageId: "o1-s2", order: 1, status: "rejected", decidedBy: "u2", decidedAt: NOW, parallelMode: "any" },
      { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "any" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s3",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBeNull()
  })

  it("any-mode: approve with later sequential level → chain not done yet", () => {
    const stages: ApprovalStageState[] = [
      ...parallelLevel(1, 2, "any"),
      { stageId: "s2", order: 2, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.nextPendingOrder).toBe(2)
    expect(r.levelComplete).toBe(true)
    // o1-s2 should be skipped (any-mode early-finish)
    expect(r.updates.find((u) => u.stageId === "o1-s2")?.status).toBe("skipped")
  })
})

// ── QUORUM MODE ───────────────────────────────────────────────────────────────

describe("quorum_mode — K-of-N", () => {
  describe("3-of-5 quorum", () => {
    function fresh5(): ApprovalStageState[] {
      return parallelLevel(1, 5, "quorum", 3)
    }

    it("first approve → undecided (2 more needed)", () => {
      const r = routeApproval({
        stages: fresh5(),
        stageId: "o1-s1",
        stageOrder: 1,
        decision: "approve",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.levelComplete).toBe(false)
      expect(r.chainApproved).toBe(false)
      expect(r.nextPendingOrder).toBe(1)
    })

    it("third approve hits quorum → level approved, 2 remaining → skipped", () => {
      const stages: ApprovalStageState[] = [
        { stageId: "o1-s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s2", order: 1, status: "approved", decidedBy: "u2", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s4", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s5", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
      ]
      const r = routeApproval({
        stages,
        stageId: "o1-s3",
        stageOrder: 1,
        decision: "approve",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.chainApproved).toBe(true)
      expect(r.levelComplete).toBe(true)
      expect(r.updates.find((u) => u.stageId === "o1-s3")?.status).toBe("approved")
      expect(r.updates.find((u) => u.stageId === "o1-s4")?.status).toBe("skipped")
      expect(r.updates.find((u) => u.stageId === "o1-s5")?.status).toBe("skipped")
    })

    it("3 rejects makes quorum impossible (3-of-5 = K=3; rejectedCount > 5-3=2 when rejected=3) → chainRejected", () => {
      const stages: ApprovalStageState[] = [
        { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s2", order: 1, status: "rejected", decidedBy: "u2", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s4", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s5", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
      ]
      const r = routeApproval({
        stages,
        stageId: "o1-s3",
        stageOrder: 1,
        decision: "reject",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.chainRejected).toBe(true)
      expect(r.levelComplete).toBe(true)
    })

    it("2 rejects → still possible (rejectedCount=2 <= 5-3=2, undecided)", () => {
      const stages: ApprovalStageState[] = [
        { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s4", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
        { stageId: "o1-s5", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 3 },
      ]
      const r = routeApproval({
        stages,
        stageId: "o1-s2",
        stageOrder: 1,
        decision: "reject",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      // rejectedCount = 2, maxRejections = 5-3 = 2, quorum still possible
      expect(r.levelComplete).toBe(false)
      expect(r.chainRejected).toBe(false)
    })
  })

  describe("2-of-3 quorum", () => {
    it("second approve hits quorum → level approved, 1 remaining skipped", () => {
      const stages: ApprovalStageState[] = [
        { stageId: "o1-s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 2 },
        { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 2 },
        { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 2 },
      ]
      const r = routeApproval({
        stages,
        stageId: "o1-s2",
        stageOrder: 1,
        decision: "approve",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.chainApproved).toBe(true)
      expect(r.levelComplete).toBe(true)
      expect(r.updates.find((u) => u.stageId === "o1-s3")?.status).toBe("skipped")
    })

    it("2 rejects makes quorum impossible (3-2=1 max rejections, rejectedCount=2>1) → rejected", () => {
      const stages: ApprovalStageState[] = [
        { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "quorum", quorumThreshold: 2 },
        { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 2 },
        { stageId: "o1-s3", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 2 },
      ]
      const r = routeApproval({
        stages,
        stageId: "o1-s2",
        stageOrder: 1,
        decision: "reject",
        decidedBy: BY,
        at: NOW,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.chainRejected).toBe(true)
    })
  })
})

// ── MULTI-LEVEL MIXED ─────────────────────────────────────────────────────────

describe("multi_level — mixed level types across a full chain", () => {
  /**
   * Chain design:
   *   Level 1 (order=1): 2 stages, "any" mode — one approve passes
   *   Level 2 (order=2): 1 stage, "all" mode — sequential (like legacy)
   *   Level 3 (order=3): 3 stages, "quorum" K=2 — 2-of-3 required
   */
  function buildMixedChain(
    lvl1Statuses?: ("pending" | "approved" | "rejected" | "skipped")[],
    lvl2Status?: "pending" | "approved",
    lvl3Statuses?: ("pending" | "approved" | "rejected" | "skipped")[]
  ): ApprovalStageState[] {
    return [
      ...parallelLevel(1, 2, "any", undefined, lvl1Statuses),
      { stageId: "s2-1", order: 2, status: lvl2Status ?? "pending", parallelMode: "all" as const },
      ...parallelLevel(3, 3, "quorum", 2, lvl3Statuses),
    ]
  }

  it("level-1 any: first approve skips second, advances to level 2", () => {
    const r = routeApproval({
      stages: buildMixedChain(),
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBe(2)
    expect(r.updates.find((u) => u.stageId === "o1-s2")?.status).toBe("skipped")
    // Level-2 and level-3 untouched
    expect(r.updates.find((u) => u.stageId === "s2-1")).toBeUndefined()
  })

  it("level-2 all: approve the sequential stage, advances to level 3", () => {
    const stages = buildMixedChain(
      ["approved", "skipped"],  // level 1 done
      "pending",                // level 2 current
    )
    const r = routeApproval({
      stages,
      stageId: "s2-1",
      stageOrder: 2,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(false)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBe(3)
  })

  it("level-3 quorum 2-of-3: first approve → undecided", () => {
    const stages = buildMixedChain(
      ["approved", "skipped"],
      "approved",
    )
    const r = routeApproval({
      stages,
      stageId: "o3-s1",
      stageOrder: 3,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.levelComplete).toBe(false)
    expect(r.chainApproved).toBe(false)
    expect(r.nextPendingOrder).toBe(3)
  })

  it("level-3 quorum 2-of-3: second approve hits quorum → chainApproved (last level)", () => {
    const stages = buildMixedChain(
      ["approved", "skipped"],
      "approved",
      ["approved", "pending", "pending"],
    )
    const r = routeApproval({
      stages,
      stageId: "o3-s2",
      stageOrder: 3,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
    expect(r.levelComplete).toBe(true)
    expect(r.nextPendingOrder).toBeNull()
    // o3-s3 should be skipped (quorum reached, remaining pending → skipped)
    expect(r.updates.find((u) => u.stageId === "o3-s3")?.status).toBe("skipped")
  })

  it("level-1 both reject → chainRejected, all levels skipped", () => {
    // Level 1 has one reject already; now second rejects → all reject → level rejected
    const stages = buildMixedChain(
      ["rejected", "pending"],
    )
    const r = routeApproval({
      stages,
      stageId: "o1-s2",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.levelComplete).toBe(true)
    // All later pending stages (level 2 + level 3) → skipped
    const skipped = r.updates.filter((u) => u.status === "skipped")
    const skippedOrders = new Set(skipped.map((u) => u.order))
    expect(skippedOrders.has(2)).toBe(true)
    expect(skippedOrders.has(3)).toBe(true)
  })

  it("level-2 rejection → chainRejected, level-3 all pending → skipped", () => {
    const stages = buildMixedChain(
      ["approved", "skipped"],
      "pending",
    )
    const r = routeApproval({
      stages,
      stageId: "s2-1",
      stageOrder: 2,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainRejected).toBe(true)
    expect(r.updates.find((u) => u.stageId === "s2-1")?.status).toBe("rejected")
    const skipped = r.updates.filter((u) => u.status === "skipped")
    // All 3 level-3 stages skipped
    expect(skipped.filter((u) => u.order === 3)).toHaveLength(3)
  })
})

// ── GUARDS ────────────────────────────────────────────────────────────────────

describe("guards — invalid inputs", () => {
  it("acting on a non-current level (higher order, current is lower) → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "pending", parallelMode: "all" },
      { stageId: "s2", order: 2, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "s2",
      stageOrder: 2,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/not in the current-pending level/)
  })

  it("acting on an already-approved stage → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "s2", order: 2, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/only "pending" stages can be acted on/)
  })

  it("acting on an already-rejected stage → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "any" },
      { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "any" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/only "pending" stages can be acted on/)
  })

  it("acting on a skipped stage → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "skipped", parallelMode: "all" },
      { stageId: "s2", order: 2, status: "pending", parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("stageId not found in chain → error with stageId in message", () => {
    const r = routeApproval({
      stages: seqChain(2),
      stageId: "nonexistent-id",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/nonexistent-id/)
  })

  it("stageOrder not found (no stageId) → error", () => {
    const r = routeApproval({
      stages: seqChain(1),
      stageOrder: 99,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("non-contiguous distinct orders → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "pending", parallelMode: "all" },
      { stageId: "s3", order: 3, status: "pending", parallelMode: "all" }, // order 2 is missing
    ]
    const r = routeApproval({
      stages,
      stageId: "s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/contiguous/)
  })

  it("empty chain → error", () => {
    const r = routeApproval({
      stages: [],
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/at least one stage/)
  })

  it("unknown decision → error", () => {
    const r = routeApproval({
      stages: seqChain(1),
      stageOrder: 1,
      decision: "abstain" as never,
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("empty decidedBy → error", () => {
    const r = routeApproval({
      stages: seqChain(1),
      stageOrder: 1,
      decision: "approve",
      decidedBy: "",
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("invalid Date for at → error", () => {
    const r = routeApproval({
      stages: seqChain(1),
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: new Date(NaN),
    })
    expect(r.ok).toBe(false)
  })

  it("gap-in-advance: terminal level above a pending level → error", () => {
    // Level 1 is terminal, level 2 has a pending stage — invalid
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
      { stageId: "s2-a", order: 2, status: "pending", parallelMode: "all" },
      { stageId: "s3-a", order: 3, status: "approved", decidedBy: "u2", decidedAt: NOW, parallelMode: "all" }, // gap
    ]
    const r = routeApproval({
      stages,
      stageId: "s2-a",
      stageOrder: 2,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/gap in advance/)
  })

  it("chain with no pending stages → error", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "s1", order: 1, status: "approved", decidedBy: "u1", decidedAt: NOW, parallelMode: "all" },
    ]
    const r = routeApproval({
      stages,
      stageId: "s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })
})

// ── EDGE CASES + REGRESSION PINS ─────────────────────────────────────────────

describe("edge_cases", () => {
  it("parallel level followed by another parallel level: second level not started until first complete", () => {
    const stages: ApprovalStageState[] = [
      ...parallelLevel(1, 2, "all"),
      ...parallelLevel(2, 2, "any"),
    ]
    // Level 1 is current; trying to act on level-2 stage should fail.
    const r = routeApproval({
      stages,
      stageId: "o2-s1",
      stageOrder: 2,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/not in the current-pending level/)
  })

  it("any-mode level with a prior reject: approve still passes the level", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "rejected", decidedBy: "u1", decidedAt: NOW, parallelMode: "any" },
      { stageId: "o1-s2", order: 1, status: "pending", parallelMode: "any" },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s2",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true) // only level in chain
    expect(r.levelComplete).toBe(true)
  })

  it("quorum 1-of-1 (min quorum) == approve once → passed", () => {
    const stages: ApprovalStageState[] = [
      { stageId: "o1-s1", order: 1, status: "pending", parallelMode: "quorum", quorumThreshold: 1 },
    ]
    const r = routeApproval({
      stages,
      stageId: "o1-s1",
      stageOrder: 1,
      decision: "approve",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chainApproved).toBe(true)
  })

  it("updates include stageId in all entries when provided", () => {
    const r = routeApproval({
      stages: seqChain(2),
      stageId: "s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const upd of r.updates) {
      expect(upd.stageId).toBeTruthy()
    }
  })

  it("updates for skipped stages have decidedBy and decidedAt set", () => {
    const r = routeApproval({
      stages: seqChain(3),
      stageId: "s1",
      stageOrder: 1,
      decision: "reject",
      decidedBy: BY,
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const skipped = r.updates.filter((u) => u.status === "skipped")
    for (const s of skipped) {
      expect(s.decidedBy).toBe(BY)
      expect(s.decidedAt).toEqual(NOW)
    }
  })
})
