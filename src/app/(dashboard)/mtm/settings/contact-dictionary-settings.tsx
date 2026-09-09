"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BadgeCheck, BookOpenCheck, Check, FileClock, Loader2, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createDateFormatter } from "@/lib/format-date"

type DictionaryKind = "PSYCHOTYPE" | "PRODUCT_CATEGORY" | "BRAND_CATEGORY" | "TASK_GROUP"
type DictionaryStatus = "DRAFT" | "ACTIVE" | "RETIRED"

interface ContactDictionary {
  id: string
  kind: DictionaryKind
  version: number
  nameRu: string
  nameAz: string
  nameEn: string
  entries: unknown[]
  entriesHash: string
  approvalReference: string | null
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  effectiveFrom: string
  status: DictionaryStatus
  signedAt: string | null
  retiredAt: string | null
  createdAt: string
}

const ENTRY_TEMPLATE = JSON.stringify([
  {
    code: "VALUE_CODE",
    order: 1,
    labels: { ru: "Значение", az: "Dəyər", en: "Value" },
  },
], null, 2)

function statusVariant(status: DictionaryStatus): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success"
  if (status === "DRAFT") return "warning"
  return "outline"
}

export function ContactDictionarySettings() {
  const t = useTranslations("mtmContactDictionaries")
  const locale = useLocale()
  const [dictionaries, setDictionaries] = useState<ContactDictionary[]>([])
  const [canConfigure, setCanConfigure] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [activateTarget, setActivateTarget] = useState<ContactDictionary | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [approvalReference, setApprovalReference] = useState("")
  const [form, setForm] = useState({
    kind: "PSYCHOTYPE" as DictionaryKind,
    version: "1",
    nameRu: "",
    nameAz: "",
    nameEn: "",
    entries: ENTRY_TEMPLATE,
    sourceSystem: "",
    sourceReference: "",
    sourceObservedAt: "",
    effectiveFrom: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/mtm/contact-dictionaries", { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: { dictionaries?: ContactDictionary[]; capabilities?: { canConfigure?: boolean } }
      } | null
      if (!response.ok || !body?.success) throw new Error(body?.error || t("loadFailed"))
      setDictionaries(body.data?.dictionaries ?? [])
      setCanConfigure(Boolean(body.data?.capabilities?.canConfigure))
    } catch (error) {
      const message = error instanceof Error ? error.message : t("loadFailed")
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const ordered = useMemo(() => {
    const rank: Record<DictionaryStatus, number> = { ACTIVE: 0, DRAFT: 1, RETIRED: 2 }
    return [...dictionaries].sort((left, right) => (
      left.kind.localeCompare(right.kind)
      || rank[left.status] - rank[right.status]
      || right.version - left.version
    ))
  }, [dictionaries])

  const dateTime = useMemo(() => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }), [locale])
  const dateOnly = useMemo(() => createDateFormatter(locale, { dateStyle: "medium", timeZone: "UTC" }), [locale])

  const nameFor = (dictionary: ContactDictionary) => {
    if (locale.startsWith("az")) return dictionary.nameAz
    if (locale.startsWith("ru")) return dictionary.nameRu
    return dictionary.nameEn
  }

  const resetCreate = () => {
    setForm({
      kind: "PSYCHOTYPE",
      version: "1",
      nameRu: "",
      nameAz: "",
      nameEn: "",
      entries: ENTRY_TEMPLATE,
      sourceSystem: "",
      sourceReference: "",
      sourceObservedAt: "",
      effectiveFrom: "",
    })
    setFormError("")
  }

  const createDictionary = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError("")
    let entries: unknown
    try {
      entries = JSON.parse(form.entries)
    } catch {
      setFormError(t("entriesInvalid"))
      return
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      setFormError(t("entriesArrayRequired"))
      return
    }
    const observed = new Date(form.sourceObservedAt)
    if (Number.isNaN(observed.getTime())) {
      setFormError(t("sourceObservedRequired"))
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-dictionaries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          version: Number(form.version),
          nameRu: form.nameRu.trim(),
          nameAz: form.nameAz.trim(),
          nameEn: form.nameEn.trim(),
          entries,
          sourceSystem: form.sourceSystem.trim(),
          sourceReference: form.sourceReference.trim() || undefined,
          sourceObservedAt: observed.toISOString(),
          effectiveFrom: form.effectiveFrom,
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || t("createFailed"))
      toast.success(t("created"))
      setCreateOpen(false)
      resetCreate()
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  const activateDictionary = async () => {
    if (!activateTarget || !approvalReference.trim()) return
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/mtm/contact-dictionaries/${activateTarget.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          expectedEntriesHash: activateTarget.entriesHash,
          approvalReference: approvalReference.trim(),
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || t("activateFailed"))
      toast.success(t("activated", { version: activateTarget.version }))
      setActivateTarget(null)
      setApprovalReference("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("activateFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BookOpenCheck className="h-4 w-4 text-muted-foreground" />
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="min-h-11 sm:min-h-8">
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("refresh")}
          </Button>
          {canConfigure ? (
            <Button type="button" size="sm" onClick={() => { resetCreate(); setCreateOpen(true) }} className="min-h-11 sm:min-h-8">
              <Plus className="mr-1 h-4 w-4" />{t("newDictionary")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/20 dark:text-sky-100">
        <p className="font-medium">{t("governanceTitle")}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-80">{t("governanceDescription")}</p>
      </div>

      {loading && dictionaries.length === 0 ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : loadError && dictionaries.length === 0 ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <p>{loadError}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <FileClock className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {ordered.map((dictionary) => (
            <article key={dictionary.id} className={`rounded-lg border p-4 ${dictionary.status === "ACTIVE" ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/15" : "border-zinc-200 bg-card dark:border-zinc-700"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{nameFor(dictionary)}</h3>
                    <Badge variant="outline">{t(`kinds.${dictionary.kind}`)}</Badge>
                    <Badge variant={statusVariant(dictionary.status)}>{t(`statuses.${dictionary.status}`)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("versionEntries", { version: dictionary.version, count: dictionary.entries.length })}</p>
                </div>
                {canConfigure && dictionary.status === "DRAFT" ? (
                  <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={() => { setApprovalReference(""); setActivateTarget(dictionary) }}>
                    <BadgeCheck className="mr-1 h-4 w-4" />{t("activate")}
                  </Button>
                ) : null}
              </div>
              <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{t("effectiveFrom")}</dt><dd className="mt-0.5 font-medium">{dateOnly.format(new Date(dictionary.effectiveFrom))}</dd></div>
                <div><dt className="text-muted-foreground">{t("signedAt")}</dt><dd className="mt-0.5 font-medium">{dictionary.signedAt ? dateTime.format(new Date(dictionary.signedAt)) : t("notSigned")}</dd></div>
                <div><dt className="text-muted-foreground">{t("source")}</dt><dd className="mt-0.5 font-medium">{dictionary.sourceSystem}</dd></div>
                <div><dt className="text-muted-foreground">{t("approval")}</dt><dd className="mt-0.5 break-words font-medium">{dictionary.approvalReference || "—"}</dd></div>
              </dl>
              <details className="mt-4 rounded-md border border-zinc-200 bg-background/80 dark:border-zinc-700">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium">{t("showEntries")}</summary>
                <pre className="max-h-72 overflow-auto border-t border-zinc-200 p-3 text-[11px] leading-relaxed dark:border-zinc-700">{JSON.stringify(dictionary.entries, null, 2)}</pre>
                <p className="break-all border-t border-zinc-200 px-3 py-2 font-mono text-[10px] text-muted-foreground dark:border-zinc-700">SHA-256: {dictionary.entriesHash}</p>
              </details>
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => !saving && setCreateOpen(open)} widthClassName="max-w-4xl">
        <form onSubmit={createDictionary}>
          <DialogHeader><DialogTitle>{t("createTitle")}</DialogTitle><DialogDescription>{t("createDescription")}</DialogDescription></DialogHeader>
          <DialogContent className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="contact-dictionary-kind">{t("kind")}</Label><Select id="contact-dictionary-kind" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as DictionaryKind }))} className="mt-1.5 min-h-11"><option value="PSYCHOTYPE">{t("kinds.PSYCHOTYPE")}</option><option value="PRODUCT_CATEGORY">{t("kinds.PRODUCT_CATEGORY")}</option><option value="BRAND_CATEGORY">{t("kinds.BRAND_CATEGORY")}</option><option value="TASK_GROUP">{t("kinds.TASK_GROUP")}</option></Select></div>
              <div><Label htmlFor="contact-dictionary-version">{t("version")}</Label><Input id="contact-dictionary-version" type="number" min="1" max="1000000" value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} className="mt-1.5 min-h-11" required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["nameRu", "nameAz", "nameEn"] as const).map((key) => <div key={key}><Label htmlFor={`contact-dictionary-${key}`}>{t(key)}</Label><Input id={`contact-dictionary-${key}`} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-1.5 min-h-11" maxLength={200} required /></div>)}
            </div>
            <div><Label htmlFor="contact-dictionary-entries">{t("entries")}</Label><p className="mt-1 text-xs text-muted-foreground">{t("entriesHint")}</p><Textarea id="contact-dictionary-entries" value={form.entries} onChange={(event) => setForm((current) => ({ ...current, entries: event.target.value }))} rows={14} spellCheck={false} className="mt-2 resize-y font-mono text-xs" required /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="contact-dictionary-source">{t("sourceSystem")}</Label><Input id="contact-dictionary-source" value={form.sourceSystem} onChange={(event) => setForm((current) => ({ ...current, sourceSystem: event.target.value }))} className="mt-1.5 min-h-11" maxLength={120} required /></div>
              <div><Label htmlFor="contact-dictionary-source-ref">{t("sourceReference")}</Label><Input id="contact-dictionary-source-ref" value={form.sourceReference} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} className="mt-1.5 min-h-11" maxLength={500} /></div>
              <div><Label htmlFor="contact-dictionary-observed">{t("sourceObservedAt")}</Label><Input id="contact-dictionary-observed" type="datetime-local" value={form.sourceObservedAt} onChange={(event) => setForm((current) => ({ ...current, sourceObservedAt: event.target.value }))} className="mt-1.5 min-h-11" required /></div>
              <div><Label htmlFor="contact-dictionary-effective">{t("effectiveFrom")}</Label><Input id="contact-dictionary-effective" type="date" value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} className="mt-1.5 min-h-11" required /></div>
            </div>
            {formError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">{formError}</p> : null}
          </DialogContent>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>{t("cancel")}</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}{saving ? t("creating") : t("createDraft")}</Button></DialogFooter>
        </form>
      </Dialog>

      <Dialog open={Boolean(activateTarget)} onOpenChange={(open) => !open && !saving && setActivateTarget(null)}>
        <DialogHeader><DialogTitle>{t("activateTitle")}</DialogTitle><DialogDescription>{activateTarget ? t("activateDescription", { name: nameFor(activateTarget), version: activateTarget.version }) : ""}</DialogDescription></DialogHeader>
        <DialogContent className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100"><p className="font-medium">{t("activationEffectTitle")}</p><p className="mt-1 text-xs leading-relaxed opacity-80">{t("activationEffectDescription")}</p></div>
          <div><Label htmlFor="contact-dictionary-approval">{t("approvalReference")}</Label><Input id="contact-dictionary-approval" value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} className="mt-1.5 min-h-11" maxLength={500} required /></div>
        </DialogContent>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setActivateTarget(null)} disabled={saving}>{t("cancel")}</Button><Button type="button" onClick={() => void activateDictionary()} disabled={saving || approvalReference.trim().length < 3}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}{saving ? t("activating") : t("confirmActivation")}</Button></DialogFooter>
      </Dialog>
    </section>
  )
}
