import { describe, expect, it, vi } from "vitest"
import {
  runWorkforceReconciliationJob,
  type WorkforceReconciliationPageStore,
} from "@/lib/workforce/reconciliation-job"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"

const emptySnapshot = (): WorkforceReconciliationSnapshot => ({
  workdays: [], events: [], transitions: [], evidence: [], assessments: [],
  exceptions: [], approvals: [], exports: [],
})

function store(pages: Array<Awaited<ReturnType<WorkforceReconciliationPageStore["loadPage"]>>>, commit = true) {
  return {
    loadPage: vi.fn(async () => pages.shift() ?? { snapshot: emptySnapshot(), nextCursor: null, more: false }),
    commitCursor: vi.fn(async () => commit),
  }
}

describe("Workforce reconciliation job", () => {
  it("advances a durable compare-and-set cursor only after matched pages", async () => {
    const db = store([
      { snapshot: emptySnapshot(), nextCursor: "page-1", more: true },
      { snapshot: emptySnapshot(), nextCursor: "page-2", more: false },
    ])
    await expect(runWorkforceReconciliationJob({ store: db, initialCursor: null })).resolves.toMatchObject({
      status: "MATCHED", pagesExamined: 2, mismatchTotal: 0, repair: "NONE",
    })
    expect(db.loadPage).toHaveBeenNthCalledWith(1, { cursor: null, limit: 1_000 })
    expect(db.loadPage).toHaveBeenNthCalledWith(2, { cursor: "page-1", limit: 1_000 })
    expect(db.commitCursor).toHaveBeenNthCalledWith(1, { previousCursor: null, nextCursor: "page-1" })
    expect(db.commitCursor).toHaveBeenNthCalledWith(2, { previousCursor: "page-1", nextCursor: "page-2" })
  })

  it("leaves a mismatching page uncommitted for investigation", async () => {
    const snapshot = emptySnapshot()
    snapshot.events = [{ id: "event-private", organizationId: "org-private", agentId: "agent-private", workdayId: "missing" }]
    const db = store([{ snapshot, nextCursor: "page-bad", more: false }])
    const result = await runWorkforceReconciliationJob({ store: db, initialCursor: "page-before" })
    expect(result).toMatchObject({
      status: "MISMATCH",
      mismatchCounts: { WORKDAY_EVENT_SCOPE_MISMATCH: 1 },
      mismatchTotal: 1,
      repair: "NONE",
    })
    expect(db.commitCursor).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/private|page-before|page-bad/)
  })

  it("reports cursor races and a finite page ceiling without claiming success", async () => {
    const raced = store([{ snapshot: emptySnapshot(), nextCursor: "next", more: false }], false)
    await expect(runWorkforceReconciliationJob({ store: raced, initialCursor: "old" })).resolves.toMatchObject({
      status: "CURSOR_CONFLICT", pagesExamined: 1, repair: "NONE",
    })

    const repeated = store(Array.from({ length: 2 }, (_, index) => ({
      snapshot: emptySnapshot(), nextCursor: `page-${index + 1}`, more: true,
    })))
    await expect(runWorkforceReconciliationJob({
      store: repeated,
      initialCursor: null,
      maxPages: 2,
    })).resolves.toMatchObject({ status: "TRUNCATED", pagesExamined: 2, repair: "NONE" })
  })

  it("rejects a non-progressing cursor and unbounded page requests", async () => {
    const stuck = store([{ snapshot: emptySnapshot(), nextCursor: "same", more: true }])
    await expect(runWorkforceReconciliationJob({ store: stuck, initialCursor: "same" }))
      .rejects.toThrow("WORKFORCE_RECONCILIATION_CURSOR_INVALID")
    await expect(runWorkforceReconciliationJob({ store: stuck, initialCursor: null, maxPages: 11 }))
      .rejects.toThrow("WORKFORCE_RECONCILIATION_MAX_PAGES_INVALID")
  })
})
