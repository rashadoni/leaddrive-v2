import { describe, expect, it } from "vitest"

import {
  createQueuedTaskDocument,
  markTaskDocumentFailed,
  markTaskDocumentUploading,
  retryTaskDocumentNow,
  taskDocumentRetryDelay,
  taskDocumentsReadyForUpload,
  TASK_DOCUMENT_UPLOAD_LEASE_MS,
  applyTaskExecutionOutcome,
  createQueuedTaskExecution,
  mergeQueuedTaskExecution,
} from "@/lib/mtm/task-document-outbox"

const blob = new Blob(["evidence"], { type: "text/plain" })

function queued(id: string, now = 1_700_000_000_000) {
  return createQueuedTaskDocument(
    { taskId: "task-1", file: blob, fileName: `${id}.txt`, title: id },
    { clientDocumentId: id, now },
  )
}

describe("task document outbox pure helpers", () => {
  it("creates a durable upload record with a stable idempotency key", () => {
    const entry = queued("document-123")

    expect(entry).toMatchObject({
      clientDocumentId: "document-123",
      taskId: "task-1",
      fileName: "document-123.txt",
      mimeType: "text/plain",
      sizeBytes: blob.size,
      attempts: 0,
      status: "queued",
    })
    expect(entry.blob).toBe(blob)
  })

  it("orders retryable documents and excludes an in-flight upload", () => {
    const older = queued("older", 1_700_000_000_000)
    const newer = queued("newer", 1_700_000_001_000)
    const uploading = markTaskDocumentUploading(queued("uploading", 1_700_000_002_000))

    expect(taskDocumentsReadyForUpload([newer, uploading, older], 1_700_000_010_000)
      .map((entry) => entry.clientDocumentId)).toEqual(["older", "newer"])
  })

  it("recovers an upload lease after a browser restart without changing its id", () => {
    const startedAt = 1_700_000_000_000
    const uploading = markTaskDocumentUploading(queued("restart-safe-id", startedAt), startedAt)

    expect(taskDocumentsReadyForUpload([uploading], startedAt + TASK_DOCUMENT_UPLOAD_LEASE_MS - 1)).toEqual([])
    expect(taskDocumentsReadyForUpload([uploading], startedAt + TASK_DOCUMENT_UPLOAD_LEASE_MS))
      .toEqual([uploading])
    expect(uploading.clientDocumentId).toBe("restart-safe-id")
  })

  it("backs off transient failures without replacing the idempotency key", () => {
    const now = 1_700_000_000_000
    const entry = queued("document-123", now)
    const failed = markTaskDocumentFailed(entry, "Connection lost", now)

    expect(failed.clientDocumentId).toBe(entry.clientDocumentId)
    expect(failed.status).toBe("failed")
    expect(failed.attempts).toBe(1)
    expect(failed.nextAttemptAt).toBe(now + taskDocumentRetryDelay(1))
    expect(taskDocumentsReadyForUpload([failed], now)).toEqual([])
    expect(taskDocumentsReadyForUpload([failed], failed.nextAttemptAt)).toEqual([failed])
  })

  it("manual retry clears the error and makes the same record immediately due", () => {
    const now = 1_700_000_000_000
    const failed = markTaskDocumentFailed(queued("document-123", now), "Server unavailable", now)
    const retried = retryTaskDocumentNow(failed, now + 100)

    expect(retried).toMatchObject({
      clientDocumentId: "document-123",
      status: "queued",
      nextAttemptAt: now + 100,
      attempts: 1,
    })
    expect(retried.lastError).toBeUndefined()
  })

  it("caps exponential retry delay at fifteen minutes", () => {
    expect(taskDocumentRetryDelay(1)).toBe(2_000)
    expect(taskDocumentRetryDelay(30)).toBe(15 * 60_000)
  })
})

describe("task execution outbox pure helpers", () => {
  it("coalesces offline progress and completion under one stable operation id", () => {
    const progress = createQueuedTaskExecution(
      { taskId: "task-1", expectedVersion: 7, progress: 40 },
      { operationId: "stable-operation-id", now: 1_700_000_000_000 },
    )
    const completed = mergeQueuedTaskExecution(progress, {
      taskId: "task-1",
      expectedVersion: 7,
      status: "COMPLETED",
      progress: 100,
      result: "Visit evidence captured",
    }, 1_700_000_001_000)

    expect(completed.operationId).toBe("stable-operation-id")
    expect(completed.data).toMatchObject({
      id: "task-1",
      expectedVersion: 7,
      status: "COMPLETED",
      progress: 100,
      result: "Visit evidence captured",
    })
  })

  it("retains conflicts for explicit recovery and removes accepted operations", () => {
    const entry = createQueuedTaskExecution(
      { taskId: "task-1", expectedVersion: 3, progress: 75 },
      { operationId: "operation-id", now: 1_700_000_000_000 },
    )

    expect(applyTaskExecutionOutcome(entry, { status: "ok" })).toBeNull()
    expect(applyTaskExecutionOutcome(entry, {
      status: "conflict",
      error: "Task changed on the server",
      serverData: { version: 4 },
    })).toMatchObject({
      operationId: "operation-id",
      status: "conflict",
      attempts: 1,
      lastError: "Task changed on the server",
      serverData: { version: 4 },
    })
  })

  it("mints a fresh operation instead of overwriting an unresolved conflict", () => {
    const conflicted = applyTaskExecutionOutcome(
      createQueuedTaskExecution({ taskId: "task-1", expectedVersion: 3, progress: 50 }, { operationId: "old-id" }),
      { status: "conflict", error: "changed" },
    )!
    const next = mergeQueuedTaskExecution(conflicted, { taskId: "task-1", expectedVersion: 4, progress: 60 })

    expect(next.operationId).not.toBe("old-id")
    expect(next.expectedVersion).toBe(4)
    expect(next.status).toBe("pending")
  })

  it("never changes facts under an idempotency key after an uncertain error", () => {
    const errored = applyTaskExecutionOutcome(
      createQueuedTaskExecution({ taskId: "task-1", expectedVersion: 3, progress: 40 }, { operationId: "uncertain-id" }),
      { status: "error", error: "response lost" },
    )!
    const attemptedEdit = mergeQueuedTaskExecution(errored, {
      taskId: "task-1",
      expectedVersion: 3,
      status: "COMPLETED",
      progress: 100,
    })

    expect(attemptedEdit).toBe(errored)
    expect(attemptedEdit.operationId).toBe("uncertain-id")
    expect(attemptedEdit.data).toMatchObject({ progress: 40 })
    expect(attemptedEdit.data.status).toBeUndefined()
  })
})
