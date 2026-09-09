/**
 * Smart AI Search — filter schema (anti-hallucination) tests.
 * The `.strict()` Zod schemas are the closed whitelist that prevents the LLM
 * from inventing field names that would otherwise reach a Prisma WHERE.
 */
import { describe, it, expect } from "vitest"
import { READ_TOOL_SCHEMAS, READ_TOOL_NAMES, READ_TOOL_MODULE, READ_TOOL_PERMISSION } from "@/lib/ai/read-tools"

describe("read-tool filter schemas (.strict())", () => {
  it("rejects a hallucinated field", () => {
    expect(READ_TOOL_SCHEMAS.list_invoices.safeParse({ customerName: "Acme" }).success).toBe(false)
  })

  it("rejects an out-of-enum status", () => {
    expect(READ_TOOL_SCHEMAS.list_invoices.safeParse({ status: "frozen" }).success).toBe(false)
  })

  it("accepts a valid filter", () => {
    expect(READ_TOOL_SCHEMAS.list_invoices.safeParse({ status: "paid", limit: 10 }).success).toBe(true)
  })

  it("rejects impossible calendar dates", () => {
    expect(READ_TOOL_SCHEMAS.list_deals.safeParse({ dateFrom: "2026-02-31" }).success).toBe(false)
    expect(READ_TOOL_SCHEMAS.list_deals.safeParse({ dateTo: "2026-02-28" }).success).toBe(true)
  })

  it("rejects a non-positive limit", () => {
    expect(READ_TOOL_SCHEMAS.list_deals.safeParse({ limit: 0 }).success).toBe(false)
  })

  it("rejects a non-integer limit", () => {
    expect(READ_TOOL_SCHEMAS.list_deals.safeParse({ limit: 2.5 }).success).toBe(false)
  })

  it("accepts an empty filter", () => {
    expect(READ_TOOL_SCHEMAS.list_tasks.safeParse({}).success).toBe(true)
  })

  it("rejects a hallucinated field on EVERY read tool", () => {
    for (const [name, schema] of Object.entries(READ_TOOL_SCHEMAS)) {
      expect(schema.safeParse({ __injected: 1 }).success, `${name} should reject unknown key`).toBe(false)
    }
  })

  it("maps every read tool to an owning module (module-gating completeness)", () => {
    for (const name of READ_TOOL_NAMES) {
      expect(READ_TOOL_MODULE[name], `${name} must have a module for gating`).toBeTruthy()
      expect(READ_TOOL_PERMISSION[name], `${name} must have an RBAC permission`).toBeTruthy()
    }
  })
})
