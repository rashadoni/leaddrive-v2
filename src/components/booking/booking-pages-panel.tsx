"use client"

/**
 * Settings → «Onlayn yazılış»: booking pages and their links. A page is
 * edited in place of the list — one screen, no dialog over a dialog.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck, Check, Copy, CopyPlus, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { BookingPageEditor, type BookingHostOption, type BookingPageDraft } from "@/components/booking/booking-page-editor"
import { BookingWhatsAppCard } from "@/components/booking/booking-whatsapp-card"
import { defaultWeeklyHours, parseWeeklyHours } from "@/lib/booking/availability"
import { parseHostVariants } from "@/lib/booking/host-variants"
import { bookingSlug, groupByCategory, servicePriceLabel } from "@/lib/booking/service"

interface PageRow extends Omit<BookingPageDraft, "description" | "locationText" | "price" | "category" | "repeatCycleDays" | "hostVariants"> {
  hostVariants: unknown
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

async function fetchBookingPages(): Promise<{ pages: PageRow[]; users: BookingHostOption[]; linkBase: string; currency: string; ai?: boolean } | null> {
  const response = await fetch("/api/v1/booking-pages", { cache: "no-store" }).catch(() => null)
  const body = await response?.json().catch(() => null)
  return body?.success ? body.data : null
}

export function BookingPagesPanel() {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [pages, setPages] = useState<PageRow[]>([])
  const [users, setUsers] = useState<BookingHostOption[]>([])
  const [linkBase, setLinkBase] = useState("")
  const [currency, setCurrency] = useState("")
  const [ai, setAi] = useState(false)
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
    const { id, price, category, repeatCycleDays, ...body } = draft
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
      {draft ? null : (
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

      {!draft ? <BookingWhatsAppCard services={pages.map(({ id, title, price, priceCurrency }) => ({ id, title, price, priceCurrency }))} hosts={users} /> : null}

      {draft && savedTitle ? (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />{t("savedAnother", { title: savedTitle })}
        </p>
      ) : null}

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
      ) : loading ? <p role="status">{t("workspaceLoading")}</p> : error ? <Button variant="outline" onClick={() => { setLoading(true); load() }}>{t("retry")}</Button> : pages.length === 0 ? (
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
    </div>
  )
}
