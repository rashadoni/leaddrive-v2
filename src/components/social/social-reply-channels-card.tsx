"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Send } from "lucide-react"

interface ReplyChannel {
  platform: string
  liveSupported: boolean
  sendMode: string
  liveEnabled: boolean
  senderAccountId: string | null
  senderAccount: {
    id: string
    handle: string
    displayName: string | null
    connected: boolean
    outboundLiveEnabled: boolean
    outboundEmergencyStopped: boolean
    outboundCapability: string | null
    outboundVerifiedAt: string | null
  } | null
  liveReady: boolean
}

interface SenderOption {
  id: string
  platform: string
  handle: string
  displayName: string | null
  connected: boolean
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  vkontakte: "VK",
}

const SEND_MODES = ["approval", "auto", "dry_run"] as const

export function SocialReplyChannelsCard({ brandProtectionOnly = false }: { brandProtectionOnly?: boolean }) {
  const { data: session } = useSession()
  const t = useTranslations("socialMonitoring")
  const [channels, setChannels] = useState<ReplyChannel[]>([])
  const [senderOptions, setSenderOptions] = useState<SenderOption[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPlatform, setSavingPlatform] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const orgId = session?.user?.organizationId
  const hdrs = useCallback((): Record<string, string> =>
    orgId ? { "x-organization-id": String(orgId) } : {}, [orgId])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/social/ai-reply-settings", { headers: hdrs() })
      const json = await res.json()
      if (json?.success) {
        setChannels(json.data.channels ?? [])
        setSenderOptions(json.data.senderAccountOptions ?? [])
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false)
    }
  }, [hdrs])

  useEffect(() => { void load() }, [load])

  const save = async (platform: string, patch: { senderAccountId?: string | null; sendMode?: string; liveEnabled?: boolean }) => {
    setSavingPlatform(platform)
    setError(null)
    try {
      const res = await fetch("/api/v1/social/ai-reply-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...hdrs() },
        body: JSON.stringify({ platform, ...patch }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error || t("replyChannels.saveError"))
      }
      await load()
    } catch {
      setError(t("replyChannels.saveError"))
    } finally {
      setSavingPlatform(null)
    }
  }

  return (
    <Card className="rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <Send className="h-4 w-4" />
          </span>
          {t("replyChannels.title")}
        </CardTitle>
        <p className="text-sm font-normal normal-case text-muted-foreground">{t("replyChannels.desc")}</p>
      </CardHeader>
      <CardContent>
        {brandProtectionOnly && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {t("externalSendsDisabled")}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-500 mb-3">{error}</p>
        )}
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg bg-muted/50 p-3">
                <div className="h-9 w-28 rounded bg-muted" />
                <div className="h-9 min-w-[180px] flex-1 rounded bg-muted" />
                <div className="h-9 w-40 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => {
              const options = senderOptions.filter((o) => o.platform === ch.platform)
              const saving = savingPlatform === ch.platform
              return (
                <div key={ch.platform} className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="w-28 shrink-0">
                    <p className="text-sm font-medium">{PLATFORM_LABELS[ch.platform] ?? ch.platform}</p>
                    {ch.liveSupported ? (
                      <Badge variant={ch.liveReady ? "default" : "outline"} className="text-[10px] mt-1">
                        {ch.liveReady ? t("replyChannels.liveReady") : t("replyChannels.dryRunOnly")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] mt-1 opacity-70">
                        {t("replyChannels.notSupported")}
                      </Badge>
                    )}
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <Select
                      value={ch.senderAccountId ?? ""}
                      disabled={saving || options.length === 0}
                      onChange={(e) => void save(ch.platform, { senderAccountId: e.target.value || null })}
                      aria-label={t("replyChannels.senderAccount")}
                    >
                      <option value="">
                        {options.length === 0
                          ? t("replyChannels.connectHint")
                          : t("replyChannels.senderNone")}
                      </option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {(o.displayName || o.handle) + (o.connected ? "" : ` — ${t("replyChannels.tokenMissing")}`)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="w-40">
                    <Select
                      value={ch.sendMode}
                      disabled={saving || brandProtectionOnly}
                      onChange={(e) => void save(ch.platform, { sendMode: e.target.value })}
                      aria-label={t("replyChannels.sendMode")}
                    >
                      {(brandProtectionOnly ? ["dry_run"] as const : SEND_MODES).map((m) => (
                        <option key={m} value={m}>{t(`replyChannels.modes.${m}`)}</option>
                      ))}
                    </Select>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={ch.liveEnabled}
                      disabled={brandProtectionOnly || saving || !ch.liveSupported || (!ch.liveEnabled && !ch.senderAccount?.connected)}
                      onCheckedChange={(checked) => void save(ch.platform, { liveEnabled: checked })}
                    />
                    <span className="text-muted-foreground">{t("replyChannels.liveSend")}</span>
                  </label>
                  <Badge
                    variant={
                      ch.senderAccount?.outboundLiveEnabled &&
                      !ch.senderAccount?.outboundEmergencyStopped &&
                      ch.senderAccount?.outboundVerifiedAt
                        ? "success"
                        : "warning"
                    }
                    className="text-[10px]"
                  >
                    {ch.senderAccount?.outboundLiveEnabled &&
                    !ch.senderAccount?.outboundEmergencyStopped &&
                    ch.senderAccount?.outboundVerifiedAt
                      ? t("replyChannels.connectionVerified")
                      : t("replyChannels.connectionLocked")}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
