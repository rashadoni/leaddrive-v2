import { NextRequest, NextResponse } from "next/server"

export interface DateRangeResult {
  hasDateRange: false
  dateRangeFilter: undefined
  startMonth: 1
  endMonth: 12
  year?: undefined
  errorResponse?: undefined
}

export interface DateRangeResultActive {
  hasDateRange: true
  dateRangeFilter: { gte: Date; lte: Date }
  startMonth: number
  endMonth: number
  year: number
  errorResponse?: undefined
}

export interface DateRangeResultError {
  hasDateRange?: undefined
  dateRangeFilter?: undefined
  startMonth?: undefined
  endMonth?: undefined
  year?: undefined
  errorResponse: ReturnType<typeof NextResponse.json>
}

/**
 * Parse optional dateFrom / dateTo query params from a Next.js request.
 *
 * Rules:
 * - Neither provided → { hasDateRange: false }
 * - Exactly one provided → 400 error
 * - Both provided but invalid/inverted/cross-year → 400 error
 * - Both valid and same year → { hasDateRange: true, dateRangeFilter, startMonth, endMonth, year }
 */
export function parseOptionalDateRange(
  req: NextRequest,
): DateRangeResult | DateRangeResultActive | DateRangeResultError {
  const dateFromStr = req.nextUrl.searchParams.get("dateFrom")
  const dateToStr = req.nextUrl.searchParams.get("dateTo")

  // Exactly one provided
  if (!!dateFromStr !== !!dateToStr) {
    return {
      errorResponse: NextResponse.json(
        { error: "Both dateFrom and dateTo are required when using a date range" },
        { status: 400 },
      ),
    }
  }

  if (!dateFromStr || !dateToStr) {
    return { hasDateRange: false, dateRangeFilter: undefined, startMonth: 1, endMonth: 12 }
  }

  // Normalise to UTC day boundaries
  const dfStr = dateFromStr.length === 10 ? `${dateFromStr}T00:00:00.000Z` : dateFromStr
  const dtStr = dateToStr.length === 10 ? `${dateToStr}T23:59:59.999Z` : dateToStr
  const df = new Date(dfStr)
  const dt = new Date(dtStr)

  if (isNaN(df.getTime()) || isNaN(dt.getTime())) {
    return {
      errorResponse: NextResponse.json({ error: "Invalid dateFrom or dateTo" }, { status: 400 }),
    }
  }
  if (df > dt) {
    return {
      errorResponse: NextResponse.json(
        { error: "dateFrom must not be after dateTo" },
        { status: 400 },
      ),
    }
  }
  if (df.getUTCFullYear() !== dt.getUTCFullYear()) {
    return {
      errorResponse: NextResponse.json(
        { error: "dateFrom and dateTo must fall within the same calendar year" },
        { status: 400 },
      ),
    }
  }

  return {
    hasDateRange: true,
    dateRangeFilter: { gte: df, lte: dt },
    startMonth: df.getUTCMonth() + 1,
    endMonth: dt.getUTCMonth() + 1,
    year: df.getUTCFullYear(),
  }
}
