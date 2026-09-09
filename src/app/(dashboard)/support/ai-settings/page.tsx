"use client"

import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Bot,
  BookOpenCheck,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  TicketCheck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"

const COVERAGE = [
  { key: "tickets", icon: TicketCheck },
  { key: "conversations", icon: MessageSquareText },
  { key: "knowledge", icon: BookOpenCheck },
] as const

export default function SupportAiSettingsPage() {
  const { data: session, status } = useSession()
  const t = useTranslations("supportAiSettings")
  const organizationId = session?.user?.organizationId
  const role = session?.user?.role
  const canManage = role === "admin" || role === "superadmin"
  const { enabled: disabled, hasLoaded, loading, saving, error, setEnabled: setDisabled } = useOrganizationFeature(
    SUPPORT_AI_DISABLED_FEATURE,
    organizationId,
  )
  const stateUnavailable = !organizationId || (!hasLoaded && Boolean(error))
  const enabled = !stateUnavailable && !disabled

  const handleToggle = async (nextEnabled: boolean) => {
    const saved = await setDisabled(!nextEnabled)
    if (saved) toast.success(nextEnabled ? t("enabledToast") : t("disabledToast"))
    else toast.error(t("saveError"))
  }

  if (status === "loading" || loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-16 max-w-2xl animate-pulse rounded-xl bg-muted" />
        <div className="h-56 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border bg-card shadow-sm">
            <Bot className="h-[18px] w-[18px] text-primary" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
        </div>
      </header>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="border-b bg-muted/25 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{t("masterTitle")}</CardTitle>
                <Badge
                  variant="outline"
                  className={enabled
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-border bg-background text-muted-foreground"}
                >
                  {stateUnavailable ? t("statusUnknown") : enabled ? t("statusOn") : t("statusOff")}
                </Badge>
              </div>
              <p id="support-ai-master-hint" className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {stateUnavailable ? t("loadError") : enabled ? t("masterHintOn") : t("masterHintOff")}
              </p>
            </div>
            <div className="flex min-h-10 items-center gap-3 rounded-xl border bg-background px-3 py-2 shadow-sm">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <span className="text-sm font-medium">{enabled ? t("switchOn") : t("switchOff")}</span>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={saving || !canManage || stateUnavailable}
                aria-label={t("switchLabel")}
                aria-describedby="support-ai-master-hint"
              />
            </div>
          </div>
          {!canManage && (
            <p className="mt-2 text-xs text-muted-foreground">{t("adminOnly")}</p>
          )}
          {error && <p role="alert" className="sr-only">{t("loadError")}</p>}
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">{t("coverageTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("coverageDescription")}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {COVERAGE.map(({ key, icon: Icon }) => (
              <div key={key} className="rounded-xl border bg-card p-3.5">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-foreground/75" />
                  </span>
                  <h3 className="text-sm font-medium">{t(`${key}Title`)}</h3>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(`${key}Description`)}</p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-dashed bg-muted/20 p-3.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">{t("safetyNote")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
