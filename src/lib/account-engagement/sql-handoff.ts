/**
 * C5 Account Engagement — Sales-Marketing handoff helper.
 *
 * Called when a MarketingAccount transitions to the `sql` lifecycle stage.
 * Creates a CRM Deal in the org's default pipeline, assigned to the account
 * owner, and linked to the associated Company (if any).
 *
 * The Deal creation is best-effort: a failure (e.g. no default pipeline,
 * Prisma error) does NOT roll back the lifecycle transition. The account
 * moves to `sql` regardless; an ops user can create the deal manually.
 *
 * Injectable Prisma client enables unit testing without a real database.
 */

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface SqlHandoffInput {
  /** ID of the MarketingAccount being handed off (stored in deal.tags). */
  accountId: string
  /** Display name used as the base for the deal title. */
  accountName: string
  /** Linked CRM Company — passed as deal.companyId if present. */
  companyId: string | null
  /** Account owner — passed as deal.assignedTo if present. */
  ownerUserId: string | null
  /** Tenant scoping for pipeline + deal queries. */
  organizationId: string
}

export interface SqlHandoffResult {
  /** Created deal, or null when skipped / errored. */
  deal: { id: string; name: string; stage: string } | null
  /** True when deal creation was intentionally skipped (no pipeline) or
   *  failed silently (best-effort — never throws). */
  skipped: boolean
  /** Machine-readable reason for skip / failure. */
  reason?: "no_default_pipeline" | "deal_create_failed"
}

/** Minimal Prisma-client surface needed — typed for testability. */
export interface HandoffDb {
  pipeline: {
    findFirst: (args: {
      where: { organizationId: string; isDefault: boolean }
      select: { id: true }
    }) => Promise<{ id: string } | null>
  }
  pipelineStage: {
    findFirst: (args: {
      where: { pipelineId: string; isActive: boolean; isWon: boolean; isLost: boolean }
      orderBy: { sortOrder: "asc" }
      select: { name: true; probability: true }
    }) => Promise<{ name: string; probability: number } | null>
  }
  deal: {
    create: (args: {
      data: {
        organizationId: string
        name: string
        companyId?: string
        assignedTo?: string
        pipelineId: string
        stage: string
        probability: number
        tags: string[]
      }
      select: { id: true; name: true; stage: true }
    }) => Promise<{ id: string; name: string; stage: string }>
  }
}

/* ── Implementation ─────────────────────────────────────────────────────── */

/**
 * performSqlHandoff — create a CRM Deal when a MarketingAccount reaches `sql`.
 *
 * @param input  - MarketingAccount fields needed for deal creation
 * @param db     - Injectable Prisma-compatible client
 */
export async function performSqlHandoff(
  input: SqlHandoffInput,
  db: HandoffDb,
): Promise<SqlHandoffResult> {
  const { accountId, accountName, companyId, ownerUserId, organizationId } = input

  // 1. Find the org's default pipeline — required to create the deal.
  const defaultPipeline = await db.pipeline.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  })
  if (!defaultPipeline) {
    return { deal: null, skipped: true, reason: "no_default_pipeline" }
  }

  // 2. Find the first active, non-terminal stage (sortOrder ASC).
  //    Falls back to "LEAD" / 10% if the pipeline has no active stages.
  const firstActiveStage = await db.pipelineStage.findFirst({
    where: {
      pipelineId: defaultPipeline.id,
      isActive: true,
      isWon: false,
      isLost: false,
    },
    orderBy: { sortOrder: "asc" },
    select: { name: true, probability: true },
  })
  const stageName = firstActiveStage?.name ?? "LEAD"
  const probability = firstActiveStage?.probability ?? 10

  // 3. Create the deal (best-effort — failure is logged, not re-thrown).
  try {
    const deal = await db.deal.create({
      data: {
        organizationId,
        name: `${accountName} — SQL Handoff`,
        ...(companyId ? { companyId } : {}),
        ...(ownerUserId ? { assignedTo: ownerUserId } : {}),
        pipelineId: defaultPipeline.id,
        stage: stageName,
        probability,
        // Tags: identify origin so sales reps can filter sql-handoff deals.
        tags: ["sql-handoff", accountId],
      },
      select: { id: true, name: true, stage: true },
    })
    return { deal, skipped: false }
  } catch (err) {
    console.error("[sql-handoff] deal creation failed:", err)
    return { deal: null, skipped: true, reason: "deal_create_failed" }
  }
}
