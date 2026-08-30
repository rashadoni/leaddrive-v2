export const WORKFORCE_ATTENDANCE_TRIAGE_ACTION_WINDOW_MS = 15 * 60 * 1_000
export const WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_WINDOW_MS = 24 * 60 * 60 * 1_000
export const WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD = 12
export const WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_COUNT_THRESHOLD = 3

export type WorkforceAttendanceSecurityRiskCode =
  | "MULTIPLE_TRUSTED_DEVICES_USED"
  | "RAPID_DEVICE_ENROLLMENT_CHURN"
  | "ABNORMAL_ATTENDANCE_ACTION_VOLUME"

type Agent = { id: string; name: string }

type TriageInput = {
  agents: readonly Agent[]
  deviceVerificationRows: readonly { agentId: string; deviceEnrollmentId: string | null }[]
  enrollmentRows: readonly { agentId: string; count: number }[]
  actionRows: readonly { agentId: string; count: number }[]
}

export type WorkforceAttendanceSecurityTriageResult = {
  examinedAgents: number
  reviewCandidates: Array<{
    employee: Agent
    riskCodes: WorkforceAttendanceSecurityRiskCode[]
    reviewRequired: true
    signals: {
      distinctTrustedDevicesUsed: number
      recentEnrollmentCount: number
      recentActionCount: number
    }
  }>
}

function countsByAgent(rows: readonly { agentId: string; count: number }[]): Map<string, number> {
  return new Map(rows.map((row) => [row.agentId, row.count]))
}

/**
 * Produces a review-only triage view from bounded aggregate evidence. It never
 * decides fraud, mutates an attendance event, disables a device or exposes a
 * device identifier. Threshold hits are prompts for an accountable human
 * review, because travel, replacement and recovery can be legitimate.
 */
export function triageWorkforceAttendanceSecurity(input: TriageInput): WorkforceAttendanceSecurityTriageResult {
  const trustedDevicesByAgent = new Map<string, Set<string>>()
  for (const row of input.deviceVerificationRows) {
    if (row.deviceEnrollmentId == null) continue
    const devices = trustedDevicesByAgent.get(row.agentId) ?? new Set<string>()
    devices.add(row.deviceEnrollmentId)
    trustedDevicesByAgent.set(row.agentId, devices)
  }
  const enrollmentsByAgent = countsByAgent(input.enrollmentRows)
  const actionsByAgent = countsByAgent(input.actionRows)
  const reviewCandidates = input.agents.flatMap((employee) => {
    const distinctTrustedDevicesUsed = trustedDevicesByAgent.get(employee.id)?.size ?? 0
    const recentEnrollmentCount = enrollmentsByAgent.get(employee.id) ?? 0
    const recentActionCount = actionsByAgent.get(employee.id) ?? 0
    const riskCodes: WorkforceAttendanceSecurityRiskCode[] = []
    if (distinctTrustedDevicesUsed > 1) riskCodes.push("MULTIPLE_TRUSTED_DEVICES_USED")
    if (recentEnrollmentCount >= WORKFORCE_ATTENDANCE_TRIAGE_ENROLLMENT_COUNT_THRESHOLD) {
      riskCodes.push("RAPID_DEVICE_ENROLLMENT_CHURN")
    }
    if (recentActionCount >= WORKFORCE_ATTENDANCE_TRIAGE_ACTION_COUNT_THRESHOLD) {
      riskCodes.push("ABNORMAL_ATTENDANCE_ACTION_VOLUME")
    }
    return riskCodes.length === 0
      ? []
      : [{
          employee,
          riskCodes,
          reviewRequired: true as const,
          signals: { distinctTrustedDevicesUsed, recentEnrollmentCount, recentActionCount },
        }]
  })
  return { examinedAgents: input.agents.length, reviewCandidates }
}
