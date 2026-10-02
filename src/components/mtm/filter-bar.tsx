"use client"

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * One filter row for every MTM list (owner 2026-09-27, on «Клиенты»: «слишком
 * много места занимает, не интерактивен, не интуитивен и не юзер-френдли»).
 * The filters used to be a card of labelled fields — a saved-views panel, a
 * «Фильтры» heading, a grid of full-width selects, a search that waited for its
 * own button, an explanation line and stat tiles — before the first row of data.
 *
 * Here: a search that applies as you type, each filter a pill that shows what
 * it is set to and clears with its ×, rarer filters behind «Ещё фильтры», and
 * «Сбросить» only when something is set. Native <select> under every pill, so
 * the phone opens its own picker and a keyboard works as with any select.
 */
export type MtmFilterOption = { value: string; label: string }

export function MtmFilterBar({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div role="search" data-testid={testId} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  )
}

/**
 * What is typed, applied after a pause. Returns the draft and its setter; the
 * caller applies at once (Enter, ×) by calling `onChange` itself.
 */
function useDebouncedDraft(value: string, onChange: (value: string) => void, delayMs: number) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  // A value set from outside (reset, a saved view) replaces what was typed.
  if (value !== seen) {
    setSeen(value)
    // Our own debounced value coming back must not eat a trailing space.
    if (draft.trim() !== value) setDraft(value)
  }
  useEffect(() => {
    if (draft.trim() === value.trim()) return
    const timer = window.setTimeout(() => onChangeRef.current(draft.trim()), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, draft, value])
  return [draft, setDraft] as const
}

/** Applies after a pause in typing, or at once on Enter; × clears. */
export function MtmFilterSearch({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  delayMs = 350,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  clearLabel: string
  delayMs?: number
  testId?: string
}) {
  const [draft, setDraft] = useDebouncedDraft(value, onChange, delayMs)

  return (
    <label className="flex h-10 min-w-0 flex-[1_1_16rem] items-center gap-2 rounded-full border border-zinc-200 bg-card px-3 text-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 dark:border-zinc-700">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        data-testid={testId}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onChange(draft.trim())
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button type="button" className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={clearLabel} onClick={() => { setDraft(""); onChange("") }}>
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </label>
  )
}

/**
 * A filter as a pill: «Статус» when unset, «Статус: активные» when set, with ×
 * to clear. `emptyValue` is what «all» means for this filter (usually "").
 */
export function MtmFilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
  emptyValue = "",
  clearable = true,
  showValue = false,
  disabled = false,
  testId,
}: {
  label: string
  value: string
  options: readonly MtmFilterOption[]
  onChange: (value: string) => void
  allLabel: string
  emptyValue?: string
  clearable?: boolean
  /** Always «Период: сегодня», even at the default — a period is never «none». */
  showValue?: boolean
  disabled?: boolean
  testId?: string
}) {
  const active = value !== emptyValue
  const current = options.find((option) => option.value === value)?.label ?? (value || allLabel)
  return (
    <span className={`relative inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border pl-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/30 ${disabled ? "opacity-50" : ""} ${active ? "border-primary/40 bg-primary/10 pr-1.5 text-primary" : "border-zinc-200 bg-card pr-3 text-muted-foreground hover:border-zinc-300 hover:text-foreground dark:border-zinc-700"}`}>
      <span className="truncate">{active || showValue ? `${label}: ${current}` : label}</span>
      {active && clearable && !disabled ? (
        <button
          type="button"
          className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-primary/15"
          aria-label={`${label}: ${allLabel}`}
          onClick={() => onChange(emptyValue)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <select
        data-testid={testId}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      >
        {emptyValue === "" ? <option value="">{allLabel}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </span>
  )
}

/** A date or month as a pill; the input itself is the value. */
export function MtmFilterDate({
  label,
  value,
  onChange,
  type = "date",
  min,
  max,
  disabled = false,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "date" | "month" | "time"
  min?: string
  max?: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <label className="inline-flex h-10 items-center gap-2 rounded-full border border-zinc-200 bg-card px-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-primary/30 dark:border-zinc-700">
      <span>{label}</span>
      <input data-testid={testId} type={type} min={min} max={max} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent text-foreground outline-none" />
    </label>
  )
}

export function MtmFilterMore({ open, onToggle, count, label, testId }: { open: boolean; onToggle: () => void; count: number; label: string; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={open}
      onClick={onToggle}
      className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${open || count > 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-zinc-200 bg-card text-muted-foreground hover:text-foreground dark:border-zinc-700"}`}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      {label}
      {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">{count}</span> : null}
    </button>
  )
}

export function MtmFilterReset({ show, onReset, label, testId }: { show: boolean; onReset: () => void; label: string; testId?: string }) {
  if (!show) return null
  return (
    <button type="button" data-testid={testId} onClick={onReset} className="inline-flex h-10 items-center rounded-full px-2 text-sm font-medium text-primary hover:underline">
      {label}
    </button>
  )
}

/** «Найдено N» and whatever the page adds, one quiet line above the list. */
export function MtmResultLine({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>{children}</span>
      {aside ? <span className="text-xs">{aside}</span> : null}
    </div>
  )
}


/**
 * The filter as labelled fields (owner 2026-10-02, on the row of pills above:
 * «он не интуитивен и не юзер френдли», with a screenshot of the form he
 * wants — a name over every field, type into it or pick from it). «Клиенты»
 * and «Учреждения» use this; the fields a person looks by every day are on the
 * page, the rest sit behind «Ещё фильтры» in the same grid.
 *
 * A field that is set is tinted, so what narrows the list is visible at a
 * glance without reading every box. Two columns even on a phone: eight fields
 * one under another would push the list off the first screen.
 */
export function MtmFilterGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div role="search" data-testid={testId} className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  )
}

const FIELD_BOX = "h-10 w-full min-w-0 rounded-lg border text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/20"
const FIELD_IDLE = "border-zinc-200 bg-card dark:border-zinc-700"
const FIELD_SET = "border-primary/50 bg-primary/5"

function MtmFilterFieldLabel({ htmlFor, id, children }: { htmlFor?: string; id?: string; children: ReactNode }) {
  return (
    <label id={id} htmlFor={htmlFor} className="truncate text-xs font-medium text-muted-foreground">
      {children}
    </label>
  )
}

/** A typed field: applies after a pause or on Enter, × clears it. */
export function MtmFilterTextField({
  label,
  value,
  onChange,
  placeholder,
  clearLabel,
  delayMs = 350,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  clearLabel: string
  delayMs?: number
  testId?: string
}) {
  const id = useId()
  const [draft, setDraft] = useDebouncedDraft(value, onChange, delayMs)
  return (
    <div className="grid min-w-0 content-start gap-1">
      <MtmFilterFieldLabel htmlFor={id}>{label}</MtmFilterFieldLabel>
      <div className={`${FIELD_BOX} flex items-center gap-1 pl-3 pr-1 ${value ? FIELD_SET : FIELD_IDLE}`}>
        <input
          id={id}
          data-testid={testId}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onChange(draft.trim())
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
        {draft ? (
          <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${label}: ${clearLabel}`} onClick={() => { setDraft(""); onChange("") }}>
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** One choice from a list; the browser's own select, so a phone opens its picker. */
export function MtmFilterSelectField({
  label,
  value,
  options,
  onChange,
  allLabel,
  emptyValue = "",
  disabled = false,
  testId,
}: {
  label: string
  value: string
  options: readonly MtmFilterOption[]
  onChange: (value: string) => void
  allLabel: string
  emptyValue?: string
  disabled?: boolean
  testId?: string
}) {
  const id = useId()
  const active = value !== emptyValue
  // A value restored from a link that the list no longer offers stays visible.
  const missing = active && !options.some((option) => option.value === value)
  return (
    <div className="grid min-w-0 content-start gap-1">
      <MtmFilterFieldLabel htmlFor={id}>{label}</MtmFilterFieldLabel>
      <div className={`${FIELD_BOX} relative ${active ? FIELD_SET : FIELD_IDLE} ${disabled ? "opacity-50" : ""}`}>
        <select
          id={id}
          data-testid={testId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`h-full w-full cursor-pointer appearance-none truncate rounded-lg bg-transparent pl-3 pr-8 outline-none disabled:cursor-not-allowed ${active ? "text-foreground" : "text-muted-foreground"}`}
        >
          {emptyValue === "" ? <option value="">{allLabel}</option> : null}
          {missing ? <option value={value}>{value}</option> : null}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  )
}

/** A date or month as a labelled field. */
export function MtmFilterDateField({
  label,
  value,
  onChange,
  type = "date",
  active = false,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "date" | "month"
  /** The value shown may be a default (this month); tint only a chosen one. */
  active?: boolean
  testId?: string
}) {
  const id = useId()
  return (
    <div className="grid min-w-0 content-start gap-1">
      <MtmFilterFieldLabel htmlFor={id}>{label}</MtmFilterFieldLabel>
      <div className={`${FIELD_BOX} ${active ? FIELD_SET : FIELD_IDLE}`}>
        <input id={id} data-testid={testId} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-full w-full rounded-lg bg-transparent px-3 outline-none" />
      </div>
    </div>
  )
}

/**
 * Several choices from a list: a field that opens a checklist. Shows what is
 * chosen in the field itself; a list longer than a screenful gets a search.
 * Every tick applies at once — the list behind it is the preview.
 */
export function MtmFilterMultiField({
  label,
  values,
  options,
  onChange,
  allLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  testId,
}: {
  label: string
  values: readonly string[]
  options: readonly MtmFilterOption[]
  onChange: (values: string[]) => void
  allLabel: string
  searchPlaceholder: string
  /** Shown when the search inside the list finds nothing. */
  emptyLabel: string
  clearLabel: string
  testId?: string
}) {
  const labelId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = useMemo(() => new Set(values), [values])
  // A choice restored from a link that the list no longer offers can still be
  // seen and unticked.
  const allOptions = useMemo(() => {
    const known = new Set(options.map((option) => option.value))
    return [...options, ...values.filter((value) => !known.has(value)).map((value) => ({ value, label: value }))]
  }, [options, values])
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? allOptions.filter((option) => option.label.toLowerCase().includes(needle))
    : allOptions
  const chosen = allOptions.filter((option) => selected.has(option.value)).map((option) => option.label)
  const toggle = (value: string) => {
    onChange(selected.has(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  return (
    <div className="grid min-w-0 content-start gap-1">
      <MtmFilterFieldLabel id={labelId}>{label}</MtmFilterFieldLabel>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
        <div className={`${FIELD_BOX} flex items-center ${chosen.length > 0 ? FIELD_SET : FIELD_IDLE}`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={testId}
              aria-labelledby={labelId}
              aria-haspopup="dialog"
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 pr-2 text-left outline-none"
              title={chosen.length > 0 ? chosen.join(", ") : undefined}
            >
              <span className={`min-w-0 flex-1 truncate ${chosen.length > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                {chosen.length > 0 ? chosen.join(", ") : allLabel}
              </span>
              {chosen.length > 1 ? (
                <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">{chosen.length}</span>
              ) : null}
              {chosen.length === 0 ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            </button>
          </PopoverTrigger>
          {chosen.length > 0 ? (
            <button type="button" className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${label}: ${clearLabel}`} onClick={() => onChange([])}>
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <PopoverContent align="start" collisionPadding={8} className="w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-2rem)] p-0">
          {allOptions.length > 8 ? (
            <label className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </label>
          ) : null}
          <ul aria-labelledby={labelId} className="max-h-72 overflow-y-auto p-1">
            {visible.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</li>
            ) : visible.map((option) => {
              const checked = selected.has(option.value)
              return (
                <li key={option.value}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm hover:bg-muted has-[:focus-visible]:bg-muted">
                    <input type="checkbox" className="sr-only" value={option.value} checked={checked} onChange={() => toggle(option.value)} />
                    <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600"}`}>
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** «Ещё фильтры» and «Сбросить» as plain buttons under the field grid. */
export function MtmFilterActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}
