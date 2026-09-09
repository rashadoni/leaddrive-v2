"use client"

import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { SectionWrapper } from "./section-wrapper"
import { painPoints, solutions } from "@/lib/marketing-data"

/**
 * Marketing site i18n (memory project_leaddrive_i18n.md):
 * Icons are kept in `painPoints` / `solutions` from marketing-data.ts
 * (UI metadata — not translatable). All copy (section heading, column
 * headers, item titles + descriptions) comes from
 * `marketing.problemSolution` per locale. Pattern mirrors
 * `unique-advantages.tsx`.
 *
 * If you add/remove pain-point or solution items, also update the locale
 * files at `messages/{az,en,ru}.json` under `marketing.problemSolution`.
 */
export function ProblemSolution() {
  const t = useTranslations("marketing.problemSolution")

  return (
    <SectionWrapper id="problem-solution" variant="white">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.5 }}
        className="text-center mb-16"
      >
        <h2 className="text-3xl lg:text-4xl font-bold text-[#001E3C]">
          {t("sectionTitleLead")}{" "}
          <span className="text-[#EA580C]">{t("sectionTitleHighlight")}</span>
        </h2>
        <p className="mt-4 text-lg text-[#001E3C]/60 max-w-2xl mx-auto">
          {t("sectionSubtitle")}
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-start">
        {/* Pain points */}
        <div className="space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-red-500/80 mb-4">
            {t("painHeading")}
          </h3>
          {painPoints.map((item, i) => {
            const Icon = item.icon
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex gap-4 p-4 rounded-xl bg-red-50/50 border border-red-100"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <h4 className="font-semibold text-[#001E3C]">
                    {t(`p${i + 1}_title`)}
                  </h4>
                  <p className="text-sm text-[#001E3C]/60 mt-1">
                    {t(`p${i + 1}_description`)}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Solutions */}
        <div className="space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[#EA580C] mb-4">
            {t("solutionHeading")}
          </h3>
          {solutions.map((item, i) => {
            const Icon = item.icon
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex gap-4 p-4 rounded-xl bg-[#EA580C]/5 border border-[#EA580C]/10"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#EA580C]/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-[#EA580C]" />
                </div>
                <div>
                  <h4 className="font-semibold text-[#001E3C]">
                    {t(`s${i + 1}_title`)}
                  </h4>
                  <p className="text-sm text-[#001E3C]/60 mt-1">
                    {t(`s${i + 1}_description`)}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </SectionWrapper>
  )
}
