"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Check, Loader2, Search, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MtmRouteCustomer } from "@/components/mtm/route-types"

type Direction = "DOCTOR" | "PHARMACY" | "ORGANIZATION"

export type RouteBuilderInlineAssignable = {
  id: string
  subjectType: "CONTACT" | "ORGANIZATION"
  kind: Direction
  name: string
  code: string | null
  specialtyName: string | null
  currentOwner: { id: string; name: string } | null
  customer: MtmRouteCustomer
  contact: {
    id: string
    displayName: string
    specialtyName?: string | null
  } | null
}

type PickerResponse = {
  success?: boolean
  error?: string
  data?: {
    targetAgent?: { id: string; name: string }
    items?: RouteBuilderInlineAssignable[]
    limited?: boolean
  }
}

function candidateIdentity(candidate: RouteBuilderInlineAssignable) {
  return `${candidate.subjectType}:${candidate.id}`
}

/**
 * Compact, manager-only recovery inside the route builder. This intentionally
 * stays in the current page: managers can assign an existing scoped/unowned
 * record and add it to today's route without losing their draft.
 */
export function RouteBuilderInlineAssignmentPanel({
  open,
  onOpenChange,
  agentId,
  date,
  direction,
  orgId,
  onAssigned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  date: string
  direction: Direction
  orgId?: string
  onAssigned: (candidate: RouteBuilderInlineAssignable) => void
}) {
  const t = useTranslations("mtmRoutesPage")
  const [search, setSearch] = useState("")
  const [items, setItems] = useState<RouteBuilderInlineAssignable[]>([])
  const [limited, setLimited] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [targetAgentName, setTargetAgentName] = useState("")
  const [confirming, setConfirming] = useState<RouteBuilderInlineAssignable | null>(null)
  const [assigningId, setAssigningId] = useState("")

  useEffect(() => {
    if (!open) {
      setSearch("")
      setItems([])
      setLimited(false)
      setError("")
      setConfirming(null)
      setAssigningId("")
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError("")
      try {
        const params = new URLSearchParams({ agentId, date, direction, limit: "8" })
        if (search.trim()) params.set("search", search.trim())
        const response = await fetch(`/api/v1/mtm/routes/assignable-catalog?${params.toString()}`, {
          headers: orgId ? { "x-organization-id": orgId } : {},
          signal: controller.signal,
        })
        const body = await response.json().catch(() => null) as PickerResponse | null
        if (!response.ok || !body?.success || !body.data) {
          throw new Error(body?.error || t("inlineAssignmentLoadFailed"))
        }
        setItems(body.data.items ?? [])
        setLimited(Boolean(body.data.limited))
        setTargetAgentName(body.data.targetAgent?.name ?? "")
      } catch (loadError) {
        if (controller.signal.aborted) return
        setItems([])
        setLimited(false)
        setError(loadError instanceof Error ? loadError.message : t("inlineAssignmentLoadFailed"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, search.trim() ? 250 : 0)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [agentId, date, direction, open, orgId, search, t])

  async function assignAndAdd(candidate: RouteBuilderInlineAssignable) {
    const identity = candidateIdentity(candidate)
    setAssigningId(identity)
    setError("")
    try {
      const response = await fetch("/api/v1/mtm/field-assignments", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({
          subjectType: candidate.subjectType,
          subjectId: candidate.id,
          agentId,
          role: "PRIMARY",
          effectiveFrom: date,
          reason: `Route builder: ${date}`,
        }),
      })
      const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!response.ok || !body?.success) {
        throw new Error(body?.error || t("inlineAssignmentFailed"))
      }
      onAssigned(candidate)
      toast.success(t("inlineAssignmentSuccess", { name: candidate.name }))
      onOpenChange(false)
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : t("inlineAssignmentFailed"))
    } finally {
      setAssigningId("")
    }
  }

  function requestAssignment(candidate: RouteBuilderInlineAssignable) {
    if (candidate.currentOwner && candidate.currentOwner.id !== agentId) {
      setConfirming(candidate)
      return
    }
    void assignAndAdd(candidate)
  }

  if (!open) return null

  return (
    <section data-testid="mtm-route-inline-assignment" className="mt-2 rounded-lg border border-primary/25 bg-primary/[0.025] p-3 text-left dark:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{t("inlineAssignmentTitle")}</h4>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">
            {t("inlineAssignmentDescription", { agent: targetAgentName || t("selectedEmployee") })}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-h-10 min-w-10"
          onClick={() => onOpenChange(false)}
          title={t("inlineAssignmentClose")}
          aria-label={t("inlineAssignmentClose")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative mt-2">
        <label htmlFor="route-inline-assignment-search" className="sr-only">{t("inlineAssignmentSearchLabel")}</label>
        <Input
          id="route-inline-assignment-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("inlineAssignmentSearchPlaceholder")}
          className="min-h-10 pr-10"
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : (
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {confirming ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
            {t("inlineAssignmentTransferTitle", { name: confirming.name })}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
            {t("inlineAssignmentTransferHint", {
              previousAgent: confirming.currentOwner?.name ?? "—",
              nextAgent: targetAgentName || t("selectedEmployee"),
              date,
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-10" onClick={() => setConfirming(null)} disabled={Boolean(assigningId)}>
              {t("inlineAssignmentCancel")}
            </Button>
            <Button
              type="button"
              className="min-h-10"
              onClick={() => void assignAndAdd(confirming)}
              disabled={Boolean(assigningId)}
            >
              {assigningId === candidateIdentity(confirming) ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <UserPlus className="h-4 w-4" />}
              {t("inlineAssignmentConfirmTransfer")}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("inlineAssignmentNoResults")}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-card dark:divide-zinc-700 dark:border-zinc-700">
          {items.map((candidate) => {
            const identity = candidateIdentity(candidate)
            const transferring = Boolean(candidate.currentOwner && candidate.currentOwner.id !== agentId)
            return (
              <div
                key={identity}
                data-testid="mtm-route-inline-assignment-item"
                className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{candidate.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[candidate.specialtyName, candidate.customer.name, candidate.customer.address ?? candidate.customer.city, candidate.code].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {candidate.currentOwner
                      ? t("inlineAssignmentOwnedBy", { agent: candidate.currentOwner.name })
                      : t("inlineAssignmentUnassigned")}
                  </p>
                </div>
                <Button
                  type="button"
                  data-testid="mtm-route-inline-assignment-add"
                  variant={transferring ? "outline" : "default"}
                  className="min-h-10 shrink-0"
                  onClick={() => requestAssignment(candidate)}
                  disabled={Boolean(assigningId)}
                >
                  {assigningId === identity ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : transferring ? <UserPlus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {transferring ? t("inlineAssignmentTransferAction") : t("inlineAssignmentAddAction")}
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {limited ? <p className="mt-3 text-xs text-muted-foreground">{t("inlineAssignmentLimitedHint")}</p> : null}
    </section>
  )
}
