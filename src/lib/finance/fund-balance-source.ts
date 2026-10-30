import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { FUND_BALANCE_SOURCE_SETTING as SETTING, FUND_BALANCE_SOURCE_SQL as SOURCE_SQL, KAFKA_FUND_BALANCES_SQL } from "./fund-balance-source-sql"

/**
 * Where the Fund screens take a fund's balance from: the CRM column
 * (`funds.currentBalance`) or the Kafka shadow build of the Fund pilot.
 *
 * Owner 2026-10-26: «Да, начинай перевод Fund на Kafka с LeadDrive Inc.:
 * показывать балансы её фондов из Kafka, с возвратом одной кнопкой», and the
 * approved mockup (one switch «Баланс из CRM / Kafka», the source on every
 * card). Display only: fund commands still check `funds.currentBalance`, the
 * shadow build is never promoted, and the switch back is immediate.
 *
 * A Kafka balance is shown only when the shadow has folded the fund's latest
 * event (its version equals the fund's event head) in the fund's currency;
 * otherwise the CRM balance is shown and the card says Kafka is catching up.
 * So the screen never shows a balance the CRM has already moved past.
 */
export type FundBalanceSource = "crm" | "kafka"
export type FundBalanceOrigin = "kafka" | "kafka-catching-up" | "crm"

type Query = (sql: string, ...values: unknown[]) => Promise<unknown>
const query: Query = (sql, ...values) => prisma.$queryRawUnsafe(sql, ...values)

export async function readFundBalanceSource(orgId: string, run: Query = query): Promise<{ available: boolean; source: FundBalanceSource }> {
  const rows = await run(SOURCE_SQL, orgId)
  const row = Array.isArray(rows) ? rows[0] as { source: string | null; available: boolean } | undefined : undefined
  const available = row?.available === true
  return { available, source: available && row?.source === "kafka" ? "kafka" : "crm" }
}

export async function writeFundBalanceSource(orgId: string, source: FundBalanceSource): Promise<void> {
  // One key, set in place: the rest of settings is other screens' and must
  // not be read and written back around it.
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{${SETTING}}', to_jsonb($2::text)) WHERE id = $1`,
    orgId, source,
  )
}

export async function kafkaFundBalances(orgId: string, run: Query = query): Promise<Map<string, { fresh: boolean; balance: string | null }>> {
  const rows = await run(KAFKA_FUND_BALANCES_SQL, orgId)
  const out = new Map<string, { fresh: boolean; balance: string | null }>()
  for (const row of Array.isArray(rows) ? rows as Array<{ fundId: string; balance: string | null; fresh: boolean }> : []) {
    out.set(row.fundId, { fresh: row.fresh === true && row.balance !== null, balance: row.balance })
  }
  return out
}

/**
 * The normalized fund row with its balance taken from Kafka where current.
 * `balanceSource` tells the card which number it shows.
 */
export function withBalanceOrigin<T extends { currentBalance: number; currentBalanceExact: string }>(
  fund: T,
  source: FundBalanceSource,
  kafka: Map<string, { fresh: boolean; balance: string | null }>,
): T & { balanceSource: FundBalanceOrigin } {
  if (source !== "kafka") return { ...fund, balanceSource: "crm" }
  // The row comes from the untyped `prisma` client: its id is read, not assumed.
  const id = (fund as { id?: unknown }).id
  const shadow = typeof id === "string" ? kafka.get(id) : undefined
  if (!shadow) return { ...fund, balanceSource: "crm" } // no event history: nothing in Kafka for it
  if (!shadow.fresh || shadow.balance === null) return { ...fund, balanceSource: "kafka-catching-up" }
  // numeric(18,4) as text: exact, never through a float on the way.
  const exact = new Prisma.Decimal(shadow.balance).toFixed(4)
  return { ...fund, currentBalance: Number(exact), currentBalanceExact: exact, balanceSource: "kafka" }
}
