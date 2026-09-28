"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { BookOpen, Loader2, LogOut, MessageCircle, Sparkles, Ticket } from "lucide-react"
import { PortalChatWidget } from "@/components/portal-chat-widget"
import { ThemeProvider } from "@/components/theme-provider"

interface PortalUser {
  contactId: string
  fullName: string
  email: string
  companyName: string
}

const PUBLIC_PORTAL_PATHS = new Set([
  "/portal/login",
  "/portal/register",
  "/portal/forgot-password",
  "/portal/set-password",
])

function readStoredUser(): PortalUser | null {
  try {
    const value = JSON.parse(localStorage.getItem("portal-user") || "null") as Partial<PortalUser> | null
    if (!value || typeof value.contactId !== "string" || typeof value.fullName !== "string") return null
    return {
      contactId: value.contactId,
      fullName: value.fullName,
      email: typeof value.email === "string" ? value.email : "",
      companyName: typeof value.companyName === "string" ? value.companyName : "",
    }
  } catch {
    return null
  }
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations("portal")
  const [user, setUser] = useState<PortalUser | null>(null)
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false)
  const [supportAiEnabled, setSupportAiEnabled] = useState(false)
  const isPublicPage = PUBLIC_PORTAL_PATHS.has(pathname)

  useEffect(() => {
    if (isPublicPage) return
    const stored = readStoredUser()
    if (!stored) {
      router.replace("/portal/login")
      return
    }
    setUser(stored)
    fetch("/api/v1/public/portal-config", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          localStorage.removeItem("portal-user")
          router.replace("/portal/login")
          return null
        }
        if (!response.ok) throw new Error("config")
        return response.json()
      })
      .then((body) => {
        if (!body) return
        setLoyaltyEnabled(body?.data?.features?.loyalty === true)
        setSupportAiEnabled(body?.data?.features?.supportAi === true)
      })
      .catch(() => {
        setLoyaltyEnabled(false)
        setSupportAiEnabled(false)
      })
  }, [isPublicPage, pathname, router])

  const handleLogout = async () => {
    localStorage.removeItem("portal-user")
    setUser(null)
    try {
      await fetch("/api/v1/public/portal-auth", { method: "DELETE" })
    } finally {
      router.replace("/portal/login")
    }
  }

  if (isPublicPage) return <ThemeProvider><div className="customer-support-surface min-h-screen">{children}</div></ThemeProvider>
  if (!user) {
    return (
      <ThemeProvider>
        <div className="customer-support-surface grid min-h-screen place-items-center bg-background" aria-busy="true" aria-label={t("clientPortalLoading")}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        </div>
      </ThemeProvider>
    )
  }

  const navItems = [
    { href: "/portal/tickets", label: t("myTickets"), icon: Ticket, active: pathname === "/portal" || pathname.startsWith("/portal/tickets") },
    { href: "/portal/knowledge-base", label: t("knowledgeBase"), icon: BookOpen, active: pathname.startsWith("/portal/knowledge-base") },
    { href: "/portal/chat", label: t("chatNav"), icon: MessageCircle, active: pathname.startsWith("/portal/chat") },
    ...(loyaltyEnabled ? [{ href: "/portal/loyalty", label: t("loyalty.title"), icon: Sparkles, active: pathname.startsWith("/portal/loyalty") }] : []),
  ]

  return (
    <ThemeProvider>
      <div className="customer-support-surface min-h-screen bg-background">
        <header className="border-b bg-background">
          <div className="mx-auto max-w-5xl px-3 sm:px-4">
            <div className="flex min-h-14 items-center justify-between gap-3">
              <span className="truncate text-base font-semibold">{t("title")}</span>
              <div className="flex min-w-0 items-center gap-2">
                <span className="hidden max-w-48 truncate text-sm sm:block">{user.fullName}</span>
                {user.companyName && <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:block">{user.companyName}</span>}
                <button type="button" onClick={() => void handleLogout()} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("signOut")}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <nav className="-mx-1 flex gap-1 overflow-x-auto pb-2" aria-label={t("portalNavigation")}>
              {navItems.map(({ href, label, icon: Icon, active }) => (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-5">{children}</main>
        {supportAiEnabled && <PortalChatWidget userName={user.fullName} />}
      </div>
    </ThemeProvider>
  )
}
