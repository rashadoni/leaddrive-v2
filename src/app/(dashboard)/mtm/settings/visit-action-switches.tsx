"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Camera, Check, ListChecks, Lock, MessageCircle, Package, PenLine, Presentation, StickyNote } from "lucide-react"
import { cn } from "@/lib/utils"
import { explainMtmApiErrorOr, useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import type { VisitPolicyUiAccess } from "@/lib/mtm/visit-policy-ui-access"
import {
  VISIT_SWITCH_ACTION_KEYS,
  companyVisitRule,
  visitActionsAfterSwitch,
  visitSwitchState,
  type VisitSwitchActionKey,
  type VisitSwitchRule,
} from "@/lib/mtm/visit-action-switches"

const ICONS: Record<VisitSwitchActionKey, typeof Camera> = {
  PHOTO: Camera,
  PRESENTATION: Presentation,
  SIGNATURE: PenLine,
  VISIT_NOTE: StickyNote,
  STOCK_CHECK: Package,
  FEEDBACK: MessageCircle,
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string }

function Switch({ on, tone, disabled, label, onToggle }: {
  on: boolean
  tone: "shown" | "required"
  disabled: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          on ? (tone === "required" ? "bg-rose-600" : "bg-primary") : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white transition-transform", on ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  )
}

/**
 * «What an agent does on a visit» — every visit action as two switches.
 *
 * A switch is a write, at once, to the organization-wide visit rule the
 * resolver already reads (`companyVisitRule`); the first switch of an
 * organization without one creates it. The row then shows what the server
 * holds after the reload, not what was pressed.
 */
export function VisitActionSwitches({ rules, access, loading, onSaved, legacyPhotoRequired = false }: {
  rules: VisitSwitchRule[]
  access: VisitPolicyUiAccess | null
  loading: boolean
  onSaved: () => Promise<void>
  /** The older «photo required on every visit» setting; see VisitSwitchDefaults. */
  legacyPhotoRequired?: boolean
}) {
  const t = useTranslations("mtmVisitPolicies")
  const explainError = useMtmApiError()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const rule = companyVisitRule(rules)
  const defaults = { legacyPhotoRequired }
  // No access block means the feature answered without one: the server decides.
  const readOnly = access ? !access.canWriteOrganizationWide : false
  const busy = loading || status.kind === "saving"

  const move = async (actionKey: VisitSwitchActionKey, change: { shown?: boolean; required?: boolean }) => {
    if (busy || readOnly) return
    setStatus({ kind: "saving" })
    const actions = visitActionsAfterSwitch(rule, actionKey, change, defaults)
    try {
      const response = rule?.id
        ? await fetch(`/api/v1/mtm/visit-policies/${rule.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actions }),
          })
        : await fetch("/api/v1/mtm/visit-policies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: t("companyRuleName"),
              teamId: null,
              visitType: "DEFAULT",
              priority: 100,
              effectiveFrom: new Date().toISOString().slice(0, 10),
              effectiveTo: null,
              isActive: true,
              actions,
            }),
          })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setStatus({ kind: "failed", message: explainMtmApiErrorOr(explainError, body, response.status, t("simpleSaveFailed")) })
        return
      }
      await onSaved()
      setStatus({ kind: "saved" })
    } catch {
      setStatus({ kind: "failed", message: t("simpleSaveFailed") })
    }
  }

  return (
    <div className="max-w-2xl rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800" data-testid="visit-action-switches">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">{t("simpleTitle")}</h2>
        <p className="min-h-5 text-sm" role="status" data-testid="visit-action-switches-status">
          {status.kind === "saving" ? <span className="text-muted-foreground">{t("simpleSaving")}</span> : null}
          {status.kind === "saved" ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" aria-hidden="true" />{t("simpleSaved")}
            </span>
          ) : null}
        </p>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{t("simpleScope")}</p>

      {status.kind === "failed" ? (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{status.message}</span>
        </p>
      ) : null}
      {readOnly ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" data-testid="visit-action-switches-read-only">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />{t("simpleReadOnly")}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-2">
        <span />
        <span className="text-center text-xs font-medium text-muted-foreground">{t("colShown")}</span>
        <span className="text-center text-xs font-medium text-muted-foreground">{t("colRequired")}</span>

        {VISIT_SWITCH_ACTION_KEYS.map((actionKey) => {
          const state = visitSwitchState(rule, actionKey, defaults)
          const Icon = ICONS[actionKey]
          const name = t(`actions.${actionKey}`)
          return (
            <div key={actionKey} className="col-span-3 grid grid-cols-subgrid items-center border-t border-zinc-200 py-1 dark:border-zinc-800" data-testid={`visit-action-switch-${actionKey}`}>
              <div className={cn("min-w-0 py-1.5", !state.shown && "opacity-60")}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`actionHints.${actionKey}`)}{state.conditional ? ` · ${t("simpleConditional")}` : ""}
                </p>
              </div>
              <span className="flex justify-center">
                <Switch
                  on={state.shown}
                  tone="shown"
                  disabled={busy || readOnly}
                  label={t("switchShown", { action: name })}
                  onToggle={() => { void move(actionKey, { shown: !state.shown }) }}
                />
              </span>
              <span className="flex justify-center">
                <Switch
                  on={state.required}
                  tone="required"
                  disabled={busy || readOnly || !state.shown}
                  label={t("switchRequired", { action: name })}
                  onToggle={() => { void move(actionKey, { required: !state.required }) }}
                />
              </span>
            </div>
          )
        })}

        <div className="col-span-3 grid grid-cols-subgrid items-center border-t border-zinc-200 py-1 dark:border-zinc-800">
          <div className="min-w-0 py-1.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("simpleTasks")}
            </p>
            <p className="text-xs text-muted-foreground">{t("simpleTasksHint")}</p>
          </div>
          <span className="col-span-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />{t("simpleAlways")}
          </span>
        </div>
      </div>

      <p className="mt-2 border-t border-zinc-200 pt-2 text-xs text-muted-foreground dark:border-zinc-800">{t("simpleRequiredHint")}</p>
    </div>
  )
}
