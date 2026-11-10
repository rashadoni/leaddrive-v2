"use client"

/**
 * The name and the phone of the staff booking form, with the organization's own
 * customers offered under whichever of the two is being typed.
 *
 * Both fields search the same thing, because a receptionist knows the caller by
 * either. Picking a match fills the form and ties the meeting to that record;
 * typing on without picking books a new customer exactly as before, so nobody
 * has to be in the CRM to be written down.
 *
 * The list never scrolls: five rows at most, and typing more narrows them.
 */
import { useEffect, useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Check, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "@/lib/client/use-debounced-value"

export interface BookingClientMatch {
  type: "contact" | "lead"
  id: string
  name: string
  phone: string | null
  email: string | null
  subtitle: string
}

/** What the form keeps about the customer it was pointed at. */
export interface BookingClientLink {
  type: "contact" | "lead"
  id: string
  name: string
  subtitle: string
}

/** Below this the search answers with half the customer base, so it waits. */
const MIN_CHARS = 2

export function BookingClientPicker({ name, phone, onPatch, linked, onLink, onUnlink }: {
  name: string
  phone: string
  onPatch: (patch: { name?: string; phone?: string; email?: string }) => void
  linked: BookingClientLink | null
  onLink: (match: BookingClientMatch) => void
  onUnlink: () => void
}) {
  const t = useTranslations("booking")
  const fieldId = useId()
  const [field, setField] = useState<"name" | "phone" | null>(null)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)

  const typed = field === "phone" ? phone : name
  const query = field ? typed.trim() : ""
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const search = useQuery({
    queryKey: ["booking-clients", debounced],
    // react-query aborts this signal when the key changes, so a keystroke
    // cancels the request the one before it started.
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/v1/bookings/clients?q=${encodeURIComponent(debounced)}`, { signal, cache: "no-store" })
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error(body.code ?? "LOAD_FAILED")
      return body.data.items as BookingClientMatch[]
    },
    enabled: debounced.length >= MIN_CHARS,
    retry: false,
    staleTime: 30_000,
  })

  const matches = debounced.length >= MIN_CHARS && debounced === query ? search.data ?? [] : []
  const open = field !== null && query.length >= MIN_CHARS && !linked
  // The pause after the last keystroke is part of the search: without this the
  // row reads «new customer» for a third of a second before the matches land.
  const searching = query.length >= MIN_CHARS && (debounced !== query || search.isFetching)
  useEffect(() => { setActive(0) }, [debounced, field])
  useEffect(() => {
    if (!open) return
    function away(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setField(null)
    }
    document.addEventListener("mousedown", away)
    return () => document.removeEventListener("mousedown", away)
  }, [open])

  function choose(match: BookingClientMatch) {
    onLink(match)
    setField(null)
  }

  // Down/Up walk the list, Enter takes the highlighted row, Escape leaves what
  // was typed alone — the keyboard must not be a reason to pick the wrong one.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !matches.length) return
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % matches.length) }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + matches.length) % matches.length) }
    else if (event.key === "Enter" && matches[active]) { event.preventDefault(); choose(matches[active]) }
    else if (event.key === "Escape") { setField(null) }
  }

  const listId = `${fieldId}-clients`
  const combobox = (id: string, which: "name" | "phone") => ({
    id,
    role: "combobox" as const,
    "aria-expanded": open && field === which,
    "aria-controls": listId,
    "aria-autocomplete": "list" as const,
    "aria-activedescendant": open && field === which && matches[active] ? `${listId}-${active}` : undefined,
    autoComplete: "off",
    onFocus: () => setField(which),
    onKeyDown,
  })

  return <div ref={wrap} className="sm:col-span-2 space-y-3">
    {linked ? (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
        <Check aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{linked.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[t(linked.type === "contact" ? "clientLinkedContact" : "clientLinkedLead"), linked.subtitle].filter(Boolean).join(" · ")}
          </span>
        </span>
        <Hint text={t("clientLinkedHint")}>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onUnlink}>{t("clientUnlink")}</Button>
        </Hint>
      </div>
    ) : null}

    <div className="relative grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${fieldId}-name`}>{t("clientName")}</Label>
        <Input
          {...combobox(`${fieldId}-name`, "name")}
          className="mt-1"
          placeholder={t("clientSearchPlaceholder")}
          value={name}
          onChange={(event) => { onPatch({ name: event.target.value }); setField("name") }}
        />
      </div>
      <div>
        <Label htmlFor={`${fieldId}-phone`}>{t("phone")}</Label>
        <Input
          {...combobox(`${fieldId}-phone`, "phone")}
          className="mt-1"
          type="tel"
          placeholder="+994 50 000 00 00"
          value={phone}
          onChange={(event) => { onPatch({ phone: event.target.value }); setField("phone") }}
        />
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("clientSearchResults")}
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {matches.map((match, index) => (
            <button
              key={`${match.type}:${match.id}`}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(match)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${index === active ? "bg-muted/70" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{match.name}</span>
                {match.subtitle || match.email ? <span className="block truncate text-xs text-muted-foreground">{[match.subtitle, match.email].filter(Boolean).join(" · ")}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                {match.phone ? <span className="block text-xs font-semibold tabular-nums">{match.phone}</span> : null}
                <span className="block text-[11px] text-muted-foreground">{t(match.type === "contact" ? "clientTypeContact" : "clientTypeLead")}</span>
              </span>
            </button>
          ))}
          {/* Said in words, so nobody reads an empty list as «this customer may
              not be booked»: typing on and pressing this books a new one. */}
          <div className={matches.length ? "mt-1 border-t border-border pt-1" : ""}>
            <button
              type="button"
              onClick={() => setField(null)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold"
            >
              {searching && !matches.length
                ? <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
              {searching && !matches.length ? t("clientSearching") : t("clientSearchNew", { query: typed.trim() })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  </div>
}
