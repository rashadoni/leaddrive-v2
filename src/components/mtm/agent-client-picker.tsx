"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Building2, Check, ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { AgentDoctorResult } from "@/lib/mtm/assign-agent-doctors"
import type { AgentClientPicker, PickerOption } from "@/lib/mtm/agent-client-picker"

/**
 * «Клиенты» tab of an agent's card (owner, 2026-10-16): specialty → city →
 * district, then the doctors that match, all ticked; any of them can be left
 * out. One row a doctor — his name and class first, then where he works
 * (owner, 2026-10-20: the institutions with «11/11» it listed before hid the
 * doctors themselves, «тут только сами клиники и учреждения»). What is ticked is
 * handed to the card, which assigns it after saving the agent — through the
 * same preview → apply as «Клиенты → Закрепить». The view was shown to the
 * owner as a picture first («да, делай»). The agent's own page offers the same
 * picker on «Привязать ещё клиентов» (owner, same day: «да, сюда тоже»).
 *
 * The agent's own doctors are listed ticked like the rest, and a tick taken
 * off one of them takes him off the agent (owner, same day, on the card of an
 * agent whose every doctor was greyed and locked: «нет возможности снимать
 * галочки»).
 */

type Selection = { specialties: string[]; cities: string[]; districts: string[] }
type PickerData = AgentClientPicker & { asOf: string }

/**
 * `contactIds`: ticked and not the agent's yet — to attach. `removeIds`: the
 * agent's, unticked — to detach. `listed`: a specialty is chosen, so the
 * doctors are on the screen.
 */
export type AgentClientChoice = { contactIds: string[]; removeIds?: string[]; asOf: string | null; listed?: boolean }

/** Rows drawn at once; the rest one press away. All of them are ticked either way. */
const DOCTORS_PAGE = 100

/** The words of `mtmForms`, as the card and the page both hold them. */
type FormWords = (key: string, values?: Record<string, number | string>) => string

/** One toast for what was applied, the same on the card and on the page. */
export function announceDoctorChanges(t: FormWords, done: AgentDoctorResult, triedToRemove: boolean) {
  if (done.left > 0) {
    toast.warning(triedToRemove
      ? t("clientsPartlyChanged", { added: done.added, removed: done.removed, left: done.left })
      : t("clientsPartlyAssigned", { changed: done.added, left: done.left }))
  } else if (done.removed > 0 && done.added > 0) toast.success(t("clientsChanged", { added: done.added, removed: done.removed }))
  else if (done.removed > 0) toast.success(t("clientsRemoved", { count: done.removed }))
  else toast.success(t("clientsAssigned", { count: done.added }))
}

/** What the card's save button says: what is attached, what is taken off. */
export function doctorChangesLabel(t: FormWords, add: number, remove: number, prefix: "create" | "save"): string | null {
  if (add === 0 && remove === 0) return null
  if (remove === 0) return t(prefix === "create" ? "createAndAssign" : "saveAndAssign", { count: add })
  return add === 0 ? t("saveAndRemove", { count: remove }) : t("saveAssignAndRemove", { add, remove })
}

function TickBox({ state }: { state: "on" | "off" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2",
        state === "on" ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 bg-background dark:border-zinc-600",
      )}
    >
      {state === "on" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
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
                selected.length > 0 ? "border-foreground font-semibold" : "border-input bg-background",
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
            className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-muted", selected.length === 0 && "bg-muted font-semibold")}
          >
            <span>{t("clientsAll")}</span><span className="tabular-nums text-muted-foreground">{total}</span>
          </button>
          {options.map(option => (
            <label key={option.value} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-muted", selected.includes(option.value) && "bg-muted font-semibold")}>
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
  /** Untick means «leave out» for a new doctor and «take off» for the agent's own. */
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [shownCount, setShownCount] = useState(DOCTORS_PAGE)

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
  const contacts = useMemo(() => (chosenFirstStep ? data?.contacts ?? [] : []), [chosenFirstStep, data])
  const listedIds = useMemo(() => contacts.map(contact => contact.id), [contacts])
  const chosen = useMemo(() => contacts.filter(contact => !contact.assignedHere && !unticked.has(contact.id)).map(contact => contact.id), [contacts, unticked])
  const takenOff = useMemo(() => contacts.filter(contact => contact.assignedHere && unticked.has(contact.id)).map(contact => contact.id), [contacts, unticked])
  const chosenKey = chosen.join(",")
  const takenOffKey = takenOff.join(",")

  useEffect(() => {
    onChange({ contactIds: chosenKey ? chosenKey.split(",") : [], removeIds: takenOffKey ? takenOffKey.split(",") : [], asOf: data?.asOf ?? null, listed: chosenFirstStep })
    // The ids travel as their joined keys: the list is rebuilt on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, takenOffKey, data?.asOf, chosenFirstStep])

  const setStep = (step: keyof Selection, values: string[]) => {
    setShownCount(DOCTORS_PAGE)
    setSelection(current => step === "specialties"
      ? { specialties: values, cities: [], districts: [] }
      : step === "cities" ? { ...current, cities: values, districts: [] } : { ...current, districts: values })
  }
  const toggle = (ids: string[], include: boolean) => setUnticked(current => {
    const next = new Set(current)
    for (const id of ids) {
      if (include) next.delete(id)
      else next.add(id)
    }
    return next
  })
  const shown = contacts.slice(0, shownCount)
  const hidden = contacts.length - shown.length

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
      ) : contacts.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground" data-testid="agent-clients-empty">{t("clientsEmpty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="agent-clients-summary">
            <span className={cn(loading && "opacity-60")}>
              <strong>{t("clientsFound", { count: data?.matching ?? 0, groups: data?.institutions ?? 0 })}</strong>
              {" · "}{t("clientsChecked", { count: chosen.length })}
              {takenOff.length > 0 ? <span className="font-semibold text-red-600 dark:text-red-400" data-testid="agent-clients-taken-off">{" · "}{t("clientsWillRemove", { count: takenOff.length })}</span> : null}
              {(data?.assignedHere ?? 0) > 0 ? <span className="text-muted-foreground">{" · "}{t("clientsAlreadyHereCount", { count: data?.assignedHere ?? 0 })}</span> : null}
            </span>
            <span className="flex gap-3">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => toggle(listedIds, true)} data-testid="agent-clients-check-all">{t("clientsCheckAll")}</button>
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => toggle(listedIds, false)} data-testid="agent-clients-uncheck-all">{t("clientsUncheckAll")}</button>
            </span>
          </div>

          <div className="divide-y overflow-hidden rounded-xl border" data-testid="agent-clients-list">
            {shown.map(contact => {
              const off = unticked.has(contact.id)
              const where = [contact.place.district ?? contact.place.city, contact.place.address].filter(Boolean).join(" · ")
              return (
                <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="agent-clients-doctor">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={!off}
                    aria-label={contact.name}
                    onClick={() => toggle([contact.id], off)}
                    className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="agent-clients-doctor-tick"
                  >
                    <TickBox state={off ? "off" : "on"} />
                  </button>
                  {/* The words tick too: a bigger target than the box. */}
                  <div className={cn("min-w-0 flex-1 cursor-pointer", off && "text-muted-foreground")} onClick={() => toggle([contact.id], off)}>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn("truncate text-sm font-semibold", off && "line-through")}>{contact.name}</span>
                      {contact.category ? (
                        <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-px text-[11px] font-semibold dark:border-zinc-700" data-testid="agent-clients-doctor-class">
                          {t("clientsClass", { category: contact.category })}
                        </span>
                      ) : null}
                      {contact.specialty ? <span className="shrink-0 text-xs text-muted-foreground">{contact.specialty}</span> : null}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="agent-clients-doctor-place">
                      <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{contact.place.institution?.name ?? t("clientsNoInstitution")}</span>
                        {where ? ` · ${where}` : null}
                      </span>
                    </div>
                  </div>
                  {contact.assignedHere && off ? (
                    <span className="shrink-0 text-[11px] font-semibold text-red-700 dark:text-red-300" data-testid="agent-clients-taken-off-tag">{t("clientsWillBeRemoved")}</span>
                  ) : contact.assignedHere ? (
                    <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t("clientsAlreadyHere")}</span>
                  ) : contact.agents.length > 0 ? (
                    <Hint text={t("clientsAlsoWithHint", { names: contact.agents.map(agent => agent.name).join(", ") })}>
                      <span tabIndex={0} className="shrink-0 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                        {t("clientsAlsoWith", { name: contact.agents[0].name, more: contact.agents.length - 1 })}
                      </span>
                    </Hint>
                  ) : null}
                </div>
              )
            })}
          </div>
          {hidden > 0 ? (
            <button
              type="button"
              className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold text-primary hover:bg-muted/40"
              onClick={() => setShownCount(count => count + DOCTORS_PAGE)}
              data-testid="agent-clients-show-more"
            >
              {hidden > DOCTORS_PAGE ? t("clientsShowMore", { count: DOCTORS_PAGE, left: hidden }) : t("clientsShowRest", { count: hidden })}
            </button>
          ) : null}

          <p className="flex items-start gap-2 rounded-xl border border-l-4 border-zinc-200 border-l-sky-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-sky-500 px-3 py-2.5 text-sm" data-testid="agent-clients-note">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t("clientsNote", { count: chosen.length })}
              {takenOff.length > 0 ? <> {t("clientsNoteRemove", { count: takenOff.length })}</> : null}
            </span>
          </p>
        </>
      )}
    </div>
  )
}
