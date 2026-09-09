/**
 * G3 Calculated Insights — shared per-org aggregate computation.
 *
 * Extracted from the GET /api/v1/calculated-insights route so the read API
 * and the daily snapshot cron compute the headline KPIs (totalProfiles,
 * dominantLtv, highRiskCount, avgEngagement) through the SAME code path. If
 * the two ever diverged, the trend/sparkline on a KPI card would contradict
 * its live value — this module is the single source of truth.
 *
 * Pure data: takes an orgId, reads UnifiedProfile + paid invoices, runs the
 * slice-1 calculators on-the-fly, and returns the list + aggregates. No
 * request/response coupling — the route wraps it in an HTTP envelope, the cron
 * reads only the aggregate fields.
 */
import { prisma } from "@/lib/prisma"
import { calculateLtv } from "@/lib/calculated-insights/ltv-calculator"
import { calculateChurnRisk } from "@/lib/calculated-insights/churn-risk-calculator"
import { calculateEngagementScore } from "@/lib/calculated-insights/engagement-score-calculator"
import { calculateDaysSinceLastPurchase } from "@/lib/calculated-insights/days-since-last-purchase"
import type { CalculatorInput } from "@/lib/calculated-insights/types"
import { decimalToNumber } from "@/lib/prisma-decimal"
import {
  buildInvoiceLinkMaps,
  linkIds,
  resolveInvoiceProfileId,
} from "@/lib/unified-profile/invoice-link"

interface ProfileRow {
  id: string
  emailNormalized: string | null
  phoneNormalized: string | null
  displayEmail: string | null
  displayPhone: string | null
  displayName: string | null
  primaryContactId: string | null
  primaryCompanyId: string | null
  totalSpent: number
  lifetimeOrderCount: number
  lastSeenAt: Date | null
  firstSeenAt: Date | null
  channelsActive: string[]
  primaryCurrency: string | null
  lastRefreshedAt: Date | null
  sources: Array<{ sourceType: string; sourceId: string }>
}

interface InvoiceRow {
  contactId: string | null
  companyId: string | null
  paidAt: Date | null
  totalAmount: unknown // Decimal(18,4) from Prisma — use decimalToNumber() before arithmetic
  currency: string
}

export interface CurrencyTotal {
  currency: string
  total: number
}

export interface InsightValue {
  value: number
  confidence: number
}

export interface ProfileInsight {
  id: string
  displayName: string
  displayEmail: string | null
  displayPhone: string | null
  primaryContactId: string | null
  primaryCompanyId: string | null
  totalSpent: number
  lifetimeOrderCount: number
  primaryCurrency: string | null
  lastSeenAt: Date | null
  firstSeenAt: Date | null
  channelsActive: string[]
  lastRefreshedAt: Date | null
  insights: {
    ltv: InsightValue
    churnRisk: InsightValue
    engagement: InsightValue
    daysSinceLastPurchase: InsightValue
  }
  isStalePriority: boolean
}

export interface OrgInsightsData {
  items: ProfileInsight[]
  totalItems: number
  totalProfiles: number
  highRiskCount: number
  avgEngagement: number
  ltvCurrencyTotals: CurrencyTotal[]
  dominantLtv: CurrencyTotal
  truncated: boolean
}

export const FETCH_CAP = 200

// Stale-priority thresholds — high LTV + high churn risk → "save call".
// Hoisted so the page footer copy and the API logic don't drift apart;
// slice-2 cron will likely tune these from per-tenant config.
export const STALE_PRIORITY_LTV_FLOOR = 500
export const STALE_PRIORITY_CHURN_FLOOR = 0.6

// Base-currency fallback when a profile has no primaryCurrency. MUST be the
// SAME value for the per-profile invoice currency-filter AND the headline LTV
// bucketing — otherwise a null-currency profile is bucketed under a different
// currency than its invoices were filtered by, and that disagreement gets
// frozen into a persisted snapshot (dominantCurrency ≠ cohort's actual money).
const FALLBACK_CURRENCY = "AZN"

const EMPTY: OrgInsightsData = {
  items: [],
  totalItems: 0,
  totalProfiles: 0,
  highRiskCount: 0,
  avgEngagement: 0,
  ltvCurrencyTotals: [],
  dominantLtv: { currency: FALLBACK_CURRENCY, total: 0 },
  truncated: false,
}

/**
 * Compute the Customer Insights list + aggregates for one org.
 *
 * `limit` caps the per-profile list (top spenders); aggregates other than
 * totalProfiles are computed over that capped cohort — identical to what the
 * KPI cards display, which is exactly why the cron must call this with the
 * same limit the UI uses (50) so snapshots match the live numbers.
 */
export async function computeOrgInsights(
  organizationId: string,
  opts: { limit: number },
): Promise<OrgInsightsData> {
  const { limit } = opts

  const profiles = (await prisma.unifiedProfile.findMany({
    where: { organizationId },
    select: {
      id: true,
      emailNormalized: true,
      phoneNormalized: true,
      displayEmail: true,
      displayPhone: true,
      displayName: true,
      primaryContactId: true,
      primaryCompanyId: true,
      totalSpent: true,
      lifetimeOrderCount: true,
      lastSeenAt: true,
      firstSeenAt: true,
      channelsActive: true,
      primaryCurrency: true,
      lastRefreshedAt: true,
      sources: { select: { sourceType: true, sourceId: true } },
    },
    orderBy: [{ totalSpent: "desc" }, { lifetimeOrderCount: "desc" }],
    take: limit + 1,
  })) as ProfileRow[]
  const truncated = profiles.length > limit
  if (truncated) profiles.length = limit

  // True total — the list is capped at `limit`, so totalItems (page size) is
  // NOT the real count. totalProfiles is what the KPI should show.
  const totalProfiles = await prisma.unifiedProfile.count({ where: { organizationId } })

  if (profiles.length === 0) {
    return { ...EMPTY, totalProfiles }
  }

  // Pull paid invoices for these profiles. Invoice has no direct
  // unifiedProfileId; the link is via contact / company. buildInvoiceLinkMaps
  // unions primaryContactId with EVERY contact-type source so a profile merged
  // from multiple contacts collects all their invoices — shared with the
  // materializer's Phase B so read + write attribute spend identically.
  const maps = buildInvoiceLinkMaps(profiles)
  const { contactIds, companyIds } = linkIds(maps)

  const invoiceWhere = {
    organizationId,
    status: "paid",
    paidAt: { not: null },
  }
  const orFilters: Array<{ contactId?: { in: string[] }; companyId?: { in: string[] } }> = []
  if (contactIds.length > 0) orFilters.push({ contactId: { in: contactIds } })
  if (companyIds.length > 0) orFilters.push({ companyId: { in: companyIds } })

  const invoices: InvoiceRow[] =
    orFilters.length === 0
      ? []
      : ((await prisma.invoice.findMany({
          where: { ...invoiceWhere, OR: orFilters },
          select: {
            contactId: true,
            companyId: true,
            paidAt: true,
            totalAmount: true,
            currency: true,
          },
          orderBy: [{ paidAt: "asc" }],
        })) as InvoiceRow[])

  const invoicesByProfile = new Map<string, InvoiceRow[]>()
  for (const inv of invoices) {
    // Contact-mapped wins over company-mapped (no double-count) and falls
    // through to company when the contact doesn't map — see invoice-link.ts.
    const profileId = resolveInvoiceProfileId(inv, maps)
    if (!profileId) continue
    const arr = invoicesByProfile.get(profileId) ?? []
    arr.push(inv)
    invoicesByProfile.set(profileId, arr)
  }

  const items = profiles.map((p) => {
    const inv = invoicesByProfile.get(p.id) ?? []
    const allInvoices = inv
      .map((i) => ({ paidAt: i.paidAt, totalAmount: decimalToNumber(i.totalAmount), currency: i.currency }))
      .filter((i) => i.paidAt !== null && Number.isFinite(i.totalAmount))
      .map((i) => ({ paidAt: i.paidAt as Date, totalAmount: i.totalAmount, currency: i.currency }))

    // LTV must sum ONE currency — the profile's primaryCurrency — to match the
    // materialized `totalSpent` and avoid summing AZN+USD into a meaningless
    // scalar. Churn / engagement / days-since are currency-agnostic (order
    // timing + count), so they keep ALL paid orders regardless of currency.
    const profCurrency = p.primaryCurrency ?? FALLBACK_CURRENCY
    const ltvInvoices = allInvoices.filter((i) => i.currency === profCurrency)

    const baseProfile: CalculatorInput["profile"] = {
      totalSpent: p.totalSpent,
      lifetimeOrderCount: p.lifetimeOrderCount,
      firstSeenAt: p.firstSeenAt,
      lastSeenAt: p.lastSeenAt,
      channelsActive: p.channelsActive,
    }
    const ltv = calculateLtv({ profile: baseProfile, invoices: ltvInvoices })
    const churn = calculateChurnRisk({ profile: baseProfile, invoices: allInvoices })
    const engagement = calculateEngagementScore({ profile: baseProfile, invoices: allInvoices })
    const daysSince = calculateDaysSinceLastPurchase({ profile: baseProfile, invoices: allInvoices })

    // Stale-priority: high LTV AND high churn risk — the customers
    // most worth a save call. Thresholds at module top.
    const isStalePriority =
      ltv.value >= STALE_PRIORITY_LTV_FLOOR &&
      churn.value >= STALE_PRIORITY_CHURN_FLOOR

    return {
      id: p.id,
      displayName:
        p.displayName ?? p.displayEmail ?? p.displayPhone ?? "Unknown profile",
      displayEmail: p.displayEmail,
      displayPhone: p.displayPhone,
      primaryContactId: p.primaryContactId,
      primaryCompanyId: p.primaryCompanyId,
      totalSpent: p.totalSpent,
      lifetimeOrderCount: p.lifetimeOrderCount,
      primaryCurrency: p.primaryCurrency,
      lastSeenAt: p.lastSeenAt,
      firstSeenAt: p.firstSeenAt,
      channelsActive: p.channelsActive,
      lastRefreshedAt: p.lastRefreshedAt,
      insights: {
        ltv: { value: ltv.value, confidence: ltv.confidence },
        churnRisk: { value: churn.value, confidence: churn.confidence },
        engagement: {
          value: engagement.value,
          confidence: engagement.confidence,
        },
        daysSinceLastPurchase: {
          value: daysSince.value,
          confidence: daysSince.confidence,
        },
      },
      isStalePriority,
    }
  })

  // Stale-priority bubbles to top; then by LTV desc.
  items.sort((a, b) => {
    if (a.isStalePriority !== b.isStalePriority) return a.isStalePriority ? -1 : 1
    return b.insights.ltv.value - a.insights.ltv.value
  })

  // Currency-grouped LTV total. Mixing currencies into one number is
  // misleading (USD + AZN summed as "$X"), so we report per-currency
  // and pick the dominant one as the headline value.
  // Invoice.totalAmount is now Decimal(18,4) — drift resolved.
  const ltvByCurrency = new Map<string, number>()
  for (const i of items) {
    const c = i.primaryCurrency ?? FALLBACK_CURRENCY
    ltvByCurrency.set(c, (ltvByCurrency.get(c) ?? 0) + i.insights.ltv.value)
  }
  const ltvCurrencyTotals = Array.from(ltvByCurrency.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
  const dominantLtv = ltvCurrencyTotals[0] ?? { currency: FALLBACK_CURRENCY, total: 0 }

  const highRiskCount = items.filter(
    (i) => i.insights.churnRisk.value >= STALE_PRIORITY_CHURN_FLOOR,
  ).length
  const avgEngagement =
    items.length > 0
      ? items.reduce((s, i) => s + i.insights.engagement.value, 0) / items.length
      : 0

  return {
    items,
    totalItems: items.length,
    totalProfiles,
    highRiskCount,
    avgEngagement,
    ltvCurrencyTotals,
    dominantLtv,
    truncated,
  }
}

// ── KPI trends (slice-2) ──────────────────────────────────────────────────
//
// Read the recent daily snapshots (written by the cron) and derive, per KPI,
// the series for a sparkline + the day-over-day delta. Both delta endpoints
// are SNAPSHOTS (not the live value) so the change is apples-to-apples; the
// live headline number stays the big figure on the card. No backfill — series
// is whatever has accumulated, and `delta` is null until ≥2 snapshots exist.

const TREND_WINDOW = 14

export interface KpiTrend {
  series: number[]
  delta: number | null
  deltaPct: number | null
}

export interface InsightsTrends {
  points: number
  totalProfiles: KpiTrend
  dominantLtv: KpiTrend
  highRiskCount: KpiTrend
  avgEngagement: KpiTrend
}

function buildTrend(values: number[]): KpiTrend {
  if (values.length < 2) return { series: values, delta: null, deltaPct: null }
  const prev = values[values.length - 2]
  const curr = values[values.length - 1]
  const delta = curr - prev
  const deltaPct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : null
  return { series: values, delta, deltaPct }
}

const EMPTY_TREND: KpiTrend = { series: [], delta: null, deltaPct: null }

/**
 * Per-KPI trend series + day-over-day delta from the org's recent daily
 * snapshots (chronological, oldest→newest). Returns empty trends (points 0)
 * when no snapshots exist yet — the UI shows the cold-start state.
 */
export async function readInsightsTrends(
  organizationId: string,
  opts: { window?: number } = {},
): Promise<InsightsTrends> {
  const window = Math.max(2, Math.min(opts.window ?? TREND_WINDOW, 90))
  const rows = (await prisma.customerInsightsSnapshot.findMany({
    where: { organizationId },
    orderBy: { snapshotDate: "desc" },
    take: window,
    select: {
      totalProfiles: true,
      highRiskCount: true,
      avgEngagement: true,
      dominantLtv: true,
    },
  })) as Array<{
    totalProfiles: number
    highRiskCount: number
    avgEngagement: number
    dominantLtv: unknown // Decimal(18,4) — decimalToNumber() before use
  }>
  if (rows.length === 0) {
    return {
      points: 0,
      totalProfiles: EMPTY_TREND,
      dominantLtv: EMPTY_TREND,
      highRiskCount: EMPTY_TREND,
      avgEngagement: EMPTY_TREND,
    }
  }
  // findMany returned newest→oldest; flip to chronological for the sparkline.
  const chrono = rows.reverse()
  return {
    points: chrono.length,
    totalProfiles: buildTrend(chrono.map((r) => r.totalProfiles)),
    dominantLtv: buildTrend(chrono.map((r) => decimalToNumber(r.dominantLtv))),
    highRiskCount: buildTrend(chrono.map((r) => r.highRiskCount)),
    avgEngagement: buildTrend(chrono.map((r) => r.avgEngagement)),
  }
}
