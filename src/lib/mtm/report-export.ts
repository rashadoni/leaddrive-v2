import { locales, defaultLocale, type Locale } from "@/i18n/routing"
import { REPORTS, roleLabelKey, statusLabelKey, type ReportType } from "@/lib/mtm/report-config"

type Messages = { [key: string]: string | Messages }
type SheetSpec = { name: string; headers: string[]; rows: unknown[][] }

/**
 * The Excel file of an MTM report, in the reader's language.
 *
 * Audit 2026-11-01: the file had the API's own field names for headers
 * («planAmount», «customerId»), «sum.total» for the totals, and the internal
 * ids of clients and agents as columns. Now it has exactly the columns the
 * screen shows, under the screen's words, and a status reads as on screen.
 */
export async function reportExportSheets(
  type: string,
  summary: ReadonlyArray<{ labelKey: string; value: number | string; kind: string }>,
  rows: ReadonlyArray<Record<string, unknown>>,
  lang: string | null,
  protect: (value: unknown) => unknown,
): Promise<SheetSpec[]> {
  const locale: Locale = (locales as readonly string[]).includes(lang ?? "") ? lang as Locale : defaultLocale
  const messages = (await import(`../../../messages/${locale}.json`)).default as Messages
  const reports = (messages.mtmReports ?? {}) as Messages
  const t = (key: string): string => {
    let node: unknown = reports
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    return typeof node === "string" ? node : key
  }
  const definition = REPORTS[type as ReportType]
  const columns = definition?.columns ?? []
  const cell = (row: Record<string, unknown>, key: string, kind: string): unknown => {
    const value = row[key]
    if (kind === "status") return t(statusLabelKey(String(value ?? "")))
    if (kind === "role") return t(roleLabelKey(String(value ?? "")))
    if (kind === "date" || kind === "day") return value ? new Date(String(value)) : ""
    if (kind === "lastVisit") return value ? new Date(String(value)) : t("neverVisited")
    if (kind === "reasons") return String(value ?? "").split(",").filter(Boolean).map((code) => t(`reason.${code}`)).join(", ")
    if (kind === "action") {
      const word = ((messages.mtmVisitPolicies as Messages | undefined)?.actions as Messages | undefined)?.[String(value)]
      return typeof word === "string" ? word : value ?? ""
    }
    return value ?? ""
  }
  return [
    { name: t("exportSummarySheet"), headers: [t("exportMetric"), t("exportValue")], rows: summary.map((item) => [t(item.labelKey), item.value]) },
    {
      name: definition ? t(`type_${type}`) : type,
      headers: columns.map((column) => t(column.labelKey)),
      rows: rows.map((row) => columns.map((column) => protect(cell(row, column.key, column.kind)))),
    },
  ]
}
