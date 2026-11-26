"use client"

/**
 * «Деньги по договору» at the top of the document chain (owner 2026-11-26,
 * mock, «Давай»): the value, what is invoiced (drafts apart), paid, the
 * customer's debt with what is overdue, a bar of the four, and what is left to
 * invoice. Invoices in another currency are a line of their own. The numbers
 * come from the server (src/lib/clm/contract-money.ts); this only shows them.
 */
import { useTranslations } from "next-intl"
import { Hint } from "@/components/hint"
import { moneyText } from "@/lib/clm/contract-documents"
import type { ContractMoney } from "@/lib/clm/contract-money"

const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0)

export function ContractMoneySummary({ money }: { money: ContractMoney }) {
  const t = useTranslations("contractDocuments")
  const cur = money.currency
  const m = (n: number) => `${moneyText(n)} ${cur}`
  // The bar's whole is the value, or — without one, or when invoiced beyond it — all that is invoiced.
  const whole = Math.max(money.value ?? 0, money.invoiced + money.drafts)
  const tile = (testId: string, label: string, hint: string, value: string, tone = "", sub?: string, subTone = "text-muted-foreground") => (
    <Hint text={hint} wrap>
      <div className="min-w-0 rounded-lg bg-muted/60 p-3" data-testid={testId} tabIndex={0}>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
        {sub && <div className={`text-xs ${subTone}`}>{sub}</div>}
      </div>
    </Hint>
  )

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="contract-money">
      <h3 className="text-sm font-semibold">{t("moneyTitle")}</h3>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tile("money-value", t("moneyValue"), t("moneyValueHint"), money.value === null ? "—" : m(money.value))}
        {tile("money-invoiced", t("moneyInvoiced"), t("moneyInvoicedHint"), m(money.invoiced), "",
          [t("moneyInvoicedCount", { count: money.invoicedCount }), money.drafts > 0 ? t("moneyDrafts", { amount: m(money.drafts) }) : null].filter(Boolean).join(" · "))}
        {tile("money-paid", t("moneyPaid"), t("moneyPaidHint"), m(money.paid), money.paid > 0 ? "text-emerald-700 dark:text-emerald-400" : "")}
        {tile("money-debt", t("moneyDebt"), t("moneyDebtHint"), m(money.debt), money.debt > 0 ? "text-red-700 dark:text-red-400" : "",
          money.overdue > 0 ? t("moneyOverdue", { amount: m(money.overdue) }) : undefined, "text-red-700 dark:text-red-400")}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="bg-emerald-500" style={{ width: `${pct(money.paid, whole)}%` }} />
        <div className="bg-red-500" style={{ width: `${pct(money.debt, whole)}%` }} />
        <div className="bg-muted-foreground/40" style={{ width: `${pct(money.drafts, whole)}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span data-testid="money-remaining">
          {money.value === null
            ? <span className="text-muted-foreground">{t("moneyNoValue")}</span>
            : <Hint text={t("moneyRemainingHint")}><span tabIndex={0}>{t("moneyRemaining", { amount: m(money.remaining ?? 0) })}</span></Hint>}
        </span>
        {money.overInvoiced > 0 && (
          <span className="font-medium text-red-700 dark:text-red-400" data-testid="money-over">{t("moneyOver", { amount: m(money.overInvoiced) })}</span>
        )}
      </div>
      {money.other.map((o) => (
        <p key={o.currency} className="text-xs text-muted-foreground" data-testid={`money-other-${o.currency}`}>
          {t("moneyOther", {
            currency: o.currency,
            invoiced: `${moneyText(o.invoiced)} ${o.currency}`,
            paid: `${moneyText(o.paid)} ${o.currency}`,
            debt: `${moneyText(o.debt)} ${o.currency}`,
          })}
        </p>
      ))}
    </div>
  )
}
