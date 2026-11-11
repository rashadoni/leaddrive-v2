"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, Info, Loader2, Minus } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"
import { MtmContactClassTag } from "@/components/mtm/contact-class-tag"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { AgentDoctorResult } from "@/lib/mtm/assign-agent-doctors"
import type { AgentClientPicker, PickerContact, PickerOption } from "@/lib/mtm/agent-client-picker"

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

/**
 * `everySpecialty`: «Hamısı» chosen in the first step on purpose. An empty
 * `specialties` alone means nothing is chosen yet, which lists nobody.
 */
type Selection = { specialties: string[]; everySpecialty: boolean; cities: string[]; districts: string[]; classes: string[] }
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

function TickBox({ state }: { state: "on" | "off" | "some" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2",
        state === "off" ? "border-zinc-300 bg-background dark:border-zinc-600" : "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === "on" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === "some" ? <Minus className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  )
}

function StepSelect({ step, label, options, selected, disabled, disabledHint, onChange, testId, emptyLabel, every }: {
  /** Numbered once, on the agent card; the tiles above say what comes first. */
  step?: number
  label: string
  options: PickerOption[]
  selected: string[]
  disabled: boolean
  disabledHint: string
  onChange: (values: string[]) => void
  testId: string
  /** What the field says before anything is chosen; «Hamısı» by default. */
  emptyLabel?: string
  /** A step where «Hamısı» is a choice of its own, not the empty field. */
  every?: { chosen: boolean; choose: () => void }
}) {
  const t = useTranslations("mtmForms")
  const nameOf = (value: string) => {
    const option = options.find(item => item.value === value)
    return option?.label ?? t("clientsNotStated")
  }
  const everyChosen = every ? every.chosen : selected.length === 0
  const summary = every?.chosen ? t("clientsAll") : selected.length === 0 ? emptyLabel ?? t("clientsAll") : selected.length === 1 ? nameOf(selected[0]) : `${nameOf(selected[0])} +${selected.length - 1}`
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{step ? `${step}. ${label}` : label}</div>
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
                selected.length > 0 || every?.chosen ? "crm-choice-selected" : "border-input bg-background",
              )}
            >
              <span className={cn("truncate", selected.length === 0 && !everyChosen && "text-muted-foreground")}>{summary}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          </div>
        </Hint>
        {/* Above the agent dialog, which is itself a layer (z-60). */}
        <PopoverContent align="start" className="z-[70] max-h-80 w-64 overflow-y-auto p-1.5" data-testid={`${testId}-options`}>
          <button
            type="button"
            onClick={() => (every ? every.choose() : onChange([]))}
            className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-muted", everyChosen && "bg-muted font-semibold")}
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


/**
 * The specialties as tiles with their counts (owner, 2026-11-11, the picture
 * approved with «Давай»: «пусть будет готовый фильтр уже из каких
 * специальностей врачи назначены»): one press picks a specialty, the doctors
 * appear below. Under the number: how many are this agent's already, when
 * the tiles count the whole company.
 */
function SpecialtyTiles({ options, chosen, every, onChoose, onChooseEvery, hereNote }: {
  options: PickerOption[]
  chosen: string | null
  every: boolean
  onChoose: (value: string) => void
  onChooseEvery: () => void
  /** «N already with the agent» under each count; the plain unit without it. */
  hereNote: ((here: number) => string) | null
}) {
  const t = useTranslations("mtmForms")
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const totalHere = options.reduce((sum, option) => sum + (option.here ?? 0), 0)
  const tiles = [
    { key: "every", label: t("clientsAll"), count: total, here: totalHere, on: every, choose: onChooseEvery },
    ...options.map(option => ({ key: option.value, label: option.label ?? t("clientsNotStated"), count: option.count, here: option.here ?? 0, on: !every && chosen === option.value, choose: () => onChoose(option.value) })),
  ]
  // As wide as the row whatever their number: three tiles never leave a hole on the right.
  return (
    <div className="grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]" data-testid="agent-clients-tiles">
      {tiles.map(tile => (
        <button
          key={tile.key}
          type="button"
          aria-pressed={tile.on}
          data-crm-color-role="toggle"
          onClick={tile.choose}
          className={cn(
            "rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tile.on ? "border-2 border-primary bg-primary/5 px-[15px] py-[11px]" : "border-border",
          )}
          data-testid="agent-clients-start-choice"
        >
          <span className="block truncate text-sm font-semibold text-muted-foreground">{tile.label}</span>
          <span className={cn("mt-1 block text-3xl font-extrabold tabular-nums tracking-tight", tile.on && "text-primary")}>{tile.count}</span>
          <span className="block truncate text-xs text-muted-foreground">{hereNote ? hereNote(tile.here) : t("clientsTileUnit")}</span>
        </button>
      ))}
    </div>
  )
}

/** The other employees of a doctor, as grey chips. */
function AgentChips({ agents }: { agents: PickerContact["agents"] }) {
  if (agents.length === 0) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {agents.slice(0, 2).map(agent => (
        <span key={agent.id} className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">{agent.name}</span>
      ))}
      {agents.length > 2 ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">+{agents.length - 2}</span> : null}
    </span>
  )
}

/** One grid for the head and the rows: tick, doctor, class, workplace, agents. */
const TABLE_GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 sm:grid-cols-[1.25rem_minmax(0,1.2fr)_5.5rem_minmax(0,1.8fr)_minmax(0,1fr)]"

export function MtmAgentClientPicker({ agentId, orgId, onChange, refresh = 0, onForbidden, own = false, startUnticked = false, lockOwn = false, actions }: {
  /** The card being edited; null for a new agent. */
  agentId: string | null
  orgId?: string
  onChange: (choice: AgentClientChoice) => void
  /** Raised after doctors were assigned elsewhere: asks again, keeping the steps. */
  refresh?: number
  /** Someone who may not assign doctors: the page offers its list instead. */
  onForbidden?: () => void
  /**
   * The agent's own doctors only (his page's «Əməkdaşın müştəriləri», owner
   * 2026-11-11): all ticked, a tick picks one to take off or hand on,
   * `contactIds` carries the ticked, and nothing is ever «taken off» by an untick.
   */
  own?: boolean
  /**
   * Nobody ticked until somebody ticks (his page's «Əlavə müştəri təyin et»,
   * owner 2026-11-11: after a reload every doctor showed ticked again and read
   * as «added»). The agent card keeps everyone found ticked.
   */
  startUnticked?: boolean
  /** The agent's own doctors are shown as his and cannot be ticked: taking off lives on his own tab. */
  lockOwn?: boolean
  /** The buttons that apply the ticks, in the line with the counts above the list — not a bar floating over it (owner, 2026-11-11). */
  actions?: ReactNode
}) {
  const t = useTranslations("mtmForms")
  const [selection, setSelection] = useState<Selection>({ specialties: [], everySpecialty: false, cities: [], districts: [], classes: [] })
  const [data, setData] = useState<PickerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  /** A tick the person set; without one a doctor is ticked or not by the mode. */
  const [ticks, setTicks] = useState<Map<string, boolean>>(new Map())
  const [shownCount, setShownCount] = useState(DOCTORS_PAGE)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (agentId) params.set("agentId", agentId)
    if (own && agentId) params.set("own", "1")
    for (const value of selection.specialties) params.append("specialty", value)
    for (const value of selection.cities) params.append("city", value)
    for (const value of selection.districts) params.append("district", value)
    for (const value of selection.classes) params.append("class", value)
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
  }, [agentId, orgId, selection, refresh, own])

  // Nothing is listed, nor ticked, before a specialty is chosen: a card opened
  // and closed again must not take every doctor of the company along.
  const chosenFirstStep = selection.everySpecialty || selection.specialties.length > 0
  const contacts = useMemo(() => (chosenFirstStep ? data?.contacts ?? [] : []), [chosenFirstStep, data])
  const locked = useCallback((contact: PickerContact) => !own && lockOwn && contact.assignedHere, [lockOwn, own])
  const isOn = useCallback((contact: PickerContact) => ticks.get(contact.id) ?? (own ? true : !startUnticked), [own, startUnticked, ticks])
  const selectable = useMemo(() => contacts.filter(contact => !locked(contact)), [contacts, locked])
  const chosen = useMemo(() => selectable.filter(contact => (own || !contact.assignedHere) && isOn(contact)).map(contact => contact.id), [isOn, own, selectable])
  const takenOff = useMemo(() => (own || lockOwn ? [] : contacts.filter(contact => contact.assignedHere && !isOn(contact)).map(contact => contact.id)), [contacts, isOn, lockOwn, own])
  const chosenKey = chosen.join(",")
  const takenOffKey = takenOff.join(",")

  useEffect(() => {
    onChange({ contactIds: chosenKey ? chosenKey.split(",") : [], removeIds: takenOffKey ? takenOffKey.split(",") : [], asOf: data?.asOf ?? null, listed: chosenFirstStep })
    // The ids travel as their joined keys: the list is rebuilt on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, takenOffKey, data?.asOf, chosenFirstStep])

  const setStep = (step: keyof Selection, values: string[]) => {
    setShownCount(DOCTORS_PAGE)
    // The class is not a place: it stays when the specialty or the place changes.
    setSelection(current => step === "specialties"
      ? { ...current, specialties: values, everySpecialty: false, cities: [], districts: [] }
      : step === "cities" ? { ...current, cities: values, districts: [] }
        : step === "districts" ? { ...current, districts: values } : { ...current, classes: values })
  }
  const chooseEverySpecialty = () => {
    setShownCount(DOCTORS_PAGE)
    setSelection(current => ({ ...current, specialties: [], everySpecialty: true, cities: [], districts: [] }))
  }
  const tick = (ids: string[], on: boolean) => setTicks(current => {
    const next = new Map(current)
    for (const id of ids) next.set(id, on)
    return next
  })
  const selectableIds = selectable.map(contact => contact.id)
  const onCount = selectable.filter(isOn).length
  const headState: "on" | "off" | "some" = onCount === 0 ? "off" : onCount === selectable.length ? "on" : "some"
  const shown = contacts.slice(0, shownCount)
  const hidden = contacts.length - shown.length
  const agentsColumn = own ? t("clientsColOtherAgents") : startUnticked ? t("clientsColNowWith") : t("clientsColAgents")

  return (
    <div className="space-y-4" data-testid="agent-client-picker">
      {data ? (
        <SpecialtyTiles
          options={data.specialties}
          chosen={selection.specialties[0] ?? null}
          every={selection.everySpecialty}
          onChoose={value => setStep("specialties", [value])}
          onChooseEvery={chooseEverySpecialty}
          hereNote={agentId && !own ? (here => t("clientsTileHere", { count: here })) : null}
        />
      ) : null}

      {problem ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{t(problem)}</p>
      ) : !chosenFirstStep ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground" data-testid="agent-clients-start">
          {loading && !data ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Info className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {loading && !data ? t("clientsLoading") : t("clientsPickSpecialtyFirst")}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StepSelect label={t("clientsStepCity")} options={data?.cities ?? []} selected={selection.cities}
              disabled={false} disabledHint="" onChange={values => setStep("cities", values)} testId="agent-clients-city" />
            <StepSelect label={t("clientsStepDistrict")} options={data?.districts ?? []} selected={selection.districts}
              disabled={false} disabledHint="" onChange={values => setStep("districts", values)} testId="agent-clients-district" />
            <StepSelect label={t("clientsStepClass")} options={data?.classes ?? []} selected={selection.classes}
              disabled={false} disabledHint="" onChange={values => setStep("classes", values)} testId="agent-clients-class" />
          </div>

          {loading && contacts.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("clientsLoading")}</p>
          ) : contacts.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground" data-testid="agent-clients-empty">{t("clientsEmpty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm" data-testid="agent-clients-summary">
                <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", loading && "opacity-60")}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={headState === "some" ? "mixed" : headState === "on"}
                    aria-label={headState === "on" ? t("clientsUncheckAll") : t("clientsCheckAll")}
                    disabled={selectable.length === 0}
                    onClick={() => tick(selectableIds, headState !== "on")}
                    className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    data-testid="agent-clients-check-head"
                  >
                    <TickBox state={headState === "on" ? "on" : headState === "some" ? "some" : "off"} />
                  </button>
                  <span>
                    <strong>{t(own ? "clientsOwnChecked" : "clientsSelectedCount", { count: chosen.length })}</strong>
                    <span className="text-muted-foreground">{" · "}{t("clientsFound", { count: data?.matching ?? 0, groups: data?.institutions ?? 0 })}</span>
                    {takenOff.length > 0 ? <span className="font-semibold text-red-600 dark:text-red-400" data-testid="agent-clients-taken-off">{" · "}{t("clientsWillRemove", { count: takenOff.length })}</span> : null}
                  </span>
                  <button type="button" className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={() => tick(selectableIds, true)} data-testid="agent-clients-check-all">{t("clientsCheckAll")}</button>
                  <button type="button" className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={() => tick(selectableIds, false)} data-testid="agent-clients-uncheck-all">{t("clientsUncheckAll")}</button>
                </span>
                {actions ? <span className="flex flex-wrap items-center gap-2">{actions}</span> : null}
              </div>

              {/* Columns, as on «Müştərilər»: the doctor, his class, where he works, whose he already is. */}
              <div className="overflow-hidden rounded-xl border border-border" data-testid="agent-clients-list">
                <div className={cn(TABLE_GRID, "hidden border-b border-border bg-muted/40 py-2.5 text-xs font-semibold text-muted-foreground sm:grid")} data-testid="agent-clients-head">
                  <span />
                  <span>{t("clientsColDoctor")}</span>
                  <span>{t("clientsStepClass")}</span>
                  <span>{t("clientsColWorkplace")}</span>
                  <span>{agentsColumn}</span>
                </div>
                <div className="divide-y divide-border">
                {shown.map(contact => {
                  const isLocked = locked(contact)
                  const on = !isLocked && isOn(contact)
                  const dim = !isLocked && !on
                  const where = [contact.place.district ?? contact.place.city, contact.place.address].filter(Boolean).join(" · ")
                  return (
                    <div key={contact.id} className={cn(TABLE_GRID, "items-center py-3", isLocked && "bg-muted/30")} data-testid="agent-clients-doctor">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isLocked ? true : on}
                        aria-label={contact.name}
                        disabled={isLocked}
                        onClick={() => tick([contact.id], !on)}
                        className="self-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                        data-testid="agent-clients-doctor-tick"
                      >
                        <TickBox state={isLocked || on ? "on" : "off"} />
                      </button>
                      {/* The words tick too: a bigger target than the box. */}
                      <div className={cn("min-w-0", !isLocked && "cursor-pointer", dim && "text-muted-foreground")} onClick={isLocked ? undefined : () => tick([contact.id], !on)}>
                        <span className="block truncate text-sm font-semibold">{contact.name}</span>
                        {contact.specialty ? <span className="block truncate text-xs text-muted-foreground">{contact.specialty}</span> : null}
                      </div>
                      <div className="col-start-2 sm:col-start-auto">
                        <MtmContactClassTag category={contact.category} testId="agent-clients-doctor-class" />
                      </div>
                      <div className={cn("col-start-2 min-w-0 text-xs sm:col-start-auto", dim && "opacity-60")} data-testid="agent-clients-doctor-place">
                        <span className="block truncate text-sm font-medium">{contact.place.institution?.name ?? t("clientsNoInstitution")}</span>
                        {where ? <span className="block truncate text-muted-foreground" title={where}>{where}</span> : null}
                      </div>
                      <div className="col-start-2 min-w-0 sm:col-start-auto">
                        {contact.assignedHere && !own && !isOn(contact) && !isLocked ? (
                          <span className="text-xs font-semibold text-red-700 dark:text-red-300" data-testid="agent-clients-taken-off-tag">{t("clientsWillBeRemoved")}</span>
                        ) : contact.assignedHere && !own ? (
                          <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground">{t("clientsAlreadyHere")}</span>
                        ) : (
                          <Hint text={contact.agents.length > 0 ? t(own ? "clientsOwnAlsoWithHint" : "clientsAlsoWithHint", { names: contact.agents.map(agent => agent.name).join(", ") }) : null}>
                            <span tabIndex={contact.agents.length > 0 ? 0 : undefined} className="block min-w-0"><AgentChips agents={contact.agents} /></span>
                          </Hint>
                        )}
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
              {hidden > 0 ? (
                <button
                  type="button"
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm font-semibold hover:bg-muted/40"
                  onClick={() => setShownCount(count => count + DOCTORS_PAGE)}
                  data-testid="agent-clients-show-more"
                >
                  {hidden > DOCTORS_PAGE ? t("clientsShowMore", { count: DOCTORS_PAGE, left: hidden }) : t("clientsShowRest", { count: hidden })}
                </button>
              ) : null}

              {own || startUnticked ? null : (
                <p className="flex items-start gap-2 rounded-xl border border-l-4 border-border border-l-sky-500 bg-card text-foreground dark:border-l-sky-500 px-3 py-2.5 text-sm" data-testid="agent-clients-note">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {t("clientsNote", { count: chosen.length })}
                    {takenOff.length > 0 ? <> {t("clientsNoteRemove", { count: takenOff.length })}</> : null}
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
