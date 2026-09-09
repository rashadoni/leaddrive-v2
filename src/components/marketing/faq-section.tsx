"use client"

import { useState } from "react"
import { SectionWrapper } from "./section-wrapper"
import { AnimateIn } from "./animate-in"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

function FaqItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-[#001E3C]/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-sm font-medium text-[#001E3C] pr-4">{q}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-[#001E3C]/40 flex-shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-48 pb-5" : "max-h-0"
        )}
      >
        <p className="text-sm text-[#001E3C]/60 leading-relaxed">{a}</p>
      </div>
    </div>
  )
}

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"] as const

export function FaqSection() {
  const t = useTranslations("marketing.faq")

  return (
    <SectionWrapper id="faq" variant="white" narrow>
      <AnimateIn className="text-center mb-12">
        <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-[#001E3C]">
          {t("sectionTitle")}
        </h2>
        <p className="mt-4 text-lg text-[#001E3C]/60">
          {t("sectionSubtitle")}
        </p>
      </AnimateIn>

      <div className="max-w-3xl mx-auto">
        {FAQ_KEYS.map((key, i) => (
          <AnimateIn key={key} delay={i * 40}>
            <FaqItem q={t(key)} a={t(`a${i + 1}`)} defaultOpen={i === 0} />
          </AnimateIn>
        ))}
      </div>
    </SectionWrapper>
  )
}
