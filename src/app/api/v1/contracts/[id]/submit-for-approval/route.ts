/**
 * Submit-for-approval — CLM slice-2 / slice-3e-2 (parallel levels).
 *
 * POST /api/v1/contracts/:id/submit-for-approval
 *
 * Moves a contract from `draft` → `pending_approval` and creates
 * ContractApprovalStage rows for the given chain.
 *
 * Body (new parallel shape — Slice 3e-2):
 *   {
 *     stages: [
 *       {
 *         label: string,
 *         approvers: [{ assigneeUserId?: string, assigneeRole?: string }],  // min 1
 *         mode?: "all" | "any" | "quorum",  // default "all"
 *         quorum?: number,                  // required when mode="quorum"
 *         slaHours?: number
 *       },
 *       ...  (max 5 levels)
 *     ]
 *   }
 *
 * Backward-compatible body (old flat shape — Slice-2 style):
 *   {
 *     stages: [{ label, assigneeUserId?, assigneeRole?, slaHours? }, ...]
 *   }
 *   Detected by absence of `approvers` field on the first element.
 *   Treated as a level with 1 approver, mode "all".
 *
 * Parallel-level model:
 *   Each item in `stages` is a LEVEL (order = index+1). A level may have
 *   multiple approvers (ContractApprovalStage rows at the same order).
 *   All rows in the same level carry parallelMode + quorumThreshold.
 *
 *   mode "all"    — all approvers must approve (default, backward-compat)
 *   mode "any"    — first approval advances the level
 *   mode "quorum" — approvedCount >= quorum advances the level
 *
 *   Total stage rows across all levels ≤ 25 (hard cap).
 *   Max 5 levels; max 8 approvers per level.
 *
 * Idempotency guard: if pending stages already exist for the contract
 * (a previous submit-for-approval was called), the request is rejected
 * with 409. Caller must cancel the existing chain first.
 *
 * State machine: only `draft → pending_approval` is accepted. Other
 * starting statuses are rejected with 409 + a human-readable message.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { findResidualVars } from "@/lib/clm/residual-vars"
import { canTransition, isContractStatus } from "@/lib/contract-lifecycle/state-machine"
import { createNotification } from "@/lib/notifications"
import { sendContractAlert } from "@/lib/integrations/contract-alerts"
import { resolveApprovalAssignee } from "@/lib/contract-lifecycle/delegation"
import {
  applyApprovalRules,
  ApprovalRulesCapError,
  type StageSpec,
} from "@/lib/contract-lifecycle/approval-rules"

/** Thrown inside the $transaction when a contract-state conflict is detected.
 *  Throwing (not returning) ensures the ENTIRE transaction rolls back — including
 *  any createMany + superseded updateMany writes that preceded the conflict check.
 *  Caught outside the tx and mapped to a 409 response.
 *  Mirrors ContractPointerMissError in the approve route. */
class SubmitConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubmitConflictError"
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_LEVELS = 5
/**
 * Hard cap on final levels AFTER rule expansion. Rules can grow the list beyond
 * MAX_LEVELS (the submit schema caps the *submitted* levels, not the post-rules
 * count). We allow slightly more room here (8) before rejecting. FIX 5.
 */
const MAX_LEVELS_AFTER_RULES = 8
const MAX_APPROVERS_PER_LEVEL = 8
const MAX_TOTAL_STAGES = 25

// ─── Schema — parallel (new) shape ────────────────────────────────────────────

/** A single approver within a level. */
const approverSchema = z.object({
  assigneeUserId: z.string().optional(),
  assigneeRole: z.string().optional(),
}).strict()

/** A level in the parallel schema (has `approvers` array). */
const parallelLevelSchema = z.object({
  label: z.string().min(1, "Stage label is required").max(100),
  approvers: z
    .array(approverSchema)
    .min(1, "Each level must have at least one approver")
    .max(MAX_APPROVERS_PER_LEVEL, `Max ${MAX_APPROVERS_PER_LEVEL} approvers per level`),
  mode: z.enum(["all", "any", "quorum"]).default("all"),
  quorum: z.number().int().positive().optional(),
  slaHours: z.number().int().positive().optional(),
}).strict()

/** Parallel submit schema. */
const parallelSubmitSchema = z.object({
  stages: z
    .array(parallelLevelSchema)
    .min(1, "At least one approval stage is required")
    .max(MAX_LEVELS, `Max ${MAX_LEVELS} levels allowed`),
})

// ─── Schema — legacy (old) flat shape ─────────────────────────────────────────

/** Old single-approver shape from slice-2. */
const flatStageSchema = z.object({
  label: z.string().min(1, "Stage label is required").max(100),
  assigneeUserId: z.string().optional(),
  assigneeRole: z.string().optional(),
  /** SLA for this stage in hours (positive integer, optional). */
  slaHours: z.number().int().positive().optional(),
}).strict()

/** Legacy flat submit schema (backward-compat). */
const flatSubmitSchema = z.object({
  stages: z
    .array(flatStageSchema)
    .min(1, "At least one approval stage is required")
    .max(MAX_LEVELS, `Max ${MAX_LEVELS} stages allowed`),
})

// ─── Internal types ────────────────────────────────────────────────────────────

/**
 * Normalized level representation shared by both parse paths.
 * After parsing, all logic works on LevelSpec[].
 */
interface ApproverSpec {
  assigneeUserId?: string | null
  assigneeRole?: string | null
}

interface LevelSpec {
  label: string
  approvers: ApproverSpec[]
  /** parallelMode for the level's DB rows. */
  mode: "all" | "any" | "quorum"
  /** Required when mode=quorum; 1 <= quorum <= approvers.length. */
  quorum?: number | null
  slaHours?: number | null
}

/** Resolved stage row ready for createMany. */
interface ResolvedStageRow {
  organizationId: string
  contractId: string
  order: number
  label: string
  assigneeUserId: string | null
  originalAssigneeUserId: string | null
  assigneeRole: string | null
  slaHours: number | null
  dueAt: Date | null
  status: "pending"
  parallelMode: string
  quorumThreshold: number | null
}

export const POST = withRlsAuth(undefined, undefined, async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = session
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // ── Detect and parse the shape ─────────────────────────────────────────────
  // New shape: stages[0] has `approvers`.
  // Old shape: stages[0] has assigneeUserId/assigneeRole (no `approvers`).
  let levels: LevelSpec[]

  const rawStages = (body as { stages?: unknown[] })?.stages

  // FIX 4: Reject mixed shape — every element must have `approvers` or none may.
  // A mixed [flatStage, parallelLevel] would be silently parsed as flat, stripping
  // approvers/mode/quorum from parallel levels. Detect and reject before parsing.
  if (Array.isArray(rawStages) && rawStages.length > 0) {
    const hasApproversFlags = rawStages.map(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        "approvers" in (s as object),
    )
    const someHave = hasApproversFlags.some(Boolean)
    const allHave = hasApproversFlags.every(Boolean)
    if (someHave && !allHave) {
      return NextResponse.json(
        { error: "Mixed approval shape: every stage must have `approvers` (parallel) or none may (flat). Cannot mix flat and parallel stages." },
        { status: 400 },
      )
    }
  }

  const isParallelShape =
    Array.isArray(rawStages) &&
    rawStages.length > 0 &&
    typeof rawStages[0] === "object" &&
    rawStages[0] !== null &&
    "approvers" in (rawStages[0] as object)

  if (isParallelShape) {
    const parsed = parallelSubmitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // Validate quorum constraints for each level
    for (let i = 0; i < parsed.data.stages.length; i++) {
      const lvl = parsed.data.stages[i]
      if (lvl.mode === "quorum") {
        if (lvl.quorum == null) {
          return NextResponse.json(
            { error: `Level ${i + 1}: quorum is required when mode is "quorum"` },
            { status: 400 },
          )
        }
        if (lvl.quorum < 1 || lvl.quorum > lvl.approvers.length) {
          return NextResponse.json(
            {
              error: `Level ${i + 1}: quorum must be between 1 and the number of approvers (${lvl.approvers.length})`,
            },
            { status: 400 },
          )
        }
      }
    }

    levels = parsed.data.stages.map((lvl) => ({
      label: lvl.label,
      approvers: lvl.approvers,
      mode: lvl.mode,
      quorum: lvl.mode === "quorum" ? lvl.quorum : null,
      slaHours: lvl.slaHours ?? null,
    }))
  } else {
    // Legacy flat shape — each flat stage becomes a level with 1 approver, mode "all"
    const parsed = flatSubmitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    levels = parsed.data.stages.map((s) => ({
      label: s.label,
      approvers: [{ assigneeUserId: s.assigneeUserId, assigneeRole: s.assigneeRole }],
      mode: "all" as const,
      quorum: null,
      slaHours: s.slaHours ?? null,
    }))
  }

  try {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        title: true,
        contractNumber: true,
        status: true,
        valueAmount: true,
        type: true,
        currency: true,
        templateId: true,
        renderedBody: true,
      },
    })
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // Step 5: server-side gate — a body with unresolved {{var}} tokens must not
    // enter the approval/e-sign flow (the editor CTA blocks too, but a direct
    // POST bypasses the client gate; the server is the real boundary).
    const unresolvedVars = findResidualVars(contract.renderedBody)
    if (unresolvedVars.length > 0) {
      return NextResponse.json(
        {
          error: `Contract body has unresolved variables: ${unresolvedVars.slice(0, 10).join(", ")}`,
          code: "UNRESOLVED_VARIABLES",
          variables: unresolvedVars,
        },
        { status: 400 },
      )
    }

    // State-machine guard (pre-flight — fast-fail on obviously wrong status before
    // doing any expensive work; the authoritative check is repeated inside the tx).
    const fromStatus = isContractStatus(contract.status) ? contract.status : null
    if (!fromStatus) {
      return NextResponse.json(
        { error: `Contract has unrecognised status: "${contract.status}"` },
        { status: 409 },
      )
    }
    const transition = canTransition({ from: fromStatus, to: "pending_approval" })
    if (!transition.ok) {
      return NextResponse.json({ error: transition.error }, { status: 409 })
    }

    // NOTE: The idempotency guard (pending stages count) is intentionally moved
    // INSIDE the transaction below (FIX 2). Pre-flight check removed — a race
    // between two concurrent submits that both pass here could create two chains
    // after the @@unique([contractId,order]) was dropped in Slice 3e-1.

    // ─── Conditional approval routing (Slice 3b) ────────────────────────────
    // Rules add/skip whole levels by label. For parallel levels, we pass each
    // level as a StageSpec (with single-assignee shape — rules don't reach
    // into per-approver rows). The rules operate on the level label, which is
    // the canonical unit. The per-level approver list is carried through unchanged.
    const activeRules = await prisma.contractApprovalRule.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        OR: [
          { templateId: null },
          ...(contract.templateId ? [{ templateId: contract.templateId }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
      include: {
        actions: {
          orderBy: { sortOrder: "asc" },
        },
      },
    })

    // Convert levels → StageSpec[] for rule evaluation (rules see label + one approver).
    // After rule application, rebuild levels (rule-added levels are single-approver, mode all).
    let baseStagesForRules: StageSpec[] = levels.map((l) => ({
      label: l.label,
      // For the rule engine, pass the first approver as the stage assignee.
      // Rules only use label for add/skip actions; assignee resolution is post-rules.
      assigneeUserId: l.approvers[0]?.assigneeUserId ?? undefined,
      assigneeRole: l.approvers[0]?.assigneeRole ?? undefined,
      slaHours: l.slaHours ?? undefined,
    }))

    // Also need to carry the full level state for reconstruction after rule application.
    // We index by label (note: if two levels share the same label, rules treat them identically —
    // skip_stage removes ALL matching labels, consistent with existing behavior).
    const levelsByLabel = new Map<string, LevelSpec>()
    for (const l of levels) {
      // Last-wins for duplicate labels (matches skip_stage semantics)
      levelsByLabel.set(l.label, l)
    }

    let finalStageSpecs: StageSpec[]
    try {
      finalStageSpecs = applyApprovalRules(baseStagesForRules, activeRules, contract)
    } catch (err) {
      if (err instanceof ApprovalRulesCapError) {
        return NextResponse.json({ error: err.message }, { status: 422 })
      }
      throw err
    }

    if (finalStageSpecs.length === 0) {
      return NextResponse.json(
        { error: "No approval stages remain after rule evaluation." },
        { status: 422 },
      )
    }

    // Reconstruct finalLevels from finalStageSpecs:
    // - If the label existed in the original levels map → use the original level's approvers/mode/quorum
    // - If the label is new (rule-added) → single-approver level with mode "all"
    const finalLevels: LevelSpec[] = finalStageSpecs.map((spec) => {
      const original = levelsByLabel.get(spec.label)
      if (original) {
        return { ...original, slaHours: spec.slaHours ?? original.slaHours ?? null }
      }
      // Rule-added stage: single approver, mode all
      return {
        label: spec.label,
        approvers: [{
          assigneeUserId: spec.assigneeUserId ?? null,
          assigneeRole: spec.assigneeRole ?? null,
        }],
        mode: "all" as const,
        quorum: null,
        slaHours: spec.slaHours ?? null,
      }
    })

    // FIX 5: Re-check max levels AFTER rule expansion.
    // applyApprovalRules can grow the level count beyond MAX_LEVELS (it has its own
    // internal cap MAX_STAGES=10, but we enforce a tighter per-submit limit here).
    if (finalLevels.length > MAX_LEVELS_AFTER_RULES) {
      return NextResponse.json(
        {
          error: `Approval chain exceeds the maximum of ${MAX_LEVELS_AFTER_RULES} levels after rule expansion (got ${finalLevels.length}).`,
        },
        { status: 422 },
      )
    }

    // ─── Total stage row count check ───────────────────────────────────────
    const totalRows = finalLevels.reduce((sum, l) => sum + l.approvers.length, 0)
    if (totalRows > MAX_TOTAL_STAGES) {
      return NextResponse.json(
        { error: `Total approval stage rows would exceed ${MAX_TOTAL_STAGES} (got ${totalRows}).` },
        { status: 422 },
      )
    }

    // ─── Resolve delegation for each approver ─────────────────────────────
    const submittedAt = new Date()

    /**
     * For each level, resolve delegation for each approver that has a specific userId.
     * Returns the level with resolved approver rows.
     */
    interface ResolvedApprover {
      resolvedAssigneeUserId: string | null
      originalAssigneeUserId: string | null
      assigneeRole: string | null
    }

    const resolvedLevels: Array<{
      level: LevelSpec
      approvers: ResolvedApprover[]
    }> = await Promise.all(
      finalLevels.map(async (level) => {
        const resolvedApprovers: ResolvedApprover[] = await Promise.all(
          level.approvers.map(async (approver) => {
            if (!approver.assigneeUserId) {
              return {
                resolvedAssigneeUserId: null,
                originalAssigneeUserId: null,
                assigneeRole: approver.assigneeRole ?? null,
              }
            }
            const resolved = await resolveApprovalAssignee(
              prisma,
              orgId,
              approver.assigneeUserId,
              submittedAt,
            )
            return {
              resolvedAssigneeUserId: resolved.resolvedUserId,
              originalAssigneeUserId: resolved.delegated ? resolved.originalUserId : approver.assigneeUserId,
              assigneeRole: approver.assigneeRole ?? null,
            }
          }),
        )
        return { level, approvers: resolvedApprovers }
      }),
    )

    // FIX 3: Validate all explicit assigneeUserIds belong to this org and are active.
    // Collect the distinct set of resolved user IDs that were supplied as explicit
    // userId assignments (not role-only approvers). The resolved delegate ID is also
    // checked because a delegate from another org could slip through otherwise.
    const explicitUserIds = new Set<string>()
    for (const { approvers: resolvedApprovers } of resolvedLevels) {
      for (const a of resolvedApprovers) {
        if (a.resolvedAssigneeUserId) explicitUserIds.add(a.resolvedAssigneeUserId)
        if (a.originalAssigneeUserId) explicitUserIds.add(a.originalAssigneeUserId)
      }
    }
    if (explicitUserIds.size > 0) {
      const validUsers = await prisma.user.findMany({
        where: {
          id: { in: Array.from(explicitUserIds) },
          organizationId: orgId,
          isActive: true,
        },
        select: { id: true },
      })
      const validUserIdSet = new Set(validUsers.map((u: { id: string }) => u.id))
      const invalidIds = Array.from(explicitUserIds).filter((uid) => !validUserIdSet.has(uid))
      if (invalidIds.length > 0) {
        return NextResponse.json(
          {
            error: `Assignee user(s) not found in this organization or inactive: ${invalidIds.join(", ")}`,
          },
          { status: 400 },
        )
      }
    }

    // ─── Build flattened stage rows ────────────────────────────────────────
    // Order 1..N where N = levels.length.
    // Each level may emit 1..8 rows at the same order value.
    // Stage 1 rows (order===1) get dueAt if their level has slaHours.

    const allRows: ResolvedStageRow[] = []

    for (let lvlIdx = 0; lvlIdx < resolvedLevels.length; lvlIdx++) {
      const { level, approvers } = resolvedLevels[lvlIdx]
      const order = lvlIdx + 1
      const isFirstLevel = order === 1

      // dueAt: only for first level (it becomes active immediately at submit time).
      // Subsequent levels get dueAt set when they advance to active in the approve tx.
      const dueAt =
        isFirstLevel && level.slaHours
          ? new Date(submittedAt.getTime() + level.slaHours * 3600 * 1000)
          : null

      for (const approver of approvers) {
        allRows.push({
          organizationId: orgId,
          contractId: id,
          order,
          label: level.label,
          assigneeUserId: approver.resolvedAssigneeUserId ?? null,
          originalAssigneeUserId: approver.originalAssigneeUserId ?? null,
          assigneeRole: approver.assigneeRole ?? null,
          slaHours: level.slaHours ?? null,
          dueAt,
          status: "pending",
          parallelMode: level.mode,
          quorumThreshold: level.mode === "quorum" ? (level.quorum ?? null) : null,
        })
      }
    }

    // Transaction: row lock → idempotency guard → supersede stale → create chain → status CAS
    //
    // FIX 2: The guards (status allows submit + no pending stages) are INSIDE the
    // transaction and run AFTER a FOR UPDATE lock on the contract row. This prevents
    // two concurrent submits from both passing a pre-flight count check and then both
    // calling createMany — which, after @@unique([contractId,order]) was dropped in
    // Slice 3e-1, would create two active chains.
    //
    // The contract status is advanced with updateMany guarded on the expected pre-state
    // (`status: contract.status`) — a CAS so that only one concurrent submit can win.
    const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ── Row lock: serialize concurrent submits on this contract ──────────────
      // Table name: "contracts" (@@map); column: "organizationId".
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

      // ── In-tx residual-variable re-check (Codex MED) ──────────────────────────
      // The pre-flight gate above can race a concurrent /body or /amend edit. Now
      // that the row is locked, re-read renderedBody and re-scan: a {{var}} that
      // slipped in after pre-flight is caught here and rolls the submit back.
      const locked = await tx.contract.findUnique({
        where: { id },
        select: { renderedBody: true },
      })
      if (findResidualVars(locked?.renderedBody).length > 0) {
        throw new SubmitConflictError(
          "Contract body changed to include unresolved variables during submit — reload and retry.",
        )
      }

      // ── In-tx idempotency guard ───────────────────────────────────────────────
      // Re-check pending stages count INSIDE the tx (tx-local, consistent read
      // under the lock). A concurrent submit that already created stages will be
      // visible here even if it committed between our pre-flight and this point.
      const existingPending = await tx.contractApprovalStage.count({
        where: { contractId: id, organizationId: orgId, status: "pending" },
      })
      if (existingPending > 0) {
        // THROW so the tx rolls back any writes that precede this check.
        // A normal return would COMMIT preceding writes (superseded updateMany, etc.) despite the 409.
        throw new SubmitConflictError("Contract already has pending approval stages. Cancel the existing chain first.")
      }

      // ── Mark stale stages from a prior round as superseded ───────────────────
      await tx.contractApprovalStage.updateMany({
        where: {
          contractId: id,
          organizationId: orgId,
          status: { in: ["rejected", "skipped"] },
        },
        data: { status: "superseded" },
      })

      // ── Create all rows in a single round-trip ────────────────────────────────
      await tx.contractApprovalStage.createMany({
        data: allRows,
      })

      // ── Contract status CAS: advance status guarded on expected pre-state ─────
      // Only one concurrent submit can win this CAS. The second will see count===0
      // (contract is already pending_approval after the first commit) and return 409.
      const contractCas = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: contract.status },
        data: {
          status: "pending_approval",
          currentApprovalStage: 1,
        },
      })
      if (contractCas.count !== 1) {
        // THROW so the tx rolls back the createMany + superseded updateMany + the CAS miss.
        // A normal return would COMMIT those preceding writes despite the 409.
        throw new SubmitConflictError("Contract state changed concurrently, retry")
      }
    })

    // Audit log — non-critical
    await prisma.auditLog
      .create({
        data: {
          organizationId: orgId,
          userId,
          action: "update",
          entityType: "contract",
          entityId: id,
          entityName: contract.title,
          oldValue: { status: contract.status },
          newValue: {
            status: "pending_approval",
            levels: finalLevels.map((l, i) => ({
              order: i + 1,
              label: l.label,
              mode: l.mode,
              quorum: l.quorum ?? null,
              approverCount: l.approvers.length,
            })),
            totalStageRows: allRows.length,
            rulesApplied: activeRules.length,
          },
        },
      })
      .catch(() => {})

    // Notify first-level assignees — best-effort, never fails the submit.
    try {
      const firstLevelRows = allRows.filter((r) => r.order === 1)
      const recipientIds: string[] = []

      const specificAssignees = firstLevelRows
        .map((r) => r.assigneeUserId)
        .filter((uid): uid is string => uid != null)

      if (specificAssignees.length > 0) {
        specificAssignees.forEach((uid) => recipientIds.push(uid))
      } else {
        // No specific assignees — notify all admins + managers who can approve
        const fallbackRecipients = await prisma.user.findMany({
          where: {
            organizationId: orgId,
            role: { in: ["admin", "manager"] },
            isActive: true,
          },
          select: { id: true },
        })
        fallbackRecipients.forEach((r: { id: string }) => recipientIds.push(r.id))
      }

      await Promise.allSettled(
        recipientIds.map((rid) =>
          createNotification({
            organizationId: orgId,
            userId: rid,
            type: "info",
            title: `Approval requested: ${contract.title}`,
            message: `Contract "${contract.title}" has been submitted for approval and requires your review.`,
            entityType: "contract",
            entityId: id,
            kind: "contract.approval_requested",
          }),
        ),
      )
    } catch {
      // Best-effort: never fail the submit on notification error
    }

    // Slack/Teams alert — fire-and-forget (FIX 3): never await the webhook,
    // so a slow/failing webhook does not add latency to the user-visible route.
    void sendContractAlert(orgId, "contract.approval_requested", {
      contractNumber: contract.contractNumber ?? id,
      title: contract.title,
      valueAmount: contract.valueAmount,
      currency: contract.currency,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      data: { contractId: id, stages: allRows.length },
    })
  } catch (e) {
    if (e instanceof SubmitConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    console.error("[submit-for-approval]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
