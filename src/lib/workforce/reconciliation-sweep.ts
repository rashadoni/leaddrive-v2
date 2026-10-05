import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { reconcileWorkforceSnapshot } from "@/lib/workforce/reconciliation"
import { readWorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation-snapshot"
import { workforceReconciliationCursorStore } from "@/lib/workforce/reconciliation-cursor-store"

type Reader = Pick<PrismaClient, "$transaction">
type Cursor = ReturnType<typeof workforceReconciliationCursorStore>

/**
 * Dormant one-tenant worker composition. Caller owns authorization, tenant
 * selection and live lease. The global opaque checkpoint records successful
 * sweeps, not tenant coverage or row resume position. Every run starts over.
 */
export async function runWorkforceReconciliationSweep(input: {
  reader: Reader; cursor: Cursor; organizationId: string; ownerToken: string
}) {
  const { reader, cursor, organizationId, ownerToken } = input
  if (typeof organizationId !== "string" || !organizationId.trim() || organizationId.length > 191
    || typeof ownerToken !== "string" || !ownerToken.trim() || ownerToken.length > 191) throw new Error("WORKFORCE_SWEEP_INPUT_INVALID")
  let expected: Awaited<ReturnType<Cursor["read"]>>
  try {
    const observed = await cursor.read()
    expected = observed === null ? null : { ...observed }
  } catch { throw new Error("WORKFORCE_SWEEP_CHECKPOINT_READ_FAILED") }
  if (expected !== null && expected.cursor !== null && !/^wf-sweep-v1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(expected.cursor)) {
    throw new Error("WORKFORCE_SWEEP_CHECKPOINT_PROTOCOL_INVALID")
  }
  // Await the transaction's successful end before writing operational progress.
  let result: ReturnType<typeof reconcileWorkforceSnapshot>
  try {
    result = await reader.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
      return reconcileWorkforceSnapshot(await readWorkforceReconciliationSnapshot(tx, organizationId))
    }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 30000 })
  } catch { throw new Error("WORKFORCE_SWEEP_INCOMPLETE") }
  if (result.status === "MISMATCH") return { ...result, checkpoint: "NOT_COMMITTED" as const }
  let committed: Awaited<ReturnType<Cursor["commit"]>>
  try {
    committed = await cursor.commit({ expected, ownerToken, nextCursor: `wf-sweep-v1:${randomUUID()}` })
  } catch {
    // A transport error after commit may be uncertain; never report success.
    throw new Error("WORKFORCE_SWEEP_CHECKPOINT_OUTCOME_UNKNOWN")
  }
  return { ...result, status: committed === "COMMITTED" ? result.status : committed, checkpoint: committed }
}
