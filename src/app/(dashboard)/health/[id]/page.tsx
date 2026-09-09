"use client"

import { useEffect, useState, use } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  HeartPulse, ChevronLeft, Loader2,
  User, Phone, Mail, Calendar, Hash, ClipboardPlus,
  FileCheck, FileText, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface Patient {
  id: string
  mrn: string
  fullName: string
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  status: string
  primaryProviderId: string | null
  registeredAt: string | null
  createdAt: string
}

interface Encounter {
  id: string
  encounterType: string
  status: string
  scheduledAt: string | null
  checkedInAt: string | null
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdAt: string
}

interface CarePlan {
  id: string
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  goals: unknown[]
  createdAt: string
}

interface MedicalRecord {
  id: string
  recordType: string
  recordDate: string | null
  summary: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  deceased: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const ENCOUNTER_STATUS_COLORS: Record<string, string> = {
  scheduled:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  checked_in:  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  no_show:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const CARE_PLAN_STATUS_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

type Tab = "overview" | "encounters" | "care-plans" | "medical-records"

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("health")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [patient, setPatient] = useState<Patient | null>(null)
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [carePlans, setCarePlans] = useState<CarePlan[]>([])
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tabError, setTabError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  // Load patient
  useEffect(() => {
    if (!orgId || !id) return
    setLoading(true)
    fetch(`/api/v1/health-patients/${id}`, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (json.patient) setPatient(json.patient)
        else setError(t("loadPatientError"))
      })
      .catch(() => setError(t("loadPatientError")))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])

  // Load tab data on demand
  useEffect(() => {
    if (!orgId || !id || activeTab === "overview") return
    setTabLoading(true)
    setTabError(null)

    const loadTab = async () => {
      try {
        if (activeTab === "encounters") {
          const res = await fetch(`/api/v1/health-encounters?patientId=${id}&limit=50`, { headers })
          if (!res.ok) throw new Error(String(res.status))
          const json = await res.json()
          if (json.encounters) setEncounters(json.encounters)
          else setTabError(t("loadTabError"))
        } else if (activeTab === "care-plans") {
          const res = await fetch(`/api/v1/health-care-plans?patientId=${id}&limit=50`, { headers })
          if (!res.ok) throw new Error(String(res.status))
          const json = await res.json()
          if (json.plans) setCarePlans(json.plans)
          else setTabError(t("loadTabError"))
        } else if (activeTab === "medical-records") {
          const res = await fetch(`/api/v1/health-medical-records?patientId=${id}&limit=50`, { headers })
          if (!res.ok) throw new Error(String(res.status))
          const json = await res.json()
          if (json.records) setMedicalRecords(json.records)
          else setTabError(t("loadTabError"))
        }
      } catch {
        setTabError(t("loadTabError"))
      } finally {
        setTabLoading(false)
      }
    }
    loadTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, orgId])

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString() : "—"
  const fmtDt = (d: string | null) => d ? new Date(d).toLocaleString() : "—"

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !patient) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 mb-4">
          <ChevronLeft className="h-4 w-4" />
          {t("backToPatients")}
        </Button>
        <p className="text-red-500">{error || t("loadPatientError")}</p>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview",        label: t("tabOverview"),       icon: Activity },
    { key: "encounters",      label: t("tabEncounters"),      icon: ClipboardPlus },
    { key: "care-plans",      label: t("tabCarePlans"),       icon: FileCheck },
    { key: "medical-records", label: t("tabMedicalRecords"),  icon: FileText },
  ]

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => router.push("/health")} className="gap-2 -ml-2">
          <ChevronLeft className="h-4 w-4" />
          {t("backToPatients")}
        </Button>

        {/* Patient Header Card */}
        <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-rose-500/10 rounded-full">
              <HeartPulse className="h-7 w-7 text-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{patient.fullName}</span> <HelpButton slug="health-patient-detail" variant="label" className="shrink-0" /></h1>
                <Badge className={cn("text-xs", STATUS_COLORS[patient.status] || STATUS_COLORS.inactive)}>
                  {patient.status}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="font-mono">{patient.mrn}</span>
                </div>
                {patient.dateOfBirth && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{fmt(patient.dateOfBirth)}</span>
                  </div>
                )}
                {patient.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{patient.email}</span>
                  </div>
                )}
                {patient.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{patient.phone}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === tab.key
                  ? "border-rose-500 text-rose-600 dark:text-rose-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tabLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tabError ? (
          <p className="text-center text-red-500 py-12">{tabError}</p>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Demographics</h3>
                  <dl className="space-y-3">
                    <InfoRow label="MRN" value={patient.mrn} />
                    <InfoRow label="Status" value={patient.status} />
                    {patient.dateOfBirth && <InfoRow label="Date of Birth" value={fmt(patient.dateOfBirth)} />}
                    {patient.email && <InfoRow label="Email" value={patient.email} />}
                    {patient.phone && <InfoRow label="Phone" value={patient.phone} />}
                    <InfoRow label="Registered" value={fmt(patient.registeredAt || patient.createdAt)} />
                  </dl>
                </div>
                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Clinical Summary</h3>
                  <dl className="space-y-3">
                    {patient.primaryProviderId && <InfoRow label="Primary Provider ID" value={patient.primaryProviderId} />}
                    <InfoRow label="Record Created" value={fmtDt(patient.createdAt)} />
                  </dl>
                  <div className="pt-2 space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setActiveTab("encounters")}
                    >
                      <ClipboardPlus className="h-4 w-4" />
                      {t("tabEncounters")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setActiveTab("care-plans")}
                    >
                      <FileCheck className="h-4 w-4" />
                      {t("tabCarePlans")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Encounters Tab */}
            {activeTab === "encounters" && (
              <div className="space-y-3">
                {encounters.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noEncounters")}</p>
                ) : (
                  encounters.map(enc => (
                    <div key={enc.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <ClipboardPlus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-sm capitalize">{enc.encounterType.replace(/_/g, " ")}</span>
                        </div>
                        <Badge className={cn("text-xs", ENCOUNTER_STATUS_COLORS[enc.status] || ENCOUNTER_STATUS_COLORS.scheduled)}>
                          {enc.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                        {enc.scheduledAt && <span>Scheduled: {fmtDt(enc.scheduledAt)}</span>}
                        {enc.checkedInAt && <span>Checked in: {fmtDt(enc.checkedInAt)}</span>}
                        {enc.completedAt && <span>Completed: {fmtDt(enc.completedAt)}</span>}
                        {enc.cancelledAt && <span>Cancelled: {fmtDt(enc.cancelledAt)}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Care Plans Tab */}
            {activeTab === "care-plans" && (
              <div className="space-y-3">
                {carePlans.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noCarePlans")}</p>
                ) : (
                  carePlans.map(cp => (
                    <div key={cp.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <FileCheck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-sm">{cp.name}</span>
                        </div>
                        <Badge className={cn("text-xs", CARE_PLAN_STATUS_COLORS[cp.status] || CARE_PLAN_STATUS_COLORS.draft)}>
                          {cp.status}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        {cp.startDate && <span>{t("carePlanStartDate")}: {fmt(cp.startDate)}</span>}
                        {cp.endDate && <span>{t("carePlanEndDate")}: {fmt(cp.endDate)}</span>}
                        {Array.isArray(cp.goals) && cp.goals.length > 0 && (
                          <span>{cp.goals.length} goal{cp.goals.length !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Medical Records Tab */}
            {activeTab === "medical-records" && (
              <div className="space-y-3">
                {medicalRecords.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noMedicalRecords")}</p>
                ) : (
                  medicalRecords.map(rec => (
                    <div key={rec.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div>
                          <span className="font-medium text-sm capitalize">{rec.recordType.replace(/_/g, " ")}</span>
                          {rec.recordDate && (
                            <span className="text-xs text-muted-foreground ml-2">{fmt(rec.recordDate)}</span>
                          )}
                        </div>
                      </div>
                      {rec.summary && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{rec.summary}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </MotionPage>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  )
}
