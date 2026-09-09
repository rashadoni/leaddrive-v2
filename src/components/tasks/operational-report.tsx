"use client"

/**
 * Operational task report — reusable. Two surfaces:
 *  • Global (no lockedDivisionId): all accessible tasks across boards. [was /tasks/report]
 *  • Board-scoped (lockedDivisionId set): ONLY that board's tasks — embedded in a
 *    board's Hesabatlar tab so each board's report is isolated (board A never sees
 *    board B's data; the API access-checks + filters by divisionId server-side).
 *
 * Modes: Summary (group × planned/ongoing/completed/cancelled) and Over-time
 * (completed per month × group). Both read the access-controlled
 * GET /api/v1/tasks/report (shares buildTaskListWhere + aggregators with the
 * export, so screen = file). Export honours the same filters incl. the lock.
 * All visible strings are i18n (tasks namespace, op* keys).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, FileSpreadsheet, FileText } from "lucide-react"
import { REPORT_GROUP_BYS, type ReportGroupBy, type ReportRow, type TimelineRow } from "@/lib/tasks/report-aggregate"
import { useTaskTypes, useEventTypes } from "@/components/tasks/use-task-types"
import { ReportSummaryChart, ReportTimelineChart } from "@/components/tasks/report-charts"

interface DivisionLite { id: string; key: string; name: string }
interface UserLite { id: string; name: string }
interface ProjectLite { id: string; name: string }
// Select-type task custom fields (Brand, Channel, …) usable as a report filter.
interface CfDefLite { id: string; fieldName: string; fieldLabel: string; fieldType: string; options: string[]; isActive: boolean }
type Mode = "summary" | "timeline"

// Named report sections — one click sets mode + grouping. labelKey → tasks-namespace
// op* i18n key (the section names the client listed, now localized az/ru/en).
const REPORT_PRESETS: { labelKey: string; mode: Mode; groupBy: ReportGroupBy }[] = [
  { labelKey: "opPresetUserOverTime", mode: "timeline", groupBy: "assignee" },
  { labelKey: "opPresetUserSummary", mode: "summary", groupBy: "assignee" },
  { labelKey: "opPresetTeamOverTime", mode: "timeline", groupBy: "division" },
  { labelKey: "opPresetTeamSummary", mode: "summary", groupBy: "division" },
  { labelKey: "opPresetTeamByUser", mode: "summary", groupBy: "assignee" },
  { labelKey: "opPresetTaskTypes", mode: "summary", groupBy: "type" },
]

const BUCKET_COLS = [
  { key: "planned", labelKey: "opPlanned", color: "#94A3B8" },
  { key: "ongoing", labelKey: "opOngoing", color: "#EA580C" },
  { key: "completed", labelKey: "opCompleted", color: "#00875A" },
  { key: "cancelled", labelKey: "opCancelled", color: "#DE350B" },
] as const

function fmtMonth(p: string): string {
  const d = new Date(`${p}-01T00:00:00Z`)
  return isNaN(d.getTime()) ? p : d.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" })
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function OperationalReport({ lockedDivisionId }: { lockedDivisionId?: string }) {
  const t = useTranslations("tasks")
  // Board-scoped when a division is locked: that board's id is the fixed filter,
  // the Board/Department controls (filter + group-by + team presets) are dropped
  // (one board can't be grouped by board), and the page chrome is omitted.
  const locked = !!lockedDivisionId
  const [mode, setMode] = useState<Mode>("summary")
  const [groupBy, setGroupBy] = useState<ReportGroupBy>(locked ? "assignee" : "division")
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [divisionId, setDivisionId] = useState("")
  const [createdAfter, setCreatedAfter] = useState("")
  const [createdBefore, setCreatedBefore] = useState("")
  const [divisions, setDivisions] = useState<DivisionLite[]>([])
  const [assignee, setAssignee] = useState("")
  const [projectId, setProjectId] = useState("")
  const [type, setType] = useState("")
  const [eventType, setEventType] = useState("")
  const [users, setUsers] = useState<UserLite[]>([])
  const [projects, setProjects] = useState<ProjectLite[]>([])
  // Custom-field filter (the client's "filter by brand": Brand is a task
  // custom field). cfKey = fieldName inside Task.customFields; cfValue = the
  // chosen option. Server-enforced in buildTaskListWhere → report AND export.
  const [cfDefs, setCfDefs] = useState<CfDefLite[]>([])
  const [cfKey, setCfKey] = useState("")
  const [cfValue, setCfValue] = useState("")
  const { types: taskTypes } = useTaskTypes(true)
  const { types: eventTypes } = useEventTypes(true)

  const [rows, setRows] = useState<ReportRow[]>([])
  const [totals, setTotals] = useState<ReportRow | null>(null)
  const [periods, setPeriods] = useState<string[]>([])
  const [tlRows, setTlRows] = useState<TimelineRow[]>([])
  const [tlTotals, setTlTotals] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)

  // Localized group-by labels (table header + group-by buttons).
  const gbLabel: Record<ReportGroupBy, string> = {
    type: t("opGbType"), eventType: t("opGbEvent"), division: t("opGbBoard"),
    assignee: t("opGbAssignee"), project: t("opGbProject"), status: t("opGbStatus"), bucket: t("opGbStage"),
  }

  // Locked → division is fixed to the board; otherwise the user's selection.
  const effectiveDivisionId = locked ? (lockedDivisionId as string) : divisionId
  const presets = locked ? REPORT_PRESETS.filter((p) => p.groupBy !== "division") : REPORT_PRESETS
  const groupBys = locked ? REPORT_GROUP_BYS.filter((g) => g !== "division") : REPORT_GROUP_BYS

  const params = useMemo(() => {
    const p = new URLSearchParams()
    p.set("groupBy", groupBy)
    if (effectiveDivisionId) p.set("divisionId", effectiveDivisionId)
    if (assignee) p.set("assigneeId", assignee)
    if (projectId) p.set("projectId", projectId)
    if (type) p.set("type", type)
    if (eventType) p.set("eventType", eventType)
    if (cfKey && cfValue) { p.set("cfKey", cfKey); p.set("cfValue", cfValue) }
    if (createdAfter) p.set("createdAfter", createdAfter)
    if (createdBefore) p.set("createdBefore", createdBefore)
    return p
  }, [groupBy, effectiveDivisionId, assignee, projectId, type, eventType, cfKey, cfValue, createdAfter, createdBefore])

  useEffect(() => {
    if (!locked) {
      fetch("/api/v1/divisions", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j) setDivisions(j.data?.divisions ?? []) })
        .catch(() => {})
    }
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.success) { const a = Array.isArray(j.data) ? j.data : (j.data?.users ?? []); setUsers(a.map((u: { id: string; name?: string; email?: string }) => ({ id: u.id, name: u.name || u.email || u.id }))) } })
      .catch(() => {})
    fetch("/api/v1/projects?limit=200", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.success) setProjects((j.data?.projects ?? j.data ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))) })
      .catch(() => {})
    // Select-type custom fields with options → filterable dimensions (Brand …).
    fetch("/api/v1/custom-fields?entityType=task", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const defs = (j?.data ?? []) as CfDefLite[]
        setCfDefs(defs.filter((d) => d.isActive && d.fieldType === "select" && (d.options?.length ?? 0) > 0))
      })
      .catch(() => {})
  }, [locked])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams(params)
      if (mode === "timeline") p.set("mode", "timeline")
      const res = await fetch(`/api/v1/tasks/report?${p.toString()}`, { credentials: "include" })
      if (res.ok) {
        const j = await res.json()
        const d = j.data ?? {}
        setTruncated(!!d.truncated)
        if (mode === "timeline") {
          setPeriods(d.periods ?? [])
          setTlRows(d.rows ?? [])
          setTlTotals(d.totalsByPeriod ?? [])
        } else {
          setRows(d.rows ?? [])
          setTotals(d.totals ?? null)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [params, mode])
  useEffect(() => { load() }, [load])

  const downloadSummary = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams(params)
    p.set("format", format)
    window.open(`/api/v1/tasks/export?${p.toString()}`, "_blank")
  }

  const downloadTimelineCsv = () => {
    const lines = [["Group", ...periods.map(fmtMonth), "Total"].map(csvCell).join(",")]
    for (const r of tlRows) lines.push([r.group, ...r.byPeriod, r.total].map(csvCell).join(","))
    lines.push(["Total", ...tlTotals, tlTotals.reduce((s, n) => s + n, 0)].map(csvCell).join(","))
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `task-performance-by-${groupBy}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const maxTotal = Math.max(1, ...rows.map((r) => r.total))
  const tlMax = Math.max(1, ...tlRows.map((r) => r.total))

  return (
    <div className={locked ? "space-y-6" : "mx-auto max-w-5xl space-y-6 p-6"}>
      {!locked && (
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">{t("opTitle")}</h1>
        </div>
      )}

      {/* Controls */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-1.5 border-b pb-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("opReports")}</span>
          {presets.map((p) => (
            <button
              key={p.labelKey}
              type="button"
              onClick={() => { setMode(p.mode); setGroupBy(p.groupBy); setActivePreset(p.labelKey) }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${activePreset === p.labelKey ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border p-0.5">
            {(["summary", "timeline"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setActivePreset(null) }}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {m === "summary" ? t("opSummary") : t("opOverTime")}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">{t("opGroupBy")}</span>
            {groupBys.map((gb) => (
              <button
                key={gb}
                type="button"
                onClick={() => { setGroupBy(gb); setActivePreset(null) }}
                className={`rounded-lg border px-2.5 py-1 text-sm transition-colors ${groupBy === gb ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                {gbLabel[gb]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {!locked && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("opGbBoard")}
              <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">{t("opAllBoards")}</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.key} — {d.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opGbAssignee")}
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">{t("opAll")}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opGbProject")}
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">{t("opAll")}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opGbType")}
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">{t("opAll")}</option>
              {taskTypes.map((tt) => <option key={tt.id} value={tt.name}>{tt.displayName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opEvent")}
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">{t("opAll")}</option>
              {eventTypes.map((et) => <option key={et.id} value={et.name}>{et.displayName}</option>)}
            </select>
          </label>
          {cfDefs.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("opCfField")}
              <select
                value={cfKey}
                onChange={(e) => { setCfKey(e.target.value); setCfValue("") }}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">{t("opAll")}</option>
                {cfDefs.map((d) => <option key={d.id} value={d.fieldName}>{d.fieldLabel}</option>)}
              </select>
            </label>
          )}
          {cfKey && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("opCfValue")}
              <select value={cfValue} onChange={(e) => setCfValue(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">{t("opAll")}</option>
                {(cfDefs.find((d) => d.fieldName === cfKey)?.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opCreatedFrom")}
            <input type="date" value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("opCreatedTo")}
            <input type="date" value={createdBefore} onChange={(e) => setCreatedBefore(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {mode === "summary" ? (
              <>
                <button onClick={() => downloadSummary("xlsx")} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel
                </button>
                <button onClick={() => downloadSummary("csv")} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted">
                  <FileText className="h-4 w-4 text-sky-600" /> CSV
                </button>
              </>
            ) : (
              <button onClick={downloadTimelineCsv} disabled={tlRows.length === 0} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-50">
                <FileText className="h-4 w-4 text-sky-600" /> CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Chart — same aggregated data as the table below it */}
      {!loading && (mode === "summary"
        ? rows.length > 0 && <ReportSummaryChart rows={rows} />
        : tlRows.length > 0 && <ReportTimelineChart periods={periods} rows={tlRows} fmtMonth={fmtMonth} />)}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        {mode === "summary" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">{gbLabel[groupBy]}</th>
                <th className="px-4 py-2 text-right font-medium">{t("opTotal")}</th>
                {BUCKET_COLS.map((b) => <th key={b.key} className="px-3 py-2 text-right font-medium">{t(b.labelKey)}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("opEmptySummary")}</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.group} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{r.group}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(r.total / maxTotal) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right tabular-nums">{r.total}</span>
                      </div>
                    </td>
                    {BUCKET_COLS.map((b) => (
                      <td key={b.key} className="px-3 py-2 text-right tabular-nums" style={{ color: r[b.key] ? b.color : undefined }}>
                        {r[b.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {totals && rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/40 font-semibold">
                  <td className="px-4 py-2">{t("opTotal")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{totals.total}</td>
                  {BUCKET_COLS.map((b) => <td key={b.key} className="px-3 py-2 text-right tabular-nums">{totals[b.key]}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">{gbLabel[groupBy]}</th>
                {periods.map((p) => <th key={p} className="px-3 py-2 text-right font-medium">{fmtMonth(p)}</th>)}
                <th className="px-4 py-2 text-right font-medium">{t("opTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={periods.length + 2} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : tlRows.length === 0 ? (
                <tr><td colSpan={Math.max(2, periods.length + 2)} className="px-4 py-8 text-center text-muted-foreground">{t("opEmptyTimeline")}</td></tr>
              ) : (
                tlRows.map((r) => (
                  <tr key={r.group} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(r.total / tlMax) * 100}%` }} />
                        </div>
                        {r.group}
                      </div>
                    </td>
                    {r.byPeriod.map((n, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{n || "—"}</td>)}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))
              )}
            </tbody>
            {tlRows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/40 font-semibold">
                  <td className="px-4 py-2">{t("opTotal")}</td>
                  {tlTotals.map((n, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{n}</td>)}
                  <td className="px-4 py-2 text-right tabular-nums">{tlTotals.reduce((s, n) => s + n, 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {truncated && (
        <p className="text-xs text-amber-600">{t("opTruncated")}</p>
      )}
    </div>
  )
}
