import { MarketingNavbar } from "@/components/marketing/navbar"
import { MarketingFooter } from "@/components/marketing/footer"
import { FloatingButtons } from "@/components/marketing/floating-buttons"
import { WebChatEmbed } from "@/components/marketing/web-chat-embed"

import { GoogleAnalytics } from "@/components/marketing/google-analytics"
import type { Metadata } from "next"
import { COMPANY_LEGAL_NAME } from "@/lib/constants"

export const metadata: Metadata = {
  title: {
    default: "LeadDrive CRM — İntellektual CRM Platforması",
    template: "%s | LeadDrive CRM",
  },
  description:
    "İntellektual CRM platforması — satış, marketinq, omni-kanal gələn qutusu, dəstək, maliyyə və analitika bir yerdə. 160+ funksiya, 20 modul.",
  keywords: [
    "CRM", "CRM Azerbaijan", "CRM Azərbaycan", "smart CRM platforması",
    "Da Vinci CRM", "satış idarəsi", "lead management", "müştəri idarəsi",
    "marketing automation", "helpdesk", "SLA", "pipeline",
    "LeadDrive", "CRM Baku", "Azərbaycan proqram təminatı", "biznes idarəetməsi",
  ],
  authors: [{ name: COMPANY_LEGAL_NAME }],
  openGraph: {
    type: "website",
    locale: "az_AZ",
    siteName: "LeadDrive CRM",
    title: "LeadDrive CRM — İntellektual CRM Platforması",
    description: "160+ funksiya, 20 modul. Satış, marketinq, dəstək və maliyyə bir platformada.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "LeadDrive CRM" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LeadDrive CRM — İntellektual CRM Platforması",
    description: "160+ funksiya, 20 modul. Satış, marketinq, dəstək və maliyyə bir platformada.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#001E3C]" style={{ colorScheme: "light" }}>
      <MarketingNavbar />
      <main>{children}</main>
      <MarketingFooter />
      <FloatingButtons />

      {/* Web chat widget — client component loads widget.js after hydration
          so React doesn't clobber the DOM nodes the loader appends to body. */}
      <WebChatEmbed />

      <GoogleAnalytics />
    </div>
  )
}
