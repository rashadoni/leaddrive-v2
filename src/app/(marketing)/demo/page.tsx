"use client"

import { useState } from "react"
import { ModuleScenes } from "@/components/marketing/module-scenes"
import Link from "next/link"
import { Particles } from "@/components/ui/particles"
import {
  ArrowRight, Send, Building2, User, Mail, Phone, MessageSquare, Sparkles,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

/* ── Demo request form ── */
function DemoRequestForm({ t, locale }: { t: (key: string) => string; locale: string }) {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <Send className="h-5 w-5 text-emerald-500" />
        </div>
        <h3 className="text-lg font-semibold text-[#001E3C]">{t("formSubmitted")}</h3>
        <p className="mt-2 text-sm text-[#001E3C]/60">{t("formSubmittedDesc")}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        const form = e.currentTarget
        const data = new FormData(form)
        try {
          const response = await fetch("/api/v1/public/demo-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: data.get("name"),
              company: data.get("company"),
              jobTitle: data.get("jobTitle"),
              email: data.get("email"),
              phone: data.get("phone"),
              message: data.get("message"),
              requestedModules: [],
              locale: ["az", "ru", "en"].includes(locale) ? locale : "az",
              consent: data.has("consent"),
              website: data.get("website"),
            }),
          })
          const result = await response.json().catch(() => ({})) as { error?: string }
          if (!response.ok) throw new Error(result.error || t("formError"))
          setSubmitted(true)
        } catch (requestError) {
          setError(requestError instanceof Error ? requestError.message : t("formError"))
        } finally {
          setLoading(false)
        }
      }}
      className="space-y-4"
    >
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="demo-website">Website</label>
        <input id="demo-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="demo-name" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelName")}</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#001E3C]/40" />
            <input
              required
              id="demo-name"
              name="name"
              type="text"
              maxLength={120}
              placeholder={t("placeholderName")}
              className="w-full rounded-lg border border-[#001E3C]/10 bg-white pl-10 pr-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-1 focus:ring-[#EA580C]/20 transition-colors"
            />
          </div>
        </div>
        <div>
          <label htmlFor="demo-company" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelCompany")}</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#001E3C]/40" />
            <input
              required
              id="demo-company"
              name="company"
              type="text"
              maxLength={160}
              placeholder={t("placeholderCompany")}
              className="w-full rounded-lg border border-[#001E3C]/10 bg-white pl-10 pr-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-1 focus:ring-[#EA580C]/20 transition-colors"
            />
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="demo-job-title" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelJobTitle")}</label>
        <input
          id="demo-job-title"
          name="jobTitle"
          type="text"
          maxLength={120}
          placeholder={t("placeholderJobTitle")}
          className="w-full rounded-lg border border-[#001E3C]/10 bg-white px-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 transition-colors"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="demo-email" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelEmail")}</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#001E3C]/40" />
            <input
              required
              id="demo-email"
              name="email"
              type="email"
              maxLength={254}
              placeholder="email@company.com"
              className="w-full rounded-lg border border-[#001E3C]/10 bg-white pl-10 pr-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-1 focus:ring-[#EA580C]/20 transition-colors"
            />
          </div>
        </div>
        <div>
          <label htmlFor="demo-phone" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelPhone")}</label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#001E3C]/40" />
            <input
              id="demo-phone"
              name="phone"
              type="tel"
              maxLength={40}
              placeholder="+994 XX XXX XX XX"
              className="w-full rounded-lg border border-[#001E3C]/10 bg-white pl-10 pr-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-1 focus:ring-[#EA580C]/20 transition-colors"
            />
          </div>
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-[#001E3C]/65">
        <input
          required
          name="consent"
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-[#001E3C]/20 accent-[#EA580C]"
        />
        <span>{t("consent")}</span>
      </label>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div>
        <label htmlFor="demo-message" className="block text-xs font-medium text-[#001E3C]/60 mb-1.5">{t("labelMessage")}</label>
        <div className="relative">
          <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-[#001E3C]/40" />
          <textarea
            id="demo-message"
            name="message"
            rows={3}
            maxLength={2000}
            placeholder={t("placeholderMessage")}
            className="w-full rounded-lg border border-[#001E3C]/10 bg-white pl-10 pr-4 py-2.5 text-sm text-[#001E3C] placeholder:text-[#001E3C]/40 focus:border-[#EA580C] focus:outline-none focus:ring-1 focus:ring-[#EA580C]/20 transition-colors resize-none"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full group inline-flex items-center justify-center gap-2 rounded-full bg-[#EA580C] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#EA580C]/20 hover:bg-[#EA580C]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? t("sending") : t("requestDemo")}
        {!loading && <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />}
      </button>
    </form>
  )
}

export default function DemoPage() {
  const t = useTranslations("demo")
  const locale = useLocale()

  return (
    <div>
      {/* Hero with form */}
      <section className="relative bg-gradient-to-b from-white via-[#F3F4F7] to-white pt-24 pb-20 overflow-hidden">
        <Particles className="absolute inset-0" quantity={50} color="#EA580C" size={0.4} staticity={40} ease={80} />
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-[#EA580C]/10 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-[#EA580C]/5 rounded-full blur-[128px]" />

        <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text */}
            <div className="stagger-children">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#EA580C]/30 bg-[#EA580C]/5 px-4 py-1.5 text-sm text-[#EA580C]">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("badge")}
                </span>
              </div>
              <h1 className="mt-6 text-4xl lg:text-5xl font-bold tracking-tight text-[#001E3C] leading-tight">
                {t("heroTitle1")}{" "}
                <span className="text-[#EA580C]">
                  {t("heroTitle2")}
                </span>
              </h1>
              <p className="mt-4 text-lg text-[#001E3C]/60 leading-relaxed">
                {t("heroDescription")}
              </p>

              <div className="mt-8 space-y-3">
                {[
                  t("bullet1"),
                  t("bullet2"),
                  t("bullet3"),
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#EA580C]" />
                    <span className="text-sm text-[#001E3C]/80">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Form */}
            <div>
              <div className="rounded-2xl border border-[#001E3C]/10 bg-white shadow-lg p-6 lg:p-8">
                <h2 className="text-lg font-semibold text-[#001E3C] mb-1">{t("requestDemo")}</h2>
                <p className="text-sm text-[#001E3C]/60 mb-6">{t("formDescription")}</p>
                <DemoRequestForm t={t} locale={locale} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product story — the same scenario vignettes the landing uses.
          The old gallery rendered public/marketing/*.png, which were captured
          on the live «Güvən Technology» tenant and leaked client names, phone
          numbers and the company's own P&L to anonymous visitors
          (docs/isms/evidence/2026-08-31-marketing-screenshots-data-exposure.md).
          Scenes carry the same story with nothing real in them; real captures
          can return once a seeded demo tenant exists. */}
      <ModuleScenes />

      {/* CTA */}
      <section className="relative bg-gradient-to-br from-[#EA580C] to-[#9A3412] py-16 overflow-hidden">
        <Particles className="absolute inset-0" quantity={30} color="#ffffff" size={0.3} staticity={50} ease={80} />
        <div className="relative mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">
            {t("ctaTitle1")}{" "}
            <span className="text-white/90">{t("ctaTitle2")}</span>
          </h2>
          <p className="mt-3 text-white/70">{t("ctaDescription")}</p>
          <div className="mt-8 flex items-center justify-center">
            <Link
              href="/plans"
              className="inline-flex items-center gap-2 rounded-full border-2 border-white/30 bg-white/10 px-6 py-3.5 text-base font-semibold text-white hover:bg-white/20 transition-all"
            >
              {t("viewPricing")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
