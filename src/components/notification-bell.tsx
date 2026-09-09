"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Bell, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { deriveSection } from "@/lib/notifications/taxonomy"

interface Notification {
  id: string
  type: string
  title: string
  message: string
  entityType?: string
  entityId?: string
  url?: string | null
  targetMissing?: boolean
  isRead: boolean
  createdAt: string
}

type ApiEnvelope<T> = {
  success?: boolean
  data?: T
}

const entityUrls: Record<string, string> = {
  task:      "/tasks",
  deal:      "/deals",
  lead:      "/leads",
  contact:   "/contacts",
  company:   "/companies",
  ticket:    "/tickets",
  campaign:  "/campaigns",
  contract:  "/contracts",
  complaint: "/complaints",
  invoice:   "/invoices",
}

function getEntityUrl(type?: string, id?: string) {
  if (!type || !id) return null
  const base = entityUrls[type]
  return base ? `${base}/${id}` : null
}

function getNotificationUrl(notification: Notification) {
  if (typeof notification.url === "string") return notification.url
  return getEntityUrl(notification.entityType, notification.entityId)
}

export function NotificationBell() {
  const t = useTranslations("notifications")
  const router = useRouter()
  const { data: session } = useSession()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const orgId = session?.user?.organizationId

  // De-dup: track seen notification IDs to avoid toasting historical or already-seen ones.
  const seenIds = useRef<Set<string>>(new Set())
  // On first load we baseline the set — no toast. Subsequent fetches toast new arrivals.
  const initialized = useRef(false)

  // Section push prefs: section key → push enabled (fetched once on mount).
  // null = not yet loaded (treat as ungated — keep toasting until prefs load).
  const pushPrefs = useRef<Record<string, boolean> | null>(null)

  useEffect(() => {
    fetch("/api/v1/users/me/notification-preferences")
      .then((r) => readJsonSafely<ApiEnvelope<{ sections: Array<{ key: string; push: boolean }> }>>(r))
      .then((json) => {
        if (json?.success && json.data) {
          const map: Record<string, boolean> = {}
          for (const s of json.data.sections) {
            map[s.key] = s.push
          }
          pushPrefs.current = map
        }
      })
      .catch(() => {/* best-effort: keep toasting if fetch fails */})
  }, [session])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await readJsonSafely<ApiEnvelope<{ notifications: Notification[]; unreadCount: number }>>(res)
      if (json?.success && json.data) {
        const incoming: Notification[] = json.data.notifications
        if (!initialized.current) {
          // First load — record all current IDs as baseline; no toast.
          incoming.forEach((n) => seenIds.current.add(n.id))
          initialized.current = true
        } else {
          // Subsequent polls — toast only unread notifications we haven't seen yet.
          // Cap at 3 toasts per poll to avoid flooding.
          let toasted = 0
          for (const n of incoming) {
            if (!seenIds.current.has(n.id)) {
              seenIds.current.add(n.id)
              if (!n.isRead && toasted < 3) {
                // Section-level push gate: derive the section from entityType.
                // FIX B (bell fail-closed): an unknown/unmapped section must NOT toast.
                // - prefs not yet loaded (null) → keep toasting (best-effort until load)
                // - section unknown (null) → fail-closed: suppress toast (unmapped entityType)
                // - section known → toast only if push pref is on (default true)
                const section = deriveSection(n.entityType ?? "")
                const prefAllows =
                  pushPrefs.current === null ||
                  (section !== null && (pushPrefs.current[section] ?? true))
                if (prefAllows) {
                  toast(n.title, { description: n.message || undefined })
                  toasted++
                }
              }
            }
          }
        }
        setNotifications(incoming)
        setUnreadCount(json.data.unreadCount)
      }
    } catch {}
  }, [orgId])

  useEffect(() => {
    const initialLoad = setTimeout(() => { void fetchNotifications() }, 0)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchNotifications()
    }, 10000) // 10s — snappier toast popups for inbound + participant notifications (was 30s)
    return () => {
      clearTimeout(initialLoad)
      clearInterval(interval)
    }
  }, [session, fetchNotifications])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void fetchNotifications()
  }, [fetchNotifications])

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

  const handleNotificationClick = (n: Notification, url: string | null) => {
    setOpen(false)
    if (!n.isRead) {
      fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ ids: [n.id] }),
      }).then(() => fetchNotifications()).catch((err: unknown) => console.error(err))
    }
    if (url) router.push(url)
  }

  const typeColors: Record<string, string> = {
    info: "bg-blue-500",
    warning: "bg-yellow-500",
    error: "bg-red-500",
    success: "bg-green-500",
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("title")}
          className="relative rounded-md p-2 transition-colors hover:bg-muted"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="z-[1000] max-h-96 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-background p-0 shadow-xl dark:border-zinc-700"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="text-sm font-medium">{t("title")}</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 text-xs">
              <Check className="mr-1 h-3 w-3" /> {t("markAllRead")}
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("noNotifications")}
            </div>
          ) : (
            notifications.slice(0, 20).map(n => {
              const url = getNotificationUrl(n)
              return (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n, url)}
                  className={`border-b px-4 py-3 transition-colors last:border-0 hover:bg-muted/50 ${!n.isRead ? "bg-muted/30" : ""} ${url ? "cursor-pointer" : "cursor-default"}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${typeColors[n.type] || "bg-muted-foreground/50"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{n.message}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
