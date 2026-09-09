"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { cn } from "@/lib/utils"
import {
  Bell, BellOff, CheckCheck, Settings, Info, AlertTriangle,
  CheckCircle2, MessageSquare, DollarSign, UserPlus,
} from "lucide-react"

interface Notification {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  relatedType?: string
  relatedId?: string
}

const typeIcons: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  deal: DollarSign,
  lead: UserPlus,
  message: MessageSquare,
}

const typeColors: Record<string, string> = {
  info: "text-blue-500",
  warning: "text-yellow-500",
  success: "text-green-500",
  deal: "text-purple-500",
  lead: "text-orange-500",
  message: "text-sky-500",
}

export default function NotificationsPage() {
  const { data: session } = useSession()
  const t = useTranslations("notifications")
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const orgId = session?.user?.organizationId

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/v1/notifications?page=1", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setNotifications(json.data.notifications || [])
        setUnreadCount(json.data.unreadCount || 0)
        setTotal(json.data.total || 0)
        setCurrentPage(1)
        setHasMore(json.data.hasMore || false)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const res = await fetch(`/api/v1/notifications?page=${nextPage}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setNotifications(prev => [...prev, ...(json.data.notifications || [])])
        setUnreadCount(json.data.unreadCount || 0)
        setTotal(json.data.total || 0)
        setCurrentPage(nextPage)
        setHasMore(json.data.hasMore || false)
      }
    } catch (err) { console.error(err) } finally { setLoadingMore(false) }
  }

  useEffect(() => { fetchNotifications() }, [session])

  const markAllRead = async () => {
    try {
      await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ markAll: true }),
      })
      fetchNotifications()
    } catch (err) { console.error(err) }
  }

  const markRead = async (id: string) => {
    try {
      await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ids: [id] }),
      })
      fetchNotifications()
    } catch (err) { console.error(err) }
  }

  const filtered = filter === "unread"
    ? notifications.filter(n => !n.isRead)
    : notifications

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return t("minsAgo", { n: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t("hoursAgo", { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t("daysAgo", { n: days })
    return d.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")}<HelpButton slug="notifications" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4 mr-1" /> {t("markAllRead")}
          </Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ColorStatCard label={t("total")} value={total} icon={<Bell className="h-4 w-4" />} hint={t("hintTotal")} />
        <ColorStatCard label={t("unread")} value={unreadCount} icon={<BellOff className="h-4 w-4" />} hint={t("hintUnread")} />
        <ColorStatCard label={t("read")} value={Math.max(0, total - unreadCount)} icon={<CheckCheck className="h-4 w-4" />} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          {t("all") + " (" + total + ")"}
        </Button>
        <Button
          variant={filter === "unread" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("unread")}
        >
          {t("unreadFilter") + " (" + unreadCount + ")"}
        </Button>
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {filter === "unread" ? t("noUnread") : t("noNotifications")}
            </CardContent>
          </Card>
        ) : (
          filtered.map(notif => {
            const Icon = typeIcons[notif.type] || Bell
            const colorClass = typeColors[notif.type] || "text-muted-foreground"
            return (
              <Card
                key={notif.id}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-accent/50",
                  !notif.isRead && "border-l-4 border-l-primary bg-primary/5"
                )}
                onClick={() => !notif.isRead && markRead(notif.id)}
              >
                <CardContent className="py-3 flex items-start gap-3">
                  <div className={cn("mt-0.5 flex-shrink-0", colorClass)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-medium", !notif.isRead && "font-semibold")}>
                        {notif.title}
                      </span>
                      {!notif.isRead && (
                        <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {formatDate(notif.createdAt)}
                  </span>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {hasMore && filter === "all" && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  )
}
