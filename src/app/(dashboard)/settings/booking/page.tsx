"use client"

/**
 * Settings → «Onlayn yazılış»: booking pages and their links. A page is
 * edited in place of the list — one screen, no dialog over a dialog.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarCheck, Check, Copy, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { BookingPageEditor, type BookingHostOption, type BookingPageDraft } from "@/components/booking/booking-page-editor"
import { defaultWeeklyHours, parseWeeklyHours } from "@/lib/booking/availability"

interface PageRow extends Omit<BookingPageDraft, "description" | "locationText"> {
  id: string
  description: string | null
  locationText: string | null
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
    weekly: defaultWeeklyHours(),
    bufferMinutes: 0,
    minNoticeMinutes: 120,
    maxDaysAhead: 14,
    isActive: true,
  }
}

async function fetchBookingPages(): Promise<{ pages: PageRow[]; users: BookingHostOption[]; linkBase: string } | null> {
  const response = await fetch("/api/v1/booking-pages", { cache: "no-store" }).catch(() => null)
  const body = await response?.json().catch(() => null)
  return body?.success ? body.data : null
}

export default function BookingSettingsPage() {
  const t = useTranslations("booking")
  const [pages, setPages] = useState<PageRow[]>([])
  const [users, setUsers] = useState<BookingHostOption[]>([])
  const [linkBase, setLinkBase] = useState("")
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<BookingPageDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchBookingPages().then((data) => {
      if (data) {
        setPages(data.pages)
        setUsers(data.users)
        setLinkBase(data.linkBase.replace(/^https?:\/\//, ""))
      }
      setLoading(false)
    })
  }, [])

  useEffect(load, [load])

  async function save() {
    if (!draft) return
    setSaving(true)
    setError("")
    const { id, ...body } = draft
    const response = await fetch(id ? `/api/v1/booking-pages/${id}` : "/api/v1/booking-pages", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, description: body.description || null, locationText: body.locationText || null }),
    }).catch(() => null)
    const result = await response?.json().catch(() => null)
    setSaving(false)
    if (!response?.ok || !result?.success) {
      setError(t(ERROR_KEYS[result?.code] ?? "errSave"))
      return
    }
    setDraft(null)
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

  function edit(page: PageRow) {
    setError("")
    setDraft({
      id: page.id,
      title: page.title,
      slug: page.slug,
      description: page.description ?? "",
      durationMinutes: page.durationMinutes,
      locationType: page.locationType,
      locationText: page.locationText ?? "",
      hostIds: page.hostIds,
      weekly: parseWeeklyHours(page.weekly) ?? defaultWeeklyHours(),
      bufferMinutes: page.bufferMinutes,
      minNoticeMinutes: page.minNoticeMinutes,
      maxDaysAhead: page.maxDaysAhead,
      isActive: page.isActive,
    })
  }

  const hostNames = (ids: string[]) => ids.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(", ")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarCheck className="h-6 w-6 text-muted-foreground" aria-hidden="true" />{t("settingsTitle")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("settingsDesc")}</p>
        </div>
        {!draft ? (
          <Button onClick={() => { setError(""); setDraft(newDraft(users[0] ? [users[0].id] : [])) }}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t("newPage")}
          </Button>
        ) : null}
      </div>

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle>{draft.title || t("newPage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BookingPageEditor
              draft={draft}
              hosts={users}
              linkBase={linkBase}
              saving={saving}
              error={error}
              onChange={setDraft}
              onSave={() => void save()}
              onCancel={() => setDraft(null)}
            />
          </CardContent>
        </Card>
      ) : loading ? null : pages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{t("emptyList")}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 md:[&>*:last-child:nth-child(odd)]:col-span-2">
          {pages.map((page) => (
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
                  <div className="col-span-2"><dt className="text-muted-foreground">{t("colHosts")}</dt><dd className="font-medium">{hostNames(page.hostIds) || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">{t("colUpcoming")}</dt><dd className="font-medium tabular-nums">{page.upcoming}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void copy(page.url)}>
                    {copied === page.url ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {copied === page.url ? t("linkCopied") : t("copyLink")}
                  </Button>
                  <Hint text={page.url}>
                    <Button variant="outline" size="sm" asChild><a href={page.url} target="_blank" rel="noreferrer">{t("openPage")} ↗</a></Button>
                  </Hint>
                  <Button variant="outline" size="sm" onClick={() => edit(page)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />{t("edit")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
