"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Pencil, Trash2, FileText, Calendar, DollarSign, Hash, Clock, AlertTriangle, CheckSquare, Plus, X, Sparkles, GitBranch, PenLine, Send, RefreshCw, Copy, Check, Users, ThumbsUp, ThumbsDown, FilePen, ShieldAlert, ListChecks, Flag, TrendingUp, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { ContractForm } from "@/components/contract-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { computeLineDiff, type LineDiffChunk } from "@/lib/clm/line-diff"
import { findResidualVars } from "@/lib/clm/residual-vars"
import { toast } from "sonner"
import { HelpButton } from "@/components/help/help-button"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  expired: "destructive",
  draft: "secondary",
}

// ─── E-sign types ─────────────────────────────────────────────────────────────

interface EsignSigner {
  id: string
  fullName: string
  email: string
  order: number
  role: string
  status: string
  signedAt: string | null
  declinedAt: string | null
  viewedAt: string | null
}

interface EsignEnvelope {
  id: string
  subject: string
  message: string | null
  status: string
  sentAt: string | null
  completedAt: string | null
  expiresAt: string | null
  createdAt: string
  signers: EsignSigner[]
}

interface SigningLink {
  signerId: string
  fullName: string
  email: string
  signingLink: string
}

interface SignerInput {
  fullName: string
  email: string
  role: "signer" | "cc" | "copy"
}

const defaultSignerInput = (): SignerInput => ({ fullName: "", email: "", role: "signer" })

// ─── Approval types (parallel levels — Slice 3e-2) ────────────────────────────

interface ApprovalApproverInput {
  assigneeRole: string
}

interface ApprovalLevelInput {
  label: string
  approvers: ApprovalApproverInput[]
  mode: "all" | "any" | "quorum"
  quorum: string  // numeric string; empty means not set
  slaHours: string
}

/** Metadata row returned by the list endpoint (no renderedBody). */
interface ContractVersionRow {
  id: string
  versionNo: number
  source: string
  isCanonicalSigned: boolean
  contentHash: string
  note: string | null
  createdBy: string | null
  createdAt: string
}

/** Full row returned by the ?ids= endpoint (includes renderedBody). */
interface ContractVersionWithBody extends ContractVersionRow {
  renderedBody: string | null
}

const defaultApprover = (): ApprovalApproverInput => ({ assigneeRole: "" })
const defaultLevel = (): ApprovalLevelInput => ({
  label: "",
  approvers: [defaultApprover()],
  mode: "all",
  quorum: "",
  slaHours: "",
})

export default function ContractDetailPage() {
  const t = useTranslations("contracts")
  const tc = useTranslations("common")

  // ── AI panel label helpers ────────────────────────────────────────────────
  const categoryLabel = (c: string) => {
    const key = c.toLowerCase().trim().replace(/[\s-]+/g, "_")
    const map: Record<string, string> = {
      general: t("aiCategoryGeneral"), payment: t("aiCategoryPayment"), liability: t("aiCategoryLiability"),
      termination: t("aiCategoryTermination"), confidentiality: t("aiCategoryConfidentiality"),
      intellectual_property: t("aiCategoryIp"), ip: t("aiCategoryIp"), warranty: t("aiCategoryWarranty"),
      indemnity: t("aiCategoryIndemnity"), indemnification: t("aiCategoryIndemnity"),
      service: t("aiCategoryService"), services: t("aiCategoryService"), sla: t("aiCategorySla"),
      service_level_agreement: t("aiCategorySla"), definitions: t("aiCategoryDefinitions"), definition: t("aiCategoryDefinitions"),
      governing_law: t("aiCategoryGoverningLaw"), scope: t("aiCategoryScope"), term: t("aiCategoryTerm"),
      renewal: t("aiCategoryRenewal"), data_protection: t("aiCategoryDataProtection"),
      dispute_resolution: t("aiCategoryDispute"), disputes: t("aiCategoryDispute"),
    }
    return map[key] ?? c.replace(/_/g, " ")
  }
  const partyLabel = (p: string) => {
    const roleMap: Record<string, string> = {
      provider: t("aiPartyProvider"), client: t("aiPartyClient"), supplier: t("aiPartySupplier"),
      customer: t("aiPartyCustomer"), vendor: t("aiPartyVendor"), both: t("aiPartyBoth"), either: t("aiPartyEither"),
    }
    const m = p.match(/^\s*([A-Za-z]+)(.*)$/) // leading role word, keep any "(company)" suffix
    if (m && roleMap[m[1].toLowerCase()]) return roleMap[m[1].toLowerCase()] + m[2]
    return p
  }
  const scoringRiskLabel = (r: string) => {
    const map: Record<string, string> = {
      low: t("aiInsightsRiskLow"), medium: t("aiInsightsRiskMedium"), high: t("aiInsightsRiskHigh"),
      unknown: t("aiInsightsRiskUnknown"), standard: t("aiRiskStandard"), fallback: t("aiRiskFallback"), high_risk: t("aiRiskHighRisk"),
    }
    return map[r.toLowerCase()] ?? r.replace(/_/g, " ")
  }
  // ─────────────────────────────────────────────────────────────────────────

  const params = useParams()
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const [contract, setContract] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const orgId = session?.user?.organizationId

  // ── Create Invoice state (Slice 7c) ─────────────────────────────────────
  const [createInvoiceLoading, setCreateInvoiceLoading] = useState(false)
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)

  // Submit-for-approval dialog state (parallel levels — Slice 3e-2)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalLevels, setApprovalLevels] = useState<ApprovalLevelInput[]>([defaultLevel()])
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  // Approve/reject action state
  const [approvalActionLoading, setApprovalActionLoading] = useState<string | null>(null) // stageId being acted on

  // Version history state
  const [versions, setVersions] = useState<ContractVersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [diffFrom, setDiffFrom] = useState<string>("")
  const [diffTo, setDiffTo] = useState<string>("")
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffChunks, setDiffChunks] = useState<LineDiffChunk[]>([])
  const [diffTooLarge, setDiffTooLarge] = useState(false)

  // ── AI Redline state (Slice 6d) ───────────────────────────────────────────
  interface AiRedlineDelta {
    changeType: "added" | "removed" | "modified"
    clauseTitle: string
    summary: string
    severity: "low" | "medium" | "high"
  }
  interface AiRedline {
    id: string
    status: string
    model: string
    deltas: AiRedlineDelta[]
    overallAssessment: string
    fromVersionId: string
    toVersionId: string
    promptTokens: number | null
    completionTokens: number | null
    costUsd: string | null
    createdAt: string
  }
  const [aiRedline, setAiRedline] = useState<AiRedline | null>(null)
  const [aiRedlining, setAiRedlining] = useState(false)
  const [aiRedlineError, setAiRedlineError] = useState<string | null>(null)
  // Version selectors for redline (default to the two latest when versions load)
  const [redlineFrom, setRedlineFrom] = useState<string>("")
  const [redlineTo, setRedlineTo]     = useState<string>("")

  // E-signature state
  const [envelopes, setEnvelopes] = useState<EsignEnvelope[]>([])
  const [envelopesLoading, setEnvelopesLoading] = useState(false)
  const [esignDialogOpen, setEsignDialogOpen] = useState(false)
  const [esignSubject, setEsignSubject] = useState("")
  const [esignMessage, setEsignMessage] = useState("")
  const [esignSigners, setEsignSigners] = useState<SignerInput[]>([defaultSignerInput()])
  const [esignLoading, setEsignLoading] = useState(false)
  const [esignError, setEsignError] = useState<string | null>(null)
  // Signing links are only returned at send time; stored per-send session only
  const [esignLinks, setEsignLinks] = useState<SigningLink[]>([])
  const [esignLinksDialogOpen, setEsignLinksDialogOpen] = useState(false)
  // Per-link copy-confirmation state (signerId → boolean)
  const [copiedLinks, setCopiedLinks] = useState<Record<string, boolean>>({})

  // "View Document" dialog state
  const [docOpen, setDocOpen] = useState(false)

  // Amendment dialog state (Slice 4a)
  const [amendOpen, setAmendOpen] = useState(false)
  const [amendBody, setAmendBody] = useState("")
  const [amendNote, setAmendNote] = useState("")
  const [amendTitle, setAmendTitle] = useState("")
  const [amendLoading, setAmendLoading] = useState(false)
  const [amendError, setAmendError] = useState<string | null>(null)

  // Deviation flags state (Slice 4c)
  interface DeviationFlag {
    id: string
    clauseId: string | null
    clauseTitle: string
    deviationType: string
    severity: string
    status: string
    waivedBy: string | null
    waivedAt: string | null
    waivedReason: string | null
    detectedAt: string
  }
  // ─── Milestone types (Slice 5a) ─────────────────────────────────────────────
  interface ContractMilestone {
    id: string
    organizationId: string
    contractId: string
    label: string
    description: string | null
    dueAt: string
    completedAt: string | null
    status: string
    ownerUserId: string | null
    lastRemindedAt: string | null
    metadata: Record<string, unknown>
    createdBy: string | null
    createdAt: string
    updatedAt: string
  }

  const [milestones, setMilestones] = useState<ContractMilestone[]>([])
  const [milestonesLoading, setMilestonesLoading] = useState(false)
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [milestoneEditTarget, setMilestoneEditTarget] = useState<ContractMilestone | null>(null)
  const [milestoneLabel, setMilestoneLabel] = useState("")
  const [milestoneDesc, setMilestoneDesc] = useState("")
  const [milestoneDueAt, setMilestoneDueAt] = useState("")
  const [milestoneStatus, setMilestoneStatus] = useState("pending")
  const [milestoneOwner, setMilestoneOwner] = useState("")
  const [milestoneSaving, setMilestoneSaving] = useState(false)
  const [milestoneError, setMilestoneError] = useState<string | null>(null)
  const [milestoneDeleteLoading, setMilestoneDeleteLoading] = useState<string | null>(null)

  const [deviations, setDeviations] = useState<DeviationFlag[]>([])
  const [deviationsLoading, setDeviationsLoading] = useState(false)
  const [deviationsRescanning, setDeviationsRescanning] = useState(false)
  const [waiveOpen, setWaiveOpen] = useState(false)
  const [waiveFlagId, setWaiveFlagId] = useState<string | null>(null)
  const [waiveReason, setWaiveReason] = useState("")
  const [waiveLoading, setWaiveLoading] = useState(false)

  // ── Revenue Recognition state (Slice 5b-2) ────────────────────────────────
  const [pos, setPos] = useState<any[]>([])
  const [posLoading, setPosLoading] = useState(false)
  const [posRecalcLoading, setPosRecalcLoading] = useState(false)
  const [posError, setPosError] = useState<string | null>(null)
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null)
  const [poSchedules, setPoSchedules] = useState<Record<string, any>>({})
  const [poSchedulesLoading, setPoSchedulesLoading] = useState<Record<string, boolean>>({})
  // Add obligation dialog
  const [rrDialogOpen, setRrDialogOpen] = useState(false)
  const [rrDesc, setRrDesc] = useState("")
  const [rrSsp, setRrSsp] = useState("")
  const [rrMethod, setRrMethod] = useState<"point_in_time" | "over_time_straight_line" | "milestone" | "usage_based">("point_in_time")
  const [rrPeriodStart, setRrPeriodStart] = useState("")
  const [rrPeriodEnd, setRrPeriodEnd] = useState("")
  const [rrMilestones, setRrMilestones] = useState<{label: string; weight: string; dueAt: string}[]>([{label:"",weight:"1",dueAt:""}])
  const [rrSaving, setRrSaving] = useState(false)
  const [rrDialogError, setRrDialogError] = useState<string | null>(null)

  // ── AI Insights state (Slice 6a) ──────────────────────────────────────────
  interface AiClause {
    title: string
    text: string
    category: string
    inferredRiskLevel: string
  }
  interface AiObligation {
    label: string
    party: string
    dueDateText: string
    condition: string
  }
  interface AiExtraction {
    id: string
    status: string
    model: string
    extractedClauses: AiClause[]
    extractedObligations: AiObligation[]
    contractVersionId: string | null
    promptTokens: number | null
    completionTokens: number | null
    costUsd: string | null
    createdAt: string
  }
  const [aiExtraction, setAiExtraction] = useState<AiExtraction | null>(null)
  const [aiExtracting, setAiExtracting] = useState(false)
  const [aiExtractionError, setAiExtractionError] = useState<string | null>(null)

  // ── AI Risk Score state (Slice 6b) ────────────────────────────────────────
  interface AiClauseScore {
    clauseTitle: string
    matchedLibraryClauseId: string | null
    riskLevel: string
    deviationType: string | null
    severity: string | null
    rationale: string
    suggestedFallbackClauseId: string | null
  }
  interface AiRiskScore {
    id: string
    status: string
    model: string
    overallRisk: string
    clauseScores: AiClauseScore[]
    extractionId: string | null
    deviationFlagsCreated?: number
    promptTokens: number | null
    completionTokens: number | null
    costUsd: string | null
    createdAt: string
  }
  const [aiRiskScore, setAiRiskScore] = useState<AiRiskScore | null>(null)
  const [aiScoring, setAiScoring] = useState(false)
  const [aiScoringError, setAiScoringError] = useState<string | null>(null)

  // ── Reindex state (Slice 6c) ──────────────────────────────────────────────
  const [aiReindexing, setAiReindexing] = useState(false)

  const handleAiReindex = async () => {
    if (!params.id || !orgId) return
    setAiReindexing(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/reindex`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
      })
      const json = await res.json()
      if (json.success) {
        toast.success(t("reindexSuccess"))
      } else {
        toast.error(json.error ?? t("reindexError"))
      }
    } catch (err) {
      console.error(err)
      toast.error(t("reindexError"))
    } finally {
      setAiReindexing(false)
    }
  }

  const fetchAiRiskScore = async () => {
    if (!params.id || !orgId) return
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/score-risk`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setAiRiskScore(json.data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (params.id && orgId) fetchAiRiskScore()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, orgId])

  const handleAiScoreRisk = async () => {
    if (!params.id || !orgId) return
    setAiScoring(true)
    setAiScoringError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/score-risk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
      })
      const json = await res.json()
      if (json.success && json.data) {
        setAiRiskScore(json.data)
        // Refresh deviation flags panel since new flags may have been auto-created
        fetchDeviations()
      } else {
        setAiScoringError(json.error ?? t("aiRiskScoreError"))
      }
    } catch (err) {
      console.error(err)
      setAiScoringError(t("aiRiskScoreError"))
    } finally {
      setAiScoring(false)
    }
  }

  // ── AI Redline handlers (Slice 6d) ────────────────────────────────────────
  const fetchAiRedline = async (fromId?: string, toId?: string) => {
    if (!params.id || !orgId) return
    try {
      // When a specific pair is requested, scope the GET to that pair so the
      // displayed redline always matches the selected from/to selectors.
      const from = fromId ?? redlineFrom
      const to   = toId   ?? redlineTo
      const qs   = from && to ? `?fromVersionId=${encodeURIComponent(from)}&toVersionId=${encodeURIComponent(to)}` : ""
      const res = await fetch(`/api/v1/contracts/${params.id}/redline${qs}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setAiRedline(json.data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (params.id && orgId) fetchAiRedline()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, orgId])

  // Re-fetch the stored redline whenever the user changes the from/to pair so
  // the displayed result always matches the selected pair (not a later pair's result).
  useEffect(() => {
    if (params.id && orgId && redlineFrom && redlineTo) {
      fetchAiRedline(redlineFrom, redlineTo)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redlineFrom, redlineTo])

  const handleAiRedline = async () => {
    if (!params.id || !orgId || !redlineFrom || !redlineTo) return
    setAiRedlining(true)
    setAiRedlineError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/redline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ fromVersionId: redlineFrom, toVersionId: redlineTo }),
      })
      const json = await res.json()
      if (json.success && json.data) {
        setAiRedline(json.data)
      } else {
        setAiRedlineError(json.errorKey ? t(json.errorKey) : (json.error ?? t("aiRedlineError")))
      }
    } catch (err) {
      console.error(err)
      setAiRedlineError(t("aiRedlineError"))
    } finally {
      setAiRedlining(false)
    }
  }

  const fetchAiExtraction = async () => {
    if (!params.id || !orgId) return
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/extract`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setAiExtraction(json.data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (params.id && orgId) fetchAiExtraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, orgId])

  const handleAiExtract = async () => {
    if (!params.id || !orgId) return
    setAiExtracting(true)
    setAiExtractionError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
      })
      const json = await res.json()
      if (json.success && json.data) {
        setAiExtraction(json.data)
      } else {
        setAiExtractionError(json.errorKey ? t(json.errorKey) : (json.error ?? t("aiInsightsError")))
      }
    } catch (err) {
      console.error(err)
      setAiExtractionError(t("aiInsightsError"))
    } finally {
      setAiExtracting(false)
    }
  }

  const fetchContract = async () => {
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setContract(json.data)
    } catch (err) { console.error(err) } finally {
      setLoading(false)
    }
  }

  const fetchVersions = async () => {
    if (!params.id) return
    setVersionsLoading(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/versions`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (Array.isArray(json.versions)) {
        setVersions(json.versions)
        // Auto-default AI Redline selectors to the two latest versions
        if (json.versions.length >= 2) {
          const sorted = [...json.versions].sort(
            (a: ContractVersionRow, b: ContractVersionRow) => b.versionNo - a.versionNo,
          )
          setRedlineTo(sorted[0].id)
          setRedlineFrom(sorted[1].id)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setVersionsLoading(false)
    }
  }

  const fetchEnvelopes = async () => {
    if (!params.id) return
    setEnvelopesLoading(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/esign`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setEnvelopes(json.data)
    } catch (err) {
      console.error(err)
    } finally {
      setEnvelopesLoading(false)
    }
  }

  useEffect(() => {
    if (params.id) fetchContract()
  }, [params.id, session])

  useEffect(() => {
    if (params.id && orgId) fetchVersions()
  }, [params.id, orgId])

  useEffect(() => {
    if (params.id && orgId) fetchEnvelopes()
  }, [params.id, orgId])

  const fetchDeviations = async () => {
    if (!params.id) return
    setDeviationsLoading(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/deviations`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setDeviations(json.data)
    } catch (err) {
      console.error(err)
    } finally {
      setDeviationsLoading(false)
    }
  }

  useEffect(() => {
    if (params.id && orgId) fetchDeviations()
  }, [params.id, orgId])

  // ─── Revenue Recognition helpers (Slice 5b-2) ───────────────────────────────

  const userRole = session?.user?.role as string | undefined
  const isFinanceUser = userRole === "admin" || userRole === "superadmin" || userRole === "manager"

  const fetchPos = async () => {
    if (!params.id) return
    setPosLoading(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/performance-obligations`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setPos(json.data)
    } catch (err) {
      console.error(err)
    } finally {
      setPosLoading(false)
    }
  }

  useEffect(() => {
    if (params.id && orgId && isFinanceUser) fetchPos()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, orgId, isFinanceUser])

  const fetchPoSchedules = async (poId: string) => {
    setPoSchedulesLoading((s) => ({ ...s, [poId]: true }))
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/performance-obligations/${poId}/schedules`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setPoSchedules((s) => ({ ...s, [poId]: json.data }))
      }
    } catch (err) {
      console.error(err)
    } finally {
      setPoSchedulesLoading((s) => ({ ...s, [poId]: false }))
    }
  }

  const handlePoExpand = (poId: string) => {
    if (expandedPoId === poId) {
      setExpandedPoId(null)
    } else {
      setExpandedPoId(poId)
      if (!poSchedules[poId]) {
        fetchPoSchedules(poId)
      }
    }
  }

  const handleRrRecalculate = async () => {
    if (!params.id) return
    setPosRecalcLoading(true)
    setPosError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/performance-obligations/recalculate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
      })
      const json = await res.json()
      if (!json.success) {
        setPosError(json.error || t("rrRecalcError"))
        toast.error(json.error || t("rrRecalcError"))
        return
      }
      toast.success(t("rrRecalcSuccess"))
      await fetchPos()
      // Reload schedules for any expanded PO.
      if (expandedPoId) fetchPoSchedules(expandedPoId)
    } catch {
      toast.error(t("rrRecalcError"))
    } finally {
      setPosRecalcLoading(false)
    }
  }

  const openRrDialog = () => {
    setRrDesc("")
    setRrSsp("")
    setRrMethod("point_in_time")
    setRrPeriodStart("")
    setRrPeriodEnd("")
    setRrMilestones([{label:"",weight:"1",dueAt:""}])
    setRrDialogError(null)
    setRrDialogOpen(true)
  }

  const handleRrSave = async () => {
    if (!rrDesc.trim()) { setRrDialogError(t("rrDescRequired")); return }
    if (!rrPeriodStart || !rrPeriodEnd) { setRrDialogError(t("rrPeriodEndError")); return }
    if (new Date(rrPeriodEnd) < new Date(rrPeriodStart)) { setRrDialogError(t("rrPeriodEndError")); return }
    if (rrMethod === "milestone") {
      if (rrMilestones.length === 0) { setRrDialogError(t("rrMilestoneRequired")); return }
      for (const m of rrMilestones) {
        if (!m.label.trim()) { setRrDialogError(t("rrMilestoneLabelRequired")); return }
        if (!m.weight || isNaN(Number(m.weight)) || Number(m.weight) <= 0) { setRrDialogError(t("rrMilestoneWeightRequired")); return }
        if (!m.dueAt) { setRrDialogError(t("rrMilestoneDueRequired")); return }
      }
    }
    setRrSaving(true)
    setRrDialogError(null)
    try {
      const body: Record<string, unknown> = {
        description:      rrDesc.trim(),
        recognitionMethod: rrMethod,
        periodStart:      rrPeriodStart,
        periodEnd:        rrPeriodEnd,
      }
      if (rrSsp.trim()) body.standaloneSellingPrice = rrSsp.trim()
      if (rrMethod === "milestone") {
        body.milestones = rrMilestones.map((m) => ({
          label:  m.label.trim(),
          weight: Math.round(Number(m.weight)),
          dueAt:  m.dueAt,
        }))
      }
      const res = await fetch(`/api/v1/contracts/${params.id}/performance-obligations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) { setRrDialogError(json.error || t("rrSaveError")); return }
      toast.success(t("rrSaveSuccess"))
      setRrDialogOpen(false)
      await fetchPos()
    } catch {
      setRrDialogError(t("rrSaveError"))
    } finally {
      setRrSaving(false)
    }
  }

  // ─── Milestone fetch + CRUD helpers (Slice 5a) ──────────────────────────────

  const fetchMilestones = async () => {
    if (!params.id) return
    setMilestonesLoading(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/milestones`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setMilestones(json.data)
    } catch (err) {
      console.error(err)
    } finally {
      setMilestonesLoading(false)
    }
  }

  useEffect(() => {
    if (params.id && orgId) fetchMilestones()
  }, [params.id, orgId])

  const openAddMilestone = () => {
    setMilestoneEditTarget(null)
    setMilestoneLabel("")
    setMilestoneDesc("")
    setMilestoneDueAt("")
    setMilestoneStatus("pending")
    setMilestoneOwner("")
    setMilestoneError(null)
    setMilestoneDialogOpen(true)
  }

  const openEditMilestone = (m: ContractMilestone) => {
    setMilestoneEditTarget(m)
    setMilestoneLabel(m.label)
    setMilestoneDesc(m.description ?? "")
    setMilestoneDueAt(m.dueAt ? m.dueAt.split("T")[0] : "")
    setMilestoneStatus(m.status)
    setMilestoneOwner(m.ownerUserId ?? "")
    setMilestoneError(null)
    setMilestoneDialogOpen(true)
  }

  const handleSaveMilestone = async () => {
    if (!milestoneLabel.trim()) { setMilestoneError(t("milestonesLabelRequired")); return }
    if (!milestoneDueAt)        { setMilestoneError(t("milestonesDueRequired")); return }
    setMilestoneSaving(true)
    setMilestoneError(null)
    try {
      const url = milestoneEditTarget
        ? `/api/v1/contracts/${params.id}/milestones/${milestoneEditTarget.id}`
        : `/api/v1/contracts/${params.id}/milestones`
      const method = milestoneEditTarget ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          label:       milestoneLabel.trim(),
          description: milestoneDesc.trim() || null,
          dueAt:       milestoneDueAt,
          status:      milestoneStatus,
          ownerUserId: milestoneOwner || null,
        }),
      })
      const json = await res.json()
      if (!json.success) { setMilestoneError(json.error || t("milestonesSaveError")); return }
      setMilestoneDialogOpen(false)
      await fetchMilestones()
      toast.success(t("milestonesSaveSuccess"))
    } catch {
      setMilestoneError(t("milestonesSaveError"))
    } finally {
      setMilestoneSaving(false)
    }
  }

  const handleMarkComplete = async (milestoneId: string) => {
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/milestones/${milestoneId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ status: "completed" }),
      })
      const json = await res.json()
      if (!json.success) { toast.error(t("milestonesCompleteError")); return }
      await fetchMilestones()
      toast.success(t("milestonesCompleteSuccess"))
    } catch {
      toast.error(t("milestonesCompleteError"))
    }
  }

  const handleDeleteMilestone = async (milestoneId: string) => {
    setMilestoneDeleteLoading(milestoneId)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/milestones/${milestoneId}`, {
        method: "DELETE",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (!json.success) { toast.error(t("milestonesDeleteError")); return }
      await fetchMilestones()
      toast.success(t("milestonesDeleteSuccess"))
    } catch {
      toast.error(t("milestonesDeleteError"))
    } finally {
      setMilestoneDeleteLoading(null)
    }
  }

  const handleDeviationAction = async (flagId: string, action: "acknowledge" | "waive", reason?: string) => {
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/deviations/${flagId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ action, reason }),
      })
      const json = await res.json()
      if (!json.success) { toast.error(t("deviationsActionFailed")); return }
      await fetchDeviations()
    } catch {
      toast.error(t("deviationsActionFailed"))
    }
  }

  const handleRescan = async () => {
    if (!params.id) return
    setDeviationsRescanning(true)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/deviations/rescan`, {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (!json.success) { toast.error(t("deviationsRescanFailed")); return }
      toast.success(t("deviationsRescanSuccess"))
      await fetchDeviations()
    } catch {
      toast.error(t("deviationsRescanFailed"))
    } finally {
      setDeviationsRescanning(false)
    }
  }

  const openWaiveDialog = (flagId: string) => {
    setWaiveFlagId(flagId)
    setWaiveReason("")
    setWaiveOpen(true)
  }

  const handleWaiveConfirm = async () => {
    if (!waiveFlagId) return
    setWaiveLoading(true)
    await handleDeviationAction(waiveFlagId, "waive", waiveReason || undefined)
    setWaiveLoading(false)
    setWaiveOpen(false)
    setWaiveFlagId(null)
    setWaiveReason("")
  }

  const handleDelete = async () => {
    const res = await fetch(`/api/v1/contracts/${params.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || tc("errorDeleteFailed"))
    router.push("/contracts")
  }

  // ── Level-level helpers ────────────────────────────────────────────────────
  const addLevel = () => {
    if (approvalLevels.length < 5) setApprovalLevels((s) => [...s, defaultLevel()])
  }
  const removeLevel = (idx: number) => {
    setApprovalLevels((s) => s.filter((_, i) => i !== idx))
  }
  const updateLevel = <K extends keyof ApprovalLevelInput>(
    idx: number,
    field: K,
    value: ApprovalLevelInput[K],
  ) => {
    setApprovalLevels((s) => s.map((lvl, i) => i === idx ? { ...lvl, [field]: value } : lvl))
  }

  // ── Approver-level helpers (within a level) ────────────────────────────────
  const addApprover = (lvlIdx: number) => {
    setApprovalLevels((s) => s.map((lvl, i) =>
      i === lvlIdx && lvl.approvers.length < 8
        ? { ...lvl, approvers: [...lvl.approvers, defaultApprover()] }
        : lvl,
    ))
  }
  const removeApprover = (lvlIdx: number, apprIdx: number) => {
    setApprovalLevels((s) => s.map((lvl, i) =>
      i === lvlIdx
        ? { ...lvl, approvers: lvl.approvers.filter((_, j) => j !== apprIdx) }
        : lvl,
    ))
  }
  const updateApprover = (lvlIdx: number, apprIdx: number, value: string) => {
    setApprovalLevels((s) => s.map((lvl, i) =>
      i === lvlIdx
        ? {
            ...lvl,
            approvers: lvl.approvers.map((a, j) =>
              j === apprIdx ? { assigneeRole: value } : a,
            ),
          }
        : lvl,
    ))
  }

  const handleSubmitForApproval = async () => {
    // Validate: all levels must have a label
    const invalidLabel = approvalLevels.some((l) => !l.label.trim())
    if (invalidLabel) {
      setApprovalError(t("approvalStageLabelRequired"))
      return
    }
    // Validate: quorum levels must have a valid quorum value
    for (let i = 0; i < approvalLevels.length; i++) {
      const lvl = approvalLevels[i]
      if (lvl.mode === "quorum") {
        const q = parseInt(lvl.quorum, 10)
        if (!lvl.quorum.trim() || isNaN(q) || q < 1 || q > lvl.approvers.length) {
          setApprovalError(t("approvalQuorumInvalid", { num: i + 1, max: lvl.approvers.length }))
          return
        }
      }
    }
    setApprovalLoading(true)
    setApprovalError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${params.id}/submit-for-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: approvalLevels.map((lvl) => ({
            label: lvl.label.trim(),
            approvers: lvl.approvers.map((a) => ({
              ...(a.assigneeRole.trim() ? { assigneeRole: a.assigneeRole.trim() } : {}),
            })),
            mode: lvl.mode,
            ...(lvl.mode === "quorum" && lvl.quorum.trim()
              ? { quorum: parseInt(lvl.quorum.trim(), 10) }
              : {}),
            ...(lvl.slaHours.trim() ? { slaHours: parseInt(lvl.slaHours.trim(), 10) } : {}),
          })),
        }),
      })
      const json = await res.json()
      if (!json.success) {
        setApprovalError(json.error || t("approvalSubmitError"))
        return
      }
      setApprovalOpen(false)
      setApprovalLevels([defaultLevel()])
      await fetchContract()
    } catch {
      setApprovalError(t("approvalSubmitError"))
    } finally {
      setApprovalLoading(false)
    }
  }

  // ── Approve / Reject a stage in a parallel level ───────────────────────────
  const handleDecideStage = async (stageId: string, stageOrder: number, decision: "approve" | "reject") => {
    setApprovalActionLoading(stageId)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)
      const res = await fetch(`/api/v1/contracts/${params.id}/approvals/${stageOrder}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decision, stageId }),
      })
      const json = await res.json()
      if (!json.success) {
        // Surface the error non-destructively
        setApprovalError(json.error || t("approvalSubmitError"))
        return
      }
      await fetchContract()
    } catch {
      setApprovalError(t("approvalSubmitError"))
    } finally {
      setApprovalActionLoading(null)
    }
  }

  /** Max body size / line-count we're willing to pass to the O(m*n) LCS diff. */
  const DIFF_MAX_CHARS = 200_000
  const DIFF_MAX_LINES = 4_000

  const handleCompare = async () => {
    if (!diffFrom || !diffTo || diffFrom === diffTo) return

    // Fetch the two version bodies from the server via ?ids= (the list endpoint
    // intentionally omits renderedBody; this targeted fetch returns it).
    const res = await fetch(
      `/api/v1/contracts/${params.id}/versions?ids=${encodeURIComponent(`${diffFrom},${diffTo}`)}`,
      { headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>) },
    )
    if (!res.ok) return
    const json = await res.json()
    const fetched: ContractVersionWithBody[] = json.versions ?? []

    const fromVersion = fetched.find((v) => v.id === diffFrom)
    const toVersion = fetched.find((v) => v.id === diffTo)
    if (!fromVersion || !toVersion) return

    const aBody = fromVersion.renderedBody ?? ""
    const bBody = toVersion.renderedBody ?? ""

    // Size guard: O(m*n) LCS is too slow / memory-hungry for very large bodies.
    // Show a "too large" message instead of locking up the browser.
    const tooLarge =
      aBody.length > DIFF_MAX_CHARS ||
      bBody.length > DIFF_MAX_CHARS ||
      aBody.split("\n").length > DIFF_MAX_LINES ||
      bBody.split("\n").length > DIFF_MAX_LINES

    setDiffTooLarge(tooLarge)
    setDiffChunks(tooLarge ? [] : computeLineDiff(aBody, bBody))
    setDiffOpen(true)
  }

  // ── E-sign signer input helpers ────────────────────────────────────────────

  const addSigner = () => {
    if (esignSigners.length < 10) setEsignSigners((s) => [...s, defaultSignerInput()])
  }
  const removeSigner = (idx: number) => {
    setEsignSigners((s) => s.filter((_, i) => i !== idx))
  }
  const updateSigner = (idx: number, field: keyof SignerInput, value: string) => {
    setEsignSigners((s) => s.map((row, i) => i === idx ? { ...row, [field]: value } : row))
  }

  const openEsignDialog = () => {
    setEsignSubject(contract ? `${t("esignDefaultSubject")}: ${contract.title}` : "")
    setEsignMessage("")
    setEsignSigners([defaultSignerInput()])
    setEsignError(null)
    setEsignDialogOpen(true)
  }

  const handleSendForSignature = async () => {
    // Basic validation
    const invalidSigner = esignSigners.some((s) => !s.fullName.trim() || !s.email.trim())
    if (invalidSigner) {
      setEsignError(t("esignSignerRequired"))
      return
    }
    if (!esignSubject.trim()) {
      setEsignError(t("esignSubjectRequired"))
      return
    }
    setEsignLoading(true)
    setEsignError(null)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)

      // Step 1: create envelope
      const createRes = await fetch(`/api/v1/contracts/${params.id}/esign`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject: esignSubject.trim(),
          message: esignMessage.trim() || undefined,
          signers: esignSigners.map((s, idx) => ({
            fullName: s.fullName.trim(),
            email: s.email.trim(),
            role: s.role,
            order: idx + 1,
          })),
        }),
      })
      const createJson = await createRes.json()
      if (!createJson.success) {
        setEsignError(createJson.error || t("esignCreateError"))
        return
      }
      const envelopeId = createJson.data.envelope.id

      // Step 2: send envelope
      const sendRes = await fetch(`/api/v1/contracts/${params.id}/esign/${envelopeId}/send`, {
        method: "POST",
        headers,
      })
      const sendJson = await sendRes.json()
      if (!sendJson.success) {
        setEsignError(sendJson.errorKey ? t(sendJson.errorKey) : (sendJson.error || t("esignSendError")))
        return
      }

      // Success: capture links (only returned at send time)
      const links: SigningLink[] = sendJson.data.signingLinks ?? []
      setEsignLinks(links)
      setEsignDialogOpen(false)
      await fetchEnvelopes()
      toast.success(t("esignSentSuccess"))
      if (links.length > 0) {
        setEsignLinksDialogOpen(true)
      }
    } catch {
      setEsignError(t("esignSendError"))
    } finally {
      setEsignLoading(false)
    }
  }

  // ── Amendment handler (Slice 4a) ───────────────────────────────────────────

  const openAmendDialog = () => {
    setAmendBody(contract?.renderedBody ?? "")
    setAmendTitle(contract?.title ?? "")
    setAmendNote("")
    setAmendError(null)
    setAmendOpen(true)
  }

  const handleAmend = async () => {
    if (!amendBody.trim()) {
      setAmendError(t("amendBodyRequired"))
      return
    }
    setAmendLoading(true)
    setAmendError(null)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)

      const res = await fetch(`/api/v1/contracts/${params.id}/amend`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          renderedBody: amendBody.trim(),
          ...(amendNote.trim() ? { changeNote: amendNote.trim() } : {}),
          ...(amendTitle.trim() && amendTitle.trim() !== contract?.title
            ? { title: amendTitle.trim() }
            : {}),
        }),
      })
      const json = await res.json()
      if (!json.success) {
        setAmendError(json.error || t("amendError"))
        return
      }
      setAmendOpen(false)
      await Promise.all([fetchContract(), fetchVersions()])
      toast.success(t("amendSuccess"))
    } catch {
      setAmendError(t("amendError"))
    } finally {
      setAmendLoading(false)
    }
  }

  const handleCopyLink = async (signerId: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopiedLinks((prev) => ({ ...prev, [signerId]: true }))
      setTimeout(() => setCopiedLinks((prev) => ({ ...prev, [signerId]: false })), 2000)
    } catch {
      toast.error(t("esignCopyError"))
    }
  }

  // ── E-sign display helpers ──────────────────────────────────────────────────

  const envelopeStatusBadge = (status: string) => {
    const map: Record<string, "default" | "secondary" | "destructive"> = {
      created: "secondary",
      sent: "default",
      in_progress: "default",
      completed: "default",
      declined: "destructive",
      voided: "destructive",
      expired: "destructive",
    }
    return map[status] ?? "secondary"
  }

  const signerStatusBadge = (status: string) => {
    const map: Record<string, "default" | "secondary" | "destructive"> = {
      pending: "secondary",
      sent: "secondary",
      viewed: "secondary",
      signed: "default",
      declined: "destructive",
    }
    return map[status] ?? "secondary"
  }

  const envelopeStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      created: t("esignStatusCreated"),
      sent: t("esignStatusSent"),
      in_progress: t("esignStatusInProgress"),
      completed: t("esignStatusCompleted"),
      declined: t("esignStatusDeclined"),
      voided: t("esignStatusVoided"),
      expired: t("esignStatusExpired"),
    }
    return map[status] ?? status
  }

  const signerStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: t("esignSignerPending"),
      sent: t("esignSignerSent"),
      viewed: t("esignSignerViewed"),
      signed: t("esignSignerSigned"),
      declined: t("esignSignerDeclined"),
    }
    return map[status] ?? status
  }

  const sourceLabel = (source: string) => {
    const map: Record<string, string> = {
      draft: t("versionsSourceDraft"),
      amendment: t("versionsSourceAmendment"),
      signed: t("versionsSourceSigned"),
      import: t("versionsSourceImport"),
    }
    return map[source] ?? source
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!contract) {
    return <div className="text-center py-12 text-muted-foreground">{tc("noData")}</div>
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : "—"

  // ── Create Invoice handler (Slice 7c) ────────────────────────────────────
  const handleCreateInvoice = async () => {
    if (!params.id || !orgId) return
    setCreateInvoiceLoading(true)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)
      const res = await fetch(`/api/v1/contracts/${params.id}/create-invoice`, {
        method: "POST",
        headers,
      })
      const json = await res.json()
      if (json.success && json.data?.id) {
        setCreatedInvoiceId(json.data.id)
        toast.success(t("createInvoiceSuccess"))
      } else {
        toast.error(json.error ?? t("createInvoiceError"))
      }
    } catch {
      toast.error(t("createInvoiceError"))
    } finally {
      setCreateInvoiceLoading(false)
    }
  }

  // "Submit for approval" button visible when status is draft
  const canSubmitForApproval = contract.status === "draft"

  // "Amend" button visible when contract is active (Slice 4a)
  const canAmend = ["draft", "pending_approval", "approved", "active", "renewing"].includes(contract.status)

  // Localized status labels (mirror of the list page map) so the header/detail
  // badges show "Pending Approval" / "Renewing" / "Terminated" instead of the
  // raw enum string. Falls back to the raw status for any unmapped value.
  const statusLabels: Record<string, string> = {
    draft: t("statusDraft"),
    pending_approval: t("statusPendingApproval"),
    approved: t("statusApproved"),
    rejected: t("statusRejected"),
    cancelled: t("statusCancelled"),
    active: t("statusActive"),
    expired: t("statusExpired"),
    renewed: t("statusRenewed"),
    renewing: t("statusRenewing"),
    terminated: t("statusTerminated"),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/contracts")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight leading-tight line-clamp-2" title={contract.title}>{contract.title}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{contract.contractNumber || "—"}</span>
                <Badge variant={statusColors[contract.status] || "secondary"}>{statusLabels[contract.status] || contract.status}</Badge>
                <HelpButton slug="contract-detail" variant="label" />
              </div>
              {/* Slice-3 piece-4.5: provenance backlink when this contract
                  was auto-spawned from an accepted Quote. Renders as a
                  small chip below the contract number so it's discoverable
                  without dominating the header. */}
              {contract.spawnedFromQuoteId && (
                <Link
                  href={`/quotes/${contract.spawnedFromQuoteId}`}
                  className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/40 rounded px-2 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                  title="This contract was auto-spawned from an accepted quote — click to open the source"
                >
                  <Sparkles className="h-3 w-3" />
                  Auto-spawned from quote — view source
                </Link>
              )}
            </div>
          </div>
        </div>
        {/* ── Header actions: 1 primary CTA + View Doc + ••• overflow ── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Primary CTA — only "Submit for Approval" earns the filled slot */}
          {canSubmitForApproval && (
            <Button
              variant="default"
              onClick={() => {
                // Step 5: block approval while the body still has unresolved {{vars}}.
                const unresolved = findResidualVars(contract.renderedBody)
                if (unresolved.length > 0) {
                  toast.error(t("unresolvedVarsBlock", { vars: unresolved.slice(0, 5).join(", ") }))
                  return
                }
                setApprovalOpen(true)
                setApprovalError(null)
              }}
            >
              <CheckSquare className="h-4 w-4 mr-1.5" /> {t("submitForApproval")}
            </Button>
          )}

          {/* Open editor — top-level for editable statuses (audit 2026-06-10:
              the core CLM action was buried in the ••• overflow while the
              read-only viewer owned a button). Stays in ••• too. */}
          {["draft", "pending_approval", "approved", "active", "renewing"].includes(contract.status) && (
            <Button variant="outline" onClick={() => router.push(`/contracts/${contract.id}/editor`)}>
              <PenLine className="h-4 w-4 mr-1.5" /> {t("openEditor")}
            </Button>
          )}

          {/* View Document — always visible, secondary style */}
          <Button variant="outline" onClick={() => setDocOpen(true)}>
            <FileText className="h-4 w-4 mr-1.5" /> {t("viewDocument")}
          </Button>

          {/* ••• overflow: Edit, Amend, Invoice, Delete */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t("moreActions")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1.5">
              <PopoverClose asChild>
                <button
                  onClick={() => router.push(`/contracts/${contract.id}/editor`)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <PenLine className="h-4 w-4 text-muted-foreground" /> {t("openEditor")}
                </button>
              </PopoverClose>
              {canAmend && (
                <PopoverClose asChild>
                  <button
                    onClick={openAmendDialog}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <FilePen className="h-4 w-4 text-muted-foreground" /> {t("amendContract")}
                  </button>
                </PopoverClose>
              )}
              <PopoverClose asChild>
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" /> {tc("edit")}
                </button>
              </PopoverClose>
              {/* ── Create / View Invoice (finance users only) ── */}
              {isFinanceUser && (
                createdInvoiceId ? (
                  <PopoverClose asChild>
                    <button
                      onClick={() => router.push(`/invoices/${createdInvoiceId}`)}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" /> {t("viewInvoice")}
                    </button>
                  </PopoverClose>
                ) : (
                  <PopoverClose asChild>
                    <button
                      onClick={handleCreateInvoice}
                      disabled={createInvoiceLoading}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      {createInvoiceLoading ? t("createInvoiceCreating") : t("createInvoice")}
                    </button>
                  </PopoverClose>
                )
              )}
              <div className="my-1 h-px bg-border" />
              <PopoverClose asChild>
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-4 w-4" /> {tc("delete")}
                </button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {(() => {
        const daysActive = contract.startDate
          ? Math.floor((Date.now() - new Date(contract.startDate).getTime()) / 86400000)
          : null
        const daysLeft = contract.endDate
          ? Math.floor((new Date(contract.endDate).getTime() - Date.now()) / 86400000)
          : null
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ColorStatCard
              label={tc("daysActive")}
              value={daysActive !== null ? daysActive : "—"}
              icon={<Clock className="h-4 w-4" />}
            />
            <ColorStatCard
              label={tc("value")}
              value={contract.valueAmount ? `${Number(contract.valueAmount).toLocaleString()} ${contract.currency || "USD"}` : "—"}
              icon={<DollarSign className="h-4 w-4" />}
              hint={t("hintColAmount")}
            />
            <ColorStatCard
              label={tc("type")}
              value={contract.type || "—"}
              icon={<Hash className="h-4 w-4" />}
              hint={t("hintColType")}
            />
            <ColorStatCard
              label={tc("daysLeft")}
              value={daysLeft !== null ? (daysLeft < 0 ? t("expired") : `${daysLeft}`) : "—"}
              icon={<AlertTriangle className="h-4 w-4" />}
              hint={t("hintColDates")}
            />
          </div>
        )
      })()}

      <AdvisorRecordWidget entityType="contract" entityId={contract.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1">{tc("details")} <InfoHint text={t("pageDescription")} size={12} /></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground">{t("number")}:</span>
              <span className="ml-2 font-medium">{contract.contractNumber || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{tc("type")}:</span>
              <span className="ml-2 font-medium">{contract.type || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{tc("status")}:</span>
              <Badge variant={statusColors[contract.status] || "secondary"} className="ml-2">{statusLabels[contract.status] || contract.status}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">{tc("currency")}:</span>
              <span className="ml-2 font-medium">{contract.currency || "—"}</span>
            </div>
          </div>
          {contract.notes && (
            <div className="pt-4 border-t">
              <span className="text-muted-foreground">{tc("notes")}:</span>
              <p className="mt-1 whitespace-pre-wrap">{contract.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Approval Chain (parallel levels — Slice 3e-2) ───────────── */}
      {Array.isArray(contract.approvalStages) && contract.approvalStages.length > 0 && (() => {
        // Group stages by order (= level)
        type StageRow = {
          id: string
          order: number
          label: string
          status: string
          assigneeUserId?: string | null
          assigneeRole?: string | null
          parallelMode?: string | null
          quorumThreshold?: number | null
          slaHours?: number | null
          dueAt?: string | null
          escalationLevel?: number
          decidedAt?: string | null
        }
        const allStages: StageRow[] = contract.approvalStages
        const orderValues: number[] = [...new Set(allStages.map((s: StageRow) => s.order))].sort((a: number, b: number) => a - b)

        const currentLevel = contract.currentApprovalStage as number | null
        const userId = session?.user?.id as string | undefined
        const userRole = session?.user?.role as string | undefined

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                {t("approvalChainTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderValues.map((order: number) => {
                const levelStages = allStages.filter((s: StageRow) => s.order === order)
                const firstStage = levelStages[0]
                const mode: string = firstStage.parallelMode ?? "all"
                const quorum: number | null = firstStage.quorumThreshold ?? null
                const levelSize = levelStages.length
                const isCurrentLevel = currentLevel === order
                const now = Date.now()

                // Mode label
                const modeLabel =
                  mode === "any"
                    ? t("approvalModeAny")
                    : mode === "quorum" && quorum != null
                    ? t("approvalModeQuorum", { k: quorum, n: levelSize })
                    : t("approvalModeAll")

                // Level overall status
                const levelStatuses = levelStages.map((s: StageRow) => s.status)
                const allApproved = levelStatuses.every((s: string) => s === "approved")
                const anyRejected = levelStatuses.some((s: string) => s === "rejected")
                const hasPending = levelStatuses.some((s: string) => s === "pending")

                const levelStatusBadge = allApproved
                  ? "default"
                  : anyRejected
                  ? "destructive"
                  : hasPending
                  ? "outline"
                  : "secondary"
                const levelStatusText = allApproved
                  ? "approved"
                  : anyRejected
                  ? "rejected"
                  : hasPending
                  ? "pending"
                  : "skipped"

                // A pending level the chain hasn't reached yet: hint WHY there
                // are no approve buttons on it (they appear when it goes current).
                const isWaitingTurn = hasPending && currentLevel != null && order > currentLevel

                return (
                  <div
                    key={order}
                    className={`rounded-md border ${isCurrentLevel ? "border-primary/40 bg-primary/5" : ""}`}
                    title={isWaitingTurn ? t("approvalWaitingTurn") : undefined}
                  >
                    {/* Level header */}
                    <div className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border/50">
                      <span className="text-muted-foreground w-5 text-xs font-medium">{order}.</span>
                      <span className="flex-1 font-medium">{firstStage.label}</span>
                      {levelSize > 1 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" /> {levelSize}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{modeLabel}</span>
                      {firstStage.slaHours && (
                        <span className="text-xs text-muted-foreground">{firstStage.slaHours}h SLA</span>
                      )}
                      <Badge variant={levelStatusBadge} className="text-xs capitalize">
                        {levelStatusText}
                      </Badge>
                    </div>

                    {/* Per-approver rows */}
                    <div className="divide-y divide-border/30">
                      {levelStages.map((stage: StageRow) => {
                        const isOverdue =
                          stage.status === "pending" &&
                          stage.dueAt &&
                          new Date(stage.dueAt).getTime() <= now
                        const escalationLv = stage.escalationLevel ?? 0

                        // Can the current user act on this stage?
                        const isAssignedToMe =
                          stage.assigneeUserId != null && stage.assigneeUserId === userId
                        const isRoleMatch =
                          stage.assigneeRole != null && stage.assigneeRole === userRole
                        const isUnassigned =
                          !stage.assigneeUserId && !stage.assigneeRole
                        const isAdmin = userRole === "admin" || userRole === "superadmin"
                        // An actionable stage: pending at the current level. Eligibility
                        // (who may decide) is layered on top — and while the next-auth
                        // session is still hydrating, userRole is undefined, which used
                        // to hide the buttons entirely and read as "there is no approval"
                        // (server-side auth re-checks anyway, so showing disabled buttons
                        // during hydration leaks nothing).
                        const couldAct = stage.status === "pending" && isCurrentLevel
                        const sessionLoading = sessionStatus === "loading"
                        const canAct =
                          couldAct &&
                          (isAdmin || isAssignedToMe || isRoleMatch || (isUnassigned && userRole === "manager"))
                        const showActions = canAct || (couldAct && sessionLoading)

                        const isActing = approvalActionLoading === stage.id

                        return (
                          <div
                            key={stage.id}
                            className="flex items-center gap-2 px-3 py-2 text-sm pl-8"
                          >
                            <span className="flex-1 text-xs text-muted-foreground">
                              {stage.assigneeRole
                                ? stage.assigneeRole
                                : stage.assigneeUserId
                                ? t("approvalAssignedUser")
                                : t("approvalAnyManager")}
                            </span>
                            {isOverdue && escalationLv === 0 && (
                              <Badge variant="destructive" className="text-xs">{t("approvalOverdue")}</Badge>
                            )}
                            {isOverdue && escalationLv > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {t("approvalEscalated", { level: escalationLv })}
                              </Badge>
                            )}
                            {stage.decidedAt && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(stage.decidedAt).toLocaleDateString()}
                              </span>
                            )}
                            <Badge
                              variant={
                                stage.status === "approved"
                                  ? "default"
                                  : stage.status === "rejected"
                                  ? "destructive"
                                  : stage.status === "pending"
                                  ? "outline"
                                  : "secondary"
                              }
                              className="text-xs capitalize"
                            >
                              {stage.status}
                            </Badge>
                            {showActions && (
                              <div className="flex gap-1.5 ml-1">
                                {/* Explicit labeled actions: the old 24px ghost icons
                                    read as "no approve control here" (user report). */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 px-2 text-xs text-green-700 border-green-300 hover:bg-green-50 hover:text-green-800 dark:text-green-400 dark:border-green-900 dark:hover:bg-green-950"
                                  disabled={isActing || sessionLoading}
                                  onClick={() => handleDecideStage(stage.id, stage.order, "approve")}
                                  title={t("approvalApproveAction")}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" />
                                  {t("approvalApproveAction")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                                  disabled={isActing || sessionLoading}
                                  onClick={() => handleDecideStage(stage.id, stage.order, "reject")}
                                  title={t("approvalRejectAction")}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                  {t("approvalRejectAction")}
                                </Button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {approvalError && (
                <p className="text-sm text-destructive">{approvalError}</p>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* Submit-for-approval dialog (parallel levels — Slice 3e-2) */}
      <Dialog open={approvalOpen} onOpenChange={(open) => { if (!approvalLoading) { setApprovalOpen(open); if (!open) { setApprovalLevels([defaultLevel()]); setApprovalError(null) } } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" /> {t("submitForApprovalTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t("submitForApprovalDesc")}
            </p>

            {approvalLevels.map((lvl, lvlIdx) => (
              <div key={lvlIdx} className="rounded-md border p-3 space-y-3">
                {/* Level header row: label + SLA + remove button */}
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {t("approvalStageLabel", { num: lvlIdx + 1 })}
                    </Label>
                    <Input
                      value={lvl.label}
                      onChange={(e) => updateLevel(lvlIdx, "label", e.target.value)}
                      placeholder={t("approvalStagePlaceholder")}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="w-20 shrink-0 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {t("approvalStageSlaHours")}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={lvl.slaHours}
                      onChange={(e) => updateLevel(lvlIdx, "slaHours", e.target.value)}
                      placeholder={t("approvalStageSlaPlaceholder")}
                      className="h-8 text-sm"
                    />
                  </div>
                  {approvalLevels.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeLevel(lvlIdx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Mode selector + quorum input */}
                <div className="flex items-center gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("approvalModeLabel")}</Label>
                    <select
                      value={lvl.mode}
                      onChange={(e) => updateLevel(lvlIdx, "mode", e.target.value as "all" | "any" | "quorum")}
                      className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="all">{t("approvalModeAllOption")}</option>
                      <option value="any">{t("approvalModeAnyOption")}</option>
                      <option value="quorum">{t("approvalModeQuorumOption")}</option>
                    </select>
                  </div>
                  {lvl.mode === "quorum" && (
                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        {t("approvalQuorumLabel", { max: lvl.approvers.length })}
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={lvl.approvers.length}
                        value={lvl.quorum}
                        onChange={(e) => updateLevel(lvlIdx, "quorum", e.target.value)}
                        placeholder={`1–${lvl.approvers.length}`}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                </div>

                {/* Approver rows */}
                <div className="space-y-1.5 pl-2 border-l-2 border-border/30">
                  {lvl.approvers.map((approver, apprIdx) => (
                    <div key={apprIdx} className="flex items-center gap-2">
                      <div className="flex-1 space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">
                          {t("approvalStageRole")}
                        </Label>
                        <Input
                          value={approver.assigneeRole}
                          onChange={(e) => updateApprover(lvlIdx, apprIdx, e.target.value)}
                          placeholder={t("approvalStageRolePlaceholder")}
                          className="h-7 text-xs"
                        />
                      </div>
                      {lvl.approvers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-4 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeApprover(lvlIdx, apprIdx)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {lvl.approvers.length < 8 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground h-7 px-2"
                      onClick={() => addApprover(lvlIdx)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> {t("approvalAddApprover")}
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {approvalLevels.length < 5 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={addLevel}
              >
                <Plus className="h-3 w-3 mr-1" /> {t("addStage")}
              </Button>
            )}

            {approvalError && (
              <p className="text-sm text-destructive">{approvalError}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setApprovalOpen(false); setApprovalLevels([defaultLevel()]); setApprovalError(null) }} disabled={approvalLoading}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSubmitForApproval} disabled={approvalLoading}>
              {approvalLoading ? t("approvalSubmitting") : t("submitForApprovalTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContractForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchContract}
        orgId={orgId}
        initialData={{
          id: contract.id,
          contractNumber: contract.contractNumber || "",
          title: contract.title || "",
          companyId: contract.companyId || "",
          dealId: contract.dealId || "",
          contactId: contract.contactId || "",
          type: contract.type || "",
          status: contract.status,
          startDate: contract.startDate ? new Date(contract.startDate).toISOString().split("T")[0] : "",
          endDate: contract.endDate ? new Date(contract.endDate).toISOString().split("T")[0] : "",
          valueAmount: contract.valueAmount || 0,
          currency: contract.currency || "USD",
          notes: contract.notes || "",
        }}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteContract")}
        itemName={contract.title}
      />

      {/* ── Version History ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            {t("versionsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {versionsLoading ? (
            <div className="animate-pulse h-8 bg-muted rounded" />
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("versionsEmpty")}</p>
          ) : (
            <>
              {/* Version list */}
              <div className="divide-y text-sm">
                {versions.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono font-semibold text-xs w-8">v{v.versionNo}</span>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {sourceLabel(v.source)}
                    </Badge>
                    {v.isCanonicalSigned && (
                      <Badge variant="default" className="text-xs">
                        {t("versionsSigned")}
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground" title={v.contentHash}>
                      {v.contentHash.slice(0, 12)}
                    </span>
                    {v.note && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={v.note}>
                        {v.note}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Compare controls — only meaningful when there are ≥2 versions */}
              {versions.length >= 2 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground">{t("versionsFrom")}</span>
                  <select
                    value={diffFrom}
                    onChange={(e) => setDiffFrom(e.target.value)}
                    className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">{t("versionsSelectFrom")}</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.versionNo} — {sourceLabel(v.source)}
                      </option>
                    ))}
                  </select>

                  <span className="text-xs text-muted-foreground">{t("versionsTo")}</span>
                  <select
                    value={diffTo}
                    onChange={(e) => setDiffTo(e.target.value)}
                    className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">{t("versionsSelectTo")}</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.versionNo} — {sourceLabel(v.source)}
                      </option>
                    ))}
                  </select>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={!diffFrom || !diffTo || diffFrom === diffTo}
                    onClick={handleCompare}
                  >
                    {t("versionsCompare")}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── AI Redline (Slice 6d) ─────────────────────────────────── */}
      {versions.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              {t("aiRedlineTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Version selectors + generate button */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("versionsFrom")}</span>
              <select
                value={redlineFrom}
                onChange={(e) => setRedlineFrom(e.target.value)}
                className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("versionsSelectFrom")}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo} — {sourceLabel(v.source)}
                  </option>
                ))}
              </select>

              <span className="text-xs text-muted-foreground">{t("versionsTo")}</span>
              <select
                value={redlineTo}
                onChange={(e) => setRedlineTo(e.target.value)}
                className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("versionsSelectTo")}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo} — {sourceLabel(v.source)}
                  </option>
                ))}
              </select>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={aiRedlining || !redlineFrom || !redlineTo || redlineFrom === redlineTo}
                onClick={handleAiRedline}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                {aiRedlining ? t("aiRedlineGenerating") : t("aiRedlineGenerate")}
              </Button>
            </div>

            {aiRedlineError && (
              <p className="text-sm text-destructive">{aiRedlineError}</p>
            )}

            {/* Results */}
            {aiRedline && aiRedline.status === "completed" && (
              <div className="space-y-3">
                {/* Overall assessment */}
                {aiRedline.overallAssessment && (
                  <div className="rounded-lg bg-muted/50 border p-3 text-sm text-muted-foreground">
                    {aiRedline.overallAssessment}
                  </div>
                )}

                {/* Delta list */}
                {aiRedline.deltas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("aiRedlineNoDifferences")}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {t("aiRedlineDeltasTitle")} ({aiRedline.deltas.length})
                    </p>
                    {aiRedline.deltas.map((delta, idx) => {
                      const changeColors = {
                        added:    "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
                        removed:  "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
                        modified: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
                      } as const
                      const changeBadgeColors = {
                        added:    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
                        removed:  "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
                        modified: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
                      } as const
                      const severityBadgeColors = {
                        low:    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
                        medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
                        high:   "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                      } as const
                      return (
                        <div
                          key={idx}
                          className={`rounded-lg border p-3 space-y-1 text-sm ${changeColors[delta.changeType] ?? ""}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${changeBadgeColors[delta.changeType] ?? ""}`}>
                              {t(`aiRedlineChangeType_${delta.changeType}`)}
                            </span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${severityBadgeColors[delta.severity] ?? ""}`}>
                              {t(`aiRedlineSeverity_${delta.severity}`)}
                            </span>
                            <span className="font-medium text-foreground">{delta.clauseTitle}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{delta.summary}</p>
                        </div>
                      )
                    })}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {t("aiRedlineModel")}: {aiRedline.model}
                  {aiRedline.costUsd ? ` · $${parseFloat(aiRedline.costUsd).toFixed(4)}` : ""}
                  {" · "}{new Date(aiRedline.createdAt).toLocaleString()}
                </p>
              </div>
            )}

            {aiRedline && aiRedline.status === "failed" && (
              <p className="text-sm text-destructive">{t("aiRedlineError")}</p>
            )}

            {!aiRedline && !aiRedlining && (
              <p className="text-sm text-muted-foreground">{t("aiRedlineEmpty")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── E-Signature Section ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <PenLine className="h-4 w-4 text-muted-foreground" />
              {t("esignTitle")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={fetchEnvelopes}
                disabled={envelopesLoading}
                title={t("esignRefresh")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${envelopesLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={openEsignDialog}
              >
                <Send className="h-3 w-3 mr-1" />
                {t("esignSendForSignature")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {envelopesLoading ? (
            <div className="animate-pulse h-8 bg-muted rounded" />
          ) : envelopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("esignEmpty")}</p>
          ) : (
            <div className="space-y-3">
              {envelopes.map((env) => (
                <div
                  key={env.id}
                  className="border rounded-lg p-3 space-y-2 text-sm"
                >
                  {/* Envelope header row */}
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge variant={envelopeStatusBadge(env.status)} className="text-xs capitalize shrink-0">
                      {envelopeStatusLabel(env.status)}
                    </Badge>
                    <span className="font-medium flex-1 min-w-0 break-words">{env.subject}</span>
                  </div>
                  {/* Dates */}
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    {env.sentAt && (
                      <span>{t("esignSentAt")}: {new Date(env.sentAt).toLocaleString()}</span>
                    )}
                    {env.completedAt && (
                      <span>{t("esignCompletedAt")}: {new Date(env.completedAt).toLocaleString()}</span>
                    )}
                    {env.expiresAt && !env.completedAt && (
                      <span>{t("esignExpiresAt")}: {new Date(env.expiresAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  {/* Signer sub-list */}
                  {env.signers.length > 0 && (
                    <div className="divide-y divide-border/50 pl-1 border-l-2 border-border/30 ml-1">
                      {env.signers.map((signer) => (
                        <div key={signer.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                          <Badge
                            variant={signerStatusBadge(signer.status)}
                            className="text-[10px] capitalize shrink-0"
                          >
                            {signerStatusLabel(signer.status)}
                          </Badge>
                          <span className="font-medium">{signer.fullName}</span>
                          <span className="text-muted-foreground">{signer.email}</span>
                          {signer.role !== "signer" && (
                            <span className="text-muted-foreground capitalize">({signer.role})</span>
                          )}
                          {signer.signedAt && (
                            <span className="text-muted-foreground">
                              {t("esignSignedAt")}: {new Date(signer.signedAt).toLocaleString()}
                            </span>
                          )}
                          {signer.declinedAt && (
                            <span className="text-destructive">
                              {t("esignDeclinedAt")}: {new Date(signer.declinedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Send for Signature Dialog ─────────────────────────────── */}
      <Dialog open={esignDialogOpen} onOpenChange={(open) => { if (!esignLoading) setEsignDialogOpen(open) }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" /> {t("esignSendDialogTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Subject */}
            <div className="space-y-1">
              <Label className="text-xs">{t("esignSubjectLabel")} *</Label>
              <Input
                value={esignSubject}
                onChange={(e) => setEsignSubject(e.target.value)}
                placeholder={t("esignSubjectPlaceholder")}
                className="h-8 text-sm"
              />
            </div>

            {/* Message (optional) */}
            <div className="space-y-1">
              <Label className="text-xs">{t("esignMessageLabel")}</Label>
              <Textarea
                value={esignMessage}
                onChange={(e) => setEsignMessage(e.target.value)}
                placeholder={t("esignMessagePlaceholder")}
                rows={3}
                className="text-sm resize-none"
              />
            </div>

            {/* Signers */}
            <div className="space-y-2">
              <Label className="text-xs">{t("esignSignersLabel")} *</Label>
              {esignSigners.map((signer, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-start">
                  <div>
                    <Input
                      value={signer.fullName}
                      onChange={(e) => updateSigner(idx, "fullName", e.target.value)}
                      placeholder={t("esignSignerFullName")}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Input
                      value={signer.email}
                      onChange={(e) => updateSigner(idx, "email", e.target.value)}
                      placeholder={t("esignSignerEmail")}
                      type="email"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <select
                      value={signer.role}
                      onChange={(e) => updateSigner(idx, "role", e.target.value)}
                      className="h-8 rounded border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="signer">{t("esignRoleSigner")}</option>
                      <option value="cc">{t("esignRoleCc")}</option>
                      <option value="copy">{t("esignRoleCopy")}</option>
                    </select>
                  </div>
                  <div>
                    {esignSigners.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeSigner(idx)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {esignSigners.length < 10 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={addSigner}
                >
                  <Plus className="h-3 w-3 mr-1" /> {t("esignAddSigner")}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{t("esignEmailBestEffort")}</p>

            {esignError && (
              <p className="text-sm text-destructive">{esignError}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEsignDialogOpen(false)} disabled={esignLoading}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSendForSignature} disabled={esignLoading}>
              {esignLoading ? t("esignSending") : t("esignSendForSignature")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Signing Links Dialog (shown after successful send) ────── */}
      <Dialog open={esignLinksDialogOpen} onOpenChange={setEsignLinksDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" /> {t("esignLinksTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("esignLinksDesc")}</p>
            {esignLinks.map((link) => (
              <div key={link.signerId} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{link.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{link.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0"
                    onClick={() => handleCopyLink(link.signerId, link.signingLink)}
                  >
                    {copiedLinks[link.signerId] ? (
                      <><Check className="h-3 w-3 mr-1 text-green-600" />{t("esignCopied")}</>
                    ) : (
                      <><Copy className="h-3 w-3 mr-1" />{t("esignCopyLink")}</>
                    )}
                  </Button>
                </div>
                <p className="text-xs font-mono text-muted-foreground break-all">{link.signingLink}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEsignLinksDialogOpen(false)}>
              {tc("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deviations Section (Slice 4c) ────────────────────────── */}
      {(() => {
        const criticalCount = deviations.filter(d => d.severity === "critical" && d.status === "flagged").length
        const warningCount  = deviations.filter(d => d.severity === "warning"  && d.status === "flagged").length
        const infoCount     = deviations.filter(d => d.severity === "info"     && d.status === "flagged").length
        const openCount     = criticalCount + warningCount + infoCount

        const typeLabel = (dt: string) => {
          const map: Record<string, string> = {
            high_risk:    t("deviationsTypeLabelHighRisk"),
            fallback:     t("deviationsTypeLabelFallback"),
            retired:      t("deviationsTypeLabelRetired"),
            non_standard: t("deviationsTypeLabelNonStandard"),
          }
          return map[dt] ?? dt
        }
        const severityLabel = (s: string) => {
          const map: Record<string, string> = {
            critical: t("deviationsSeverityCritical"),
            warning:  t("deviationsSeverityWarning"),
            info:     t("deviationsSeverityInfo"),
          }
          return map[s] ?? s
        }
        const statusLabel = (s: string) => {
          const map: Record<string, string> = {
            flagged:      t("deviationsStatusFlagged"),
            acknowledged: t("deviationsStatusAcknowledged"),
            waived:       t("deviationsStatusWaived"),
          }
          return map[s] ?? s
        }
        const severityVariant = (s: string): "destructive" | "default" | "secondary" => {
          if (s === "critical") return "destructive"
          if (s === "warning")  return "default"
          return "secondary"
        }

        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  {t("deviationsSectionTitle")}
                  {openCount > 0 && (
                    <span className="text-xs font-normal text-destructive">
                      ({criticalCount > 0 ? `${criticalCount} critical` : ""}
                       {warningCount > 0  ? `${criticalCount > 0 ? ", " : ""}${warningCount} warning` : ""}
                       {infoCount > 0     ? `${(criticalCount + warningCount) > 0 ? ", " : ""}${infoCount} info` : ""})
                    </span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    onClick={fetchDeviations}
                    disabled={deviationsLoading}
                    title={t("esignRefresh")}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${deviationsLoading ? "animate-spin" : ""}`} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleRescan}
                    disabled={deviationsRescanning}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${deviationsRescanning ? "animate-spin" : ""}`} />
                    {deviationsRescanning ? t("deviationsRescanning") : t("deviationsRescan")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {deviationsLoading ? (
                <div className="animate-pulse h-8 bg-muted rounded" />
              ) : deviations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("deviationsEmpty")}</p>
              ) : (
                <div className="space-y-2">
                  {deviations.map((flag) => (
                    <div
                      key={flag.id}
                      className="border rounded-lg p-3 space-y-2 text-sm"
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge variant={severityVariant(flag.severity)} className="text-[10px] shrink-0">
                          {severityLabel(flag.severity)}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {typeLabel(flag.deviationType)}
                        </Badge>
                        <span className="font-medium flex-1 min-w-0 break-words">{flag.clauseTitle}</span>
                        <Badge
                          variant={flag.status === "flagged" ? "destructive" : "secondary"}
                          className="text-[10px] shrink-0"
                        >
                          {statusLabel(flag.status)}
                        </Badge>
                      </div>
                      {flag.waivedReason && (
                        <p className="text-xs text-muted-foreground pl-1">
                          {t("deviationsWaiveReasonLabel")}: {flag.waivedReason}
                        </p>
                      )}
                      {flag.status === "flagged" && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => handleDeviationAction(flag.id, "acknowledge")}
                          >
                            <Check className="h-3 w-3 mr-1" />
                            {t("deviationsAcknowledge")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            onClick={() => openWaiveDialog(flag.id)}
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t("deviationsWaive")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* ── Revenue Recognition Panel (Slice 5b-2) — admin/manager only ── */}
      {isFinanceUser && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                {t("rrTitle")}
                {pos.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    ({pos.length})
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={fetchPos}
                  disabled={posLoading}
                  title="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${posLoading ? "animate-spin" : ""}`} />
                </Button>
                {pos.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleRrRecalculate}
                    disabled={posRecalcLoading}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${posRecalcLoading ? "animate-spin" : ""}`} />
                    {posRecalcLoading ? t("rrRecalculating") : t("rrRecalculate")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={openRrDialog}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("rrAddObligation")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {posError && (
              <p className="text-xs text-destructive">{posError}</p>
            )}
            {posLoading ? (
              <div className="py-4 flex justify-center">
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : pos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rrEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {pos.map((po: any) => {
                  const poStatusLabel: Record<string, string> = {
                    draft:       t("rrPoStatusDraft"),
                    scheduled:   t("rrPoStatusScheduled"),
                    in_progress: t("rrPoStatusInProgress"),
                    completed:   t("rrPoStatusCompleted"),
                    cancelled:   t("rrPoStatusCancelled"),
                  }
                  const methodLabel: Record<string, string> = {
                    point_in_time:           t("rrMethodPointInTime"),
                    over_time_straight_line: t("rrMethodStraightLine"),
                    milestone:               t("rrMethodMilestone"),
                    usage_based:             t("rrMethodUsageBased"),
                  }
                  const schedStatusLabel: Record<string, string> = {
                    scheduled:            t("rrSchedStatusScheduled"),
                    partially_recognized: t("rrSchedStatusPartial"),
                    recognized:           t("rrSchedStatusRecognized"),
                    cancelled:            t("rrSchedStatusCancelled"),
                  }
                  const isExpanded = expandedPoId === po.id
                  const schedData  = poSchedules[po.id]
                  const schedLoading = poSchedulesLoading[po.id]

                  return (
                    <div key={po.id} className="border rounded-md overflow-hidden">
                      {/* PO header row */}
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => handlePoExpand(po.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          }
                          <span className="text-sm font-medium truncate">{po.description}</span>
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            {methodLabel[po.recognitionMethod] ?? po.recognitionMethod}
                          </Badge>
                          <Badge
                            variant={po.status === "completed" ? "default" : po.status === "cancelled" ? "destructive" : "secondary"}
                            className="text-xs flex-shrink-0"
                          >
                            {poStatusLabel[po.status] ?? po.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2 text-xs text-muted-foreground">
                          {po.scheduleSummary && (
                            <>
                              <span>{t("rrPoAllocated")}: {po.allocatedAmount ?? "—"}</span>
                              <span>{po.scheduleSummary.lineCount} {t("rrPoSchedules")}</span>
                            </>
                          )}
                        </div>
                      </button>

                      {/* Expanded: schedule lines + entry log */}
                      {isExpanded && (
                        <div className="border-t px-3 pb-3 pt-2 space-y-3 bg-muted/20">
                          {schedLoading ? (
                            <div className="flex justify-center py-3">
                              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : schedData ? (
                            <>
                              {/* Schedule lines table */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">{t("rrPoSchedules")}</p>
                                {schedData.schedules && schedData.schedules.length > 0 ? (
                                  <div className="overflow-auto">
                                    <table className="w-full text-xs border-collapse">
                                      <thead>
                                        <tr className="border-b text-muted-foreground">
                                          <th className="text-left py-1 pr-2">{t("rrScheduledLabel")}</th>
                                          <th className="text-right py-1 pr-2">{t("rrScheduledAmount")}</th>
                                          <th className="text-right py-1">{t("rrPoStatus")}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {schedData.schedules.map((s: any) => (
                                          <tr key={s.id} className="border-b last:border-0">
                                            <td className="py-1 pr-2 text-muted-foreground">
                                              {s.label ?? (
                                                `${new Date(s.periodStart).toLocaleDateString()} – ${new Date(s.periodEnd).toLocaleDateString()}`
                                              )}
                                            </td>
                                            <td className="py-1 pr-2 text-right font-mono">
                                              {String(s.scheduledAmount)}
                                            </td>
                                            <td className="py-1 text-right">
                                              <Badge
                                                variant={s.status === "recognized" ? "default" : s.status === "cancelled" ? "destructive" : "secondary"}
                                                className="text-xs"
                                              >
                                                {schedStatusLabel[s.status] ?? s.status}
                                              </Badge>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">{t("rrPoNoSchedules")}</p>
                                )}
                              </div>

                              {/* Recognition entries log */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">{t("rrPoEntries")}</p>
                                {schedData.schedules && schedData.schedules.some((s: any) => s.entries?.length > 0) ? (
                                  <div className="overflow-auto">
                                    <table className="w-full text-xs border-collapse">
                                      <thead>
                                        <tr className="border-b text-muted-foreground">
                                          <th className="text-left py-1 pr-2">{t("rrPostedAt")}</th>
                                          <th className="text-right py-1 pr-2">{t("rrRecognizedAmount")}</th>
                                          <th className="text-left py-1">{t("rrPostedBy")}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {schedData.schedules.flatMap((s: any) =>
                                          (s.entries ?? []).map((e: any) => (
                                            <tr key={e.id} className="border-b last:border-0">
                                              <td className="py-1 pr-2 text-muted-foreground">
                                                {new Date(e.postedAt).toLocaleDateString()}
                                              </td>
                                              <td className="py-1 pr-2 text-right font-mono">
                                                {String(e.recognizedAmount)}
                                              </td>
                                              <td className="py-1 text-muted-foreground">
                                                {e.postedBy ?? "—"}
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">{t("rrPoNoEntries")}</p>
                                )}
                              </div>
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── AI Insights Panel (Slice 6a) ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              {t("aiInsightsTitle")}
              {aiExtraction && aiExtraction.status === "completed" && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({aiExtraction.extractedClauses.length} {t("aiInsightsClausesTitle").toLowerCase()},
                  {" "}{aiExtraction.extractedObligations.length} {t("aiInsightsObligationsTitle").toLowerCase()})
                </span>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleAiExtract}
              disabled={aiExtracting}
            >
              <Sparkles className={`h-3 w-3 mr-1 ${aiExtracting ? "animate-pulse" : ""}`} />
              {aiExtracting ? t("aiInsightsExtracting") : t("aiInsightsExtract")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiExtractionError && (
            <p className="text-xs text-destructive">{aiExtractionError}</p>
          )}
          {!aiExtraction ? (
            <p className="text-sm text-muted-foreground">{t("aiInsightsEmpty")}</p>
          ) : aiExtraction.status === "failed" ? (
            <p className="text-sm text-destructive">{t("aiInsightsError")}</p>
          ) : (
            <>
              {/* Meta: model + timestamp + token info */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{t("aiInsightsModel")}: <span className="font-mono">{aiExtraction.model}</span></span>
                <span>{t("aiInsightsLastExtracted")}: {new Date(aiExtraction.createdAt).toLocaleString()}</span>
                {aiExtraction.promptTokens != null && aiExtraction.completionTokens != null && (
                  <span>
                    {t("aiInsightsTokens", {
                      prompt: aiExtraction.promptTokens,
                      completion: aiExtraction.completionTokens,
                    })}
                  </span>
                )}
              </div>

              {/* Clauses */}
              {aiExtraction.extractedClauses.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                    {t("aiInsightsClausesTitle")}
                  </p>
                  <div className="space-y-2">
                    {aiExtraction.extractedClauses.map((clause, idx) => {
                      const riskVariant = (r: string): "destructive" | "default" | "secondary" =>
                        r === "high" ? "destructive" : r === "medium" ? "default" : "secondary"
                      const riskLabel = (r: string) => {
                        const map: Record<string, string> = {
                          low:     t("aiInsightsRiskLow"),
                          medium:  t("aiInsightsRiskMedium"),
                          high:    t("aiInsightsRiskHigh"),
                          unknown: t("aiInsightsRiskUnknown"),
                        }
                        return map[r] ?? r
                      }
                      return (
                        <div key={idx} className="border rounded-lg p-3 space-y-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium flex-1 min-w-0 break-words">{clause.title}</span>
                            <Badge variant="secondary" className="text-[10px] shrink-0 capitalize">
                              {categoryLabel(clause.category)}
                            </Badge>
                            <Badge variant={riskVariant(clause.inferredRiskLevel)} className="text-[10px] shrink-0">
                              {riskLabel(clause.inferredRiskLevel)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                            {clause.text}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Obligations */}
              {aiExtraction.extractedObligations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                    {t("aiInsightsObligationsTitle")}
                  </p>
                  <div className="space-y-2">
                    {aiExtraction.extractedObligations.map((obl, idx) => (
                      <div key={idx} className="border rounded-lg p-3 space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium flex-1 min-w-0 break-words">{obl.label}</span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{partyLabel(obl.party)}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                          {obl.dueDateText && (
                            <span><span className="font-medium text-foreground">{t("aiInsightsDue")}:</span> {obl.dueDateText}</span>
                          )}
                          {obl.condition && (
                            <span><span className="font-medium text-foreground">{t("aiInsightsCondition")}:</span> {obl.condition}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Risk Score Panel (Slice 6b) ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              {t("aiRiskScoreTitle")}
              {aiRiskScore && aiRiskScore.status === "completed" && (
                <Badge
                  variant={
                    aiRiskScore.overallRisk === "high"
                      ? "destructive"
                      : aiRiskScore.overallRisk === "medium"
                      ? "default"
                      : "secondary"
                  }
                  className="text-[10px] capitalize ml-1"
                >
                  {aiRiskScore.overallRisk === "high"
                    ? t("aiRiskScoreHigh")
                    : aiRiskScore.overallRisk === "medium"
                    ? t("aiRiskScoreMedium")
                    : t("aiRiskScoreLow")}
                </Badge>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleAiScoreRisk}
              disabled={aiScoring || !aiExtraction || aiExtraction.status !== "completed"}
              title={!aiExtraction || aiExtraction.status !== "completed" ? t("aiRiskScoreNeedsExtraction") : undefined}
            >
              <ShieldAlert className={`h-3 w-3 mr-1 ${aiScoring ? "animate-pulse" : ""}`} />
              {aiScoring ? t("aiRiskScoreScoring") : t("aiRiskScoreScore")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiScoringError && (
            <p className="text-xs text-destructive">{aiScoringError}</p>
          )}
          {!aiRiskScore ? (
            <p className="text-sm text-muted-foreground">{t("aiRiskScoreEmpty")}</p>
          ) : aiRiskScore.status === "failed" ? (
            <p className="text-sm text-destructive">{t("aiRiskScoreError")}</p>
          ) : (
            <>
              {/* Meta row */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{t("aiInsightsModel")}: <span className="font-mono">{aiRiskScore.model}</span></span>
                <span>{t("aiInsightsLastExtracted")}: {new Date(aiRiskScore.createdAt).toLocaleString()}</span>
                {aiRiskScore.deviationFlagsCreated != null && aiRiskScore.deviationFlagsCreated > 0 && (
                  <span className="text-amber-600 font-medium">
                    {t("aiRiskScoreFlagsCreated", { count: aiRiskScore.deviationFlagsCreated })}
                  </span>
                )}
                {aiRiskScore.promptTokens != null && aiRiskScore.completionTokens != null && (
                  <span>
                    {t("aiInsightsTokens", {
                      prompt: aiRiskScore.promptTokens,
                      completion: aiRiskScore.completionTokens,
                    })}
                  </span>
                )}
              </div>

              {/* Per-clause scores */}
              {aiRiskScore.clauseScores.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                    {t("aiRiskScoreClausesTitle")}
                  </p>
                  <div className="space-y-2">
                    {aiRiskScore.clauseScores.map((cs, idx) => {
                      const riskVariant = (r: string): "destructive" | "default" | "secondary" =>
                        r === "high_risk" ? "destructive" : r === "fallback" || r === "non_standard" ? "default" : "secondary"
                      const devTypeLabel = (d: string | null) => {
                        if (!d) return null
                        const map: Record<string, string> = {
                          high_risk:    t("deviationsTypeLabelHighRisk"),
                          fallback:     t("deviationsTypeLabelFallback"),
                          retired:      t("deviationsTypeLabelRetired"),
                          non_standard: t("deviationsTypeLabelNonStandard"),
                        }
                        return map[d] ?? d
                      }
                      return (
                        <div
                          key={idx}
                          className={`border rounded-lg p-3 space-y-1.5 text-sm ${
                            cs.deviationType === "high_risk" || cs.deviationType === "retired"
                              ? "border-destructive/40 bg-destructive/5"
                              : cs.deviationType === "fallback" || cs.deviationType === "non_standard"
                              ? "border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10"
                              : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium flex-1 min-w-0 break-words">{cs.clauseTitle}</span>
                            <Badge variant={riskVariant(cs.riskLevel)} className="text-[10px] shrink-0 capitalize">
                              {scoringRiskLabel(cs.riskLevel)}
                            </Badge>
                            {cs.deviationType && (
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {devTypeLabel(cs.deviationType)}
                              </Badge>
                            )}
                          </div>
                          {cs.rationale && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {cs.rationale}
                            </p>
                          )}
                          {cs.suggestedFallbackClauseId && (
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                              {t("aiRiskScoreSuggestedFallback")}: <span className="font-mono">{cs.suggestedFallbackClauseId}</span>
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Link to deviations panel */}
              {aiRiskScore.deviationFlagsCreated != null && aiRiskScore.deviationFlagsCreated > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("aiRiskScoreDeviationsHint")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Reindex for AI Search (Slice 6c) ─────────────────────────────── */}
      {isFinanceUser && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                {t("reindexTitle")}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleAiReindex}
                disabled={aiReindexing}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${aiReindexing ? "animate-spin" : ""}`} />
                {aiReindexing ? t("reindexing") : t("reindexBtn")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("reindexDesc")}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Add Obligation Dialog (Slice 5b-2) ──────────────────────────── */}
      <Dialog open={rrDialogOpen} onOpenChange={setRrDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("rrAddObligationTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">{t("rrPoDescription")} *</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={rrDesc}
                onChange={(e) => setRrDesc(e.target.value)}
                placeholder="e.g. Software license — Year 1"
              />
            </div>
            <div>
              <Label className="text-xs">{t("rrPoMethod")}</Label>
              <select
                className="mt-1 w-full h-8 text-sm border rounded px-2 bg-background"
                value={rrMethod}
                onChange={(e) => setRrMethod(e.target.value as typeof rrMethod)}
              >
                <option value="point_in_time">{t("rrMethodPointInTime")}</option>
                <option value="over_time_straight_line">{t("rrMethodStraightLine")}</option>
                <option value="milestone">{t("rrMethodMilestone")}</option>
                <option value="usage_based">{t("rrMethodUsageBased")}</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">{t("rrPoSsp")}</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={rrSsp}
                onChange={(e) => setRrSsp(e.target.value)}
                placeholder="e.g. 5000.00"
                type="text"
                inputMode="decimal"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t("rrPoPeriodStart")} *</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  type="date"
                  value={rrPeriodStart}
                  onChange={(e) => setRrPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("rrPoPeriodEnd")} *</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  type="date"
                  value={rrPeriodEnd}
                  onChange={(e) => setRrPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            {rrMethod === "milestone" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">{t("rrAddMilestonesLabel")}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-2"
                    onClick={() => setRrMilestones((s) => [...s, {label:"",weight:"1",dueAt:""}])}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {t("rrAddMilestone")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {rrMilestones.map((m, idx) => (
                    <div key={idx} className="flex gap-1 items-start">
                      <div className="flex-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder={t("rrMilestoneLabel")}
                          value={m.label}
                          onChange={(e) => setRrMilestones((s) => s.map((x, i) => i === idx ? {...x, label: e.target.value} : x))}
                        />
                      </div>
                      <div className="w-16">
                        <Input
                          className="h-7 text-xs"
                          placeholder={t("rrMilestoneWeight")}
                          value={m.weight}
                          type="number"
                          min="1"
                          onChange={(e) => setRrMilestones((s) => s.map((x, i) => i === idx ? {...x, weight: e.target.value} : x))}
                        />
                      </div>
                      <div className="w-32">
                        <Input
                          className="h-7 text-xs"
                          type="date"
                          value={m.dueAt}
                          onChange={(e) => setRrMilestones((s) => s.map((x, i) => i === idx ? {...x, dueAt: e.target.value} : x))}
                        />
                      </div>
                      {rrMilestones.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => setRrMilestones((s) => s.filter((_, i) => i !== idx))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t("rrAddMilestonesHint")}</p>
              </div>
            )}
            {rrDialogError && (
              <p className="text-xs text-destructive">{rrDialogError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRrDialogOpen(false)}>
              {t("rrCancel")}
            </Button>
            <Button size="sm" onClick={handleRrSave} disabled={rrSaving}>
              {rrSaving ? t("rrSaving") : t("rrSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Milestones Panel (Slice 5a) ──────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              {t("milestonesTitle")}
              {milestones.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({milestones.filter(m => m.status !== "completed" && m.status !== "cancelled").length} open)
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={fetchMilestones}
                disabled={milestonesLoading}
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${milestonesLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={openAddMilestone}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("milestonesAdd")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {milestonesLoading ? (
            <div className="animate-pulse h-8 bg-muted rounded" />
          ) : milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("milestonesEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {milestones.map((m) => {
                const isOverdue = m.status !== "completed" && m.status !== "cancelled" && new Date(m.dueAt) < new Date()
                const statusVariant = (s: string): "default" | "secondary" | "destructive" => {
                  if (s === "completed")  return "default"
                  if (s === "cancelled")  return "secondary"
                  if (s === "in_progress") return "default"
                  return "secondary"
                }
                const statusLabel = (s: string) => {
                  const map: Record<string, string> = {
                    pending:     t("milestonesStatusPending"),
                    in_progress: t("milestonesStatusInProgress"),
                    completed:   t("milestonesStatusCompleted"),
                    cancelled:   t("milestonesStatusCancelled"),
                  }
                  return map[s] ?? s
                }
                return (
                  <div
                    key={m.id}
                    className={`border rounded-lg p-3 space-y-1.5 text-sm ${isOverdue ? "border-destructive/40 bg-destructive/5" : ""}`}
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <Badge variant={statusVariant(m.status)} className="text-[10px] shrink-0">
                        {statusLabel(m.status)}
                      </Badge>
                      {isOverdue && (
                        <Badge variant="destructive" className="text-[10px] shrink-0">
                          <Flag className="h-2.5 w-2.5 mr-0.5" />
                          {t("milestonesOverdue")}
                        </Badge>
                      )}
                      <span className="font-medium flex-1">{m.label}</span>
                    </div>
                    {m.description && (
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(m.dueAt).toLocaleDateString()}
                      </span>
                      {m.ownerUserId && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {m.ownerUserId}
                        </span>
                      )}
                      {m.completedAt && (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3 text-green-600" />
                          {new Date(m.completedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 pt-0.5">
                      {m.status !== "completed" && m.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:hover:bg-green-900/20"
                          onClick={() => handleMarkComplete(m.id)}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          {t("milestonesMarkComplete")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => openEditMilestone(m)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        {tc("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleDeleteMilestone(m.id)}
                        disabled={milestoneDeleteLoading === m.id}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        {tc("delete")}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit Milestone Dialog (Slice 5a) ───────────────── */}
      <Dialog
        open={milestoneDialogOpen}
        onOpenChange={(open) => {
          if (!milestoneSaving) {
            setMilestoneDialogOpen(open)
            if (!open) setMilestoneError(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              {milestoneEditTarget ? t("milestonesEditTitle") : t("milestonesAddTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("milestonesLabelLabel")} *</Label>
              <Input
                value={milestoneLabel}
                onChange={(e) => setMilestoneLabel(e.target.value)}
                placeholder={t("milestonesLabelPlaceholder")}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("milestonesDescLabel")}</Label>
              <Textarea
                value={milestoneDesc}
                onChange={(e) => setMilestoneDesc(e.target.value)}
                placeholder={t("milestonesDescPlaceholder")}
                rows={3}
                className="text-sm resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("milestonesDueLabel")} *</Label>
                <Input
                  type="date"
                  value={milestoneDueAt}
                  onChange={(e) => setMilestoneDueAt(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("milestonesStatusLabel")}</Label>
                <Select
                  value={milestoneStatus}
                  onChange={(e) => setMilestoneStatus(e.target.value)}
                  className="h-8 text-sm"
                >
                  <option value="pending">{t("milestonesStatusPending")}</option>
                  <option value="in_progress">{t("milestonesStatusInProgress")}</option>
                  <option value="completed">{t("milestonesStatusCompleted")}</option>
                  <option value="cancelled">{t("milestonesStatusCancelled")}</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("milestonesOwnerLabel")}</Label>
              <Input
                value={milestoneOwner}
                onChange={(e) => setMilestoneOwner(e.target.value)}
                placeholder={t("milestonesOwnerNone")}
                className="h-8 text-sm"
              />
            </div>
            {milestoneError && (
              <p className="text-sm text-destructive">{milestoneError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setMilestoneDialogOpen(false); setMilestoneError(null) }}
              disabled={milestoneSaving}
            >
              {t("milestonesCancel")}
            </Button>
            <Button onClick={handleSaveMilestone} disabled={milestoneSaving}>
              {milestoneSaving ? t("milestonesSaving") : t("milestonesSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Waive Reason Dialog ───────────────────────────────────── */}
      <Dialog open={waiveOpen} onOpenChange={(open) => { if (!waiveLoading) setWaiveOpen(open) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("deviationsWaiveDialogTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("deviationsWaiveReasonLabel")}</Label>
              <Textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder={t("deviationsWaiveReasonPlaceholder")}
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWaiveOpen(false)} disabled={waiveLoading}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={handleWaiveConfirm}
              disabled={waiveLoading}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {t("deviationsWaiveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Document Dialog ─────────────────────────────────── */}
      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> {t("viewDocument")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto min-h-0 py-2">
            {contract?.renderedBody?.trim() ? (
              <pre className="text-sm whitespace-pre-wrap break-words leading-relaxed max-h-[60vh] overflow-auto rounded-md bg-muted/50 p-4 border">
                {contract.renderedBody}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("viewDocumentEmpty")}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDocOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => window.open(`/api/v1/contracts/${params.id}/pdf?download=1`, "_blank")}
            >
              {t("versionsDownloadPdf")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Amendment Dialog (Slice 4a) ──────────────────────────── */}
      <Dialog
        open={amendOpen}
        onOpenChange={(open) => {
          if (!amendLoading) {
            setAmendOpen(open)
            if (!open) setAmendError(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePen className="h-5 w-5" /> {t("amendDialogTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{t("amendDialogDesc")}</p>

            {/* Optional: update title */}
            <div className="space-y-1">
              <Label className="text-xs">{t("amendTitleLabel")}</Label>
              <Input
                value={amendTitle}
                onChange={(e) => setAmendTitle(e.target.value)}
                placeholder={contract?.title ?? ""}
                className="h-8 text-sm"
              />
            </div>

            {/* Amended document body */}
            <div className="space-y-1">
              <Label className="text-xs">{t("amendBodyLabel")} *</Label>
              <Textarea
                value={amendBody}
                onChange={(e) => setAmendBody(e.target.value)}
                placeholder={t("amendBodyPlaceholder")}
                rows={14}
                className="text-sm font-mono resize-y"
              />
            </div>

            {/* Change note */}
            <div className="space-y-1">
              <Label className="text-xs">{t("amendNoteLabel")}</Label>
              <Input
                value={amendNote}
                onChange={(e) => setAmendNote(e.target.value)}
                placeholder={t("amendNotePlaceholder")}
                className="h-8 text-sm"
              />
            </div>

            {amendError && (
              <p className="text-sm text-destructive">{amendError}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setAmendOpen(false); setAmendError(null) }}
              disabled={amendLoading}
            >
              {tc("cancel")}
            </Button>
            <Button onClick={handleAmend} disabled={amendLoading}>
              {amendLoading ? t("amendSaving") : t("amendSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Diff Dialog ──────────────────────────────────────────── */}
      <Dialog open={diffOpen} onOpenChange={(open) => { setDiffOpen(open); if (!open) setDiffTooLarge(false) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4" />
              {(() => {
                const from = versions.find((v) => v.id === diffFrom)
                const to = versions.find((v) => v.id === diffTo)
                return from && to
                  ? t("versionsDiffTitle", { from: from.versionNo, to: to.versionNo })
                  : t("versionsTitle")
              })()}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto min-h-0">
            {diffTooLarge ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("versionsDiffTooLarge")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("versionsDiffTooLargeHint")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { window.open(`/api/v1/contracts/${params.id}/pdf?download=1`, "_blank") }}
                >
                  {t("versionsDownloadPdf")}
                </Button>
              </div>
            ) : diffChunks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("versionsDiffEmpty")}
              </p>
            ) : (
              <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                {diffChunks.map((chunk, idx) => {
                  if (chunk.type === "removed") {
                    return (
                      <span key={idx} className="block bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 px-2">
                        {"- "}{chunk.text}
                      </span>
                    )
                  }
                  if (chunk.type === "added") {
                    return (
                      <span key={idx} className="block bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2">
                        {"+ "}{chunk.text}
                      </span>
                    )
                  }
                  return (
                    <span key={idx} className="block text-muted-foreground px-2">
                      {"  "}{chunk.text}
                    </span>
                  )
                })}
              </pre>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffOpen(false)}>
              {tc("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
