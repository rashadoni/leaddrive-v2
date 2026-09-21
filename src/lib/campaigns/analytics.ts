/**
 * Campaigns → «Analitika»: every figure on the tab, computed from the
 * organisation's own records.
 *
 * Until 2026-09-21 most of the tab was multiplied out of the campaign totals:
 * bounce fell back to 2.1% of sends, revenue was clicks × 12 and ROI came from
 * it, «segments», «automations» and «templates» were fractions of the campaign
 * count, and the template channel donut was a constant 55/25/12/8. On the demo
 * tenant — six campaigns and not one segment, template or journey — it read
 * «8 segments, 6.1K contacts, 3 active automations, 6 templates, ROI +30%».
 *
 * The rule here: no function may return a figure that no record holds. When
 * the records cannot answer, the answer is `null` and the tab prints «—».
 */

export type CampaignAnalyticsRecord = {
  id: string
  name: string
  type: string
  status: string
  totalRecipients: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  totalBounced?: number | null
  budget?: number | null
  sentAt?: string | null
  createdAt: string
}

export type SegmentAnalyticsRecord = { id: string; name: string; isDynamic: boolean; contactCount: number }
export type TemplateAnalyticsRecord = { id: string; isActive?: boolean | null; category?: string | null }
export type JourneyAnalyticsRecord = {
  id: string
  name: string
  status: string
  entryCount: number
  conversionCount: number
}

/** `count` out of `base`, with the base stated so nobody has to guess it. */
export type Rate = { count: number; base: number; percent: number }

type Counter = "totalOpened" | "totalClicked" | "totalBounced"

/**
 * The channels whose send pipeline writes each counter onto the Campaign row.
 *
 * Opens and clicks: email only — the tracking pixel and the link redirect
 * (src/app/api/v1/tracking/open, …/click). An SMS link click is recorded as an
 * attribution touchpoint (…/tracking/sms-click), not on the campaign.
 * Bounces: nothing. The Resend webhook marks the EmailLog row, and no writer
 * increments Campaign.totalBounced. When one starts, add its channel here.
 *
 * A zero on a channel that cannot record the step is "not measured", not "0%":
 * counting SMS sends into the open rate is what put an SMS campaign with
 * «0.0% açılma» at the top of «Ən yaxşı kampaniyalar».
 */
const RECORDED_BY_CHANNEL: Record<Counter, readonly string[]> = {
  totalOpened: ["email"],
  totalClicked: ["email"],
  totalBounced: [],
}

/**
 * Whether a campaign's record can answer for `counter` at all: it sent
 * something, and either its channel records the step or the record already
 * carries a count for it.
 */
export function recordsCounter(campaign: CampaignAnalyticsRecord, counter: Counter): boolean {
  if (!(campaign.totalSent > 0)) return false
  return RECORDED_BY_CHANNEL[counter].includes(campaign.type) || (campaign[counter] ?? 0) > 0
}

/** The rate of `counter` over the sends of the campaigns that record it. */
export function rateOf(campaigns: readonly CampaignAnalyticsRecord[], counter: Counter): Rate | null {
  let count = 0
  let base = 0
  for (const campaign of campaigns) {
    if (!recordsCounter(campaign, counter)) continue
    count += campaign[counter] ?? 0
    base += campaign.totalSent
  }
  return base > 0 ? { count, base, percent: (count / base) * 100 } : null
}

export function summarizeCampaigns(campaigns: readonly CampaignAnalyticsRecord[]) {
  return {
    sent: campaigns.reduce((sum, c) => sum + c.totalSent, 0),
    budget: campaigns.reduce((sum, c) => sum + (c.budget ?? 0), 0),
    opened: rateOf(campaigns, "totalOpened"),
    clicked: rateOf(campaigns, "totalClicked"),
    bounced: rateOf(campaigns, "totalBounced"),
  }
}

export type TrendMonth = { year: number; month: number; sent: number; opened: number; clicked: number }

/**
 * The last `months` calendar months in the viewer's time zone, oldest first.
 * A campaign counts in the month it was sent (its creation month when the
 * send time is missing).
 */
export function monthlyTrend(campaigns: readonly CampaignAnalyticsRecord[], now: Date, months = 6): TrendMonth[] {
  const trend: TrendMonth[] = []
  for (let i = months - 1; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1)
    trend.push({ year: first.getFullYear(), month: first.getMonth(), sent: 0, opened: 0, clicked: 0 })
  }
  for (const campaign of campaigns) {
    const at = new Date(campaign.sentAt || campaign.createdAt)
    if (Number.isNaN(at.getTime())) continue
    const bucket = trend.find((m) => m.year === at.getFullYear() && m.month === at.getMonth())
    if (!bucket) continue
    bucket.sent += campaign.totalSent
    bucket.opened += campaign.totalOpened
    bucket.clicked += campaign.totalClicked
  }
  return trend
}

export type TopCampaign = {
  id: string
  name: string
  type: string
  sent: number
  /** null: the channel does not record the step. */
  openRate: number | null
  clickRate: number | null
}

/**
 * «Top campaigns», ranked by what recipients did: clicks, then opens. A
 * campaign with no recorded engagement is not ranked at all — sending the
 * most is not what made a campaign work.
 */
export function topCampaigns(campaigns: readonly CampaignAnalyticsRecord[], limit = 3): TopCampaign[] {
  return campaigns
    .filter((c) => c.totalSent > 0 && (c.totalClicked > 0 || c.totalOpened > 0))
    .sort((a, b) => b.totalClicked - a.totalClicked || b.totalOpened - a.totalOpened || b.totalSent - a.totalSent)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      sent: c.totalSent,
      openRate: recordsCounter(c, "totalOpened") ? (c.totalOpened / c.totalSent) * 100 : null,
      clickRate: recordsCounter(c, "totalClicked") ? (c.totalClicked / c.totalSent) * 100 : null,
    }))
}

/**
 * Segment contact counts are not summed: segments overlap, so the total would
 * count one contact once per segment it falls into. The Segments page shows
 * the same three counts (all / dynamic / static).
 */
export function summarizeSegments(segments: readonly SegmentAnalyticsRecord[], total = segments.length) {
  const dynamic = segments.filter((s) => s.isDynamic).length
  return {
    total,
    dynamic,
    static: segments.length - dynamic,
    largest: [...segments]
      .sort((a, b) => b.contactCount - a.contactCount)
      .slice(0, 3)
      .map((s) => ({ id: s.id, name: s.name, contacts: s.contactCount })),
  }
}

/** Journeys are the marketing automation («Цепочки коммуникаций»). */
export function summarizeJourneys(journeys: readonly JourneyAnalyticsRecord[], total = journeys.length) {
  const entries = journeys.reduce((sum, j) => sum + j.entryCount, 0)
  const conversions = journeys.reduce((sum, j) => sum + j.conversionCount, 0)
  return {
    total,
    active: journeys.filter((j) => j.status === "active").length,
    entries,
    conversion: entries > 0 ? { count: conversions, base: entries, percent: (conversions / entries) * 100 } : null,
    busiest: [...journeys]
      .sort((a, b) => b.entryCount - a.entryCount || b.conversionCount - a.conversionCount)
      .slice(0, 3)
      .map((j) => ({ id: j.id, name: j.name, active: j.status === "active", entries: j.entryCount })),
  }
}

/**
 * Email templates by category — what the Templates page groups them by. The
 * old donut split templates into Email/SMS/Push, channels the template model
 * does not have.
 */
export function summarizeTemplates(templates: readonly TemplateAnalyticsRecord[], total = templates.length) {
  const counts = new Map<string, number>()
  for (const template of templates) {
    const category = template.category || "general"
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return {
    total,
    // Same reading as the Templates page: only an explicit false is inactive.
    active: templates.filter((t) => t.isActive !== false).length,
    byCategory: [...counts]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
  }
}

/** The part of GET /api/v1/campaign-roi this tab reads. */
export type CampaignRoiSource = {
  summary: { totalRevenue: number; totalCost: number; totalRoi: number }
  campaigns: { deals?: { currency?: string | null }[] | null }[]
}

export type RoiFigure =
  | { kind: "value"; percent: number }
  | { kind: "no-revenue" }
  | { kind: "several-currencies" }
  | { kind: "no-budget" }

/**
 * ROI only from revenue the product actually attributes to campaigns: won
 * deals linked to a campaign, the same figure the Campaign ROI page shows.
 * Without such revenue there is no ROI — not -100%, which is what the formula
 * gives for any budget with nothing won. Linked deals in more than one
 * currency get no ROI either: the server sums their amounts as if they were
 * one currency, and no exchange rates exist to convert them.
 */
export function campaignRoi(source: CampaignRoiSource): RoiFigure {
  if (!(source.summary.totalRevenue > 0)) return { kind: "no-revenue" }
  const currencies = new Set<string>()
  for (const campaign of source.campaigns) {
    for (const deal of campaign.deals ?? []) if (deal.currency) currencies.add(deal.currency)
  }
  if (currencies.size > 1) return { kind: "several-currencies" }
  if (!(source.summary.totalCost > 0)) return { kind: "no-budget" }
  return { kind: "value", percent: source.summary.totalRoi }
}
