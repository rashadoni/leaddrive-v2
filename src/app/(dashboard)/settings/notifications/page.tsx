"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Bell, ChevronDown, ChevronRight, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface TypeRow {
  key: string
  enabled: boolean
}

interface SectionRow {
  key: string
  accessible: boolean
  push: boolean
  types: TypeRow[]
}

interface PrefsData {
  sections: SectionRow[]
}

export default function NotificationsSettingsPage() {
  const t = useTranslations("settingsNotifications")
  useAutoTour("notificationsSettings")
  const [sections, setSections] = useState<SectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users/me/notification-preferences")
      const json = await res.json()
      if (json.success) {
        setSections((json.data as PrefsData).sections)
      }
    } catch (err) {
      console.error("[notification-prefs fetch]", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrefs()
  }, [fetchPrefs])

  const toggleExpand = (sectionKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }
      return next
    })
  }

  const handleSectionPushToggle = async (sectionKey: string, newValue: boolean) => {
    // Optimistic update
    setSections((prev) =>
      prev.map((s) => (s.key === sectionKey ? { ...s, push: newValue } : s))
    )
    try {
      const res = await fetch("/api/v1/users/me/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey, push: newValue }),
      })
      if (!res.ok) {
        // Revert on error
        setSections((prev) =>
          prev.map((s) => (s.key === sectionKey ? { ...s, push: !newValue } : s))
        )
        toast.error(t("saveError") ?? "Failed to save")
      }
    } catch {
      setSections((prev) =>
        prev.map((s) => (s.key === sectionKey ? { ...s, push: !newValue } : s))
      )
      toast.error(t("saveError") ?? "Failed to save")
    }
  }

  const handleTypePushToggle = async (sectionKey: string, typeKey: string, newValue: boolean) => {
    // Optimistic update
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey
          ? {
              ...s,
              types: s.types.map((tp) => (tp.key === typeKey ? { ...tp, enabled: newValue } : tp)),
            }
          : s
      )
    )
    try {
      const res = await fetch("/api/v1/users/me/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionKey, types: { [typeKey]: newValue } }),
      })
      if (!res.ok) {
        // Revert on error
        setSections((prev) =>
          prev.map((s) =>
            s.key === sectionKey
              ? {
                  ...s,
                  types: s.types.map((tp) =>
                    tp.key === typeKey ? { ...tp, enabled: !newValue } : tp
                  ),
                }
              : s
          )
        )
        toast.error(t("saveError") ?? "Failed to save")
      }
    } catch {
      setSections((prev) =>
        prev.map((s) =>
          s.key === sectionKey
            ? {
                ...s,
                types: s.types.map((tp) =>
                  tp.key === typeKey ? { ...tp, enabled: !newValue } : tp
                ),
              }
            : s
        )
      )
      toast.error(t("saveError") ?? "Failed to save")
    }
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-4 md:p-6 max-w-3xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="h-4 bg-muted rounded w-96" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6 max-w-3xl">
      <div data-tour-id="notifications-header">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          {t("title")}
          <HelpButton slug="notification-settings" variant="label" />
          <TourReplayButton tourId="notificationsSettings" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
        <p className="text-xs text-muted-foreground mt-1 italic">{t("listAlwaysShown")}</p>
      </div>

      {sections.length === 0 ? (
        <Card data-tour-id="notifications-groups">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-tour-id="notifications-groups">
          {sections.map((section) => {
          const isExpanded = expanded.has(section.key)
          const isAccessible = section.accessible
          const hasTypes = section.types.length > 0

          const groupLabelKey = `groups.${section.key}`
          const groupDescKey = `groupDesc.${section.key}`
          const groupLabel = t.has(groupLabelKey) ? t(groupLabelKey) : section.key
          const groupDesc = t.has(groupDescKey) ? t(groupDescKey) : ""

          return (
            <Card
              key={section.key}
              data-tour-id="notifications-section"
              className={cn(
                "transition-opacity",
                !isAccessible && "opacity-60"
              )}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Expand chevron */}
                    {hasTypes ? (
                      <button
                        onClick={() => toggleExpand(section.key)}
                        disabled={!isAccessible}
                        className={cn(
                          "mt-1 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors",
                          !isAccessible && "cursor-not-allowed pointer-events-none"
                        )}
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <span className="mt-1 w-4 flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Label
                          className={cn(
                            "text-sm font-semibold leading-none",
                            !isAccessible && "text-muted-foreground"
                          )}
                        >
                          {groupLabel}
                        </Label>
                        {!isAccessible && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                            title={t("noAccess")}
                          >
                            <AlertCircle className="h-3 w-3" />
                            {t("noAccess")}
                          </span>
                        )}
                      </div>
                      {groupDesc && (
                        <p className="text-xs text-muted-foreground mt-0.5">{groupDesc}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{t("pushLabel")}</p>
                    </div>
                  </div>

                  {/* Section push Switch */}
                  <Switch
                    checked={section.push}
                    disabled={!isAccessible}
                    onCheckedChange={(checked) => handleSectionPushToggle(section.key, checked)}
                    aria-label={`${groupLabel} ${t("pushLabel")}`}
                    className="flex-shrink-0 mt-1"
                  />
                </div>

                {/* Per-type switches (expanded) */}
                {isExpanded && hasTypes && (
                  <div className="mt-4 ml-7 space-y-2 border-l-2 border-muted pl-4">
                    {section.types.map((tp) => {
                      let kindLabel: string
                      try {
                        kindLabel = t(`kinds.${tp.key.replace(/\./g, "_")}`)
                      } catch {
                        kindLabel = tp.key
                      }

                      return (
                        <div key={tp.key} className="flex items-center justify-between gap-4 py-1">
                          <Label
                            className={cn(
                              "text-xs text-muted-foreground font-normal flex-1",
                              !isAccessible && "opacity-50"
                            )}
                          >
                            {kindLabel}
                          </Label>
                          <Switch
                            checked={tp.enabled}
                            disabled={!isAccessible}
                            onCheckedChange={(checked) =>
                              handleTypePushToggle(section.key, tp.key, checked)
                            }
                            aria-label={kindLabel}
                            className="h-4 w-7 [&_span]:h-3 [&_span]:w-3 flex-shrink-0"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )
          })}
        </div>
      )}
    </div>
  )
}
