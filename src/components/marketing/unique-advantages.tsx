"use client"

import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { SectionWrapper } from "./section-wrapper"
import { MagicCard } from "@/components/ui/magic-card"
import { advantages } from "@/lib/marketing-data"
import { ArrowRight } from "lucide-react"

/**
 * Marketing site i18n (memory project_leaddrive_i18n.md):
 * Icon + color + href are kept in `advantages` from marketing-data.ts
 * (UI metadata — not translatable). title + description are now sourced
 * from `marketing.advantages.a{N}_title/_description` per locale. Section
 * heading + CTA also pulled from translations.
 *
 * Pattern mirrors `testimonial-carousel.tsx` (hybrid: visual metadata +
 * translated copy). If you extend this list, also extend the locale
 * files at `messages/{az,en,ru}.json` under `marketing.advantages`.
 */
export function UniqueAdvantages() {
  const t = useTranslations("marketing.advantages")

  return (
    <SectionWrapper id="advantages" variant="white">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="text-center mb-12"
      >
        <p className="text-sm font-medium text-[#001E3C]/40 uppercase tracking-widest mb-3">
          {t("sectionLabel")}
        </p>
        <h2 className="text-3xl lg:text-4xl font-bold text-[#001E3C]">
          {t("sectionTitle")}
        </h2>
        <p className="mt-4 text-lg text-[#001E3C]/60 max-w-2xl mx-auto">
          {t("sectionSubtitle")}
        </p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {advantages.map((adv, i) => {
          const Icon = adv.icon
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <MagicCard
                gradientColor={`${adv.color}20`}
                gradientOpacity={0.5}
                className="bg-white border-[#001E3C]/10 h-full"
              >
                <div className="p-6">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{ backgroundColor: `${adv.color}15` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: adv.color }} />
                  </div>
                  <h3 className="font-bold text-[#001E3C] text-lg mb-2">
                    {t(`a${i + 1}_title`)}
                  </h3>
                  <p className="text-sm text-[#001E3C]/60 leading-relaxed mb-4">
                    {t(`a${i + 1}_description`)}
                  </p>
                  <Link
                    href={adv.href}
                    className="inline-flex items-center text-sm font-medium text-[#EA580C] hover:underline"
                  >
                    {t("exploreLink")} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
              </MagicCard>
            </motion.div>
          )
        })}
      </div>
    </SectionWrapper>
  )
}
