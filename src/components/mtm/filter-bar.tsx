"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react"

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
  testId?: string
}) {
  const active = value !== emptyValue
  const current = options.find((option) => option.value === value)?.label ?? value
  return (
    <span className={`relative inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border pl-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/30 ${active ? "border-primary/40 bg-primary/10 pr-1.5 text-primary" : "border-zinc-200 bg-card pr-3 text-muted-foreground hover:border-zinc-300 hover:text-foreground dark:border-zinc-700"}`}>
      <span className="truncate">{active || showValue ? `${label}: ${current}` : label}</span>
      {active && clearable ? (
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
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
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
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "date" | "month"
  testId?: string
}) {
  return (
    <label className="inline-flex h-10 items-center gap-2 rounded-full border border-zinc-200 bg-card px-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-primary/30 dark:border-zinc-700">
      <span>{label}</span>
      <input data-testid={testId} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent text-foreground outline-none" />
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
