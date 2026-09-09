import { AnimateIn } from "@/components/marketing/animate-in"
import type { Metadata } from "next"
import { COMPANY_EMAIL, COMPANY_LEGAL_ADDRESS, COMPANY_LEGAL_NAME } from "@/lib/constants"
import { getTranslations } from "next-intl/server"

export const metadata: Metadata = {
  title: "Data Deletion Instructions",
  description: "How to request deletion of your personal data from LeadDrive CRM, including data collected through Meta (Facebook, Instagram) integrations.",
}

export default async function DataDeletionPage() {
  const t = await getTranslations("dataDeletion")
  return (
    <div className="min-h-screen bg-white">
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <AnimateIn>
            <h1 className="text-4xl font-bold text-[#001E3C] tracking-tight mb-2">{t("title")}</h1>
            <p className="text-sm text-[#001E3C]/40 mb-8">{t("lastUpdated")}</p>
            <p className="text-[#001E3C]/70 text-sm leading-relaxed mb-12">{t("intro")}</p>
          </AnimateIn>

          <div className="prose max-w-none space-y-8 text-[#001E3C]/70 text-sm leading-relaxed">
            <AnimateIn delay={0.1}>
              <section>
                <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s1")}</h2>
                <p>{t("p1")}</p>
                <ul className="list-disc pl-5 space-y-1 mt-2">
                  <li>{t("p1_l1")}</li>
                  <li>{t("p1_l2")}</li>
                  <li>{t("p1_l3")}</li>
                </ul>
              </section>
            </AnimateIn>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s2")}</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t("p2_l1")}</li>
                <li>{t("p2_l2")}</li>
                <li>{t("p2_l3")}</li>
                <li>{t("p2_l4")}</li>
                <li>{t("p2_l5")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s3")}</h2>
              <p>{t("p3_intro")}</p>
              <ol className="list-decimal pl-5 space-y-3 mt-3">
                <li>
                  <strong className="text-[#001E3C]">{t("p3_l1_title")}</strong>{" "}
                  {t("p3_l1_body")}
                </li>
                <li>
                  <strong className="text-[#001E3C]">{t("p3_l2_title")}</strong>{" "}
                  {t("p3_l2_body")}
                </li>
                <li>
                  <strong className="text-[#001E3C]">{t("p3_l3_title")}</strong>{" "}
                  {t("p3_l3_body", { email: COMPANY_EMAIL })}
                </li>
              </ol>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s4")}</h2>
              <p>{t("p4")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s5")}</h2>
              <p>{t("p5")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s6")}</h2>
              <p>{t("p6")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s7")}</h2>
              <p>{t("p7")}</p>
              <p className="mt-2">
                {COMPANY_EMAIL}<br />
                {COMPANY_LEGAL_NAME}, {COMPANY_LEGAL_ADDRESS}
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
