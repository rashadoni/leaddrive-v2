"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Ticket, BookOpen, LogOut, Sparkles } from "lucide-react"
import { PortalChatWidget } from "@/components/portal-chat-widget"

interface PortalUser {
  contactId: string
  fullName: string
  email: string
  companyName: string
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations("portal")
  const [user, setUser] = useState<PortalUser | null>(null)
  // Loyalty tab is shown only when the tenant enabled the loyalty_portal flag
  // (surfaced via portal-config). Off by default → tab hidden.
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false)
  const [supportAiEnabled, setSupportAiEnabled] = useState(false)

  useEffect(() => {
    // Skip auth check on login/register/set-password pages
    if (pathname === "/portal/login" || pathname === "/portal/register" || pathname === "/portal/set-password") return

    const stored = localStorage.getItem("portal-user")
    if (stored) {
      setUser(JSON.parse(stored))
      fetch("/api/v1/public/portal-config")
        .then((r) => r.json())
        .then((j) => {
          setLoyaltyEnabled(!!j?.data?.features?.loyalty)
          setSupportAiEnabled(j?.data?.features?.supportAi === true)
        })
        .catch(() => {})
    } else {
      router.push("/portal/login")
    }
  }, [pathname])

  const handleLogout = async () => {
    localStorage.removeItem("portal-user")
    try { await fetch("/api/v1/public/portal-auth", { method: "DELETE" }) } catch (err) { console.error(err) }
    router.push("/portal/login")
  }

  // Don't show header on login/register/set-password pages
  if (pathname === "/portal/login" || pathname === "/portal/register" || pathname === "/portal/set-password") {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-zinc-200 dark:border-zinc-700 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-primary">{t("title")}</span>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/portal/tickets" className={`flex items-center gap-1.5 transition-colors ${pathname === "/portal/tickets" || pathname === "/portal" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                <Ticket className="h-4 w-4" /> {t("myTickets")}
              </Link>
              <Link href="/portal/knowledge-base" className={`flex items-center gap-1.5 transition-colors ${pathname === "/portal/knowledge-base" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                <BookOpen className="h-4 w-4" /> {t("knowledgeBase")}
              </Link>
              {loyaltyEnabled && (
                <Link href="/portal/loyalty" className={`flex items-center gap-1.5 transition-colors ${pathname === "/portal/loyalty" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                  <Sparkles className="h-4 w-4" /> {t("loyalty.title")}
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.fullName || ""}</span>
            <span className="text-xs text-muted-foreground">{user?.companyName || ""}</span>
            <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
      {user && supportAiEnabled && <PortalChatWidget userName={user.fullName} />}
    </div>
  )
}
