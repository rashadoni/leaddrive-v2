"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Check, CircleAlert, Loader2, Search, Send, X } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type DuplicateCandidate = {
  id: string
  displayName: string
  externalCode: string | null
  type: string
  status: string
  specialtyName: string | null
  workplaces: Array<{
    customer: {
      name: string
      city: string | null
      district: string | null
    }
  }>
}

export type DuplicateChangeRequest = {
  id: string
  kind: string
  status: string
  reason: string
  payload?: unknown
  duplicateTarget?: {
    id: string
    displayName: string
    status: string
    externalCode: string | null
  } | null
}

function operationKey(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === "function") return `contact-duplicate-${cryptoApi.randomUUID()}`
  return `contact-duplicate-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function candidateDetails(candidate: DuplicateCandidate, t: ReturnType<typeof useTranslations>): string {
  const workplace = candidate.workplaces[0]?.customer
  const place = workplace ? [workplace.name, workplace.city, workplace.district].filter(Boolean).join(" · ") : null
  return [candidate.externalCode, candidate.specialtyName, place].filter(Boolean).join(" · ") || t("duplicateCandidateDetailsMissing")
}

export function MtmContactDuplicateReportDialog({
  open,
  onOpenChange,
  contactId,
  contactUpdatedAt,
  orgId,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  contactUpdatedAt: string
  orgId?: string
  onSubmitted: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactDetail")
  const [query, setQuery] = useState("")
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([])
  const [selected, setSelected] = useState<DuplicateCandidate | null>(null)
  const [reason, setReason] = useState("")
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submission = useRef<{ body: string; key: string } | null>(null)
  const headers = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": orgId } : {},
    [orgId],
  )

  useEffect(() => {
    if (!open) return
    setQuery("")
    setCandidates([])
    setSelected(null)
    setReason("")
    setSearching(false)
    setSaving(false)
    setError("")
    submission.current = null
  }, [open])

  const search = async () => {
    const normalized = query.trim()
    if (normalized.length < 2) {
      setError(t("duplicateSearchRequired"))
      return
    }
    setSearching(true)
    setError("")
    try {
      const params = new URLSearchParams({ search: normalized, limit: "20", page: "1" })
      const response = await fetch(`/api/v1/mtm/contacts?${params.toString()}`, { headers })
      const result = await response.json() as { success?: boolean; error?: string; data?: { contacts?: DuplicateCandidate[] } }
      if (!response.ok || !result.success) throw new Error(result.error || t("duplicateSearchFailed"))
      const eligible = (result.data?.contacts ?? []).filter((candidate) => (
        candidate.id !== contactId && !["DUPLICATE", "MERGED"].includes(candidate.status)
      ))
      setCandidates(eligible)
      if (selected && !eligible.some((candidate) => candidate.id === selected.id)) setSelected(null)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : t("duplicateSearchFailed"))
    } finally {
      setSearching(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) {
      setError(t("duplicateTargetRequired"))
      return
    }
    if (reason.trim().length < 3) {
      setError(t("duplicateReasonRequired"))
      return
    }
    const stableBody = JSON.stringify({
      expectedContactUpdatedAt: contactUpdatedAt,
      kind: "DUPLICATE_REPORT",
      payload: { targetContactId: selected.id },
      reason: reason.trim(),
    })
    if (!submission.current || submission.current.body !== stableBody) {
      submission.current = { body: stableBody, key: operationKey() }
    }

    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts/${contactId}/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          idempotencyKey: submission.current.key,
          expectedContactUpdatedAt: contactUpdatedAt,
          kind: "DUPLICATE_REPORT",
          payload: { targetContactId: selected.id },
          reason: reason.trim(),
        }),
      })
      const result = await response.json() as { error?: string; code?: string }
      if (!response.ok) {
        if (result.code === "MTM_CONTACT_CONFLICT") throw new Error(t("duplicateConflict"))
        if (result.code === "MTM_CONTACT_DUPLICATE_TARGET_INVALID") throw new Error(t("duplicateTargetInvalid"))
        throw new Error(result.error || t("duplicateSubmitFailed"))
      }
      await onSubmitted()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("duplicateSubmitFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} widthClassName="max-w-3xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader>
        <DialogTitle>{t("duplicateReportTitle")}</DialogTitle>
        <DialogDescription>{t("duplicateReportDescription")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent className="space-y-5">
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="duplicate-contact-search">{t("duplicateSearchLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="duplicate-contact-search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setError("") }}
                placeholder={t("duplicateSearchPlaceholder")}
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void search()
                  }
                }}
              />
              <Button type="button" variant="outline" className="min-h-11" disabled={searching} onClick={() => void search()}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="hidden sm:inline">{t("duplicateSearchAction")}</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("duplicateSearchHint")}</p>
          </div>

          {candidates.length ? (
            <div className="grid gap-2" role="radiogroup" aria-label={t("duplicateCandidatesLabel")}>
              {candidates.map((candidate) => {
                const active = selected?.id === candidate.id
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn(
                      "grid min-h-11 w-full gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-primary bg-primary/5" : "border-zinc-200 hover:bg-muted/60 dark:border-zinc-700",
                    )}
                    onClick={() => { setSelected(candidate); setError(""); submission.current = null }}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium">{candidate.displayName}</span>
                      {active ? <Check className="h-4 w-4 flex-none text-primary" /> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{candidateDetails(candidate, t)}</span>
                  </button>
                )
              })}
            </div>
          ) : query.trim().length >= 2 && !searching ? (
            <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">{t("duplicateCandidatesEmpty")}</p>
          ) : null}

          {selected ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
              <p className="font-medium">{t("duplicateSelected", { name: selected.displayName })}</p>
              <p className="mt-1 text-xs leading-5">{t("duplicateApprovalHint")}</p>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="duplicate-report-reason">{t("duplicateReasonLabel")} <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Textarea
              id="duplicate-report-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); setError(""); submission.current = null }}
              minLength={3}
              maxLength={1000}
              required
              placeholder={t("duplicateReasonPlaceholder")}
            />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving || !selected}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? t("duplicateSubmitting") : t("duplicateSubmit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function MtmContactDuplicateDecisionDialog({
  open,
  onOpenChange,
  request,
  orgId,
  onDecided,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: DuplicateChangeRequest | null
  orgId?: string
  onDecided: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactDetail")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const headers = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": orgId } : {},
    [orgId],
  )

  useEffect(() => {
    if (!open) return
    setComment("")
    setSaving(false)
    setError("")
  }, [open, request?.id])

  const decide = async (decision: "APPROVED" | "REJECTED" | "NEEDS_INFO") => {
    if (!request) return
    if (decision === "APPROVED" && !request.duplicateTarget) {
      setError(t("duplicateTargetInvalid"))
      return
    }
    if (!comment.trim()) {
      setError(t("duplicateDecisionCommentRequired"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contact-change-requests/${request.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ decision, comment: comment.trim() }),
      })
      const result = await response.json() as { error?: string; code?: string }
      if (!response.ok) {
        if (result.code === "MTM_CONTACT_CONFLICT" || result.code === "MTM_CONTACT_REQUEST_CONFLICT") {
          throw new Error(t("duplicateConflict"))
        }
        if (result.code === "MTM_CONTACT_DUPLICATE_TARGET_INVALID") throw new Error(t("duplicateTargetInvalid"))
        throw new Error(result.error || t("duplicateDecisionFailed"))
      }
      await onDecided()
      onOpenChange(false)
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : t("duplicateDecisionFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogHeader>
        <DialogTitle>{t("duplicateDecisionTitle")}</DialogTitle>
        <DialogDescription>{t("duplicateDecisionDescription")}</DialogDescription>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
            <span>{error}</span>
          </div>
        ) : null}
        {request?.duplicateTarget ? (
          <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-xs font-medium text-muted-foreground">{t("duplicateCanonicalContact")}</p>
            <Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary hover:underline" href={`/mtm/contacts/${request.duplicateTarget.id}`} target="_blank">
              {request.duplicateTarget.displayName}
            </Link>
            <p className="text-xs text-muted-foreground">{request.duplicateTarget.externalCode || t("externalCodeMissing")}</p>
          </div>
        ) : null}
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">{t("duplicateReportedReason")}</p>
          <p className="mt-1">{request?.reason || "—"}</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="duplicate-decision-comment">{t("duplicateDecisionComment")} <span className="text-destructive" aria-hidden="true">*</span></Label>
          <Textarea id="duplicate-decision-comment" value={comment} onChange={(event) => { setComment(event.target.value); setError("") }} maxLength={2000} required placeholder={t("duplicateDecisionCommentPlaceholder")} />
        </div>
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        <Button type="button" variant="destructive" disabled={saving} onClick={() => void decide("REJECTED")}>
          <X className="h-4 w-4" />{t("duplicateReject")}
        </Button>
        <Button type="button" disabled={saving || !request?.duplicateTarget} onClick={() => void decide("APPROVED")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("duplicateApprove")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
