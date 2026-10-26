"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { HelpSection } from "@/components/help/help-content"

export default function CapabilitiesHelp() {
  const t = useTranslations("capabilitiesPage.help")
  return (
    <div className="space-y-6">
      <HelpSection title={t("title")}><p>{t("intro")}</p></HelpSection>
      <HelpSection title={t("access")}><p>{t("accessText")}</p></HelpSection>
      <HelpSection title={t("next")}><p>{t("nextText")}</p></HelpSection>
      <HelpSection title={t("apps")}>
        <p>{t("appsText")}</p>
        <Link href="/marketplace/apps" className="mt-3 inline-block underline underline-offset-4">{t("apps")}</Link>
      </HelpSection>
    </div>
  )
}
