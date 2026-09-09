"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarPlus,
  CircleAlert,
  ClipboardList,
  Clock3,
  Copy,
  History,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MtmContactEditDialog } from "@/components/mtm/contact-edit-dialog"
import {
  MtmContactDuplicateDecisionDialog,
  MtmContactDuplicateReportDialog,
  type DuplicateChangeRequest,
} from "@/components/mtm/contact-duplicate-dialog"
import {
  MtmContactWorkplaceDialog,
  MtmContactWorkplaceEndDialog,
} from "@/components/mtm/contact-workplace-dialog"
import {
  MtmContactScoringPanel,
  type MtmBrandPotential,
  type MtmScoringAssessment,
} from "@/components/mtm/contact-scoring-panel"
import type {
  MtmEligiblePotentialVisit,
  MtmPotentialAgentOption,
} from "@/components/mtm/contact-scoring-entry-dialogs"
import { cn } from "@/lib/utils"
import type { MtmContactRequiredField } from "@/lib/mtm/contact-required-fields"
import {
  MtmContactDictionaryAssignmentPanel,
  type GovernedContactDictionary,
  type GovernedContactDictionaryAssignment,
} from "@/components/mtm/contact-dictionary-assignment-panel"
import { createDateFormatter, type DateFormatter } from "@/lib/format-date"

type Agent = {
  id: string
  name: string
  role: string
  status: string
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
  updatedAt: string
  customer: {
    id: string
    code: string | null
    name: string
    objectType: string
    category: string
    address: string | null
    city: string | null
    district: string | null
    phone: string | null
  }
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

type ChangeRequest = DuplicateChangeRequest & {
  id: string
  kind: string
  status: string
  reason: string
  submittedAt: string
  reviewedAt: string | null
  decisionComment: string | null
  requestedByAgent: {
    id: string
    name: string
  }
}

type Contact = {
  id: string
  externalCode: string | null
  firstName: string
  lastName: string
  middleName: string | null
  displayName: string
  type: string
  specialtyCode: string | null
  specialtyName: string | null
  qualificationCategory: string | null
  profile: string | null
  category: string
  status: string
  birthDate: string | null
  gender: string | null
  email: string | null
  phone: string | null
  messengerPhone: string | null
  workPhone: string | null
  homePhone: string | null
  mobilePhone: string | null
  viberPhone: string | null
  whatsappPhone: string | null
  telegramPhone: string | null
  postalCode: string | null
  addressRegion: string | null
  addressLocality: string | null
  addressDistrict: string | null
  addressStreet: string | null
  productCategory: string | null
  verificationStatus: string
  consentStatus: string
  contactPreference: string | null
  source: string
  notes: string | null
  createdAt: string
  updatedAt: string
  duplicateOfContact: {
    id: string
    displayName: string
    status: string
  } | null
  workplaces: Workplace[]
  agentAssignments: Assignment[]
  fieldPotentials: MtmBrandPotential[]
  doctorAssessments: MtmScoringAssessment[]
  changeRequests: ChangeRequest[]
  dictionaryAssignments: GovernedContactDictionaryAssignment[]
}

type AuditEvent = {
  id: string
  action: string
  entity: string
  metadataKind: string | null
  createdAt: string
  agent: {
    id: string
    name: string
  } | null
}

type ApiPayload = {
  success: boolean
  error?: string
  data: {
    contact: Contact
    history: AuditEvent[]
    activeAssignments: Assignment[]
    eligibleBrandPotentialVisits: MtmEligiblePotentialVisit[]
    brandPotentialAgents: MtmPotentialAgentOption[]
    availableContactDictionaries: GovernedContactDictionary[]
    dictionaryAssignmentStateHash: string
    contactPolicy: {
      requiredFields: MtmContactRequiredField[]
    }
    asOf: string
    timezone: string
    capabilities: {
      actorAgentId: string | null
      actorRole: string
      canManage: boolean
      canRequestChanges: boolean
      canRecordBrandPotential: boolean
      canReviewBrandPotential: boolean
      brandPotentialPerAgent: boolean
    }
  }
}

type DetailTab = "profile" | "workplaces" | "communication" | "categories" | "history"

function safeReturnHref(value: string | null): string {
  if (!value) return "/mtm/customers"
  if (value === "/mtm" || value.startsWith("/mtm?")) return value
  if (value === "/mtm/contacts" || value.startsWith("/mtm/contacts?")) return value
  if (value === "/mtm/customers" || value.startsWith("/mtm/customers?")) return value
  if (/^\/mtm\/customers\/[^/?]+(?:\?.*)?$/.test(value)) return value
  return "/mtm/customers"
}

function phoneHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`
}

function whatsappHref(value: string): string {
  return `https://wa.me/${value.replace(/\D/g, "")}`
}

function DefinitionRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-zinc-200 py-3 last:border-0 dark:border-zinc-700 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value || "—"}</dd>
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

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function MtmContactDetail({ contactId }: { contactId: string }) {
  const t = useTranslations("mtmContactDetail")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [payload, setPayload] = useState<ApiPayload["data"] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState<DetailTab>("profile")
  const [editOpen, setEditOpen] = useState(false)
  const [workplaceOpen, setWorkplaceOpen] = useState(false)
  const [workplaceEndOpen, setWorkplaceEndOpen] = useState(false)
  const [duplicateReportOpen, setDuplicateReportOpen] = useState(false)
  const [duplicateDecisionOpen, setDuplicateDecisionOpen] = useState(false)
  const [selectedDuplicateRequest, setSelectedDuplicateRequest] = useState<ChangeRequest | null>(null)
  const [selectedWorkplace, setSelectedWorkplace] = useState<Workplace | null>(null)

  const requestHeaders = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": String(orgId) } : {},
    [orgId],
  )
  const returnHref = safeReturnHref(searchParams.get("returnTo"))
  const dateFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium" }),
    [locale],
  )
  const dateTimeFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  )

  const loadContact = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts/${contactId}`, {
        headers: requestHeaders,
      })
      const result = await response.json() as ApiPayload
      if (!response.ok || !result.success) throw new Error(result.error || t("loadError"))
      setPayload(result.data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [contactId, requestHeaders, t])

  useEffect(() => {
    void loadContact()
  }, [loadContact])

  if (loading) {
    return (
      <div className="space-y-4" aria-label={t("loading")}>
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (error || !payload) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="grid max-w-md gap-4 text-center">
          <CircleAlert className="mx-auto h-10 w-10 text-destructive" />
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold">{t("loadFailed")}</h1>
            <p className="text-sm text-muted-foreground">{error || t("notFound")}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button asChild variant="outline"><Link href={returnHref}>{t("back")}</Link></Button>
            <Button onClick={() => void loadContact()}><RefreshCw className="h-4 w-4" />{t("retry")}</Button>
          </div>
        </div>
      </div>
    )
  }

  const { contact, activeAssignments, capabilities, history } = payload
  const currentWorkplaces = contact.workplaces.filter((workplace) => !workplace.endedOn)
  const historicalWorkplaces = contact.workplaces.filter((workplace) => Boolean(workplace.endedOn))
  const primaryWorkplace = currentWorkplaces.find((workplace) => workplace.isPrimary) ?? currentWorkplaces[0] ?? null
  const preferredPhone = contact.mobilePhone || contact.phone || contact.workPhone || primaryWorkplace?.phone || null
  const preferredMessenger = contact.whatsappPhone || contact.messengerPhone || contact.mobilePhone || null
  const address = [
    contact.postalCode,
    contact.addressRegion,
    contact.addressLocality,
    contact.addressDistrict,
    contact.addressStreet,
  ].filter(Boolean).join(", ")
  const organizationReturn = primaryWorkplace
    ? `/mtm/customers/${primaryWorkplace.customer.id}?returnTo=${encodeURIComponent("/mtm/customers")}`
    : "/mtm/customers"
  const statusTone = contact.status === "ACTIVE" ? "positive" : contact.status === "PROSPECT" ? "warning" : "neutral"
  const verificationTone = contact.verificationStatus === "VERIFIED" ? "positive" : "warning"
  const activeDuplicateRequest = contact.changeRequests.find((request) => (
    request.kind === "DUPLICATE_REPORT" && ["SUBMITTED", "IN_REVIEW"].includes(request.status)
  ))
  const governedProductCategory = contact.dictionaryAssignments
    .filter((assignment) => assignment.effectiveTo === null && assignment.kind === "PRODUCT_CATEGORY" && assignment.valid && assignment.entry)
    .map((assignment) => locale.startsWith("az")
      ? assignment.entry!.labels.az
      : locale.startsWith("ru")
        ? assignment.entry!.labels.ru
        : assignment.entry!.labels.en)
    .join(", ") || null

  return (
    <div data-testid="mtm-contact-detail" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-11 md:min-h-9">
          <Link href={returnHref}>
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("updatedAt", { date: dateTimeFormatter.format(new Date(contact.updatedAt)) })}
        </span>
      </div>

      <header className="overflow-hidden rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-7">
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge tone={statusTone}>{t(`statuses.${contact.status}`)}</StateBadge>
              <StateBadge>{t(`types.${contact.type}`)}</StateBadge>
              <StateBadge>{t("category", { value: contact.category })}</StateBadge>
              <StateBadge tone={verificationTone}>{t(`verificationStatuses.${contact.verificationStatus}`)}</StateBadge>
            </div>
            <div className="grid gap-2">
              <h1 className="max-w-4xl text-2xl font-semibold tracking-tight md:text-3xl">{contact.displayName}</h1>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Stethoscope className="mt-0.5 h-4 w-4 flex-none" />
                <span>{[contact.specialtyName, contact.qualificationCategory, contact.profile].filter(Boolean).join(" · ") || t("professionalMissing")}</span>
              </p>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <BriefcaseBusiness className="mt-0.5 h-4 w-4 flex-none" />
                <span>{primaryWorkplace
                  ? [primaryWorkplace.customer.name, primaryWorkplace.jobTitle, primaryWorkplace.room ? t("room", { value: primaryWorkplace.room }) : null].filter(Boolean).join(" · ")
                  : t("workplaceMissing")}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-sm lg:justify-end">
            {capabilities.canManage || capabilities.canRequestChanges ? (
              <Button type="button" variant="outline" className="col-span-2 min-h-11" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                {capabilities.canManage ? t("editContact") : t("suggestChange")}
              </Button>
            ) : null}
            {preferredPhone ? (
              <Button asChild variant="outline" className="min-h-11">
                <a href={phoneHref(preferredPhone)}><Phone className="h-4 w-4" />{t("call")}</a>
              </Button>
            ) : null}
            {contact.email ? (
              <Button asChild variant="outline" className="min-h-11">
                <a href={`mailto:${contact.email}`}><Mail className="h-4 w-4" />{t("emailAction")}</a>
              </Button>
            ) : null}
            {preferredMessenger ? (
              <Button asChild variant="outline" className="min-h-11">
                <a href={whatsappHref(preferredMessenger)} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />{t("message")}
                </a>
              </Button>
            ) : null}
            {primaryWorkplace ? (
              <Button asChild className="min-h-11">
                <Link href={`/mtm/routes?customerId=${encodeURIComponent(primaryWorkplace.customer.id)}&contactId=${encodeURIComponent(contact.id)}`}>
                  <CalendarPlus className="h-4 w-4" />{t("planVisit")}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="col-span-2 min-h-11">
              <Link href={`/mtm/tasks?contactId=${encodeURIComponent(contact.id)}`}>
                <ClipboardList className="h-4 w-4" />{t("openTasks")}
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid divide-y border-t border-zinc-200 bg-muted/25 dark:border-zinc-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {[
            [t("workplaces"), contact.workplaces.length],
            [t("activeOwners"), activeAssignments.length],
            [t("assessments"), contact.doctorAssessments.length],
            [t("potentialRecords"), contact.fieldPotentials.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="grid gap-1 px-5 py-3">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className="text-sm font-semibold tabular-nums">{numberFormatter.format(Number(value))}</span>
            </div>
          ))}
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start p-1">
            {([
              ["profile", UserRound],
              ["workplaces", BriefcaseBusiness],
              ["communication", Phone],
              ["categories", ShieldCheck],
              ["history", History],
            ] as const).map(([tab, Icon]) => (
              <TabsTrigger key={tab} value={tab} data-testid={`mtm-contact-tab-${tab}`} className="min-h-10 gap-2 px-3">
                <Icon className="h-4 w-4" />
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="profile">
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard title={t("identityTitle")} description={t("identityDescription")}>
              <dl>
                <DefinitionRow label={t("externalCode")} value={contact.externalCode} />
                <DefinitionRow label={t("lastName")} value={contact.lastName} />
                <DefinitionRow label={t("firstName")} value={contact.firstName} />
                <DefinitionRow label={t("middleName")} value={contact.middleName} />
                <DefinitionRow label={t("birthDate")} value={contact.birthDate ? dateFormatter.format(new Date(contact.birthDate)) : null} />
                <DefinitionRow label={t("gender")} value={contact.gender} />
                <DefinitionRow label={t("notes")} value={contact.notes} />
              </dl>
            </SectionCard>

            <SectionCard title={t("professionalTitle")} description={t("professionalDescription")}>
              <dl>
                <DefinitionRow label={t("contactType")} value={t(`types.${contact.type}`)} />
                <DefinitionRow label={t("specialty")} value={contact.specialtyName} />
                <DefinitionRow label={t("specialtyCode")} value={contact.specialtyCode} />
                <DefinitionRow label={t("qualification")} value={contact.qualificationCategory} />
                <DefinitionRow label={t("profile")} value={contact.profile} />
                <DefinitionRow label={t("masterCategory")} value={contact.category} />
                <DefinitionRow label={t("source")} value={contact.source} />
              </dl>
            </SectionCard>

            <SectionCard title={t("ownershipTitle")} description={t("ownershipDescription")}>
              {contact.agentAssignments.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {contact.agentAssignments.map((assignment) => (
                    <article key={assignment.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{assignment.agent.name}</span>
                          <StateBadge>{t(`assignmentRoles.${assignment.role}`)}</StateBadge>
                          {!assignment.effectiveTo ? <StateBadge tone="positive">{t("current")}</StateBadge> : null}
                        </div>
                        <span className="text-xs text-muted-foreground">{assignment.reason || t("reasonMissing")}</span>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {dateFormatter.format(new Date(assignment.effectiveFrom))} — {assignment.effectiveTo ? dateFormatter.format(new Date(assignment.effectiveTo)) : t("present")}
                      </span>
                    </article>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">{t("ownershipEmpty")}</p>}
            </SectionCard>

            <SectionCard
              title={t("governanceTitle")}
              description={t("governanceDescription")}
              action={capabilities.canRequestChanges && !["DUPLICATE", "MERGED"].includes(contact.status) ? (
                activeDuplicateRequest ? (
                  <StateBadge tone="warning">{t("duplicateReportPending")}</StateBadge>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={() => setDuplicateReportOpen(true)}>
                    <Copy className="h-4 w-4" />
                    {t("reportDuplicate")}
                  </Button>
                )
              ) : null}
            >
              <dl>
                <DefinitionRow label={t("verification")} value={<StateBadge tone={verificationTone}>{t(`verificationStatuses.${contact.verificationStatus}`)}</StateBadge>} />
                <DefinitionRow label={t("consent")} value={t(`consentStatuses.${contact.consentStatus}`)} />
                <DefinitionRow label={t("preferredChannel")} value={contact.contactPreference ? t(`preferences.${contact.contactPreference}`) : null} />
                <DefinitionRow label={t("changeMode")} value={capabilities.canManage ? t("managerChangeMode") : capabilities.canRequestChanges ? t("requestChangeMode") : t("readOnlyMode")} />
                <DefinitionRow label={t("duplicate")} value={contact.duplicateOfContact
                  ? <Link className="font-medium text-primary hover:underline" href={`/mtm/contacts/${contact.duplicateOfContact.id}`}>{contact.duplicateOfContact.displayName}</Link>
                  : t("duplicateNotLinked")} />
              </dl>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="workplaces">
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard
              title={t("currentWorkplacesTitle")}
              description={t("currentWorkplacesDescription")}
              action={capabilities.canManage || capabilities.canRequestChanges ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 md:min-h-9"
                  onClick={() => {
                    setSelectedWorkplace(null)
                    setWorkplaceOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" />
                  {capabilities.canManage ? t("addWorkplace") : t("suggestWorkplace")}
                </Button>
              ) : null}
            >
              {currentWorkplaces.length ? (
                <WorkplaceList
                  workplaces={currentWorkplaces}
                  returnHref={returnHref}
                  dateFormatter={dateFormatter}
                  t={t}
                  canChange={capabilities.canManage || capabilities.canRequestChanges}
                  onEdit={(workplace) => {
                    setSelectedWorkplace(workplace)
                    setWorkplaceOpen(true)
                  }}
                  onEnd={(workplace) => {
                    setSelectedWorkplace(workplace)
                    setWorkplaceEndOpen(true)
                  }}
                />
              ) : <p className="text-sm text-muted-foreground">{t("currentWorkplacesEmpty")}</p>}
            </SectionCard>
            <SectionCard title={t("workplaceHistoryTitle")} description={t("workplaceHistoryDescription")}>
              {historicalWorkplaces.length ? (
                <WorkplaceList workplaces={historicalWorkplaces} returnHref={returnHref} dateFormatter={dateFormatter} t={t} />
              ) : <p className="text-sm text-muted-foreground">{t("workplaceHistoryEmpty")}</p>}
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="communication">
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard title={t("channelsTitle")} description={t("channelsDescription")}>
              <dl>
                <DefinitionRow label={t("email")} value={contact.email ? <a className="text-primary hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a> : null} />
                <DefinitionRow label={t("phone")} value={contact.phone ? <a className="text-primary hover:underline" href={phoneHref(contact.phone)}>{contact.phone}</a> : null} />
                <DefinitionRow label={t("mobilePhone")} value={contact.mobilePhone ? <a className="text-primary hover:underline" href={phoneHref(contact.mobilePhone)}>{contact.mobilePhone}</a> : null} />
                <DefinitionRow label={t("workPhone")} value={contact.workPhone ? <a className="text-primary hover:underline" href={phoneHref(contact.workPhone)}>{contact.workPhone}</a> : null} />
                <DefinitionRow label={t("homePhone")} value={contact.homePhone ? <a className="text-primary hover:underline" href={phoneHref(contact.homePhone)}>{contact.homePhone}</a> : null} />
                <DefinitionRow label={t("messengerPhone")} value={contact.messengerPhone} />
                <DefinitionRow label="Viber" value={contact.viberPhone} />
                <DefinitionRow label="WhatsApp" value={contact.whatsappPhone ? <a className="text-primary hover:underline" href={whatsappHref(contact.whatsappPhone)} target="_blank" rel="noreferrer">{contact.whatsappPhone}</a> : null} />
                <DefinitionRow label="Telegram" value={contact.telegramPhone} />
              </dl>
            </SectionCard>
            <SectionCard title={t("homeAddressTitle")} description={t("homeAddressDescription")}>
              <div className="mb-3 flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                <span>{address || t("addressMissing")}</span>
              </div>
              <dl>
                <DefinitionRow label={t("postalCode")} value={contact.postalCode} />
                <DefinitionRow label={t("region")} value={contact.addressRegion} />
                <DefinitionRow label={t("locality")} value={contact.addressLocality} />
                <DefinitionRow label={t("district")} value={contact.addressDistrict} />
                <DefinitionRow label={t("street")} value={contact.addressStreet} />
              </dl>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="categories" data-testid="mtm-contact-scoring-state">
          <div className="grid gap-5">
            <MtmContactDictionaryAssignmentPanel
              contactId={contact.id}
              contactUpdatedAt={contact.updatedAt}
              stateHash={payload.dictionaryAssignmentStateHash}
              dictionaries={payload.availableContactDictionaries}
              assignments={contact.dictionaryAssignments}
              changeRequests={contact.changeRequests}
              canManage={capabilities.canManage}
              canRequestChanges={capabilities.canRequestChanges}
              orgId={orgId ? String(orgId) : undefined}
              onChanged={loadContact}
            />
            <MtmContactScoringPanel
              contactId={contact.id}
              contactType={contact.type}
              productCategory={governedProductCategory}
              qualificationCategory={contact.qualificationCategory}
              assessments={contact.doctorAssessments}
              potentials={contact.fieldPotentials}
              eligiblePotentialVisits={payload.eligibleBrandPotentialVisits}
              potentialAgents={payload.brandPotentialAgents}
              asOf={payload.asOf}
              actorAgentId={capabilities.actorAgentId}
              canAssess={capabilities.canManage}
              canRecordPotential={capabilities.canRecordBrandPotential}
              canReviewAssessment={capabilities.canManage}
              canReviewPotential={capabilities.canReviewBrandPotential}
              perAgentDimension={capabilities.brandPotentialPerAgent}
              orgId={orgId ? String(orgId) : undefined}
              onChanged={loadContact}
            />
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
            <SectionCard title={t("auditTitle")} description={t("auditDescription")}>
              {history.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {history.map((event) => (
                    <article key={event.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="grid gap-1">
                        <span className="font-medium">{event.action}</span>
                        <span className="text-xs text-muted-foreground">{event.agent?.name || t("systemActor")} · {event.metadataKind || event.entity}</span>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">{dateTimeFormatter.format(new Date(event.createdAt))}</span>
                    </article>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">{t("auditEmpty")}</p>}
            </SectionCard>
            <SectionCard title={t("requestsTitle")} description={t("requestsDescription")}>
              {contact.changeRequests.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {contact.changeRequests.map((request) => (
                    <article key={request.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t(`requestKinds.${request.kind}`)}</span>
                        <StateBadge tone={request.status === "APPROVED" ? "positive" : request.status === "REJECTED" ? "warning" : "neutral"}>
                          {t(`requestStatuses.${request.status}`)}
                        </StateBadge>
                      </div>
                      <p className="text-sm text-muted-foreground">{request.reason}</p>
                      {request.kind === "DUPLICATE_REPORT" ? (
                        request.duplicateTarget ? (
                          <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline" href={`/mtm/contacts/${request.duplicateTarget.id}`}>
                            {t("duplicateCanonicalTarget", { name: request.duplicateTarget.displayName })}
                          </Link>
                        ) : (
                          <p className="text-xs text-destructive">{t("duplicateTargetUnavailable")}</p>
                        )
                      ) : null}
                      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                        <span>{request.requestedByAgent.name}</span>
                        <span>{dateTimeFormatter.format(new Date(request.submittedAt))}</span>
                      </div>
                      {capabilities.canManage
                        && request.kind === "DUPLICATE_REPORT"
                        && ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(request.status)
                        ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 justify-self-start"
                              onClick={() => {
                                setSelectedDuplicateRequest(request)
                                setDuplicateDecisionOpen(true)
                              }}
                            >
                              {t("reviewDuplicateReport")}
                            </Button>
                          )
                        : null}
                    </article>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">{t("requestsEmpty")}</p>}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      {(capabilities.canManage || capabilities.canRequestChanges) ? (
        <>
          <MtmContactEditDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            contact={contact}
            canManage={capabilities.canManage}
            canRequestChanges={capabilities.canRequestChanges}
            requiredFields={payload.contactPolicy.requiredFields}
            orgId={orgId ? String(orgId) : undefined}
            onSaved={loadContact}
          />
          <MtmContactWorkplaceDialog
            open={workplaceOpen}
            onOpenChange={setWorkplaceOpen}
            contactId={contact.id}
            contactUpdatedAt={contact.updatedAt}
            workplace={selectedWorkplace}
            canManage={capabilities.canManage}
            canRequestChanges={capabilities.canRequestChanges}
            orgId={orgId ? String(orgId) : undefined}
            onSaved={loadContact}
          />
          <MtmContactWorkplaceEndDialog
            open={workplaceEndOpen}
            onOpenChange={setWorkplaceEndOpen}
            contactId={contact.id}
            contactUpdatedAt={contact.updatedAt}
            workplace={selectedWorkplace}
            endedOn={payload.asOf.slice(0, 10)}
            canManage={capabilities.canManage}
            canRequestChanges={capabilities.canRequestChanges}
            orgId={orgId ? String(orgId) : undefined}
            onSaved={loadContact}
          />
          {capabilities.canRequestChanges ? (
            <MtmContactDuplicateReportDialog
              open={duplicateReportOpen}
              onOpenChange={setDuplicateReportOpen}
              contactId={contact.id}
              contactUpdatedAt={contact.updatedAt}
              orgId={orgId ? String(orgId) : undefined}
              onSubmitted={loadContact}
            />
          ) : null}
          {capabilities.canManage ? (
            <MtmContactDuplicateDecisionDialog
              open={duplicateDecisionOpen}
              onOpenChange={(next) => {
                setDuplicateDecisionOpen(next)
                if (!next) setSelectedDuplicateRequest(null)
              }}
              request={selectedDuplicateRequest}
              orgId={orgId ? String(orgId) : undefined}
              onDecided={loadContact}
            />
          ) : null}
        </>
      ) : null}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-zinc-200 bg-background/95 p-3 shadow-lg backdrop-blur md:hidden dark:border-zinc-700">
        <div className={cn("grid gap-2", capabilities.canManage || capabilities.canRequestChanges ? "grid-cols-4" : "grid-cols-3")}>
          {capabilities.canManage || capabilities.canRequestChanges ? (
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              <span className="sr-only">{capabilities.canManage ? t("editContact") : t("suggestChange")}</span>
            </Button>
          ) : null}
          {preferredPhone ? <Button asChild variant="outline"><a href={phoneHref(preferredPhone)}><Phone className="h-4 w-4" /><span className="sr-only">{t("call")}</span></a></Button> : <Button disabled variant="outline"><Phone className="h-4 w-4" /></Button>}
          {preferredMessenger ? <Button asChild variant="outline"><a href={whatsappHref(preferredMessenger)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /><span className="sr-only">{t("message")}</span></a></Button> : <Button disabled variant="outline"><MessageCircle className="h-4 w-4" /></Button>}
          <Button asChild><Link href={organizationReturn}><BriefcaseBusiness className="h-4 w-4" /><span className="sr-only">{t("openWorkplace")}</span></Link></Button>
        </div>
      </div>
    </div>
  )
}

function WorkplaceList({
  workplaces,
  returnHref,
  dateFormatter,
  t,
  canChange = false,
  onEdit,
  onEnd,
}: {
  workplaces: Workplace[]
  returnHref: string
  dateFormatter: DateFormatter
  t: ReturnType<typeof useTranslations>
  canChange?: boolean
  onEdit?: (workplace: Workplace) => void
  onEnd?: (workplace: Workplace) => void
}) {
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
      {workplaces.map((workplace) => (
        <article key={workplace.id} className="grid gap-3 py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="font-semibold text-primary underline-offset-4 hover:underline"
              href={`/mtm/customers/${workplace.customer.id}?returnTo=${encodeURIComponent(returnHref)}`}
            >
              {workplace.customer.name}
            </Link>
            {workplace.isPrimary ? <StateBadge tone="positive">{t("primaryWorkplace")}</StateBadge> : null}
            {workplace.endedOn ? <StateBadge>{t("historicalWorkplace")}</StateBadge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {[workplace.jobTitle, workplace.department, workplace.room ? t("room", { value: workplace.room }) : null].filter(Boolean).join(" · ") || t("workplaceRoleMissing")}
          </p>
          <p className="text-sm">{workplace.customer.address || [workplace.customer.city, workplace.customer.district].filter(Boolean).join(", ") || t("workplaceAddressMissing")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><Clock3 className="mr-1 inline h-3.5 w-3.5" />{workplace.startedOn ? dateFormatter.format(new Date(workplace.startedOn)) : t("dateMissing")} — {workplace.endedOn ? dateFormatter.format(new Date(workplace.endedOn)) : t("present")}</span>
            <span>{t("workplaceSource", { value: workplace.source })}</span>
          </div>
          {canChange && !workplace.endedOn ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={() => onEdit?.(workplace)}>
                <Pencil className="h-4 w-4" />
                {t("editWorkplace")}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground md:min-h-9" onClick={() => onEnd?.(workplace)}>
                <Clock3 className="h-4 w-4" />
                {t("endWorkplace")}
              </Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
