/**
 * Structural transaction shape used by the receiver runtime. Kept to raw,
 * positional-parameter SQL (never string interpolation of values) so the
 * PostgreSQL proof can run the exact same code with any Prisma client.
 */
export interface ReceiverSqlTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

/**
 * One tenant-scoped interactive transaction. The production implementation is
 * `runWithTenant(org, () => prisma.$transaction(...))`, which sets app.org_id
 * for FORCE RLS; tests use the same contract with an unprivileged role.
 */
export interface ReceiverDatabase<Tx extends ReceiverSqlTransaction = ReceiverSqlTransaction> {
  tenant<T>(organizationId: string, work: (tx: Tx) => Promise<T>): Promise<T>
}

/**
 * Effect-ledger triggers compare naive UTC columns with CURRENT_TIMESTAMP, so
 * every runtime transaction pins its own TimeZone to UTC first. Without this a
 * server/session zone such as Europe/Berlin shifts lease expiry by hours.
 */
export async function pinUtc(tx: ReceiverSqlTransaction) {
  await tx.$queryRawUnsafe(`SELECT set_config('TimeZone', 'UTC', true)`)
}

export const UTC_NOW = `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`
