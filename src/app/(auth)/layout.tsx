import { headers } from "next/headers"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { getOrgSubdomain } from "@/lib/tenant-domain"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Server component: before rendering the login form, resolve the subdomain and
// confirm a tenant actually exists at it. Unknown {slug}.leaddrivecrm.org gets a
// "Workspace not found" page instead of a real-looking login form — closes the
// phishing-cosmetic gap where any wildcard subdomain served the live form
// (see memory/deferred_findings.md, 2026-06-10). Reserved/apex/localhost hosts
// (getOrgSubdomain → null) are the legitimate main entry and render normally.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  const host = hdrs.get("host")?.replace(/:\d+$/, "") || ""
  const slug = getOrgSubdomain(host)

  let tenantMissing = false
  if (slug) {
    try {
      const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } })
      tenantMissing = !org
    } catch {
      // Fail OPEN: a transient DB error must never block a legitimate login.
      // The "workspace not found" page is cosmetic hardening, not a gate.
      tenantMissing = false
    }
  }

  return (
    <>
      {/* Always show the default wallpaper video on login */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
        >
          <source src="/wallpapers/alpine-v4.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="relative z-[2] flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md [&_.rounded-xl]:bg-[hsl(210_18%_14%/0.70)] [&_.rounded-xl]:text-white [&_.rounded-xl]:backdrop-blur-xl [&_.rounded-xl]:border-white/15 [&_label]:text-white/90 [&_input]:bg-white/10 [&_input]:text-white [&_input]:border-white/20 [&_input]:placeholder-white/40 [&_.text-muted-foreground]:text-white/60 [&_a]:text-white/70 [&_a:hover]:text-white">
          {tenantMissing ? <TenantNotFound /> : children}
          <LegalLinks />
        </div>
      </div>
    </>
  )
}

async function LegalLinks() {
  const t = await getTranslations("marketing")

  return (
    <nav aria-label={t("footer.legal")} className="mt-4 flex justify-center">
      <div className="flex gap-4 rounded-full bg-black/40 px-4 py-1.5 text-xs backdrop-blur-md">
        <Link href="/legal/terms" className="text-white/90 hover:text-white">
          {t("footer.terms")}
        </Link>
        <Link href="/legal/privacy" className="text-white/90 hover:text-white">
          {t("footer.privacy")}
        </Link>
      </div>
    </nav>
  )
}

async function TenantNotFound() {
  const t = await getTranslations("auth")
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("tenantNotFoundTitle")}</CardTitle>
        <CardDescription>{t("tenantNotFoundDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">LeadDrive CRM</CardContent>
    </Card>
  )
}
