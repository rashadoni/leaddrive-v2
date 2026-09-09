"use client"

import { AnimateIn } from "./animate-in"
import { testimonials } from "@/lib/marketing-data"
import { TrendingDown, Clock, Percent, ArrowUpRight } from "lucide-react"
import { useTranslations } from "next-intl"

const caseStudyMeta = [
  { idx: 0, metricIcon: ArrowUpRight, metricColor: "#10b981" },
  { idx: 1, metricIcon: Clock, metricColor: "#06b6d4" },
  { idx: 2, metricIcon: TrendingDown, metricColor: "#8b5cf6" },
  { idx: 3, metricIcon: Percent, metricColor: "#f97316" },
  { idx: 4, metricIcon: ArrowUpRight, metricColor: "#ef4444" },
  { idx: 5, metricIcon: TrendingDown, metricColor: "#10b981" },
]

export function TestimonialCarousel() {
  const t = useTranslations("marketing.testimonials")

  const caseStudies = caseStudyMeta.map((meta, i) => ({
    ...testimonials[meta.idx],
    quote: t(`t${i + 1}_quote`),
    title: t(`t${i + 1}_title`),
    metric: t(`t${i + 1}_metric`),
    metricLabel: t(`t${i + 1}_metricLabel`),
    metricIcon: meta.metricIcon,
    metricColor: meta.metricColor,
  }))

  return (
    <section id="testimonials" className="relative bg-[#F3F4F7] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <AnimateIn className="text-center mb-14">
          <p className="text-sm font-medium text-[#001E3C]/40 uppercase tracking-widest mb-3">
            {t("sectionTitle")}
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-[#001E3C]">
            {t("sectionSubtitle")}
          </h2>
        </AnimateIn>

        {/* 3-column grid — top row has highlighted metrics */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {caseStudies.map((cs, i) => {
            const MetricIcon = cs.metricIcon
            return (
              <AnimateIn key={i} delay={i * 70}>
                <div className="group h-full rounded-2xl border border-[#001E3C]/10 bg-white p-6 lg:p-7 flex flex-col hover:border-[#001E3C]/15 hover:shadow-lg hover:shadow-[#001E3C]/5 transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                  {/* Metric highlight */}
                  <div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#001E3C]/10">
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                      style={{ backgroundColor: `${cs.metricColor}12` }}
                    >
                      <MetricIcon className="w-5 h-5" style={{ color: cs.metricColor }} />
                    </div>
                    <div>
                      <div className="text-xl font-bold text-[#001E3C]">{cs.metric}</div>
                      <div className="text-xs text-[#001E3C]/40">{cs.metricLabel}</div>
                    </div>
                  </div>

                  {/* Quote */}
                  <p className="text-[#001E3C]/60 text-sm leading-relaxed flex-1">
                    &ldquo;{cs.quote}&rdquo;
                  </p>

                  {/* Author */}
                  <div className="mt-5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F3F4F7] flex items-center justify-center text-[#001E3C]/60 text-xs font-semibold">
                      {cs.name.split(" ").map((n: string) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="font-medium text-[#001E3C] text-sm">{cs.name}</p>
                      <p className="text-xs text-[#001E3C]/40">{cs.title}, {cs.company}</p>
                    </div>
                  </div>
                </div>
              </AnimateIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}
