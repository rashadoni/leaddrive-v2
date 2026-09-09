/**
 * D4 Subscriptions — slice-2 API.
 *
 * GET /api/v1/subscriptions-overview
 *
 * Three streams in one response:
 *   1. Status KPIs + MRR approximation (active rows only, currency-grouped)
 *   2. Trials ending in next 7 days (sorted by trialEndsAt asc)
 *   3. Past-due subscriptions (sorted by nextBillingAt asc — oldest first)
 *
 * Sort within KPI/by-plan: count desc.
 *
 * MRR approximation: sum of (active subscription unitAmount normalised
 * to monthly), grouped by currency. Slice-2 cron worker writes the
 * canonical MRR snapshot into a dedicated table; today we compute
 * on-the-fly from active rows.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

interface SubRow {
  id: string
  planId: string
  companyId: string | null
  contactId: string | null
  status: string
  trialEndsAt: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  nextBillingAt: Date | null
  cancelledAt: Date | null
  cancelAtPeriodEnd: boolean
  currency: string
  unitAmount: unknown
  billingInterval: string
  billingIntervalCount: number
  createdAt: Date
  updatedAt: Date
  plan: { name: string } | null
}

interface CompanyMini {
  id: string
  name: string
}

interface ContactMini {
  id: string
  fullName: string | null
  email: string | null
}

const TRIAL_WINDOW_DAYS = 7
const FETCH_CAP = 500

// Normalise per-period unitAmount to a monthly figure for MRR.
// Days × interval-multiplier → monthly equivalent.
const INTERVAL_TO_MONTH_FACTOR: Record<string, number> = {
  day: 30,
  week: 30 / 7,
  month: 1,
  year: 1 / 12,
}

function toMonthly(unitAmount: number, interval: string, count: number): number {
  const f = INTERVAL_TO_MONTH_FACTOR[interval]
  if (!f || !Number.isFinite(unitAmount) || unitAmount < 0 || count <= 0) {
    return 0
  }
  return (unitAmount * f) / count
}

function describeContact(c: ContactMini | undefined): string | null {
  if (!c) return null
  return c.fullName?.trim() || c.email || null
}

export const GET = withRls(async (_req, { orgId }) => {

  try {
    // NOTE: Subscription has companyId/contactId as plain String fields
    // but no `company`/`contact` Prisma relations declared in the schema.
    // We therefore can't `include`/`select` them — fetch by id separately
    // and bucket client-side. Earlier shipped slice-2 used selects that
    // crashed at runtime; this is the fix-forward.
    const subs = (await prisma.subscription.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        planId: true,
        companyId: true,
        contactId: true,
        status: true,
        trialEndsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        nextBillingAt: true,
        cancelledAt: true,
        cancelAtPeriodEnd: true,
        currency: true,
        unitAmount: true,
        billingInterval: true,
        billingIntervalCount: true,
        createdAt: true,
        updatedAt: true,
        plan: { select: { name: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: FETCH_CAP + 1,
    })) as SubRow[]
    const truncated = subs.length > FETCH_CAP
    if (truncated) subs.length = FETCH_CAP

    // Look up companies + contacts referenced by the subscriptions in
    // one round trip each, bucket by id.
    const companyIds = Array.from(
      new Set(subs.map((s) => s.companyId).filter((v): v is string => !!v)),
    )
    const contactIds = Array.from(
      new Set(subs.map((s) => s.contactId).filter((v): v is string => !!v)),
    )
    const companies = (companyIds.length
      ? await prisma.company.findMany({
          where: { organizationId: orgId, id: { in: companyIds } },
          select: { id: true, name: true },
        })
      : []) as CompanyMini[]
    const contacts = (contactIds.length
      ? await prisma.contact.findMany({
          where: { organizationId: orgId, id: { in: contactIds } },
          select: { id: true, fullName: true, email: true },
        })
      : []) as ContactMini[]
    const companyById = new Map(companies.map((c) => [c.id, c]))
    const contactById = new Map(contacts.map((c) => [c.id, c]))

    const statusCounts = {
      active: 0,
      trial: 0,
      past_due: 0,
      paused: 0,
      cancelled: 0,
    } as Record<string, number>

    // Currency-keyed MRR. We DO NOT collapse to a single dollar number —
    // mixing USD + EUR + AZN as one figure is misleading.
    const mrrByCurrency = new Map<string, number>()
    const planBuckets = new Map<
      string,
      { planId: string; planName: string; count: number; mrrByCurrency: Map<string, number> }
    >()

    const now = new Date()
    const trialCutoff = new Date(now.getTime() + TRIAL_WINDOW_DAYS * 86_400_000)

    const trialsEndingSoon: typeof subs = []
    const pastDue: typeof subs = []

    for (const s of subs) {
      if (s.status in statusCounts) statusCounts[s.status]++
      if (s.status === "active") {
        const monthly = toMonthly(decimalToNumber(s.unitAmount), s.billingInterval, s.billingIntervalCount)
        mrrByCurrency.set(s.currency, (mrrByCurrency.get(s.currency) ?? 0) + monthly)
        const bucket = planBuckets.get(s.planId) ?? {
          planId: s.planId,
          planName: s.plan?.name ?? "Unknown plan",
          count: 0,
          mrrByCurrency: new Map<string, number>(),
        }
        bucket.count++
        bucket.mrrByCurrency.set(
          s.currency,
          (bucket.mrrByCurrency.get(s.currency) ?? 0) + monthly,
        )
        planBuckets.set(s.planId, bucket)
      }
      if (
        s.status === "trial" &&
        s.trialEndsAt !== null &&
        s.trialEndsAt >= now &&
        s.trialEndsAt <= trialCutoff
      ) {
        trialsEndingSoon.push(s)
      }
      if (s.status === "past_due") {
        pastDue.push(s)
      }
    }

    trialsEndingSoon.sort(
      (a, b) =>
        (a.trialEndsAt?.getTime() ?? Infinity) -
        (b.trialEndsAt?.getTime() ?? Infinity),
    )
    pastDue.sort(
      (a, b) =>
        (a.nextBillingAt?.getTime() ?? Infinity) -
        (b.nextBillingAt?.getTime() ?? Infinity),
    )

    const mrrCurrencyTotals = Array.from(mrrByCurrency.entries())
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => b.total - a.total)
    const dominantMrr = mrrCurrencyTotals[0] ?? { currency: "USD", total: 0 }

    const planList = Array.from(planBuckets.values())
      .map((p) => ({
        planId: p.planId,
        planName: p.planName,
        activeCount: p.count,
        mrrByCurrency: Array.from(p.mrrByCurrency.entries()).map(
          ([currency, total]) => ({ currency, total }),
        ),
      }))
      .sort((a, b) => {
        if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount
        return a.planName.localeCompare(b.planName)
      })

    function shape(s: SubRow) {
      const company = s.companyId ? companyById.get(s.companyId) : undefined
      const contact = s.contactId ? contactById.get(s.contactId) : undefined
      return {
        id: s.id,
        planId: s.planId,
        planName: s.plan?.name ?? "Unknown plan",
        companyName: company?.name ?? null,
        contactName: describeContact(contact),
        status: s.status,
        trialEndsAt: s.trialEndsAt,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        nextBillingAt: s.nextBillingAt,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        currency: s.currency,
        unitAmount: decimalToNumber(s.unitAmount),
        billingInterval: s.billingInterval,
        billingIntervalCount: s.billingIntervalCount,
      }
    }

    return NextResponse.json({
      statusCounts,
      mrrCurrencyTotals,
      dominantMrr,
      planList,
      trialsEndingSoon: trialsEndingSoon.map(shape),
      pastDue: pastDue.map(shape),
      trialWindowDays: TRIAL_WINDOW_DAYS,
      totalSubscriptions: subs.length,
      truncated,
      fetchCap: FETCH_CAP,
    })
  } catch (err) {
    console.error("[subscriptions-overview] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load subscriptions overview" },
      { status: 500 },
    )
  }
})
