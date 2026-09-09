"use client"

import Link from "next/link"
import { ArrowRight, Sparkles, Shield } from "lucide-react"
import { OmniScene } from "./module-scenes"
import { useTranslations } from "next-intl"

export function HeroSection() {
  const t = useTranslations("marketing.hero")
  return (
    <section className="relative bg-gradient-to-b from-white via-[#F3F4F7] to-white pt-20 pb-8 lg:pt-24 lg:pb-12 overflow-x-clip">
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-[#EA580C]/10 rounded-full blur-[128px]" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-[#7D55C7]/10 rounded-full blur-[128px]" />

      <div className="relative mx-auto max-w-7xl px-4 lg:px-8 w-full">
        <div className="text-center max-w-4xl mx-auto">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#EA580C]/20 bg-[#EA580C]/5 px-4 py-1.5 text-sm text-[#EA580C] font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            {t("badge")}
          </span>

          <h1 className="mt-8 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08]">
            <span className="text-[#001E3C]">{t("title1")}</span>
            <br />
            <span className="bg-gradient-to-r from-[#EA580C] via-[#7D55C7] to-[#9B6CFF] bg-clip-text text-transparent">
              {t("title2")}
            </span>
          </h1>

          <p className="mt-6 text-lg lg:text-xl text-[#001E3C]/60 max-w-2xl mx-auto leading-relaxed">
            {t("description")}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/demo"
              className="group inline-flex items-center gap-2 rounded-full bg-[#EA580C] hover:bg-[#EA580C]/90 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#EA580C]/25 hover:shadow-[#EA580C]/40 transition-all"
            >
              {t("cta")}
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[#001E3C]/40">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-500" />
              {t("trial")}
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-500" />
              {t("noCard")}
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-500" />
              {t("gdpr")}
            </span>
          </div>
        </div>
      </div>

      {/* Flagship scenario: omni-channel inbox vignette */}
      <div className="mx-auto mt-12 w-full max-w-4xl px-4 lg:mt-16">
        <OmniScene tall />
      </div>
    </section>
  )
}
