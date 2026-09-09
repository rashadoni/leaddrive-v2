"use client"

import Link from "next/link"
import { Logo } from "@/components/logo"
import { useTranslations } from "next-intl"
import { COMPANY_EMAIL, COMPANY_LEGAL_NAME } from "@/lib/constants"

function useFooterLinks() {
  const t = useTranslations("marketing")
  return {
    [t("footer.product")]: [
      { label: t("nav.modules"), href: "/#modules" },
      { label: "Da Vinci", href: "/#davinci" },
      { label: t("nav.pricing"), href: "/#pricing" },
      { label: t("nav.industries"), href: "/industries" },
      { label: t("nav.demo"), href: "/demo" },
    ],
    [t("footer.solutions")]: [
      { label: t("footer.salesCrm"), href: "/demo#deals" },
      { label: t("footer.marketingAutomation"), href: "/demo#campaigns" },
      { label: t("footer.inbox7ch"), href: "/demo#inbox" },
      { label: t("footer.supportTickets"), href: "/demo#support" },
      { label: t("footer.financeAnalytics"), href: "/demo#finance" },
    ],
    [t("footer.company")]: [
      { label: t("footer.about"), href: "/about" },
      { label: t("nav.contact"), href: "/contact" },
      { label: t("footer.faq"), href: "/home#faq" },
    ],
    [t("footer.legal")]: [
      { label: t("footer.privacy"), href: "/legal/privacy" },
      { label: t("footer.terms"), href: "/legal/terms" },
      { label: t("footer.dataDeletion"), href: "/legal/data-deletion" },
    ],
  }
}

const socialLinks = [
  {
    label: "LinkedIn",
    href: "https://linkedin.com",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    label: "X",
    href: "https://x.com",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
]

export function MarketingFooter() {
  const t = useTranslations("marketing.footer")
  const footerLinks = useFooterLinks()

  return (
    <footer className="bg-[#001E3C] text-white border-t border-white/10">
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Logo size="md" sidebar />
            <p className="mt-4 text-sm text-white/70 leading-relaxed">
              {t("description")}
            </p>
            <div className="mt-4 space-y-1.5 text-sm text-white/50">
              <p>{COMPANY_EMAIL}</p>
            </div>
            {/* Social links removed — will add when real accounts exist */}
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/70 hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/50">
            &copy; {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. {t("allRights")}
          </p>
          <p className="text-sm text-white/50">
            {t("location")}
          </p>
        </div>
      </div>
    </footer>
  )
}
