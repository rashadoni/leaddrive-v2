import { getTranslations } from "next-intl/server"
import { HeroSection } from "@/components/marketing/hero-section"
import { StatsCounter } from "@/components/marketing/stats-counter"
import { ModuleScenes } from "@/components/marketing/module-scenes"
import { AiFlowDiagram } from "@/components/marketing/ai-flow-diagram"
import { PricingTeaser } from "@/components/marketing/pricing-teaser"
import { TestimonialCarousel } from "@/components/marketing/testimonial-carousel"
import { FaqSection } from "@/components/marketing/faq-section"
import { CtaBanner } from "@/components/marketing/cta-banner"

const SITE_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"

/**
 * Home page with locale-aware JSON-LD structured data.
 * All user-visible strings come from next-intl translations so that
 * search-engine crawlers receive the correct language in every locale.
 */
export default async function MarketingHomePage() {
  const tFaq  = await getTranslations("marketing.faq")
  const tNav  = await getTranslations("marketing.nav")
  const tMeta = await getTranslations("marketing.meta")
  const tHero = await getTranslations("marketing.hero")

  // FAQ structured data — 8 q/a pairs from translations.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: Array.from({ length: 8 }, (_, i) => ({
      "@type": "Question",
      name: tFaq(`q${i + 1}`),
      acceptedAnswer: {
        "@type": "Answer",
        text: tFaq(`a${i + 1}`),
      },
    })),
  }

  // Breadcrumb structured data — nav labels from translations.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: tNav("home"),    item: `${SITE_URL}/home` },
      { "@type": "ListItem", position: 2, name: tNav("modules"), item: `${SITE_URL}/home#modules` },
      { "@type": "ListItem", position: 3, name: tNav("pricing"), item: `${SITE_URL}/plans` },
      { "@type": "ListItem", position: 4, name: tNav("demo"),    item: `${SITE_URL}/demo` },
      { "@type": "ListItem", position: 5, name: tNav("contact"), item: `${SITE_URL}/contact` },
    ],
  }

  // SoftwareApplication structured data — description + trial copy from translations.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LeadDrive CRM",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: tMeta("description"),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: tHero("trial"),
    },
    author: {
      "@type": "Organization",
      name: "Fanumsec MMC",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Baku",
        addressCountry: "AZ",
      },
    },
    featureList: [
      "CRM & Sales Management",
      "Marketing Automation",
      "7-Channel Unified Inbox",
      "Helpdesk & SLA",
      "Finance & Profitability",
      "Smart Lead Scoring",
      "Smart Email Generation",
      "Smart Customer Service Agent",
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <HeroSection />
      <StatsCounter />
      <ModuleScenes />
      <AiFlowDiagram />
      <PricingTeaser />
      <TestimonialCarousel />
      <FaqSection />
      <CtaBanner />
    </>
  )
}
