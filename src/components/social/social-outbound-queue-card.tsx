"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Check, RefreshCw, Send, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type OutboundRow = {
  id: string
  state: string
  platform: string
  replyText: string
  requestedBy: string
  createdAt: string
  adapterType: string
  lastError: string | null
  mention: { text: string; url: string | null; authorName: string | null; authorHandle: string | null }
  subject: { name: string }
  senderAccount: { handle: string; displayName: string | null }
}

type OutboundPolicy = {
  liveEnabled: boolean
  emergencyStopped: boolean
  allowedPlatforms: string[]
  releaseReviewedAt: string | null
  globalLiveEnabled: boolean
  globalKillSwitch: boolean
}

export function SocialOutboundQueueCard() {
  const { data: session } = useSession()
  const t = useTranslations("socialMonitoring.outbound")
  const [rows, setRows] = useState<OutboundRow[]>([])
  const [policy, setPolicy] = useState<OutboundPolicy | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const orgId = session?.user?.organizationId
  const reviewerId = session?.user?.id
  const canApprove = session?.user?.role === "admin" || session?.user?.role === "manager"
  const headers = useCallback((): Record<string, string> => orgId ? { "x-organization-id": String(orgId) } : {}, [orgId])

  const load = useCallback(async () => {
    const [rowsRes, policyRes] = await Promise.all([
      fetch("/api/v1/social/outbound-replies", { headers: headers() }),
      fetch("/api/v1/social/outbound-policy", { headers: headers() }),
    ])
    const [rowsJson, policyJson] = await Promise.all([rowsRes.json().catch(() => ({})), policyRes.json().catch(() => ({}))])
    if (rowsJson.success) setRows(rowsJson.data ?? [])
    if (policyJson.success) setPolicy(policyJson.data)
  }, [headers])

  useEffect(() => { void load() }, [load])

  const review = async (id: string, decision: "APPROVED" | "REJECTED") => {
    setBusy(id)
    try {
      const response = await fetch(`/api/v1/social/outbound-replies/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ decision }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.success) {
        toast.error(json.error || t("reviewFailed"))
        return
      }
      toast.success(decision === "APPROVED" ? t("approved") : t("rejected"))
      await load()
    } catch {
      toast.error(t("reviewFailed"))
    } finally {
      setBusy(null)
    }
  }

  const gates = policy ? [
    { label: t("gates.global"), open: policy.globalLiveEnabled && !policy.globalKillSwitch },
    { label: t("gates.tenant"), open: policy.liveEnabled && !policy.emergencyStopped && Boolean(policy.releaseReviewedAt) },
    { label: t("gates.platform"), open: policy.allowedPlatforms.length > 0 },
    { label: t("gates.approval"), open: true },
  ] : []

  return (
    <Card className="rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <ShieldCheck className="h-4 w-4" />
          </span>
          {t("title")}
        </CardTitle>
        <p className="text-sm font-normal normal-case text-muted-foreground">{t("desc")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {gates.map(gate => (
            <div key={gate.label} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <span>{gate.label}</span>
              <Badge variant={gate.open ? "success" : "warning"}>{gate.open ? t("open") : t("closed")}</Badge>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("queueTitle", { count: rows.length })}</h3>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="space-y-2">
            {rows.map(row => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{row.platform}</Badge>
                      <Badge variant={row.state === "SENT" ? "success" : row.state === "RECONCILIATION_REQUIRED" ? "destructive" : "secondary"}>
                        {t(`states.${row.state}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{row.subject.name} · {row.senderAccount.displayName || row.senderAccount.handle}</span>
                    </div>
                    <p className="mt-2 text-sm">{row.replyText}</p>
                    {row.lastError && <p className="mt-1 text-xs text-red-500">{row.lastError}</p>}
                  </div>
                  {row.state === "PENDING" && canApprove && reviewerId !== row.requestedBy && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => void review(row.id, "REJECTED")}>
                        <X className="mr-1 h-3.5 w-3.5" /> {t("reject")}
                      </Button>
                      <Button size="sm" disabled={busy === row.id} onClick={() => void review(row.id, "APPROVED")}>
                        <Check className="mr-1 h-3.5 w-3.5" /> {t("approve")}
                      </Button>
                    </div>
                  )}
                  {row.state === "QUEUED" && <Send className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
