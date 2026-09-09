"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  MapPin,
  Megaphone,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react"
import { toast } from "sonner"
import { MtmCustomerForm } from "@/components/mtm/customer-form"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"

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

type Visit = {
  id: string
  status: string
  checkInAt: string
  checkOutAt: string | null
  outcome: string | null
  potential: string | null
  resultNotes: string | null
  agent: {
    id: string
    name: string
  }
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

type Department = {
  id: string
  code: string | null
  name: string
  kind: string | null
  phone: string | null
  email: string | null
  address: string | null
  contactPerson: string | null
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  createdAt: string
}

type PromotionTarget = {
  id: string
  status: string
  eligibilityStatus: string
  planQuantity: string | number
  unit: string
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  connectedAt: string | null
  closedAt: string | null
  assignedAgent: { id: string; name: string }
  promotionVersion: {
    id: string
    revision: number
    nameRu: string
    nameAz: string
    nameEn: string
    startsOn: string
    endsOn: string
    status: string
    promotion: { code: string }
    type: { code: string; nameRu: string; nameAz: string; nameEn: string }
  }
  executions: Array<{
    id: string
    status: string
    actualQuantity: string | number
    factPointsPreview: string | number | null
    rewardPointsPreview: string | number | null
    differencePointsPreview: string | number | null
    l1State: string
    l2State: string
    submittedAt: string | null
    closedAt: string | null
  }>
}

type OrganizationDocument = {
  id: string
  title: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  sourceSystem: string | null
  sourceReference: string | null
  sourceObservedAt: string | null
  createdAt: string
}

type DetailSection = "details" | "contacts" | "visits" | "departments" | "staff" | "promotions" | "files"
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
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid gap-1 border-b border-zinc-200 py-3 last:border-0 dark:border-zinc-700 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-4", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{value || "—"}</dd>
    </div>
  )
}

function StateBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "positive" | "warning" | "neutral"
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
      tone === "positive" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
      tone === "warning" && "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
      tone === "neutral" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    )}>
      {children}
    </span>
  )
}

export function MtmOrganizationDetail({ organizationId }: { organizationId: string }) {
  const t = useTranslations("mtmCustomers")
  const explorer = useTranslations("mtmCustomers.explorer")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [summary, setSummary] = useState<OrganizationSummary | null>(null)
  const [commercial, setCommercial] = useState<CommercialSummary | null>(null)
  const [coordinateVerification, setCoordinateVerification] = useState<CoordinateVerification | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [contacts, setContacts] = useState<Workplace[] | null>(null)
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [staff, setStaff] = useState<StaffSection | null>(null)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [promotions, setPromotions] = useState<PromotionTarget[] | null>(null)
  const [documents, setDocuments] = useState<OrganizationDocument[] | null>(null)
  const [activeSection, setActiveSection] = useState<DetailSection>("details")
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [sectionLoading, setSectionLoading] = useState<LoadableSection | null>(null)
  const [error, setError] = useState("")
  const [sectionError, setSectionError] = useState("")
  const [editOpen, setEditOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [departmentDraft, setDepartmentDraft] = useState({ name: "", code: "", sourceSystem: "", sourceReference: "" })
  const [coordinateSource, setCoordinateSource] = useState("")
  const [coordinateReference, setCoordinateReference] = useState("")
  const [documentSource, setDocumentSource] = useState("")
  const [documentReference, setDocumentReference] = useState("")

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
      const payload = await fetchSection<OrganizationSummary>("summary")
      setSummary(payload.data.organization)
      setCommercial(payload.data.commercial ?? null)
      setCoordinateVerification(payload.data.coordinateVerification ?? null)
      setCanManage(payload.data.capabilities.canManage)
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
      || (section === "departments" && departments !== null)
      || (section === "promotions" && promotions !== null)
      || (section === "files" && documents !== null)
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
      } else if (section === "staff") {
        const payload = await fetchSection<StaffSection>("staff")
        setStaff(payload.data.organization)
      } else if (section === "departments") {
        const payload = await fetchSection<{ departments: Department[] }>("departments")
        setDepartments(payload.data.organization.departments)
      } else if (section === "promotions") {
        const payload = await fetchSection<{ pharmacyPromotionTargets: PromotionTarget[] }>("promotions")
        setPromotions(payload.data.organization.pharmacyPromotionTargets)
      } else {
        const payload = await fetchSection<{ documents: OrganizationDocument[] }>("files")
        setDocuments(payload.data.organization.documents)
      }
    } catch (loadError) {
      setSectionError(loadError instanceof Error ? loadError.message : t("detail.sectionLoadError"))
    } finally {
      setSectionLoading(null)
    }
  }, [contacts, departments, documents, fetchSection, promotions, staff, t, visits])

  function selectSection(value: string) {
    const section = value as DetailSection
    setActiveSection(section)
    setSectionError("")
    if (section !== "details") {
      void loadDetailSection(section)
    }
  }

  async function createDepartment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!departmentDraft.name.trim() || !departmentDraft.sourceSystem.trim()) return
    setActionLoading(true)
    try {
      const response = await fetch(`/api/v1/mtm/organizations/${organizationId}/departments`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: departmentDraft.name,
          code: departmentDraft.code || null,
          sourceSystem: departmentDraft.sourceSystem,
          sourceReference: departmentDraft.sourceReference || null,
          sourceObservedAt: new Date().toISOString(),
        }),
      })
      const payload = await response.json() as { success?: boolean; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || t("detail.actionFailed"))
      setDepartmentDraft({ name: "", code: "", sourceSystem: "", sourceReference: "" })
      await loadDetailSection("departments", true)
      toast.success(t("detail.departmentAdded"))
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : t("detail.actionFailed"))
    } finally {
      setActionLoading(false)
    }
  }

  async function archiveDepartment(departmentId: string) {
    setActionLoading(true)
    try {
      const response = await fetch(`/api/v1/mtm/organizations/${organizationId}/departments/${departmentId}`, {
        method: "DELETE",
        headers: requestHeaders,
      })
      const payload = await response.json() as { success?: boolean; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || t("detail.actionFailed"))
      setDepartments((current) => current?.filter((item) => item.id !== departmentId) ?? null)
      toast.success(t("detail.departmentArchived"))
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : t("detail.actionFailed"))
    } finally {
      setActionLoading(false)
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

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.elements.namedItem("organizationDocument") as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file || !documentSource.trim()) return
    setActionLoading(true)
    try {
      const data = new FormData()
      data.set("file", file)
      data.set("clientDocumentId", crypto.randomUUID())
      data.set("title", file.name)
      data.set("sourceSystem", documentSource)
      data.set("sourceReference", documentReference)
      data.set("sourceObservedAt", new Date().toISOString())
      const response = await fetch(`/api/v1/mtm/organizations/${organizationId}/documents`, { method: "POST", headers: requestHeaders, body: data })
      const payload = await response.json() as { success?: boolean; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || t("detail.actionFailed"))
      form.reset()
      setDocumentSource("")
      setDocumentReference("")
      await loadDetailSection("files", true)
      toast.success(t("detail.fileUploaded"))
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
  const attributeFact = summary.attributeFacts[0] ?? null
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
  const localizedPromotionName = (promotion: PromotionTarget["promotionVersion"]) => (
    locale.startsWith("az") ? promotion.nameAz : locale.startsWith("en") ? promotion.nameEn : promotion.nameRu
  )
  const formatTotals = (totals: Array<{ currency: string; amount: string }>) => (
    totals.length
      ? totals.map((row) => `${numberFormatter.format(Number(row.amount))} ${row.currency}`).join(" · ")
      : t("detail.noCommercialData")
  )

  return (
    <div data-testid="mtm-organization-detail" className="space-y-5">
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

      <header className="overflow-hidden rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-7">
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge tone={summary.status === "ACTIVE" ? "positive" : "warning"}>
                {explorer(`statuses.${summary.status}`)}
              </StateBadge>
              <StateBadge>{explorer("categoryShort", { category: summary.category })}</StateBadge>
              <StateBadge>{organizationType}</StateBadge>
            </div>
            <div className="grid gap-2">
              <h1 className="max-w-4xl text-2xl font-semibold tracking-tight md:text-3xl">{summary.name}</h1>
              <p className="flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 flex-none" />
                <span>{summary.address || locationLine || t("detail.addressMissing")}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                {owners.map((item) => item.agent.name).join(", ") || t("detail.unassigned")}
              </span>
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
              <Button asChild variant="outline" className="min-h-11 md:min-h-9">
                <a href={mapHref} target="_blank" rel="noreferrer">
                  <MapPin className="h-4 w-4" />
                  {t("detail.openMap")}
                </a>
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant="outline"
                className="min-h-11 md:min-h-9"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-4 w-4" />
                {t("detail.edit")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid divide-y border-t border-zinc-200 bg-muted/25 dark:border-zinc-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {[
            [t("detail.etalonId"), summary.code || "—"],
            [t("detail.contacts"), numberFormatter.format(summary._count.contactWorkplaces)],
            [t("detail.visits"), numberFormatter.format(summary._count.visits)],
            [t("detail.gps"), hasCoordinates ? t("detail.coordinatesRecorded") : t("detail.coordinatesMissing")],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-3">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className="truncate text-sm font-semibold">{value}</span>
            </div>
          ))}
        </div>
      </header>

      <Tabs value={activeSection} onValueChange={selectSection}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start p-1">
            {([
              ["details", Building2],
              ["contacts", Stethoscope],
              ["visits", CalendarDays],
              ["departments", FolderOpen],
              ["staff", UsersRound],
              ["promotions", Megaphone],
              ["files", FileText],
            ] as const).map(([section, Icon]) => (
              <TabsTrigger key={section} value={section} className="min-h-10 gap-2 px-3">
                <Icon className="h-4 w-4" />
                {t(`detail.tabs.${section}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="details">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
              <h2 className="text-base font-semibold">{t("detail.coreDetails")}</h2>
              <dl className="mt-2">
                <DefinitionRow label={t("detail.etalonId")} value={summary.code} />
                <DefinitionRow label={t("detail.organizationType")} value={organizationType} />
                <DefinitionRow label={t("detail.specialization")} value={summary.specialization} />
                <DefinitionRow label={t("detail.category")} value={attributeFact?.medicalCategoryCode || explorer("categoryShort", { category: summary.category })} />
                <DefinitionRow label={t("detail.createdAt")} value={dateFormatter.format(new Date(summary.createdAt))} />
                <DefinitionRow label={t("detail.okpo")} value={<span className="text-muted-foreground">{t("detail.notModeled")}</span>} />
                <DefinitionRow label={t("detail.license")} value={attributeFact?.licenseStatus || <span className="text-muted-foreground">{t("detail.noSignedAttribute")}</span>} />
                <DefinitionRow label={t("detail.attributeSource")} value={attributeFact ? `${attributeFact.package.sourceSystem} · v${attributeFact.package.version}` : null} />
                <DefinitionRow label={t("detail.notes")} value={summary.notes} />
              </dl>
            </section>

            <div className="grid content-start gap-5">
              <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
                <h2 className="text-base font-semibold">{t("detail.location")}</h2>
                <dl className="mt-2">
                  <DefinitionRow label={t("detail.address")} value={summary.address} />
                  <DefinitionRow label={t("detail.region")} value={summary.region} />
                  <DefinitionRow label={t("detail.administrativeDistrict")} value={summary.administrativeDistrict} />
                  <DefinitionRow label={t("detail.locality")} value={summary.locality || summary.city} />
                  <DefinitionRow label={t("detail.cityDistrict")} value={summary.cityDistrict || summary.district} />
                  <DefinitionRow label={t("detail.territory")} value={summary.territoryCode} />
                  <DefinitionRow label={t("detail.polygon")} value={summary.polygon ? t("detail.polygonConfigured") : t("detail.polygonMissing")} />
                </dl>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
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
                  <DefinitionRow label={t("detail.geofenceRadius")} value={summary.geofenceRadius ? t("detail.meters", { count: summary.geofenceRadius }) : null} />
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
                  <a className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline" href={mapHref} target="_blank" rel="noreferrer">
                    {t("detail.verifyOnMap")}
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
                {canManage && hasCoordinates ? (
                  <div className="mt-4 grid gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
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
                    <Button type="button" disabled={actionLoading || !coordinateSource.trim()} onClick={() => void verifyCoordinates()}>
                      <ShieldCheck className="h-4 w-4" />
                      {t("detail.confirmCoordinates")}
                    </Button>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
          <section className="mt-5 rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{t("detail.commercialTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("detail.commercialDescription")}</p>
              </div>
              {commercial?.latestSource ? <StateBadge tone="positive">{t("detail.sourceRecorded")}</StateBadge> : <StateBadge tone="warning">{t("detail.noSource")}</StateBadge>}
            </div>
            <dl className="mt-3 grid gap-x-8 lg:grid-cols-2">
              <DefinitionRow label={t("detail.monthShipments", { period: commercial?.month ?? "—" })} value={commercial ? formatTotals(commercial.monthTotals) : null} />
              <DefinitionRow label={t("detail.yearShipments", { period: commercial?.year ?? "—" })} value={commercial ? formatTotals(commercial.yearTotals) : null} />
              <DefinitionRow label={t("detail.latestCommercialDocument")} value={commercial?.latestSource?.externalDocumentNo} />
              <DefinitionRow label={t("detail.sourceFreshness")} value={commercial?.latestSource ? dateTimeFormatter.format(new Date(commercial.latestSource.sourceImportJob?.appliedAt || commercial.latestSource.updatedAt)) : null} />
              <DefinitionRow label={t("detail.sourceFile")} value={commercial?.latestSource?.sourceImportJob?.originalFileName} />
              <DefinitionRow label={t("detail.sourceStatus")} value={commercial?.latestSource?.sourceImportJob?.status || commercial?.latestSource?.status} />
            </dl>
          </section>
        </TabsContent>

        <TabsContent value="contacts">
          <SectionFrame title={t("detail.contactsTitle")} description={t("detail.contactsDescription")}>
            <SectionState loading={sectionLoading === "contacts"} error={sectionError} retry={() => void loadDetailSection("contacts")} t={t}>
              {contacts?.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
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
                          {workplace.isPrimary ? <StateBadge tone="positive">{t("detail.primaryWorkplace")}</StateBadge> : null}
                          {workplace.endedOn ? <StateBadge>{t("detail.historicalWorkplace")}</StateBadge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[workplace.contact.specialtyName, workplace.jobTitle, workplace.department].filter(Boolean).join(" · ") || t("detail.contactRoleMissing")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("detail.contactCategory", { category: workplace.contact.category })}
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
        </TabsContent>

        <TabsContent value="visits">
          <SectionFrame title={t("detail.visitsTitle")} description={t("detail.visitsDescription")}>
            <SectionState loading={sectionLoading === "visits"} error={sectionError} retry={() => void loadDetailSection("visits")} t={t}>
              {visits?.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {visits.map((visit) => (
                    <article key={visit.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{visit.agent.name}</h3>
                          <StateBadge tone={visit.status === "CHECKED_OUT" ? "positive" : visit.status === "CANCELLED" ? "warning" : "neutral"}>
                            {t(`detail.visitStatuses.${visit.status}`)}
                          </StateBadge>
                          {visit.outcome ? <StateBadge>{t(`detail.visitOutcomes.${visit.outcome}`)}</StateBadge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{visit.resultNotes || t("detail.visitNotesMissing")}</p>
                      </div>
                      <div className="grid content-start gap-1 text-sm tabular-nums lg:text-right">
                        <span>{dateTimeFormatter.format(new Date(visit.checkInAt))}</span>
                        <span className="text-xs text-muted-foreground">
                          {visit.checkOutAt ? t("detail.completedAt", { date: dateTimeFormatter.format(new Date(visit.checkOutAt)) }) : t("detail.notCompleted")}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <EmptySection icon={CalendarDays} title={t("detail.noVisits")} description={t("detail.noVisitsDescription")} />}
            </SectionState>
          </SectionFrame>
        </TabsContent>

        <TabsContent value="staff">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
            <SectionFrame title={t("detail.assignmentHistory")} description={t("detail.assignmentHistoryDescription")}>
              <SectionState loading={sectionLoading === "staff"} error={sectionError} retry={() => void loadDetailSection("staff")} t={t}>
                {staff?.agentAssignments.length ? (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {staff.agentAssignments.map((assignment) => (
                      <article key={assignment.id} className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{assignment.agent.name}</h3>
                            <StateBadge>{t(`detail.assignmentRoles.${assignment.role}`)}</StateBadge>
                            {!assignment.effectiveTo ? <StateBadge tone="positive">{t("detail.currentAssignment")}</StateBadge> : null}
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
                  <DefinitionRow label={t("detail.managingManager")} value={staff?.managingManager?.name} />
                  <DefinitionRow label={t("detail.potentialRecords")} value={staff ? numberFormatter.format(staff.fieldPotentials.length) : null} />
                  <DefinitionRow label={t("detail.coverageAsOf")} value={staff?.fieldPotentials[0]?.periodStart ? dateFormatter.format(new Date(staff.fieldPotentials[0].periodStart)) : null} />
                </dl>
              </SectionState>
            </SectionFrame>
          </div>
        </TabsContent>

        <TabsContent value="departments">
          <SectionFrame title={t("detail.departmentsTitle")} description={t("detail.departmentsDescription")}>
            <SectionState loading={sectionLoading === "departments"} error={sectionError} retry={() => void loadDetailSection("departments", true)} t={t}>
              <div className="grid gap-5">
                {canManage ? (
                  <form onSubmit={createDepartment} className="grid gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700 md:grid-cols-2 xl:grid-cols-5">
                    <input required value={departmentDraft.name} onChange={(event) => setDepartmentDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t("detail.departmentName")} maxLength={200} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <input value={departmentDraft.code} onChange={(event) => setDepartmentDraft((current) => ({ ...current, code: event.target.value }))} placeholder={t("detail.departmentCode")} maxLength={128} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <input required value={departmentDraft.sourceSystem} onChange={(event) => setDepartmentDraft((current) => ({ ...current, sourceSystem: event.target.value }))} placeholder={t("detail.sourceSystem")} maxLength={200} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <input value={departmentDraft.sourceReference} onChange={(event) => setDepartmentDraft((current) => ({ ...current, sourceReference: event.target.value }))} placeholder={t("detail.sourceReference")} maxLength={500} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <Button type="submit" disabled={actionLoading || !departmentDraft.name.trim() || !departmentDraft.sourceSystem.trim()}><Plus className="h-4 w-4" />{t("detail.addDepartment")}</Button>
                  </form>
                ) : null}
                {departments?.length ? (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {departments.map((department) => (
                      <article key={department.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="grid gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{department.name}</h3>
                            {department.code ? <StateBadge>{department.code}</StateBadge> : null}
                            {department.kind ? <StateBadge>{department.kind}</StateBadge> : null}
                          </div>
                          <p className="text-sm text-muted-foreground">{[department.address, department.contactPerson, department.phone].filter(Boolean).join(" · ") || t("detail.departmentDetailsMissing")}</p>
                          <p className="text-xs text-muted-foreground">{t("detail.sourceLine", { source: department.sourceSystem, date: dateFormatter.format(new Date(department.sourceObservedAt)) })}</p>
                        </div>
                        {canManage ? <Button type="button" size="icon" variant="ghost" disabled={actionLoading} aria-label={t("detail.archiveDepartment")} onClick={() => void archiveDepartment(department.id)}><Trash2 className="h-4 w-4" /></Button> : null}
                      </article>
                    ))}
                  </div>
                ) : <EmptySection icon={FolderOpen} title={t("detail.noDepartments")} description={t("detail.noDepartmentsDescription")} />}
              </div>
            </SectionState>
          </SectionFrame>
        </TabsContent>

        <TabsContent value="promotions">
          <SectionFrame title={t("detail.promotionsTitle")} description={t("detail.promotionsDescription")}>
            <SectionState loading={sectionLoading === "promotions"} error={sectionError} retry={() => void loadDetailSection("promotions", true)} t={t}>
              {promotions?.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {promotions.map((target) => {
                    const execution = target.executions[0]
                    return (
                      <article key={target.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.65fr)]">
                        <div className="grid gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{localizedPromotionName(target.promotionVersion)}</h3>
                            <StateBadge>{target.promotionVersion.promotion.code}</StateBadge>
                            <StateBadge tone={target.status === "COMPLETED" ? "positive" : "neutral"}>{target.status}</StateBadge>
                          </div>
                          <p className="text-sm text-muted-foreground">{t("detail.promotionPlan", { quantity: numberFormatter.format(Number(target.planQuantity)), unit: target.unit, agent: target.assignedAgent.name })}</p>
                          <p className="text-xs text-muted-foreground">{t("detail.sourceLine", { source: target.sourceSystem, date: dateFormatter.format(new Date(target.sourceObservedAt)) })}</p>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <div><dt className="text-xs text-muted-foreground">{t("detail.fact")}</dt><dd className="font-semibold">{execution ? numberFormatter.format(Number(execution.actualQuantity)) : "—"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">{t("detail.points")}</dt><dd className="font-semibold">{execution?.factPointsPreview === null || execution?.factPointsPreview === undefined ? "—" : numberFormatter.format(Number(execution.factPointsPreview))}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">L1</dt><dd>{execution?.l1State || "—"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">L2</dt><dd>{execution?.l2State || "—"}</dd></div>
                        </dl>
                      </article>
                    )
                  })}
                </div>
              ) : <EmptySection icon={Megaphone} title={t("detail.noPromotions")} description={t("detail.noPromotionsDescription")} />}
            </SectionState>
          </SectionFrame>
        </TabsContent>

        <TabsContent value="files">
          <SectionFrame title={t("detail.filesTitle")} description={t("detail.filesDescription")}>
            <SectionState loading={sectionLoading === "files"} error={sectionError} retry={() => void loadDetailSection("files", true)} t={t}>
              <div className="grid gap-5">
                {canManage ? (
                  <form onSubmit={uploadDocument} className="grid gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700 md:grid-cols-2 xl:grid-cols-4">
                    <input required name="organizationDocument" type="file" className="min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    <input required value={documentSource} onChange={(event) => setDocumentSource(event.target.value)} placeholder={t("detail.sourceSystem")} maxLength={200} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <input value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} placeholder={t("detail.sourceReference")} maxLength={500} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" />
                    <Button type="submit" disabled={actionLoading || !documentSource.trim()}><Upload className="h-4 w-4" />{t("detail.uploadFile")}</Button>
                  </form>
                ) : null}
                {documents?.length ? (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {documents.map((document) => (
                      <article key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{document.title || document.fileName}</h3>
                          <p className="text-sm text-muted-foreground">{document.fileName} · {t("detail.fileSize", { size: numberFormatter.format(document.sizeBytes / 1024) })}</p>
                          <p className="text-xs text-muted-foreground">{t("detail.sourceLine", { source: document.sourceSystem || t("detail.unknownSource"), date: dateFormatter.format(new Date(document.sourceObservedAt || document.createdAt)) })}</p>
                        </div>
                        <Button asChild variant="outline"><a href={`/api/v1/mtm/organizations/${organizationId}/documents/${document.id}/download`}><Download className="h-4 w-4" />{t("detail.download")}</a></Button>
                      </article>
                    ))}
                  </div>
                ) : <EmptySection icon={FileText} title={t("detail.noFiles")} description={t("detail.noFilesDescription")} />}
              </div>
            </SectionState>
          </SectionFrame>
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
    <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
      <div className="mb-5 grid gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
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
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted">
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
