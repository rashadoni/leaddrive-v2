"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
  CircleAlert,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Search,
  WifiOff,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format-date"
import {
  parsePortalNewTicketDraft,
  PORTAL_NEW_TICKET_DRAFT_KEY,
  serializePortalNewTicketDraft,
} from "@/lib/ticketing/portal-ticket-draft"
import { isPublicTicketStatus, publicSlaPhase } from "@/lib/ticketing/portal-ticket-presentation"

interface Ticket {
  id: string
  ticketNumber: string
  subject: string
  status: string
  category?: string | null
  categoryRef?: { name: string; slug: string } | null
  createdAt: string
  slaDueAt?: string | null
  slaFirstResponseDueAt?: string | null
  firstResponseAt?: string | null
}

type ComplaintMeta = {
  complaintType: "complaint" | "suggestion"
  brand: string
  productCategory: string
  complaintObject: string
  complaintObjectDetail: string
}

const EMPTY_COMPLAINT: ComplaintMeta = {
  complaintType: "complaint",
  brand: "",
  productCategory: "",
  complaintObject: "",
  complaintObjectDetail: "",
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

export default function PortalTicketsPage() {
  const t = useTranslations("portal")
  const locale = useLocale()
  const router = useRouter()
  const requestRef = useRef<AbortController | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("general")
  const [clientRequestId, setClientRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [online, setOnline] = useState(true)
  const [complaintsEnabled, setComplaintsEnabled] = useState(false)
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [asComplaint, setAsComplaint] = useState(false)
  const [complaintMeta, setComplaintMeta] = useState<ComplaintMeta>(EMPTY_COMPLAINT)

  const statusLabel = useCallback((status: string) => {
    if (status === "open") return t("statusOpen")
    if (!isPublicTicketStatus(status)) return t("statusUnknown")
    const labels = {
      new: t("statusNew"),
      in_progress: t("statusInProgress"),
      waiting: t("statusWaiting"),
      resolved: t("statusResolved"),
      closed: t("statusClosed"),
    }
    return labels[status as keyof typeof labels] || t("statusUnknown")
  }, [t])

  const categoryLabel = useCallback((ticket: Ticket) => {
    const slug = ticket.categoryRef?.slug || ticket.category
    if (slug === "general") return t("categoryGeneral")
    if (slug === "technical") return t("categoryTechnical")
    if (slug === "billing") return t("categoryBilling")
    if (slug === "feature_request") return t("categoryFeature")
    return ticket.categoryRef?.name || ticket.category || ""
  }, [t])

  const fetchTickets = useCallback(async (initial = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (initial) setLoading(true)
    else setRefreshing(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/public/portal-tickets", {
        cache: "no-store",
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("ticketsLoadFailed"))
      setTickets(Array.isArray(body.data) ? body.data : [])
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        setLoadError(error instanceof Error ? error.message : t("ticketsLoadFailed"))
      }
    } finally {
      if (requestRef.current === controller) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [t])

  useEffect(() => {
    const draft = parsePortalNewTicketDraft(localStorage.getItem(PORTAL_NEW_TICKET_DRAFT_KEY))
    if (draft) {
      setSubject(draft.subject)
      setDescription(draft.description)
      setCategory(draft.category)
      setClientRequestId(draft.clientRequestId)
      setShowForm(true)
    }
    if (window.location.search.includes("action=new")) setShowForm(true)
    setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    void fetchTickets(true)
    return () => {
      requestRef.current?.abort()
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [fetchTickets])

  useEffect(() => {
    if (!subject.trim() && !description.trim()) {
      localStorage.removeItem(PORTAL_NEW_TICKET_DRAFT_KEY)
      return
    }
    localStorage.setItem(PORTAL_NEW_TICKET_DRAFT_KEY, serializePortalNewTicketDraft({
      subject,
      description,
      category,
      clientRequestId,
    }))
  }, [category, clientRequestId, description, subject])

  useEffect(() => {
    fetch("/api/v1/public/portal-config", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("config")))
      .then((body) => {
        setComplaintsEnabled(body?.data?.features?.complaints_register === true)
        setBrandOptions(Array.isArray(body?.data?.brands) ? body.data.brands : [])
        setProductOptions(Array.isArray(body?.data?.productCategories) ? body.data.productCategories : [])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) void fetchTickets(false)
    }, 20_000)
    return () => window.clearInterval(interval)
  }, [fetchTickets])

  const resetDraft = () => {
    setSubject("")
    setDescription("")
    setCategory("general")
    setAsComplaint(false)
    setComplaintMeta(EMPTY_COMPLAINT)
    setClientRequestId(newRequestId())
    setFormError("")
    localStorage.removeItem(PORTAL_NEW_TICKET_DRAFT_KEY)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !subject.trim()) return
    if (!navigator.onLine) {
      setOnline(false)
      setFormError(t("offlineDraftSaved"))
      return
    }
    setSaving(true)
    setFormError("")
    try {
      const response = await fetch("/api/v1/public/portal-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description,
          category,
          clientRequestId,
          ...(asComplaint && complaintsEnabled ? { isComplaint: true, complaintMeta } : {}),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success || !body.data?.id) throw new Error(t("ticketCreateFailed"))
      localStorage.removeItem(PORTAL_NEW_TICKET_DRAFT_KEY)
      resetDraft()
      router.push(`/portal/tickets/${body.data.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("ticketCreateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale)
    if (!query) return tickets
    return tickets.filter((ticket) =>
      ticket.subject.toLocaleLowerCase(locale).includes(query)
      || ticket.ticketNumber.toLocaleLowerCase(locale).includes(query),
    )
  }, [locale, search, tickets])

  return (
    <div
      className="space-y-4"
      data-testid="portal-tickets-workspace"
      data-state={loading ? "loading" : loadError ? "error" : refreshing ? "refreshing" : "ready"}
      data-online={online}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("myTickets")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("ticketCount", { count: tickets.length })}</p>
        </div>
        <Button data-testid="portal-new-ticket-toggle" className="min-h-11" onClick={() => setShowForm((open) => !open)} aria-expanded={showForm} aria-controls="portal-new-ticket-form">
          {showForm ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {showForm ? t("closeForm") : t("newTicket")}
        </Button>
      </header>

      {!online && (
        <div data-testid="portal-tickets-offline" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" role="status">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{t("offlineDraftSaved")}</span>
        </div>
      )}

      {showForm && (
        <section id="portal-new-ticket-form" data-testid="portal-new-ticket-form" className="rounded-lg border bg-background p-4" aria-labelledby="portal-new-ticket-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="portal-new-ticket-title" className="text-sm font-semibold">{t("newTicket")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("draftSavedHelp")}</p>
            </div>
            {(subject || description) && <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={resetDraft}>{t("clearDraft")}</Button>}
          </div>
          <form className="space-y-3" onSubmit={handleCreate}>
            {formError && <p data-testid="portal-new-ticket-error" className="rounded-md border px-3 py-2 text-sm text-destructive" role="alert">{formError}</p>}
            <div>
              <label htmlFor="portal-ticket-subject" className="text-sm font-medium">{t("subjectLabel")}</label>
              <Input id="portal-ticket-subject" data-testid="portal-new-ticket-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={t("describeIssue")} className="mt-1 min-h-11" maxLength={200} required />
            </div>
            <div>
              <label htmlFor="portal-ticket-category" className="text-sm font-medium">{t("categoryLabel")}</label>
              <Select id="portal-ticket-category" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 min-h-11" disabled={asComplaint}>
                <option value="general">{t("categoryGeneral")}</option>
                <option value="technical">{t("categoryTechnical")}</option>
                <option value="billing">{t("categoryBilling")}</option>
                <option value="feature_request">{t("categoryFeature")}</option>
              </Select>
            </div>
            {complaintsEnabled && (
              <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={asComplaint} onChange={(event) => setAsComplaint(event.target.checked)} />
                <span>
                  <span className="flex items-center gap-1.5 font-medium"><MessageSquareWarning className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("complaintToggle")}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t("complaintToggleHelp")}</span>
                </span>
              </label>
            )}
            {complaintsEnabled && asComplaint && (
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-xs font-medium">{t("complaintDetails")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm"><span className="font-medium">{t("complaintType")}</span><Select value={complaintMeta.complaintType} onChange={(event) => setComplaintMeta((value) => ({ ...value, complaintType: event.target.value as ComplaintMeta["complaintType"] }))} className="mt-1 min-h-11"><option value="complaint">{t("complaint")}</option><option value="suggestion">{t("suggestion")}</option></Select></label>
                  <label className="text-sm"><span className="font-medium">{t("brandLabel")}</span><Input list="portal-brands" value={complaintMeta.brand} onChange={(event) => setComplaintMeta((value) => ({ ...value, brand: event.target.value }))} className="mt-1 min-h-11" /><datalist id="portal-brands">{brandOptions.map((brand) => <option key={brand} value={brand} />)}</datalist></label>
                  <label className="text-sm"><span className="font-medium">{t("productLabel")}</span><Input list="portal-products" value={complaintMeta.productCategory} onChange={(event) => setComplaintMeta((value) => ({ ...value, productCategory: event.target.value }))} className="mt-1 min-h-11" /><datalist id="portal-products">{productOptions.map((product) => <option key={product} value={product} />)}</datalist></label>
                  <label className="text-sm"><span className="font-medium">{t("issueLabel")}</span><Input value={complaintMeta.complaintObject} onChange={(event) => setComplaintMeta((value) => ({ ...value, complaintObject: event.target.value }))} className="mt-1 min-h-11" /></label>
                </div>
                <p className="text-xs text-muted-foreground">{t("complaintTeamReview")}</p>
              </fieldset>
            )}
            <div>
              <label htmlFor="portal-ticket-description" className="text-sm font-medium">{t("descriptionLabel")}</label>
              <Textarea id="portal-ticket-description" data-testid="portal-new-ticket-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("provideDetails")} rows={4} className="mt-1 min-h-28 resize-y" maxLength={10_000} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setShowForm(false)}>{t("saveForLater")}</Button>
              <Button data-testid="portal-new-ticket-submit" type="submit" className="min-h-11" disabled={saving || !subject.trim() || !online}>{saving ? t("creating") : t("submitTicket")}</Button>
            </div>
          </form>
        </section>
      )}

      <label className="relative block">
        <span className="sr-only">{t("searchTickets")}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input data-testid="portal-tickets-search" placeholder={t("searchTickets")} value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" />
      </label>

      {loading ? (
        <div data-testid="portal-tickets-loading" className="divide-y rounded-lg border" aria-busy="true" aria-label={t("ticketsLoading")}>
          {[0, 1, 2].map((index) => <div key={index} className="h-20 animate-pulse bg-muted/50 motion-reduce:animate-none" />)}
        </div>
      ) : loadError ? (
        <section data-testid="portal-tickets-error" className="flex min-h-56 flex-col items-center justify-center rounded-lg border p-5 text-center" role="alert">
          <CircleAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold">{t("ticketsUnavailable")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
          <Button data-testid="portal-tickets-retry" variant="outline" className="mt-4 min-h-11" onClick={() => void fetchTickets(true)}><RefreshCw aria-hidden="true" />{t("tryAgain")}</Button>
        </section>
      ) : filtered.length === 0 ? (
        <section data-testid="portal-tickets-empty-state" data-kind={tickets.length === 0 ? "empty" : "filtered"} className="flex min-h-56 flex-col items-center justify-center rounded-lg border p-5 text-center">
          <h2 className="text-base font-semibold">{tickets.length === 0 ? t("noTicketsTitle") : t("noTicketResults")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tickets.length === 0 ? t("noTicketsDescription") : t("changeTicketSearch")}</p>
          {tickets.length === 0 && <Button className="mt-4 min-h-11" onClick={() => setShowForm(true)}><Plus aria-hidden="true" />{t("newTicket")}</Button>}
        </section>
      ) : (
        <div data-testid="portal-tickets-list" className="divide-y overflow-hidden rounded-lg border bg-background" aria-busy={refreshing}>
          {filtered.map((ticket) => {
            const sla = publicSlaPhase(ticket)
            return (
              <button key={ticket.id} data-testid="portal-ticket-row" data-ticket-id={ticket.id} type="button" onClick={() => router.push(`/portal/tickets/${ticket.id}`)} className="grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none">
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{ticket.subject}</span>
                    <Badge variant="outline" className="bg-muted/30">{statusLabel(ticket.status)}</Badge>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {ticket.ticketNumber} · {formatDate(ticket.createdAt, locale, { day: "2-digit", month: "short", year: "numeric" })}
                    {categoryLabel(ticket) ? ` · ${categoryLabel(ticket)}` : ""}
                  </span>
                  {sla.kind !== "none" && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {sla.kind === "complete" ? t("slaComplete") : t(sla.kind === "firstResponse" ? "firstResponseTarget" : "resolutionTarget", { date: formatDate(sla.dueAt, locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                    </span>
                  )}
                </span>
                <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{refreshing ? t("ticketsRefreshing") : ""}</p>
    </div>
  )
}
