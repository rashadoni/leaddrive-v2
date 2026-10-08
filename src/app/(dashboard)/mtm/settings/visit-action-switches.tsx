"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Camera, Check, ChevronDown, ListChecks, Lock, MessageCircle, Package, PenLine, Presentation, StickyNote } from "lucide-react"
import { cn } from "@/lib/utils"
import { MTM_CONTACT_CLASS_PRIORITY } from "@/lib/mtm/contact-classes"
import { explainMtmApiErrorOr, useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import {
  SPECIAL_RULE_PRIORITY,
  VISIT_SWITCH_ACTION_KEYS,
  visitActionDetail,
  visitActionRefined,
  visitActionsAfterDetail,
  visitActionsAfterSwitch,
  visitSwitchState,
  type VisitActionDetail,
  type VisitSwitchAction,
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

/** The kinds of institution a rule may name; the classes are those of the client card. */
const CLIENT_KINDS = ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"] as const

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string }

const fieldClass = "h-9 w-full rounded-md border border-zinc-200 bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"

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
 * One rule as a table: every visit action with two switches — shown to the
 * agent, required to finish the visit — and, one press away, the refinements
 * the server acts on.
 *
 * A change is a write, at once, to the rule the resolver reads. The company
 * table (`companyWide`) creates its rule on the first change; a group's rule
 * exists before its table is drawn. The row then shows what the server holds
 * after the reload, not what was pressed.
 *
 * The same table stands for the whole company and for every special rule, so
 * a person learns one thing (owner, 2026-10-08, shown the old three-card
 * editor under the new switches: «эту часть ты оставил без изменений»).
 */
export function VisitActionSwitches({
  rule,
  companyWide = false,
  readOnly,
  readOnlyNote,
  loading,
  onSaved,
  legacyPhotoRequired = false,
  title,
  scope,
  testId = "visit-action-switches",
  embedded = false,
}: {
  rule: VisitSwitchRule | null
  /** The table of the organization-wide rule: it may not exist yet and is created by the first change. */
  companyWide?: boolean
  readOnly: boolean
  /** Why nothing here can be pressed, in place of a silent grey table. */
  readOnlyNote?: string
  loading: boolean
  onSaved: () => Promise<void>
  /** The older «photo required on every visit» setting; see VisitSwitchDefaults. */
  legacyPhotoRequired?: boolean
  title: string
  scope?: string
  testId?: string
  /** Inside another card: no frame of its own. */
  embedded?: boolean
}) {
  const t = useTranslations("mtmVisitPolicies")
  const explainError = useMtmApiError()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [openKey, setOpenKey] = useState<VisitSwitchActionKey | null>(null)
  // The photo minimum while it is being typed, so that clearing the field to
  // type another number does not write «1» in between.
  const [minDraft, setMinDraft] = useState<string | null>(null)
  const defaults = { legacyPhotoRequired: companyWide && legacyPhotoRequired }
  const busy = loading || status.kind === "saving"
  const locked = busy || readOnly

  const write = async (actions: VisitSwitchAction[]) => {
    if (locked || (!rule?.id && !companyWide)) return
    setStatus({ kind: "saving" })
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
              priority: SPECIAL_RULE_PRIORITY,
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
  const move = (actionKey: VisitSwitchActionKey, change: { shown?: boolean; required?: boolean }) => {
    void write(visitActionsAfterSwitch(rule, actionKey, change, defaults))
  }
  const refine = (actionKey: VisitSwitchActionKey, change: Partial<VisitActionDetail>) => {
    void write(visitActionsAfterDetail(rule, actionKey, change, defaults))
  }
  const commitMinimum = (current: number) => {
    const typed = minDraft === null ? Number.NaN : Number(minDraft.trim())
    setMinDraft(null)
    if (Number.isInteger(typed) && typed >= 1 && typed !== current) refine("PHOTO", { minCount: typed })
  }

  // What a refinement narrows the action to, in words, under its name.
  const refinedText = (actionKey: VisitSwitchActionKey, detail: VisitActionDetail, required: boolean) => [
    detail.customerClass ? t("refinedClass", { value: detail.customerClass }) : null,
    detail.clientKind ? t("refinedKind", { value: t(`objectTypes.${detail.clientKind}`) }) : null,
    actionKey === "PHOTO" && required && detail.minCount > 1 ? t("refinedMinimum", { count: detail.minCount }) : null,
  ].filter(Boolean).join(" · ")

  return (
    <div
      className={cn("h-full", embedded ? "" : "rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700")}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={embedded ? "text-sm font-semibold" : "text-base font-semibold"}>{title}</h2>
        <p className="min-h-5 text-sm" role="status" data-testid={`${testId}-status`}>
          {status.kind === "saving" ? <span className="text-muted-foreground">{t("simpleSaving")}</span> : null}
          {status.kind === "saved" ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" aria-hidden="true" />{t("simpleSaved")}
            </span>
          ) : null}
        </p>
      </div>
      {scope ? <p className="mt-0.5 text-sm text-muted-foreground">{scope}</p> : null}

      {status.kind === "failed" ? (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{status.message}</span>
        </p>
      ) : null}
      {readOnly ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" data-testid={`${testId}-read-only`}>
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />{readOnlyNote ?? t("simpleReadOnly")}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem_5rem_2.75rem] items-center gap-x-1">
        <span />
        <span className="text-center text-xs font-medium text-muted-foreground">{t("colShown")}</span>
        <span className="text-center text-xs font-medium text-muted-foreground">{t("colRequired")}</span>
        <span />

        {VISIT_SWITCH_ACTION_KEYS.map((actionKey) => {
          const state = visitSwitchState(rule, actionKey, defaults)
          const detail = visitActionDetail(rule, actionKey)
          const refined = visitActionRefined(rule, actionKey)
          const open = openKey === actionKey
          const Icon = ICONS[actionKey]
          const name = t(`actions.${actionKey}`)
          const narrowed = refinedText(actionKey, detail, state.required)
          return (
            <div key={actionKey} className="col-span-4 grid grid-cols-subgrid items-center border-t border-zinc-200 py-1 dark:border-zinc-800" data-testid={`${testId}-row-${actionKey}`}>
              <div className={cn("min-w-0 py-1.5", !state.shown && "opacity-60")}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {narrowed
                    ? <span className="font-medium text-foreground" data-testid={`${testId}-refined-${actionKey}`}>{narrowed}</span>
                    : t(`actionHints.${actionKey}`)}
                </p>
              </div>
              <span className="flex justify-center">
                <Switch
                  on={state.shown}
                  tone="shown"
                  disabled={locked}
                  label={t("switchShown", { action: name })}
                  onToggle={() => move(actionKey, { shown: !state.shown })}
                />
              </span>
              <span className="flex justify-center">
                <Switch
                  on={state.required}
                  tone="required"
                  disabled={locked || !state.shown}
                  label={t("switchRequired", { action: name })}
                  onToggle={() => move(actionKey, { required: !state.required })}
                />
              </span>
              <button
                type="button"
                aria-expanded={open}
                aria-label={t("refineToggle", { action: name })}
                title={t("refineToggle", { action: name })}
                onClick={() => { setMinDraft(null); setOpenKey(open ? null : actionKey) }}
                className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
                {refined && !open ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
              </button>

              {open ? (
                <div className="col-span-4 mb-2 rounded-md bg-muted/50 p-3" data-testid={`${testId}-refine-${actionKey}`}>
                  <div className={cn("grid gap-3", actionKey === "PHOTO" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                    {actionKey === "PHOTO" ? (
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">{t("refineMinimum")}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={100}
                          step={1}
                          value={minDraft ?? String(detail.minCount)}
                          disabled={locked || !state.required}
                          onChange={(event) => setMinDraft(event.target.value)}
                          onBlur={() => commitMinimum(detail.minCount)}
                          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur() }}
                          className={fieldClass}
                        />
                      </label>
                    ) : null}
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">{t("refineClass")}</span>
                      <select
                        value={detail.customerClass ?? ""}
                        disabled={locked || !state.shown}
                        onChange={(event) => refine(actionKey, { customerClass: event.target.value || null })}
                        className={fieldClass}
                      >
                        <option value="">{t("refineAny")}</option>
                        {MTM_CONTACT_CLASS_PRIORITY.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">{t("refineKind")}</span>
                      <select
                        value={detail.clientKind ?? ""}
                        disabled={locked || !state.shown}
                        onChange={(event) => refine(actionKey, { clientKind: event.target.value || null })}
                        className={fieldClass}
                      >
                        <option value="">{t("refineAny")}</option>
                        {CLIENT_KINDS.map((value) => <option key={value} value={value}>{t(`objectTypes.${value}`)}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {actionKey === "PHOTO" && !state.required ? `${t("refineMinimumNeedsRequired")} ` : ""}{t("refineHint")}
                  </p>
                </div>
              ) : null}
            </div>
          )
        })}

        {companyWide ? (
          <div className="col-span-4 grid grid-cols-subgrid items-center border-t border-zinc-200 py-1 dark:border-zinc-800">
            <div className="min-w-0 py-1.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("simpleTasks")}
              </p>
              <p className="text-xs text-muted-foreground">{t("simpleTasksHint")}</p>
            </div>
            <span className="col-span-3 flex min-h-11 items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />{t("simpleAlways")}
            </span>
          </div>
        ) : null}
      </div>

      {companyWide ? (
        <p className="mt-2 border-t border-zinc-200 pt-2 text-xs text-muted-foreground dark:border-zinc-800">{t("simpleRequiredHint")}</p>
      ) : null}
    </div>
  )
}
