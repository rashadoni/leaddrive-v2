import { AnimateIn } from "@/components/marketing/animate-in"
import Link from "next/link"
import type { Metadata } from "next"
import { COMPANY_EMAIL, COMPANY_LEGAL_ADDRESS, COMPANY_LEGAL_NAME } from "@/lib/constants"
import { getTranslations } from "next-intl/server"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "LeadDrive CRM privacy policy — how your data is collected, used and protected.",
}

export default async function PrivacyPage() {
  const t = await getTranslations("privacy")
  return (
    <div className="min-h-screen bg-white">
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <AnimateIn>
            <h1 className="text-4xl font-bold text-[#001E3C] tracking-tight mb-2">{t("title")}</h1>
            <p className="text-sm text-[#001E3C]/40 mb-12">{t("lastUpdated")}</p>
          </AnimateIn>

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
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p2_l1")}</li>
                <li>{t("p2_l2")}</li>
                <li>{t("p2_l3")}</li>
                <li>{t("p2_l4")}</li>
                <li>{t("p2_l5")}</li>
                <li>{t("p2_l6")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s3")}</h2>
              <p>{t("p3")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p3_l1")}</li>
                <li>{t("p3_l2")}</li>
                <li>{t("p3_l3")}</li>
                <li>{t("p3_l4")}</li>
                <li>{t("p3_l5")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s4")}</h2>
              <p>{t("p4")}</p>
            </section>

            <section>
              {/* F-12: the subprocessor list is named, not summarised as "trusted
                  partners". A customer whose conversations pass through Meta and
                  whose text reaches a language model is entitled to know that
                  before signing, not at an audit. */}
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s5")}</h2>
              <p>{t("p5")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p5_l1")}</li>
                <li>{t("p5_l2")}</li>
                <li>{t("p5_l3")}</li>
                <li>{t("p5_l4")}</li>
                <li>{t("p5_l5")}</li>
                <li>{t("p5_l6")}</li>
                <li>{t("p5_l7")}</li>
              </ul>
              <p className="mt-3">{t("p5_note")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s6")}</h2>
              <p>{t("p6")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s7")}</h2>
              <p>{t("p7")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p7_l1")}</li>
                <li>{t("p7_l2")}</li>
                <li>{t("p7_l3")}</li>
                <li>{t("p7_l4")}</li>
              </ul>
              {/* Object Lock holds backups immutable for up to 400 days, so
                  "we delete immediately" was a promise the system cannot keep.
                  Stating the real window is both honest and easier to defend. */}
              <p className="mt-3">{t("p7_note")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s8")}</h2>
              <p>{t("p8")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p8_l1")}</li>
                <li>{t("p8_l2")}</li>
                <li>{t("p8_l3")}</li>
                <li>{t("p8_l4")}</li>
              </ul>
              <p className="mt-3">{t("p8_usage")}</p>
              <p className="mt-3">
                {t("p8_deletion")}{" "}
                <Link href="/legal/data-deletion" className="underline text-[#001E3C] hover:opacity-70">
                  /legal/data-deletion
                </Link>
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s9")}</h2>
              <p>{t("p9")}</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>{t("p9_l1")}</li>
                <li>{t("p9_l2")}</li>
                <li>{t("p9_l3")}</li>
                <li>{t("p9_l4")}</li>
              </ul>
              <p className="mt-3">{t("p9_controller")}</p>
              <p className="mt-3">{t("p9_note")}</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#001E3C] mb-3">{t("s10")}</h2>
              <p>{t("p10")}</p>
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
