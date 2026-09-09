"use client"

import { Plus, Route, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  coerceMtmRouteTargetTypes,
  type MtmRouteTargetObjectType,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"

export function RouteTargetTypeSettings({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: MtmRouteTargetType[]) => void
}) {
  const t = useTranslations("mtmSettingsPage")
  const rows = Array.isArray(value) ? value as MtmRouteTargetType[] : coerceMtmRouteTargetTypes(value)
  const enabledCount = rows.filter((row) => row.enabled).length
  const labelKeys = {
    az: "routeTargetLabelAZ",
    ru: "routeTargetLabelRU",
    en: "routeTargetLabelEN",
  } as const

  function update(id: string, patch: Partial<MtmRouteTargetType>) {
    onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function updateLabel(id: string, locale: "az" | "ru" | "en", label: string) {
    onChange(rows.map((row) => row.id === id
      ? { ...row, labels: { ...row.labels, [locale]: label } }
      : row))
  }

  function addRow() {
    const id = `custom-${Date.now().toString(36)}`
    onChange([...rows, {
      id,
      labels: { az: t("routeTargetNew"), ru: t("routeTargetNew"), en: t("routeTargetNew") },
      direction: "ORGANIZATION",
      objectType: null,
      organizationKind: null,
      enabled: true,
    }])
  }

  return (
    <section className="border-y border-zinc-200 bg-card py-4 dark:border-zinc-700" aria-labelledby="route-target-types-title">
      <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="route-target-types-title" className="text-base font-semibold">{t("routeTargetTitle")}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("routeTargetHint")}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={addRow} disabled={rows.length >= 20}>
          <Plus className="h-4 w-4" />{t("routeTargetAdd")}
        </Button>
      </div>

      <div className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
        {rows.map((row, index) => {
          const organizationSource = row.direction !== "DOCTOR"
          return (
            <article key={row.id} className="space-y-4 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t("routeTargetNumber", { number: index + 1 })}</p>
                  <p className="text-xs text-muted-foreground">{row.labels.az}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-disabled={row.enabled && enabledCount === 1}
                    aria-label={t("routeTargetEnabled")}
                    onClick={() => {
                      if (row.enabled && enabledCount === 1) return
                      update(row.id, { enabled: !row.enabled })
                    }}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${row.enabled ? "bg-primary" : "bg-muted"} ${row.enabled && enabledCount === 1 ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${row.enabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 text-destructive"
                    aria-label={t("routeTargetDelete")}
                    onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
                    disabled={rows.length <= 1 || (row.enabled && enabledCount === 1)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {(["az", "ru", "en"] as const).map((language) => (
                  <label key={language} className="space-y-1 text-xs">
                    <span className="text-muted-foreground">{t(labelKeys[language])}</span>
                    <Input value={row.labels[language]} maxLength={60} onChange={(event) => updateLabel(row.id, language, event.target.value)} />
                  </label>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("routeTargetSource")}</span>
                  <Select
                    value={row.direction}
                    onChange={(event) => update(row.id, {
                      direction: event.target.value as MtmRouteTargetType["direction"],
                      objectType: event.target.value === "DOCTOR" ? null : row.objectType,
                      organizationKind: event.target.value === "DOCTOR" ? null : row.organizationKind,
                    })}
                  >
                    <option value="DOCTOR">{t("routeTargetSourceContacts")}</option>
                    <option value="PHARMACY">{t("routeTargetSourcePharmacies")}</option>
                    <option value="ORGANIZATION">{t("routeTargetSourceOrganizations")}</option>
                  </Select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("routeTargetObjectType")}</span>
                  <Select
                    value={row.objectType ?? ""}
                    disabled={!organizationSource}
                    onChange={(event) => update(row.id, { objectType: (event.target.value || null) as MtmRouteTargetObjectType | null })}
                  >
                    <option value="">{t("routeTargetObjectAny")}</option>
                    <option value="PHARMACY">{t("routeTargetObjectPharmacy")}</option>
                    <option value="CLINIC">{t("routeTargetObjectClinic")}</option>
                    <option value="STORE">{t("routeTargetObjectStore")}</option>
                    <option value="OTHER">{t("routeTargetObjectOther")}</option>
                  </Select>
                </label>

                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("routeTargetKind")}</span>
                  <Input
                    value={row.organizationKind ?? ""}
                    disabled={!organizationSource}
                    maxLength={120}
                    placeholder={t("routeTargetKindPlaceholder")}
                    onChange={(event) => update(row.id, { organizationKind: event.target.value || null })}
                  />
                </label>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
