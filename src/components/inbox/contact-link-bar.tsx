"use client"

/**
 * «Bu eyni müştəridir» above the feed of an Instagram or Messenger conversation that is tied to no
 * customer yet, and «Ayır» on one that is (lib/inbox/contact-link). The CRM merges nothing by itself:
 * a number or e-mail from the chat that belongs to exactly one customer is offered as a question, and a
 * manager can always pick the customer by name or number.
 */

import { useEffect, useState } from "react"
import { Link2, Link2Off, Loader2, Search, UserCheck } from "lucide-react"
import type { InboxThreadConversation } from "@/lib/inbox-channels"
import { channelLabel } from "@/lib/inbox-channels"
import { isContactLinkablePlatform } from "@/lib/inbox/contact-link-platforms"

type Candidate = { id: string; fullName: string; phone: string | null; email: string | null }
type Suggestion = Candidate & { matchedBy: "phone" | "email"; matchedValue: string }

const TEXT = {
  en: {
    unlinked: (who: string) => `${who} is not tied to a customer yet.`,
    suggest: (value: string, name: string) => `${value} is written in this chat. In the CRM: ${name}. The same customer?`,
    yes: "Yes, the same customer",
    same: "This is the same customer…",
    search: "Name, phone or e-mail",
    nothing: "Nobody found",
    linkedTo: (who: string) => `${who} is shown in this customer's feed.`,
    unlink: "Separate",
    failed: "Could not save. Try again.",
    cancel: "Cancel",
  },
  ru: {
    unlinked: (who: string) => `${who} ещё не привязан к клиенту.`,
    suggest: (value: string, name: string) => `В переписке есть ${value}. В CRM: ${name}. Это тот же клиент?`,
    yes: "Да, это тот же клиент",
    same: "Это тот же клиент…",
    search: "Имя, телефон или почта",
    nothing: "Никого не нашли",
    linkedTo: (who: string) => `${who} показан в ленте этого клиента.`,
    unlink: "Разъединить",
    failed: "Не сохранилось. Попробуйте ещё раз.",
    cancel: "Отмена",
  },
  az: {
    unlinked: (who: string) => `${who} hələ müştəriyə bağlanmayıb.`,
    // The name gets no suffix: Azerbaijani harmony would need the name's last vowel.
    suggest: (value: string, name: string) => `Yazışmada ${value} var. CRM-də: ${name}. Eyni müştəridir?`,
    yes: "Bəli, eyni müştəridir",
    same: "Bu eyni müştəridir…",
    search: "Ad, nömrə və ya e-poçt",
    nothing: "Heç kim tapılmadı",
    linkedTo: (who: string) => `${who} bu müştərinin lentində göstərilir.`,
    unlink: "Ayır",
    failed: "Yadda saxlanmadı. Yenidən cəhd edin.",
    cancel: "Ləğv et",
  },
} as const

function readable(value: string): string {
  const digits = value.replace(/\D/g, "")
  if (/^994\d{9}$/.test(digits)) return `+994 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`
  return value
}

function who(conversation: InboxThreadConversation): string {
  return [channelLabel(conversation.platform), conversation.customerHandle].filter(Boolean).join(" · ")
}

export function ContactLinkBar({
  conversations,
  filter,
  locale,
  onChanged,
}: {
  conversations: ReadonlyArray<InboxThreadConversation>
  /** The feed filter of the channel switcher: «Ayır» shows on the channel the manager is looking at. */
  filter: string
  locale: string
  /** After a link or «Ayır»: the inbox reloads and opens the thread the conversation now belongs to. */
  onChanged: (change: { conversationId: string; contactId: string | null }) => void
}) {
  const text = TEXT[locale === "ru" || locale === "az" ? locale : "en"]
  const linkable = conversations.filter((c) => isContactLinkablePlatform(c.platform))
  const unlinked = linkable.find((c) => !c.contactLinked) ?? null
  const shownLinked = linkable.filter((c) => c.contactLinked && filter === c.platform)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [allowed, setAllowed] = useState(true)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Candidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unlinkedId = unlinked?.id ?? null
  useEffect(() => {
    setSuggestions([])
    setSearching(false)
    setQuery("")
    setResults(null)
    setError(null)
    if (!unlinkedId) return
    let cancelled = false
    fetch(`/api/v1/inbox/conversations/${unlinkedId}/contact-link`)
      .then(async (res) => {
        if (cancelled) return
        // Picking a customer lists customers: someone who may not read them gets no bar at all.
        if (res.status === 403) { setAllowed(false); return }
        setAllowed(true)
        const body = await res.json().catch(() => null)
        if (!cancelled && Array.isArray(body?.data?.suggestions)) setSuggestions(body.data.suggestions)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [unlinkedId])

  useEffect(() => {
    if (!searching || !unlinkedId) return
    const q = query.trim()
    if (q.length < 2) { setResults(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/v1/inbox/conversations/${unlinkedId}/contact-link?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((body) => { if (!cancelled) setResults(Array.isArray(body?.data?.results) ? body.data.results : []) })
        .catch(() => { if (!cancelled) setResults([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, searching, unlinkedId])

  async function link(conversationId: string, contactId: string, via: "manual" | "suggestion") {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conversationId}/contact-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, via }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onChanged({ conversationId, contactId })
    } catch {
      setError(text.failed)
    } finally {
      setBusy(false)
    }
  }

  async function unlink(conversationId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conversationId}/contact-link`, { method: "DELETE" })
      if (!res.ok) throw new Error(String(res.status))
      onChanged({ conversationId, contactId: null })
    } catch {
      setError(text.failed)
    } finally {
      setBusy(false)
    }
  }

  if (!allowed || (!unlinked && shownLinked.length === 0)) return null

  return (
    <div className="space-y-2 border-b border-border bg-muted/30 px-3 py-2 text-[13px]">
      {shownLinked.map((conversation) => (
        <div key={conversation.key} className="flex flex-wrap items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-muted-foreground">{text.linkedTo(who(conversation))}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => unlink(conversation.id)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Link2Off className="h-3.5 w-3.5" />
            {text.unlink}
          </button>
        </div>
      ))}

      {unlinked && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{text.unlinked(who(unlinked))}</span>
            {!searching && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSearching(true)}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <UserCheck className="h-3.5 w-3.5" />
                {text.same}
              </button>
            )}
          </div>

          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <span>{text.suggest(readable(suggestion.matchedValue), suggestion.fullName)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => link(unlinked.id, suggestion.id, "suggestion")}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {text.yes}
              </button>
            </div>
          ))}

          {searching && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={text.search}
                    className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[13px] outline-none focus:border-primary"
                  />
                </div>
                <button type="button" onClick={() => setSearching(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  {text.cancel}
                </button>
              </div>
              {results && results.length === 0 && <p className="px-1 text-xs text-muted-foreground">{text.nothing}</p>}
              {results && results.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border bg-background">
                  {results.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => link(unlinked.id, candidate.id, "manual")}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
                      >
                        <span className="font-medium">{candidate.fullName}</span>
                        <span className="truncate text-xs text-muted-foreground">{[candidate.phone, candidate.email].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
