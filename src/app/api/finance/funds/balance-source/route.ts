import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit } from "@/lib/prisma"
import { readFundBalanceSource, writeFundBalanceSource } from "@/lib/finance/fund-balance-source"
import { withRlsAuth } from "@/lib/with-rls"

// The switch «Баланс из CRM / Kafka» of the Fund screen. Display only: see
// src/lib/finance/fund-balance-source.ts. Whoever may run the funds may flip
// it; organizations without the Kafka pilot get `available: false` and no switch.

export const GET = withRlsAuth("finance", "read", async (_req, auth) => {
  return NextResponse.json({ data: await readFundBalanceSource(auth.orgId) })
})

const body = z.object({ source: z.enum(["crm", "kafka"]) }).strict()

export const PUT = withRlsAuth("finance", "write", async (req, auth) => {
  let parsed
  try {
    parsed = body.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) return NextResponse.json({ error: "source must be crm or kafka" }, { status: 400 })
  const before = await readFundBalanceSource(auth.orgId)
  if (parsed.data.source === "kafka" && !before.available) {
    return NextResponse.json({ error: "Kafka balances are not available for this organization", code: "fund_kafka_unavailable" }, { status: 409 })
  }
  if (before.source !== parsed.data.source) {
    await writeFundBalanceSource(auth.orgId, parsed.data.source)
    await logAudit(auth.orgId, "finance_fund_balance_source_changed", "organization", auth.orgId, "Fund balance source", {
      userId: auth.userId,
      oldValue: { source: before.source },
      newValue: { source: parsed.data.source },
    })
  }
  return NextResponse.json({ data: await readFundBalanceSource(auth.orgId) })
})
