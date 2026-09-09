"use client"

/**
 * Board Configuration — /boards/[divisionId]/settings. Bordio "Project settings →
 * Configuration" analogue. Hosts:
 *  • Task statuses — this board's columns, edited inline via the shared
 *    BoardColumnsEditor (Save → PUT /api/v1/divisions/[id]/columns).
 *  • Task types — org-wide configurable functional categories (departments, SEO…).
 *  • Event types — org-wide configurable channel/source axis (914 LINE, SOCIAL
 *    MEDIA…) used to filter "what a task relates to".
 * Task types + Event types share <ConfigTypeSection>. Reached from the gear on the
 * board toolbar (admins/managers); writes are server-gated.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, X, Settings2, Flag, Tag, Radio } from "lucide-react"
import { BoardColumnsEditor, COLUMN_STAGES, type EditCol } from "@/components/boards/board-columns-editor"
import { ConfigTypeSection } from "@/components/boards/config-type-section"
import { DefaultColumnsSection, TaskCustomFieldsSection } from "@/components/boards/config-table-sections"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"

interface BoardColumnDTO { key: string; label: string; sortOrder: number; mapsToStatus: string; color: string | null }
interface DivisionDTO { id: string; key: string; name: string; color: string | null; boardColumns?: BoardColumnDTO[] }

export default function BoardConfigPage() {
  const { divisionId } = useParams<{ divisionId: string }>()
  const router = useRouter()
  const t = useTranslations("boardConfig")
  // View-gate: only board admins/managers manage configuration (mirrors the gear
  // gate on the board toolbar). Writes are ALSO server-gated (requireAuth
  // settings:write → 403); this is the UX/defense-in-depth layer.
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer"
  const canManage = role === "admin" || role === "superadmin" || role === "manager"
  const [division, setDivision] = useState<DivisionDTO | null>(null)
  const [cols, setCols] = useState<EditCol[]>([])
  const [savingCols, setSavingCols] = useState(false)
  const [toast, setToast] = useState<{ type: "error" | "success"; msg: string } | null>(null)

  useEffect(() => {
    if (status === "authenticated" && !canManage) router.replace(`/boards/${divisionId}`)
  }, [status, canManage, router, divisionId])

  const showToast = useCallback((type: "error" | "success", msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const loadDivision = useCallback(async () => {
    const j = await fetch("/api/v1/divisions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (j) setDivision((j.data?.divisions ?? []).find((d: DivisionDTO) => d.id === divisionId) ?? null)
  }, [divisionId])
  useEffect(() => { loadDivision() }, [loadDivision])

  // Seed the editable status columns whenever the board (re)loads.
  useEffect(() => {
    if (!division) return
    const bc = division.boardColumns
    setCols(bc && bc.length
      ? [...bc].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ key: c.key, label: c.label, mapsToStatus: c.mapsToStatus, color: c.color }))
      : COLUMN_STAGES.map((s) => ({ label: s.label, mapsToStatus: s.key, color: null })))
  }, [division])

  const colsValid = cols.length >= 1 && cols.every((c) => c.label.trim().length >= 1)
  const saveColumns = async () => {
    if (!colsValid || savingCols) return
    setSavingCols(true)
    try {
      const res = await fetch(`/api/v1/divisions/${divisionId}/columns`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ columns: cols.map((c) => ({ key: c.key, label: c.label.trim(), mapsToStatus: c.mapsToStatus, color: c.color })) }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); showToast("error", j?.error || t("couldNotSaveStatuses")); return }
      showToast("success", t("statusesSaved"))
      await loadDivision()
    } catch { showToast("error", t("networkError")) } finally { setSavingCols(false) }
  }

  // Gate the render: hide the editor from non-managers (the effect above redirects
  // them; this guard avoids a flash of the editor while the session resolves).
  if (status === "loading" || !canManage) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
          }`}
        >
          {toast.type === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Header */}
      <div>
        <Link href={`/boards/${divisionId}`} className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {division?.name ?? "Board"}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Settings2 className="h-5 w-5 text-muted-foreground" /> {t("title")}
          <HelpButton slug="board-settings" variant="label" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { board: division?.key ?? "…" })}
        </p>
      </div>

      {/* ── Task statuses (this board's columns) ── */}
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Flag className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("taskStatuses")}</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {t("taskStatusesDesc")}
        </p>
        {division ? (
          <>
            <BoardColumnsEditor value={cols} onChange={setCols} />
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={saveColumns} disabled={!colsValid || savingCols} className="gap-1">
                {savingCols && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("saveStatuses")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</div>
        )}
      </section>

      {/* ── Task types ── */}
      <ConfigTypeSection
        endpoint="task-types"
        icon={Tag}
        title={t("taskTypes")}
        singular={t("taskTypeSingular")}
        addPlaceholder={t("addTaskType")}
        subtitle={t("taskTypesDesc")}
        showToast={showToast}
      />

      {/* ── Event types ── */}
      <ConfigTypeSection
        endpoint="event-types"
        icon={Radio}
        title={t("eventTypes")}
        singular={t("eventTypeSingular")}
        addPlaceholder={t("addEventType")}
        subtitle={t("eventTypesDesc")}
        showToast={showToast}
      />

      {/* ── Task custom fields ── */}
      <TaskCustomFieldsSection />

      {/* ── Default columns for table view ── */}
      <DefaultColumnsSection />
    </div>
  )
}
