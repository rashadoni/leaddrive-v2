import { Prisma } from "@prisma/client"

/**
 * The organization switch "Workday attendance". It is stored as the MTM setting
 * below today; stage 2c of docs/mtm-attendance/roadmap-personnel.md moves its
 * control to Personnel → Settings. This file is the only server code that names
 * where it lives — `attendance-feature.test.ts` fails on a new direct read.
 */
export const ATTENDANCE_FEATURE_SETTING_KEY = "attendanceEnabled"

type FeatureDb = Pick<Prisma.TransactionClient, "mtmSetting" | "$queryRaw">

/** Takes the shared row lock a concurrent disable waits for (the switch's PUT holds it exclusively). */
export async function lockAttendanceFeature(db: Pick<Prisma.TransactionClient, "$queryRaw">, organizationId: string) {
  await db.$queryRaw`SELECT "id" FROM "mtm_settings" WHERE "organizationId" = ${organizationId} AND "key" = 'attendanceEnabled' FOR SHARE`
}

/** True only for an explicit `true`: a missing row is "off", as in `MTM_SETTING_DEFAULTS`. */
export async function readAttendanceFeature(db: FeatureDb, organizationId: string, options: { lock?: boolean } = {}): Promise<boolean> {
  if (options.lock) await lockAttendanceFeature(db, organizationId)
  const row = await db.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_FEATURE_SETTING_KEY } }, select: { value: true } })
  return row?.value === true
}

/** The same rule inside a raw query; `organizationId` is a bound value or a column such as `Prisma.raw('a."organizationId"')`. */
export function attendanceFeatureOnSql(organizationId: Prisma.Sql | string): Prisma.Sql {
  return Prisma.sql`EXISTS(SELECT 1 FROM mtm_settings s WHERE s."organizationId"=${organizationId} AND s.key='attendanceEnabled' AND s.value='true'::jsonb)`
}
