"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale } from "next-intl"
import { ArrowLeft, CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { tiktokNativeCopy, tiktokReturnMessages } from "./tiktok-native-messaging-copy"

const STATUS_URL = "/api/v1/channels/tiktok-messaging"
type Locale = keyof typeof tiktokNativeCopy
type Copy = (typeof tiktokNativeCopy)[Locale]
type MessagingStatus = {
  configured: boolean
  status: string
  capabilities: { read?: boolean; reply?: boolean; webhook?: boolean }
  webhookSubscribed: boolean
  lastInboundAt: string | null
  tokenExpiresAt: string | null
}
type Notice = { kind: "info" | "error"; text: string }

function connectionView(data: MessagingStatus, c: Copy) {
  if (!data.configured) return { title: c.unavailable, hint: c.unavailableHint, variant: "warning" as const }
  if (data.status === "disabled") return { title: c.disabled, hint: c.disabledHint, variant: "outline" as const }
  if (data.status === "pending") return { title: c.pending, hint: c.pendingHint, variant: "warning" as const }
  if (data.status !== "connected" || data.capabilities.read !== true || data.capabilities.reply !== true) {
    return { title: c.needsAccess, hint: c.needsAccessHint, variant: "warning" as const }
  }
  if (data.webhookSubscribed !== true || data.capabilities.webhook !== true) {
    return { title: c.webhookPending, hint: c.webhookPendingHint, variant: "warning" as const }
  }
  return { title: c.connected, hint: c.connectedHint, variant: "success" as const }
}

function dateLabel(value: string | null, locale: Locale, fallback: string) {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function TikTokNativeMessagingSettings() {
  const locale = useLocale()
  const lang: Locale = locale.startsWith("ru") ? "ru" : locale.startsWith("az") ? "az" : "en"
  const c = tiktokNativeCopy[lang]
  const { data: session, status } = useSession()
  const canManage = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  const orgId = session?.user?.organizationId

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link href="/settings/channels" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{c.back}
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{c.subtitle}</p>
      </header>
      {status === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">{c.loading}</p>
      ) : !canManage || !orgId ? (
        <Card className="p-6"><p role="alert" className="text-sm">{c.adminOnly}</p></Card>
      ) : (
        // A workspace change unmounts the previous state and aborts its requests.
        <NativeConnection key={orgId} orgId={orgId} locale={lang} c={c} />
      )}
    </div>
  )
}

function NativeConnection({ orgId, locale, c }: { orgId: string; locale: Locale; c: Copy }) {
  const searchParams = useSearchParams()
  const result = searchParams.get("result")
  const returnMessage = result ? c[tiktokReturnMessages[result] ?? "authorizationFailed"] : null
  const [data, setData] = useState<MessagingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<"connect" | "disconnect" | "subscribe" | null>(null)
  const [revision, setRevision] = useState(0)
  const mutationController = useRef<AbortController | null>(null)

  useEffect(() => () => mutationController.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)
    async function load() {
      try {
        const response = await fetch(STATUS_URL, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
          headers: { "x-organization-id": orgId },
        })
        if (!response.ok) {
          setLoadError(response.status === 401 ? c.adminOnly : response.status === 403 ? c.denied : c.loadFailed)
          return
        }
        const body = await response.json()
        if (!body || typeof body.configured !== "boolean" || typeof body.status !== "string"
          || !body.capabilities || typeof body.capabilities !== "object" || Array.isArray(body.capabilities)) {
          throw new Error("invalid_status_response")
        }
        if (!controller.signal.aborted) setData(body)
      } catch {
        if (!controller.signal.aborted) setLoadError(c.loadFailed)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [orgId, revision, c])

  async function mutate(action: "connect" | "disconnect" | "subscribe") {
    if (loading || loadError || pending || !data || (action !== "disconnect" && !data.configured)) return
    const controller = new AbortController()
    mutationController.current = controller
    setPending(action)
    setNotice(null)
    try {
      const response = await fetch(action === "connect" ? `${STATUS_URL}/oauth/start` : STATUS_URL, {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: action === "connect" ? undefined : JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice({ kind: "error", text: response.status === 401 ? c.adminOnly : response.status === 403 ? c.denied : action === "connect" ? c.connectFailed : c.actionFailed })
        return
      }
      if (action === "connect") {
        if (typeof body?.authorizationUrl !== "string") throw new Error("missing_authorization_url")
        const url = new URL(body.authorizationUrl)
        if (url.protocol !== "https:" || url.username || url.password || url.port
          || !["www.tiktok.com", "business-api.tiktok.com", "ads.tiktok.com"].includes(url.hostname)) {
          throw new Error("invalid_authorization_url")
        }
        window.location.assign(url.toString())
        return
      }
      if (body?.success !== true) throw new Error("unconfirmed_action")
      setNotice({ kind: "info", text: action === "disconnect" ? c.disconnected : c.subscribed })
      setRevision(value => value + 1)
    } catch {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: action === "connect" ? c.connectFailed : c.actionFailed })
    } finally {
      if (!controller.signal.aborted) setPending(null)
    }
  }

  const view = data ? connectionView(data, c) : null
  const available = Boolean(data?.configured && data.status === "connected")
  const hasConnection = Boolean(data && data.status !== "disabled" && (
    data.status === "connected" || data.status === "pending" || data.tokenExpiresAt || data.lastInboundAt
    || data.capabilities.read || data.capabilities.reply
  ))
  const busy = loading || pending !== null
  const canRetryDelivery = available && data?.capabilities.read === true && data.capabilities.reply === true
    && (!data.webhookSubscribed || !data.capabilities.webhook)
  const checks = data ? [
    { label: c.read, ready: available && data.capabilities.read === true },
    { label: c.reply, ready: available && data.capabilities.reply === true },
    { label: c.delivery, ready: available && data.webhookSubscribed === true && data.capabilities.webhook === true },
  ] : []

  return (
    <div className="space-y-5">
      {returnMessage && !notice ? (
        <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">{returnMessage}</p>
      ) : null}
      {notice ? (
        <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error"
          ? "rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          : "rounded-xl border bg-muted/40 p-4 text-sm"}>{notice.text}</p>
      ) : null}
      <Card aria-busy={busy}>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{c.status}</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{c.refresh}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? <p role="status" className="text-sm text-muted-foreground">{c.loading}</p> : loadError ? (
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
          ) : data && view ? (
            <>
              <div className="space-y-3">
                <Badge variant={view.variant}>{view.title}</Badge>
                <p className="text-sm leading-6 text-muted-foreground">{view.hint}</p>
              </div>
              <ul className="space-y-3 border-t pt-4">
                {checks.map(check => (
                  <li key={check.label} className="flex items-center justify-between gap-4 text-sm">
                    <span>{check.label}</span>
                    <span className={`inline-flex items-center gap-2 text-right ${check.ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      {check.ready ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      {check.ready ? c.enabled : c.notEnabled}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-3 border-t pt-4 text-sm">
                <div className="space-y-1"><dt className="text-muted-foreground">{c.lastInbound}</dt><dd>{dateLabel(data.lastInboundAt, locale, c.noInbound)}</dd></div>
                <div className="space-y-1"><dt className="text-muted-foreground">{c.tokenExpiry}</dt><dd>{dateLabel(data.tokenExpiresAt, locale, c.noExpiry)}</dd></div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">{c.tokenHint}</p>
            </>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t pt-4">
            <Button onClick={() => void mutate("connect")} disabled={busy || Boolean(loadError) || !data?.configured}>
              {pending === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {hasConnection ? c.reconnect : c.connect}
            </Button>
            <Button variant="outline" onClick={() => void mutate("disconnect")} disabled={busy || Boolean(loadError) || !hasConnection}>
              {pending === "disconnect" ? c.working : c.disconnect}
            </Button>
            {canRetryDelivery ? (
              <Button variant="outline" onClick={() => void mutate("subscribe")} disabled={busy || Boolean(loadError)}>
                {pending === "subscribe" ? c.working : c.subscribe}
              </Button>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{c.disconnectHint}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{c.requirements}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>{c.approval}</p><p>{c.textOnly}</p>
        </CardContent>
      </Card>
    </div>
  )
}
