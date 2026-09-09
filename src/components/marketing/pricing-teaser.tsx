"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimateIn } from "./animate-in"
import { plans } from "@/lib/marketing-data"
import { Check, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export function PricingTeaser() {
  const t = useTranslations("marketing.pricing")
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly")
  const isAnnual = billing === "annual"
  // Show only the 4 main plans (not Enterprise 50+)
  const mainPlans = plans.filter((p) => p.id !== "custom")

  return (
    <section id="pricing" className="relative bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <AnimateIn className="text-center mb-14">
          <p className="text-sm font-medium text-[#001E3C]/40 uppercase tracking-widest mb-3">
            {t("sectionTitle")}
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-[#001E3C]">
            {t("sectionSubtitle")}
          </h2>
          <p className="mt-4 text-lg text-[#001E3C]/60 max-w-xl mx-auto">
            {t("sectionDescription")}
          </p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center gap-3 bg-[#F3F4F7] rounded-full p-1">
            <button
              onClick={() => setBilling("monthly")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all",
                !isAnnual
                  ? "bg-white text-[#001E3C] shadow-sm"
                  : "text-[#001E3C]/50 hover:text-[#001E3C]"
              )}
            >
              {t("monthly")}
            </button>
            <button
              onClick={() => setBilling("annual")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                isAnnual
                  ? "bg-white text-[#001E3C] shadow-sm"
                  : "text-[#001E3C]/50 hover:text-[#001E3C]"
              )}
            >
              {t("annual")}
              <span className="text-[10px] font-bold bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full">
                -10%
              </span>
            </button>
          </div>
        </AnimateIn>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {mainPlans.map((plan, i) => {
            const perUser = isAnnual ? plan.pricePerUserAnnual : plan.pricePerUser

            return (
              <AnimateIn key={plan.id} delay={i * 70}>
                <div
                  className={cn(
                    "relative h-full rounded-2xl border border-zinc-200 dark:border-zinc-700 p-6 lg:p-7 flex flex-col transition-all duration-300",
                    plan.popular
                      ? "border-[#EA580C] bg-white ring-1 ring-[#EA580C] shadow-xl shadow-[#EA580C]/10 lg:scale-[1.03]"
                      : "border-[#001E3C]/10 bg-white hover:border-[#001E3C]/15 hover:shadow-lg hover:shadow-[#001E3C]/5"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#EA580C] text-white text-xs font-semibold px-4 py-1 rounded-full">
                      {t("popular")}
                    </div>
                  )}

                  <h3 className="text-lg font-semibold text-[#001E3C]">{t(`${plan.id}.name`)}</h3>
                  <p className="text-sm text-[#001E3C]/60 mt-1 mb-5">{t(`${plan.id}.tagline`)}</p>

                  {/* Price — per-user */}
                  <div className="mb-1">
                    <div className="flex items-baseline gap-1.5">
                      {isAnnual && plan.pricePerUser !== null && (
                        <span className="text-sm text-[#001E3C]/30 line-through">{plan.pricePerUser}</span>
                      )}
                      <span className="text-2xl font-semibold text-[#001E3C]">{perUser}</span>
                      <span className="text-xs text-[#001E3C]/40">AZN / {t("perUser")}</span>
                    </div>
                  </div>
                  {plan.maxUsers !== null && perUser !== null && (
                    <p className="text-xs text-[#001E3C]/35 mb-6">
                      {plan.maxUsers} {t("perUser").split(" ")[0]}: {(perUser * plan.maxUsers).toLocaleString()} AZN/{t("monthly").toLowerCase().slice(0, 3)}
                    </p>
                  )}

                  <ul className="space-y-2.5 flex-1">
                    {plan.features.slice(0, 6).map((featureKey) => (
                      <li key={featureKey} className="flex items-start gap-2">
                        <Check className="h-4 w-4 mt-0.5 shrink-0 text-[#EA580C]" />
                        <span className="text-sm text-[#001E3C]/60">{t(`features.${featureKey}`)}</span>
                      </li>
                    ))}
                    {plan.features.length > 6 && (
                      <li className="text-xs text-[#001E3C]/40 pl-6">
                        + {plan.features.length - 6}
                      </li>
                    )}
                  </ul>

                  <Link
                    href={plan.popular ? "/demo" : "/contact"}
                    className={cn(
                      "mt-8 block text-center py-3 px-4 rounded-full text-sm font-semibold transition-all duration-200",
                      plan.popular
                        ? "bg-[#EA580C] text-white hover:bg-[#EA580C]/90 shadow-lg shadow-[#EA580C]/10"
                        : "border border-[#001E3C]/10 text-[#001E3C] hover:bg-[#F3F4F7] hover:border-[#001E3C]/15"
                    )}
                  >
                    {plan.popular ? t("requestDemo") : t("start")}
                  </Link>
                </div>
              </AnimateIn>
            )
          })}
        </div>

        <AnimateIn delay={400} className="text-center mt-10">
          <Link
            href="/plans"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#001E3C]/40 hover:text-[#001E3C]/60 transition-colors"
          >
            {t("compareAll")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </AnimateIn>
      </div>
    </section>
  )
}
