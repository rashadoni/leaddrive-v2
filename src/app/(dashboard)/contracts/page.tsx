"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate as formatDateIntl } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { ColorStatCard } from "@/components/color-stat-card"
import { ContractForm } from "@/components/contract-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Select } from "@/components/ui/select"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { FileText, Plus, Pencil, Trash2, AlertTriangle, Clock, TrendingUp, Building2, History, X, Upload, Download, File, Loader2, Handshake, User, Receipt, CheckSquare, FileDown, Layers, Sparkles, Search, Eye } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"

interface AuditEntry {
  id: string
  action: string
  oldValue: any
  newValue: any
  createdAt: string
  userId?: string
}

interface ContractFile {
  id: string
  fileName: string
  originalName: string
  fileSize: number
  mimeType: string
  createdAt: string
}

interface ContractTag {
  id: string
  name: string
  color?: string | null
}

interface Contract {
  id: string
  contractNumber: string
  title: string
  companyId?: string
  company?: { id: string; name: string } | null
  dealId?: string
  deal?: { id: string; name: string } | null
  contactId?: string
  contact?: { id: string; fullName?: string; name?: string } | null
  type?: string
  status: string
  startDate?: string
  endDate?: string
  valueAmount?: number
  currency: string
  notes?: string
  createdAt: string
  updatedAt: string
  history?: AuditEntry[]
  tags?: ContractTag[]
  /** CLM Slice 4c: open (flagged) deviation flags for list indicator */
  deviationFlags?: { id: string; severity: string }[]
}

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  expired: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  renewed: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  renewing: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  terminated: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
}

function formatDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return "—"
  return formatDateIntl(dateStr, locale, { day: "2-digit", month: "short", year: "numeric" })
}

function daysUntilExpiry(endDate?: string): number | null {
  if (!endDate) return null
  const diff = new Date(endDate).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// Module-scope types + helpers — defined here (not inside the component) to
// avoid re-allocation on every render and to keep the component body lean.
interface ApprovalStageInput { label: string; assigneeRole: string }
const defaultApprovalStage = (): ApprovalStageInput => ({ label: "", assigneeRole: "" })

export default function ContractsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [contracts, setContracts] = useState<Contract[]>([])
  useAutoTour("contracts")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Contract | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("date_desc")
  const [detailContract, setDetailContract] = useState<Contract | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFiles, setDetailFiles] = useState<ContractFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [detailInvoices, setDetailInvoices] = useState<any[]>([])
  const orgId = session?.user?.organizationId

  // Tags (CLM Slice 4b-1)
  const [orgTags, setOrgTags] = useState<ContractTag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [newTagColor, setNewTagColor] = useState("")
  const [tagCreating, setTagCreating] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  // Advanced filters (CLM Slice 4b-1 + 4c)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filterValueMin, setFilterValueMin] = useState("")
  const [filterValueMax, setFilterValueMax] = useState("")
  const [filterStartFrom, setFilterStartFrom] = useState("")
  const [filterStartTo, setFilterStartTo] = useState("")
  const [filterEndFrom, setFilterEndFrom] = useState("")
  const [filterEndTo, setFilterEndTo] = useState("")
  const [filterType, setFilterType] = useState("")
  // CLM Slice 4c: filter contracts with open deviations
  const [filterHasDeviations, setFilterHasDeviations] = useState(false)

  // CLM Slice 6c: AI semantic search state
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticQuery, setSemanticQuery] = useState("")
  const [semanticResults, setSemanticResults] = useState<Array<{
    contractId: string
    contractNumber: string
    title: string
    status: string
    valueAmount: number | null
    currency: string
    similarity: number
  }> | null>(null)
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [semanticError, setSemanticError] = useState<string | null>(null)

  const handleSemanticSearch = async () => {
    if (!semanticQuery.trim()) return
    setSemanticLoading(true)
    setSemanticError(null)
    setSemanticResults(null)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const res = await fetch("/api/v1/contracts/search/semantic", {
        method: "POST",
        headers,
        body: JSON.stringify({ query: semanticQuery.trim(), limit: 10, threshold: 0.3 }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSemanticError(json.error || t("semanticSearchError"))
        return
      }
      setSemanticResults(json.results || [])
    } catch {
      setSemanticError(t("semanticSearchError"))
    } finally {
      setSemanticLoading(false)
    }
  }

  // Count active advanced filters
  const advancedActiveCount = [filterValueMin, filterValueMax, filterStartFrom, filterStartTo, filterEndFrom, filterEndTo, filterType, filterHasDeviations ? "1" : ""].filter(Boolean).length

  // Saved views (CLM Slice 4b-2) — active filter snapshot for SavedViewBar
  const currentFiltersSnapshot = useMemo(
    () => ({
      search: activeFilter,   // the status tab selection is the primary "search" filter
      status: activeFilter,
      tagIds: selectedTagIds,
      valueMin: filterValueMin,
      valueMax: filterValueMax,
      startFrom: filterStartFrom,
      startTo: filterStartTo,
      endFrom: filterEndFrom,
      endTo: filterEndTo,
      type: filterType,
      hasDeviations: filterHasDeviations,
      sort: sortBy,
    }),
    [activeFilter, selectedTagIds, filterValueMin, filterValueMax, filterStartFrom, filterStartTo, filterEndFrom, filterEndTo, filterType, filterHasDeviations, sortBy],
  )

  const applySavedView = useCallback((view: SavedView) => {
    const f = view.filters as Record<string, unknown>
    if (typeof f.status === "string") setActiveFilter(f.status)
    if (Array.isArray(f.tagIds)) setSelectedTagIds(f.tagIds as string[])
    if (typeof f.valueMin === "string") setFilterValueMin(f.valueMin)
    if (typeof f.valueMax === "string") setFilterValueMax(f.valueMax)
    if (typeof f.startFrom === "string") setFilterStartFrom(f.startFrom)
    if (typeof f.startTo === "string") setFilterStartTo(f.startTo)
    if (typeof f.endFrom === "string") setFilterEndFrom(f.endFrom)
    if (typeof f.endTo === "string") setFilterEndTo(f.endTo)
    if (typeof f.type === "string") setFilterType(f.type)
    if (typeof f.hasDeviations === "boolean") setFilterHasDeviations(f.hasDeviations)
    if (typeof f.sort === "string") setSortBy(f.sort)
    // Trigger a re-fetch after state settles
    setTimeout(() => fetchContracts(), 0)
  }, []) // fetchContracts is stable across renders (no deps change it)

  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  const handleApplySavedView = useCallback((view: SavedView) => {
    setActiveViewId(view.id)
    applySavedView(view)
  }, [applySavedView])

  // ── New-from-template dialog state ───────────────────────────────────────
  interface TemplateOption { id: string; name: string; variables: any[]; defaultContractType: string }
  interface TemplateVarValue { [key: string]: string }

  const [fromTemplateOpen, setFromTemplateOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateOption | null>(null)
  const [templateVarValues, setTemplateVarValues] = useState<TemplateVarValue>({})
  const [fromTemplateCompanyId, setFromTemplateCompanyId] = useState("")
  const [fromTemplateDealId, setFromTemplateDealId] = useState("")
  const [fromTemplateTitle, setFromTemplateTitle] = useState("")
  const [fromTemplateContractNumber, setFromTemplateContractNumber] = useState("")
  const [fromTemplateContactId, setFromTemplateContactId] = useState("")
  const [fromTemplateStartDate, setFromTemplateStartDate] = useState("")
  const [fromTemplateEndDate, setFromTemplateEndDate] = useState("")
  const [fromTemplateValueAmount, setFromTemplateValueAmount] = useState("")
  const [fromTemplateCurrency, setFromTemplateCurrency] = useState("")
  const [fromTemplateGenerating, setFromTemplateGenerating] = useState(false)
  const [fromTemplateError, setFromTemplateError] = useState<string | null>(null)
  // Companies + deals + contacts for pickers (reuse from contract-form pattern)
  const [ftCompanies, setFtCompanies] = useState<{ id: string; name: string }[]>([])
  const [ftDeals, setFtDeals] = useState<{ id: string; name: string }[]>([])
  const [ftContacts, setFtContacts] = useState<{ id: string; fullName: string | null }[]>([])

  const openFromTemplate = async () => {
    setFromTemplateOpen(true)
    setFromTemplateError(null)
    setSelectedTemplate(null)
    setTemplateVarValues({})
    setFromTemplateCompanyId("")
    setFromTemplateDealId("")
    setFromTemplateTitle("")
    setFromTemplateContractNumber("")
    setFromTemplateContactId("")
    setFromTemplateStartDate("")
    setFromTemplateEndDate("")
    setFromTemplateValueAmount("")
    setFromTemplateCurrency("")
    if (templates.length === 0) {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

      // 1) The template list is the ONLY thing gating the picker. Load it on its
      //    own — previously it shared a single Promise.all with the three heavy
      //    company/deal/contact lists, so a slow or hung helper request left the
      //    select stuck on "Yüklənir…" forever even though the templates were ready.
      setTemplatesLoading(true)
      try {
        const tRes = await fetch("/api/v1/contract-templates?limit=200&active=true", { headers })
        const tJson = tRes.ok ? await tRes.json() : null
        if (tJson?.success) setTemplates(tJson.data?.templates || tJson.data || [])
      } catch {
        /* non-fatal — the picker just shows no options; user can reopen to retry */
      } finally {
        setTemplatesLoading(false)
      }

      // 2) Prefetch the OPTIONAL company/deal/contact pickers without gating the
      //    template select — fault-tolerant so one failing/slow list can't hang
      //    the dialog. (deals caps limit at 200 server-side → the old 500 was a
      //    guaranteed 400, leaving the deal picker silently empty.)
      void (async () => {
        const safe = async (url: string) => {
          try {
            const r = await fetch(url, { headers })
            return r.ok ? await r.json() : null
          } catch {
            return null
          }
        }
        const [c, d, ct] = await Promise.all([
          safe("/api/v1/companies?limit=500&category=all"),
          safe("/api/v1/deals?limit=500"),
          safe("/api/v1/contacts?limit=500"),
        ])
        if (c?.success) setFtCompanies(c.data?.companies || [])
        if (d?.success) setFtDeals(d.data?.deals || [])
        if (ct?.success) setFtContacts(ct.data?.contacts || [])
      })()
    }
  }

  const handleFromTemplateGenerate = async () => {
    if (!selectedTemplate) { setFromTemplateError(t("fromTemplateSelectRequired")); return }
    setFromTemplateGenerating(true)
    setFromTemplateError(null)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const res = await fetch(`/api/v1/contract-templates/${selectedTemplate.id}/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          variables: templateVarValues,
          ...(fromTemplateCompanyId ? { companyId: fromTemplateCompanyId } : {}),
          ...(fromTemplateDealId ? { dealId: fromTemplateDealId } : {}),
          ...(fromTemplateContactId ? { contactId: fromTemplateContactId } : {}),
          ...(fromTemplateTitle.trim() ? { title: fromTemplateTitle.trim() } : {}),
          ...(fromTemplateContractNumber.trim() ? { contractNumber: fromTemplateContractNumber.trim() } : {}),
          ...(fromTemplateStartDate ? { startDate: fromTemplateStartDate } : {}),
          ...(fromTemplateEndDate ? { endDate: fromTemplateEndDate } : {}),
          ...(fromTemplateValueAmount.trim() && !isNaN(parseFloat(fromTemplateValueAmount))
            ? { valueAmount: parseFloat(fromTemplateValueAmount) }
            : {}),
          ...(fromTemplateCurrency.trim() ? { currency: fromTemplateCurrency.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        const missing = json.missingVars?.length > 0 ? ` (${t("missingVars")}: ${json.missingVars.join(", ")})` : ""
        setFromTemplateError((json.error || t("fromTemplateGenerateFailed")) + missing)
        return
      }
      setFromTemplateOpen(false)
      toast.success(t("contractCreated"))
      fetchContracts()
    } catch {
      setFromTemplateError(t("fromTemplateGenerateFailed"))
    } finally {
      setFromTemplateGenerating(false)
    }
  }

  // Submit-for-approval dialog state (lives here so the panel can open it)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalStages, setApprovalStages] = useState<ApprovalStageInput[]>([defaultApprovalStage()])
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  const addStage = () => { if (approvalStages.length < 5) setApprovalStages(s => [...s, defaultApprovalStage()]) }
  const removeStage = (idx: number) => setApprovalStages(s => s.filter((_, i) => i !== idx))
  const updateStage = (idx: number, field: keyof ApprovalStageInput, value: string) =>
    setApprovalStages(s => s.map((st, i) => i === idx ? { ...st, [field]: value } : st))

  const handleSubmitForApproval = async () => {
    if (!detailContract) return
    if (approvalStages.some(s => !s.label.trim())) {
      setApprovalError(t("approvalStageLabelRequired"))
      return
    }
    setApprovalLoading(true)
    setApprovalError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${detailContract.id}/submit-for-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: approvalStages.map(s => ({
            label: s.label.trim(),
            ...(s.assigneeRole.trim() ? { assigneeRole: s.assigneeRole.trim() } : {}),
          })),
        }),
      })
      const json = await res.json()
      if (!json.success) { setApprovalError(json.error || t("approvalSubmitError")); return }
      setApprovalOpen(false)
      setApprovalStages([defaultApprovalStage()])
      // Refresh both the panel and the list
      await openDetail(detailContract)
      fetchContracts()
    } catch {
      setApprovalError(t("approvalSubmitError"))
    } finally {
      setApprovalLoading(false)
    }
  }

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

  const typeLabels: Record<string, string> = {
    service_agreement: t("typeService"),
    nda: t("typeNda"),
    maintenance: t("typeMaintenance"),
    license: t("typeLicense"),
    sla: t("typeSla"),
    other: t("typeOther"),
  }

  const fieldLabels: Record<string, string> = {
    contractNumber: t("number"),
    title: t("name"),
    companyId: t("company"),
    type: t("type"),
    status: t("status"),
    startDate: t("startDate"),
    endDate: t("endDate"),
    valueAmount: t("amount"),
    currency: t("currency"),
    notes: t("notes"),
  }

  const fetchContracts = async () => {
    try {
      const params = new URLSearchParams({ limit: "500" })
      if (selectedTagIds.length > 0) params.set("tagIds", selectedTagIds.join(","))
      if (filterValueMin) params.set("valueMin", filterValueMin)
      if (filterValueMax) params.set("valueMax", filterValueMax)
      if (filterStartFrom) params.set("startFrom", filterStartFrom)
      if (filterStartTo) params.set("startTo", filterStartTo)
      if (filterEndFrom) params.set("endFrom", filterEndFrom)
      if (filterEndTo) params.set("endTo", filterEndTo)
      if (filterType) params.set("type", filterType)
      if (filterHasDeviations) params.set("hasDeviations", "true")

      const res = await fetch(`/api/v1/contracts?${params.toString()}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setContracts(json.data.contracts)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const fetchOrgTags = async () => {
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const res = await fetch("/api/v1/contract-tags", { headers })
      const json = await res.json()
      if (json.success) setOrgTags(json.data)
    } catch { /* non-fatal */ }
  }

  useEffect(() => { fetchContracts(); fetchOrgTags() }, [session])

  async function openDetail(contract: Contract) {
    setDetailContract(contract)
    setDetailLoading(true)
    setDetailFiles([])
    setDetailInvoices([])
    try {
      const headers = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>
      const [contractRes, filesRes, invoicesRes] = await Promise.all([
        fetch(`/api/v1/contracts/${contract.id}`, { headers }),
        fetch(`/api/v1/contracts/${contract.id}/files`, { headers }),
        fetch(`/api/v1/invoices?contractId=${contract.id}&limit=50`, { headers }),
      ])
      const contractJson = await contractRes.json()
      if (contractJson.success) setDetailContract(contractJson.data)
      const filesJson = await filesRes.json()
      if (filesJson.success) setDetailFiles(filesJson.data)
      const invoicesJson = await invoicesRes.json()
      if (invoicesJson.success) setDetailInvoices(invoicesJson.data?.invoices || invoicesJson.data || [])
    } catch (err) { console.error(err) } finally { setDetailLoading(false) }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    setTagCreating(true)
    setTagError(null)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const body: Record<string, string> = { name: newTagName.trim() }
      if (newTagColor.match(/^#[0-9a-fA-F]{6}$/)) body.color = newTagColor
      const res = await fetch("/api/v1/contract-tags", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setTagError(json.error || t("tagCreateError")); return }
      toast.success(t("tagCreateSuccess"))
      setNewTagName("")
      setNewTagColor("")
      await fetchOrgTags()
    } catch {
      setTagError(t("tagCreateError"))
    } finally {
      setTagCreating(false)
    }
  }

  const handleDeleteTag = async (tagId: string, tagName: string) => {
    if (!confirm(t("tagDeleteConfirm", { name: tagName }))) return
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      await fetch(`/api/v1/contract-tags/${tagId}`, { method: "DELETE", headers })
      toast.success(t("tagDeleteSuccess"))
      setSelectedTagIds(prev => prev.filter(id => id !== tagId))
      await fetchOrgTags()
      fetchContracts()
    } catch { /* non-fatal */ }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !detailContract) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/api/v1/contracts/${detailContract.id}/files`, {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Upload failed")
      setDetailFiles(prev => [json.data, ...prev])
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  async function handleFileDelete(fileId: string) {
    if (!detailContract || !confirm("Delete file?")) return
    try {
      await fetch(`/api/v1/contracts/${detailContract.id}/files/${fileId}`, {
        method: "DELETE",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      setDetailFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) { console.error(err) }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/contracts/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchContracts()
  }

  // Filter + sort
  const filtered = contracts.filter(c => {
    if (activeFilter === "all") return true
    if (activeFilter === "expiring_soon") return isExpiringSoon(c)
    return c.status === activeFilter
  }).sort((a, b) => {
    switch (sortBy) {
      case "date_desc": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case "date_asc": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      case "value_desc": return (b.valueAmount || 0) - (a.valueAmount || 0)
      case "value_asc": return (a.valueAmount || 0) - (b.valueAmount || 0)
      case "expiry": return new Date(a.endDate || "9999").getTime() - new Date(b.endDate || "9999").getTime()
      case "company": return (a.company?.name || "zzz").localeCompare(b.company?.name || "zzz")
      default: return 0
    }
  })

  const liveContracts = contracts.filter(c => c.status === "active" || c.status === "renewing")

  function isExpiringSoon(c: Contract) {
    const days = daysUntilExpiry(c.endDate)
    return days !== null && days > 0 && days <= 90 && ["active", "renewing"].includes(c.status)
  }

  // Stats
  const activeCount = liveContracts.length
  const totalValue = liveContracts.reduce((s, c) => s + (c.valueAmount || 0), 0)
  const avgValue = activeCount > 0 ? Math.round(totalValue / activeCount) : 0

  const expiringSoon = contracts.filter(isExpiringSoon).length

  const expiredCount = contracts.filter(c => c.status === "expired").length

  // MRR calculation (active contracts / their duration in months)
  const mrr = liveContracts.reduce((sum, c) => {
    if (!c.valueAmount || !c.startDate || !c.endDate) return sum
    const months = Math.max(1, Math.ceil((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    return sum + c.valueAmount / months
  }, 0)

  // Status counts for filter tabs
  const statusCounts: Record<string, number> = {}
  for (const c of contracts) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
  }

  const columns = [
    {
      key: "contractNumber",
      label: t("number"),
      sortable: true,
      hint: t("hintColNumber"),
      render: (item: any) => <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{item.contractNumber}</span>,
    },
    {
      key: "title", label: t("name"), sortable: true,
      render: (item: any) => (
        <span className="font-medium text-foreground line-clamp-2 max-w-[280px]" title={item.title}>{item.title}</span>
      ),
    },
    {
      key: "company",
      label: t("company"),
      sortable: true,
      render: (item: any) => (
        <div className="flex items-center gap-1.5">
          {item.company ? (
            <>
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm line-clamp-1">{item.company.name}</span>
            </>
          ) : <span className="text-muted-foreground/40">—</span>}
        </div>
      ),
    },
    {
      key: "type", label: t("type"), sortable: true, hint: t("hintColType"),
      render: (item: any) => <span className="text-sm">{typeLabels[item.type] || item.type || "—"}</span>,
    },
    {
      key: "valueAmount", label: t("amount"), sortable: true, hint: t("hintColAmount"),
      render: (item: any) => (
        <span className="font-medium tabular-nums whitespace-nowrap">
          {item.valueAmount ? `${item.valueAmount.toLocaleString()} ${item.currency}` : <span className="text-muted-foreground/40">—</span>}
        </span>
      ),
    },
    {
      key: "status", label: t("status"), sortable: true, hint: t("hintColStatus"),
      render: (item: any) => (
        <span className={cn("inline-block whitespace-nowrap text-xs px-2.5 py-1 rounded-md font-medium", statusColors[item.status] || "bg-muted")}>
          {statusLabels[item.status] || item.status}
        </span>
      ),
    },
    {
      key: "deviationFlags",
      label: "",
      sortable: false,
      className: "w-8",
      render: (item: any) => {
        const flags = item.deviationFlags as { id: string; severity: string }[] | undefined
        const hasCritical = flags?.some((f) => f.severity === "critical") ?? false
        if (!flags || flags.length === 0) return null
        return (
          <span
            title={t("deviationsIndicatorTitle")}
            className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold ${hasCritical ? "bg-destructive text-destructive-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}
          >
            {flags.length}
          </span>
        )
      },
    },
    {
      key: "endDate", label: t("endDate"), sortable: true, hint: t("hintColDates"),
      render: (item: any) => {
        const days = daysUntilExpiry(item.endDate)
        const isExpiring = days !== null && days > 0 && days <= 90
        const isExpired = days !== null && days <= 0
        return (
          <div className={cn(
            "flex items-center gap-1 text-sm",
            isExpired && item.status !== "renewed" && "text-red-500 font-medium",
            isExpiring && "text-orange-500 font-medium"
          )}>
            {isExpiring && <AlertTriangle className="h-3 w-3" />}
            {formatDate(item.endDate, locale)}
            {isExpiring && <span className="text-[10px]">({days}d)</span>}
          </div>
        )
      },
    },
    {
      key: "actions", label: "", className: "w-28",
      render: (item: any) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); openDetail(item) }}
            className="p-1.5 rounded hover:bg-muted"
            title={t("quickView")}
          >
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => { setEditData(item); setShowForm(true) }} className="p-1.5 rounded hover:bg-muted" title={t("editContract")}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => { setDeleteId(item.id); setDeleteName(item.title) }} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={t("deleteContract")}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
          </button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-6">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="contracts" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton slug="contracts" variant="label" />
          <a
            href={`/api/v1/contracts/export${(() => {
              const p = new URLSearchParams()
              if (selectedTagIds.length > 0) p.set("tagIds", selectedTagIds.join(","))
              if (filterValueMin) p.set("valueMin", filterValueMin)
              if (filterValueMax) p.set("valueMax", filterValueMax)
              if (filterStartFrom) p.set("startFrom", filterStartFrom)
              if (filterStartTo) p.set("startTo", filterStartTo)
              if (filterEndFrom) p.set("endFrom", filterEndFrom)
              if (filterEndTo) p.set("endTo", filterEndTo)
              if (filterType) p.set("type", filterType)
              if (filterHasDeviations) p.set("hasDeviations", "true")
              if (activeFilter !== "all" && activeFilter !== "expiring_soon") p.set("status", activeFilter)
              return p.toString() ? `?${p.toString()}` : ""
            })()}`}
            download
            className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors font-medium"
            title={t("exportXlsx")}
          >
            <Download className="h-4 w-4" />
            {t("exportXlsx")}
          </a>
          <Button variant="outline" onClick={openFromTemplate}>
            <Layers className="h-4 w-4 mr-1" /> {t("newFromTemplate")}
          </Button>
          <Button onClick={() => { setEditData(undefined); setShowForm(true) }} data-tour-id="contracts-new">
            <Plus className="h-4 w-4 mr-1" /> {t("newContract")}
          </Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="contracts" className="mb-4" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-tour-id="contracts-stats">
        <ColorStatCard label={t("statTotal")} value={total} icon={<FileText className="h-4 w-4" />} hint={t("hintTotalContracts")} />
        <ColorStatCard label={t("statActive")} value={activeCount} icon={<FileText className="h-4 w-4" />} hint={t("hintActiveContracts")} />
        <ColorStatCard label={t("statTotalAmount")} value={`${totalValue.toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} hint={t("hintContractValue")} />
        <ColorStatCard label={t("statMrr")} value={`${Math.round(mrr).toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} />
        <ColorStatCard label={t("statAvgValue")} value={`${avgValue.toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} />
        <ColorStatCard label={t("statExpiringSoon")} value={expiringSoon} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintExpiringSoon")} />
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>
          {t("filterAll")} ({total})
        </Button>
        {(["draft", "pending_approval", "approved", "active", "renewing", "renewed", "expired", "terminated", "rejected", "cancelled"] as const).map(key => (
          statusCounts[key] ? (
            <Button key={key} variant={activeFilter === key ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(key)}>
              {statusLabels[key]} ({statusCounts[key]})
            </Button>
          ) : null
        ))}
        <Button
          variant={activeFilter === "expiring_soon" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("expiring_soon")}
          className={cn(expiringSoon > 0 && activeFilter !== "expiring_soon" && "border-orange-300 text-orange-600")}
        >
          <AlertTriangle className="h-3 w-3 mr-1" /> {t("filterExpiring90d")} ({expiringSoon})
        </Button>
      </div>

      {/* Sort */}
      <div className="flex justify-end">
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[200px]">
          <option value="date_desc">{t("sortNewest")}</option>
          <option value="date_asc">{t("sortOldest")}</option>
          <option value="value_desc">{t("sortAmountDesc")}</option>
          <option value="value_asc">{t("sortAmountAsc")}</option>
          <option value="expiry">{t("sortByExpiry")}</option>
          <option value="company">{t("sortByCompany")}</option>
        </Select>
      </div>

      {/* Saved views bar (CLM Slice 4b-2) */}
      <SavedViewBar
        entityType="contracts"
        currentFilters={currentFiltersSnapshot}
        onApply={handleApplySavedView}
        onDefaultLoad={applySavedView}
      />

      {/* Tag filter bar */}
      {orgTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("tagFilterLabel")}:</span>
          {orgTags.map(tag => (
            <button
              key={tag.id}
              onClick={() => setSelectedTagIds(prev =>
                prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
              )}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                selectedTagIds.includes(tag.id)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-muted hover:border-muted-foreground"
              )}
              style={tag.color && !selectedTagIds.includes(tag.id) ? {
                borderColor: tag.color + "66",
                color: tag.color,
                backgroundColor: tag.color + "11",
              } : undefined}
            >
              {tag.name}
            </button>
          ))}
          {selectedTagIds.length > 0 && (
            <button
              onClick={() => { setSelectedTagIds([]); setTimeout(() => fetchContracts(), 0) }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> {t("advancedFiltersClear")}
            </button>
          )}
        </div>
      )}

      {/* Advanced filter toggle + manage tags */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdvancedOpen(prev => !prev)}
          className={cn(
            "text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors",
            advancedActiveCount > 0
              ? "border-primary text-primary bg-primary/5"
              : "border-muted text-muted-foreground hover:border-muted-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          {t("advancedFilters")}
          {advancedActiveCount > 0 && (
            <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full">
              {advancedActiveCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTagManageOpen(prev => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t("tagManageTitle")}
        </button>
        {advancedActiveCount > 0 && (
          <button
            onClick={() => {
              setFilterValueMin(""); setFilterValueMax("")
              setFilterStartFrom(""); setFilterStartTo("")
              setFilterEndFrom(""); setFilterEndTo("")
              setFilterType("")
              setFilterHasDeviations(false)
              setTimeout(() => fetchContracts(), 0)
            }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="h-3 w-3" /> {t("advancedFiltersClear")}
          </button>
        )}
      </div>

      {/* Advanced filter panel */}
      {advancedOpen && (
        <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterValueMin")}</Label>
              <Input type="number" value={filterValueMin} onChange={e => setFilterValueMin(e.target.value)} className="h-8 text-sm" placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterValueMax")}</Label>
              <Input type="number" value={filterValueMax} onChange={e => setFilterValueMax(e.target.value)} className="h-8 text-sm" placeholder="∞" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterStartFrom")}</Label>
              <Input type="date" value={filterStartFrom} onChange={e => setFilterStartFrom(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterStartTo")}</Label>
              <Input type="date" value={filterStartTo} onChange={e => setFilterStartTo(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterEndFrom")}</Label>
              <Input type="date" value={filterEndFrom} onChange={e => setFilterEndFrom(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterEndTo")}</Label>
              <Input type="date" value={filterEndTo} onChange={e => setFilterEndTo(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">{t("filterType")}</Label>
              <Select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full">
                <option value="">{t("filterTypeAll")}</option>
                <option value="service_agreement">{t("typeService")}</option>
                <option value="nda">{t("typeNda")}</option>
                <option value="maintenance">{t("typeMaintenance")}</option>
                <option value="license">{t("typeLicense")}</option>
                <option value="sla">{t("typeSla")}</option>
                <option value="other">{t("typeOther")}</option>
              </Select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="hasDeviationsToggle"
                type="checkbox"
                checked={filterHasDeviations}
                onChange={e => setFilterHasDeviations(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="hasDeviationsToggle" className="text-xs text-muted-foreground cursor-pointer select-none">
                {t("hasDeviationsFilter")}
              </Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              setFilterValueMin(""); setFilterValueMax("")
              setFilterStartFrom(""); setFilterStartTo("")
              setFilterEndFrom(""); setFilterEndTo("")
              setFilterType("")
              setFilterHasDeviations(false)
            }}>
              {t("advancedFiltersClear")}
            </Button>
            <Button size="sm" onClick={() => { setAdvancedOpen(false); fetchContracts() }}>
              {t("advancedFiltersApply")}
            </Button>
          </div>
        </div>
      )}

      {/* Tag management panel */}
      {tagManageOpen && (
        <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
          <h3 className="text-sm font-semibold">{t("tagManageTitle")}</h3>
          <div className="flex flex-wrap gap-2">
            {orgTags.length === 0 && <p className="text-xs text-muted-foreground">{t("tagNone")}</p>}
            {orgTags.map(tag => (
              <div key={tag.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-background">
                {tag.color && <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: tag.color }} />}
                <span>{tag.name}</span>
                <button
                  onClick={() => handleDeleteTag(tag.id, tag.name)}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                  aria-label={t("tagChipAriaRemove")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("tagCreateLabel")}</Label>
              <Input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder={t("tagCreatePlaceholder")}
                className="h-8 text-sm w-48"
                onKeyDown={e => { if (e.key === "Enter") handleCreateTag() }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("tagColorLabel")}</Label>
              <Input
                type="color"
                value={newTagColor || "#4f46e5"}
                onChange={e => setNewTagColor(e.target.value)}
                className="h-8 w-14 px-1 cursor-pointer"
              />
            </div>
            <Button size="sm" onClick={handleCreateTag} disabled={tagCreating || !newTagName.trim()}>
              {tagCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("tagCreateBtn")}
            </Button>
          </div>
          {tagError && <p className="text-xs text-destructive">{tagError}</p>}
        </div>
      )}

      {/* CLM Slice 6c: AI Semantic Search */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setSemanticMode(prev => !prev)
            if (semanticMode) { setSemanticResults(null); setSemanticQuery(""); setSemanticError(null) }
          }}
          className={cn(
            "text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors",
            semanticMode
              ? "border-primary text-primary bg-primary/5"
              : "border-muted text-muted-foreground hover:border-muted-foreground"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("semanticSearchToggle")}
        </button>
      </div>

      {semanticMode && (
        <div className="p-4 border rounded-lg bg-muted/10 space-y-3">
          <p className="text-xs text-muted-foreground">{t("semanticSearchDesc")}</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder={t("semanticSearchPlaceholder")}
                value={semanticQuery}
                onChange={e => setSemanticQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSemanticSearch() }}
              />
            </div>
            <Button size="sm" onClick={handleSemanticSearch} disabled={semanticLoading || !semanticQuery.trim()}>
              {semanticLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><Sparkles className="h-3.5 w-3.5 mr-1" />{t("semanticSearchBtn")}</>
              }
            </Button>
          </div>
          {semanticError && <p className="text-xs text-destructive">{semanticError}</p>}
          {semanticResults !== null && (
            <div className="space-y-2">
              {semanticResults.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("semanticSearchEmpty")}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t("semanticSearchResults", { count: semanticResults.length })}</p>
                  <div className="divide-y rounded-md border bg-background">
                    {semanticResults.map(r => (
                      <button
                        key={r.contractId}
                        className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                        onClick={() => {
                          const c = contracts.find(x => x.id === r.contractId)
                          if (c) openDetail(c)
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.title}</p>
                          <p className="text-xs text-muted-foreground">{r.contractNumber} · {statusLabels[r.status] || r.status}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-xs font-medium text-primary">
                            {Math.round(r.similarity * 100)}% {t("semanticSearchSimilarity")}
                          </span>
                          {r.valueAmount && (
                            <p className="text-xs text-muted-foreground">
                              {r.valueAmount.toLocaleString()} {r.currency}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <DataTable columns={columns as any} data={filtered as any} searchPlaceholder={t("searchLabelExtended")} searchKey="title" onRowClick={(row: any) => router.push(`/contracts/${row.id}`)} />

      <ContractForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchContracts}
        initialData={editData as any}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteContract")}
        itemName={deleteName}
      />

      {/* Submit-for-approval dialog */}
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5" /> {t("submitForApprovalTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("submitForApprovalDesc")}</p>
            {approvalStages.map((stage, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("approvalStageLabel", { num: idx + 1 })}</Label>
                  <Input value={stage.label} onChange={e => updateStage(idx, "label", e.target.value)}
                    placeholder={t("approvalStagePlaceholder")} className="h-8 text-sm" />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("approvalStageRole")}</Label>
                  <Input value={stage.assigneeRole} onChange={e => updateStage(idx, "assigneeRole", e.target.value)}
                    placeholder={t("approvalStageRolePlaceholder")} className="h-8 text-sm" />
                </div>
                {approvalStages.length > 1 && (
                  <button type="button" onClick={() => removeStage(idx)}
                    className="mt-5 p-1 rounded hover:text-destructive text-muted-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {approvalStages.length < 5 && (
              <button type="button" onClick={addStage}
                className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
                <Plus className="h-3 w-3" /> {t("addStage")}
              </button>
            )}
            {approvalError && <p className="text-sm text-destructive">{approvalError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApprovalOpen(false)} disabled={approvalLoading}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSubmitForApproval} disabled={approvalLoading}>
              {approvalLoading ? t("approvalSubmitting") : t("submitForApprovalTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New from template dialog */}
      <Dialog open={fromTemplateOpen} onOpenChange={setFromTemplateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" /> {t("newFromTemplate")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Template picker */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("fromTemplateSelectLabel")}</Label>
              {templatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</div>
              ) : (
                <Select
                  value={selectedTemplate?.id || ""}
                  onChange={e => {
                    const tmpl = templates.find(t => t.id === e.target.value) || null
                    setSelectedTemplate(tmpl)
                    setTemplateVarValues({})
                    setFromTemplateTitle(tmpl?.name || "")
                  }}
                  className="w-full"
                >
                  <option value="">{t("fromTemplatePlaceholder")}</option>
                  {templates.map(tmpl => (
                    <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                  ))}
                </Select>
              )}
            </div>

            {/* Variables form — rendered when a template is selected */}
            {selectedTemplate && selectedTemplate.variables.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fromTemplateVariables")}</p>
                {selectedTemplate.variables.map((v: any) => (
                  <div key={v.name} className="space-y-1">
                    <Label className="text-xs font-medium">
                      {v.label || v.name}{v.required ? " *" : ""}
                    </Label>
                    <p className="text-xs text-muted-foreground -mt-0.5">
                      {"{{"}{v.name}{"}}"}
                      {v.type !== "string" && <span className="ml-1">· {v.type}</span>}
                    </p>
                    <Input
                      type={v.type === "number" ? "number" : v.type === "date" ? "date" : "text"}
                      placeholder={v.placeholder || (v.default !== undefined ? String(v.default) : "")}
                      value={templateVarValues[v.name] || ""}
                      onChange={e => setTemplateVarValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Optional fields */}
            {selectedTemplate && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fromTemplateOptionalFields")}</p>
                {/* Contract number */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("fromTemplateContractNumber")}</Label>
                  <Input
                    value={fromTemplateContractNumber}
                    onChange={e => setFromTemplateContractNumber(e.target.value)}
                    placeholder="məs. GT-CSR-CNT-260056"
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{t("fromTemplateContractNumberHint")}</p>
                </div>
                {/* Title */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("name")}</Label>
                  <Input
                    value={fromTemplateTitle}
                    onChange={e => setFromTemplateTitle(e.target.value)}
                    placeholder={selectedTemplate.name}
                    className="h-8 text-sm"
                  />
                </div>
                {/* Company + Deal */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("company")}</Label>
                    <Select value={fromTemplateCompanyId} onChange={e => setFromTemplateCompanyId(e.target.value)} className="w-full">
                      <option value="">—</option>
                      {ftCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("deal")}</Label>
                    <Select value={fromTemplateDealId} onChange={e => setFromTemplateDealId(e.target.value)} className="w-full">
                      <option value="">—</option>
                      {ftDeals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Select>
                  </div>
                </div>
                {/* Contact */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("fromTemplateContact")}</Label>
                  <Select value={fromTemplateContactId} onChange={e => setFromTemplateContactId(e.target.value)} className="w-full">
                    <option value="">—</option>
                    {ftContacts.map(c => <option key={c.id} value={c.id}>{c.fullName || c.id}</option>)}
                  </Select>
                </div>
                {/* Start + End date */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("fromTemplateStartDate")}</Label>
                    <Input
                      type="date"
                      value={fromTemplateStartDate}
                      onChange={e => setFromTemplateStartDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("fromTemplateEndDate")}</Label>
                    <Input
                      type="date"
                      value={fromTemplateEndDate}
                      onChange={e => setFromTemplateEndDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                {/* Amount + Currency */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("fromTemplateValue")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={fromTemplateValueAmount}
                      onChange={e => setFromTemplateValueAmount(e.target.value)}
                      placeholder="məs. 3569.40"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("fromTemplateCurrency")}</Label>
                    <Select value={fromTemplateCurrency} onChange={e => setFromTemplateCurrency(e.target.value)} className="w-full">
                      <option value="">—</option>
                      <option value="AZN">AZN</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {fromTemplateError && <p className="text-sm text-destructive">{fromTemplateError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFromTemplateOpen(false)} disabled={fromTemplateGenerating}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleFromTemplateGenerate} disabled={fromTemplateGenerating || !selectedTemplate}>
              {fromTemplateGenerating ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{t("generating")}</> : t("generateContract")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Panel */}
      {detailContract && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetailContract(null)}>
          <div className="w-full max-w-lg bg-background shadow-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">{t("title")} #{detailContract.contractNumber}</h2>
                <button onClick={() => setDetailContract(null)} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-semibold">{detailContract.title}</h3>
                  {detailContract.company && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <Building2 className="h-3.5 w-3.5" /> {detailContract.company.name}
                    </p>
                  )}
                  {detailContract.deal && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Handshake className="h-3.5 w-3.5" /> {t("linkedDeal")}: {detailContract.deal.name}
                    </p>
                  )}
                  {detailContract.contact && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <User className="h-3.5 w-3.5" /> {t("linkedContact")}: {detailContract.contact.fullName || detailContract.contact.name}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("status")}</div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block", statusColors[detailContract.status])}>
                      {statusLabels[detailContract.status] || detailContract.status}
                    </span>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("type")}</div>
                    <div className="font-medium mt-1">{typeLabels[detailContract.type || ""] || detailContract.type || "—"}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("amount")}</div>
                    <div className="font-bold mt-1">{detailContract.valueAmount ? `${detailContract.valueAmount.toLocaleString()} ${detailContract.currency}` : "—"}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">{t("startDate")} — {t("endDate")}</div>
                    <div className="font-medium mt-1">{formatDate(detailContract.startDate, locale)} — {formatDate(detailContract.endDate, locale)}</div>
                  </div>
                </div>

                {detailContract.notes && (
                  <div className="bg-muted/50 rounded-lg p-3 text-sm">
                    <div className="text-muted-foreground text-xs mb-1">{t("notes")}</div>
                    <div>{detailContract.notes}</div>
                  </div>
                )}

                {/* Invoices */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                    <Receipt className="h-4 w-4" /> {t("invoices")} ({detailInvoices.length})
                  </h4>
                  {detailLoading ? (
                    <div className="text-sm text-muted-foreground animate-pulse">...</div>
                  ) : detailInvoices.length > 0 ? (
                    <div className="space-y-2">
                      {detailInvoices.map((inv: any) => (
                        <div key={inv.id} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2.5 text-sm">
                          <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{inv.invoiceNumber || inv.number || "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              {inv.totalAmount ? `${inv.totalAmount.toLocaleString()} ${inv.currency || "₼"}` : "—"}
                              {inv.issueDate && ` · ${formatDate(inv.issueDate, locale)}`}
                            </div>
                          </div>
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full font-medium",
                            inv.status === "paid" ? "bg-green-100 text-green-700" :
                            inv.status === "overdue" ? "bg-red-100 text-red-600" :
                            inv.status === "sent" ? "bg-blue-100 text-blue-700" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {inv.status || "draft"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">{t("noInvoicesHint")}</p>
                    </div>
                  )}
                </div>

                {/* History */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                    <History className="h-4 w-4" /> {t("history")}
                  </h4>
                  {detailLoading ? (
                    <div className="text-sm text-muted-foreground animate-pulse">...</div>
                  ) : detailContract.history && detailContract.history.length > 0 ? (
                    <div className="space-y-3">
                      {detailContract.history.map((entry: AuditEntry) => (
                        <div key={entry.id} className="border-l-2 border-primary/20 pl-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {entry.action}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          {entry.action === "update" && entry.oldValue && typeof entry.oldValue === "object" && (
                            <div className="mt-1 space-y-0.5">
                              {Object.entries(entry.oldValue as Record<string, { old: any; new: any }>).map(([field, val]) => (
                                <div key={field} className="text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{fieldLabels[field] || field}:</span>{" "}
                                  <span className="line-through text-red-400">{val.old || "—"}</span> → <span className="text-green-600">{val.new || "—"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                {/* Files */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                      <File className="h-4 w-4" /> ({detailFiles.length})
                    </h4>
                    <label className={cn(
                      "inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md cursor-pointer transition-colors",
                      "bg-primary text-primary-foreground hover:bg-primary/90",
                      uploading && "opacity-50 pointer-events-none"
                    )}>
                      {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {uploading ? "..." : <Upload className="h-3 w-3" />}
                      <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv" />
                    </label>
                  </div>
                  {detailFiles.length > 0 ? (
                    <div className="space-y-2">
                      {detailFiles.map(f => (
                        <div key={f.id} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2.5 text-sm group">
                          <File className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{f.originalName}</div>
                            <div className="text-xs text-muted-foreground">{formatFileSize(f.fileSize)} · {formatDate(f.createdAt, locale)}</div>
                          </div>
                          <a
                            href={`/uploads/contracts/${f.fileName}`}
                            download={f.originalName}
                            className="p-1 hover:bg-background rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Download className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                          <button
                            onClick={() => handleFileDelete(f.id)}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  {detailContract.status === "draft" && (
                    <Button
                      className="w-full"
                      onClick={() => { setApprovalError(null); setApprovalStages([defaultApprovalStage()]); setApprovalOpen(true) }}
                    >
                      <CheckSquare className="h-4 w-4 mr-1" /> {t("submitForApproval")}
                    </Button>
                  )}
                  <a
                    href={`/api/v1/contracts/${detailContract.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full"
                  >
                    <Button variant="outline" className="w-full">
                      <FileDown className="h-4 w-4 mr-1" /> {t("downloadPdf")}
                    </Button>
                  </a>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setEditData(detailContract); setShowForm(true); setDetailContract(null) }}>
                      <Pencil className="h-4 w-4 mr-1" /> {t("editContract")}
                    </Button>
                    <Button variant="destructive" className="flex-1" onClick={() => { setDeleteId(detailContract.id); setDeleteName(detailContract.title); setDetailContract(null) }}>
                      <Trash2 className="h-4 w-4 mr-1" /> {t("deleteContract")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
