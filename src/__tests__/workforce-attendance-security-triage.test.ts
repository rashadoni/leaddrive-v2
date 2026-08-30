import { describe, expect, it } from "vitest"
import {
  triageWorkforceAttendanceSecurity,
  WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD,
} from "@/lib/workforce/attendance-security-triage"

describe("Workforce attendance security triage", () => {
  it("turns device, enrollment and action anomalies into review-only aggregate prompts", () => {
    const result = triageWorkforceAttendanceSecurity({
      agents: [
        { id: "agent-normal", name: "Normal" },
        { id: "agent-risk", name: "Risk" },
      ],
      deviceVerificationRows: [
        { agentId: "agent-risk", deviceEnrollmentId: "device-a" },
        { agentId: "agent-risk", deviceEnrollmentId: "device-b" },
        { agentId: "agent-risk", deviceEnrollmentId: "device-a" },
      ],
      enrollmentRows: [{ agentId: "agent-risk", count: 3 }],
      actionRows: [{ agentId: "agent-risk", count: WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD }],
    })

    expect(result).toEqual({
      examinedAgents: 2,
      reviewCandidates: [{
        employee: { id: "agent-risk", name: "Risk" },
        riskCodes: [
          "MULTIPLE_TRUSTED_DEVICES_USED",
          "RAPID_DEVICE_ENROLLMENT_CHURN",
          "ABNORMAL_ATTENDANCE_ACTION_VOLUME",
        ],
        reviewRequired: true,
        signals: {
          distinctTrustedDevicesUsed: 2,
          recentEnrollmentCount: 3,
          recentActionCount: WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD,
        },
      }],
    })
  })

  it("does not mistake one device or ordinary action volume for a security decision", () => {
    const result = triageWorkforceAttendanceSecurity({
      agents: [{ id: "agent-normal", name: "Normal" }],
      deviceVerificationRows: [{ agentId: "agent-normal", deviceEnrollmentId: "device-a" }],
      enrollmentRows: [{ agentId: "agent-normal", count: 2 }],
      actionRows: [{ agentId: "agent-normal", count: WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD - 1 }],
    })

    expect(result.reviewCandidates).toEqual([])
  })
})
