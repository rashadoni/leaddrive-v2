import { lockWorkforceExceptionDecisionStream } from "@/lib/workforce/exception-case-writer"
import { evaluateWorkforceExceptionDraftLifecycle } from "@/lib/workforce/exception-policy-draft"
import { MAX_WORKFORCE_EXCEPTION_DECISIONS } from "@/lib/workforce/exception-workbench"

export type WorkforceExceptionLinkedMutationDb = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => PromiseLike<unknown>
  workforceExceptionDecision: {
    findMany: (args: {
      where: { organizationId: string; caseId: string }
      orderBy: readonly [{ createdAt: "asc" }, { id: "asc" }]
      take: number
      select: { decisionCode: true }
    }) => PromiseLike<readonly { decisionCode: string }[]>
  }
}

export class WorkforceExceptionLinkedMutationError extends Error {
  constructor(readonly code:
    | "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED"
    | "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
  ) {
    super(code)
  }
}

/**
 * Checks the immutable case lifecycle while the caller holds the canonical
 * decision-stream lock. Exact operation replays may be resolved before this
 * guard, but every new response or linked request mutation must pass it.
 */
export async function requireWorkforceExceptionLinkedMutationAfterLock(input: {
  db: WorkforceExceptionLinkedMutationDb
  organizationId: string
  caseId: string
}): Promise<void> {
  const decisions = await input.db.workforceExceptionDecision.findMany({
    where: { organizationId: input.organizationId, caseId: input.caseId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
    select: { decisionCode: true },
  })
  if (decisions.length >= MAX_WORKFORCE_EXCEPTION_DECISIONS) {
    throw new WorkforceExceptionLinkedMutationError(
      "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    )
  }
  const lifecycle = evaluateWorkforceExceptionDraftLifecycle(decisions)
  if (!lifecycle.valid) {
    throw new WorkforceExceptionLinkedMutationError(
      "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    )
  }
  if (lifecycle.stage === "RESOLVED") {
    throw new WorkforceExceptionLinkedMutationError(
      "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED",
    )
  }
}

/**
 * Serializes a new linked mutation with resolution/reopen and validates the
 * post-lock lifecycle snapshot. Every caller must keep the returned lock for
 * the remainder of its database transaction.
 */
export async function lockWorkforceExceptionLinkedMutation(input: {
  db: WorkforceExceptionLinkedMutationDb
  organizationId: string
  caseId: string
}): Promise<void> {
  await lockWorkforceExceptionDecisionStream(input.db, input)
  await requireWorkforceExceptionLinkedMutationAfterLock(input)
}
