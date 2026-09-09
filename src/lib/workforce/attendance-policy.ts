import { z } from "zod"

/**
 * Attendance add-ons deliberately have no implicit policy.  A tenant must
 * publish the explicit v1 block below before QR or a trusted device can become
 * a requirement for a work-time action.  This keeps the existing Workforce
 * transport unchanged when the commercial add-on is absent or merely enabled.
 */
export const WorkforceAttendanceActionSchema = z.enum([
  "START",
  "PAUSE",
  "RESUME",
  "FINISH",
])

export type WorkforceAttendanceAction = z.infer<typeof WorkforceAttendanceActionSchema>

const RequiredActionsSchema = z.array(WorkforceAttendanceActionSchema)
  .min(1)
  .max(4)
  .refine((actions) => new Set(actions).size === actions.length, "Actions must not repeat")

const QrRequirementSchema = z.object({
  requiredActions: RequiredActionsSchema,
}).strict()

const DeviceTrustRequirementSchema = z.object({
  requiredActions: RequiredActionsSchema,
  /**
   * A biometric is never sent to LeadDrive.  It only unlocks the device's
   * hardware-backed signing key locally before the resulting signature is
   * submitted to the server.
   */
  biometricRequiredActions: RequiredActionsSchema.optional(),
}).strict().superRefine((value, context) => {
  for (const action of value.biometricRequiredActions ?? []) {
    if (!value.requiredActions.includes(action)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["biometricRequiredActions"],
        message: "A biometric requirement must also require device trust",
      })
    }
  }
})

/**
 * This is an intentionally narrow, versioned slice of WorkforcePolicy's
 * signed JSON definition.  Calculation fields remain owned by
 * policy-definition.ts; unknown policy keys remain immutable but have no
 * authentication effect until a later approved version introduces them.
 */
export const WorkforceAttendancePolicySchema = z.object({
  enforcementVersion: z.literal(1),
  qr: QrRequirementSchema.optional(),
  deviceTrust: DeviceTrustRequirementSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.qr && !value.deviceTrust) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Attendance enforcement must require QR, device trust, or both",
    })
  }
  if ((value.deviceTrust?.biometricRequiredActions?.length ?? 0) > 0) {
    // A local BiometricPrompt alone is not an assertion the server can verify.
    // Keep this policy surface fail-closed until the enrollment protocol also
    // verifies hardware-backed key attestation and its user-auth properties.
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deviceTrust", "biometricRequiredActions"],
      message: "Biometric-required attendance is unavailable until verified hardware attestation is enabled",
    })
  }
})

export type WorkforceAttendancePolicy = z.infer<typeof WorkforceAttendancePolicySchema>

export type WorkforceAttendanceRequirements = {
  qrRequiredActions: ReadonlySet<WorkforceAttendanceAction>
  deviceTrustRequiredActions: ReadonlySet<WorkforceAttendanceAction>
  biometricRequiredActions: ReadonlySet<WorkforceAttendanceAction>
}

/**
 * The small, safe part of an attendance policy a mobile client may display.
 * It deliberately contains requirements, not policy calculation data or an
 * authorization decision: every attendance event is still re-checked by the
 * server inside its transaction.
 */
export type WorkforceAttendancePolicyManifest = {
  enforcementVersion: 1
  qrRequiredActions: WorkforceAttendanceAction[]
  deviceTrustRequiredActions: WorkforceAttendanceAction[]
  biometricRequiredActions: WorkforceAttendanceAction[]
}

export const NO_WORKFORCE_ATTENDANCE_REQUIREMENTS: WorkforceAttendanceRequirements = {
  qrRequiredActions: new Set(),
  deviceTrustRequiredActions: new Set(),
  biometricRequiredActions: new Set(),
}

export class WorkforceAttendancePolicyError extends Error {
  constructor(
    readonly code: "WORKFORCE_ATTENDANCE_POLICY_INVALID",
    message = "Workforce attendance policy is invalid",
  ) {
    super(message)
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Returns null when a policy intentionally has no H5 attendance block.  A
 * malformed block is never silently downgraded to legacy behaviour: callers
 * must surface the invalid policy and keep server enforcement fail-closed.
 */
export function workforceAttendancePolicyManifest(
  definition: unknown,
): WorkforceAttendancePolicyManifest | null {
  const attendance = record(record(definition)?.attendance)
  if (!attendance) return null

  const parsed = WorkforceAttendancePolicySchema.safeParse(attendance)
  if (!parsed.success) {
    throw new WorkforceAttendancePolicyError(
      "WORKFORCE_ATTENDANCE_POLICY_INVALID",
      parsed.error.issues[0]?.message ?? "Workforce attendance policy is invalid",
    )
  }

  return {
    enforcementVersion: parsed.data.enforcementVersion,
    qrRequiredActions: [...(parsed.data.qr?.requiredActions ?? [])],
    deviceTrustRequiredActions: [...(parsed.data.deviceTrust?.requiredActions ?? [])],
    biometricRequiredActions: [...(parsed.data.deviceTrust?.biometricRequiredActions ?? [])],
  }
}

/**
 * Extracts only the explicit attendance contract from an immutable policy
 * definition.  Existing policy definitions that have no `attendance` object
 * retain the exact legacy behavior: no add-on requirement is inferred.
 */
export function workforceAttendanceRequirements(definition: unknown): WorkforceAttendanceRequirements {
  const manifest = workforceAttendancePolicyManifest(definition)
  if (!manifest) return NO_WORKFORCE_ATTENDANCE_REQUIREMENTS

  return {
    qrRequiredActions: new Set(manifest.qrRequiredActions),
    deviceTrustRequiredActions: new Set(manifest.deviceTrustRequiredActions),
    biometricRequiredActions: new Set(manifest.biometricRequiredActions),
  }
}
