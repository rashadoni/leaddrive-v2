"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Building2, Save, Loader2, CheckCircle, Crown, Users, Contact } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface OrgData {
  name: string
  logo: string | null
  slug: string
  plan: string
  maxUsers: number
  maxContacts: number
}

const planColors: Record<string, string> = {
  // All four tiers carry a dark-mode pair so badges read consistently in both
  // themes. Starter is neutral zinc; siblings keep their semantic brand
  // colors (blue/violet/amber) with matching dark variants.
  starter: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  business: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  professional: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800",
  enterprise: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
}

export default function OrganizationSettingsPage() {
  const t = useTranslations("settings")
  useAutoTour("organization")
  const tc = useTranslations("common")

  const [data, setData] = useState<OrgData | null>(null)
  const [name, setName] = useState("")
  const [logo, setLogo] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/v1/settings/organization")
        if (res.ok) {
          const json = await res.json()
          setData(json.data)
          setName(json.data.name || "")
          setLogo(json.data.logo || "")
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/v1/settings/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logo: logo || null }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setData(json.data)
        setMessage({ type: "success", text: t("orgSaved") })
      } else {
        setMessage({ type: "error", text: json.error || tc("error") })
      }
    } catch {
      setMessage({ type: "error", text: tc("error") })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 data-tour-id="org-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          {t("orgTitle")} <TourReplayButton tourId="organization" /><HelpButton slug="org-settings" variant="label" />
        </h1>
        <PageDescription text={t("orgDescription")} />
      </div>

      {/* Editable fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("orgDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="orgName" className="text-sm font-medium">{t("orgName")}</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Company LLC"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="orgLogo" className="text-sm font-medium">{t("orgLogo")}</Label>
            <Input
              id="orgLogo"
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-1">{t("orgLogoHint")}</p>
            {logo && (
              <div className="mt-2 p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg inline-block bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element -- Logo URLs are tenant-provided and may use arbitrary domains. */}
                <img src={logo} alt="Logo" className="h-12 max-w-[200px] object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
              </div>
            )}
          </div>

          {message && (
            <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
              {message.type === "success" && <CheckCircle className="h-4 w-4" />}
              {message.text}
            </div>
          )}

          <Button onClick={handleSave} disabled={saving || !name.trim()} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? tc("saving") : tc("save")}
          </Button>
        </CardContent>
      </Card>

      {/* Read-only info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("orgPlanInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Crown className="h-4 w-4" /> {t("orgPlan")}
              </div>
              <Badge variant="outline" className={planColors[data?.plan || "enterprise"] || ""}>
                {(data?.plan || "enterprise").charAt(0).toUpperCase() + (data?.plan || "enterprise").slice(1)}
              </Badge>
            </div>
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Users className="h-4 w-4" /> {t("orgMaxUsers")}
              </div>
              <p className="text-xl font-bold">{data?.maxUsers === -1 ? "∞" : data?.maxUsers}</p>
            </div>
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Contact className="h-4 w-4" /> {t("orgMaxContacts")}
              </div>
              <p className="text-xl font-bold">{data?.maxContacts === -1 ? "∞" : data?.maxContacts}</p>
            </div>
          </div>

          {data?.slug && (
            <div>
              <Label className="text-sm text-muted-foreground">{t("orgSlug")}</Label>
              <p className="text-sm font-mono mt-0.5">{data.slug}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("orgSlugHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
