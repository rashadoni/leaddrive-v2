"use client"

import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, WifiOff, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { ContactTransferReceipt } from "@/lib/mtm/contact-transfer-receipt"

export function ContactTransferReceiptPanel({
  receipt,
  online,
  storedOnDevice,
  verifying,
  onVerify,
  onDismiss,
}: {
  receipt: ContactTransferReceipt
  online: boolean
  storedOnDevice: boolean
  verifying: boolean
  onVerify: () => void
  onDismiss: () => void
}) {
  const t = useTranslations("mtmContactExplorer")
  const mismatched = receipt.reconciliation.status === "MISMATCH"

  return (
    <section
      aria-label={t("transferReceipt.title")}
      className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{t("transferReceipt.title")}</h2>
            {!storedOnDevice ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                <AlertTriangle className="h-3 w-3" />
                {t("transferReceipt.notStored")}
              </span>
            ) : !online ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <WifiOff className="h-3 w-3" />
                {t("transferReceipt.savedOffline")}
              </span>
            ) : mismatched ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                <AlertTriangle className="h-3 w-3" />
                {t("transferReceipt.needsAttention")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
                <CheckCircle2 className="h-3 w-3" />
                {t("transferReceipt.verified")}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{receipt.sourceAgent?.name || "—"}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{receipt.targetAgent?.name || "—"}</span>
            <span className="text-xs text-muted-foreground">{receipt.effectiveFrom}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("transferReceipt.summary", {
              transferred: receipt.summary.transferred,
              excluded: receipt.summary.excluded,
            })}
          </p>
          <p className={`mt-1 text-xs ${mismatched ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
            {!storedOnDevice
              ? t("transferReceipt.notStoredDescription")
              : !online
              ? t("transferReceipt.offlineDescription")
              : mismatched
                ? t("transferReceipt.mismatchDescription", {
                  verified: receipt.reconciliation.verified,
                  expected: receipt.reconciliation.expected,
                })
                : t("transferReceipt.verifiedDescription", { count: receipt.reconciliation.verified })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-9"
            onClick={onVerify}
            disabled={!online || verifying}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${verifying ? "animate-spin" : ""}`} />
            {verifying ? t("transferReceipt.verifying") : t("transferReceipt.verify")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-9 sm:w-9"
            onClick={onDismiss}
            aria-label={t("transferReceipt.dismiss")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  )
}
