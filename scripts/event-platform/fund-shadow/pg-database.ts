// FundShadowDatabase over one node-postgres connection, for the shadow pilot
// runner, which has no Prisma engine. Same contract as the Prisma adapter of
// the tests (src/__tests__/fixtures/fund-shadow-postgres.ts): a real
// SERIALIZABLE transaction that resolves only after COMMIT and rolls back on
// any callback or COMMIT error. The consumer casts every int8 and uuid it
// reads to text, so node-postgres and Prisma return the same values to it.
import type { Client } from "pg"
import type { FundShadowDatabase, FundShadowTransaction } from "../../../src/lib/event-platform/fund-shadow-consumer"

/** Fixed text: no SQL, parameter or server message enters it. */
export class PilotDatabaseError extends Error {
  readonly code = "FUND_SHADOW_PILOT_DATABASE"
  constructor() { super("FUND_SHADOW_PILOT_DATABASE"); this.name = "PilotDatabaseError" }
}

// node-postgres has no BigInt parameter encoding; the consumer passes offsets
// as decimal strings already, this only keeps a stray BigInt exact.
const parameter = (value: unknown) => (typeof value === "bigint" ? value.toString() : value)

export function pgFundShadowDatabase(client: Client): FundShadowDatabase {
  // One connection, one transaction at a time: the partition worker awaits each
  // record's COMMIT before the next. A second caller or an unknown connection
  // state after a failed ROLLBACK is refused rather than queued.
  let busy = false
  let broken = false
  return {
    async $transaction(work, options) {
      if (options?.isolationLevel !== "Serializable" || busy || broken) throw new PilotDatabaseError()
      busy = true
      let open = true
      const guard = () => { if (!open) throw new PilotDatabaseError() }
      const tx: FundShadowTransaction = {
        async $queryRawUnsafe<T>(query: string, ...values: unknown[]) {
          guard()
          return (await client.query(query, values.map(parameter))).rows as T
        },
        async $executeRawUnsafe(query: string, ...values: unknown[]) {
          guard()
          return (await client.query(query, values.map(parameter))).rowCount ?? 0
        },
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
        const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PilotDatabaseError()), options.timeout) })
        const result = await Promise.race([work(tx), expired])
        open = false
        await client.query("COMMIT")
        return result
      } catch {
        open = false
        // A statement still running after the timeout is queued ahead of the
        // ROLLBACK on this connection; the server ends the transaction either way.
        try { await client.query("ROLLBACK") } catch { broken = true }
        throw new PilotDatabaseError()
      } finally {
        if (timer) clearTimeout(timer)
        busy = false
      }
    },
  }
}
