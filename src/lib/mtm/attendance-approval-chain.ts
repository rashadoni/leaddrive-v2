import type { Prisma } from "@prisma/client"

/**
 * «Manager first, then HR» — owner, 2026-10-21, after the HRSS clip
 * («əvvəl rəhbər, sonra HR təsdiqləyir»); off until the company ticks it in
 * Personnel → Settings → «Подтверждение заявок» (an MTM setting, so the
 * administrators-only settings route stores it).
 *
 * On: a manager's or supervisor's approval only passes the request on. It stays
 * PENDING, marked with who approved it, and HR — an administrator — makes the
 * decision that counts. A manager's rejection is final. An administrator
 * decides at any stage, so the request of an employee without a manager, or
 * whose manager is away, never waits for nobody.
 * Off: whoever may decide, decides once — as before the setting existed.
 * Pending requests follow the setting as it stands when they are decided.
 */
export const ATTENDANCE_TWO_STEP_SETTING_KEY = "attendanceTwoStepApproval"

/** True only for an explicit `true`: a missing row is the one-step default, as in `MTM_SETTING_DEFAULTS`. */
export async function readAttendanceTwoStepApproval(db: Pick<Prisma.TransactionClient, "mtmSetting">, organizationId: string): Promise<boolean> {
  const row = await db.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_TWO_STEP_SETTING_KEY } }, select: { value: true } })
  return row?.value === true
}
