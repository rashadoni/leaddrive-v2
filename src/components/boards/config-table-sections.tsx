"use client"

/**
 * Two Bordio-parity sections for the board Configuration page:
 *  • DefaultColumnsSection — which columns show by default in the /tasks table view.
 *    Toggling a chip persists to the SAME per-browser store the table reads
 *    (LOCAL_STORAGE_COLUMNS_KEY). "Save as org default" additionally writes the
 *    current set to the reserved shared SavedView (__table_default__), which the
 *    table applies for every member who hasn't made a personal choice.
 *  • TaskCustomFieldsSection — surfaces the org's task custom fields + links to the full
 *    editor at /settings/custom-fields (reuses it, no duplication).
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Table2, ListPlus, ExternalLink, Check, Loader2, Building2 } from "lucide-react"
import { HIDEABLE_COLUMN_KEYS, LOCAL_STORAGE_COLUMNS_KEY, ORG_DEFAULT_VIEW_NAME } from "@/components/tasks/inline-tasks-table"

// Standard columns shown as chips (labelKey = tasks-namespace i18n key, the
// same labels the table itself uses). `title` (Name) is always on (not
// hideable), mirroring the table where _select/title/_actions are fixed.
const COLUMN_DEFS: { key: string; labelKey: string; fixed?: boolean }[] = [
  { key: "title", labelKey: "colTask", fixed: true },
  { key: "status", labelKey: "colStatus" },
  { key: "type", labelKey: "opGbType" },
  { key: "eventType", labelKey: "opGbEvent" },
  { key: "dueDate", labelKey: "colDueDate" },
  { key: "priority", labelKey: "colPriority" },
  { key: "assignee", labelKey: "colAssignee" },
  { key: "project", labelKey: "colProject" },
  { key: "category", labelKey: "colCategory" },
]
// Keep the chip list honest if the table's hideable set ever changes.
const HIDEABLE = new Set<string>(HIDEABLE_COLUMN_KEYS)

export function DefaultColumnsSection() {
  const t = useTranslations("boardConfig")
  const tTasks = useTranslations("tasks")
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)
  // Org-wide default (reserved shared SavedView). null id = none saved yet.
  const [orgViewId, setOrgViewId] = useState<string | null>(null)
  const [orgBusy, setOrgBusy] = useState(false)
  const [orgMsg, setOrgMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_STORAGE_COLUMNS_KEY) : null
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) setHidden(new Set(arr)) }
    } catch { /* ignore corrupt localStorage */ }
    // Discover the org default (if any) so the editor seeds from it when the
    // browser has no personal choice, and so Save knows create-vs-update.
    fetch("/api/v1/saved-views?entityType=tasks", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const v = (j?.data ?? []).find((x: { name: string; isShared: boolean }) => x.name === ORG_DEFAULT_VIEW_NAME && x.isShared)
        if (!v) return
        setOrgViewId(v.id)
        const cols = (v.filters as { hiddenColumns?: unknown } | undefined)?.hiddenColumns
        const hasLocal = (() => { try { return !!window.localStorage.getItem(LOCAL_STORAGE_COLUMNS_KEY) } catch { return false } })()
        if (!hasLocal && Array.isArray(cols)) setHidden(new Set(cols.map(String)))
      })
      .catch(() => {})
  }, [])

  const persist = (next: Set<string>) => {
    setHidden(next)
    try { window.localStorage.setItem(LOCAL_STORAGE_COLUMNS_KEY, JSON.stringify([...next])) } catch { /* full/disabled */ }
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const flashOrg = (ok: boolean, text: string) => {
    setOrgMsg({ ok, text }); setTimeout(() => setOrgMsg(null), 4000)
  }
  const saveOrgDefault = async () => {
    if (orgBusy) return
    setOrgBusy(true)
    try {
      const body = { filters: { hiddenColumns: [...hidden] } }
      const res = orgViewId
        ? await fetch(`/api/v1/saved-views/${orgViewId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(body),
          })
        : await fetch("/api/v1/saved-views", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ entityType: "tasks", name: ORG_DEFAULT_VIEW_NAME, isShared: true, ...body }),
          })
      if (res.status === 403) { flashOrg(false, t("orgDefaultForbidden")); return }
      if (!res.ok) { flashOrg(false, t("orgDefaultError")); return }
      const j = await res.json().catch(() => null)
      if (!orgViewId && j?.data?.id) setOrgViewId(j.data.id)
      flashOrg(true, t("orgDefaultSaved"))
    } catch { flashOrg(false, t("networkError")) } finally { setOrgBusy(false) }
  }
  const removeOrgDefault = async () => {
    if (orgBusy || !orgViewId) return
    setOrgBusy(true)
    try {
      const res = await fetch(`/api/v1/saved-views/${orgViewId}`, { method: "DELETE", credentials: "include" })
      if (res.status === 403) { flashOrg(false, t("orgDefaultForbidden")); return }
      if (!res.ok) { flashOrg(false, t("orgDefaultRemoveError")); return }
      setOrgViewId(null)
      flashOrg(true, t("orgDefaultRemoved"))
    } catch { flashOrg(false, t("networkError")) } finally { setOrgBusy(false) }
  }
  const toggle = (key: string) => {
    if (!HIDEABLE.has(key)) return // only hideable columns can be toggled
    const n = new Set(hidden); n.has(key) ? n.delete(key) : n.add(key); persist(n)
  }
  const isVisible = (key: string) => !hidden.has(key)
  const visibleCols = COLUMN_DEFS.filter(c => isVisible(c.key))

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Table2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t("defaultColumns")}</h2>
        {saved && <span className="ml-auto text-xs font-medium text-emerald-600">{t("saved")}</span>}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {t("defaultColumnsDesc")}
      </p>

      {/* Preview header (live — reflects the chips below) */}
      <div className="mb-4 overflow-x-auto rounded-lg border">
        <div className="flex divide-x bg-muted/30 text-xs font-medium text-muted-foreground">
          {visibleCols.map(c => (
            <div key={c.key} className="min-w-[110px] flex-1 whitespace-nowrap px-3 py-2">{tTasks(c.labelKey)}</div>
          ))}
        </div>
        {[0, 1].map(r => (
          <div key={r} className="flex divide-x border-t">
            {visibleCols.map(c => (
              <div key={c.key} className="min-w-[110px] flex-1 px-3 py-3"><div className="h-3 w-16 rounded bg-muted" /></div>
            ))}
          </div>
        ))}
      </div>

      {/* Column chips */}
      <div className="flex flex-wrap gap-2">
        {COLUMN_DEFS.map(c => {
          const on = isVisible(c.key)
          return (
            <button
              key={c.key}
              type="button"
              disabled={c.fixed}
              onClick={() => toggle(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                on ? "border-primary/40 bg-primary/5 text-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              } ${c.fixed ? "cursor-default opacity-70" : ""}`}
            >
              {on && <Check className="h-3.5 w-3.5 text-primary" />}
              {tTasks(c.labelKey)}
              {c.fixed && <span className="text-[10px] text-muted-foreground">{t("always")}</span>}
            </button>
          )
        })}
      </div>

      {/* Org-wide default (reserved shared SavedView __table_default__) */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <button
          type="button"
          onClick={saveOrgDefault}
          disabled={orgBusy}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-50"
        >
          {orgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4 text-muted-foreground" />}
          {orgViewId ? t("updateOrgDefault") : t("saveOrgDefault")}
        </button>
        {orgViewId && (
          <button
            type="button"
            onClick={removeOrgDefault}
            disabled={orgBusy}
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            {t("removeOrgDefault")}
          </button>
        )}
        {orgMsg && (
          <span className={`text-xs font-medium ${orgMsg.ok ? "text-emerald-600" : "text-amber-600"}`}>{orgMsg.text}</span>
        )}
      </div>
    </section>
  )
}

interface CFLite { id: string; fieldName: string; fieldLabel: string; fieldType: string; isActive: boolean }

export function TaskCustomFieldsSection() {
  const t = useTranslations("boardConfig")
  const [fields, setFields] = useState<CFLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/v1/custom-fields?entityType=task", { credentials: "include" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then(j => setFields(j?.data ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <ListPlus className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t("customFields")}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {t("customFieldsDesc")}
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : error ? (
        <p className="mb-3 text-sm text-amber-600">{t("customFieldsError")}</p>
      ) : fields.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">{t("customFieldsEmpty")}</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {fields.map(f => (
            <span key={f.id} className={`inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-sm ${f.isActive ? "" : "opacity-50"}`}>
              {f.fieldLabel}
              <span className="text-[11px] text-muted-foreground">{f.fieldType}</span>
            </span>
          ))}
        </div>
      )}

      <Link href="/settings/custom-fields" className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-muted">
        <ExternalLink className="h-4 w-4" /> {t("manageCustomFields")}
      </Link>
    </section>
  )
}
