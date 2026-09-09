import { describe, expect, it } from "vitest"
import {
  consoleErrorBucket,
  findQaLiveAgentId,
  findQaPromotionReviewExecutionId,
  isProductionEvidenceTarget,
} from "../../scripts/swissmed-mtm-evidence-helpers.mjs"

const agentId = "qa-agent-1"

function promotionPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      capabilities: { canReview: true },
      rows: [{
        id: "qa-execution-1",
        employee: { id: agentId, name: "[QA-SWISSMED] Field Agent" },
        target: { customerCode: "QA-SWM-PHARMACY", customerName: "[QA-SWISSMED] Central Pharmacy" },
        currentStep: "L1",
        policy: { ready: true },
        ...overrides,
      }],
    },
  }
}

function livePayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      agentLocations: [{
        agentId,
        name: "[QA-SWISSMED] Field Agent",
        freshness: "ONLINE",
        locationState: "AVAILABLE",
        latitude: 40.4093,
        longitude: 49.8671,
        recordedAt: "2026-08-20T08:00:00.000Z",
        ...overrides,
      }],
    },
  }
}

describe("SwissMed MTM evidence fixture helpers", () => {
  it("recognizes canonical and trailing-dot production origins", () => {
    for (const value of [
      "https://app.leaddrivecrm.org",
      "https://APP.LEADDRIVECRM.ORG",
      "https://app.leaddrivecrm.org.",
      "https://app.leaddrivecrm.org:443/mtm",
    ]) {
      expect(isProductionEvidenceTarget(value)).toBe(true)
    }
    for (const value of [
      "http://app.leaddrivecrm.org",
      "https://app.leaddrivecrm.org:8443",
      "https://app.leaddrivecrm.org.example",
      "https://example.org",
      "not-a-url",
    ]) {
      expect(isProductionEvidenceTarget(value)).toBe(false)
    }
  })

  it("accepts only an exact reviewable QA pharmacy execution", () => {
    expect(findQaPromotionReviewExecutionId(promotionPayload(), agentId)).toBe("qa-execution-1")
    expect(findQaPromotionReviewExecutionId({
      ...promotionPayload(),
      data: { ...promotionPayload().data, capabilities: { canReview: false } },
    }, agentId)).toBeNull()
    expect(findQaPromotionReviewExecutionId(promotionPayload({ currentStep: null }), agentId)).toBeNull()
    expect(findQaPromotionReviewExecutionId(promotionPayload({ policy: { ready: false } }), agentId)).toBeNull()
    expect(findQaPromotionReviewExecutionId(promotionPayload({
      employee: { id: "other-agent", name: "[QA-SWISSMED] Field Agent" },
    }), agentId)).toBeNull()
    expect(findQaPromotionReviewExecutionId(promotionPayload({
      target: { customerCode: "REAL-CUSTOMER", customerName: "[QA-SWISSMED] Central Pharmacy" },
    }), agentId)).toBeNull()
  })

  it("accepts only a fresh, bounded and timestamped QA live coordinate", () => {
    expect(findQaLiveAgentId(livePayload(), agentId)).toBe(agentId)
    expect(findQaLiveAgentId(livePayload({ freshness: "STALE" }), agentId)).toBeNull()
    expect(findQaLiveAgentId(livePayload({ locationState: "NO_LOCATION_REPORTED" }), agentId)).toBeNull()
    expect(findQaLiveAgentId(livePayload({ latitude: 91 }), agentId)).toBeNull()
    expect(findQaLiveAgentId(livePayload({ longitude: -181 }), agentId)).toBeNull()
    expect(findQaLiveAgentId(livePayload({ recordedAt: "not-a-date" }), agentId)).toBeNull()
  })

  it("attributes external HTTP errors without treating unknown runtimes as external", () => {
    const baseURL = "https://app.leaddrivecrm.org"
    const baseOrigin = new URL(baseURL).origin
    const telemetryRequestUrls = new Set(["https://app.leaddrivecrm.org/api/v1/public/csp-report"])
    expect(consoleErrorBucket("", baseURL, baseOrigin)).toBe("blocking")
    expect(consoleErrorBucket("webpack-internal:///app.js", baseURL, baseOrigin)).toBe("blocking")
    expect(consoleErrorBucket("/mtm/chunk.js", baseURL, baseOrigin)).toBe("blocking")
    expect(consoleErrorBucket("https://app.leaddrivecrm.org/mtm/chunk.js", baseURL, baseOrigin)).toBe("blocking")
    expect(consoleErrorBucket("https://app.leaddrivecrm.org/api/v1/public/csp-report", baseURL, baseOrigin)).toBe("blocking")
    expect(consoleErrorBucket("https://app.leaddrivecrm.org/api/v1/public/csp-report", baseURL, baseOrigin, telemetryRequestUrls)).toBe("telemetry")
    expect(consoleErrorBucket("/api/v1/public/csp-report?source=browser", baseURL, baseOrigin, telemetryRequestUrls)).toBe("blocking")
    expect(consoleErrorBucket("https://other.example/api/v1/public/csp-report", baseURL, baseOrigin)).toBe("external")
    expect(consoleErrorBucket("https://a.basemaps.cartocdn.com/tile.png", baseURL, baseOrigin)).toBe("external")
  })
})
