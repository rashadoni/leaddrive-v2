const COVERAGE_PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/
const DECIMAL_ZERO = /^0+(?:\.0+)?$/

export interface ContactCoveragePeriod {
  key: string
  startKey: string
  endKey: string
  start: Date
  end: Date
}

export function contactCoveragePeriod(requested: string | null, todayKey: string): ContactCoveragePeriod {
  const fallback = todayKey.slice(0, 7)
  const match = COVERAGE_PERIOD.exec(requested ?? "") ?? COVERAGE_PERIOD.exec(fallback)
  if (!match) throw new Error("Current date key cannot be converted to a coverage period")
  const year = Number(match[1])
  const month = Number(match[2])
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return {
    key: `${match[1]}-${match[2]}`,
    startKey: start.toISOString().slice(0, 10),
    endKey: end.toISOString().slice(0, 10),
    start,
    end,
  }
}

export function contactCoverageState(uncoveredMoi: string): "COVERED" | "GAP" | "COVERAGE_ROW_INVALID" {
  if (!/^\d+(?:\.\d{1,4})?$/.test(uncoveredMoi)) return "COVERAGE_ROW_INVALID"
  return DECIMAL_ZERO.test(uncoveredMoi) ? "COVERED" : "GAP"
}
