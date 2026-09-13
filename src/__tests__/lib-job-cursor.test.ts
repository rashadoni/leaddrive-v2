import { describe, expect, it, vi } from "vitest"
import { prismaJobCursorStore } from "@/lib/cron/job-cursor"

function db(results: unknown[][]) {
  const query = vi.fn(async () => results.shift() ?? [])
  return { client: { $queryRaw: query }, query }
}

describe("durable job cursor", () => {
  it("reads an existing opaque cursor and treats a missing row as initial", async () => {
    const existing = db([[{ cursor: "v1:page-4" }]])
    await expect(prismaJobCursorStore(existing.client as never).read("workforce-reconciliation"))
      .resolves.toBe("v1:page-4")

    const missing = db([[]])
    await expect(prismaJobCursorStore(missing.client as never).read("workforce-reconciliation"))
      .resolves.toBeNull()
  })

  it("reports compare-and-set success or a concurrent cursor conflict", async () => {
    const success = db([[{ cursor: "v1:page-5" }]])
    await expect(prismaJobCursorStore(success.client as never).compareAndSet(
      "workforce-reconciliation",
      "v1:page-4",
      "v1:page-5",
    )).resolves.toBe(true)

    const conflict = db([[]])
    await expect(prismaJobCursorStore(conflict.client as never).compareAndSet(
      "workforce-reconciliation",
      "v1:page-4",
      "v1:page-5",
    )).resolves.toBe(false)
  })

  it("allows first insert only from the null cursor and bounds operational values", async () => {
    const first = db([[{ cursor: "v1:first" }]])
    await prismaJobCursorStore(first.client as never).compareAndSet(
      "workforce-reconciliation",
      null,
      "v1:first",
    )
    const strings = first.query.mock.calls[0][0] as TemplateStringsArray
    expect(strings.join("?")).toContain("WHERE ?::text IS NULL")
    expect(strings.join("?")).toContain("IS NOT DISTINCT FROM ?")

    const store = prismaJobCursorStore(db([]).client as never)
    await expect(store.read("")).rejects.toThrow("JOB_CURSOR_NAME_INVALID")
    await expect(store.compareAndSet("job", null, "x".repeat(513)))
      .rejects.toThrow("JOB_CURSOR_VALUE_INVALID")
  })
})
