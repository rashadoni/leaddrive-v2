"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  Search, Send, MessageSquare, Mail, Phone, Trash2,
  Loader2, Plus, ArrowLeft, MessageCircle,
  Inbox as InboxIcon, ArrowDownLeft, ArrowUpRight,
} from "lucide-react"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { cn } from "@/lib/utils"

/* -- Types -- */
interface ChannelMessage {
  id: string
  direction: string
  channelType: string
  from: string
  to: string
  subject?: string
  body: string
  status: string
  createdAt: string
  metadata?: Record<string, unknown>
}

interface Conversation {
  socialConversationId?: string | null
  contactId: string | null
  contactName: string
  contactEmail: string | null
  contactPhone: string | null
  telegramChatId: string | null
  lastMessage: string
  lastMessageAt: string
  lastChannel: string
  unreadCount: number
  messageCount: number
  channels: string[]
  messages: ChannelMessage[]
}

interface Stats {
  totalMessages: number
  inbound: number
  outbound: number
  conversations: number
}

/* -- Channel helpers -- */
const channelIcon = (ch: string) => {
  switch (ch) {
    case "email": return <Mail className="h-3.5 w-3.5" />
    case "telegram": return <MessageCircle className="h-3.5 w-3.5" />
    case "sms": return <Phone className="h-3.5 w-3.5" />
    case "whatsapp": return <MessageCircle className="h-3.5 w-3.5" />
    case "facebook": return <MessageSquare className="h-3.5 w-3.5" />
    case "instagram": return <MessageSquare className="h-3.5 w-3.5" />
    case "vkontakte": return <MessageSquare className="h-3.5 w-3.5" />
    case "tiktok": return <MessageSquare className="h-3.5 w-3.5" />
    case "voip": return <Phone className="h-3.5 w-3.5" />
    default: return <MessageSquare className="h-3.5 w-3.5" />
  }
}

const channelColor = (ch: string) => {
  switch (ch) {
    case "email": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    case "telegram": return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
    case "sms": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    case "whatsapp": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    case "facebook": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "instagram": return "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
    case "vkontakte": return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
    case "tiktok": return "bg-muted text-foreground"
    case "voip": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
    default: return "bg-muted text-foreground/70"
  }
}

const channelLabel = (ch: string) => {
  switch (ch) {
    case "email": return "Email"
    case "telegram": return "Telegram"
    case "sms": return "SMS"
    case "whatsapp": return "WhatsApp"
    case "facebook": return "Facebook"
    case "instagram": return "Instagram"
    case "vkontakte": return "VKontakte"
    case "tiktok": return "TikTok"
    case "voip": return "VoIP"
    default: return ch
  }
}

const CHANNELS = ["all", "email", "telegram", "sms", "whatsapp", "facebook", "instagram", "tiktok", "voip"] as const

/* -- Page -- */
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function InboxPage() {
  const { data: session } = useSession()
  const t = useTranslations("inbox")
  const tc = useTranslations("common")
  const locale = useLocale()
  const orgId = session?.user?.organizationId
  useAutoTour("inbox")

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [stats, setStats] = useState<Stats>({ totalMessages: 0, inbound: 0, outbound: 0, conversations: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")

  // Reply
  const [replyText, setReplyText] = useState("")
  const [replyChannel, setReplyChannel] = useState("email")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendDeliveryUnknown, setSendDeliveryUnknown] = useState(false)
  const [sendUnknownAttemptId, setSendUnknownAttemptId] = useState<string | null>(null)

  // Compose dialog
  const [showCompose, setShowCompose] = useState(false)
  const [composeTo, setComposeTo] = useState("")
  const [composeBody, setComposeBody] = useState("")
  const [composeSubject, setComposeSubject] = useState("")
  const [composeChannel, setComposeChannel] = useState("email")
  const [composeSending, setComposeSending] = useState(false)
  const [composeContactId, setComposeContactId] = useState("")

  // Contacts for compose picker
  interface ContactOption { id: string; fullName: string; email: string | null; phone: string | null }
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contactsLoaded, setContactsLoaded] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sendOperationRef = useRef<{ key: string; payload: string } | null>(null)

  useEffect(() => {
    sendOperationRef.current = null
    setSendDeliveryUnknown(false)
    setSendUnknownAttemptId(null)
  }, [selected, replyText, replyChannel])

  const fetchInbox = async () => {
    try {
      const params = channelFilter !== "all" ? `?channel=${channelFilter}` : ""
      const res = await fetch(`/api/v1/inbox${params}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setConversations(json.data.conversations || [])
        setStats(json.data.stats || { totalMessages: 0, inbound: 0, outbound: 0, conversations: 0 })
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchInbox() }, [session, channelFilter])

  // Auto-refresh polling every 15 seconds
  const [isLive, setIsLive] = useState(true)
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => {
      fetchInbox()
    }, 15000)
    return () => clearInterval(interval)
  }, [isLive, channelFilter])

  // Fetch contacts for compose picker
  useEffect(() => {
    if (showCompose && !contactsLoaded) {
      fetch("/api/v1/contacts?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => {
          const raw = json.data?.contacts || json.data || json.contacts || []
          const list = (Array.isArray(raw) ? raw : []).map((c: any) => ({
            id: c.id,
            fullName: c.fullName || c.name || "—",
            email: c.email || null,
            phone: c.phone || null,
          }))
          setContacts(list)
          setContactsLoaded(true)
        })
        .catch(() => {})
    }
  }, [showCompose])

  // Scroll to bottom ONLY when switching conversations — polling never triggers scroll
  useEffect(() => {
    if (selected === null) return
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected])

  /* -- Reply -- */
  const handleSendReply = async () => {
    if (!replyText.trim() || selected === null) return
    const convo = filtered[selected]
    if (!convo) return

    // For telegram, try telegramChatId, then scan messages metadata for chatId
    let tgChatId = convo.telegramChatId
    if (!tgChatId && replyChannel === "telegram") {
      for (const msg of convo.messages) {
        const meta = (msg as any).metadata
        if (meta?.chatId) { tgChatId = meta.chatId; break }
      }
    }

    // For WhatsApp, try to get phone from metadata (waPhone) of inbound messages
    let waPhone = ""
    if (replyChannel === "whatsapp") {
      for (const msg of convo.messages) {
        const meta = (msg as any).metadata
        if (meta?.waPhone) { waPhone = meta.waPhone; break }
      }
    }

    let cwConversationId = ""
    if (replyChannel === "tiktok") {
      for (const msg of convo.messages) {
        const value = msg.metadata?.chatwootConversationId
        if (typeof value === "string" && value) { cwConversationId = value; break }
      }
    }

    const to = replyChannel === "email"
      ? (convo.contactEmail || convo.contactName)
      : replyChannel === "sms"
        ? (convo.contactPhone || convo.contactName)
        : replyChannel === "telegram"
          ? (tgChatId || convo.contactName)
          : replyChannel === "whatsapp"
            ? (waPhone || convo.contactPhone || convo.contactName)
            : replyChannel === "tiktok"
              ? cwConversationId
              : convo.contactName

    const deliveryPayload = JSON.stringify({
      conversationId: convo.socialConversationId,
      channel: replyChannel,
      to,
      body: replyText,
    })
    const deliveryIdempotencyKey = sendOperationRef.current?.payload === deliveryPayload
      ? sendOperationRef.current.key
      : crypto.randomUUID()
    sendOperationRef.current = { key: deliveryIdempotencyKey, payload: deliveryPayload }

    if (sendDeliveryUnknown) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          to,
          body: replyText,
          contactId: convo.contactId,
          conversationId: (convo as Conversation & { socialConversationId?: string }).socialConversationId,
          channel: replyChannel,
          deliveryIdempotencyKey,
        }),
      })
      const json = await res.json().catch(() => ({} as { success?: boolean; error?: string; deliveryUnknown?: boolean; attemptId?: string }))
      if (!res.ok || json.success === false) {
        setSendError(json.error || `HTTP ${res.status}`)
        if (json.deliveryUnknown === true) {
          setSendDeliveryUnknown(true)
          setSendUnknownAttemptId(typeof json.attemptId === "string" ? json.attemptId : null)
        }
        return
      }
      sendOperationRef.current = null
      setSendUnknownAttemptId(null)
      setReplyText("")
      await fetchInbox()
      // Scroll to bottom after sending
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    } catch (err) {
      setSendError((err as Error)?.message || "Network error")
    } finally { setSending(false) }
  }

  const reconcileChatwootDelivery = async (outcome: "delivered" | "not_delivered") => {
    if (selected === null || !sendUnknownAttemptId || sending) return
    const conversationId = filtered[selected]?.socialConversationId
    if (!conversationId) return
    const prompt = locale === "ru"
      ? `Подтвердите: вы открыли диалог в Chatwoot и проверили, что сообщение ${outcome === "delivered" ? "отправлено" : "НЕ отправлено"}.`
      : locale === "az"
        ? `Təsdiqləyin: Chatwoot dialoqunu açıb mesajın ${outcome === "delivered" ? "göndərildiyini" : "göndərilmədiyini"} yoxladınız.`
        : `Confirm that you opened the Chatwoot conversation and verified the message was ${outcome === "delivered" ? "delivered" : "NOT delivered"}.`
    if (!window.confirm(prompt)) return

    setSending(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conversationId}/delivery-reconciliation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          attemptId: sendUnknownAttemptId,
          outcome,
          confirmation: "verified_in_chatwoot",
        }),
      })
      const json = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        setSendError(json.error || `HTTP ${res.status}`)
        return
      }
      sendOperationRef.current = null
      setSendDeliveryUnknown(false)
      setSendUnknownAttemptId(null)
      setSendError(null)
      if (outcome === "delivered") setReplyText("")
      await fetchInbox()
    } catch (err) {
      setSendError((err as Error)?.message || "Network error")
    } finally {
      setSending(false)
    }
  }

  /* -- Compose -- */
  const handleCompose = async () => {
    if (!composeTo.trim() || !composeBody.trim()) return
    setComposeSending(true)
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          to: composeTo,
          body: composeBody,
          subject: composeSubject || undefined,
          channel: composeChannel,
          contactId: composeContactId || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setShowCompose(false)
        setComposeTo("")
        setComposeBody("")
        setComposeSubject("")
        setComposeContactId("")
        fetchInbox()
      }
    } catch (err) { console.error(err) } finally { setComposeSending(false) }
  }

  /* -- Mark as read -- */
  const markAsRead = async (convo: Conversation) => {
    const unreadIds = convo.messages
      .filter(m => m.direction === "inbound" && m.status !== "read")
      .map(m => m.id)
    if (unreadIds.length === 0) return
    try {
      await fetch("/api/v1/inbox", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ messageIds: unreadIds }),
      })
      fetchInbox()
    } catch (err) { console.error(err) }
  }

  /* -- Delete conversation -- */
  const deleteConvo = async (convo: Conversation) => {
    if (!confirm(t("deleteConversationConfirm"))) return
    const ids = convo.messages.map(m => m.id)
    try {
      await fetch("/api/v1/inbox", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ messageIds: ids }),
      })
      setSelected(null)
      fetchInbox()
    } catch (err) { console.error(err) }
  }

  /* -- Filtered list -- */
  const filtered = conversations.filter(c =>
    c.contactName.toLowerCase().includes(search.toLowerCase()) ||
    c.lastMessage.toLowerCase().includes(search.toLowerCase()) ||
    (c.contactEmail || "").toLowerCase().includes(search.toLowerCase())
  )

  const selectedConvo = selected !== null ? filtered[selected] : null

  /* -- Time formatter -- */
  const formatTime = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    }
    if (diff < 604800000) {
      return formatDate(d, locale, { weekday: "short" })
    }
    return formatDate(d, locale, { day: "numeric", month: "short" })
  }

  /* -- Loading skeleton -- */
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-9 w-40 bg-muted animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
        </div>
        <div className="h-[500px] bg-muted animate-pulse rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* -- Header -- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-lg">
            <InboxIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="inbox" /> <HelpButton slug="inbox-legacy" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLive(!isLive)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
              isLive ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700" : "bg-muted text-muted-foreground border-muted"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", isLive ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40")} />
            {isLive ? t("live") : t("paused")}
          </button>
          <Button className="gap-2" onClick={() => setShowCompose(true)}>
            <Plus className="h-4 w-4" /> {t("newMessage")}
          </Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />

      <DidYouKnow page="inbox" className="mb-4" />

      {/* -- Stats cards -- */}
      <div data-tour-id="inbox-stats" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard label={t("statMessages")} value={stats.totalMessages} icon={<MessageSquare className="h-4 w-4" />} hint={t("hintTotalMessages")} />
        <ColorStatCard label={t("statIncoming")} value={stats.inbound} icon={<ArrowDownLeft className="h-4 w-4" />} hint={t("hintInbound")} />
        <ColorStatCard label={t("statOutgoing")} value={stats.outbound} icon={<ArrowUpRight className="h-4 w-4" />} hint={t("hintOutbound")} />
        <ColorStatCard label={t("statConversations")} value={stats.conversations} icon={<MessageCircle className="h-4 w-4" />} hint={t("hintConversations")} />
      </div>

      {/* -- Channel filter tabs -- */}
      <div data-tour-id="inbox-channels" className="flex items-center gap-1 border-b pb-2">
        {CHANNELS.map(ch => (
          <button
            key={ch}
            onClick={() => { setChannelFilter(ch); setSelected(null) }}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              channelFilter === ch
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {ch === "all" ? tc("all") : channelLabel(ch)}
          </button>
        ))}
      </div>

      {/* -- Main layout: conversation list + thread -- */}
      <div className="flex gap-4 h-[calc(100vh-380px)] min-h-[400px]">
        {/* -- Left: conversation list -- */}
        <div data-tour-id="inbox-conversations" className="w-80 flex flex-col shrink-0">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1.5">
            {filtered.length > 0 ? (
              filtered.map((convo, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setSelected(idx)
                    setReplyChannel(convo.lastChannel || "email")
                    setSendError(null)
                    setSendDeliveryUnknown(false)
                    if (convo.unreadCount > 0) markAsRead(convo)
                  }}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors group",
                    selected === idx
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {/* Avatar circle */}
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                        selected === idx ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
                      )}>
                        {convo.contactName?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{convo.contactName}</div>
                        {convo.contactEmail && (
                          <div className={cn("text-[10px] truncate", selected === idx ? "opacity-70" : "text-muted-foreground")}>
                            {convo.contactEmail}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {convo.unreadCount > 0 && (
                        <Badge className="bg-red-500 text-white text-[10px] h-5 min-w-5 justify-center">
                          {convo.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className={cn("text-xs line-clamp-1 ml-10", selected === idx ? "opacity-80" : "text-muted-foreground")}>
                    {convo.lastMessage}
                  </div>

                  <div className="flex items-center justify-between mt-1.5 ml-10">
                    <div className="flex gap-1">
                      {convo.channels.map(ch => (
                        <span key={ch} className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium", channelColor(ch))}>
                          {channelIcon(ch)}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity p-0.5"
                        onClick={(e) => { e.stopPropagation(); deleteConvo(convo) }}
                        title={t("deleteConversation")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <span className={cn("text-[10px]", selected === idx ? "opacity-60" : "text-muted-foreground")}>
                        {formatTime(convo.lastMessageAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {channelFilter === "voip" ? (
                  <>
                    <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">VoIP / Call Logs</p>
                    <p className="text-xs mt-1">Call logs are available in Contacts &rarr; Calls tab</p>
                  </>
                ) : (
                  <>
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    {conversations.length === 0 ? t("noMessages") : t("noConversations")}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* -- Right: message thread -- */}
        <div data-tour-id="inbox-thread" className="flex-1 flex flex-col border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-card">
          {selectedConvo ? (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelected(null)}
                    className="lg:hidden p-1 hover:bg-muted rounded"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {selectedConvo.contactName?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{selectedConvo.contactName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {selectedConvo.contactEmail && <span>{selectedConvo.contactEmail}</span>}
                      {selectedConvo.contactPhone && <span>{selectedConvo.contactPhone}</span>}
                      <span>· {selectedConvo.messageCount} {t("msgCount")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedConvo.channels.map(ch => (
                    <Badge key={ch} variant="outline" className="text-[10px] gap-1">
                      {channelIcon(ch)} {channelLabel(ch)}
                    </Badge>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0"
                    onClick={() => deleteConvo(selectedConvo)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {selectedConvo.messages.slice().reverse().map(msg => (
                  <div key={msg.id} className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[75%] rounded-xl px-4 py-2.5",
                      msg.direction === "outbound"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted rounded-bl-sm"
                    )}>
                      {/* Channel badge */}
                      <div className={cn(
                        "flex items-center gap-1 text-[10px] mb-1",
                        msg.direction === "outbound" ? "opacity-60" : "text-muted-foreground"
                      )}>
                        {channelIcon(msg.channelType || "email")}
                        {channelLabel(msg.channelType || "email")}
                        {msg.direction === "inbound" && <span>· {t("from")} {msg.from}</span>}
                      </div>
                      {msg.subject && (
                        <div className={cn("text-xs font-medium mb-1", msg.direction === "outbound" ? "opacity-80" : "text-foreground")}>
                          {msg.subject}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                      <div className={cn(
                        "text-[10px] mt-1 flex items-center gap-1",
                        msg.direction === "outbound" ? "opacity-50 justify-end" : "text-muted-foreground"
                      )}>
                        {new Date(msg.createdAt).toLocaleString(undefined, {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                        })}
                        {msg.direction === "outbound" && (
                          <span
                            title={msg.metadata?.deliveryUnknown === true ? t("statusDeliveryUnknown") : msg.status === "delivered" ? t("statusDelivered") : msg.status === "failed" ? t("statusFailed") : t("statusSending")}
                            className={cn(
                            "ml-1",
                            msg.metadata?.deliveryUnknown === true ? "text-amber-300" : msg.status === "delivered" ? "text-green-300" : msg.status === "failed" ? "text-red-300" : ""
                          )}>
                            {msg.metadata?.deliveryUnknown === true ? "⚠" : msg.status === "delivered" ? "\u2713" : msg.status === "failed" ? "\u2717" : "\u23F3"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="px-4 py-3 border-t bg-muted/20">
                {sendError && (
                  <div className={cn(
                    "mb-2 rounded-md border px-3 py-2 text-xs",
                    sendDeliveryUnknown
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
                  )}>
                    {sendError}
                  </div>
                )}
                {sendDeliveryUnknown && sendUnknownAttemptId && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => reconcileChatwootDelivery("delivered")} disabled={sending}>
                      {locale === "ru" ? "Проверено: отправлено" : locale === "az" ? "Yoxlanılıb: göndərilib" : "Verified: delivered"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => reconcileChatwootDelivery("not_delivered")} disabled={sending}>
                      {locale === "ru" ? "Проверено: не отправлено" : locale === "az" ? "Yoxlanılıb: göndərilməyib" : "Verified: not delivered"}
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Select
                    value={replyChannel}
                    onChange={e => setReplyChannel(e.target.value)}
                    className="w-32 text-xs"
                  >
                    <option value="email">Email</option>
                    <option value="telegram">Telegram</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </Select>
                  <Input
                    placeholder={t("writeMessage")}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSendReply()}
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendReply}
                    disabled={sending || sendDeliveryUnknown || !replyText.trim()}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <InboxIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-muted-foreground font-medium">
                  {conversations.length === 0
                    ? t("noMessages")
                    : t("selectConversation")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {conversations.length === 0
                    ? t("selectConversationHint")
                    : t("clickToOpen")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* -- Compose dialog -- */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogHeader>
          <DialogTitle>{t("newMessageDialog")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">{tc("contact")}</Label>
              <Select
                value={composeContactId}
                onChange={e => {
                  const cid = e.target.value
                  setComposeContactId(cid)
                  const c = contacts.find(x => x.id === cid)
                  if (c) {
                    // Auto-fill `to` based on channel
                    if (composeChannel === "email" && c.email) setComposeTo(c.email)
                    else if (composeChannel === "sms" && c.phone) setComposeTo(c.phone)
                    else if (c.email) setComposeTo(c.email)
                    else if (c.phone) setComposeTo(c.phone)
                    else setComposeTo("")
                  }
                }}
                className="mt-1.5"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}{c.email ? ` \u00B7 ${c.email}` : ""}{c.phone ? ` \u00B7 ${c.phone}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">{t("channel")}</Label>
              <Select
                value={composeChannel}
                onChange={e => {
                  const ch = e.target.value
                  setComposeChannel(ch)
                  // Re-fill `to` from selected contact
                  const c = contacts.find(x => x.id === composeContactId)
                  if (c) {
                    if (ch === "email" && c.email) setComposeTo(c.email)
                    else if (ch === "sms" && c.phone) setComposeTo(c.phone)
                    else if (ch === "telegram" && c.phone) setComposeTo(c.phone)
                    else if (c.email) setComposeTo(c.email)
                    else setComposeTo(composeTo)
                  }
                }}
                className="mt-1.5"
              >
                <option value="email">Email</option>
                <option value="telegram">Telegram</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="vkontakte">VKontakte</option>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">
                {composeChannel === "email" ? t("emailAddress") : composeChannel === "sms" ? tc("phone") : composeChannel === "telegram" ? t("chatIdOrPhone") : tc("address")}
              </Label>
              <Input
                value={composeTo}
                onChange={e => setComposeTo(e.target.value)}
                placeholder={composeChannel === "email" ? "user@example.com" : composeChannel === "sms" ? t("phonePlaceholder") : t("chatIdOrPhone")}
                className="mt-1.5"
              />
            </div>
            {composeChannel === "email" && (
              <div>
                <Label className="text-sm font-medium">{t("topic")}</Label>
                <Input
                  value={composeSubject}
                  onChange={e => setComposeSubject(e.target.value)}
                  placeholder={t("subjectPlaceholder")}
                  className="mt-1.5"
                />
              </div>
            )}
            <div>
              <Label className="text-sm font-medium">{t("messageBody")}</Label>
              <Textarea
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
                placeholder={t("messageBodyPlaceholder")}
                rows={4}
                className="mt-1.5"
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCompose(false)}>{tc("cancel")}</Button>
          <Button
            onClick={handleCompose}
            disabled={composeSending || !composeTo.trim() || !composeBody.trim()}
            className="gap-1.5"
          >
            {composeSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {composeSending ? tc("sending") : tc("send")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
