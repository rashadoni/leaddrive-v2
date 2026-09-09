"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { OfferForm } from "@/components/offer-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { ColorStatCard } from "@/components/color-stat-card"
import {
  FileSpreadsheet, Plus, Pencil, Trash2, FileCheck, DollarSign,
  Clock, CheckCircle2, XCircle, Send as SendIcon, Package,
} from "lucide-react"
import { DEFAULT_CURRENCY } from "@/lib/constants"

interface Offer {
  [key: string]: unknown
  id: string
  offerNumber: string
  title: string
  type?: string
  companyId?: string
  company?: { name: string }
  status: string
  totalAmount?: number
  currency: string
  validUntil?: string
  createdAt?: string
  items?: any[]
  dealId?: string
  deal?: { id: string; name: string } | null
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  sent: "default",
  approved: "outline",
  rejected: "destructive",
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function OffersPage() {
  const { data: session } = useSession()
  const t = useTranslations("offers")
  const tc = useTranslations("common")
  const router = useRouter()
  const searchParams = useSearchParams()
  const dealIdFilter = searchParams.get("dealId")
  const [offers, setOffers] = useState<Offer[]>([])
  useAutoTour("offers")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Offer | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const orgId = session?.user?.organizationId

  const fetchOffers = async () => {
    try {
      let url = statusFilter !== "all"
        ? `/api/v1/offers?limit=500&status=${statusFilter}`
        : "/api/v1/offers?limit=500"
      if (dealIdFilter) url += `&dealId=${dealIdFilter}`
      const res = await fetch(url, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setOffers(json.data.offers)
        setTotal(json.data.total)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOffers()
  }, [session, statusFilter])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/offers/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchOffers()
  }

  // Stats
  const stats = useMemo(() => {
    const all = offers
    const draft = all.filter((o) => o.status === "draft").length
    const sent = all.filter((o) => o.status === "sent").length
    const approved = all.filter((o) => o.status === "approved" || o.status === "accepted").length
    const rejected = all.filter((o) => o.status === "rejected").length
    const totalValue = all.reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    const currency = all[0]?.currency || DEFAULT_CURRENCY
    return { draft, sent, approved, rejected, totalValue, currency, total: all.length }
  }, [offers])

  const statusLabel = (status: string) => {
    if (t.has(`status.${status}`)) return t(`status.${status}` as any)
    return status
  }

  const columns = [
    {
      key: "offerNumber",
      label: t("colNumber"),
      sortable: true,
      hint: t("hintColNumber"),
      render: (item: any) => (
        <button className="text-primary hover:underline font-medium" onClick={() => router.push(`/offers/${item.id}`)}>
          {item.offerNumber}
        </button>
      ),
    },
    { key: "title", label: t("colTitle"), sortable: true, hint: t("hintColTitle") },
    {
      key: "deal",
      label: t("linkedDeal"),
      sortable: false,
      render: (item: any) => item.deal ? (
        <button
          className="text-primary hover:underline"
          onClick={(event) => {
            event.stopPropagation()
            router.push(`/deals/${item.deal.id}`)
          }}
        >
          {item.deal.name}
        </button>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "type",
      label: t("type"),
      sortable: true,
      render: (item: any) => (
        <span className="text-muted-foreground text-xs">{t(`type${(item.type || "commercial").charAt(0).toUpperCase() + (item.type || "commercial").slice(1)}` as any)}</span>
      ),
    },
    {
      key: "totalAmount",
      label: t("colAmount"),
      sortable: true,
      hint: t("hintColAmount"),
      render: (item: any) => (
        <span className="font-medium tabular-nums">{item.totalAmount ? item.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"} {item.currency}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      hint: t("hintColStatus"),
      render: (item: any) => <Badge variant={STATUS_COLORS[item.status] || "secondary"}>{statusLabel(item.status)}</Badge>,
    },
    {
      key: "validUntil",
      label: t("colValidUntil"),
      sortable: true,
      hint: t("hintColValidUntil"),
      render: (item: any) => {
        if (!item.validUntil) return "—"
        const d = new Date(item.validUntil)
        const expired = d.getTime() < Date.now()
        return <span className={expired ? "text-red-500" : ""}>{d.toLocaleDateString()}{expired ? ` (${t("expired")})` : ""}</span>
      },
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      render: (item: any) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditData(item); setShowForm(true) }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); setDeleteName(item.title) }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
          </div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  const statusTabs = [
    { key: "all", label: tc("all"), count: stats.total, icon: <Package className="h-3.5 w-3.5" /> },
    { key: "draft", label: statusLabel("draft"), count: stats.draft, icon: <Clock className="h-3.5 w-3.5" /> },
    { key: "sent", label: statusLabel("sent"), count: stats.sent, icon: <SendIcon className="h-3.5 w-3.5" /> },
    { key: "approved", label: statusLabel("approved"), count: stats.approved, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    { key: "rejected", label: statusLabel("rejected"), count: stats.rejected, icon: <XCircle className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="offers" /><HelpButton slug="offers" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => { setEditData(undefined); setShowForm(true) }} data-tour-id="offers-new">
          <Plus className="h-4 w-4 mr-1" /> {t("newOffer")}
        </Button>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="offers" className="mb-4" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tour-id="offers-stats">
        <ColorStatCard
          label={tc("total")}
          value={stats.total}
          icon={<FileCheck className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={t("colAmount")}
          value={`${stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0 })} ${stats.currency}`}
          icon={<DollarSign className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={statusLabel("approved")}
          value={stats.approved}
          icon={<CheckCircle2 className="h-4 w-4" />}
         
        />
        <ColorStatCard
          label={statusLabel("rejected")}
          value={stats.rejected}
          icon={<XCircle className="h-4 w-4" />}
         
        />
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-1 flex-wrap">
        {statusTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={statusFilter === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(tab.key)}
            className="gap-1.5"
          >
            {tab.icon}
            {tab.label}
            <span className={`ml-1 text-xs rounded-full px-1.5 ${statusFilter === tab.key ? "bg-primary-foreground/20" : "bg-muted"}`}>
              {tab.count}
            </span>
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={offers}
        searchPlaceholder={t("searchPlaceholder")}
        searchKey="title"
        onRowClick={(item: any) => router.push(`/offers/${item.id}`)}
      />

      <OfferForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchOffers}
        initialData={editData as any}
        orgId={orgId}
        dealId={dealIdFilter || undefined}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteOffer")}
        itemName={deleteName}
      />
    </div>
  )
}
