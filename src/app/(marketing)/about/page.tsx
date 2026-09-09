"use client"

import { AnimateIn } from "@/components/marketing/animate-in"
import Link from "next/link"
import { Building2, Target, Users, Globe, Zap, Shield, MapPin, Code2 } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  COMPANY_LEGAL_NAME, COMPANY_LEGAL_ADDRESS,
  COMPANY_LEGAL_LOCALITY, COMPANY_LEGAL_COUNTRY_CODE,
} from "@/lib/constants"

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: COMPANY_LEGAL_NAME,
  url: process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org",
  logo: `${process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"}/apple-touch-icon.png`,
  description: `AI-powered CRM platform built in ${COMPANY_LEGAL_ADDRESS}.`,
  foundingLocation: {
    "@type": "Place",
    name: COMPANY_LEGAL_ADDRESS,
  },
  contactPoint: {
    "@type": "ContactPoint",
    email: "info@leaddrivecrm.org",
    contactType: "sales",
    availableLanguage: ["az", "ru", "en"],
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: COMPANY_LEGAL_LOCALITY,
    addressCountry: COMPANY_LEGAL_COUNTRY_CODE,
  },
  sameAs: [],
}

export default function AboutPage() {
  const t = useTranslations("marketing.about")
  const tContact = useTranslations("marketing.contact")
  const tNav = useTranslations("marketing.nav")
  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      {/* Hero */}
      <section className="relative pt-32 pb-16 text-center">
        <div className="mx-auto max-w-3xl px-4">
          <AnimateIn>
            <h1 className="text-4xl sm:text-5xl font-bold text-[#001E3C] tracking-tight">
              {t("title")}
            </h1>
            <p className="mt-4 text-lg text-[#001E3C]/60 leading-relaxed">
              {t("subtitle")}
            </p>
          </AnimateIn>
        </div>
      </section>

      {/* Mission */}
      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <AnimateIn delay={0.1}>
              <div className="rounded-2xl border border-[#001E3C]/10 bg-[#F3F4F7] p-8">
                <div className="rounded-lg bg-[#EA580C]/10 w-12 h-12 flex items-center justify-center mb-4">
                  <Target className="h-6 w-6 text-[#EA580C]" />
                </div>
                <h2 className="text-2xl font-bold text-[#001E3C] mb-4">{t("missionTitle")}</h2>
                <p className="text-[#001E3C]/60 leading-relaxed">{t("missionDesc")}</p>
              </div>
            </AnimateIn>
            <AnimateIn delay={0.2}>
              <div className="rounded-2xl border border-[#001E3C]/10 bg-[#F3F4F7] p-8">
                <div className="rounded-lg bg-[#EA580C]/10 w-12 h-12 flex items-center justify-center mb-4">
                  <Zap className="h-6 w-6 text-[#EA580C]" />
                </div>
                <h2 className="text-2xl font-bold text-[#001E3C] mb-4">{t("whatWeDoTitle")}</h2>
                <p className="text-[#001E3C]/60 leading-relaxed">{t("whatWeDoDesc")}</p>
              </div>
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <AnimateIn delay={0.1}>
              <div className="rounded-2xl border border-[#001E3C]/10 bg-[#F3F4F7] p-8">
                <div className="rounded-lg bg-[#EA580C]/10 w-12 h-12 flex items-center justify-center mb-4">
                  <MapPin className="h-6 w-6 text-[#EA580C]" />
                </div>
                <h2 className="text-2xl font-bold text-[#001E3C] mb-4">{t("storyTitle")}</h2>
                <p className="text-[#001E3C]/60 leading-relaxed">{t("storyDesc")}</p>
              </div>
            </AnimateIn>
            <AnimateIn delay={0.2}>
              <div className="rounded-2xl border border-[#001E3C]/10 bg-[#F3F4F7] p-8">
                <div className="rounded-lg bg-[#EA580C]/10 w-12 h-12 flex items-center justify-center mb-4">
                  <Code2 className="h-6 w-6 text-[#EA580C]" />
                </div>
                <h2 className="text-2xl font-bold text-[#001E3C] mb-4">{t("teamTitle")}</h2>
                <p className="text-[#001E3C]/60 leading-relaxed">{t("teamDesc")}</p>
              </div>
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="pb-24">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <AnimateIn>
            <h2 className="text-2xl font-bold text-[#001E3C] text-center mb-12">{t("valuesTitle")}</h2>
          </AnimateIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Shield, title: t("val_security"), desc: t("val_security_desc") },
              { icon: Users, title: t("val_customer"), desc: t("val_customer_desc") },
              { icon: Globe, title: t("val_global"), desc: t("val_global_desc") },
              { icon: Zap, title: t("val_innovation"), desc: t("val_innovation_desc") },
              { icon: Building2, title: t("val_transparency"), desc: t("val_transparency_desc") },
              { icon: Target, title: t("val_results"), desc: t("val_results_desc") },
            ].map((v) => (
              <AnimateIn key={v.title} delay={0.1}>
                <div className="rounded-2xl border border-[#001E3C]/10 bg-[#F3F4F7] p-6 h-full">
                  <v.icon className="h-6 w-6 text-[#EA580C] mb-3" />
                  <h3 className="text-lg font-semibold text-[#001E3C] mb-2">{v.title}</h3>
                  <p className="text-sm text-[#001E3C]/60 leading-relaxed">{v.desc}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <AnimateIn>
            <h2 className="text-3xl font-bold text-[#001E3C] mb-4">{tContact("title")}</h2>
            <p className="text-[#001E3C]/60 mb-8">{tContact("subtitle")}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/contact"
                className="rounded-full bg-[#EA580C] hover:bg-[#EA580C]/90 px-8 py-3 text-sm font-semibold text-white transition-colors"
              >
                {tContact("title")}
              </Link>
              <Link
                href="/demo"
                className="rounded-full border border-[#001E3C]/10 hover:border-[#001E3C]/20 px-8 py-3 text-sm font-semibold text-[#001E3C] transition-colors"
              >
                {tNav("cta")}
              </Link>
            </div>
          </AnimateIn>
        </div>
      </section>
    </div>
  )
}
