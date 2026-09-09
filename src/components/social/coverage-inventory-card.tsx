"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Download, Map as MapIcon, RefreshCw, Loader2 } from "lucide-react"
import type {
  CapabilityInventoryRow,
  CapabilityReadinessStatus,
  CapabilityInventorySummary,
} from "@/lib/social/capability-inventory"

interface InventoryResponse {
  version: string
  generatedAt: string
  organizationId: string
  organizationName: string | null
  summary: CapabilityInventorySummary
  rows: CapabilityInventoryRow[]
}

interface Props {
  orgId: string | number | undefined
}

const STATUS_TONE: Record<CapabilityReadinessStatus, string> = {
  PRODUCTION_VERIFIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  SANDBOX_VERIFIED: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  CONFIGURED: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  IMPLEMENTED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  BLOCKED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
}

const STATUS_ORDER: CapabilityReadinessStatus[] = [
  "PRODUCTION_VERIFIED",
  "SANDBOX_VERIFIED",
  "CONFIGURED",
  "IMPLEMENTED",
  "BLOCKED",
]

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
  vkontakte: "VK",
  twitter: "X (Twitter)",
  linkedin: "LinkedIn",
  web: "Web",
}

export function CoverageInventoryCard({ orgId }: Props) {
  const t = useTranslations("socialMonitoring.coverage")
  const [data, setData] = useState<InventoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(() => {
    if (!orgId) return
    setLoading(true)
    setError(false)
    fetch("/api/v1/social/coverage-contract", { headers: { "x-organization-id": String(orgId) } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((res) => {
        if (res.success) setData(res.data as InventoryResponse)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  const exportContract = useCallback(async () => {
    if (!orgId) return
    setExporting(true)
    try {
      const res = await fetch("/api/v1/social/coverage-contract?format=markdown", {
        headers: { "x-organization-id": String(orgId) },
      })
      if (!res.ok) throw new Error(String(res.status))
      const text = await res.text()
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `coverage-contract-${(data?.generatedAt ?? "").slice(0, 10) || "latest"}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError(true)
    } finally {
      setExporting(false)
    }
  }, [orgId, data])

  if (loading) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t("loadError")}</span>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs hover:bg-muted dark:border-zinc-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("refresh")}
          </button>
        </div>
      </section>
    )
  }

  const platforms = Array.from(new Set(data.rows.map((r) => r.platform)))

  return (
    <section className="rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("subtitle")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("liveSendNote")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-muted dark:border-zinc-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("refresh")}
          </button>
          <button
            type="button"
            onClick={exportContract}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {t("export")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-700">
        <span className="text-muted-foreground">{t("summaryLabel")}:</span>
        {STATUS_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[status]}`}>
              {t(`status.${status}`)}
            </span>
            <b className="tabular-nums">{data.summary.byStatus[status]}</b>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("colPlatform")}</th>
              <th className="px-3 py-2 font-medium">{t("colCapability")}</th>
              <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
              <th className="px-3 py-2 font-medium">{t("colEngagement")}</th>
              <th className="px-3 py-2 font-medium">{t("colIdentity")}</th>
              <th className="px-3 py-2 font-medium">{t("colHistory")}</th>
              <th className="px-3 py-2 font-medium">{t("colLatency")}</th>
              <th className="px-3 py-2 font-medium">{t("colProof")}</th>
              <th className="px-3 py-2 font-medium">{t("colLimitation")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {platforms.map((platform) =>
              data.rows
                .filter((r) => r.platform === platform)
                .map((row, index) => (
                  <tr key={`${row.platform}:${row.capability}:${row.ownership}`}>
                    <td className="px-3 py-2.5 font-medium">{index === 0 ? PLATFORM_LABEL[platform] ?? platform : ""}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px]">{row.capability}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {row.ownership === "OWNED" ? t("ownedLabel") : t("externalLabel")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[row.status]}`}>
                        {t(`status.${row.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">{row.engagementMode}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.senderIdentity}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.historicalDepth}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.latency}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.proof
                        ? [
                            row.proof.providerKey,
                            row.proof.verifiedAt
                              ? `${t("proofVerified")} ${row.proof.verifiedAt.slice(0, 10)}`
                              : row.proof.sandboxVerifiedAt
                                ? `${t("proofSandbox")} ${row.proof.sandboxVerifiedAt.slice(0, 10)}`
                                : null,
                            row.proof.expiresAt
                              ? `${row.proof.expired ? t("proofExpired") : t("proofExpires")} ${row.proof.expiresAt.slice(0, 10)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : t("proofNone")}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.limitation}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
