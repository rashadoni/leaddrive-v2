/**
 * Renewing a contract (owner 2026-11-26, mock «Продление», «Давай»). Until then renewal was not
 * closed end to end: an alert in the bell of every admin and manager, no «Продлить», no link from
 * the old contract to the new one, «renewing» and «renewed» never written, the renewal rate in the
 * analytics always 0 %.
 *
 *  - «Продлить» (active or renewing, or an expired one) makes a DRAFT: the same parties, type,
 *    currency, template and text, the new dates and amount, `renewalSourceContractId` → the old one.
 *    It is approved and signed like any contract. An active source becomes «Продлевается».
 *  - When the renewal becomes active (e-sign or paper), the source in force becomes «Продлён» and
 *    its reminders stop. An expired source stays expired (a closed state).
 *  - A renewal draft cancelled or deleted gives the source back: «Продлевается» → «Активный».
 *  - One open renewal at a time (a rejected one counts — it may come back): a second press names the first.
 *
 * The pure part is here; the transaction helpers take the caller's transaction.
 */
import type { Prisma } from "@prisma/client"

export const RENEWABLE_STATUSES = ["active", "renewing", "expired"] as const
/**
 * Statuses of a renewal that still counts as «open» — it may yet take effect. A rejected one does:
 * «Вернуть в черновик» brings it back; it is deleted to let the source go.
 */
export const OPEN_RENEWAL_STATUSES = ["draft", "pending_approval", "approved", "rejected"] as const
export const RENEWAL_BANNER_DAYS = 90

const DAY_MS = 86_400_000

export function isRenewable(status: string): boolean {
  return (RENEWABLE_STATUSES as readonly string[]).includes(status)
}

/** The day before `start` plus `months` whole months (a day past the month's end is its last day). */
function lastDayOfMonths(start: Date, months: number): Date {
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1))
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const sameDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(start.getUTCDate(), daysInMonth))
  return new Date(sameDay - DAY_MS)
}

/**
 * The renewal's default dates: it starts the day after the old one's last day and lasts as long —
 * in whole months when the old one was whole months (a year stays a year across a 29 February), in
 * days otherwise; without dates, a year. Contract dates are calendar days at 00:00 UTC.
 */
export function renewalDefaults(
  contract: { startDate: Date | string | null; endDate: Date | string | null },
  now: Date = new Date(),
): { startDate: string; endDate: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const end = contract.endDate ? new Date(contract.endDate) : null
  const start = end ? new Date(end.getTime() + DAY_MS) : todayUtc
  const oldStart = contract.startDate ? new Date(contract.startDate) : null
  if (end && oldStart && end.getTime() >= oldStart.getTime()) {
    if (start.getUTCDate() === oldStart.getUTCDate()) {
      const months = (start.getUTCFullYear() - oldStart.getUTCFullYear()) * 12 + start.getUTCMonth() - oldStart.getUTCMonth()
      if (months > 0) return { startDate: day(start), endDate: day(lastDayOfMonths(start, months)) }
    }
    const lengthDays = Math.round((end.getTime() - oldStart.getTime()) / DAY_MS)
    return { startDate: day(start), endDate: day(new Date(start.getTime() + lengthDays * DAY_MS)) }
  }
  return { startDate: day(start), endDate: day(lastDayOfMonths(start, 12)) }
}

/** The new contract's number: «<old>/<year it starts>», made free by the caller. */
export function renewalNumberBase(oldNumber: string, startDate: string): string {
  return `${oldNumber}/${startDate.slice(0, 4)}`
}

/** Days until a contract's last day (its whole last day counts), or null without an end date. */
export function daysUntilEnd(endDate: Date | string | null, now: Date = new Date()): number | null {
  if (!endDate) return null
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((new Date(endDate).getTime() - todayUtc) / DAY_MS)
}

/**
 * Inside the caller's transaction, after `contractId` became active: if it renews another contract
 * still in force, that one is «Продлён» now and its reminders stop. Returns the source's id when moved.
 */
export async function completeRenewalSource(
  tx: Prisma.TransactionClient,
  input: { orgId: string; contractId: string },
): Promise<string | null> {
  const renewal = await tx.contract.findFirst({
    where: { id: input.contractId, organizationId: input.orgId },
    select: { renewalSourceContractId: true },
  })
  const sourceId = renewal?.renewalSourceContractId
  if (!sourceId) return null
  const moved = await tx.contract.updateMany({
    where: { id: sourceId, organizationId: input.orgId, status: { in: ["active", "renewing"] } },
    data: { status: "renewed" },
  })
  if (moved.count !== 1) return null
  await tx.contractRenewalAlert.updateMany({
    where: { contractId: sourceId, organizationId: input.orgId, status: "pending" },
    data: { status: "superseded" },
  })
  return sourceId
}

/**
 * Inside the caller's transaction, when the renewal `contractId` is cancelled or deleted: its
 * source, «Продлевается» only because of it, is «Активный» again — unless another renewal is open.
 */
export async function releaseRenewalSource(
  tx: Prisma.TransactionClient,
  input: { orgId: string; contractId: string; sourceId: string | null },
): Promise<boolean> {
  if (!input.sourceId) return false
  const otherOpen = await tx.contract.count({
    where: {
      organizationId: input.orgId,
      renewalSourceContractId: input.sourceId,
      id: { not: input.contractId },
      status: { in: [...OPEN_RENEWAL_STATUSES] },
    },
  })
  if (otherOpen > 0) return false
  const moved = await tx.contract.updateMany({
    where: { id: input.sourceId, organizationId: input.orgId, status: "renewing" },
    data: { status: "active" },
  })
  return moved.count === 1
}
