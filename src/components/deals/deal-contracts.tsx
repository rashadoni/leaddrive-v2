"use client"

/**
 * The deal's contracts, in the «Satış» section of the deal page, and the way
 * to make one: «Müqavilə hazırla» opens the contract wizard with this deal —
 * its company, amount and currency come along (src/components/contracts/contract-wizard.tsx).
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { FilePlus2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"

interface Row { id: string; contractNumber: string; title: string; status: string }

export function DealContracts({ dealId, canCreate }: { dealId: string; canCreate: boolean }) {
  const t = useTranslations("contractWizard")
  const tct = useTranslations("contracts")
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/contracts?dealId=${encodeURIComponent(dealId)}&limit=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => !cancelled && setRows((json?.data?.contracts as Row[] | undefined) ?? []))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [dealId])

  const statusLabel = (status: string) => {
    const key = `status${status.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("")}`
    return tct.has(key as "statusDraft") ? tct(key as "statusDraft") : status
  }

  return (
    <div className="space-y-3" data-testid="deal-contracts">
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dealNoContracts")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <Link href={`/contracts/${row.id}`} className="min-w-0 break-words font-medium hover:underline">
                {row.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {row.contractNumber} · {statusLabel(row.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <Hint text={t("dealCreateHint")}>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={`/contracts/new?deal=${encodeURIComponent(dealId)}`}>
              <FilePlus2 className="h-4 w-4" /> {t("dealCreate")}
            </Link>
          </Button>
        </Hint>
      )}
    </div>
  )
}
