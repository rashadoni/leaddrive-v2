import { Prisma } from "@prisma/client"

type VoicePermissionLockDb = Pick<Prisma.TransactionClient, "$executeRaw">
type VoiceLeadRowLockDb = Pick<Prisma.TransactionClient, "$queryRaw">

/**
 * Lock the tenant lead row before deriving its canonical phone or assignment.
 * Every dispatch and permission mutation follows the same order:
 * lead row first, then the phone advisory lock. This prevents stale-phone
 * dispatch and avoids a lead-row/phone-lock deadlock cycle.
 */
export async function lockVoiceLeadRow(
  db: VoiceLeadRowLockDb,
  organizationId: string,
  leadId: string,
): Promise<void> {
  await db.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "leads"
    WHERE "id" = ${leadId}
      AND "organizationId" = ${organizationId}
    FOR UPDATE
  `)
}

/**
 * Serializes the point where a phone becomes dispatching with the point where
 * a human changes that phone's voice-contact permission. Callers must acquire
 * this lock inside the same database transaction that rechecks permission and
 * durably marks the attempt dispatching (or writes the permission mutation).
 */
export async function lockVoiceContactPermission(
  db: VoicePermissionLockDb,
  organizationId: string,
  phoneE164: string,
): Promise<void> {
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`voice-contact-permission:${organizationId}:${phoneE164}`}, 0)
    )
  `
}
