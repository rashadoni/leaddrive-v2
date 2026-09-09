"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronRight, CreditCard, Users, Zap, LayoutDashboard, Lock, FileText, Plug, Keyboard, BellRing, Globe2, Building2, Bot, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function SettingsPage() {
  const router = useRouter()
  const t = useTranslations("settings")
  useAutoTour("settingsHub")

  // Overview grid for the org-level settings. Since every page below also has
  // its own sidebar entry, this page is no longer a required stop — it is kept
  // as an index and as the destination of module-disabled.tsx's "back to
  // settings" link, not as a second navigation people must learn.
  const SETTINGS_SECTIONS = [
    { icon: Building2, title: t("orgTitle"), description: t("orgDescription"), href: "/settings/organization", hint: t("hintOrganization") },
    { icon: CreditCard, title: t("billing"), description: t("billingDesc"), href: "/settings/billing", hint: t("hintBilling") },
    { icon: Users, title: t("roles"), description: t("rolesDesc"), href: "/settings/roles", hint: t("hintRoles") },
    { icon: Zap, title: t("workflows"), description: t("workflowsDesc"), href: "/settings/workflows", hint: t("hintWorkflows") },
    { icon: LayoutDashboard, title: t("dashboardSettings"), description: t("dashboardSettingsDesc"), href: "/settings/dashboard", hint: t("hintDashboardSettings") },
    { icon: Sparkles, title: t("customFields"), description: t("customFieldsDesc"), href: "/settings/custom-fields", hint: t("hintCustomFields") },
    { icon: BellRing, title: t("notificationsTitle"), description: t("notificationsDesc"), href: "/settings/notifications", hint: t("notificationsHint") },
    { icon: Lock, title: t("security"), description: t("securityDesc"), href: "/settings/security", hint: t("hintSecurity") },
    { icon: FileText, title: t("auditLog"), description: t("auditLogDesc"), href: "/settings/audit-log", hint: t("hintAuditLog") },
    { icon: Plug, title: t("integrationsTitle"), description: t("integrationsDesc"), href: "/settings/integrations", hint: t("integrationsHint") },
    { icon: Keyboard, title: t("macrosTitle"), description: t("macrosDesc"), href: "/settings/macros", hint: t("macrosHint") },
    { icon: Globe2, title: t("customDomainsTitle"), description: t("customDomainsDesc"), href: "/settings/custom-domains", hint: t("hintCustomDomains") },
    { icon: Bot, title: t("aiAutomationTitle"), description: t("aiAutomationDesc"), href: "/settings/ai-automation", hint: t("aiAutomationHint") },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="settingsHub" /> <HelpButton slug="settings-overview" variant="label" /></h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        <PageDescription text={t("pageDescription")} />
      </div>
      <DidYouKnow page="settings" className="mb-4" />

      <div data-tour-id="settings-grid" className="grid gap-4 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => {
          const IconComponent = section.icon
          return (
            <Card
              key={section.href}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => router.push(section.href)}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <IconComponent className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold flex items-center gap-1.5">{section.title} <InfoHint text={section.hint} size={12} /></h3>
                      <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground mt-1" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
