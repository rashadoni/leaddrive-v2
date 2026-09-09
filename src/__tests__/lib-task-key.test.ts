import { describe, it, expect, vi } from "vitest"
import { generateTaskKey, isValidDivisionKey, type TaskKeyClient } from "@/lib/tasks/task-key"

/**
 * Mock the minimal `$queryRaw` surface. Records the static SQL (template parts
 * joined) and the bound values so we can assert on the generated query without
 * a live DB. The numeric MAX is configurable per test.
 */
function mockClient(maxValue: number | bigint | null) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const $queryRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values })
      return [{ max: maxValue }]
    },
  )
  return { client: { $queryRaw } as unknown as TaskKeyClient, $queryRaw, calls }
}

describe("generateTaskKey", () => {
  it("starts at 1 when no tasks exist (MAX null)", async () => {
    const { client } = mockClient(null)
    expect(await generateTaskKey(client, "org1", "KHS")).toBe("KHS-1")
  })

  it("returns MAX + 1", async () => {
    const { client } = mockClient(54)
    expect(await generateTaskKey(client, "org1", "KHS")).toBe("KHS-55")
  })

  it("handles a bigint MAX (Postgres can widen)", async () => {
    const { client } = mockClient(BigInt(99))
    expect(await generateTaskKey(client, "org1", "PROJ")).toBe("PROJ-100")
  })

  it("rejects invalid prefixes and never queries", async () => {
    const { client, $queryRaw } = mockClient(0)
    await expect(generateTaskKey(client, "org1", "khs")).rejects.toThrow() // lowercase
    await expect(generateTaskKey(client, "org1", "A-B")).rejects.toThrow() // hyphen
    await expect(generateTaskKey(client, "org1", "")).rejects.toThrow() // empty
    await expect(generateTaskKey(client, "org1", "WAY-TOO-LONG-PREFIX-XX")).rejects.toThrow()
    expect($queryRaw).not.toHaveBeenCalled()
  })

  it("counts soft-deleted rows: SQL has NO deletedAt filter (anti-collision)", async () => {
    const { client, calls } = mockClient(7)
    await generateTaskKey(client, "org1", "KHS")
    const sql = calls[0].sql.toLowerCase()
    expect(sql).not.toContain("deletedat")
    expect(sql).toContain("regexp_match")
    expect(sql).toContain('"tasks"')
  })

  it("anchors the regex to the prefix so other prefixes are excluded", async () => {
    const { client, calls } = mockClient(3)
    await generateTaskKey(client, "org1", "KHS")
    expect(calls[0].values).toContain("^KHS-([0-9]+)$")
    expect(calls[0].values).toContain("org1")
  })
})

describe("isValidDivisionKey", () => {
  it("accepts short uppercase alphanumeric tokens", () => {
    expect(isValidDivisionKey("KHS")).toBe(true)
    expect(isValidDivisionKey("ABC123")).toBe(true)
    expect(isValidDivisionKey("X")).toBe(true)
  })
  it("rejects lowercase, spaces, punctuation, empty, and over-long", () => {
    expect(isValidDivisionKey("khs")).toBe(false)
    expect(isValidDivisionKey("A B")).toBe(false)
    expect(isValidDivisionKey("A-B")).toBe(false)
    expect(isValidDivisionKey("")).toBe(false)
    expect(isValidDivisionKey("ABCDEFGHIJKLMNOPQ")).toBe(false) // 17 chars
  })
})
