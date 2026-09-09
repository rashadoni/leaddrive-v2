"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BadgeCheck, CircleAlert, History, Pencil, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"

type Labels = { ru: string; az: string; en: string }

export type GovernedContactDictionary = {
  id: string
  kind: "PSYCHOTYPE" | "PRODUCT_CATEGORY" | "BRAND_CATEGORY"
  version: number
  nameRu: string
  nameAz: string
  nameEn: string
  approvalReference: string | null
  signedAt: string | null
  entries: Array<{ code: string; order: number; labels: Labels; description?: Labels }>
}

export type GovernedContactDictionaryAssignment = {
  id: string
  dictionaryId: string
  kind: "PSYCHOTYPE" | "PRODUCT_CATEGORY" | "BRAND_CATEGORY"
  entryCode: string
  effectiveFrom: string
  effectiveTo: string | null
  source: string
  valid: boolean
  issue: string | null
  entry: { code: string; order: number; labels: Labels; description?: Labels } | null
  dictionary: {
    id: string
    kind: string
    version: number
    nameRu: string
    nameAz: string
    nameEn: string
    approvalReference: string | null
    signedAt: string | null
    retiredAt: string | null
    status: string
  }
}

type DictionaryChangeRequest = {
  id: string
  kind: string
  status: string
  reason: string
  payload: unknown
  submittedAt: string
  requestedByAgent: { id: string; name: string }
}

type ReviewTarget = { id: string; decision: "APPROVED" | "REJECTED" }

function localized(labels: Labels, locale: string): string {
  return locale.startsWith("az") ? labels.az : locale.startsWith("ru") ? labels.ru : labels.en
}

function AssignmentBadge({
  assignment,
  locale,
}: {
  assignment: GovernedContactDictionaryAssignment
  locale: string
}) {
  return (
    <span className={cn(
      "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
      assignment.valid
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
        : "bg-amber-100 text-amber-950 dark:bg-amber-900/30 dark:text-amber-100",
    )}>
      {assignment.valid ? <BadgeCheck className="h-3.5 w-3.5 flex-none" /> : <CircleAlert className="h-3.5 w-3.5 flex-none" />}
      <span className="truncate">{assignment.entry ? localized(assignment.entry.labels, locale) : assignment.entryCode}</span>
    </span>
  )
}

export function MtmContactDictionaryAssignmentPanel({
  contactId,
  contactUpdatedAt,
  stateHash,
  dictionaries,
  assignments,
  changeRequests,
  canManage,
  canRequestChanges,
  orgId,
  onChanged,
}: {
  contactId: string
  contactUpdatedAt: string
  stateHash: string
  dictionaries: GovernedContactDictionary[]
  assignments: GovernedContactDictionaryAssignment[]
  changeRequests: DictionaryChangeRequest[]
  canManage: boolean
  canRequestChanges: boolean
  orgId?: string
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactDictionaryAssignments")
  const locale = useLocale()
  const dateFormatter = useMemo(() => createDateFormatter(locale, { dateStyle: "medium" }), [locale])
  const [editOpen, setEditOpen] = useState(false)
  const [psychotypeCode, setPsychotypeCode] = useState("")
  const [productCodes, setProductCodes] = useState<string[]>([])
  const [brandCodes, setBrandCodes] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [reviewComment, setReviewComment] = useState("")

  const current = assignments.filter((assignment) => assignment.effectiveTo === null)
  const historical = assignments.filter((assignment) => assignment.effectiveTo !== null)
  const dictionaryByKind = useMemo(() => new Map(dictionaries.map((dictionary) => [dictionary.kind, dictionary])), [dictionaries])
  const psychotypeDictionary = dictionaryByKind.get("PSYCHOTYPE")
  const productDictionary = dictionaryByKind.get("PRODUCT_CATEGORY")
  const brandDictionary = dictionaryByKind.get("BRAND_CATEGORY")
  const currentByKind = (kind: string) => current.filter((assignment) => assignment.kind === kind)
  const pendingRequests = changeRequests.filter((request) => (
    request.kind === "DICTIONARY_ASSIGNMENTS"
    && ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(request.status)
  ))
  const requestedValues = (payload: unknown): string => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return t("proposalUnavailable")
    const value = payload as Record<string, unknown>
    const labels: string[] = []
    const addCodes = (selection: unknown, single: boolean) => {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) return
      const record = selection as Record<string, unknown>
      const dictionaryId = typeof record.dictionaryId === "string" ? record.dictionaryId : ""
      const dictionary = dictionaries.find((candidate) => candidate.id === dictionaryId)
      const codes = single
        ? (typeof record.code === "string" ? [record.code] : [])
        : (Array.isArray(record.codes) ? record.codes.filter((code): code is string => typeof code === "string") : [])
      for (const code of codes) {
        const entry = dictionary?.entries.find((candidate) => candidate.code === code)
        labels.push(entry ? localized(entry.labels, locale) : code)
      }
    }
    addCodes(value.psychotype, true)
    addCodes(value.productCategories, false)
    addCodes(value.brandCategories, false)
    return labels.join(", ") || t("proposalClearsAll")
  }

  const openEditor = () => {
    const psychotype = currentByKind("PSYCHOTYPE").find((assignment) => assignment.dictionaryId === psychotypeDictionary?.id && assignment.valid)
    setPsychotypeCode(psychotype?.entryCode ?? "")
    setProductCodes(currentByKind("PRODUCT_CATEGORY")
      .filter((assignment) => assignment.dictionaryId === productDictionary?.id && assignment.valid)
      .map((assignment) => assignment.entryCode))
    setBrandCodes(currentByKind("BRAND_CATEGORY")
      .filter((assignment) => assignment.dictionaryId === brandDictionary?.id && assignment.valid)
      .map((assignment) => assignment.entryCode))
    setReason("")
    setError("")
    setEditOpen(true)
  }

  const toggleCode = (code: string, values: string[], update: (next: string[]) => void) => {
    update(values.includes(code) ? values.filter((value) => value !== code) : [...values, code])
  }

  const assignmentPayload = () => ({
    expectedStateHash: stateHash,
    reason: reason.trim(),
    psychotype: psychotypeDictionary && psychotypeCode
      ? { dictionaryId: psychotypeDictionary.id, code: psychotypeCode }
      : null,
    productCategories: productDictionary
      ? { dictionaryId: productDictionary.id, codes: productCodes }
      : null,
    brandCategories: brandDictionary
      ? { dictionaryId: brandDictionary.id, codes: brandCodes }
      : null,
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setError(t("reasonError"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const payload = assignmentPayload()
      const response = canManage
        ? await fetch(`/api/v1/mtm/contacts/${contactId}/dictionary-assignments`, {
            method: "PUT",
            headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
            body: JSON.stringify({ ...payload, expectedContactUpdatedAt: contactUpdatedAt }),
          })
        : await fetch(`/api/v1/mtm/contacts/${contactId}/change-requests`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
            body: JSON.stringify({
              idempotencyKey: crypto.randomUUID(),
              reason: reason.trim(),
              expectedContactUpdatedAt: contactUpdatedAt,
              kind: "DICTIONARY_ASSIGNMENTS",
              payload,
            }),
          })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || t("saveError"))
      setEditOpen(false)
      await onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  const review = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviewTarget || reviewComment.trim().length < 1) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contact-change-requests/${reviewTarget.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({ decision: reviewTarget.decision, comment: reviewComment.trim() }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || t("reviewError"))
      setReviewTarget(null)
      setReviewComment("")
      await onChanged()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : t("reviewError"))
    } finally {
      setSaving(false)
    }
  }

  const renderAssignmentGroup = (kind: "PSYCHOTYPE" | "PRODUCT_CATEGORY" | "BRAND_CATEGORY") => {
    const rows = currentByKind(kind)
    return rows.length ? (
      <div className="flex flex-wrap gap-2">
        {rows.map((assignment) => <AssignmentBadge key={assignment.id} assignment={assignment} locale={locale} />)}
      </div>
    ) : <span className="text-sm text-muted-foreground">{t("empty")}</span>
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
          <div className="grid gap-1">
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
          </div>
        </div>
        {(canManage || canRequestChanges) ? (
          <Button type="button" variant="outline" className="min-h-11" onClick={openEditor} disabled={!dictionaries.length && !current.length}>
            <Pencil className="h-4 w-4" />
            {canManage ? t("edit") : t("suggest")}
          </Button>
        ) : null}
      </div>

      <div className="grid border-t border-zinc-200 dark:border-zinc-700 lg:grid-cols-[0.8fr_1fr_1.2fr] lg:divide-x lg:divide-zinc-200 lg:dark:divide-zinc-700">
        {([
          ["PSYCHOTYPE", "psychotype"],
          ["PRODUCT_CATEGORY", "productCategories"],
          ["BRAND_CATEGORY", "brandCategories"],
        ] as const).map(([kind, label]) => (
          <div key={kind} className="grid content-start gap-3 border-b border-zinc-200 p-4 last:border-b-0 dark:border-zinc-700 lg:border-b-0 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t(label)}</h3>
              {dictionaryByKind.has(kind) ? (
                <span className="text-xs text-muted-foreground">v{dictionaryByKind.get(kind)?.version}</span>
              ) : (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("dictionaryMissing")}</span>
              )}
            </div>
            {renderAssignmentGroup(kind)}
            {dictionaryByKind.get(kind)?.approvalReference ? (
              <span className="text-xs text-muted-foreground">{t("approval", { value: dictionaryByKind.get(kind)!.approvalReference! })}</span>
            ) : null}
          </div>
        ))}
      </div>

      {pendingRequests.length ? (
        <div className="grid gap-3 border-t border-zinc-200 bg-amber-50/60 p-4 dark:border-zinc-700 dark:bg-amber-950/10 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4" />{t("pendingTitle")}</div>
          {pendingRequests.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="grid gap-1">
                <span>{request.requestedByAgent.name} · {request.reason}</span>
                <span className="text-xs text-muted-foreground">{t("proposed", { value: requestedValues(request.payload) })}</span>
                <span className="text-xs text-muted-foreground">{dateFormatter.format(new Date(request.submittedAt))}</span>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setReviewTarget({ id: request.id, decision: "REJECTED" }); setReviewComment(""); setError("") }}>{t("reject")}</Button>
                  <Button type="button" size="sm" onClick={() => { setReviewTarget({ id: request.id, decision: "APPROVED" }); setReviewComment(""); setError("") }}>{t("approve")}</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {historical.length ? (
        <details className="group border-t border-zinc-200 p-4 dark:border-zinc-700 sm:p-5">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" />{t("history", { count: historical.length })}
          </summary>
          <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-700">
            {historical.map((assignment) => (
              <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <AssignmentBadge assignment={assignment} locale={locale} />
                <span className="text-xs text-muted-foreground">
                  {dateFormatter.format(new Date(assignment.effectiveFrom))} — {dateFormatter.format(new Date(assignment.effectiveTo!))} · v{assignment.dictionary.version}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{canManage ? t("editTitle") : t("suggestTitle")}</DialogTitle>
              <DialogDescription>{t("editDescription")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="contact-psychotype">{t("psychotype")}</Label>
              {psychotypeDictionary ? (
                <Select id="contact-psychotype" className="min-h-11" value={psychotypeCode || "__none__"} onChange={(event) => setPsychotypeCode(event.target.value === "__none__" ? "" : event.target.value)}>
                  <option value="__none__">{t("none")}</option>
                  {psychotypeDictionary.entries.map((entry) => (
                    <option key={entry.code} value={entry.code}>{localized(entry.labels, locale)}</option>
                  ))}
                </Select>
              ) : <p className="text-sm text-amber-700 dark:text-amber-300">{t("dictionaryMissingHelp")}</p>}
            </div>

            {([
              [productDictionary, productCodes, setProductCodes, "productCategories"],
              [brandDictionary, brandCodes, setBrandCodes, "brandCategories"],
            ] as const).map(([dictionary, values, update, label]) => (
              <fieldset key={label} className="grid gap-3">
                <legend className="text-sm font-medium">{t(label)}</legend>
                {dictionary ? (
                  <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-zinc-200 p-3 dark:border-zinc-700 sm:grid-cols-2">
                    {dictionary.entries.map((entry) => (
                      <label key={entry.code} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted/60">
                        <input
                          type="checkbox"
                          checked={values.includes(entry.code)}
                          onChange={() => toggleCode(entry.code, [...values], update)}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-zinc-600"
                        />
                        <span className="grid gap-0.5 text-sm">
                          <span>{localized(entry.labels, locale)}</span>
                          <span className="text-xs text-muted-foreground">{entry.code}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : <p className="text-sm text-amber-700 dark:text-amber-300">{t("dictionaryMissingHelp")}</p>}
              </fieldset>
            ))}

            <div className="grid gap-2">
              <Label htmlFor="contact-category-reason">{t("reason")}</Label>
              <Textarea id="contact-category-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} required />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={saving}>{saving ? t("saving") : canManage ? t("save") : t("submit")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewTarget !== null} onOpenChange={(open) => { if (!open) setReviewTarget(null) }}>
        <DialogContent>
          <form onSubmit={review} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{reviewTarget?.decision === "APPROVED" ? t("approveTitle") : t("rejectTitle")}</DialogTitle>
              <DialogDescription>{t("reviewDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="dictionary-review-comment">{t("reviewComment")}</Label>
              <Textarea id="dictionary-review-comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} required />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReviewTarget(null)}>{t("cancel")}</Button>
              <Button type="submit" disabled={saving}>{t("confirm")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
