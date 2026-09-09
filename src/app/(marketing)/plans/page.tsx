"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { plans } from "@/lib/marketing-data"
import { Check, Minus, ArrowRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/* ─── full feature comparison matrix ─── */
type FeatureRow = { label: string; starter: boolean; business: boolean; professional: boolean; enterprise: boolean; custom?: boolean }

type CompareRow = { key: string; starter: boolean; business: boolean; professional: boolean; enterprise: boolean }
const comparisonData: { titleKey: string; rows: CompareRow[] }[] = [
  {
    titleKey: "sales_crm",
    rows: [
      { key: "dashboard_kpi", starter: true, business: true, professional: true, enterprise: true },
      { key: "companies_contacts", starter: true, business: true, professional: true, enterprise: true },
      { key: "deals_pipeline", starter: true, business: true, professional: true, enterprise: true },
      { key: "leads_scoring", starter: true, business: true, professional: true, enterprise: true },
      { key: "tasks_calendar", starter: true, business: true, professional: true, enterprise: true },
      { key: "product_catalog", starter: true, business: true, professional: true, enterprise: true },
      { key: "contracts", starter: false, business: true, professional: true, enterprise: true },
      { key: "invoices_payments", starter: false, business: false, professional: true, enterprise: true },
      { key: "offers", starter: false, business: false, professional: true, enterprise: true },
    ],
  },
  {
    titleKey: "mkt",
    rows: [
      { key: "campaign_manager", starter: false, business: false, professional: true, enterprise: true },
      { key: "email_templates", starter: false, business: false, professional: true, enterprise: true },
      { key: "flow_editor", starter: false, business: false, professional: true, enterprise: true },
      { key: "segments", starter: false, business: false, professional: true, enterprise: true },
      { key: "events_reg", starter: false, business: false, professional: true, enterprise: true },
      { key: "campaign_roi", starter: false, business: false, professional: true, enterprise: true },
    ],
  },
  {
    titleKey: "support",
    rows: [
      { key: "ticket_mgmt", starter: false, business: true, professional: true, enterprise: true },
      { key: "sla", starter: false, business: true, professional: true, enterprise: true },
      { key: "agent_desktop", starter: false, business: true, professional: true, enterprise: true },
      { key: "kb", starter: false, business: true, professional: true, enterprise: true },
      { key: "portal", starter: false, business: false, professional: false, enterprise: true },
    ],
  },
  {
    titleKey: "comm",
    rows: [
      { key: "email_integration", starter: true, business: true, professional: true, enterprise: true },
      { key: "inbox_7ch", starter: false, business: false, professional: false, enterprise: true },
      { key: "smtp", starter: false, business: false, professional: false, enterprise: true },
    ],
  },
  {
    titleKey: "analytics_finance",
    rows: [
      { key: "reports", starter: false, business: false, professional: true, enterprise: true },
      { key: "cost_engine", starter: false, business: false, professional: false, enterprise: true },
      { key: "profitability", starter: false, business: false, professional: false, enterprise: true },
      { key: "budgeting_pl", starter: false, business: false, professional: false, enterprise: true },
      { key: "finance_full", starter: false, business: false, professional: false, enterprise: true },
      { key: "dynamic_pricing", starter: false, business: false, professional: false, enterprise: true },
    ],
  },
  {
    titleKey: "davinci",
    rows: [
      { key: "dv_scoring", starter: false, business: false, professional: true, enterprise: true },
      { key: "dv_sales", starter: false, business: false, professional: false, enterprise: true },
      { key: "dv_center", starter: false, business: false, professional: false, enterprise: true },
      { key: "dv_support", starter: false, business: false, professional: false, enterprise: true },
    ],
  },
  {
    titleKey: "platform",
    rows: [
      { key: "roles", starter: false, business: true, professional: true, enterprise: true },
      { key: "workflows", starter: false, business: false, professional: true, enterprise: true },
      { key: "custom_fields", starter: false, business: false, professional: false, enterprise: true },
      { key: "audit", starter: false, business: false, professional: false, enterprise: true },
      { key: "api", starter: false, business: false, professional: false, enterprise: true },
      { key: "erp", starter: false, business: false, professional: true, enterprise: true },
      { key: "languages", starter: true, business: true, professional: true, enterprise: true },
      { key: "dark_mode", starter: true, business: true, professional: true, enterprise: true },
    ],
  },
]

const planNames = ["Starter", "Business", "Professional", "Enterprise", "50+"] as const
const planKeys = ["starter", "business", "professional", "enterprise", "custom"] as const

export default function PricingPage() {
  const tp = useTranslations("marketing.pricing")
  const tc = useTranslations("marketing.pricing.compare")
  const tf = useTranslations("marketing.pricing.features")
  const tfaq = useTranslations("marketing.faq")
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly")
  const isAnnual = billing === "annual"

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-white via-[#F3F4F7] to-white pt-20 pb-16">
        <div className="mx-auto max-w-5xl px-4 lg:px-8 text-center">
          <h1 className="text-4xl lg:text-5xl font-bold text-[#001E3C]">
            {tp("sectionTitle")}
          </h1>
          <p className="mt-4 text-lg text-[#001E3C]/60 max-w-2xl mx-auto">
            {tp("sectionDescription")}
          </p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center gap-3 bg-white rounded-full border border-[#001E3C]/10 p-1 shadow-sm">
            <button
              onClick={() => setBilling("monthly")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all",
                !isAnnual
                  ? "bg-[#EA580C] text-white shadow-sm"
                  : "text-[#001E3C]/60 hover:text-[#001E3C]"
              )}
            >
              {tp("monthly")}
            </button>
            <button
              onClick={() => setBilling("annual")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                isAnnual
                  ? "bg-[#EA580C] text-white shadow-sm"
                  : "text-[#001E3C]/60 hover:text-[#001E3C]"
              )}
            >
              {tp("annual")}
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                isAnnual
                  ? "bg-white/20 text-white"
                  : "bg-green-50 text-green-600"
              )}>
                -10%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Plan cards */}
      <section className="pb-16 -mt-4">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {plans.map((plan) => {
              const perUser = isAnnual ? plan.pricePerUserAnnual : plan.pricePerUser
              const total = perUser !== null && plan.maxUsers !== null
                ? perUser * plan.maxUsers
                : null

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative rounded-xl border p-6 flex flex-col bg-white",
                    plan.popular
                      ? "border-[#EA580C] shadow-lg shadow-[#EA580C]/10 ring-1 ring-[#EA580C]"
                      : "border-[#001E3C]/10"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-[#EA580C] text-white text-xs font-semibold px-3 py-1 rounded-full">
                        {tp("popular")}
                      </span>
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-[#001E3C]">{tp(`${plan.id}.name`)}</h3>
                  <p className="text-sm text-[#001E3C]/60 mt-1 mb-4">{tp(`${plan.id}.tagline`)}</p>

                  {/* Price — per-user focused */}
                  <div className="mb-1">
                    {perUser !== null ? (
                      <div className="flex items-baseline gap-1.5">
                        {isAnnual && plan.pricePerUser !== null && (
                          <span className="text-base text-[#001E3C]/30 line-through">{plan.pricePerUser}</span>
                        )}
                        <span className="text-2xl font-semibold text-[#001E3C]">{perUser}</span>
                        <span className="text-xs text-[#001E3C]/40">AZN / {tp("perUser")}</span>
                      </div>
                    ) : (
                      <span className="text-lg font-semibold text-[#001E3C]">{tp("custom.tagline")}</span>
                    )}
                  </div>

                  {/* Total cost — subtle */}
                  {total !== null && plan.maxUsers !== null ? (
                    <p className="text-xs text-[#001E3C]/40 mb-4">
                      {plan.maxUsers} {tp("perUser").split("/")[0]}: {total.toLocaleString()} AZN
                    </p>
                  ) : (
                    <p className="text-xs text-[#001E3C]/40 mb-4">&nbsp;</p>
                  )}

                  <ul className="space-y-2 flex-1">
                    {plan.features.map((fKey) => (
                      <li key={fKey} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-[#EA580C] mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-[#001E3C]/80">{tp(`features.${fKey}`)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/contact"
                    className={cn(
                      "mt-6 block text-center py-2.5 px-4 rounded-full text-sm font-semibold transition-colors",
                      plan.popular
                        ? "bg-[#EA580C] text-white hover:bg-[#EA580C]/90"
                        : "bg-[#EA580C]/5 text-[#001E3C] hover:bg-[#EA580C]/10"
                    )}
                  >
                    {plan.popular ? tp("requestDemo") : tp("start")}
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="bg-[#F3F4F7] py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-[#001E3C] text-center mb-12">
            {tp("compareAll")}
          </h2>

          <div className="bg-white rounded-xl border border-[#001E3C]/10 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[640px]">
              {/* Header */}
              <thead>
                <tr className="border-b border-[#001E3C]/10">
                  <th className="text-left py-4 px-6 text-sm font-medium text-[#001E3C]/60 w-[30%]">&nbsp;</th>
                  {planNames.map((name, i) => (
                    <th key={name} className="py-4 px-4 text-center">
                      <span className={cn(
                        "text-sm font-bold",
                        i === 2 ? "text-[#EA580C]" : "text-[#001E3C]"
                      )}>{name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((section) => (
                  <Fragment key={section.titleKey}>
                    <tr className="bg-[#F3F4F7]/60">
                      <td colSpan={6} className="py-3 px-6 text-sm font-bold text-[#001E3C]">
                        {tc(section.titleKey)}
                      </td>
                    </tr>
                    {section.rows.map((row) => {
                      // Try compare namespace first, fallback to features namespace
                      const label = tc.has(row.key) ? tc(row.key) : (tf.has(row.key) ? tf(row.key) : row.key)
                      return (
                      <tr key={row.key} className="border-b border-[#001E3C]/5 last:border-0">
                        <td className="py-3 px-6 text-sm text-[#001E3C]/80">{label}</td>
                        {planKeys.map((key) => {
                          const value = key === "custom" ? row.enterprise : row[key as keyof CompareRow]
                          return (
                            <td key={key} className="py-3 px-4 text-center">
                              {value ? (
                                <Check className="h-4 w-4 text-[#EA580C] mx-auto" />
                              ) : (
                                <Minus className="h-4 w-4 text-[#001E3C]/20 mx-auto" />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-[#001E3C] text-center mb-12">
            {tfaq("sectionTitleLead")}{" "}
            <span className="text-[#EA580C]">{tfaq("sectionTitleHighlight")}</span>
          </h2>
          <div className="space-y-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="border border-[#001E3C]/10 rounded-lg bg-white overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                >
                  <span className="text-sm font-semibold text-[#001E3C]">{tfaq(`q${i + 1}`)}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-[#001E3C]/40 transition-transform flex-shrink-0 ml-4",
                      openFaq === i && "rotate-180"
                    )}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-[#001E3C]/60 leading-relaxed">{tfaq(`a${i + 1}`)}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-[#EA580C] to-[#9A3412] py-16">
        <div className="mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">{tp("ctaTitle")}</h2>
          <p className="mt-3 text-white/80">{tp("ctaDescription")}</p>
          <div className="mt-8 flex items-center justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3.5 text-base font-semibold text-white border-2 border-white/30 rounded-full hover:bg-white/10 transition-all"
            >
              {tp("talkToSales")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
