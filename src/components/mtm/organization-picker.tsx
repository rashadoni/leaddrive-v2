"use client"

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type MtmOrganizationOption = {
  id: string
  code: string | null
  name: string
  objectType?: string | null
  address: string | null
  city: string | null
  district: string | null
}

type SearchOutcome = {
  key: string
  results: MtmOrganizationOption[]
  total: number
  failed: boolean
}

// The matches are listed in the page flow, so the list stays short instead of
// getting a frame with its own scrollbar; the "first N of M" line says the rest
// is reached by typing more.
const RESULT_LIMIT = 8
const SEARCH_DEBOUNCE_MS = 250
// "OTHER" says nothing about the place, so it is left out of the details line.
const LABELLED_OBJECT_TYPES = new Set(["PHARMACY", "CLINIC", "STORE"])
const NO_OUTCOME: SearchOutcome = { key: "", results: [], total: 0, failed: false }

/**
 * One field for choosing an MTM organization: type, see the matches under the
 * field, press one.
 *
 * It replaces a search box that silently refilled a separate <select>. That
 * pair had a trap: after a search the previously chosen organization could be
 * missing from the new options, so the select showed its placeholder while the
 * form still held — and saved — the old one. Here the chosen organization is
 * always the one on screen: it is shown as a card, and "Change" clears it
 * before the search opens again.
 */
export function MtmOrganizationPicker({
  id,
  labelId,
  value,
  onChange,
  orgId,
  disabled = false,
}: {
  id: string
  labelId?: string
  value: MtmOrganizationOption | null
  onChange: (organization: MtmOrganizationOption | null) => void
  orgId?: string
  disabled?: boolean
}) {
  const t = useTranslations("mtmOrganizationPicker")
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const focusInput = useRef(false)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<SearchOutcome>(NO_OUTCOME)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retry, setRetry] = useState(0)

  const details = useCallback((organization: MtmOrganizationOption) => {
    const type = organization.objectType && LABELLED_OBJECT_TYPES.has(organization.objectType)
      ? t(`objectTypes.${organization.objectType}`)
      : null
    const place = [organization.city, organization.district].filter(Boolean).join(", ")
    return [type, organization.code, place, organization.address].filter(Boolean).join(" · ")
  }, [t])

  const search = query.trim()
  const searching = open && value === null && !disabled
  const requestKey = `${orgId ?? ""}\n${retry}\n${search}`
  const loading = searching && outcome.key !== requestKey
  const { results, total } = outcome

  useEffect(() => {
    if (!searching) return
    // An answer to an earlier keystroke must not replace the matches of a later one.
    let superseded = false
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: "1", limit: String(RESULT_LIMIT), sort: "name", direction: "asc" })
        if (search) params.set("search", search)
        const response = await fetch(`/api/v1/mtm/organizations?${params}`, {
          headers: orgId ? { "x-organization-id": orgId } : {},
          signal: controller.signal,
        })
        const result = await response.json().catch(() => null) as {
          success?: boolean
          data?: { organizations?: MtmOrganizationOption[]; total?: number }
        } | null
        if (superseded) return
        if (!response.ok || !result?.success) throw new Error("organization search failed")
        const found = result.data?.organizations ?? []
        setOutcome({ key: requestKey, results: found, total: Math.max(result.data?.total ?? 0, found.length), failed: false })
        setActiveIndex(search && found.length > 0 ? 0 : -1)
      } catch {
        if (superseded) return
        setOutcome({ key: requestKey, results: [], total: 0, failed: true })
        setActiveIndex(-1)
      }
    }, search ? SEARCH_DEBOUNCE_MS : 0)
    return () => {
      superseded = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [orgId, requestKey, search, searching])

  useEffect(() => {
    if (value !== null || !focusInput.current) return
    focusInput.current = false
    inputRef.current?.focus()
  }, [value])

  const pick = (organization: MtmOrganizationOption) => {
    setOpen(false)
    setQuery("")
    setOutcome(NO_OUTCOME)
    onChange(organization)
  }

  const change = () => {
    focusInput.current = true
    setOpen(true)
    onChange(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Enter in the search field chooses a match; it must never submit the form around it.
      event.preventDefault()
      const organization = loading ? undefined : results[activeIndex]
      if (organization) pick(organization)
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    if (results.length === 0) return
    setOpen(true)
    setActiveIndex((index) => event.key === "ArrowDown"
      ? (index + 1) % results.length
      : (index <= 0 ? results.length : index) - 1)
  }

  if (value) {
    return (
      <div role="group" aria-labelledby={labelId} data-testid="mtm-organization-selected" className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-muted/35 p-3 dark:border-zinc-700">
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{value.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{details(value) || t("addressMissing")}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 flex-none" disabled={disabled} onClick={change}>{t("change")}</Button>
      </div>
    )
  }

  const activeOption = open && !loading ? results[activeIndex] : undefined
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
          autoComplete="off"
          className="h-11 pl-9 pr-9"
          value={query}
          disabled={disabled}
          placeholder={t("placeholder")}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </div>
      {open ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700">
          {!loading && outcome.failed ? (
            <div role="alert" className="flex items-center justify-between gap-3 p-3 text-sm text-destructive">
              <span>{t("error")}</span>
              <Button type="button" variant="outline" className="min-h-11 flex-none" onClick={() => setRetry((count) => count + 1)}>{t("retry")}</Button>
            </div>
          ) : null}
          <ul id={listId} role="listbox" aria-labelledby={labelId} className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {results.map((organization) => (
              <li
                key={organization.id}
                id={`${listId}-${organization.id}`}
                role="option"
                aria-selected={organization === activeOption}
                data-testid="mtm-organization-option"
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 first:rounded-t-xl hover:bg-muted ${organization === activeOption ? "bg-muted" : ""}`}
                // Keep the focus in the search field while an option is pressed.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(organization)}
              >
                <span className="text-sm font-medium [overflow-wrap:anywhere]">{organization.name}</span>
                <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{details(organization) || t("addressMissing")}</span>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground empty:hidden">
            {loading
              ? results.length === 0 ? t("searching") : null
              : outcome.failed ? null
                : results.length === 0 ? t(search ? "empty" : "emptyCatalog")
                  : total > results.length ? t("more", { shown: results.length, total }) : null}
          </p>
        </div>
      ) : null}
    </div>
  )
}
