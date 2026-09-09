/**
 * Backfill AccountIntentSignals from historical ContactEvents (C5 Phase 2).
 *
 * Walks the marketing-relevant ContactEvents in a window, resolves each to a
 * tracked MarketingAccount (Contact → Company → MarketingAccount) and records
 * an AccountIntentSignal. Reuses the SAME recorder as the live hook, so there
 * is no logic drift. Idempotent — safe to re-run (dedupes by account+kind+
 * time+contact).
 *
 * Run on the server (cross-tenant bypass via makeScriptPrisma):
 *   npx tsx scripts/backfill-account-intent-signals.ts                 # all orgs, last 90d
 *   npx tsx scripts/backfill-account-intent-signals.ts --slug=leaddrive
 *   npx tsx scripts/backfill-account-intent-signals.ts --days=365 --dry-run
 *
 * Only matters for companies already promoted to MarketingAccounts (Phase 1);
 * events for untracked companies are counted as "not_tracked" and skipped.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import {
  recordAccountIntentSignal,
  INTENT_EVENT_TYPES,
  type SignalClient,
} from "../src/lib/account-engagement/contact-event-signal"

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

let prisma!: PrismaClient

async function main() {
  const slug = arg("slug")
  const days = Math.max(1, Number(arg("days") ?? "90"))
  const dryRun = hasFlag("dry-run")

  prisma = await makeScriptPrisma() // connection-level RLS bypass (cross-tenant)

  let orgId: string | undefined
  if (slug) {
    const org = await prisma.organization.findFirst({
      where: { slug },
      select: { id: true, name: true },
    })
    if (!org) {
      console.error(`[backfill] organization with slug "${slug}" not found`)
      process.exit(1)
    }
    orgId = org.id
    console.log(`[backfill] org: ${org.name} (${org.id})`)
  } else {
    console.log(`[backfill] ALL organizations`)
  }

  const since = new Date(Date.now() - days * 86_400_000)
  const where: {
    eventType: { in: string[] }
    createdAt: { gte: Date }
    organizationId?: string
  } = {
    eventType: { in: [...INTENT_EVENT_TYPES] },
    createdAt: { gte: since },
  }
  if (orgId) where.organizationId = orgId

  const events = (await prisma.contactEvent.findMany({
    where,
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      eventType: true,
      createdAt: true,
      eventData: true,
    },
    orderBy: { createdAt: "asc" },
  })) as Array<{
    id: string
    organizationId: string
    contactId: string
    eventType: string
    createdAt: Date
    eventData: unknown
  }>

  console.log(
    `[backfill] ${events.length} candidate event(s) in the last ${days}d ` +
      `(types: ${INTENT_EVENT_TYPES.join(", ")})`,
  )

  if (dryRun) {
    const byType = new Map<string, number>()
    for (const e of events) byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1)
    console.log("[backfill] DRY RUN — no writes. Candidate breakdown by eventType:")
    for (const [t, n] of byType) console.log(`  ${t}: ${n}`)
    return
  }

  const tally = {
    recorded: 0,
    not_intent: 0,
    no_company: 0,
    not_tracked: 0,
    duplicate: 0,
    errors: 0,
  }

  for (const ev of events) {
    try {
      const data = ev.eventData as { url?: unknown; resourceRef?: unknown } | null
      const resourceRef =
        typeof data?.url === "string"
          ? data.url
          : typeof data?.resourceRef === "string"
            ? data.resourceRef
            : null
      const res = await recordAccountIntentSignal(
        {
          organizationId: ev.organizationId,
          contactId: ev.contactId,
          eventType: ev.eventType,
          occurredAt: ev.createdAt,
          resourceRef,
        },
        prisma as unknown as SignalClient,
      )
      if (res.recorded) tally.recorded++
      else tally[res.reason]++
    } catch (e) {
      tally.errors++
      console.error(`[backfill] error for event ${ev.id}:`, e)
    }
  }

  console.log(
    `[backfill] done — recorded=${tally.recorded} duplicate=${tally.duplicate} ` +
      `not_tracked=${tally.not_tracked} no_company=${tally.no_company} ` +
      `not_intent=${tally.not_intent} errors=${tally.errors}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())
