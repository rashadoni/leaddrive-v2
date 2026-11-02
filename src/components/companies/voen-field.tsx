"use client"

/**
 * VÖEN on the company form: ten digits, a warning when another company of the
 * organization already has it, and «VÖEN ilə doldur» — the card from the tax
 * registry, copied into the form only on «Formaya köçür». The owner approved
 * this look as a mockup on 2026-10-24.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Check, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Hint } from "@/components/hint"

export interface TaxpayerCardView {
  voen: string
  name: string
  legalForm: string | null
  legalAddress: string | null
  director: string | null
  active: boolean | null
  vatPayer: boolean | null
}

interface Duplicate { id: string; name: string }

const ERROR_KEYS: Record<string, string> = {
  INVALID_VOEN: "errInvalid",
  NOT_FOUND: "errNotFound",
  REGISTRY_UNAVAILABLE: "errUnavailable",
}

export function VoenField({
  value, onChange, companyId, orgId, onApply,
}: {
  value: string
  onChange: (value: string) => void
  companyId?: string
  orgId?: string
  onApply: (card: TaxpayerCardView) => void
}) {
  const t = useTranslations("companyVoen")
  const [card, setCard] = useState<TaxpayerCardView | null>(null)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const digits = value.replace(/\D/g, "")
  const valid = digits.length === 10
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) }

  async function checkDuplicate() {
    if (!valid) {
      setDuplicate(null)
      return
    }
    const query = new URLSearchParams({ voen: digits, ...(companyId ? { exclude: companyId } : {}) })
    const body = await fetch(`/api/v1/companies/by-voen?${query}`, { headers }).then((r) => r.json()).catch(() => null)
    setDuplicate(body?.data?.duplicate ?? null)
  }

  async function lookup() {
    setBusy(true)
    setError("")
    setCard(null)
    const response = await fetch("/api/v1/companies/registry-lookup", {
      method: "POST",
      headers,
      body: JSON.stringify({ voen: digits, exclude: companyId ?? null }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    setDuplicate(body?.duplicate ?? body?.data?.duplicate ?? null)
    if (response?.ok && body?.data?.card) setCard(body.data.card)
    else setError(t(ERROR_KEYS[body?.code] ?? "errUnavailable"))
  }

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="voen">VÖEN</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="voen"
            inputMode="numeric"
            value={value}
            placeholder="1234567891"
            onChange={(e) => {
              onChange(e.target.value)
              setCard(null)
              setError("")
            }}
            onBlur={() => void checkDuplicate()}
          />
          <Hint text={valid ? t("fillHint") : t("errInvalid")} wrap>
            <Button type="button" variant="outline" className="shrink-0" disabled={!valid || busy} onClick={() => void lookup()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {t("fill")}
            </Button>
          </Hint>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{value && !valid ? t("errInvalid") : t("hint")}</p>
      </div>

      {duplicate ? (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {t("duplicate", { name: duplicate.name })}{" "}
            <a href={`/companies/${duplicate.id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">{t("openCard")}</a>
          </span>
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive" role="status">{error}</p> : null}

      {card ? (
        <div className="rounded-md border p-3" data-testid="registry-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("found")}</span>
            <span className="flex gap-1.5 text-xs">
              {card.active !== null ? (
                <span className={card.active ? "rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "rounded-md bg-red-50 px-2 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200"}>
                  {card.active ? t("active") : t("inactive")}
                </span>
              ) : null}
              {card.vatPayer ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("vatPayer")}</span> : null}
            </span>
          </div>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("name")}</dt><dd>{card.name}</dd>
            {card.legalAddress ? <><dt className="text-muted-foreground">{t("legalAddress")}</dt><dd>{card.legalAddress}</dd></> : null}
            {card.director ? <><dt className="text-muted-foreground">{t("director")}</dt><dd>{card.director}</dd></> : null}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t("keepsTyped")}</p>
          <Hint text={t("applyHint")}>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => onApply(card)}>
              <Check className="h-4 w-4" aria-hidden="true" />{t("apply")}
            </Button>
          </Hint>
        </div>
      ) : null}
    </div>
  )
}
