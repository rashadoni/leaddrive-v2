"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useMtmFieldContacts } from "@/hooks/use-mtm-org-settings"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react"
import { toast } from "sonner"
import { MtmCustomerForm } from "@/components/mtm/customer-form"
import { Button } from "@/components/ui/button"
import { Hint, HintValue } from "@/components/hint"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"
import { hasCommercialFacts, organizationReferenceRows } from "@/lib/mtm/organization-card"
import { MtmClientVisitList, MtmClientVisitStrip } from "@/components/mtm/client-visit-strip"
import type { MtmClientVisitLine, MtmClientVisitSummary } from "@/lib/mtm/client-visit-summary"
import { mtmRoutePlanPageHref } from "@/lib/mtm/route-links"

type Agent = {
  id: string
  name: string
  role: string
  status: string
}

type Assignment = {
  id: string
  role: string
  effectiveFrom: string
  effectiveTo: string | null
  source: string
  reason: string | null
  agent: Agent
}

type OrganizationSummary = {
  id: string
  code: string | null
  name: string
  objectType: string
  category: string
  status: string
  address: string | null
  region: string | null
  administrativeDistrict: string | null
  locality: string | null
  cityDistrict: string | null
  city: string | null
  district: string | null
  specialization: string | null
  organizationKind: string | null
  territoryCode: string | null
  polygon: unknown
  latitude: number | null
  longitude: number | null
  phone: string | null
  contactPerson: string | null
  notes: string | null
  geofenceRadius: number | null
  createdAt: string
  updatedAt: string
  managingManager: Agent | null
  agentAssignments: Assignment[]
  _count: {
    contactWorkplaces: number
    visits: number
  }
  attributeFacts: Array<{
    medicalCategoryCode: string | null
    medicalCategoryLabels: unknown
    licenseStatus: string | null
    licenseLabels: unknown
    polygonCode: string | null
    polygonLabels: unknown
    package: {
      version: number
      sourceSystem: string
      sourceReference: string | null
      sourceObservedAt: string
      effectiveFrom: string
    }
  }>
}

type CommercialSummary = {
  month: string
  year: string
  monthTotals: Array<{ currency: string; amount: string }>
  yearTotals: Array<{ currency: string; amount: string }>
  latestSource: null | {
    externalDocumentNo: string
    documentDate: string
    status: string
    currency: string
    updatedAt: string
    sourceImportJob: null | {
      id: string
      type: string
      status: string
      originalFileName: string
      fileChecksum: string
      appliedAt: string | null
      createdAt: string
    }
  }
}

type CoordinateVerification = {
  id: string
  latitude: number
  longitude: number
  status: "VERIFIED" | "REJECTED"
  accuracyMeters: number | null
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  decisionReason: string | null
  verifiedAt: string
}

type Workplace = {
  id: string
  jobTitle: string | null
  department: string | null
  room: string | null
  phone: string | null
  isPrimary: boolean
  startedOn: string | null
  endedOn: string | null
  source: string
  contact: {
    id: string
    displayName: string
    type: string
    specialtyName: string | null
    qualificationCategory: string | null
    profile: string | null
    category: string
    status: string
    phone: string | null
    mobilePhone: string | null
    workPhone: string | null
    email: string | null
    verificationStatus: string
  }
}

/** A visit line of the card (who, to whom, what was shown), with what the agent recorded. */
type Visit = MtmClientVisitLine & {
  potential: string | null
  resultNotes: string | null
}

type FieldPotential = {
  id: string
  brandName: string | null
  productName: string | null
  category: string | null
  categoryLabel: string | null
  potentialValue: string | number
  coverageValue: string | number
  periodStart: string | null
  periodEnd: string | null
  source: string
  status: string
}

type StaffSection = {
  managingManager: Agent | null
  agentAssignments: Assignment[]
  fieldPotentials: FieldPotential[]
}

// The owner took departments, pharmacy promotions and files off the card on
// 2026-10-02: no tenant had a row in any of them. The section API still answers.
type DetailSection = "details" | "contacts" | "visits" | "staff"

// Hover hints for values whose meaning is not in their word (owner,
// 2026-10-15: «подсказок в модуле очень мало»). Key by key, so a test finds
// every one of them.
const STATUS_HINT: Record<string, string> = {
  INACTIVE: "detail.hint.statusInactive",
  PROSPECT: "detail.hint.statusProspect",
}
const ASSIGNMENT_ROLE_HINT: Record<string, string> = {
  PRIMARY: "detail.hint.rolePrimary",
  SECONDARY: "detail.hint.roleSecondary",
}
type LoadableSection = Exclude<DetailSection, "details">

type ApiPayload<T> = {
  success: boolean
  error?: string
  data: {
    organization: T
    asOf: string
    timezone: string
    capabilities: {
      canManage: boolean
      canRequestChanges: boolean
    }
    commercial?: CommercialSummary | null
    coordinateVerification?: CoordinateVerification | null
    visitSummary?: MtmClientVisitSummary
    longOpenMinutes?: number
  }
}

function safeReturnHref(value: string | null): string {
  if (value === "/mtm" || value?.startsWith("/mtm?")) return value
  if (!value || (value !== "/mtm/customers" && !value.startsWith("/mtm/customers?"))) {
    return "/mtm/customers"
  }
  return value
}

function DefinitionRow({
  label,
  value,
  className,
  hint,
}: {
  label: string
  value: React.ReactNode
  className?: string
  /** What the row means or how it is counted, under the cursor on its label. */
  hint?: string | null
}) {
  return (
    <div className={cn("grid gap-0.5 border-b border-border py-2 last:border-0 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-4", className)}>
      <dt className="text-xs font-medium text-muted-foreground"><HintValue text={hint}>{label}</HintValue></dt>
      <dd className="min-w-0 text-sm">{value || "—"}</dd>
    </div>
  )
}

function StateBadge({
  children,
  tone = "neutral",
  hint,
}: {
  children: React.ReactNode
  tone?: "positive" | "warning" | "neutral"
  /** What the badge means, under the cursor. */
  hint?: string | null
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
      tone === "positive" && "text-emerald-700 dark:text-emerald-300",
      tone === "warning" && "text-amber-700 dark:text-amber-300",
      tone === "neutral" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    )}>
      <HintValue text={hint}>{children}</HintValue>
    </span>
  )
}

export function MtmOrganizationDetail({ organizationId }: { organizationId: string }) {
  const t = useTranslations("mtmCustomers")
  const explorer = useTranslations("mtmCustomers.explorer")
  const visitWords = useTranslations("mtmClientVisits")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  // Organization switch: when field contacts are off the tab, its count and
  // links to contact cards disappear. Data and the section API are untouched.
  const { enabled: fieldContactsEnabled } = useMtmFieldContacts(session?.user)
  const [summary, setSummary] = useState<OrganizationSummary | null>(null)
  const [commercial, setCommercial] = useState<CommercialSummary | null>(null)
  const [coordinateVerification, setCoordinateVerification] = useState<CoordinateVerification | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [contacts, setContacts] = useState<Workplace[] | null>(null)
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [staff, setStaff] = useState<StaffSection | null>(null)
  // The card opens on its visits (owner, 2026-10-16, from a picture).
  const [activeSection, setActiveSection] = useState<DetailSection>("visits")
  const [visitSummary, setVisitSummary] = useState<MtmClientVisitSummary | null>(null)
  const [longOpenMinutes, setLongOpenMinutes] = useState(120)
  const [timezone, setTimezone] = useState("Asia/Baku")
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [sectionLoading, setSectionLoading] = useState<LoadableSection | null>(null)
  const [error, setError] = useState("")
  const [sectionError, setSectionError] = useState("")
  const [editOpen, setEditOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [coordinateSource, setCoordinateSource] = useState("")
  const [coordinateReference, setCoordinateReference] = useState("")

  const requestHeaders = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": String(orgId) } : {},
    [orgId],
  )
  const returnHref = safeReturnHref(searchParams.get("returnTo"))
  const dateTimeFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )
  const dateFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium" }),
    [locale],
  )
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  )

  const fetchSection = useCallback(async <T,>(section: "summary" | LoadableSection): Promise<ApiPayload<T>> => {
    const response = await fetch(`/api/v1/mtm/organizations/${organizationId}?section=${section}`, {
      headers: requestHeaders,
    })
    const payload = await response.json() as ApiPayload<T>
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || t("detail.loadError"))
    }
    return payload
  }, [organizationId, requestHeaders, t])

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    setError("")
    try {
      // The visits tab is the one the card opens on: it is read with the summary.
      const [payload, visitsPayload] = await Promise.all([
        fetchSection<OrganizationSummary>("summary"),
        fetchSection<{ visits: Visit[] }>("visits").catch((visitsError: unknown) => {
          setSectionError(visitsError instanceof Error ? visitsError.message : t("detail.sectionLoadError"))
          return null
        }),
      ])
      if (visitsPayload) setVisits(visitsPayload.data.organization.visits)
      setSummary(payload.data.organization)
      setCommercial(payload.data.commercial ?? null)
      setCoordinateVerification(payload.data.coordinateVerification ?? null)
      setCanManage(payload.data.capabilities.canManage)
      setVisitSummary(payload.data.visitSummary ?? null)
      setLongOpenMinutes(payload.data.longOpenMinutes ?? 120)
      setTimezone(payload.data.timezone || "Asia/Baku")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("detail.loadError"))
    } finally {
      setLoadingSummary(false)
    }
  }, [fetchSection, t])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const loadDetailSection = useCallback(async (section: LoadableSection, force = false) => {
    if (!force && (
      (section === "contacts" && contacts !== null)
      || (section === "visits" && visits !== null)
      || (section === "staff" && staff !== null)
    )) return

    setSectionLoading(section)
    setSectionError("")
    try {
      if (section === "contacts") {
        const payload = await fetchSection<{ contactWorkplaces: Workplace[] }>("contacts")
        setContacts(payload.data.organization.contactWorkplaces)
      } else if (section === "visits") {
        const payload = await fetchSection<{ visits: Visit[] }>("visits")
        setVisits(payload.data.organization.visits)
      } else {
        const payload = await fetchSection<StaffSection>("staff")
        setStaff(payload.data.organization)
      }
    } catch (loadError) {
      setSectionError(loadError instanceof Error ? loadError.message : t("detail.sectionLoadError"))
    } finally {
      setSectionLoading(null)
    }
  }, [contacts, fetchSection, staff, t, visits])

  function selectSection(value: string) {
    const section = value as DetailSection
    setActiveSection(section)
    setSectionError("")
    if (section !== "details") {
      void loadDetailSection(section)
    }
  }

  async function verifyCoordinates() {
    if (!coordinateSource.trim()) return
    setActionLoading(true)
    try {
      const response = await fetch(`/api/v1/mtm/organizations/${organizationId}/coordinate-verifications`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "VERIFIED",
          sourceSystem: coordinateSource,
          sourceReference: coordinateReference || null,
          sourceObservedAt: new Date().toISOString(),
        }),
      })
      const payload = await response.json() as { success?: boolean; error?: string; data?: { coordinateVerification: CoordinateVerification } }
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || t("detail.actionFailed"))
      setCoordinateVerification(payload.data.coordinateVerification)
      setCoordinateSource("")
      setCoordinateReference("")
      toast.success(t("detail.coordinatesVerified"))
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : t("detail.actionFailed"))
    } finally {
      setActionLoading(false)
    }
  }

  if (loadingSummary) {
    return (
      <div className="space-y-4" aria-label={t("detail.loading")}>
        <div className="h-44 animate-pulse rounded-2xl bg-muted" />
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="grid max-w-md gap-4 text-center">
          <CircleAlert className="mx-auto h-10 w-10 text-destructive" />
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold">{t("detail.loadFailed")}</h1>
            <p className="text-sm text-muted-foreground">{error || t("detail.notFound")}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button asChild variant="outline"><Link href={returnHref}>{t("detail.backToList")}</Link></Button>
            <Button onClick={() => void loadSummary()}><RefreshCw className="h-4 w-4" />{t("detail.retry")}</Button>
          </div>
        </div>
      </div>
    )
  }

  const owners = summary.agentAssignments.filter((item) => item.role === "PRIMARY")
  // Master-data attributes, the coordinate receipt and shipments belong to the
  // few organizations that carry them; everyone else gets contact data only.
  const referenceRows = organizationReferenceRows(summary)
  const showCommercial = hasCommercialFacts(commercial)
  const hasCoordinates = summary.latitude !== null && summary.longitude !== null
  const mapHref = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${summary.latitude}&mlon=${summary.longitude}#map=18/${summary.latitude}/${summary.longitude}`
    : null
  const locationLine = [
    summary.locality || summary.city,
    summary.cityDistrict || summary.district,
    summary.region,
  ].filter(Boolean).join(", ")
  const organizationType = summary.organizationKind || explorer(`objectTypes.${summary.objectType}`)
  const formatTotals = (totals: Array<{ currency: string; amount: string }>) => (
    totals.length
      ? totals.map((row) => `${numberFormatter.format(Number(row.amount))} ${row.currency}`).join(" · ")
      : t("detail.noCommercialData")
  )
  const hintFor = (keys: Record<string, string>, value: string) => keys[value] ? t(keys[value]) : null
  // «В маршрут»: the planner on a map, of the responsible employee, the institution on the route.
  const planHref = mtmRoutePlanPageHref({ customerId: organizationId, agentId: owners[0]?.agent.id })

  return (
    <div data-testid="mtm-organization-detail" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-11 md:min-h-9">
          <Link href={returnHref}>
            <ArrowLeft className="h-4 w-4" />
            {t("detail.backToList")}
          </Link>
        </Button>
        {summary.updatedAt ? (
          <span className="text-xs text-muted-foreground">
            {t("detail.updatedAt", { date: dateTimeFormatter.format(new Date(summary.updatedAt)) })}
          </span>
        ) : null}
      </div>

      <header className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-5">
          <div className="grid min-w-0 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge tone={summary.status === "ACTIVE" ? "positive" : "warning"} hint={hintFor(STATUS_HINT, summary.status)}>
                {explorer(`statuses.${summary.status}`)}
              </StateBadge>
              <StateBadge hint={t("detail.hint.category")}>{explorer("categoryShort", { category: summary.category })}</StateBadge>
              <StateBadge>{organizationType}</StateBadge>
              {summary.code ? <StateBadge hint={t("detail.hint.code")}>{t("detail.etalonId")}: {summary.code}</StateBadge> : null}
            </div>
            <div className="grid gap-2">
              <h1 className="max-w-4xl text-2xl font-semibold tracking-tight">{summary.name}</h1>
              <p className="flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 flex-none" />
                <span>{summary.address || locationLine || t("detail.addressMissing")}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {owners.length > 0 ? (
                <span className="inline-flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <HintValue text={t("detail.hint.owner")}>{owners.map((item) => item.agent.name).join(", ")}</HintValue>
                </span>
              ) : (
                // Nobody responsible: say so, and offer to name somebody.
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                    <UserRound className="h-4 w-4" />
                    <HintValue text={t("detail.hint.owner")}>{visitWords("unassigned")}</HintValue>
                  </span>
                  {canManage ? (
                    <Hint text={visitWords("hint.assign")}>
                      <Link
                        href={`/mtm/customers?assignmentTarget=${encodeURIComponent(organizationId)}&assignmentMode=ASSIGN`}
                        data-testid="mtm-organization-detail-assign"
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-primary/50 px-3 text-[13px] font-semibold text-primary hover:bg-primary/5"
                      >
                        <UserPlus className="h-4 w-4" />{visitWords("assign")}
                      </Link>
                    </Hint>
                  ) : null}
                </span>
              )}
              {summary.phone ? (
                <a className="inline-flex items-center gap-2 underline-offset-4 hover:underline" href={`tel:${summary.phone}`}>
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {summary.phone}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {mapHref ? (
              <Hint text={t("detail.hint.openMap")}>
                <Button asChild variant="outline" className="min-h-11 md:min-h-9">
                  <a href={mapHref} target="_blank" rel="noreferrer">
                    <MapPin className="h-4 w-4" />
                    {t("detail.openMap")}
                  </a>
                </Button>
              </Hint>
            ) : null}
            {canManage ? (
              <Hint text={t("detail.hint.edit")}>
                <Button
                  variant="outline"
                  className="min-h-11 md:min-h-9"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("detail.edit")}
                </Button>
              </Hint>
            ) : null}
            <Hint text={visitWords("hint.toRoute")}>
              <Button asChild className="min-h-11 md:min-h-9">
                <Link href={planHref} data-testid="mtm-organization-detail-to-route">
                  <CalendarPlus className="h-4 w-4" />
                  {visitWords("toRoute")}
                </Link>
              </Button>
            </Hint>
          </div>
        </div>
        {/* Owner, 2026-10-16, from a picture: the visits on top — last, open
            now, the clients here and the next visit — where four counters
            stood (the reference ID is a badge now, GPS is in «Сведения»). */}
        {visitSummary ? (
          <MtmClientVisitStrip
            kind="institution"
            // A tenant that switched field contacts off has no «clients here».
            summary={fieldContactsEnabled ? visitSummary : { ...visitSummary, clientsHere: undefined }}
            longOpenMinutes={longOpenMinutes}
            timezone={timezone}
            orgId={orgId ? String(orgId) : undefined}
            planHref={planHref}
          />
        ) : null}
      </header>

      <Tabs value={!fieldContactsEnabled && activeSection === "contacts" ? "details" : activeSection} onValueChange={selectSection}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start p-1">
            {([
              ["visits", CalendarDays],
              ["contacts", Stethoscope],
              ["details", Building2],
              ["staff", UsersRound],
            ] as const).filter(([section]) => (fieldContactsEnabled || section !== "contacts")).map(([section, Icon]) => (
              <TabsTrigger key={section} value={section} className="min-h-10 gap-2 px-3">
                <Icon className="h-4 w-4" />
                {t(`detail.tabs.${section}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="details">
          <div className={cn("grid gap-5", referenceRows.length || coordinateVerification ? "xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]" : null)}>
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="text-base font-semibold">{t("detail.contactDetails")}</h2>
              <dl className="mt-2">
                <DefinitionRow label={t("detail.contactPerson")} value={summary.contactPerson} />
                <DefinitionRow
                  label={t("detail.phone")}
                  value={summary.phone ? <a className="underline-offset-4 hover:underline" href={`tel:${summary.phone}`}>{summary.phone}</a> : null}
                />
                <DefinitionRow label={t("detail.address")} value={summary.address} />
                <DefinitionRow label={t("detail.locality")} value={summary.locality || summary.city} />
                <DefinitionRow label={t("detail.cityDistrict")} value={summary.cityDistrict || summary.district} />
                <DefinitionRow label={t("detail.gps")} hint={t("detail.hint.gps")} value={hasCoordinates ? t("detail.coordinatesRecorded") : t("detail.coordinatesMissing")} />
                {summary.notes ? <DefinitionRow label={t("detail.notes")} value={summary.notes} /> : null}
              </dl>
            </section>

            {referenceRows.length || coordinateVerification ? <div className="grid content-start gap-5">
              {referenceRows.length ? <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <h2 className="text-base font-semibold">{t("detail.additionalDetails")}</h2>
                <dl className="mt-2">
                  {referenceRows.map((row) => (
                    <DefinitionRow key={row.key} label={t(`detail.${row.key}`)} value={row.value ?? t("detail.polygonConfigured")} />
                  ))}
                </dl>
              </section> : null}

              {coordinateVerification ? <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{t("detail.coordinateQuality")}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{t("detail.coordinateHonesty")}</p>
                  </div>
                  {hasCoordinates ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <CircleAlert className="h-5 w-5 text-amber-600" />}
                </div>
                <dl className="mt-2">
                  <DefinitionRow label={t("detail.latitude")} value={summary.latitude?.toFixed(6)} />
                  <DefinitionRow label={t("detail.longitude")} value={summary.longitude?.toFixed(6)} />
                  <DefinitionRow label={t("detail.geofenceRadius")} hint={t("detail.hint.geofenceRadius")} value={summary.geofenceRadius ? t("detail.meters", { count: summary.geofenceRadius }) : null} />
                  <DefinitionRow label={t("detail.coordinateSource")} value={coordinateVerification?.sourceSystem || (hasCoordinates ? t("detail.crmCoordinateSource") : null)} />
                  <DefinitionRow
                    label={t("detail.verification")}
                    value={coordinateVerification ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <StateBadge tone={coordinateVerification.status === "VERIFIED" ? "positive" : "warning"}>
                          {t(`detail.coordinateStatuses.${coordinateVerification.status}`)}
                        </StateBadge>
                        <span className="text-xs text-muted-foreground">{dateTimeFormatter.format(new Date(coordinateVerification.verifiedAt))}</span>
                      </span>
                    ) : <StateBadge tone="warning">{t("detail.verificationUnavailable")}</StateBadge>}
                  />
                </dl>
                {mapHref ? (
                  <Hint text={t("detail.hint.openMap")} align="start">
                    <a className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline" href={mapHref} target="_blank" rel="noreferrer">
                      {t("detail.verifyOnMap")}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Hint>
                ) : null}
                {canManage && hasCoordinates ? (
                  <div className="mt-4 grid gap-2 border-t border-border pt-4">
                    <input
                      value={coordinateSource}
                      onChange={(event) => setCoordinateSource(event.target.value)}
                      placeholder={t("detail.sourceSystem")}
                      maxLength={200}
                      className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <input
                      value={coordinateReference}
                      onChange={(event) => setCoordinateReference(event.target.value)}
                      placeholder={t("detail.sourceReference")}
                      maxLength={500}
                      className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <Hint wrap text={actionLoading ? null : !coordinateSource.trim() ? t("detail.hint.confirmCoordinatesNeedsSource") : t("detail.hint.confirmCoordinates")}>
                      <Button type="button" className="w-full" disabled={actionLoading || !coordinateSource.trim()} onClick={() => void verifyCoordinates()}>
                        <ShieldCheck className="h-4 w-4" />
                        {t("detail.confirmCoordinates")}
                      </Button>
                    </Hint>
                  </div>
                ) : null}
              </section> : null}
            </div> : null}
          </div>
          {showCommercial ? <section className="mt-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{t("detail.commercialTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("detail.commercialDescription")}</p>
              </div>
              {commercial?.latestSource ? <StateBadge tone="positive" hint={t("detail.hint.sourceRecorded")}>{t("detail.sourceRecorded")}</StateBadge> : <StateBadge tone="warning" hint={t("detail.hint.noSource")}>{t("detail.noSource")}</StateBadge>}
            </div>
            <dl className="mt-3 grid gap-x-8 lg:grid-cols-2">
              <DefinitionRow label={t("detail.monthShipments", { period: commercial?.month ?? "—" })} hint={t("detail.hint.monthShipments")} value={commercial ? formatTotals(commercial.monthTotals) : null} />
              <DefinitionRow label={t("detail.yearShipments", { period: commercial?.year ?? "—" })} hint={t("detail.hint.yearShipments")} value={commercial ? formatTotals(commercial.yearTotals) : null} />
              <DefinitionRow label={t("detail.latestCommercialDocument")} value={commercial?.latestSource?.externalDocumentNo} />
              <DefinitionRow label={t("detail.sourceFreshness")} hint={t("detail.hint.sourceFreshness")} value={commercial?.latestSource ? dateTimeFormatter.format(new Date(commercial.latestSource.sourceImportJob?.appliedAt || commercial.latestSource.updatedAt)) : null} />
              <DefinitionRow label={t("detail.sourceFile")} value={commercial?.latestSource?.sourceImportJob?.originalFileName} />
              <DefinitionRow label={t("detail.sourceStatus")} value={commercial?.latestSource?.sourceImportJob?.status || commercial?.latestSource?.status} />
            </dl>
          </section> : null}
        </TabsContent>

        {fieldContactsEnabled ? <TabsContent value="contacts">
          <SectionFrame title={t("detail.contactsTitle")} description={t("detail.contactsDescription")}>
            <SectionState loading={sectionLoading === "contacts"} error={sectionError} retry={() => void loadDetailSection("contacts")} t={t}>
              {contacts?.length ? (
                <div className="divide-y divide-border">
                  {contacts.map((workplace) => (
                    <article key={workplace.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.55fr)]">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            <Link
                              className="text-primary underline-offset-4 hover:underline"
                              href={`/mtm/contacts/${workplace.contact.id}?returnTo=${encodeURIComponent(`/mtm/customers/${organizationId}?returnTo=${encodeURIComponent(returnHref)}`)}`}
                            >
                              {workplace.contact.displayName}
                            </Link>
                          </h3>
                          {workplace.isPrimary ? <StateBadge tone="positive" hint={t("detail.hint.primaryWorkplace")}>{t("detail.primaryWorkplace")}</StateBadge> : null}
                          {workplace.endedOn ? <StateBadge hint={t("detail.hint.historicalWorkplace")}>{t("detail.historicalWorkplace")}</StateBadge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[workplace.contact.specialtyName, workplace.jobTitle, workplace.department].filter(Boolean).join(" · ") || t("detail.contactRoleMissing")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <HintValue text={t("detail.hint.contactCategory")}>{t("detail.contactCategory", { category: workplace.contact.category })}</HintValue>
                        </p>
                      </div>
                      <div className="grid content-start gap-1 text-sm">
                        {workplace.contact.phone || workplace.contact.mobilePhone || workplace.phone ? (
                          <a className="inline-flex items-center gap-2 hover:underline" href={`tel:${workplace.contact.phone || workplace.contact.mobilePhone || workplace.phone}`}>
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            {workplace.contact.phone || workplace.contact.mobilePhone || workplace.phone}
                          </a>
                        ) : <span className="text-muted-foreground">{t("detail.phoneMissing")}</span>}
                        {workplace.room ? <span className="text-muted-foreground">{t("detail.room", { room: workplace.room })}</span> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <EmptySection icon={Stethoscope} title={t("detail.noContacts")} description={t("detail.noContactsDescription")} />}
            </SectionState>
          </SectionFrame>
        </TabsContent> : null}

        <TabsContent value="visits">
          {/* One line a visit: when, who, to which doctor, what was shown, and
              «не закрыт агентом» for a visit left open (owner, 2026-10-16). */}
          <SectionState loading={sectionLoading === "visits" || (visits === null && !sectionError)} error={sectionError} retry={() => void loadDetailSection("visits", true)} t={t}>
            <MtmClientVisitList
              kind="institution"
              visits={visits ?? []}
              total={visitSummary?.total ?? visits?.length ?? 0}
              longOpenMinutes={longOpenMinutes}
              timezone={timezone}
            />
          </SectionState>
        </TabsContent>

        <TabsContent value="staff">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
            <SectionFrame title={t("detail.assignmentHistory")} description={t("detail.assignmentHistoryDescription")}>
              <SectionState loading={sectionLoading === "staff"} error={sectionError} retry={() => void loadDetailSection("staff")} t={t}>
                {canManage ? (
                  <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
                    <Hint text={t("detail.hint.assign")}>
                      <Button asChild size="sm">
                        <Link href={`/mtm/customers?assignmentTarget=${encodeURIComponent(organizationId)}&assignmentMode=ASSIGN`}><UserPlus className="h-4 w-4" />{explorer("assign")}</Link>
                      </Button>
                    </Hint>
                    <Hint text={t("detail.hint.unassign")}>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/mtm/customers?assignmentTarget=${encodeURIComponent(organizationId)}&assignmentMode=UNASSIGN`}><UserMinus className="h-4 w-4" />{explorer("unassign")}</Link>
                      </Button>
                    </Hint>
                  </div>
                ) : null}
                {staff?.agentAssignments.length ? (
                  <div className="divide-y divide-border">
                    {staff.agentAssignments.map((assignment) => (
                      <article key={assignment.id} className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{assignment.agent.name}</h3>
                            <StateBadge hint={hintFor(ASSIGNMENT_ROLE_HINT, assignment.role)}>{t(`detail.assignmentRoles.${assignment.role}`)}</StateBadge>
                            {!assignment.effectiveTo ? <StateBadge tone="positive" hint={t("detail.hint.currentAssignment")}>{t("detail.currentAssignment")}</StateBadge> : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{assignment.reason || t("detail.assignmentReasonMissing")}</p>
                        </div>
                        <p className="text-xs tabular-nums text-muted-foreground sm:text-right">
                          {dateFormatter.format(new Date(assignment.effectiveFrom))}
                          {" — "}
                          {assignment.effectiveTo ? dateFormatter.format(new Date(assignment.effectiveTo)) : t("detail.present")}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : <EmptySection icon={UsersRound} title={t("detail.noAssignments")} description={t("detail.noAssignmentsDescription")} />}
              </SectionState>
            </SectionFrame>

            <SectionFrame title={t("detail.managerAndCoverage")} description={t("detail.managerAndCoverageDescription")}>
              <SectionState loading={sectionLoading === "staff"} error={sectionError} retry={() => void loadDetailSection("staff")} t={t}>
                <dl>
                  <DefinitionRow label={t("detail.managingManager")} hint={t("detail.hint.managingManager")} value={staff?.managingManager?.name} />
                  <DefinitionRow label={t("detail.potentialRecords")} hint={t("detail.hint.potentialRecords")} value={staff ? numberFormatter.format(staff.fieldPotentials.length) : null} />
                  <DefinitionRow label={t("detail.coverageAsOf")} hint={t("detail.hint.coverageAsOf")} value={staff?.fieldPotentials[0]?.periodStart ? dateFormatter.format(new Date(staff.fieldPotentials[0].periodStart)) : null} />
                </dl>
              </SectionState>
            </SectionFrame>
          </div>
        </TabsContent>
      </Tabs>

      <MtmCustomerForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          toast.success(t("detail.updated"))
          void loadSummary()
        }}
        initialData={summary}
        orgId={orgId ? String(orgId) : undefined}
        apiBasePath="/api/v1/mtm/organizations"
      />
    </div>
  )
}

function SectionFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 grid gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function SectionState({
  loading,
  error,
  retry,
  t,
  children,
}: {
  loading: boolean
  error: string
  retry: () => void
  t: ReturnType<typeof useTranslations>
  children: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="grid gap-2" aria-label={t("detail.sectionLoading")}>
        {[1, 2, 3].map((row) => <div key={row} className="h-16 animate-pulse rounded-lg bg-muted" />)}
      </div>
    )
  }
  if (error) {
    return (
      <div className="grid min-h-40 place-items-center gap-3 text-center">
        <CircleAlert className="h-7 w-7 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={retry}>{t("detail.retry")}</Button>
      </div>
    )
  }
  return children
}

function EmptySection({
  icon: Icon,
  title,
  description,
  honest = false,
}: {
  icon: typeof Building2
  title: string
  description: string
  honest?: boolean
}) {
  return (
    <div className="grid min-h-44 place-items-center text-center">
      <div className="grid max-w-lg gap-3">
        <span className="mx-auto grid h-11 w-11 place-items-center">
          {honest ? <Clock3 className="h-5 w-5 text-muted-foreground" /> : <Icon className="h-5 w-5 text-muted-foreground" />}
        </span>
        <div className="grid gap-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  )
}
