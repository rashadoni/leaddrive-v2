"use client"

/**
 * P8 No-Code Form Builder — slice-3 editor page.
 *
 * `/forms/[id]` — edit metadata + field list + publish.
 * Drag-drop is deferred to a future slice; this slice uses a simple
 * ordered list with up/down + delete buttons + an "Add field" dialog.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, Plus, Trash2, Save, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FORM_FIELD_TYPES, type FormFieldSchema, type FormFieldType, type FormStatus } from "@/lib/form-builder/types"
import { HelpButton } from "@/components/help/help-button"

interface Form {
  id: string
  name: string
  slug: string
  description: string | null
  fields: FormFieldSchema[]
  status: FormStatus
  successMessage: string | null
  redirectUrl: string | null
  notifyEmails: string | null
  leadAutoCreate: boolean
  campaignId: string | null
  totalViews: number
  totalSubmissions: number
  publishedAt: string | null
}

export default function FormEditorPage() {
  const t = useTranslations("formsDetailPage")
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [form, setForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingField, setAddingField] = useState(false)
  // C9 #15 — campaigns to link the form to (drives form_submitted attribution).
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    const ac = new AbortController()
    fetch("/api/v1/campaigns?limit=500", { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setCampaigns(j.data.campaigns.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    fetch(`/api/v1/forms/${id}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((body: { data?: Form }) => {
        if (body.data) setForm(body.data)
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError(t("toast.loadFailed"))
        }
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [id, t])

  if (loading) return <div className="p-6 text-sm text-muted-foreground">{t("loading")}</div>
  if (!form) return <div className="p-6 text-sm text-red-600">{error || t("notFound")}</div>

  const update = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })

  const moveField = (i: number, dir: -1 | 1) => {
    const next = [...form.fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    update("fields", next)
  }

  const removeField = (i: number) => {
    const next = form.fields.filter((_, idx) => idx !== i)
    update("fields", next)
  }

  // Returns true on success so callers (especially publish()) can
  // abort their flow on save failure. Without this, publish() would
  // proceed against the OLD persisted definition while the user sees
  // a save error — exactly the kind of "publishes the wrong thing"
  // race that breaks trust.
  const saveAll = async (): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/forms/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          fields: form.fields,
          successMessage: form.successMessage,
          redirectUrl: form.redirectUrl,
          notifyEmails: form.notifyEmails,
          leadAutoCreate: form.leadAutoCreate,
          campaignId: form.campaignId || null,
        }),
      })
      // PUT /api/v1/forms/[id] returns `details: string[]` from
      // validate-definition (NOT FieldError[] like the submit
      // route). Don't confuse the two shapes — see note in
      // `src/lib/form-builder/types.ts`.
      const body: { data?: Form; error?: string; details?: string[] } = await res.json()
      if (!res.ok) {
        setError(`${body.error || t("toast.saveFailed")}${body.details ? `: ${body.details.join("; ")}` : ""}`)
        return false
      }
      if (body.data) setForm(body.data)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toast.saveFailed"))
      return false
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (!confirm(t("publishConfirm"))) return
    setPublishing(true)
    setError(null)
    try {
      const ok = await saveAll()
      if (!ok) return // save failed — leave error visible, don't publish stale state
      const res = await fetch(`/api/v1/forms/${id}/publish`, { method: "POST" })
      const body: { data?: Form; error?: string; details?: string[] } = await res.json()
      if (!res.ok) {
        setError(`${body.error || t("toast.publishFailed")}${body.details ? `: ${body.details.join("; ")}` : ""}`)
        return
      }
      if (body.data) setForm(body.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toast.publishFailed"))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/forms")}>← {t("backToForms")}</Button>
          <h1 className="text-2xl font-semibold mt-2 flex items-center gap-2 min-w-0"><span className="truncate">{form.name}</span> <HelpButton slug="form-detail" variant="label" className="shrink-0" /></h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Badge>{t(`status.${form.status}` as never)}</Badge>
            <span className="font-mono">/f/{form.slug}</span>
            <span>·</span>
            <span>{t("stats.views", { count: form.totalViews })}</span>
            <span>·</span>
            <span>{t("stats.submissions", { count: form.totalSubmissions })}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveAll} disabled={saving || publishing}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? t("actions.saving") : t("actions.saveDraft")}
          </Button>
          <Button onClick={publish} disabled={saving || publishing || form.fields.length === 0}>
            <Send className="h-4 w-4 mr-1.5" />
            {publishing ? t("actions.publishing") : form.status === "published" ? t("actions.rePublish") : t("actions.publish")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Metadata block */}
      <section className="rounded-md border p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("metadata.title")}</h2>
        <div>
          <label className="block text-sm font-medium mb-1">{t("metadata.name")}</label>
          <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("metadata.description")}</label>
          <textarea
            value={form.description || ""}
            onChange={(e) => update("description", e.target.value || null)}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t("metadata.successMessage")}</label>
            <Input value={form.successMessage || ""} onChange={(e) => update("successMessage", e.target.value || null)} placeholder={t("metadata.successMessagePlaceholder")} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("metadata.redirectUrl")}</label>
            <Input value={form.redirectUrl || ""} onChange={(e) => update("redirectUrl", e.target.value || null)} placeholder={t("metadata.redirectUrlPlaceholder")} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("metadata.notifyEmails")}</label>
          <Input value={form.notifyEmails || ""} onChange={(e) => update("notifyEmails", e.target.value || null)} placeholder={t("metadata.notifyEmailsPlaceholder")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("metadata.campaign")}</label>
          <select
            value={form.campaignId || ""}
            onChange={(e) => update("campaignId", e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
          >
            <option value="">{t("metadata.campaignNone")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">{t("metadata.campaignHint")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.leadAutoCreate}
            onChange={(e) => update("leadAutoCreate", e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t.rich("metadata.leadAutoCreate", { code: (chunks) => <code>{chunks}</code> })}</span>
        </label>
      </section>

      {/* Fields block */}
      <section className="rounded-md border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("fields.title")}</h2>
          <Button size="sm" variant="outline" onClick={() => setAddingField(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("fields.add")}
          </Button>
        </div>

        {form.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("fields.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {form.fields.map((f, i) => (
              <li key={f.key} className="flex items-center gap-3 rounded-md border p-3 bg-background">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveField(i, -1)}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={t("fields.moveUp")}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(i, 1)}
                    disabled={i === form.fields.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={t("fields.moveDown")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{f.label}</span>
                    {f.required ? <span className="text-xs text-red-500">{t("fields.required")}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{f.key}</span>
                    <span className="mx-1">·</span>
                    <span>{t(`fieldType.${f.type}` as never)}</span>
                    {f.options ? <span className="ml-1">{t("fields.optionsCount", { count: f.options.length })}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  className="text-muted-foreground hover:text-red-600"
                  aria-label={t("fields.remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {addingField ? (
        <AddFieldDialog
          onClose={() => setAddingField(false)}
          onAdd={(f) => {
            update("fields", [...form.fields, f])
            setAddingField(false)
          }}
          existingKeys={new Set(form.fields.map((x) => x.key))}
        />
      ) : null}
    </div>
  )
}

function AddFieldDialog({
  onClose,
  onAdd,
  existingKeys,
}: {
  onClose: () => void
  onAdd: (f: FormFieldSchema) => void
  existingKeys: Set<string>
}) {
  const t = useTranslations("formsDetailPage")
  const [key, setKey] = useState("")
  const [type, setType] = useState<FormFieldType>("text")
  const [label, setLabel] = useState("")
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState("") // CSV of label=value pairs
  const [error, setError] = useState<string | null>(null)

  const needsOptions = type === "select" || type === "radio" || type === "checkbox"

  const handleAdd = () => {
    setError(null)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) {
      setError(t("dialog.errors.keyFormat"))
      return
    }
    if (existingKeys.has(key)) {
      setError(t("dialog.errors.keyDuplicate"))
      return
    }
    if (!label.trim()) {
      setError(t("dialog.errors.labelRequired"))
      return
    }
    let opts: FormFieldSchema["options"]
    if (needsOptions) {
      opts = options
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [label, value] = pair.includes("=") ? pair.split("=") : [pair, pair]
          return { label: label.trim(), value: value.trim() }
        })
      if (opts.length === 0) {
        setError(t("dialog.errors.optionsRequired"))
        return
      }
    }
    onAdd({ key, type, label, required: required || undefined, options: opts })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground rounded-lg shadow-lg w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{t("dialog.title")}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t("dialog.key")}</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("dialog.keyPlaceholder")} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("dialog.type")}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FormFieldType)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {FORM_FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>{t(`fieldType.${ft}` as never)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("dialog.label")}</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("dialog.labelPlaceholder")} />
          </div>
          {needsOptions ? (
            <div>
              <label className="block text-sm font-medium mb-1">{t("dialog.options")}</label>
              <Input
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder={t("dialog.optionsPlaceholder")}
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4" />
            <span>{t("dialog.required")}</span>
          </label>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>{t("actions.cancel")}</Button>
          <Button onClick={handleAdd}>{t("dialog.title")}</Button>
        </div>
      </div>
    </div>
  )
}
