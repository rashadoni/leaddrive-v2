"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { OfferForm } from "@/components/offer-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import {
  ArrowLeft, Pencil, Trash2, FileCheck, DollarSign, Calendar, Clock, CheckCircle2,
  Send, FileOutput, Building2, User, Hash, FileText, Package, Percent, Download,
} from "lucide-react"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { HelpButton } from "@/components/help/help-button"

interface OfferItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
  productId?: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
}

const STATUS_FLOW = ["draft", "sent", "approved"]

export default function OfferDetailPage() {
  const t = useTranslations("offers")
  const tc = useTranslations("common")
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const [offer, setOffer] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [convertLoading, setConvertLoading] = useState(false)
  const orgId = session?.user?.organizationId

  // Send email state
  const [sendEmail, setSendEmail] = useState("")
  const [sendSubject, setSendSubject] = useState("")
  const [sendMessage, setSendMessage] = useState("")
  const [sendLoading, setSendLoading] = useState(false)
  const [sendError, setSendError] = useState("")
  const [sendSuccess, setSendSuccess] = useState(false)
  const [companyName, setCompanyName] = useState("")

  const fetchOffer = async () => {
    try {
      const res = await fetch(`/api/v1/offers/${params.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) {
        setOffer(json.data)
        // Fetch company name if companyId exists
        if (json.data.companyId && orgId) {
          fetch(`/api/v1/companies/${json.data.companyId}`, {
            headers: { "x-organization-id": String(orgId) },
          })
            .then((r) => r.json())
            .then((j) => { if (j.success && j.data) setCompanyName(j.data.name || "") })
            .catch(() => {})
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params.id) fetchOffer()
  }, [params.id, session])

  const handleDelete = async () => {
    const res = await fetch(`/api/v1/offers/${params.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || tc("errorDeleteFailed"))
    router.push("/offers")
  }

  // Send offer via email
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sendEmail.trim()) { setSendError(t("emailRequired")); return }
    setSendLoading(true)
    setSendError("")
    try {
      const res = await fetch(`/api/v1/offers/${params.id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          recipientEmail: sendEmail,
          subject: sendSubject,
          message: sendMessage,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || tc("errorGeneric"))
      setSendSuccess(true)
      fetchOffer()
      setTimeout(() => { setSendOpen(false); setSendSuccess(false) }, 1500)
    } catch (err: any) {
      setSendError(err.message)
    } finally {
      setSendLoading(false)
    }
  }

  // Convert to invoice
  const handleConvertToInvoice = async () => {
    setConvertLoading(true)
    try {
      const res = await fetch("/api/v1/invoices/from-offer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ offerId: params.id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || tc("errorGeneric"))
      router.push(`/invoices/${json.data.id}`)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setConvertLoading(false)
    }
  }

  // Open send dialog with defaults
  const openSendDialog = () => {
    setSendEmail(offer?.recipientEmail || "")
    setSendSubject(`${t("emailSubjectPrefix")} ${offer?.offerNumber || ""}`)
    setSendMessage(`${t("emailGreeting")}\n\n${t("emailBody")} ${offer?.offerNumber || ""}.\n${t("emailAmount")}: ${formatCurrency(calculations.total)} ${offer?.currency || DEFAULT_CURRENCY}\n\n${t("emailRegards")}`)
    setSendError("")
    setSendSuccess(false)
    setSendOpen(true)
  }

  const formatCurrency = (n: number) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formatDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—")

  // Calculations
  const calculations = useMemo(() => {
    if (!offer) return { subtotal: 0, discountAmount: 0, vatAmount: 0, total: 0 }
    const items: OfferItem[] = offer.items || []
    const subtotal = items.reduce((sum: number, item: OfferItem) => sum + (item.total || item.quantity * item.unitPrice), 0)
    const discountAmount = (subtotal * (offer.discount || 0)) / 100
    const afterDiscount = subtotal - discountAmount
    const vatAmount = offer.includeVat ? afterDiscount * 0.18 : 0
    const total = afterDiscount + vatAmount
    return { subtotal, discountAmount, vatAmount, total }
  }, [offer])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-16 bg-muted rounded-lg mb-4" />
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!offer) {
    return <div className="text-center py-12 text-muted-foreground">{tc("noData")}</div>
  }

  const items: OfferItem[] = offer.items || []
  const daysOpen = offer.createdAt ? Math.floor((Date.now() - new Date(offer.createdAt).getTime()) / 86400000) : null
  const daysValid = offer.validUntil ? Math.floor((new Date(offer.validUntil).getTime() - Date.now()) / 86400000) : null

  const statusKey = offer.status as string
  const statusLabel = t.has(`status.${statusKey}`) ? t(`status.${statusKey}` as any) : statusKey

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/offers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><span className="truncate">{offer.title}</span> <HelpButton slug="offer-detail" variant="label" className="shrink-0" /></h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{offer.offerNumber || "—"}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[statusKey] || STATUS_COLORS.draft}`}>
                  {statusLabel}
                </span>
                {offer.type && offer.type !== "commercial" && (
                  <Badge variant="outline">{t(`type${offer.type.charAt(0).toUpperCase() + offer.type.slice(1)}` as any)}</Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {offer.status === "draft" && (
            <Button variant="default" size="sm" onClick={openSendDialog}>
              <Send className="h-4 w-4 mr-1" /> {t("send")}
            </Button>
          )}
          {(offer.status === "approved" || offer.status === "accepted") && (
            <Button variant="default" size="sm" onClick={handleConvertToInvoice} disabled={convertLoading}>
              <FileOutput className="h-4 w-4 mr-1" /> {convertLoading ? "..." : tc("convertToInvoice") || "→ Invoice"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/v1/offers/${offer.id}/pdf`, "_blank")}>
            <Download className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> {tc("edit")}
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> {tc("delete")}
          </Button>
        </div>
      </div>

      {/* Status Pipeline */}
      <div className="flex items-center gap-1">
        {STATUS_FLOW.map((step, i) => {
          const stepLabel = t.has(`status.${step}`) ? t(`status.${step}` as any) : step
          const isActive = statusKey === step
          const isPast = STATUS_FLOW.indexOf(statusKey) > i
          const isRejected = statusKey === "rejected"
          return (
            <div key={step} className="flex-1 flex items-center gap-1">
              <div className={`flex-1 h-9 rounded-lg flex items-center justify-center text-xs font-medium transition-colors
                ${isActive ? "bg-primary text-primary-foreground shadow-sm" : ""}
                ${isPast ? "bg-primary/20 text-primary" : ""}
                ${!isActive && !isPast ? "bg-muted text-muted-foreground" : ""}
                ${isRejected && step === "approved" ? "bg-red-100 text-red-800 line-through dark:bg-red-900/30" : ""}
              `}>
                {stepLabel}
              </div>
              {i < STATUS_FLOW.length - 1 && <div className="text-muted-foreground text-xs">→</div>}
            </div>
          )
        })}
        {statusKey === "rejected" && (
          <>
            <div className="text-muted-foreground text-xs">→</div>
            <div className="flex-1 h-9 rounded-lg flex items-center justify-center text-xs font-medium bg-red-500 text-white shadow-sm">
              {t.has("status.rejected") ? t("status.rejected" as any) : "Rejected"}
            </div>
          </>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard
          label={t("grandTotal")}
          value={`${formatCurrency(calculations.total)} ${offer.currency || DEFAULT_CURRENCY}`}
          icon={<DollarSign className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={t("positions")}
          value={`${items.length} ${t("items")}`}
          icon={<Package className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={t("colValidUntil")}
          value={daysValid !== null ? (daysValid < 0 ? t("expired") : `${daysValid} ${tc("days")}`) : "—"}
          icon={<Calendar className="h-4 w-4" />}
        />
        <ColorStatCard
          label={tc("daysOpen")}
          value={daysOpen !== null ? daysOpen : "—"}
          icon={<Clock className="h-4 w-4" />}
         
        />
      </div>

      <AdvisorRecordWidget entityType="offer" entityId={offer.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

      {/* Items Table */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1">
              {t("positions")} <InfoHint text={t("pageDescription")} size={12} />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2.5 text-left w-[40px]">#</th>
                    <th className="px-3 py-2.5 text-left">{t("itemName")}</th>
                    <th className="px-3 py-2.5 text-center w-[80px]">{t("qty")}</th>
                    <th className="px-3 py-2.5 text-right w-[120px]">{t("unitPrice")}</th>
                    <th className="px-3 py-2.5 text-center w-[90px]">{t("discountPercent")}</th>
                    <th className="px-3 py-2.5 text-right w-[130px]">{t("total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: OfferItem, idx: number) => {
                    const lineTotal = item.total || (item.quantity * item.unitPrice * (1 - item.discount / 100))
                    return (
                      <tr key={item.id} className={`border-t hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-medium">{item.name}</td>
                        <td className="px-3 py-2.5 text-center">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(item.unitPrice)} {offer.currency}</td>
                        <td className="px-3 py-2.5 text-center">
                          {item.discount > 0 ? <span className="text-orange-600">{item.discount}%</span> : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(lineTotal)} {offer.currency}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 flex justify-end">
              <div className="w-72 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("subtotal")}:</span>
                  <span className="font-medium tabular-nums">{formatCurrency(calculations.subtotal)} {offer.currency}</span>
                </div>
                {(offer.discount || 0) > 0 && (
                  <div className="flex justify-between text-orange-600">
                    <span>{t("discountLabel")} ({offer.discount}%):</span>
                    <span className="tabular-nums">-{formatCurrency(calculations.discountAmount)} {offer.currency}</span>
                  </div>
                )}
                {offer.includeVat && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tc("vat")} (18%):</span>
                    <span className="font-medium tabular-nums">+{formatCurrency(calculations.vatAmount)} {offer.currency}</span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between text-base font-bold">
                  <span>{t("grandTotal")}:</span>
                  <span className="text-primary tabular-nums">{formatCurrency(calculations.total)} {offer.currency}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Offer Details Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1">
              <FileText className="h-4 w-4 mr-1" /> {t("offerDetails")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-muted-foreground">{t("colNumber")}:</span>
                <span className="ml-2 font-medium">{offer.offerNumber || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("type")}:</span>
                <span className="ml-2 font-medium">{t(`type${(offer.type || "commercial").charAt(0).toUpperCase() + (offer.type || "commercial").slice(1)}` as any)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("currency")}:</span>
                <span className="ml-2 font-medium">{offer.currency || DEFAULT_CURRENCY}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("colValidUntil")}:</span>
                <span className="ml-2 font-medium">{formatDate(offer.validUntil)}</span>
              </div>
              {offer.sentAt && (
                <div>
                  <span className="text-muted-foreground">{t("sentAt")}:</span>
                  <span className="ml-2 font-medium">{formatDate(offer.sentAt)}</span>
                </div>
              )}
              {offer.contractNumber && (
                <div>
                  <span className="text-muted-foreground">{t("contractNumber")}:</span>
                  <span className="ml-2 font-medium">{offer.contractNumber}</span>
                </div>
              )}
            </div>
            {offer.notes && (
              <div className="pt-3 border-t">
                <span className="text-muted-foreground">{t("notes")}:</span>
                <p className="mt-1 whitespace-pre-wrap">{offer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Client Info Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1">
              <Building2 className="h-4 w-4 mr-1" /> {t("clientInfo")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {offer.companyId ? (
              <div>
                <span className="text-muted-foreground">{tc("company")}:</span>
                <button
                  className="ml-2 text-primary hover:underline font-medium"
                  onClick={() => router.push(`/companies/${offer.companyId}`)}
                >
                  {companyName || offer.companyId}
                </button>
              </div>
            ) : offer.clientName ? (
              <div>
                <span className="text-muted-foreground">{t("clientNameLabel")}:</span>
                <span className="ml-2 font-medium">{offer.clientName}</span>
              </div>
            ) : (
              <div className="text-muted-foreground italic">{tc("noData")}</div>
            )}
            {offer.contactPerson && (
              <div>
                <span className="text-muted-foreground">{t("contactPerson")}:</span>
                <span className="ml-2 font-medium">{offer.contactPerson}</span>
              </div>
            )}
            {offer.voen && (
              <div>
                <span className="text-muted-foreground">VÖEN:</span>
                <span className="ml-2 font-medium">{offer.voen}</span>
              </div>
            )}
            {offer.recipientEmail && (
              <div>
                <span className="text-muted-foreground">Email:</span>
                <span className="ml-2 font-medium">{offer.recipientEmail}</span>
              </div>
            )}
            {offer.includeVat && (
              <div className="pt-2 border-t">
                <Badge variant="outline" className="text-xs">
                  <Percent className="h-3 w-3 mr-1" /> {tc("vat")} 18%
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <OfferForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchOffer}
        orgId={orgId}
        initialData={offer}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteOffer")}
        itemName={offer.title}
      />

      {/* Send Email Dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogHeader>
          <DialogTitle>{t("sendTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSend}>
          <DialogContent>
            {sendError && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{sendError}</div>}
            {sendSuccess && <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 p-2 rounded mb-3">{t("emailSent")}</div>}
            <div className="space-y-3">
              <div>
                <Label>{t("recipientEmail")} *</Label>
                <Input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} required />
              </div>
              <div>
                <Label>{t("emailSubject")}</Label>
                <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
              </div>
              <div>
                <Label>{t("emailMessage")}</Label>
                <Textarea value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} rows={6} />
              </div>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendOpen(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={sendLoading}>
              <Send className="h-4 w-4 mr-1" /> {sendLoading ? "..." : t("send")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}
