import { describe, expect, it, vi } from "vitest"
import {
  ProjectionControlConflictError,
  createProjectionBuild,
  promoteProjectionBuild,
  recordProjectionCheckpoint,
  transitionProjectionBuild,
} from "@/lib/event-platform"

function controlTx(overrides: Record<string, unknown> = {}) {
  return {
    projectionBuild: {
      findUnique: vi.fn().mockResolvedValue({
        id: "build-new",
        projectionName: "finance.fund-balance",
        status: "ready",
        effectsFenced: true,
      }),
      create: vi.fn(async ({ data }) => data),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    projectionActivation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => data),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    projectionPromotionEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => data),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
}

describe("projection replay control plane", () => {
  it("creates replay builds pending with the effect fence forced on", async () => {
    const tx = controlTx()
    const row = await createProjectionBuild(tx, {
      organizationId: "org-1",
      projectionName: "finance.fund-balance",
      projectionVersion: 2,
      buildKey: "incident-42-v2",
      codeSha: "a".repeat(40),
      mode: "replay",
      replayFrom: new Date("2026-09-01T00:00:00Z"),
    })

    expect(row).toMatchObject({ status: "pending", effectsFenced: true, mode: "replay" })
    expect(tx.projectionBuild.create).toHaveBeenCalledOnce()
  })

  it("rejects invalid lifecycle transitions and stale compare-and-swap updates", async () => {
    const tx = controlTx()
    await expect(transitionProjectionBuild(tx, {
      organizationId: "org-1",
      buildId: "build-new",
      from: "pending",
      to: "ready",
    })).rejects.toBeInstanceOf(ProjectionControlConflictError)

    tx.projectionBuild.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(transitionProjectionBuild(tx, {
      organizationId: "org-1",
      buildId: "build-new",
      from: "pending",
      to: "running",
    })).rejects.toBeInstanceOf(ProjectionControlConflictError)
  })

  it("writes monotonic partition checkpoints with one atomic upsert", async () => {
    const tx = controlTx()
    await recordProjectionCheckpoint(tx, {
      organizationId: "org-1",
      buildId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      sourceTopic: "ld.drill.finance.events.v1",
      sourcePartition: 3,
      sourceOffset: 42n,
      lastEventId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb332",
    })
    expect(tx.$executeRawUnsafe).toHaveBeenCalledOnce()

    tx.$executeRawUnsafe.mockResolvedValueOnce(0)
    await expect(recordProjectionCheckpoint(tx, {
      organizationId: "org-1",
      buildId: "018f7b34-9bb9-7b32-8de8-1fbb4feeb331",
      sourceTopic: "ld.drill.finance.events.v1",
      sourcePartition: 3,
      sourceOffset: 41n,
    })).rejects.toThrow("cannot move backward")
  })

  it("atomically appends two-person evidence before creating the first pointer", async () => {
    const tx = controlTx()
    const result = await promoteProjectionBuild(tx, {
      organizationId: "org-1",
      projectionName: "finance.fund-balance",
      targetBuildId: "build-new",
      requestKey: "change-42-approval-1",
      requestedBy: "operator-a",
      approvedBy: "operator-b",
      evidence: { invariantReportSha256: "b".repeat(64), effectsCreated: 0 },
      now: new Date("2026-09-06T10:00:00Z"),
    })

    expect(result).toEqual({ duplicate: false, pointerVersion: 1n })
    expect(tx.projectionBuild.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ready", effectsFenced: true }),
    }))
    expect(tx.projectionPromotionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "promote",
        requestedBy: "operator-a",
        approvedBy: "operator-b",
        resultingPointerVersion: 1n,
      }),
    }))
    expect(tx.projectionActivation.create).toHaveBeenCalledOnce()
  })

  it("rejects self-approval and changed evidence under a reused request key", async () => {
    const tx = controlTx()
    const base = {
      organizationId: "org-1",
      projectionName: "finance.fund-balance",
      targetBuildId: "build-new",
      requestKey: "change-42-approval-1",
      requestedBy: "operator-a",
      approvedBy: "operator-a",
      evidence: { effectsCreated: 0 },
    }
    await expect(promoteProjectionBuild(tx, base)).rejects.toThrow("different approver")

    tx.projectionPromotionEvent.findUnique.mockResolvedValueOnce({
      targetBuildId: "build-old",
      evidenceHash: "c".repeat(64),
      resultingPointerVersion: 2n,
    })
    await expect(promoteProjectionBuild(tx, {
      ...base,
      approvedBy: "operator-b",
    })).rejects.toThrow("reused with different evidence")
  })
})
