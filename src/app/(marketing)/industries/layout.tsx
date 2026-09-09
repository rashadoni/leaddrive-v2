import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.industries")
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    openGraph: {
      title: `${t("metaTitle")} | LeadDrive CRM`,
      description: t("metaDescription"),
    },
  }
}

export default function IndustriesLayout({ children }: { children: React.ReactNode }) {
  return children
}
