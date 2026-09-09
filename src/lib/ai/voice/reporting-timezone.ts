import { prisma } from "@/lib/prisma"
import { resolveAnalyticsPeriod } from "@/lib/ai/analytics-period"
import { localDateTimeToUtc, resolveEffectiveTimezone } from "@/lib/timezone"
import type { ExplicitPeriodRange, Period } from "./section-reader"

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nextQuarterStart(range: ExplicitPeriodRange): Date {
  if (!range.timezone || !range.label) throw new Error("Quarter timezone and label are required")
  const startKey = range.label.split("—")[0]?.trim() ?? ""
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startKey)
  if (!match) throw new Error("Invalid quarter label")
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + 3, 1))
  const nextKey = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`
  return localDateTimeToUtc(`${nextKey}T00:00`, range.timezone)
}

/**
 * Resolve the reporting clock from authenticated rows only. A missing or
 * malformed preference is harmless (UTC), but a failed DB read is not: callers
 * must fail closed rather than quietly answer a Baku question in server time.
 */
export async function loadVoiceReportingTimezone(orgId: string, userId: string): Promise<string> {
  const [user, organization] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { timezone: true },
    }),
    prisma.organization.findFirst({
      where: { id: orgId },
      select: { settings: true },
    }),
  ])
  const settings = jsonObject(organization?.settings)
  return resolveEffectiveTimezone({
    userTimezone: user?.timezone,
    orgTimezone: typeof settings.timezone === "string" ? settings.timezone : null,
  })
}

const PERIOD_PRESET: Record<Period, Parameters<typeof resolveAnalyticsPeriod>[0]["period"]> = {
  today: "today",
  yesterday: "yesterday",
  // A bare spoken "week" means the rolling seven-day window. "This week"
  // will get its own explicit preset when the voice schema exposes both.
  week: "last_7_days",
  month: "this_month",
  quarter: "this_quarter",
  year: "this_year",
}

export function resolveVoiceReportingRange(
  period: Period,
  now: Date,
  timezone: string,
): ExplicitPeriodRange {
  const resolved = resolveAnalyticsPeriod({ period: PERIOD_PRESET[period] }, now, timezone)
  return {
    from: resolved.from,
    toExclusive: resolved.toExclusive,
    timezone: resolved.timezone,
    label: resolved.label,
  }
}

/** Quarter-to-date actuals plus the full-quarter expected-close boundary. */
export function resolveVoiceForecastRanges(
  now: Date,
  timezone: string,
): { actuals: ExplicitPeriodRange; pipelineToExclusive: Date } {
  const actuals = resolveVoiceReportingRange("quarter", now, timezone)
  return { actuals, pipelineToExclusive: nextQuarterStart(actuals) }
}
