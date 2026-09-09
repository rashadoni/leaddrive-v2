"use client"

/**
 * P8 No-Code Form Builder — slice-3 dashboard list page.
 *
 * `/forms` — lists the org's FormDefinitions with status badges
 * + create dialog + per-row link to the editor at `/forms/[id]`.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Plus, ExternalLink, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { FormStatus } from "@/lib/form-builder/types"
import { HelpButton } from "@/components/help/help-button"

interface FormRow {
  id: string
  name: string
  slug: string
  description: string | null
  status: FormStatus
  totalViews: number
  totalSubmissions: number
  publishedAt: string | null
  createdAt: string
}

// Reuse the existing Badge cva variants so this page picks up future
// palette changes from one place — no inline emerald/amber drift.
const STATUS_VARIANT: Record<FormStatus, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  published: "success",
  archived: "warning",
}

export default function FormsListPage() {
  const t = useTranslations("formsListPage")
  const [rows, setRows] = useState<FormRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    fetch("/api/v1/forms?limit=200", { signal: ac.signal })
      .then((r) => r.json())
      .then((body: { data?: { forms?: FormRow[] } }) => {
        if (body.data?.forms) setRows(body.data.forms)
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          console.error("[forms] list fetch failed:", e)
        }
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="forms" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitleBeforeUrl")}{" "}
            <code>/f/{`{slug}`}</code>{" "}
            {t("subtitleAfterUrl")}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t("actions.newForm")}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{t("empty.title")}</p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("empty.cta")}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t("col.name")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("col.status")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("col.views")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("col.submissions")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("col.publicUrl")}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/forms/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    {r.description ? (
                      <p className="text-xs text-muted-foreground truncate max-w-md">{r.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}` as never)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{r.totalViews}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{r.totalSubmissions}</td>
                  <td className="px-4 py-3">
                    {r.status === "published" ? (
                      <code className="text-xs text-muted-foreground">/f/{r.slug}</code>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/forms/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t("actions.edit")}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <CreateFormDialog
          onClose={() => setShowCreate(false)}
          onCreated={(newRow) => {
            setRows((prev) => [newRow, ...prev])
            setShowCreate(false)
          }}
        />
      ) : null}
    </div>
  )
}

function CreateFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: FormRow) => void }) {
  const t = useTranslations("formsListPage")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/v1/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim().toLowerCase() }),
      })
      const body: { data?: FormRow; error?: string } = await res.json()
      if (!res.ok || !body.data) {
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      onCreated(body.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toast.createFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground rounded-lg shadow-lg w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{t("dialog.title")}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t("dialog.nameLabel")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dialog.namePlaceholder")} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("dialog.slugLabel")}</label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("dialog.slugPlaceholder")} />
            <p className="text-xs text-muted-foreground mt-1">{t("dialog.slugHint")}</p>
          </div>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>{t("actions.cancel")}</Button>
          <Button onClick={handleCreate} disabled={submitting || !name.trim() || !slug.trim()}>
            {submitting ? t("dialog.creating") : t("dialog.createDraft")}
          </Button>
        </div>
      </div>
    </div>
  )
}
