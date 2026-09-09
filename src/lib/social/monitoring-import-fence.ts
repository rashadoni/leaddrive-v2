import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import type { Prisma } from "@prisma/client"
import { AsyncLocalStorage } from "node:async_hooks"

const CLEAN_SLATE_LOCK_PREFIX = "social-monitoring-clean-slate:"
const IMPORT_FENCE_TRANSACTION_TIMEOUT_MS = 30 * 60_000

type ImportFenceRow = {
  settings: unknown
  status: string
  purgedAt: Date | null
}

type SocialMonitoringImportFenceInput = {
  organizationId: string
  providerRunId: string
  providerKey: string
  expectedStatuses: readonly string[]
  blockOnEmergencyStop?: boolean
}

type SocialMonitoringImportFenceQueryClient = Pick<
  Prisma.TransactionClient,
  "$queryRawUnsafe"
>

type SocialMonitoringImportFenceGate =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | "social_monitoring_collection_blocked"
        | "social_monitoring_import_run_inactive"
    }

export type SocialMonitoringImportFenceResult<T> =
  | { allowed: true; value: T }
  | {
      allowed: false
      reason:
        | "social_monitoring_collection_blocked"
        | "social_monitoring_import_run_inactive"
    }

export type SocialMonitoringTenantFenceResult<T> =
  | { allowed: true; value: T }
  | { allowed: false; reason: "social_monitoring_collection_blocked" }

type SocialMonitoringCollectionFenceTransaction = Pick<
  Prisma.TransactionClient,
  "$executeRawUnsafe" | "organization"
>

type SocialMonitoringCollectionFenceContext = {
  organizationId: string
  active: boolean
}

const globalForSocialMonitoringFence = globalThis as unknown as {
  __socialMonitoringCollectionFenceStorage?: AsyncLocalStorage<SocialMonitoringCollectionFenceContext>
}
const socialMonitoringCollectionFenceStorage =
  globalForSocialMonitoringFence.__socialMonitoringCollectionFenceStorage
  ?? (
    globalForSocialMonitoringFence.__socialMonitoringCollectionFenceStorage =
      new AsyncLocalStorage<SocialMonitoringCollectionFenceContext>()
  )

function runWithSocialMonitoringCollectionFenceContext<T>(
  organizationId: string,
  callback: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const context: SocialMonitoringCollectionFenceContext = {
    organizationId,
    active: true,
  }
  return socialMonitoringCollectionFenceStorage.run(
    context,
    async () => {
      try {
        return await callback()
      } finally {
        // Async resources spawned without being awaited retain ALS context.
        // Invalidate the shared object when the lock-owning callback ends so
        // leaked background work cannot later pretend the fence is still held.
        context.active = false
      }
    },
  )
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function socialMonitoringCleanSlateBlocked(settings: unknown): boolean {
  const root = record(settings)
  const cleanSlate = record(root.socialMonitoringCleanSlate)
  return cleanSlate.collectionBlocked === true
}

export function socialMonitoringPaidEmergencyStopped(settings: unknown): boolean {
  const root = record(settings)
  const paidRuns = record(root.socialMonitoringPaidRuns)
  // Missing/invalid paid-run policy remains fail-closed, matching
  // parseTenantPaidRunPolicy.
  return paidRuns.emergencyStopped !== false
}

async function checkSocialMonitoringImportFence(
  db: SocialMonitoringImportFenceQueryClient,
  input: SocialMonitoringImportFenceInput,
): Promise<SocialMonitoringImportFenceGate> {
  const rows = await db.$queryRawUnsafe<ImportFenceRow[]>(`
    SELECT
      organization.settings,
      run.status,
      run."purgedAt" AS "purgedAt"
    FROM organizations AS organization
    JOIN social_provider_runs AS run
      ON run."organizationId" = organization.id
    WHERE organization.id = $1
      AND run.id = $2
      AND run."providerKey" = $3
    LIMIT 1
  `, input.organizationId, input.providerRunId, input.providerKey)
  const row = rows[0]
  if (!row || row.purgedAt || !input.expectedStatuses.includes(row.status)) {
    return {
      allowed: false,
      reason: "social_monitoring_import_run_inactive",
    }
  }
  if (
    socialMonitoringCleanSlateBlocked(row.settings)
    || (
      input.blockOnEmergencyStop === true
      && socialMonitoringPaidEmergencyStopped(row.settings)
    )
  ) {
    return {
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    }
  }
  return { allowed: true }
}

export async function checkSocialMonitoringTenantCollectionFence(
  tx: SocialMonitoringCollectionFenceTransaction,
  organizationId: string,
): Promise<SocialMonitoringTenantFenceResult<true>> {
  const heldFence = socialMonitoringCollectionFenceStorage.getStore()
  if (heldFence?.active) {
    if (heldFence.organizationId === organizationId) {
      return { allowed: true, value: true }
    }
    return {
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    }
  }
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    `${CLEAN_SLATE_LOCK_PREFIX}${organizationId}`,
  )
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  if (!organization || socialMonitoringCleanSlateBlocked(organization.settings)) {
    return {
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    }
  }
  return { allowed: true, value: true }
}

/**
 * Serializes provider-result persistence with the clean-slate reset.
 *
 * The reset takes the same transaction-scoped advisory lock before changing
 * the tenant fence and before deleting findings. The importer holds it for the
 * complete persistence callback. Therefore a pre-fence importer either:
 *  - finishes first, after which the reset deletes its writes; or
 *  - waits for the reset and observes the closed fence / PURGED run.
 *
 * The callback deliberately uses the normal Prisma client. The transaction is
 * the lock owner only; it must not row-lock the provider run because callback
 * writes can use another pooled connection. runWithTenant also clears the
 * outer interactive transaction's ALS `inTx` marker, ensuring those global
 * Prisma writes establish RLS on their own pooled connection.
 */
export async function withSocialMonitoringImportFence<T>(
  input: SocialMonitoringImportFenceInput,
  persist: () => Promise<T>,
): Promise<SocialMonitoringImportFenceResult<T>> {
  // A manual collection route already holds this tenant's clean-slate lock for
  // the complete request. Reacquiring it from a new interactive transaction
  // would self-deadlock before provider dispatch. Reuse the held lock, but
  // still re-read the provider row and tenant switches immediately before the
  // side effect so the nested path remains fail-closed.
  const heldFence = socialMonitoringCollectionFenceStorage.getStore()
  if (heldFence?.active && heldFence.organizationId !== input.organizationId) {
    // Never acquire a second tenant lock from inside an active tenant fence.
    // Besides creating cross-tenant lock-order deadlocks, the nested
    // transaction would inherit the outer tenant's RLS context and could not
    // authoritatively validate this provider run.
    return {
      allowed: false,
      reason: "social_monitoring_import_run_inactive",
    }
  }
  if (heldFence?.active) {
    return runWithTenant(input.organizationId, async () => {
      const gate = await checkSocialMonitoringImportFence(prisma, input)
      if (!gate.allowed) return gate
      return {
        allowed: true as const,
        value: await persist(),
      }
    })
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      `${CLEAN_SLATE_LOCK_PREFIX}${input.organizationId}`,
    )
    const gate = await checkSocialMonitoringImportFence(tx, input)
    if (!gate.allowed) return gate
    return {
      allowed: true as const,
      value: await runWithTenant(
        input.organizationId,
        () => runWithSocialMonitoringCollectionFenceContext(
          input.organizationId,
          persist,
        ),
      ),
    }
  }, {
    maxWait: 30_000,
    timeout: IMPORT_FENCE_TRANSACTION_TIMEOUT_MS,
  })
}

export async function withSocialMonitoringTenantCollectionFence<T>(
  organizationId: string,
  collect: () => Promise<T>,
): Promise<SocialMonitoringTenantFenceResult<T>> {
  // Provider import callbacks already hold this tenant's advisory lock. Media
  // scheduling inside those callbacks must reuse the held fence instead of
  // opening another connection and deadlocking on the same session-level key.
  const heldFence = socialMonitoringCollectionFenceStorage.getStore()
  if (heldFence?.active) {
    if (heldFence.organizationId !== organizationId) {
      return {
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      }
    }
    return { allowed: true, value: await collect() }
  }
  return prisma.$transaction(async tx => {
    const gate = await checkSocialMonitoringTenantCollectionFence(tx, organizationId)
    if (!gate.allowed) return gate
    return {
      allowed: true as const,
      value: await runWithTenant(
        organizationId,
        () => runWithSocialMonitoringCollectionFenceContext(
          organizationId,
          collect,
        ),
      ),
    }
  }, {
    maxWait: 30_000,
    timeout: IMPORT_FENCE_TRANSACTION_TIMEOUT_MS,
  })
}
