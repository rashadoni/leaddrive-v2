"use client"

/**
 * Settings → «Onlayn yazılış»: booking pages and their links. A page is
 * edited in place of the list — one screen, no dialog over a dialog.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck, CalendarOff, Check, Copy, CopyPlus, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { BookingPageEditor, type BookingHostOption, type BookingPageDraft } from "@/components/booking/booking-page-editor"
import { BookingWhatsAppCard } from "@/components/booking/booking-whatsapp-card"
import { defaultWeeklyHours, parseWeeklyHours } from "@/lib/booking/availability"
import { parseHostVariants } from "@/lib/booking/host-variants"
import { parseAddOns } from "@/lib/booking/add-ons"
import { parseClosedDates, type ClosedDate } from "@/lib/booking/closed-dates"
import { bookingSlug, groupByCategory, servicePriceLabel } from "@/lib/booking/service"

interface PageRow extends Omit<BookingPageDraft, "description" | "locationText" | "price" | "category" | "repeatCycleDays" | "hostVariants" | "addOns"> {
  hostVariants: unknown
  addOns: unknown
  capacity: number | null
  depositAmount: string | null
  depositPercent: number | null
  depositFreeHours: number | null
  id: string
  description: string | null
  locationText: string | null
  price: string | null
  priceCurrency: string | null
  category: string | null
  repeatCycleDays: number | null
  url: string
  upcoming: number
}

const ERROR_KEYS: Record<string, string> = {
  SLUG_TAKEN: "errSlugTaken",
  HOSTS_REQUIRED: "errHostsRequired",
  INVALID_HOURS: "errHours",
}

function newDraft(hostIds: string[]): BookingPageDraft {
  return {
    title: "",
    slug: "",
    description: "",
    durationMinutes: 30,
    locationType: "office",
    locationText: "",
    hostIds,
    hostVariants: {},
    addOns: [],
    photoUrl: null,
    capacity: 1,
    depositAmount: "",
    depositPercent: "",
    depositFreeHours: 24,
    weekly: defaultWeeklyHours(),
    price: "",
    category: "",
    repeatCycleDays: 0,
    bufferMinutes: 0,
    minNoticeMinutes: 120,
    maxDaysAhead: 14,
    isActive: true,
  }
}

/**
 * The next service of a price list: the same room, the same people and the
 * same hours as the one just saved — only the name, the link, the text and the
 * price start empty. Twenty services are entered in one sitting, not twenty.
 */
function nextDraft(previous: BookingPageDraft): BookingPageDraft {
  return { ...previous, id: undefined, title: "", slug: "", description: "", price: "" }
}

async function fetchBookingPages(): Promise<{ pages: PageRow[]; users: BookingHostOption[]; linkBase: string; currency: string; ai?: boolean; closedDates?: unknown } | null> {
  const response = await fetch("/api/v1/booking-pages", { cache: "no-store" }).catch(() => null)
  const body = await response?.json().catch(() => null)
  return body?.success ? body.data : null
}

export function BookingPagesPanel({ show = "all" }: { show?: "all" | "services" | "whatsapp" } = {}) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [pages, setPages] = useState<PageRow[]>([])
  const [users, setUsers] = useState<BookingHostOption[]>([])
  const [linkBase, setLinkBase] = useState("")
  const [currency, setCurrency] = useState("")
  const [ai, setAi] = useState(false)
  // The days the whole salon is closed. They belong to the organization, so
  // they are saved on their own as soon as one is added or removed — there is
  // no service being edited to save them with.
  const [closedDates, setClosedDates] = useState<ClosedDate[]>([])
  const [closedDraft, setClosedDraft] = useState({ date: "", note: "" })
  const [closedBusy, setClosedBusy] = useState(false)
  const [closedError, setClosedError] = useState("")
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<BookingPageDraft | null>(null)
  // A fresh form is a fresh editor: its own state (whether the link still
  // follows the name, whether the per-day rows are open) must not survive into
  // the next service.
  const [editorSeq, setEditorSeq] = useState(0)
  const [savedTitle, setSavedTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchBookingPages().then((data) => {
      if (data) {
        setError("")
        setPages(data.pages)
        setUsers(data.users)
        setLinkBase(data.linkBase.replace(/^https?:\/\//, ""))
        setCurrency(data.currency ?? "")
        setAi(Boolean(data.ai))
        setClosedDates(parseClosedDates(data.closedDates))
      } else {
        setError(t("errLoad"))
      }
      setLoading(false)
    })
  }, [t])

  useEffect(load, [load])

  async function save(another?: boolean) {
    if (!draft) return
    setSaving(true)
    setError("")
    setSavedTitle("")
    const { id, price, category, repeatCycleDays, depositAmount, depositPercent, ...body } = draft
    const deposit = depositAmount.trim() ? Number(depositAmount.trim().replace(",", ".")) : null
    const share = depositPercent.trim() ? Number(depositPercent.trim()) : null
    // An empty field is «no price», and a typed comma is a decimal point here.
    const amount = price.trim() ? Number(price.trim().replace(",", ".")) : null
    const response = await fetch(id ? `/api/v1/booking-pages/${id}` : "/api/v1/booking-pages", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        description: body.description || null,
        locationText: body.locationText || null,
        price: amount !== null && Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
        category: category.trim() || null,
        repeatCycleDays: repeatCycleDays || null,
        depositAmount: deposit !== null && Number.isFinite(deposit) && deposit > 0 ? Math.round(deposit * 100) / 100 : null,
        depositPercent: deposit ? null : (share !== null && Number.isFinite(share) && share > 0 ? Math.trunc(share) : null),
      }),
    }).catch(() => null)
    const result = await response?.json().catch(() => null)
    setSaving(false)
    if (!response?.ok || !result?.success) {
      setError(t(ERROR_KEYS[result?.code] ?? "errSave"))
      return
    }
    if (another) {
      setSavedTitle(draft.title.trim())
      setDraft(nextDraft(draft))
      setEditorSeq((seq) => seq + 1)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } else {
      setDraft(null)
    }
    load()
  }

  async function saveClosedDates(next: ClosedDate[]) {
    const before = closedDates
    setClosedDates(next)
    setClosedBusy(true)
    setClosedError("")
    const response = await fetch("/api/v1/booking-pages/closed-dates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dates: next }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setClosedBusy(false)
    if (!response?.ok || !body?.success) {
      // The list on screen is what the salon believes; a failed save must not
      // leave it claiming a day is closed when the server never heard it.
      setClosedDates(before)
      setClosedError(t("closedFailed"))
      return
    }
    setClosedDates(parseClosedDates(body.data?.closedDates))
  }

  function addClosedDate() {
    const date = closedDraft.date.trim()
    if (!date || closedDates.some((entry) => entry.date === date)) return
    setClosedDraft({ date: "", note: "" })
    void saveClosedDates([...closedDates, { date, note: closedDraft.note.trim() || null }].sort((left, right) => left.date.localeCompare(right.date)))
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      window.prompt(t("copyLink"), url)
    }
  }

  /** The saved service as the form holds it. */
  function draftOf(page: PageRow): BookingPageDraft {
    return {
      id: page.id,
      title: page.title,
      slug: page.slug,
      description: page.description ?? "",
      durationMinutes: page.durationMinutes,
      locationType: page.locationType,
      locationText: page.locationText ?? "",
      hostIds: page.hostIds,
      hostVariants: parseHostVariants(page.hostVariants),
      addOns: parseAddOns(page.addOns),
      photoUrl: page.photoUrl ?? null,
      capacity: page.capacity ?? 1,
      depositAmount: page.depositAmount ?? "",
      depositPercent: page.depositPercent === null || page.depositPercent === undefined ? "" : String(page.depositPercent),
      depositFreeHours: page.depositFreeHours ?? 24,
      weekly: parseWeeklyHours(page.weekly) ?? defaultWeeklyHours(),
      price: page.price ?? "",
      category: page.category ?? "",
      repeatCycleDays: page.repeatCycleDays ?? 0,
      bufferMinutes: page.bufferMinutes,
      minNoticeMinutes: page.minNoticeMinutes,
      maxDaysAhead: page.maxDaysAhead,
      isActive: page.isActive,
    }
  }

  function openDraft(next: BookingPageDraft) {
    setError("")
    setSavedTitle("")
    setEditorSeq((seq) => seq + 1)
    setDraft(next)
  }

  /**
   * «Haircut, men's» and «Haircut, women's» differ in a word and a price, so
   * the second one starts as a copy of the first — with its own link, since a
   * link is unique and a published one is never taken from the page that has it.
   */
  function duplicate(page: PageRow) {
    const title = `${page.title} ${t("copySuffix")}`
    openDraft({ ...draftOf(page), id: undefined, title, slug: bookingSlug(title) })
  }

  const hostNames = (ids: string[]) => ids.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(", ")
  const categories = useMemo(() => [...new Set(pages.map((page) => page.category?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, locale)), [pages, locale])
  // A salon that never filed its services keeps one plain list: a lone
  // «Without a group» heading would be noise.
  const grouped = useMemo(() => groupByCategory(pages, locale), [pages, locale])
  const showGroups = grouped.length > 1 || grouped[0]?.category !== null

  return (
    <div className="space-y-6">
      {error && !draft ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {/* Editing a service takes the screen: the editor brings its own name,
          its own index and its own actions, so the list's heading would be a
          second heading above a page that already has one. */}
      {draft || show === "whatsapp" ? null : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <CalendarCheck className="h-6 w-6 text-muted-foreground" aria-hidden="true" />{t("settingsTitle")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("settingsDesc")}</p>
          </div>
          <Button onClick={() => openDraft(newDraft(users[0] ? [users[0].id] : []))}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t("newPage")}
          </Button>
        </div>
      )}

      {draft && savedTitle ? (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />{t("savedAnother", { title: savedTitle })}
        </p>
      ) : null}

      {/* The agent that answers WhatsApp stands above the services, not under
          them: nobody scrolls past twenty service cards to find the switch
          that decides whether the number answers at all (owner, 2026-11-10 —
          «никто не скролит, всё должно быть под рукой»). It stays one card
          high, so the list it sits above is still the first thing read. */}
      {!draft && show !== "services" ? <BookingWhatsAppCard services={pages.map(({ id, title, price, priceCurrency }) => ({ id, title, price, priceCurrency }))} hosts={users} /> : null}

      {draft ? (
        <BookingPageEditor
          key={editorSeq}
          draft={draft}
          hosts={users}
          categories={categories}
          linkBase={linkBase}
          currency={currency}
          ai={ai}
          saving={saving}
          error={error}
          onChange={setDraft}
          onSave={(another) => void save(another)}
          onCancel={() => setDraft(null)}
        />
      ) : show === "whatsapp" ? null : loading ? <p role="status">{t("workspaceLoading")}</p> : error ? <Button variant="outline" onClick={() => { setLoading(true); load() }}>{t("retry")}</Button> : pages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{t("emptyList")}</CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
          <section key={group.category ?? "__none"} className="space-y-3">
            {showGroups ? <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">{group.category ?? t("categoryNone")}</h2> : null}
            <div className="grid gap-4 md:grid-cols-2 md:[&>*:last-child:nth-child(odd)]:col-span-2">
          {group.items.map((page) => (
            <Card key={page.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{page.title}</CardTitle>
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${page.isActive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    <span className={`h-2 w-2 rounded-full ${page.isActive ? "bg-emerald-500" : "bg-muted-foreground"}`} aria-hidden="true" />
                    {page.isActive ? t("statusOn") : t("statusOff")}
                  </span>
                </div>
                <CardDescription className="break-all">{page.url.replace(/^https?:\/\//, "")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted-foreground">{t("fieldDuration")}</dt><dd className="font-medium">{t("minutes", { count: page.durationMinutes })}</dd></div>
                  <div><dt className="text-muted-foreground">{t("fieldPrice")}</dt><dd className="font-medium tabular-nums">{servicePriceLabel(page, locale) ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">{t("colUpcoming")}</dt><dd className="font-medium tabular-nums">{page.upcoming}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">{t("colHosts")}</dt><dd className="font-medium">{hostNames(page.hostIds) || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">{t("fieldCycle")}</dt><dd className="font-medium">{page.repeatCycleDays ? t("cycleEvery", { count: page.repeatCycleDays }) : "—"}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void copy(page.url)}>
                    {copied === page.url ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {copied === page.url ? t("linkCopied") : t("copyLink")}
                  </Button>
                  <Hint text={page.url}>
                    <Button variant="outline" size="sm" asChild><a href={page.url} target="_blank" rel="noreferrer">{t("openPage")} ↗</a></Button>
                  </Hint>
                  <Button variant="outline" size="sm" onClick={() => openDraft(draftOf(page))}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />{t("edit")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => duplicate(page)}>
                    <CopyPlus className="h-4 w-4" aria-hidden="true" />{t("duplicate")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
            </div>
          </section>
          ))}
        </div>
      )}

      {/* Calendly's date-specific hours, in the half a salon actually says:
          closed. One list for the whole organization — a holiday marked on
          twenty services is nineteen chances to miss one. */}
      {!draft && show !== "whatsapp" ? (
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
              <CalendarOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("closedTitle")}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t("closedHint")}</p>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="closed-date" className="text-xs">{t("closedDate")}</Label>
              <Input id="closed-date" type="date" className="mt-1 h-10 w-44" value={closedDraft.date} onChange={(event) => setClosedDraft({ ...closedDraft, date: event.target.value })} />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label htmlFor="closed-note" className="text-xs">{t("closedNote")}</Label>
              <Input id="closed-note" className="mt-1 h-10" maxLength={80} placeholder={t("closedNotePlaceholder")} value={closedDraft.note} onChange={(event) => setClosedDraft({ ...closedDraft, note: event.target.value })} />
            </div>
            <Button variant="outline" onClick={addClosedDate} disabled={!closedDraft.date || closedBusy}>
              <Plus className="h-4 w-4" aria-hidden="true" />{t("closedAdd")}
            </Button>
          </div>

          {closedError ? <p className="mt-2 text-xs text-destructive" role="alert">{closedError}</p> : null}

          {closedDates.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("closedEmpty")}</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {closedDates.map((entry) => (
                <li key={entry.date} className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3 text-sm">
                  <span className="font-semibold tabular-nums">{entry.date}</span>
                  {entry.note ? <span className="max-w-[180px] truncate text-muted-foreground">{entry.note}</span> : null}
                  <button
                    type="button"
                    aria-label={`${t("removeAction")}: ${entry.date}`}
                    disabled={closedBusy}
                    onClick={() => void saveClosedDates(closedDates.filter((other) => other.date !== entry.date))}
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
