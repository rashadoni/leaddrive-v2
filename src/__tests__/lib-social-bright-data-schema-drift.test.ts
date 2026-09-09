import { describe, expect, it, vi } from "vitest"
import {
  BRIGHT_DATA_SCHEMA_DRIFT_VERSION,
  evaluateBrightDataSchemaDrift,
} from "@/lib/social/bright-data-schema-drift"

function normalize(row: unknown) {
  const value = row as { id?: unknown; text?: unknown }
  if (typeof value.id !== "string" || !value.id) throw new Error("post ID is required")
  if (typeof value.text !== "string" || !value.text) throw new Error("post text is required")
  return { id: value.id, text: value.text }
}

describe("Bright Data schema drift evaluator", () => {
  it("keeps a valid empty response as TRUE_ZERO, not a failure", () => {
    const normalizer = vi.fn(normalize)
    const report = evaluateBrightDataSchemaDrift([], normalizer)

    expect(report).toEqual({
      schemaVersion: BRIGHT_DATA_SCHEMA_DRIFT_VERSION,
      health: "TRUE_ZERO",
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
      providerErrorCount: 0,
      invalidRatio: null,
      failureCodes: {},
      normalized: [],
      warnings: [],
    })
    expect(normalizer).not.toHaveBeenCalled()
  })

  it("returns normalized rows and HEALTHY for a valid batch", () => {
    const report = evaluateBrightDataSchemaDrift([
      { id: "one", text: "first" },
      { id: "two", text: "second" },
    ], normalize)

    expect(report).toMatchObject({
      health: "HEALTHY",
      totalCount: 2,
      validCount: 2,
      invalidCount: 0,
      invalidRatio: 0,
      normalized: [{ id: "one", text: "first" }, { id: "two", text: "second" }],
    })
  })

  it("keeps a below-threshold malformed row as a warning", () => {
    const rows = Array.from({ length: 10 }, (_, index) => (
      index === 0 ? { id: "bad" } : { id: `ok-${index}`, text: "valid" }
    ))
    const report = evaluateBrightDataSchemaDrift(rows, normalize)

    expect(report).toMatchObject({
      health: "HEALTHY",
      validCount: 9,
      invalidCount: 1,
      invalidRatio: 0.1,
      failureCodes: { missing_text: 1 },
      warnings: ["bright_data_schema:missing_text"],
    })
  })

  it("degrades above the threshold and fails when every row is invalid", () => {
    const degraded = evaluateBrightDataSchemaDrift([
      { id: "one", text: "valid" },
      { id: "two" },
      { text: "missing id" },
    ], normalize)
    expect(degraded).toMatchObject({ health: "DEGRADED", validCount: 1, invalidCount: 2 })

    const failed = evaluateBrightDataSchemaDrift([
      { id: "missing-text" },
      { text: "missing id" },
    ], normalize)
    expect(failed).toMatchObject({
      health: "FAILED",
      validCount: 0,
      invalidCount: 2,
      failureCodes: { missing_text: 1, missing_identity: 1 },
    })
  })

  it("records provider error codes without exposing provider message or payload", () => {
    const report = evaluateBrightDataSchemaDrift([
      { id: "one", text: "valid" },
      {
        error_code: "dead_page",
        error: "private message with https://secret.example/token and Bearer leaked-token",
      },
    ], normalize)

    expect(report).toMatchObject({
      health: "DEGRADED",
      providerErrorCount: 1,
      failureCodes: { "provider_error:dead_page": 1 },
      warnings: ["bright_data_schema:provider_error:dead_page"],
    })
    expect(JSON.stringify(report)).not.toContain("secret.example")
    expect(JSON.stringify(report)).not.toContain("leaked-token")
  })

  it("rejects invalid drift thresholds before normalizing rows", () => {
    const normalizer = vi.fn(normalize)
    expect(() => evaluateBrightDataSchemaDrift([{ id: "one", text: "valid" }], normalizer, {
      degradedRatio: 1,
    })).toThrow("degradedRatio must be between 0")
    expect(normalizer).not.toHaveBeenCalled()
  })
})
