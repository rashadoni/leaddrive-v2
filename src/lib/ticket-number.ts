import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

type TicketNumberClient = Prisma.TransactionClient | typeof prisma

function coerceMaxTicketNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number.parseInt(value, 10) || 0
  return 0
}

// Serializes ticket number reservation per organization when called inside the
// same transaction that creates the ticket.
export async function lockTicketNumberSequence(
  orgId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ticket-number:${orgId}`})::bigint)`
}

// Returns the next sequential ticketNumber in TK-0000 format, scoped per org.
// Use with lockTicketNumberSequence() inside the same create transaction for
// concurrent writers. The DB unique constraint remains the final guard.
export async function nextTicketNumber(
  orgId: string,
  tx?: Prisma.TransactionClient,
  prefix = "TK",
): Promise<string> {
  const client: TicketNumberClient = tx ?? prisma
  const rows = await client.$queryRaw<Array<{ max: bigint | number | string | null }>>`
    SELECT COALESCE(MAX(NULLIF(regexp_replace("ticketNumber", '\\D', '', 'g'), '')::bigint), 0) AS max
    FROM "tickets"
    WHERE "organizationId" = ${orgId}
  `
  const max = coerceMaxTicketNumber(rows[0]?.max)
  return formatTicketNumber(max + 1, prefix)
}

export function formatTicketNumber(n: number, prefix = "TK"): string {
  return `${prefix}-${String(n).padStart(4, "0")}`
}
