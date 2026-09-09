"use client"

import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { AnimateIn } from "./animate-in"
import { useTranslations } from "next-intl"

export function CtaBanner() {
  const t = useTranslations("marketing.cta")
  return (
    <section className="relative bg-white py-24 lg:py-32">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#001E3C]/10 to-transparent" />

      <div className="relative mx-auto max-w-3xl px-4 lg:px-8 text-center">
        <AnimateIn>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#EA580C]/20 bg-[#EA580C]/5 px-4 py-1.5 text-sm text-[#EA580C] font-medium mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            {t("trial")}
          </div>
        </AnimateIn>

        <AnimateIn delay={60}>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight text-[#001E3C]">
            {t("title")}
          </h2>
        </AnimateIn>

        <AnimateIn delay={120}>
          <p className="mt-5 text-lg text-[#001E3C]/60 max-w-xl mx-auto leading-relaxed">
            {t("description")}
          </p>
        </AnimateIn>

        <AnimateIn delay={180}>
          <div className="mt-10 flex items-center justify-center">
            <Link
              href="/demo"
              className="group inline-flex items-center gap-2 rounded-full bg-[#EA580C] px-8 py-4 text-base font-semibold text-white shadow-lg shadow-[#EA580C]/20 hover:bg-[#EA580C]/90 hover:shadow-xl transition-all"
            >
              {t("requestDemo")}
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </AnimateIn>
      </div>
    </section>
  )
}
