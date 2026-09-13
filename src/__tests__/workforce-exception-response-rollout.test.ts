import { describe, expect, it } from "vitest"
import {
  resolveWorkforceExceptionResponseRecording,
  WORKFORCE_EXCEPTION_RESPONSE_FLAG,
} from "@/lib/workforce/exception-response-rollout"

describe("Workforce employee exception response rollout", () => {
  it("fails closed for absent, malformed, and unrelated organization features", () => {
    for (const features of [undefined, null, {}, ["workforce"], "workforce"]) {
      expect(resolveWorkforceExceptionResponseRecording(features)).toBe("MIGRATION_REQUIRED")
    }
  })

  it("requires the explicit post-migration tenant feature flag", () => {
    expect(resolveWorkforceExceptionResponseRecording([WORKFORCE_EXCEPTION_RESPONSE_FLAG])).toBe("AVAILABLE")
  })
})
