import { describe, expect, it } from "vitest"
import {
  parseWorkforceEvidenceTargets,
  parseWorkforceEvidenceTimeline,
  workforceEvidenceReasonLabelKey,
} from "@/lib/workforce/evidence-timeline-client"

function timeline() {
  return {
    timezone: "Asia/Baku",
    start: "2026-09-01",
    end: "2026-09-13",
    employee: { id: "agent-1", name: "Aysel Aliyeva" },
    access: {
      purpose: "ATTENDANCE_REVIEW",
      reasonCode: "OPEN_EXCEPTION",
      caseReference: "case-17",
    },
    boundaries: {
      projection: "DERIVED_ONLY",
      rawEvidence: "NOT_RETURNED",
      physicalPresence: "VERDICT_IS_NOT_IDENTITY_OR_PRESENCE_PROOF",
    },
    evidence: [{
      id: "evidence-1",
      source: "LOCATION",
      capturedAt: "2026-09-13T05:01:00.000Z",
      rawRetentionState: "WITHIN_RETENTION",
      subject: {
        kind: "WORKDAY_EVENT",
        id: "event-1",
        action: "START",
        claimedAt: "2026-09-13T05:00:00.000Z",
        reviewState: "PENDING_REVIEW",
      },
      assessments: [{
        id: "assessment-1",
        kind: "GEOFENCE",
        assessorVersion: "geo-v1",
        verdict: "INSIDE",
        reasonCodes: ["INSIDE_GEOFENCE"],
        assessedAt: "2026-09-13T05:01:01.000Z",
      }],
    }],
  }
}

describe("Workforce evidence timeline client boundary", () => {
  it("accepts the exact derived-only contract and strips all internal IDs", () => {
    const parsed = parseWorkforceEvidenceTimeline(timeline(), "agent-1")

    expect(parsed).toMatchObject({
      employeeName: "Aysel Aliyeva",
      evidence: [{
        source: "LOCATION",
        subject: { kind: "WORKDAY_EVENT", action: "START" },
        assessments: [{ kind: "GEOFENCE", verdict: "INSIDE" }],
      }],
    })
    expect(JSON.stringify(parsed)).not.toMatch(/agent-1|evidence-1|event-1|assessment-1|geo-v1/)
  })

  it("rejects unknown enums, mismatched employees and periods over 31 days", () => {
    expect(parseWorkforceEvidenceTimeline({ ...timeline(), evidence: [{
      ...timeline().evidence[0],
      source: "ACTION_LOCATION",
    }] }, "agent-1")).toBeNull()
    expect(parseWorkforceEvidenceTimeline(timeline(), "agent-2")).toBeNull()
    expect(parseWorkforceEvidenceTimeline({
      ...timeline(),
      start: "2026-08-01",
      end: "2026-09-13",
    }, "agent-1")).toBeNull()
  })

  it("rejects oversized, duplicated or malformed nested collections", () => {
    expect(parseWorkforceEvidenceTimeline({
      ...timeline(),
      evidence: Array.from({ length: 501 }, (_, index) => ({
        ...timeline().evidence[0],
        id: `evidence-${index}`,
      })),
    }, "agent-1")).toBeNull()
    expect(parseWorkforceEvidenceTimeline({
      ...timeline(),
      evidence: [timeline().evidence[0], timeline().evidence[0]],
    }, "agent-1")).toBeNull()
    expect(parseWorkforceEvidenceTimeline({
      ...timeline(),
      evidence: [{
        ...timeline().evidence[0],
        assessments: [{ ...timeline().evidence[0].assessments[0], reasonCodes: ["not-safe"] }],
      }],
    }, "agent-1")).toBeNull()
  })

  it("accepts at most 25 unique named targets and rejects unsafe labels", () => {
    expect(parseWorkforceEvidenceTargets({
      items: [{ id: "agent-1", label: "Aysel Aliyeva · EMP-17" }],
      hasMore: false,
    })).toEqual({
      items: [{ id: "agent-1", label: "Aysel Aliyeva · EMP-17" }],
      hasMore: false,
    })
    expect(parseWorkforceEvidenceTargets({
      items: Array.from({ length: 26 }, (_, index) => ({ id: `agent-${index}`, label: `Agent ${index}` })),
      hasMore: true,
    })).toBeNull()
    expect(parseWorkforceEvidenceTargets({
      items: [{ id: "agent-1", label: "" }],
      hasMore: false,
    })).toBeNull()
  })

  it("maps known machine reasons to safe presentation keys and hides unknown codes", () => {
    expect(workforceEvidenceReasonLabelKey("LOCATION_PERMISSION_DENIED")).toBe("LOCATION_UNAVAILABLE")
    expect(workforceEvidenceReasonLabelKey("LOCATION_STALE")).toBe("LOCATION_TIMING_REVIEW")
    expect(workforceEvidenceReasonLabelKey("INSIDE_WITH_ACCURACY")).toBe("INSIDE_CONFIRMED")
    expect(workforceEvidenceReasonLabelKey("INTERNAL_SECURITY_RULE_47")).toBe("REVIEW_REQUIRED")
  })
})
