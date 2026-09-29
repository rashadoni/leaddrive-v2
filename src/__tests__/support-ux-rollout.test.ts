import { describe, expect, it } from "vitest"

import {
  SUPPORT_UX_V2_CANARY_FLAG,
  supportUxV2CanaryEnabled,
} from "@/lib/support-ux-rollout"

describe("Support UX tenant rollout", () => {
  it("requires the exact explicit tenant feature flag", () => {
    expect(supportUxV2CanaryEnabled([])).toBe(false)
    expect(supportUxV2CanaryEnabled(["support", "support_ux_v2"])).toBe(false)
    expect(supportUxV2CanaryEnabled([SUPPORT_UX_V2_CANARY_FLAG])).toBe(true)
  })

  it("uses the shared tolerant feature decoder without widening malformed state", () => {
    expect(supportUxV2CanaryEnabled(JSON.stringify([SUPPORT_UX_V2_CANARY_FLAG]))).toBe(true)
    expect(supportUxV2CanaryEnabled({ enabled: true })).toBe(false)
    expect(supportUxV2CanaryEnabled(null)).toBe(false)
  })
})
