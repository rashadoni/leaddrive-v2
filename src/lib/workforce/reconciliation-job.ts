import {
  reconcileWorkforceSnapshot,
  type WorkforceReconciliationCode,
  type WorkforceReconciliationSnapshot,
} from "@/lib/workforce/reconciliation"

const PAGE_LIMIT = 1_000
const DEFAULT_MAX_PAGES = 10

export interface WorkforceReconciliationPageStore {
  loadPage(input: {
    cursor: string | null
    limit: number
  }): Promise<{
    snapshot: WorkforceReconciliationSnapshot
    nextCursor: string | null
    more: boolean
  }>
  commitCursor(input: {
    previousCursor: string | null
    nextCursor: string | null
  }): Promise<boolean>
}

export type WorkforceReconciliationJobResult = {
  status: "MATCHED" | "MISMATCH" | "CURSOR_CONFLICT" | "TRUNCATED"
  pagesExamined: number
  examined: Readonly<Record<keyof WorkforceReconciliationSnapshot, number>>
  mismatchCounts: Partial<Record<WorkforceReconciliationCode, number>>
  mismatchTotal: number
  repair: "NONE"
}

function emptyExamined(): Record<keyof WorkforceReconciliationSnapshot, number> {
  return {
    workdays: 0,
    events: 0,
    transitions: 0,
    evidence: 0,
    assessments: 0,
    exceptions: 0,
    approvals: 0,
    exports: 0,
  }
}

/**
 * Runs a finite sequence of read-only reconciliation pages. A mismatching page
 * deliberately leaves its cursor uncommitted so the anomaly remains visible
 * to the next operator/run. Cursor compare-and-set prevents concurrent runners
 * from skipping a page. The store implementation owns durable persistence.
 */
export async function runWorkforceReconciliationJob(input: {
  store: WorkforceReconciliationPageStore
  initialCursor: string | null
  maxPages?: number
}): Promise<WorkforceReconciliationJobResult> {
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) {
    throw new Error("WORKFORCE_RECONCILIATION_MAX_PAGES_INVALID")
  }

  let cursor = input.initialCursor
  const examined = emptyExamined()
  const mismatchCounts: Partial<Record<WorkforceReconciliationCode, number>> = {}

  for (let page = 1; page <= maxPages; page += 1) {
    const loaded = await input.store.loadPage({ cursor, limit: PAGE_LIMIT })
    if (loaded.more && (!loaded.nextCursor || loaded.nextCursor === cursor)) {
      throw new Error("WORKFORCE_RECONCILIATION_CURSOR_INVALID")
    }
    const result = reconcileWorkforceSnapshot(loaded.snapshot)
    for (const [kind, count] of Object.entries(result.examined) as Array<[
      keyof WorkforceReconciliationSnapshot,
      number,
    ]>) examined[kind] += count
    for (const [code, count] of Object.entries(result.mismatchCounts) as Array<[
      WorkforceReconciliationCode,
      number,
    ]>) mismatchCounts[code] = (mismatchCounts[code] ?? 0) + count

    if (result.status === "MISMATCH") {
      return {
        status: "MISMATCH",
        pagesExamined: page,
        examined,
        mismatchCounts,
        mismatchTotal: Object.values(mismatchCounts).reduce((sum, count) => sum + (count ?? 0), 0),
        repair: "NONE",
      }
    }

    const committed = await input.store.commitCursor({ previousCursor: cursor, nextCursor: loaded.nextCursor })
    if (!committed) {
      return {
        status: "CURSOR_CONFLICT",
        pagesExamined: page,
        examined,
        mismatchCounts,
        mismatchTotal: 0,
        repair: "NONE",
      }
    }
    cursor = loaded.nextCursor
    if (!loaded.more) {
      return {
        status: "MATCHED",
        pagesExamined: page,
        examined,
        mismatchCounts,
        mismatchTotal: 0,
        repair: "NONE",
      }
    }
  }

  return {
    status: "TRUNCATED",
    pagesExamined: maxPages,
    examined,
    mismatchCounts,
    mismatchTotal: 0,
    repair: "NONE",
  }
}
