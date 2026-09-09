"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { LanguageSwitcher } from "@/components/language-switcher"
import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { APP_URL } from "@/lib/domains"
import { useTranslations } from "next-intl"

function useNavLinks() {
  const t = useTranslations("marketing.nav")
  return [
    { href: "/home#modules", label: t("modules") },
    { href: "/industries", label: t("industries") },
    { href: "/home#davinci", label: t("davinci") },
    { href: "/home#pricing", label: t("pricing") },
    { href: "/demo", label: t("demo") },
    { href: "/contact", label: t("contact") },
  ]
}

export function MarketingNavbar() {
  const t = useTranslations("marketing.nav")
  const navLinks = useNavLinks()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "bg-white/95 backdrop-blur-xl shadow-sm border-b border-[#001E3C]/10"
          : "bg-white"
      )}
    >
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/home" className="flex items-center">
            <Logo size="md" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[#001E3C]/60 hover:text-[#001E3C] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              href="/demo"
              className="rounded-full bg-[#EA580C] hover:bg-[#EA580C]/90 px-5 py-2.5 text-sm font-semibold text-white transition-all shadow-sm"
            >
              {t("cta")}
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-[#001E3C]/60 hover:text-[#001E3C]"
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#001E3C]/10 py-4 space-y-1 animate-fade-in-up">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 text-sm font-medium text-[#001E3C]/60 hover:text-[#001E3C] hover:bg-[#001E3C]/5 rounded-lg"
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t border-[#001E3C]/10 pt-3 mt-3 flex flex-col gap-2 px-3">
              <Link
                href="/demo"
                className="text-center rounded-full bg-[#EA580C] text-sm font-semibold text-white px-5 py-2.5 hover:bg-[#EA580C]/90 transition-all"
              >
                {t("cta")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
