"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Check, ChevronDown, CircleHelp, LocateFixed, MapPin, Plus, RefreshCw, Send, Smartphone, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format-date"

type RequestStatus = "SUBMITTED" | "IN_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "CANCELLED"
type RequestRecord = {
  id: string
  status: RequestStatus
  objectType: string
  externalCode?: string | null
  name: string
  address?: string | null
  city?: string | null
  district?: string | null
  latitude?: number | null
  longitude?: number | null
  contactPerson?: string | null
  phone?: string | null
  category?: string | null
  potential: string
  territoryCode?: string | null
  reason: string
  agentComment?: string | null
  decisionComment?: string | null
  routeId?: string | null
  routeOfferAcceptedAt?: string | null
  routeChangeRequestId?: string | null
  approvedCustomer?: { id: string; code?: string | null; name: string } | null
  duplicateCandidates?: Array<{ id: string; name: string; exact: boolean; reasons: string[] }>
  updatedAt: string
}

type FormState = {
  objectType: string
  externalCode: string
  name: string
  address: string
  city: string
  district: string
  latitude: string
  longitude: string
  contactPerson: string
  phone: string
  category: string
  potential: string
  territoryCode: string
  reason: string
  agentComment: string
}

const emptyForm: FormState = {
  objectType: "STORE",
  externalCode: "",
  name: "",
  address: "",
  city: "",
  district: "",
  latitude: "",
  longitude: "",
  contactPerson: "",
  phone: "",
  category: "B",
  potential: "UNKNOWN",
  territoryCode: "",
  reason: "",
  agentComment: "",
}

interface CustomerCreateRequestPanelProps {
  open: boolean
  routeId?: string
  orgId?: string
  onClose: () => void
  onRouteChanged: () => void
}

export function MtmCustomerCreateRequestPanel({ open, routeId, orgId, onClose, onRouteChanged }: CustomerCreateRequestPanelProps) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [duplicates, setDuplicates] = useState<RequestRecord["duplicateCandidates"]>([])

  const headers = useCallback((json = false) => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(orgId ? { "x-organization-id": orgId } : {}),
  }), [orgId])

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/customer-create-requests?mine=1", { headers: headers() })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("customerRequestLoadFailed"))
      setRequests(result.data?.requests ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("customerRequestLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [headers, open, t])

  useEffect(() => { void load() }, [load])

  function setField(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function locate() {
    if (!navigator.geolocation) {
      toast.error(t("locationUnavailable"))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }))
        setLocating(false)
      },
      () => {
        toast.error(t("locationUnavailable"))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  function edit(request: RequestRecord) {
    setEditingId(request.id)
    setDuplicates(request.duplicateCandidates ?? [])
    setForm({
      objectType: request.objectType,
      externalCode: request.externalCode ?? "",
      name: request.name,
      address: request.address ?? "",
      city: request.city ?? "",
      district: request.district ?? "",
      latitude: request.latitude?.toString() ?? "",
      longitude: request.longitude?.toString() ?? "",
      contactPerson: request.contactPerson ?? "",
      phone: request.phone ?? "",
      category: request.category ?? "B",
      potential: request.potential,
      territoryCode: request.territoryCode ?? "",
      reason: request.reason,
      agentComment: request.agentComment ?? "",
    })
  }

  function resetForm() {
    setEditingId(null)
    setDuplicates([])
    setForm(emptyForm)
  }

  async function submit() {
    if (form.name.trim().length < 2 || form.reason.trim().length < 3) return
    setSaving(true)
    try {
      const payload = {
        ...(editingId ? {} : { routeId: routeId ?? null }),
        objectType: form.objectType,
        externalCode: form.externalCode || null,
        name: form.name,
        address: form.address || null,
        city: form.city || null,
        district: form.district || null,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        contactPerson: form.contactPerson || null,
        phone: form.phone || null,
        category: form.category || null,
        potential: form.potential,
        territoryCode: form.territoryCode || null,
        reason: form.reason,
        agentComment: form.agentComment || null,
      }
      const response = await fetch(editingId
        ? `/api/v1/mtm/customer-create-requests/${editingId}`
        : "/api/v1/mtm/customer-create-requests", {
        method: editingId ? "PATCH" : "POST",
        headers: headers(true),
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("customerRequestSaveFailed"))
      setDuplicates(result.data?.duplicateCandidates ?? [])
      toast.success(editingId ? t("customerRequestResubmitted") : t("customerRequestSubmitted"))
      resetForm()
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("customerRequestSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function acceptRouteOffer(request: RequestRecord) {
    try {
      const response = await fetch(`/api/v1/mtm/customer-create-requests/${request.id}/route-offer`, {
        method: "POST",
        headers: headers(),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? t("routeOfferFailed"))
      toast.success(result.data?.mode === "APPROVAL" ? t("routeAdditionRequested") : t("routeCustomerAdded"))
      await load()
      onRouteChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("routeOfferFailed"))
    }
  }

  if (!open) return null

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="customer-request-heading">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="customer-request-heading" className="flex items-center gap-2 text-base font-semibold"><Smartphone className="h-4 w-4 text-primary" />{t("customerRequestTitle")}</h2>
            {routeId ? <Badge variant="brand">{t("customerRequestRouteBadge")}</Badge> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{routeId ? t("customerRequestRouteLinked") : t("customerRequestFromMobile")}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} title={t("closeCustomerRequest")} aria-label={t("closeCustomerRequest")}><X className="h-4 w-4" /></Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="border-b border-zinc-200 dark:border-zinc-700 lg:border-b-0 lg:border-r">
          <div className="flex overflow-x-auto border-b border-zinc-200 bg-muted/25 px-4 py-3 dark:border-zinc-700 sm:px-5" aria-label={t("customerRequestFlowLabel")}>
            {["customerRequestFlowCustomer", "customerRequestFlowLocation", "customerRequestFlowReason"].map((key, index) => (
              <div key={key} className="flex min-w-max items-center text-xs font-medium text-muted-foreground">
                <span className="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10px] text-background">{index + 1}</span>
                {t(key)}
                {index < 2 ? <span className="mx-3 h-px w-6 bg-zinc-300 dark:bg-zinc-600" /> : null}
              </div>
            ))}
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            <section aria-labelledby="customer-request-basics">
              <div className="mb-3">
                <h3 id="customer-request-basics" className="text-sm font-semibold">{t("customerRequestBasics")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("customerRequestBasicsHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="customer-request-name">{t("customerName")} *</Label><Input id="customer-request-name" value={form.name} onChange={(event) => setField("name", event.target.value)} autoComplete="organization" /></div>
                <div><Label htmlFor="customer-request-type">{t("customerObjectType")} *</Label><Select id="customer-request-type" value={form.objectType} onChange={(event) => setField("objectType", event.target.value)}>{["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"].map((value) => <option key={value} value={value}>{t(`customerType.${value}`)}</option>)}</Select></div>
                <div><Label htmlFor="customer-request-phone">{t("phone")}</Label><Input id="customer-request-phone" value={form.phone} onChange={(event) => setField("phone", event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+994 50 000 00 00" /></div>
                <div><Label htmlFor="customer-request-code">{t("externalCode")}</Label><Input id="customer-request-code" value={form.externalCode} onChange={(event) => setField("externalCode", event.target.value)} /></div>
              </div>

              <details className="group mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-medium marker:hidden">
                  <span><span className="block">{t("customerRequestOptional")}</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t("customerRequestOptionalHint")}</span></span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="grid gap-3 border-t border-zinc-200 p-3.5 dark:border-zinc-700 sm:grid-cols-2">
                  <div><Label htmlFor="customer-request-contact">{t("contactPerson")}</Label><Input id="customer-request-contact" value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} /></div>
                  <div><Label htmlFor="customer-request-territory">{t("territoryCode")}</Label><Input id="customer-request-territory" value={form.territoryCode} onChange={(event) => setField("territoryCode", event.target.value)} /></div>
                  <div><Label htmlFor="customer-request-category">{t("category")}</Label><Select id="customer-request-category" value={form.category} onChange={(event) => setField("category", event.target.value)}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</Select></div>
                  <div><Label htmlFor="customer-request-potential">{t("potential")}</Label><Select id="customer-request-potential" value={form.potential} onChange={(event) => setField("potential", event.target.value)}>{["HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((value) => <option key={value} value={value}>{t(`customerPotential.${value}`)}</option>)}</Select></div>
                  <div><Label htmlFor="customer-request-city">{t("city")}</Label><Input id="customer-request-city" value={form.city} onChange={(event) => setField("city", event.target.value)} /></div>
                  <div><Label htmlFor="customer-request-district">{t("district")}</Label><Input id="customer-request-district" value={form.district} onChange={(event) => setField("district", event.target.value)} /></div>
                  <div className="sm:col-span-2"><Label htmlFor="customer-request-address">{t("address")}</Label><Input id="customer-request-address" value={form.address} onChange={(event) => setField("address", event.target.value)} autoComplete="street-address" /></div>
                </div>
              </details>
            </section>

            <section className="rounded-lg bg-muted/35 p-3.5" aria-labelledby="customer-location-heading">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div><div id="customer-location-heading" className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-primary" />{t("customerLocation")}</div><p className="mt-0.5 text-xs text-muted-foreground">{t("customerRequestLocationHint")}</p></div>
                <Button type="button" size="sm" variant="outline" onClick={locate} disabled={locating}><LocateFixed className="mr-1 h-4 w-4" />{locating ? t("locating") : t("useCurrentLocation")}</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="customer-request-lat">{t("latitude")}</Label><Input id="customer-request-lat" value={form.latitude} onChange={(event) => setField("latitude", event.target.value)} inputMode="decimal" /></div>
                <div><Label htmlFor="customer-request-lng">{t("longitude")}</Label><Input id="customer-request-lng" value={form.longitude} onChange={(event) => setField("longitude", event.target.value)} inputMode="decimal" /></div>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="customer-request-reason-heading">
              <div><Label id="customer-request-reason-heading" htmlFor="customer-request-reason">{t("customerRequestReason")} *</Label><p className="mb-1 text-xs text-muted-foreground">{t("customerRequestReasonHint")}</p><Textarea id="customer-request-reason" value={form.reason} onChange={(event) => setField("reason", event.target.value)} rows={3} /></div>
              <div><Label htmlFor="customer-request-comment">{t("agentComment")}</Label><p className="mb-1 text-xs text-muted-foreground">{t("agentCommentHint")}</p><Textarea id="customer-request-comment" value={form.agentComment} onChange={(event) => setField("agentComment", event.target.value)} rows={3} /></div>
            </section>

            {duplicates && duplicates.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{t("possibleDuplicates", { count: duplicates.length })}</div>
                <p className="mt-1 text-xs">{duplicates.map((candidate) => candidate.name).join(", ")}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleHelp className="h-3.5 w-3.5" />{t("customerRequestRequiredHint")}</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>{t("cancelBuilder")}</Button> : null}
                <Button type="button" onClick={submit} disabled={saving || form.name.trim().length < 2 || form.reason.trim().length < 3}>
                  {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {editingId ? t("resubmitRequest") : t("submitCustomerRequest")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700"><h3 className="text-sm font-semibold">{t("myCustomerRequests")}</h3><p className="mt-0.5 text-xs text-muted-foreground">{t("myCustomerRequestsSubtitle")}</p></div>
          {loading ? <div className="h-32 animate-pulse bg-muted/30" /> : null}
          {!loading && requests.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground"><Check className="mb-2 h-5 w-5 text-emerald-600" />{t("noCustomerRequests")}</div> : null}
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {requests.map((request) => (
              <article key={request.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="truncate text-sm font-medium">{request.name}</h3><p className="text-xs text-muted-foreground">{formatDateTime(new Date(request.updatedAt), locale)}</p></div>
                  <Badge variant={request.status === "APPROVED" ? "success" : request.status === "REJECTED" ? "destructive" : request.status === "NEEDS_INFO" ? "warning" : "info"}>{t(`customerRequestStatus.${request.status}`)}</Badge>
                </div>
                {request.decisionComment ? <p className="text-xs text-muted-foreground">{request.decisionComment}</p> : null}
                {request.approvedCustomer ? <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" />{request.approvedCustomer.name}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {request.status === "NEEDS_INFO" ? <Button type="button" size="sm" variant="outline" onClick={() => edit(request)}>{t("provideDetails")}</Button> : null}
                  {request.status === "APPROVED" && request.routeId && !request.routeOfferAcceptedAt ? <Button type="button" size="sm" onClick={() => acceptRouteOffer(request)}><Plus className="mr-1 h-4 w-4" />{t("offerAddToRoute")}</Button> : null}
                  {request.routeChangeRequestId ? <span className="self-center text-xs text-muted-foreground">{t("routeAdditionPending")}</span> : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
