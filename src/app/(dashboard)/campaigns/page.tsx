"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ColorStatCard } from "@/components/color-stat-card"
import { CampaignForm } from "@/components/campaign-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Input } from "@/components/ui/input"
import { Plus, Users, Send, Search, Megaphone, BarChart3, List } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { DidYouKnow } from "@/components/did-you-know"
import { CampaignsAnalytics } from "@/components/campaigns/campaigns-analytics"

interface Campaign {
  id: string
  name: string
  description?: string
  status: string
  type: string
  subject?: string
  totalRecipients: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  budget?: number
  templateId?: string
  segmentId?: string
  recipientMode?: string
  recipientIds?: string[]
  recipientSource?: string
  flowData?: unknown
  scheduledAt?: string
  sentAt?: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  draft: "text-muted-foreground",
  scheduled: "text-amber-500",
  sending: "text-blue-500",
  sent: "text-green-600",
  cancelled: "text-red-500",
}

const typeIcons: Record<string, string> = {
  email: "📧",
  sms: "📱",
  whatsapp: "💬",
  telegram: "✈️",
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function CampaignsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("campaigns")
  const tc = useTranslations("common")
  useAutoTour("campaigns")
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Campaign | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<"analytics" | "list">("list")
  const orgId = session?.user?.organizationId

  const statusLabels: Record<string, string> = {
    draft: t("statusDraft"),
    scheduled: t("statusScheduled"),
    sending: t("statusSending"),
    sent: t("statusSent"),
    cancelled: t("statusCancelled"),
    ab_testing: t("statusAbTesting"),
  }
  const typeLabels: Record<string, string> = {
    email: t("typeEmail"),
    sms: t("typeSms"),
    whatsapp: t("typeWhatsapp"),
    telegram: t("typeTelegram"),
  }

  const fetchCampaigns = async () => {
    try {
      const res = await fetch("/api/v1/campaigns?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setCampaigns(json.data.campaigns)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCampaigns() }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/campaigns/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchCampaigns()
  }

  const handleSend = async (campaign: Campaign) => {
    const channelLabel = typeLabels[campaign.type] || campaign.type
    const providerHint = campaign.type === "whatsapp" || campaign.type === "telegram" ? `\n\n${t("liveSendProviderHint")}` : ""
    if (!confirm(`${t("sendCampaign")} "${campaign.name}"?\n\n${tc("type")}: ${channelLabel}\n${t("recipients")}: ${campaign.totalRecipients}${providerHint}`)) return
    try {
      const res = await fetch(`/api/v1/campaigns/${campaign.id}/send`, {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.smtpMissing) {
          toast.error(t("smtpNotConfigured"))
        } else {
          toast.error(json.error || "Error")
        }
        return
      }
      const skipped = Number(json.data?.skipped || 0)
      const errors = Array.isArray(json.data?.errors) ? json.data.errors.filter(Boolean) : []
      const sentMessage = skipped > 0
        ? t("sentToRecipientsWithSkipped", { count: json.data.sent, total: json.data.total, skipped })
        : t("sentToRecipients", { count: json.data.sent, total: json.data.total })
      const detail = errors.length > 0 ? `${sentMessage}. ${errors.slice(0, 2).join("; ")}` : sentMessage
      if (json.data.sent === 0) toast.info(detail)
      else if (skipped > 0 || errors.length > 0) toast.warning(detail)
      else toast.success(detail)
      setShowForm(false)
      setEditData(undefined)
      fetchCampaigns()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error")
    }
  }

  // Status counts
  const statusCounts: Record<string, number> = { draft: 0, scheduled: 0, sending: 0, sent: 0, cancelled: 0 }
  for (const c of campaigns) {
    if (statusCounts[c.status] !== undefined) statusCounts[c.status]++
  }

  // Filter by search
  const filtered = campaigns.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.description || "").toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-5">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="campaigns" /> <HelpButton slug="campaigns" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{total} {t("title").toLowerCase()}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/50 p-0.5">
            <button
              onClick={() => setTab("analytics")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === "analytics" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="h-4 w-4" />
              {tc("analytics")}
            </button>
            <button
              onClick={() => setTab("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="h-4 w-4" />
              {tc("list")}
            </button>
          </div>
          <Button data-tour-id="campaigns-new" onClick={() => { setEditData(undefined); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {t("newCampaign")}
          </Button>
        </div>
      </div>

      <DidYouKnow page="campaigns" className="mb-4" />

      {/* Stats — 5 status cards */}
      <div data-tour-id="campaigns-stats" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <ColorStatCard label={t("statusDraft")} value={statusCounts.draft} icon={<Megaphone className="h-4 w-4" />} hint={t("hintTotalCampaigns")} />
        <ColorStatCard label={t("statusScheduled")} value={statusCounts.scheduled} icon={<Megaphone className="h-4 w-4" />} hint={t("hintSentMonth")} />
        <ColorStatCard label={t("statusSending")} value={statusCounts.sending} icon={<Megaphone className="h-4 w-4" />} hint={t("hintOpenRate")} />
        <ColorStatCard label={t("statusSent")} value={statusCounts.sent} icon={<Megaphone className="h-4 w-4" />} hint={t("hintClickRate")} />
        <ColorStatCard label={t("statusCancelled")} value={statusCounts.cancelled} icon={<Megaphone className="h-4 w-4" />} />
      </div>

      {tab === "analytics" ? (
        <CampaignsAnalytics campaigns={campaigns} />
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Campaign cards */}
          <div data-tour-id="campaigns-list" className="space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {campaigns.length === 0 ? t("noCampaigns") : t("noResults")}
              </div>
            ) : (
              filtered.map(campaign => (
                <div
                  key={campaign.id}
                  className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer bg-card"
                  onClick={() => router.push(`/campaigns/${campaign.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base">{campaign.name}</h3>
                      {campaign.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{campaign.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-sm">
                        <span className={cn("font-medium", statusColors[campaign.status] || "text-muted-foreground")}>
                          {statusLabels[campaign.status] || campaign.status}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1">
                          {typeIcons[campaign.type] || "📣"} {typeLabels[campaign.type] || campaign.type}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" /> {campaign.totalRecipients}
                        </span>
                        {campaign.totalSent > 0 && (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Send className="h-3.5 w-3.5" /> {campaign.totalSent}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      {campaign.status === "sent" ? (
                        <div>
                          <div className="text-lg font-bold text-green-600">{campaign.totalSent}/{campaign.totalRecipients}</div>
                          <div className="text-xs text-muted-foreground">{t("sent")}</div>
                        </div>
                      ) : campaign.budget ? (
                        <div>
                          <div className="text-lg font-bold">{campaign.budget.toLocaleString()}</div>
                          <div className="text-xs text-muted-foreground">{t("budget")}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <CampaignForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchCampaigns}
        initialData={editData ? {
          ...editData,
          templateId: editData.templateId || "",
          segmentId: editData.segmentId || "",
          totalRecipients: String(editData.totalRecipients ?? 0),
          budget: String(editData.budget ?? 0),
        } : undefined}
        orgId={orgId}
        onSend={editData ? () => handleSend(editData) : undefined}
        onCreatedAndSend={async (campaignId: string) => {
          try {
            const res = await fetch(`/api/v1/campaigns/${campaignId}`, {
              headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
            })
            const json = await res.json()
            if (json.success && json.data) {
              handleSend(json.data)
            }
          } catch (err) { console.error(err) }
        }}
        onDelete={editData ? () => { setDeleteId(editData.id); setDeleteName(editData.name); setShowForm(false) } : undefined}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteCampaign")}
        itemName={deleteName}
      />
    </div>
  )
}
