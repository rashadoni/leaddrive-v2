"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, ChevronRight, Info, Loader2, Minus } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { PICKER_NONE, type AgentClientPicker, type PickerOption } from "@/lib/mtm/agent-client-picker"

/**
 * «Клиенты» tab of an agent's card (owner, 2026-10-16): specialty → city →
 * district, then the doctors that match, grouped by institution and all ticked;
 * a whole institution or a single doctor can be left out. What is ticked is
 * handed to the card, which assigns it after saving the agent — through the
 * same preview → apply as «Клиенты → Закрепить». The view was shown to the
 * owner as a picture first («да, делай»). The agent's own page offers the same
 * picker on «Привязать ещё клиентов» (owner, same day: «да, сюда тоже»).
 */

type Selection = { specialties: string[]; cities: string[]; districts: string[] }
type PickerData = AgentClientPicker & { asOf: string }

export type AgentClientChoice = { contactIds: string[]; asOf: string | null }

const DOCTORS_SHOWN_IN_GROUP = 4

function TickBox({ state }: { state: "on" | "off" | "some" | "locked" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2",
        state === "on" && "border-primary bg-primary text-primary-foreground",
        state === "some" && "border-primary bg-background text-primary",
        state === "off" && "border-zinc-300 bg-background dark:border-zinc-600",
        state === "locked" && "border-zinc-300 bg-zinc-200 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
      )}
    >
      {state === "on" || state === "locked" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === "some" ? <Minus className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  )
}

function StepSelect({ step, label, options, selected, disabled, disabledHint, onChange, testId }: {
  step: number
  label: string
  options: PickerOption[]
  selected: string[]
  disabled: boolean
  disabledHint: string
  onChange: (values: string[]) => void
  testId: string
}) {
  const t = useTranslations("mtmForms")
  const nameOf = (value: string) => {
    const option = options.find(item => item.value === value)
    return option?.label ?? t("clientsNotStated")
  }
  const summary = selected.length === 0 ? t("clientsAll") : selected.length === 1 ? nameOf(selected[0]) : `${nameOf(selected[0])} +${selected.length - 1}`
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{step}. {label}</div>
      <Popover>
        {/* The hint sits on a full-width block: a disabled button gets no
            pointer, and Hint's own inline wrapper shrank the field. */}
        <Hint text={disabled ? disabledHint : null}>
          <div className="w-full" tabIndex={disabled ? 0 : undefined}>
          <PopoverTrigger asChild disabled={disabled}>
            <button
              type="button"
              data-testid={testId}
              className={cn(
                "flex h-10 w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                selected.length > 0 ? "border-primary bg-primary/5 font-semibold" : "border-input bg-background",
              )}
            >
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          </div>
        </Hint>
        {/* Above the agent dialog, which is itself a layer (z-60). */}
        <PopoverContent align="start" className="z-[70] max-h-80 w-64 overflow-y-auto p-1.5" data-testid={`${testId}-options`}>
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-muted", selected.length === 0 && "bg-primary/10 font-semibold")}
          >
            <span>{t("clientsAll")}</span><span className="tabular-nums text-muted-foreground">{total}</span>
          </button>
          {options.map(option => (
            <label key={option.value} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-muted", selected.includes(option.value) && "bg-primary/10 font-semibold")}>
              <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} />
              <span className={cn("min-w-0 flex-1 truncate", option.label === null && "italic text-muted-foreground")}>{option.label ?? t("clientsNotStated")}</span>
              <span className="tabular-nums text-muted-foreground">{option.count}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function MtmAgentClientPicker({ agentId, orgId, onChange, refresh = 0, onForbidden }: {
  /** The card being edited; null for a new agent. */
  agentId: string | null
  orgId?: string
  onChange: (choice: AgentClientChoice) => void
  /** Raised after doctors were assigned elsewhere: asks again, keeping the steps. */
  refresh?: number
  /** Someone who may not assign doctors: the page offers its list instead. */
  onForbidden?: () => void
}) {
  const t = useTranslations("mtmForms")
  const [selection, setSelection] = useState<Selection>({ specialties: [], cities: [], districts: [] })
  const [data, setData] = useState<PickerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (agentId) params.set("agentId", agentId)
    for (const value of selection.specialties) params.append("specialty", value)
    for (const value of selection.cities) params.append("city", value)
    for (const value of selection.districts) params.append("district", value)
    setLoading(true)
    setProblem(null)
    fetch(`/api/v1/mtm/contacts/agent-picker?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: orgId ? { "x-organization-id": orgId } : {},
    })
      .then(async response => {
        const body = await response.json().catch(() => null) as { success?: boolean; code?: string; data?: PickerData } | null
        if (response.status === 403 && body?.code === "MTM_CONTACT_ASSIGNMENT_FORBIDDEN" && onForbidden) {
          onForbidden()
          return
        }
        if (!response.ok || !body?.success || !body.data) throw new Error(body?.code ?? "failed")
        setData(body.data)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setProblem(error instanceof Error && error.message === "MTM_AGENT_PICKER_TOO_LARGE" ? "clientsTooLarge" : "clientsLoadFailed")
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // onForbidden is read when the answer comes, not a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, orgId, selection, refresh])

  // Nothing is listed, nor ticked, before a specialty is chosen: a card opened
  // and closed again must not take every doctor of the company along.
  const chosenFirstStep = selection.specialties.length > 0
  const groups = useMemo(() => (chosenFirstStep ? data?.groups ?? [] : []), [chosenFirstStep, data])
  const selectable = useMemo(() => groups.flatMap(group => group.contacts.filter(contact => !contact.assignedHere).map(contact => contact.id)), [groups])
  const chosen = useMemo(() => selectable.filter(id => !excluded.has(id)), [selectable, excluded])
  const chosenKey = chosen.join(",")

  useEffect(() => {
    onChange({ contactIds: chosenKey ? chosenKey.split(",") : [], asOf: data?.asOf ?? null })
    // The ids travel as their joined key: the list is rebuilt on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, data?.asOf])

  const setStep = (step: keyof Selection, values: string[]) => {
    setSelection(current => step === "specialties"
      ? { specialties: values, cities: [], districts: [] }
      : step === "cities" ? { ...current, cities: values, districts: [] } : { ...current, districts: values })
  }
  const toggle = (ids: string[], include: boolean) => setExcluded(current => {
    const next = new Set(current)
    for (const id of ids) {
      if (include) next.delete(id)
      else next.add(id)
    }
    return next
  })
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  return (
    <div className="space-y-4" data-testid="agent-client-picker">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-2">
        <StepSelect step={1} label={t("clientsStepSpecialty")} options={data?.specialties ?? []} selected={selection.specialties}
          disabled={!data} disabledHint={t("clientsLoading")} onChange={values => setStep("specialties", values)} testId="agent-clients-specialty" />
        <ChevronRight className="hidden h-5 w-5 shrink-0 self-center text-zinc-300 sm:mb-2.5 sm:block sm:self-end" aria-hidden="true" />
        <StepSelect step={2} label={t("clientsStepCity")} options={chosenFirstStep ? data?.cities ?? [] : []} selected={selection.cities}
          disabled={!chosenFirstStep} disabledHint={t("clientsPickSpecialtyFirst")} onChange={values => setStep("cities", values)} testId="agent-clients-city" />
        <ChevronRight className="hidden h-5 w-5 shrink-0 self-center text-zinc-300 sm:mb-2.5 sm:block sm:self-end" aria-hidden="true" />
        <StepSelect step={3} label={t("clientsStepDistrict")} options={chosenFirstStep ? data?.districts ?? [] : []} selected={selection.districts}
          disabled={!chosenFirstStep} disabledHint={t("clientsPickSpecialtyFirst")} onChange={values => setStep("districts", values)} testId="agent-clients-district" />
      </div>

      {problem ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{t(problem)}</p>
      ) : !chosenFirstStep ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground" data-testid="agent-clients-start">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />{t("clientsPickSpecialtyFirst")}
        </p>
      ) : loading && !data ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("clientsLoading")}</p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground" data-testid="agent-clients-empty">{t("clientsEmpty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="agent-clients-summary">
            <span className={cn(loading && "opacity-60")}>
              <strong>{t("clientsFound", { count: data?.matching ?? 0, groups: groups.length })}</strong>
              {" · "}{t("clientsChecked", { count: chosen.length })}
              {(data?.assignedHere ?? 0) > 0 ? <span className="text-muted-foreground">{" · "}{t("clientsAlreadyHereCount", { count: data?.assignedHere ?? 0 })}</span> : null}
            </span>
            <span className="flex gap-3">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => toggle(selectable, true)} data-testid="agent-clients-check-all">{t("clientsCheckAll")}</button>
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => toggle(selectable, false)} data-testid="agent-clients-uncheck-all">{t("clientsUncheckAll")}</button>
            </span>
          </div>

          <div className="space-y-2">
            {groups.map(group => {
              const key = group.institution?.id ?? PICKER_NONE
              const ids = group.contacts.filter(contact => !contact.assignedHere).map(contact => contact.id)
              const on = ids.filter(id => !excluded.has(id)).length
              const state = ids.length === 0 ? "locked" : on === ids.length ? "on" : on === 0 ? "off" : "some"
              const open = expanded.has(key)
              const shown = showAll.has(key) ? group.contacts : group.contacts.slice(0, DOCTORS_SHOWN_IN_GROUP)
              return (
                <div key={key} className="overflow-hidden rounded-xl border" data-testid="agent-clients-group">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={state === "some" ? "mixed" : state === "on" || state === "locked"}
                      aria-label={group.institution?.name ?? t("clientsNoInstitution")}
                      disabled={ids.length === 0}
                      onClick={() => toggle(ids, state !== "on")}
                      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="agent-clients-group-tick"
                    >
                      <TickBox state={state} />
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded(current => flip(current, key))} aria-expanded={open}>
                      <span className="block truncate text-sm font-medium">{group.institution?.name ?? t("clientsNoInstitution")}</span>
                      {group.institution ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {[group.institution.district ?? group.institution.city, group.institution.address].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </button>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">{t("clientsOfCount", { on: on + (group.contacts.length - ids.length), total: group.contacts.length })}</span>
                    <button type="button" onClick={() => setExpanded(current => flip(current, key))} aria-label={group.institution?.name ?? t("clientsNoInstitution")} aria-expanded={open} className="shrink-0 text-muted-foreground">
                      <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
                    </button>
                  </div>
                  {open ? (
                    <div className="border-t bg-muted/30">
                      {shown.map(contact => {
                        const off = !contact.assignedHere && excluded.has(contact.id)
                        return (
                          <div key={contact.id} className={cn("flex items-center gap-3 border-b px-3 py-2 pl-11 text-sm last:border-b-0", off && "text-muted-foreground")} data-testid="agent-clients-doctor">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={contact.assignedHere || !off}
                              aria-label={contact.name}
                              disabled={contact.assignedHere}
                              onClick={() => toggle([contact.id], off)}
                              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <TickBox state={contact.assignedHere ? "locked" : off ? "off" : "on"} />
                            </button>
                            <span className="min-w-0 flex-1 truncate">
                              <span className={cn(off && "line-through")}>{contact.name}</span>
                              {contact.specialty ? <span className="ml-1.5 text-xs text-muted-foreground">{contact.specialty}</span> : null}
                            </span>
                            {contact.assignedHere ? (
                              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("clientsAlreadyHere")}</span>
                            ) : contact.agents.length > 0 ? (
                              <Hint text={t("clientsAlsoWithHint", { names: contact.agents.map(agent => agent.name).join(", ") })}>
                                <span tabIndex={0} className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                                  {t("clientsAlsoWith", { name: contact.agents[0].name, more: contact.agents.length - 1 })}
                                </span>
                              </Hint>
                            ) : null}
                          </div>
                        )
                      })}
                      {group.contacts.length > shown.length ? (
                        <button type="button" className="px-11 py-2 text-xs font-semibold text-primary hover:underline" onClick={() => setShowAll(current => flip(current, key))}>
                          {t("clientsMore", { count: group.contacts.length - shown.length })}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100" data-testid="agent-clients-note">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("clientsNote", { count: chosen.length })}
          </p>
        </>
      )}
    </div>
  )
}
