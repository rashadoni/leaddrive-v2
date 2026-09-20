import { AnimateIn } from "@/components/marketing/animate-in"
import { LegalDocumentNav, legalLocale } from "@/components/marketing/legal-document-nav"
import type { Metadata } from "next"
import { COMPANY_LEGAL_ADDRESS, COMPANY_LEGAL_NAME, COMPANY_PRIVACY_EMAIL, COMPANY_REGISTRATION_NUMBER } from "@/lib/constants"
import { getTranslations } from "next-intl/server"

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "LeadDrive CRM terms of service — platform usage rules and conditions.",
}

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const locale = legalLocale((await searchParams).lang)
  const t = await getTranslations({ locale, namespace: "terms" })
  return (
    <div className="min-h-screen bg-white">
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <AnimateIn>
            <h1 className="text-4xl font-bold text-[#001E3C] tracking-tight mb-2">{t("title")}</h1>
            <p className="text-sm text-[#001E3C]/40 mb-12">{t("lastUpdated")}</p>
          </AnimateIn>

          <LegalDocumentNav locale={locale} path="/legal/terms" />

          <div className="prose max-w-none space-y-8 text-[#001E3C]/70 text-sm leading-relaxed">
            <AnimateIn delay={0.1}>
              <section>
                <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s1")}</h2>
                <p>{t("p1")}</p>
              </section>
            </AnimateIn>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s2")}</h2>
              <p>{t("p2")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s3")}</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t("p3_l1")}</li>
                <li>{t("p3_l2")}</li>
                <li>{t("p3_l3")}</li>
                <li>{t("p3_l4")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s4")}</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t("p4_l1")}</li>
                <li>{t("p4_l2")}</li>
                <li>{t("p4_l3")}</li>
                <li>{t("p4_l4")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s5")}</h2>
              <p>{t("p5")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s6")}</h2>
              <p>{t("p6_intro")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p6_l1")}</li>
                <li>{t("p6_l2")}</li>
                <li>{t("p6_l3")}</li>
                <li>{t("p6_l4")}</li>
                <li>{t("p6_l5")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s7")}</h2>
              <p>{t("p7")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("sMeta")}</h2>
              <p>{t("pMeta")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s8")}</h2>
              <p>{t("p8")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s9")}</h2>
              <p>{t("p9")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s10")}</h2>
              <p>{t("p10")}</p>
              <p className="mt-2">
                <a href={`mailto:${COMPANY_PRIVACY_EMAIL}`} className="underline hover:opacity-70">{COMPANY_PRIVACY_EMAIL}</a><br />
                {COMPANY_LEGAL_NAME}, {COMPANY_REGISTRATION_NUMBER}<br />
                {COMPANY_LEGAL_ADDRESS}
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
