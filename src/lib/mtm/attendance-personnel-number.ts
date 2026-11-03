import type { Prisma } from "@prisma/client"

/**
 * Personnel numbers are issued, not typed (owner, 2026-11-03: «нужно чтоб
 * автоматически присваивался уникальный номер… 500 сотрудников будут
 * заполнять разные кадровики, там будут ошибаться и в последовательности и в
 * повторении»; mockup approved with «Давай, делай»). Everyone in HR's list
 * gets the next number of the organization once, in the order they were
 * added, and keeps it — dismissed too. HR cannot change it.
 *
 * Numbers are four digits with leading zeros and simply grow past 9999. The
 * next one follows the largest all-digit number the organization has or has
 * issued, so a number typed by hand before 2026-11-03 (only digits) or held by
 * a card deleted since is never issued again; one with letters stays as it was
 * and is not counted.
 */
export const ATTENDANCE_PERSONNEL_NUMBER_DIGITS = 4
const ISSUED = "MTM_ATTENDANCE_PERSONNEL_NUMBER_ISSUED"

export function formatAttendancePersonnelNumber(value: number) {
  return String(value).padStart(ATTENDANCE_PERSONNEL_NUMBER_DIGITS, "0")
}

/**
 * Numbers the given cards that have none yet, oldest card first. One
 * organization-wide lock serializes every issuer, so two HR officers saving at
 * once get two numbers; the unique index (organization, number) is the last
 * word if anything else writes one.
 */
export async function issueAttendancePersonnelNumbers(tx: Prisma.TransactionClient, input: { organizationId: string; actorUserId: string | null; agentIds: readonly string[] }) {
  const issued = new Map<string, string>()
  if (!input.agentIds.length) return issued
  const { organizationId } = input
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-personnel-number:${organizationId}`}, 0))`
  // Read after the lock: a card numbered by the transaction that held it is not numbered twice.
  const cards = await tx.mtmAgent.findMany({ where: { organizationId, id: { in: [...input.agentIds] }, personnelNumber: null },
    select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
  if (!cards.length) return issued
  // The journal remembers numbers of cards deleted since: they are not issued again.
  const [{ last }] = await tx.$queryRaw<Array<{ last: bigint | number | null }>>`
    SELECT MAX(number::bigint) AS last FROM (
      SELECT "personnelNumber" AS number FROM mtm_agents WHERE "organizationId" = ${organizationId}
      UNION ALL
      SELECT "newData"->>'personnelNumber' FROM mtm_audit_logs WHERE "organizationId" = ${organizationId}
        AND "metadataKind" = 'mtm_attendance_employee_card' AND action = ${ISSUED}
    ) numbers WHERE number ~ '^[0-9]{1,15}$'`
  let next = Number(last ?? 0)
  for (const card of cards) {
    const personnelNumber = formatAttendancePersonnelNumber(++next)
    await tx.mtmAgent.update({ where: { organizationId, id: card.id }, data: { personnelNumber } })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: input.actorUserId, agentId: card.id, entity: "agent", entityId: card.id,
      action: ISSUED, metadataKind: "mtm_attendance_employee_card", oldData: { personnelNumber: null }, newData: { personnelNumber } } })
    issued.set(card.id, personnelNumber)
  }
  return issued
}
