"use client"

/**
 * «Payment link» on the invoice card: copies the public invoice page for the
 * manager to send by WhatsApp or anywhere else. The hint says what the
 * customer will see — a card-payment button, or why there is none.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"

type PayLink = {
  url: string
  onlinePayment: { available: true; amount: number; currency: string } | { available: false; reason: string }
}

const REASON_HINT: Record<string, string> = {
  not_configured: "linkHintNotConfigured",
  inactive: "linkHintInactive",
  currency: "linkHintCurrency",
  nothing_due: "linkHintNothingDue",
  status: "linkHintStatus",
}

export function InvoicePayLinkButton({ invoiceId, refreshKey }: { invoiceId: string; refreshKey?: unknown }) {
  const t = useTranslations("onlinePayment")
  const [link, setLink] = useState<PayLink | null>(null)
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/pay-link`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled && body?.success) setLink(body.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [invoiceId, refreshKey])

  async function copy() {
    if (!link) {
      setState("failed")
      return
    }
    try {
      await navigator.clipboard.writeText(link.url)
      setState("copied")
    } catch {
      // A browser without clipboard access still lets the manager copy it by hand.
      window.prompt(t("copyInvoiceLink"), link.url)
      setState("idle")
    }
    window.setTimeout(() => setState("idle"), 2500)
  }

  const payable = link?.onlinePayment.available === true
  const hint = !link
    ? null
    : link.onlinePayment.available
      ? t("linkHintAvailable", {
        amount: link.onlinePayment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        currency: link.onlinePayment.currency,
      })
      : t(REASON_HINT[link.onlinePayment.reason] ?? "linkHintNotConfigured")

  return (
    <Hint text={hint}>
      <Button variant="outline" size="sm" onClick={() => void copy()} data-testid="invoice-pay-link">
        {state === "copied" ? <Check className="h-4 w-4 mr-1" aria-hidden="true" /> : <Link2 className="h-4 w-4 mr-1" aria-hidden="true" />}
        {state === "copied" ? t("linkCopied") : state === "failed" ? t("linkFailed") : payable ? t("copyPayLink") : t("copyInvoiceLink")}
      </Button>
    </Hint>
  )
}
