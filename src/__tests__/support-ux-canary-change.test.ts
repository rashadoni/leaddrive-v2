import { describe, expect, it } from "vitest"
import { planSupportCanaryChange, SupportCanaryChangeError } from "@/lib/support-ux-canary-change"
import { SUPPORT_UX_V2_CANARY_FLAG as FLAG } from "@/lib/support-ux-rollout"

describe("Support canary feature preservation", () => {
  it("adds only the fixed flag, preserving duplicates, unknown values and input", () => {
    const original = ["crm", "crm", null, 7, { future: ["value"] }, "support"]
    const snapshot = structuredClone(original)
    const result = planSupportCanaryChange(original, true)
    expect(result).toEqual({ before: false, changed: true, nextFeatures: [...original, FLAG] })
    expect(original).toEqual(snapshot)
  })
  it("preserves encoded-array storage and all unrelated entries", () => {
    const original = JSON.stringify(["crm", "crm", null, { unknown: true }])
    const result = planSupportCanaryChange(original, true)
    expect(typeof result.nextFeatures).toBe("string")
    expect(JSON.parse(result.nextFeatures as string)).toEqual(["crm", "crm", null, { unknown: true }, FLAG])
  })
  it("removes only the canary, including repeated copies", () => {
    const original = [FLAG, "crm", "crm", { unrelated: true }, FLAG]
    expect(planSupportCanaryChange(original, false).nextFeatures).toEqual(["crm", "crm", { unrelated: true }])
  })
  it("retains the exact encoded value for an already-enabled confirmation", () => {
    const original = ` [ "crm", "${FLAG}", "crm" ] `
    expect(planSupportCanaryChange(original, true)).toEqual({ before: true, changed: false, nextFeatures: original })
  })
  it.each([null, {}, "[broken", '"array"', '{"enabled":true}', '[1e999]'])("fails closed for unsupported features: %j", (features) => {
    expect(() => planSupportCanaryChange(features, true)).toThrow(SupportCanaryChangeError)
  })
  it("rejects oversized stored state without normalizing it", () => {
    expect(() => planSupportCanaryChange(["x".repeat(4097)], true)).toThrow("SUPPORT_UX_FEATURES_UNSUPPORTED")
  })
})
