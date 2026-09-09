"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Send,
  Download,
  Copy,
  Trash2,
  CreditCard,
  DollarSign,
  Calendar,
  Building2,
  User,
  Clock,
  Eye,
  Pencil,
  Workflow,
  Play,
  Square,
  Mail,
  MessageSquare,
  MessageCircle,
  Smartphone,
  Heart,
  Settings,
  GitBranch,
  Plus,
  Loader2,
  X,
} from "lucide-react"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"
import { HelpButton } from "@/components/help/help-button"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

// ---------- Types ----------

interface InvoiceItem {
  id: string
  name: string
  description: string | null
  quantity: number
  unitPrice: number
  discount: number
  total: number
}

interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  paymentDate: string
  createdAt: string
}

interface AuditEntry {
  id: string
  action: string
  details: string | null
  createdAt: string
  user: { name: string | null; email: string } | null
}

interface Invoice {
  id: string
  invoiceNumber: string
  title: string | null
  status: string
  issueDate: string
  dueDate: string
  paidDate: string | null
  paymentTerms: string | null
  currency: string
  subtotal: number
  discountTotal: number
  taxRate: number
  taxAmount: number
  totalAmount: number
  paidAmount: number
  balanceDue: number
  notes: string | null
  recipientEmail: string | null
  recipientVoen: string | null
  sentAt: string | null
  viewedAt: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string } | null
  contact: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
  } | null
  deal: { id: string; name: string } | null
  items: InvoiceItem[]
  payments: Payment[]
}

// ---------- Status helpers ----------

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-foreground",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-indigo-100 text-indigo-800",
  partially_paid: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-muted text-muted-foreground line-through",
  refunded: "bg-purple-100 text-purple-800",
}

const PIPELINE_STAGES = ["draft", "sent", "paid"] as const

// ---------- Sub-components ----------

function InvoicePipeline({
  currentStatus,
  t,
}: {
  currentStatus: string
  t: (key: string) => string
}) {
  const stageIndex = PIPELINE_STAGES.indexOf(
    currentStatus as (typeof PIPELINE_STAGES)[number]
  )
  const effectiveIndex =
    currentStatus === "paid" || currentStatus === "partially_paid"
      ? 2
      : currentStatus === "sent" ||
          currentStatus === "viewed" ||
          currentStatus === "overdue"
        ? 1
        : 0

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
      {PIPELINE_STAGES.map((stage, idx) => {
        const isActive =
          stage === currentStatus ||
          (stage === "sent" &&
            ["sent", "viewed", "overdue"].includes(currentStatus)) ||
          (stage === "paid" &&
            ["paid", "partially_paid"].includes(currentStatus))
        const isDone = idx < effectiveIndex

        return (
          <div key={stage} className="flex items-center flex-1 min-w-0">
            <div
              className={`
                relative flex items-center justify-center h-9 flex-1 min-w-0 px-3
                text-xs font-semibold transition-all select-none
                ${
                  isActive
                    ? "text-white shadow-sm"
                    : isDone
                      ? "text-white/90"
                      : "text-muted-foreground bg-muted/40 dark:bg-muted/20"
                }
              `}
              style={{
                background: isActive
                  ? stage === "draft"
                    ? "#6b7280"
                    : stage === "sent"
                      ? "#3b82f6"
                      : "#22c55e"
                  : isDone
                    ? (stage === "draft"
                        ? "#6b7280"
                        : stage === "sent"
                          ? "#3b82f6"
                          : "#22c55e") + "99"
                    : undefined,
                clipPath:
                  idx === 0
                    ? "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)"
                    : idx === PIPELINE_STAGES.length - 1
                      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%)"
                      : "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)",
              }}
            >
              <span className="truncate">
                {t(`status.${stage}`)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KpiCards({
  invoice,
  t,
}: {
  invoice: Invoice
  t: (key: string) => string
}) {
  const daysUntilDue = Math.ceil(
    (new Date(invoice.dueDate).getTime() - Date.now()) / 86400000
  )
  const isOverdue =
    daysUntilDue < 0 &&
    invoice.status !== "paid" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "refunded"

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            Ara cəm (ƏDV-siz)
          </div>
          <p className="text-lg font-bold">
            {fmt(invoice.subtotal)} {invoice.currency}
          </p>
          {invoice.taxAmount > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              ƏDV ({invoice.taxRate <= 1 ? Math.round(invoice.taxRate * 100) : Math.round(invoice.taxRate)}%): {fmt(invoice.taxAmount)}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="border-cyan-200 bg-cyan-50/50 dark:bg-cyan-950/30">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            {t("totalAmount")} (ƏDV daxil)
          </div>
          <p className="text-xl font-bold text-cyan-700 dark:text-cyan-400">
            {fmt(invoice.totalAmount)} {invoice.currency}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CreditCard className="h-3.5 w-3.5" />
            {t("balanceDue")}
          </div>
          <p
            className={`text-lg font-bold ${invoice.balanceDue > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {fmt(invoice.balanceDue)} {invoice.currency}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            {t("paidAmount")}
          </div>
          <p className="text-lg font-bold text-green-600">
            {fmt(invoice.paidAmount)} {invoice.currency}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Calendar className="h-3.5 w-3.5" />
            {isOverdue ? t("overdue") : t("daysUntilDue")}
          </div>
          <p
            className={`text-lg font-bold ${isOverdue ? "text-red-600" : ""}`}
          >
            {isOverdue
              ? `${Math.abs(daysUntilDue)} ${t("daysOverdue")}`
              : `${daysUntilDue} ${t("days")}`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Main page ----------

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("invoices")
  const tc = useTranslations("common")

  const orgId = (session?.user as { organizationId?: string })?.organizationId
  const invoiceId = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")

  // Dialogs
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [showSendDialog, setShowSendDialog] = useState(false)

  // Payment form
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    method: "bank_transfer",
    paymentDate: new Date().toISOString().split("T")[0],
    reference: "",
    notes: "",
  })
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState("")

  // Send form
  const [sendForm, setSendForm] = useState({
    email: "",
    subject: "",
    message: "",
  })
  const [sendLoading, setSendLoading] = useState(false)
  const [sendError, setSendError] = useState("")

  // Edit dialog
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editForm, setEditForm] = useState({
    title: "",
    issueDate: "",
    dueDate: "",
    paymentTerms: "",
    currency: "",
    voen: "",
    recipientEmail: "",
    notes: "",
  })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState("")

  // Audit log
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  // Communication chain
  const [chainData, setChainData] = useState<{
    journey: { id: string; name: string; steps: any[] } | null
    enrollment: { id: string; status: string; currentStepId: string | null; nextActionAt: string | null; enrolledAt: string } | null
  } | null>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [chainStarting, setChainStarting] = useState(false)
  const [chainStopping, setChainStopping] = useState(false)
  const [chainError, setChainError] = useState("")
  const [chainSteps, setChainSteps] = useState<any[]>([])
  const [savingSteps, setSavingSteps] = useState(false)
  const [unsavedChainChanges, setUnsavedChainChanges] = useState(false)
  const [addStepOpen, setAddStepOpen] = useState(false)
  const [newStepType, setNewStepType] = useState("send_email")
  const [newStepConfig, setNewStepConfig] = useState<any>({})

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
  }

  const fetchInvoice = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}`, { headers })
      if (!res.ok) throw new Error(tc("errorFetchFailed"))
      const json = await res.json()
      const data = json.data ?? json
      setInvoice(data)
      // Pre-fill send form
      setSendForm((prev) => ({
        ...prev,
        email: data.recipientEmail || data.contact?.email || "",
        subject: `Invoice ${data.invoiceNumber}`,
      }))
      // Pre-fill payment amount
      setPaymentForm((prev) => ({
        ...prev,
        amount: data.balanceDue,
      }))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [orgId, invoiceId])

  const fetchAuditLog = useCallback(async () => {
    if (!orgId) return
    setAuditLoading(true)
    try {
      const res = await fetch(
        `/api/v1/audit-log?entityType=invoice&entityId=${invoiceId}`,
        { headers }
      )
      if (res.ok) {
        const data = await res.json()
        setAuditLog(Array.isArray(data) ? data : data.entries || [])
      }
    } catch {
      // ignore
    } finally {
      setAuditLoading(false)
    }
  }, [orgId, invoiceId])

  useEffect(() => {
    fetchInvoice()
  }, [fetchInvoice])

  const fetchChain = useCallback(async () => {
    if (!orgId) return
    setChainLoading(true)
    setChainError("")
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/chain`, { headers })
      if (res.redirected || res.url.includes("/login")) {
        window.location.href = "/login"
        return
      }
      if (res.ok) {
        const ct = res.headers.get("content-type") || ""
        if (!ct.includes("application/json")) {
          setChainError("Sessiya bitib. Səhifəni yeniləyin.")
          return
        }
        const json = await res.json()
        setChainData(json.data)
        if (json.data?.journey?.steps) {
          setChainSteps(json.data.journey.steps)
        }
      }
    } catch {
      // ignore
    } finally {
      setChainLoading(false)
    }
  }, [orgId, invoiceId])

  useEffect(() => {
    if (activeTab === "activity") {
      fetchAuditLog()
    }
    if (activeTab === "chain") {
      fetchChain()
    }
  }, [activeTab, fetchAuditLog, fetchChain])

  // ---------- Chain actions ----------

  const chainStepTypes = [
    { value: "send_email", label: t("chainStepEmail"), icon: Mail, color: "bg-blue-500", borderColor: "border-blue-200 bg-blue-50/50 dark:bg-blue-900/10" },
    { value: "sms", label: t("chainStepSms"), icon: Smartphone, color: "bg-muted-foreground", borderColor: "border-zinc-200 dark:border-zinc-700 bg-muted/50" },
    { value: "wait", label: t("chainStepWait"), icon: Clock, color: "bg-yellow-500", borderColor: "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-900/10" },
    { value: "send_telegram", label: t("chainStepTelegram"), icon: Send, color: "bg-sky-500", borderColor: "border-sky-200 bg-sky-50/50 dark:bg-sky-900/10" },
    { value: "send_whatsapp", label: t("chainStepWhatsapp"), icon: Heart, color: "bg-green-500", borderColor: "border-green-200 bg-green-50/50 dark:bg-green-900/10" },
    { value: "condition", label: t("chainStepCondition"), icon: GitBranch, color: "bg-pink-500", borderColor: "border-pink-200 bg-pink-50/50 dark:bg-pink-900/10" },
  ]

  function getChainStepInfo(type: string) {
    return chainStepTypes.find(st => st.value === type) || chainStepTypes[0]
  }

  // Invoice condition recipes — one click, no confusion
  const invoiceConditionRecipes = [
    { id: "unpaid_restart", label: "Ödənilməyibsə → təkrarla", description: "Ödəniş gəlməyibsə zənciri əvvəldən başla", icon: "🔄", field: "invoice_status", operator: "equals", value: "sent", onTrue: "restart", onFalse: "stop" },
    { id: "paid_stop", label: "Ödənilibsə → dayandır", description: "Ödəniş gəlibsə zənciri dayandır", icon: "✅", field: "invoice_status", operator: "equals", value: "paid", onTrue: "stop", onFalse: "continue" },
    { id: "overdue_restart", label: "Gecikibsə → təkrarla", description: "Gecikmiş ödəniş — zənciri təkrarla", icon: "⏰", field: "invoice_status", operator: "equals", value: "overdue", onTrue: "restart", onFalse: "stop" },
    { id: "unpaid_continue", label: "Ödənilməyibsə → davam et", description: "Ödəniş gəlməyibsə növbəti addıma keç", icon: "➡️", field: "invoice_status", operator: "equals", value: "sent", onTrue: "continue", onFalse: "stop" },
    { id: "has_email", label: "Email varsa → davam et", description: "Email boş deyilsə növbəti addıma keç", icon: "📧", field: "email", operator: "not_empty", value: "", onTrue: "continue", onFalse: "stop" },
    { id: "has_phone", label: "Telefon varsa → davam et", description: "Telefon boş deyilsə növbəti addıma keç", icon: "📱", field: "phone", operator: "not_empty", value: "", onTrue: "continue", onFalse: "stop" },
  ]

  function getChainStepSummary(step: any): string {
    const c = step.config || {}
    switch (step.stepType) {
      case "send_email": return c.subject ? `${t("chainSubjectLabel")}: ${c.subject}` : `${t("chainSubjectLabel")}: -`
      case "wait": return `${t("chainStepWait")}: ${c.days || 1} ${c.unit || "days"}`
      case "send_telegram":
      case "send_whatsapp":
      case "sms": return c.message ? c.message.slice(0, 50) : t("chainMessageLabel")
      case "condition": {
        const recipe = invoiceConditionRecipes.find(r => r.id === c._recipe)
        if (recipe) return recipe.label
        return c.field ? `${c.field} ${c.operator} ${c.value || ""}` : t("chainStepCondition")
      }
      default: return ""
    }
  }

  async function handleSetupChain() {
    setChainError("")
    setChainLoading(true)
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/chain`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "setup" }),
      })
      if (res.redirected || res.url.includes("/login")) {
        window.location.href = "/login"
        return
      }
      const ct = res.headers.get("content-type") || ""
      if (!ct.includes("application/json")) {
        throw new Error("Sessiya bitib. Səhifəni yeniləyin.")
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      setChainData(json.data)
      setChainSteps(json.data?.journey?.steps || [])
    } catch (err: any) {
      setChainError(err.message)
    } finally {
      setChainLoading(false)
    }
  }

  async function handleSaveChainSteps() {
    if (!chainData?.journey) return
    setSavingSteps(true)
    try {
      await fetch(`/api/v1/journeys/${chainData.journey.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: chainData.journey.name,
          steps: chainSteps.map((s, i) => ({ stepType: s.stepType, stepOrder: i + 1, config: s.config })),
        }),
      })
      await fetchChain()
      setUnsavedChainChanges(false)
    } catch {
      // ignore
    } finally {
      setSavingSteps(false)
    }
  }

  async function handleStartChain() {
    setChainStarting(true)
    setChainError("")
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/chain`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "start" }),
      })
      if (res.redirected || res.url.includes("/login")) {
        window.location.href = "/login"
        return
      }
      const ct = res.headers.get("content-type") || ""
      if (!ct.includes("application/json")) {
        throw new Error("Sessiya bitib. Səhifəni yeniləyin.")
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      await fetchChain()
    } catch (err: any) {
      setChainError(err.message)
    } finally {
      setChainStarting(false)
    }
  }

  async function handleStopChain() {
    setChainStopping(true)
    try {
      await fetch(`/api/v1/invoices/${invoiceId}/chain`, { method: "DELETE", headers })
      await fetchChain()
    } finally {
      setChainStopping(false)
    }
  }

  // Payment-chain step defaults per invoice language. Previously hardcoded
  // in Azerbaijani which leaked into every tenant's UI regardless of locale.
  // Picks ru / az / en by invoice.documentLanguage (if the invoice carries a
  // preferred language) with "ru" as the default.
  const chainStepDefaultsByLang: Record<string, Record<string, any>> = {
    ru: {
      wait: { days: 1, unit: "minutes" },
      send_email: {
        subject: "Напоминание об оплате: Счёт {{invoice_number}}",
        body: "Уважаемый(ая) {{recipient_name}},\n\nНапоминаем об оплате счёта {{invoice_number}} на сумму {{amount}}.\n\nСрок оплаты: {{due_date}}\nОстаток: {{balance_due}}\n\nПожалуйста, произведите оплату в ближайшее время.\n\nС уважением",
      },
      sms: {
        message: "Напоминание: Счёт {{invoice_number}} на {{amount}} не оплачен. Остаток: {{balance_due}}. Пожалуйста, свяжитесь с нами.",
      },
      send_whatsapp: {
        message: "Здравствуйте, {{recipient_name}}! Счёт {{invoice_number}} ({{amount}}) всё ещё ожидает оплаты. Остаток: {{balance_due}}. Срок: {{due_date}}.",
      },
      send_telegram: {
        message: "Напоминание: Счёт {{invoice_number}} на {{amount}} не оплачен. Остаток: {{balance_due}}. Пожалуйста, свяжитесь с нами.",
      },
    },
    az: {
      wait: { days: 1, unit: "minutes" },
      send_email: {
        subject: "Ödəniş xatırlatması: Hesab-faktura {{invoice_number}}",
        body: "Hörmətli {{recipient_name}},\n\nHesab-faktura {{invoice_number}} məbləği {{amount}} ödənişini xatırladırıq.\n\nÖdəniş tarixi: {{due_date}}\nQalıq məbləğ: {{balance_due}}\n\nXahiş edirik ən qısa zamanda ödəniş edin.\n\nHörmətlə",
      },
      sms: {
        message: "Xatırlatma: Hesab-faktura {{invoice_number}} məbləği {{amount}} ödənilməyib. Qalıq: {{balance_due}}. Bizimlə əlaqə saxlayın.",
      },
      send_whatsapp: {
        message: "Salam, {{recipient_name}}! Hesab-faktura {{invoice_number}} ({{amount}}) hələ ödənilməyib. Qalıq: {{balance_due}}. Son tarix: {{due_date}}.",
      },
      send_telegram: {
        message: "Xatırlatma: Hesab-faktura {{invoice_number}} məbləği {{amount}} ödənilməyib. Qalıq: {{balance_due}}. Bizimlə əlaqə saxlayın.",
      },
    },
    en: {
      wait: { days: 1, unit: "minutes" },
      send_email: {
        subject: "Payment reminder: Invoice {{invoice_number}}",
        body: "Dear {{recipient_name}},\n\nThis is a reminder that invoice {{invoice_number}} for {{amount}} is due.\n\nDue date: {{due_date}}\nBalance due: {{balance_due}}\n\nPlease arrange payment at your earliest convenience.\n\nBest regards",
      },
      sms: {
        message: "Reminder: Invoice {{invoice_number}} for {{amount}} is unpaid. Balance: {{balance_due}}. Please contact us.",
      },
      send_whatsapp: {
        message: "Hello {{recipient_name}}! Invoice {{invoice_number}} ({{amount}}) is still awaiting payment. Balance: {{balance_due}}. Due: {{due_date}}.",
      },
      send_telegram: {
        message: "Reminder: Invoice {{invoice_number}} for {{amount}} is unpaid. Balance: {{balance_due}}. Please contact us.",
      },
    },
  }
  const invoiceLang = ((invoice as any)?.documentLanguage as string) || "ru"
  const chainStepDefaults: Record<string, any> =
    chainStepDefaultsByLang[invoiceLang] || chainStepDefaultsByLang.ru

  function addChainStep() {
    const defaultConfig = chainStepDefaults[newStepType] || {}
    const mergedConfig = { ...defaultConfig, ...newStepConfig }
    setChainSteps(prev => [...prev, { stepType: newStepType, stepOrder: prev.length + 1, config: mergedConfig, statsEntered: 0, statsCompleted: 0 }])
    setUnsavedChainChanges(true)
    setAddStepOpen(false)
    setNewStepType("send_email")
    setNewStepConfig({})
  }

  function removeChainStep(index: number) {
    setChainSteps(prev => prev.filter((_, i) => i !== index))
    setUnsavedChainChanges(true)
  }

  // ---------- Actions ----------

  async function handleDelete() {
    const res = await fetch(`/api/v1/invoices/${invoiceId}`, {
      method: "DELETE",
      headers,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || tc("errorDeleteFailed"))
    }
    router.push("/invoices")
  }

  async function handleDuplicate() {
    if (!orgId) return
    const res = await fetch(`/api/v1/invoices/${invoiceId}/duplicate`, {
      method: "POST",
      headers,
    })
    if (res.ok) {
      const data = await res.json()
      router.push(`/invoices/${data.id}`)
    }
  }

  function openEditDialog() {
    if (!invoice) return
    setEditForm({
      title: invoice.title || "",
      issueDate: invoice.issueDate ? invoice.issueDate.split("T")[0] : "",
      dueDate: invoice.dueDate ? invoice.dueDate.split("T")[0] : "",
      paymentTerms: invoice.paymentTerms || "",
      currency: invoice.currency || DEFAULT_CURRENCY,
      voen: invoice.recipientVoen || "",
      recipientEmail: invoice.recipientEmail || "",
      notes: invoice.notes || "",
    })
    setEditError("")
    setShowEditDialog(true)
  }

  async function handleSaveEdit() {
    setEditLoading(true)
    setEditError("")
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          title: editForm.title || null,
          issueDate: editForm.issueDate,
          dueDate: editForm.dueDate || null,
          paymentTerms: editForm.paymentTerms || null,
          currency: editForm.currency,
          voen: editForm.voen || null,
          recipientEmail: editForm.recipientEmail || null,
          notes: editForm.notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      setShowEditDialog(false)
      fetchInvoice()
    } catch (err: any) {
      setEditError(err.message)
    } finally {
      setEditLoading(false)
    }
  }

  function handleDownloadPdf(withStamp = false) {
    const url = `/api/v1/invoices/${invoiceId}/pdf${withStamp ? "?stamp=true" : ""}`
    window.open(url, "_blank")
  }

  function handleDownloadAct() {
    window.open(`/api/v1/invoices/${invoiceId}/act?format=html`, "_blank")
  }

  async function handleRecordPayment() {
    setPaymentLoading(true)
    setPaymentError("")
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amount: Number(paymentForm.amount),
          method: paymentForm.method,
          paymentDate: paymentForm.paymentDate,
          reference: paymentForm.reference || null,
          notes: paymentForm.notes || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || tc("errorUpdateFailed"))
      }
      setShowPaymentDialog(false)
      setPaymentForm({
        amount: 0,
        method: "bank_transfer",
        paymentDate: new Date().toISOString().split("T")[0],
        reference: "",
        notes: "",
      })
      fetchInvoice()
    } catch (err: any) {
      setPaymentError(err.message)
    } finally {
      setPaymentLoading(false)
    }
  }

  async function handleSendInvoice() {
    setSendLoading(true)
    setSendError("")
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          recipientEmail: sendForm.email,
          subject: sendForm.subject,
          message: sendForm.message,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || tc("errorUpdateFailed"))
      }
      setShowSendDialog(false)
      fetchInvoice()
    } catch (err: any) {
      setSendError(err.message)
    } finally {
      setSendLoading(false)
    }
  }

  // ---------- Loading / Not found ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/invoices")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("backToInvoices")}
        </Button>
      </div>
    )
  }

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/invoices")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold flex items-center gap-2">
                {invoice.invoiceNumber}
                <HelpButton slug="invoice-detail" variant="label" />
              </h1>
              <Badge className={STATUS_STYLES[invoice.status] || ""}>
                {t(`status.${invoice.status}`)}
              </Badge>
            </div>
            {invoice.title && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {invoice.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/invoices/${invoiceId}/edit`)}
          >
            <Pencil className="h-4 w-4 mr-1" />
            {tc("edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSendDialog(true)}
          >
            <Send className="h-4 w-4 mr-1" />
            {t("send")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleDownloadPdf(true)}>
            <Download className="h-4 w-4 mr-1" />
            {t("downloadPdf")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleDownloadPdf(false)}>
            <Download className="h-4 w-4 mr-1" />
            {t("downloadPdfNoStamp")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadAct}>
            <FileText className="h-4 w-4 mr-1" />
            Akt
          </Button>
          <Button variant="outline" size="sm" onClick={handleDuplicate}>
            <Copy className="h-4 w-4 mr-1" />
            {t("duplicate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {tc("delete")}
          </Button>
        </div>
      </div>

      {/* Pipeline */}
      <InvoicePipeline currentStatus={invoice.status} t={t} />

      {/* KPI Cards */}
      <KpiCards invoice={invoice} t={t} />

      <AdvisorRecordWidget entityType="invoice" entityId={invoice.id} orgId={orgId} title="Advisor risk" />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="items">{t("tabItems")}</TabsTrigger>
          <TabsTrigger value="payments">{t("tabPayments")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabActivity")}</TabsTrigger>
          <TabsTrigger value="chain" className="flex items-center gap-1.5">
            <Workflow className="h-3.5 w-3.5" />
            {t("chainTab")}
          </TabsTrigger>
          <TabsTrigger value="preview">{t("tabPreview")}</TabsTrigger>
        </TabsList>

        {/* ===== Overview Tab ===== */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Invoice Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  {t("invoiceDetails")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("invoiceNumber")}
                  </span>
                  <span className="font-medium">{invoice.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("issueDate")}
                  </span>
                  <span>
                    {new Date(invoice.issueDate).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("dueDate")}
                  </span>
                  <span>
                    {new Date(invoice.dueDate).toLocaleDateString()}
                  </span>
                </div>
                {invoice.paidDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("paidDate")}
                    </span>
                    <span>
                      {new Date(invoice.paidDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {invoice.paymentTerms && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("paymentTerms")}
                    </span>
                    <span>{t(invoice.paymentTerms as any)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("currency")}
                  </span>
                  <span>{invoice.currency}</span>
                </div>
                {invoice.deal && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("linkedDeal")}
                    </span>
                    <button
                      className="text-primary hover:underline"
                      onClick={() =>
                        router.push(`/deals/${invoice.deal!.id}`)
                      }
                    >
                      {invoice.deal.name}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Client Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {t("clientInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {invoice.company && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("company")}
                    </span>
                    <button
                      className="text-primary hover:underline"
                      onClick={() =>
                        router.push(`/companies/${invoice.company!.id}`)
                      }
                    >
                      {invoice.company.name}
                    </button>
                  </div>
                )}
                {invoice.contact && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("contact")}
                      </span>
                      <button
                        className="text-primary hover:underline"
                        onClick={() =>
                          router.push(`/contacts/${invoice.contact!.id}`)
                        }
                      >
                        {invoice.contact.fullName}
                      </button>
                    </div>
                    {invoice.contact.email && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {tc("email")}
                        </span>
                        <span>{invoice.contact.email}</span>
                      </div>
                    )}
                    {invoice.contact.phone && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {tc("phone")}
                        </span>
                        <span>{invoice.contact.phone}</span>
                      </div>
                    )}
                  </>
                )}
                {invoice.recipientEmail && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("recipientEmail")}
                    </span>
                    <span>{invoice.recipientEmail}</span>
                  </div>
                )}
                {invoice.recipientVoen && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VOEN</span>
                    <span>{invoice.recipientVoen}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {t("notes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Items Tab ===== */}
        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("itemName")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("itemDescription")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">
                        {t("qty")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">
                        {t("unitPrice")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">
                        {t("discount")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">
                        {tc("total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="text-center text-muted-foreground py-8"
                        >
                          {t("noItems")}
                        </td>
                      </tr>
                    ) : (
                      invoice.items.map((item) => (
                        <tr key={item.id} className="border-b last:border-0">
                          <td className="py-2.5 font-medium">{item.name}</td>
                          <td className="py-2.5 text-muted-foreground">
                            {item.description || "—"}
                          </td>
                          <td className="py-2.5 text-right">
                            {item.quantity}
                          </td>
                          <td className="py-2.5 text-right">
                            {item.unitPrice.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right">
                            {item.discount > 0
                              ? `${item.discount.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="py-2.5 text-right font-medium">
                            {item.total.toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              {invoice.items.length > 0 && (
                <div className="mt-4 border-t pt-4 space-y-2 max-w-xs ml-auto text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("subtotal")}
                    </span>
                    <span>
                      {invoice.subtotal.toLocaleString()} {invoice.currency}
                    </span>
                  </div>
                  {invoice.discountTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("discountTotal")}
                      </span>
                      <span className="text-red-600">
                        -{invoice.discountTotal.toLocaleString()}{" "}
                        {invoice.currency}
                      </span>
                    </div>
                  )}
                  {invoice.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("tax")} ({invoice.taxRate}%)
                      </span>
                      <span>
                        {invoice.taxAmount.toLocaleString()} {invoice.currency}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base border-t pt-2">
                    <span>{tc("total")}</span>
                    <span>
                      {invoice.totalAmount.toLocaleString()} {invoice.currency}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Payments Tab ===== */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{t("paymentHistory")}</h3>
            {invoice.balanceDue > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  setPaymentForm((prev) => ({
                    ...prev,
                    amount: invoice.balanceDue,
                    paymentDate: new Date().toISOString().split("T")[0],
                  }))
                  setShowPaymentDialog(true)
                }}
              >
                <CreditCard className="h-4 w-4 mr-1" />
                {t("recordPayment")}
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("paymentDate")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">
                        {t("amount")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("method")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("reference")}
                      </th>
                      <th className="pb-2 font-medium text-muted-foreground">
                        {t("notes")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.payments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-center text-muted-foreground py-8"
                        >
                          {t("noPayments")}
                        </td>
                      </tr>
                    ) : (
                      invoice.payments.map((payment) => (
                        <tr
                          key={payment.id}
                          className="border-b last:border-0"
                        >
                          <td className="py-2.5">
                            {new Date(
                              payment.paymentDate
                            ).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-right font-medium text-green-600">
                            {payment.amount.toLocaleString()}{" "}
                            {invoice.currency}
                          </td>
                          <td className="py-2.5">
                            <Badge variant="outline">
                              {t(`paymentMethod_${payment.method}`)}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-muted-foreground">
                            {payment.reference || "—"}
                          </td>
                          <td className="py-2.5 text-muted-foreground">
                            {payment.notes || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Activity Tab ===== */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              {auditLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : (() => {
                // Build combined activity feed
                type ActivityItem = {
                  id: string
                  icon: React.ReactNode
                  label: string
                  detail?: string
                  date: string
                }
                const items: ActivityItem[] = []

                // Invoice created
                if (invoice?.createdAt) {
                  items.push({
                    id: "created",
                    icon: <FileText className="h-3.5 w-3.5 text-muted-foreground" />,
                    label: t("activityCreated"),
                    date: invoice.createdAt,
                  })
                }
                // Invoice sent
                if (invoice?.sentAt) {
                  items.push({
                    id: "sent",
                    icon: <Send className="h-3.5 w-3.5 text-primary" />,
                    label: t("activitySent"),
                    detail: invoice.recipientEmail || undefined,
                    date: invoice.sentAt,
                  })
                }
                // Invoice viewed
                if (invoice?.viewedAt) {
                  items.push({
                    id: "viewed",
                    icon: <Eye className="h-3.5 w-3.5 text-indigo-500" />,
                    label: t("activityViewed"),
                    date: invoice.viewedAt,
                  })
                }
                // Payments
                invoice?.payments?.forEach((p) => {
                  items.push({
                    id: `payment-${p.id}`,
                    icon: <CreditCard className="h-3.5 w-3.5 text-green-500" />,
                    label: t("activityPaymentRecorded"),
                    detail: `${p.amount.toLocaleString()} ${invoice.currency} — ${t(`paymentMethod_${p.method}`)}${p.reference ? ` (${p.reference})` : ""}`,
                    date: p.createdAt,
                  })
                })
                // Invoice paid
                if (invoice?.paidAt && invoice.status === "paid") {
                  items.push({
                    id: "paid",
                    icon: <DollarSign className="h-3.5 w-3.5 text-green-600" />,
                    label: t("activityPaid"),
                    date: invoice.paidAt,
                  })
                }
                // Audit log entries
                auditLog.forEach((entry) => {
                  items.push({
                    id: entry.id,
                    icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
                    label: `${entry.user?.name || entry.user?.email || t("system")}: ${entry.action}`,
                    detail: entry.details || undefined,
                    date: entry.createdAt,
                  })
                })

                // Sort newest first
                items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

                if (items.length === 0) {
                  return (
                    <p className="text-center text-muted-foreground py-8">
                      {t("noActivity")}
                    </p>
                  )
                }

                return (
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 text-sm border-b last:border-0 pb-3 last:pb-0"
                      >
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{item.label}</p>
                          {item.detail && (
                            <p className="text-muted-foreground text-xs mt-0.5">{item.detail}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(item.date).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Chain Tab ===== */}
        <TabsContent value="chain" className="space-y-4">
          {chainLoading && !chainData ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !chainData?.journey ? (
            /* Empty state — chain not set up */
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <Workflow className="h-12 w-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">{t("chainNotConfigured")}</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                    {t("chainNotConfiguredHint")}
                  </p>
                </div>
                <Button onClick={handleSetupChain} disabled={chainLoading}>
                  {chainLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Workflow className="h-4 w-4 mr-2" />}
                  {t("chainSetup")}
                </Button>
                {chainError && <p className="text-sm text-destructive">{chainError}</p>}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{chainData.journey.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {chainData.enrollment
                      ? t("chainActive")
                      : t("chainReady")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {chainData.enrollment ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleStopChain}
                      disabled={chainStopping}
                    >
                      {chainStopping ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Square className="h-4 w-4 mr-1" />}
                      {t("chainStop")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSaveChainSteps}
                        disabled={savingSteps}
                      >
                        {savingSteps ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        {savingSteps ? t("chainSaving") : t("chainSaveSteps")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleStartChain}
                        disabled={chainStarting || chainSteps.length === 0 || unsavedChainChanges}
                        className="gap-1"
                        title={unsavedChainChanges ? t("chainSaveFirst") : ""}
                      >
                        {chainStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {unsavedChainChanges ? t("chainSaveFirst") : t("chainStart")}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Active chain status banner */}
              {chainData.enrollment && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                  <div className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-medium">{t("chainActive")}</span>
                    {chainData.enrollment.nextActionAt && (
                      <span className="text-green-700 dark:text-green-300 ml-2">
                        {t("chainNextAction")} {new Date(chainData.enrollment.nextActionAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Step builder / timeline */}
              <Card>
                <CardContent className="pt-4">
                  {/* Trigger node */}
                  <div className="flex items-center gap-3 mb-1">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[hsl(var(--ai-from))] text-white flex-shrink-0">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="flex-1 bg-[hsl(var(--ai-from))]/5 border border-[hsl(var(--ai-from))]/20 rounded-lg px-4 py-3">
                      <span className="font-semibold text-sm text-[hsl(var(--ai-from))]">
                        {t("chainTrigger")}
                      </span>
                    </div>
                  </div>

                  {/* Steps */}
                  {chainSteps.map((step, index) => {
                    const info = getChainStepInfo(step.stepType)
                    const Icon = info.icon
                    const summary = getChainStepSummary(step)
                    const isRunning = !!chainData.enrollment
                    const isCurrent = chainData.enrollment?.currentStepId === step.id
                    const isCompleted = (step.statsCompleted || 0) > 0

                    return (
                      <div key={index}>
                        <div className="ml-[17px] h-5 w-0.5 bg-primary/20" />
                        <div className="flex items-start gap-3">
                          <div className={`flex items-center justify-center w-9 h-9 rounded-full text-white flex-shrink-0 mt-1 ${
                            isRunning
                              ? isCompleted
                                ? "bg-green-500"
                                : isCurrent
                                ? `${info.color} ring-2 ring-offset-1 ring-blue-400`
                                : "bg-muted-foreground/30"
                              : info.color
                          }`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className={`flex-1 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-3 ${isRunning && !isCompleted && !isCurrent ? "opacity-50" : ""} ${info.borderColor}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">{index + 1}. {info.label}</span>
                                {isRunning && isCompleted && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">{t("chainStepDone")}</span>
                                )}
                                {isRunning && isCurrent && !isCompleted && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{t("chainStepWaiting")}</span>
                                )}
                              </div>
                              {!isRunning && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setNewStepType(step.stepType)
                                      setNewStepConfig({ ...step.config })
                                      removeChainStep(index)
                                      setAddStepOpen(true)
                                    }}
                                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                                    title={tc("edit")}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => removeChainStep(index)}
                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Add step (only when not running) */}
                  {!chainData.enrollment && (
                    <div>
                      <div className="ml-[17px] h-5 w-0.5 bg-primary/10" />
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary flex-shrink-0">
                          <Plus className="h-4 w-4" />
                        </div>
                        <button
                          onClick={() => { setNewStepType("send_email"); setNewStepConfig(chainStepDefaults["send_email"] || {}); setAddStepOpen(true) }}
                          className="flex-1 border-2 border-dashed rounded-lg px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors text-center"
                        >
                          {t("chainAddStep")}
                        </button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {chainError && <p className="text-sm text-destructive">{chainError}</p>}
            </>
          )}
        </TabsContent>

        {/* ===== Add Chain Step Dialog ===== */}
        <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
          <DialogHeader>
            <DialogTitle>{t("chainAddStepTitle").replace("{num}", String(chainSteps.length + 1))}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            {/* Step type grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {chainStepTypes.map(st => {
                const Icon = st.icon
                const selected = newStepType === st.value
                return (
                  <button
                    key={st.value}
                    onClick={() => { setNewStepType(st.value); setNewStepConfig(chainStepDefaults[st.value] || {}) }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs font-medium transition-all ${
                      selected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-transparent bg-muted/50 text-muted-foreground hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {st.label}
                  </button>
                )
              })}
            </div>

            {/* Step config */}
            <div className="space-y-3">
              {newStepType === "send_email" && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("chainSubjectLabel")}</Label>
                    <Input
                      value={newStepConfig.subject || ""}
                      onChange={e => setNewStepConfig((c: any) => ({ ...c, subject: e.target.value }))}
                      placeholder={t("chainSubjectPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      {t("chainBodyLabel")} · {t("chainVarsHint")}
                    </Label>
                    <Textarea
                      value={newStepConfig.body || ""}
                      onChange={e => setNewStepConfig((c: any) => ({ ...c, body: e.target.value }))}
                      placeholder={t("chainBodyPlaceholder")}
                      rows={4}
                    />
                  </div>
                </>
              )}
              {(newStepType === "sms" || newStepType === "send_whatsapp" || newStepType === "send_telegram") && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("chainMessageLabel")} · {t("chainVarsHint")}
                  </Label>
                  <Textarea
                    value={newStepConfig.message || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, message: e.target.value }))}
                    placeholder={t("chainMessagePlaceholder")}
                    rows={3}
                  />
                </div>
              )}
              {newStepType === "wait" && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t("chainWaitDaysLabel")}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={newStepConfig.days || 1}
                      onChange={e => setNewStepConfig((c: any) => ({ ...c, days: parseInt(e.target.value) || 1 }))}
                      className="w-24"
                    />
                    <Select
                      value={newStepConfig.unit || "days"}
                      onChange={e => setNewStepConfig((c: any) => ({ ...c, unit: e.target.value }))}
                      className="flex-1"
                    >
                      <option value="minutes">{t("chainWaitUnitMinutes")}</option>
                      <option value="hours">{t("chainWaitUnitHours")}</option>
                      <option value="days">{t("chainWaitUnitDays")}</option>
                      <option value="weeks">{t("chainWaitUnitWeeks")}</option>
                    </Select>
                  </div>
                </div>
              )}
              {newStepType === "condition" && (
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground mb-1 block">Nə etməli? Birini seçin:</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {invoiceConditionRecipes.map(recipe => {
                      const isSelected = newStepConfig._recipe === recipe.id
                      return (
                        <button
                          key={recipe.id}
                          type="button"
                          onClick={() => setNewStepConfig({
                            _recipe: recipe.id,
                            field: recipe.field,
                            operator: recipe.operator,
                            value: recipe.value,
                            onTrue: recipe.onTrue,
                            onFalse: recipe.onFalse,
                          })}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs transition-all text-center ${
                            isSelected
                              ? "border-primary bg-primary/5 text-primary shadow-sm"
                              : "border-transparent bg-muted/40 text-muted-foreground hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-muted/60"
                          }`}
                        >
                          <span className="text-xl">{recipe.icon}</span>
                          <span className="font-semibold leading-tight">{recipe.label}</span>
                          <span className="text-[10px] opacity-60">{recipe.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStepOpen(false)}>{t("chainCancel")}</Button>
            <Button onClick={addChainStep}>{t("chainAdd")}</Button>
          </DialogFooter>
        </Dialog>

        {/* ===== PDF Preview Tab ===== */}
        <TabsContent value="preview">
          <Card>
            <CardContent className="pt-4">
              <iframe
                src={`/api/v1/invoices/${invoiceId}/pdf?format=html`}
                className="w-full min-h-[600px] border border-zinc-200 dark:border-zinc-700 rounded-md"
                title={t("pdfPreview")}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Delete Dialog ===== */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        itemName={invoice.invoiceNumber}
      />

      {/* ===== Record Payment Dialog ===== */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {t("recordPayment")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("amount")}</Label>
              <Input
                type="number"
                step="0.01"
                value={paymentForm.amount}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    amount: parseFloat(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("paymentMethod")}</Label>
              <Select
                value={paymentForm.method}
                onChange={(e) =>
                  setPaymentForm((prev) => ({ ...prev, method: e.target.value }))
                }
              >
                <option value="bank_transfer">
                  {t("paymentMethod_bank_transfer")}
                </option>
                <option value="cash">
                  {t("paymentMethod_cash")}
                </option>
                <option value="card">
                  {t("paymentMethod_card")}
                </option>
                <option value="check">
                  {t("paymentMethod_check")}
                </option>
                <option value="other">
                  {t("paymentMethod_other")}
                </option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("paymentDate")}</Label>
              <Input
                type="date"
                value={paymentForm.paymentDate}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    paymentDate: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reference")}</Label>
              <Input
                value={paymentForm.reference}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    reference: e.target.value,
                  }))
                }
                placeholder={t("referencePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("notes")}</Label>
              <Textarea
                value={paymentForm.notes}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                rows={3}
              />
            </div>
            {paymentError && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {paymentError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPaymentDialog(false)}
              disabled={paymentLoading}
            >
              {tc("cancel")}
            </Button>
            <Button onClick={handleRecordPayment} disabled={paymentLoading}>
              {paymentLoading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  {tc("saving")}
                </span>
              ) : (
                t("recordPayment")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Edit Invoice Dialog ===== */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              {tc("edit")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("title")}</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("issueDate")}</Label>
                <Input
                  type="date"
                  value={editForm.issueDate}
                  onChange={(e) => setEditForm((p) => ({ ...p, issueDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("dueDate")}</Label>
                <Input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm((p) => ({ ...p, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("paymentTerms")}</Label>
                <Select
                  value={editForm.paymentTerms}
                  onChange={(e) => setEditForm((p) => ({ ...p, paymentTerms: e.target.value }))}
                >
                  <option value="">{tc("select")}</option>
                  <option value="dueOnReceipt">{t("dueOnReceipt")}</option>
                  <option value="net15">{t("net15")}</option>
                  <option value="net30">{t("net30")}</option>
                  <option value="net45">{t("net45")}</option>
                  <option value="net60">{t("net60")}</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("currency")}</Label>
                <Select
                  value={editForm.currency}
                  onChange={(e) => setEditForm((p) => ({ ...p, currency: e.target.value }))}
                >
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <option key={code} value={code}>{code} {sym}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("recipientEmail")}</Label>
              <Input
                type="email"
                value={editForm.recipientEmail}
                onChange={(e) => setEditForm((p) => ({ ...p, recipientEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>VÖEN</Label>
              <Input
                value={editForm.voen}
                onChange={(e) => setEditForm((p) => ({ ...p, voen: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("notes")}</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
              />
            </div>
            {editError && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {editError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={editLoading}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSaveEdit} disabled={editLoading}>
              {editLoading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  {tc("saving")}
                </span>
              ) : tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Send Invoice Dialog ===== */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {t("sendInvoice")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("recipientEmail")}</Label>
              <Input
                type="email"
                value={sendForm.email}
                onChange={(e) =>
                  setSendForm((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("subject")}</Label>
              <Input
                value={sendForm.subject}
                onChange={(e) =>
                  setSendForm((prev) => ({
                    ...prev,
                    subject: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("message")}</Label>
              <Textarea
                value={sendForm.message}
                onChange={(e) =>
                  setSendForm((prev) => ({
                    ...prev,
                    message: e.target.value,
                  }))
                }
                rows={5}
                placeholder={t("messagePlaceholder")}
              />
            </div>
            {sendError && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {sendError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSendDialog(false)}
              disabled={sendLoading}
            >
              {tc("cancel")}
            </Button>
            <Button onClick={handleSendInvoice} disabled={sendLoading}>
              {sendLoading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  {t("sending")}
                </span>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  {t("send")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
