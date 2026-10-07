"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Lock, Plus, Route, Trash2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  MTM_ROUTE_TARGET_AUDIENCES,
  MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS,
  coerceMtmRouteTargetTypes,
  renameRouteTarget,
  routeTargetAudience,
  routeTargetAudiencePatch,
  routeTargetLabel,
  type MtmRouteTargetAudience,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"

type Language = keyof MtmRouteTargetType["labels"]
const LANGUAGES: readonly Language[] = ["az", "ru", "en"]

/**
 * The buttons a field agent picks clients with when building a route.
 *
 * This screen used to be five identical forms — «Тип 1», «Тип 2»… — each with
 * three name fields, a «data source», an «organization category» and an
 * «additional exact type», two screens tall before any other setting. Owner,
 * 2026-10-08: «это нельзя как-то интерактивнее сделать? переводы какие-то
 * непонятные и сама структура какая-то непонятная».
 *
 * Now it is what it configures: a short list of buttons beside the picker the
 * agent sees, drawn from the same rows. A row opens to its name and one
 * question — whom does it show. Nothing about what is stored has changed.
 */
export function RouteTargetTypeSettings({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: MtmRouteTargetType[]) => void
}) {
  const t = useTranslations("mtmSettingsPage")
  const viewerLocale = useLocale()
  const language: Language = viewerLocale === "az" || viewerLocale === "en" ? viewerLocale : "ru"
  const rows = Array.isArray(value) ? value as MtmRouteTargetType[] : coerceMtmRouteTargetTypes(value)
  const enabledCount = rows.filter((row) => row.enabled).length
  const [openId, setOpenId] = useState<string | null>(null)
  const [translationsOpen, setTranslationsOpen] = useState(false)
  const labelKeys = {
    az: "routeTargetLabelAZ",
    ru: "routeTargetLabelRU",
    en: "routeTargetLabelEN",
  } as const
  const audienceName = (audience: MtmRouteTargetAudience | "custom") => t(`routeTargetAudience_${audience}`)
  // The same words end a sentence in the row («Показывает: врачи») and stand
  // alone in the list of choices, where they start with a capital.
  const audienceChoice = (audience: MtmRouteTargetAudience | "custom") => {
    const name = audienceName(audience)
    return name.charAt(0).toLocaleUpperCase(viewerLocale) + name.slice(1)
  }

  function update(id: string, patch: Partial<MtmRouteTargetType>) {
    onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function updateLabel(id: string, locale: "az" | "ru" | "en", label: string) {
    onChange(rows.map((row) => row.id === id
      ? { ...row, labels: locale === language ? renameRouteTarget(row.labels, locale, label) : { ...row.labels, [locale]: label } }
      : row))
  }

  function addRow() {
    const id = `custom-${Date.now().toString(36)}`
    onChange([...rows, {
      id,
      labels: { az: t("routeTargetNew"), ru: t("routeTargetNew"), en: t("routeTargetNew") },
      direction: "ORGANIZATION",
      objectType: "OTHER",
      organizationKind: null,
      enabled: true,
    }])
    setOpenId(id)
  }

  function moveRow(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(nextIndex, 0, row)
    onChange(next)
  }

  const shown = rows.filter((row) => row.enabled)

  return (
    <section className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700" aria-labelledby="route-target-types-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="route-target-types-title" className="text-base font-semibold">{t("routeTargetTitle")}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("routeTargetHint")}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={addRow} disabled={rows.length >= 20}>
          <Plus className="h-4 w-4" />{t("routeTargetAdd")}
        </Button>
      </div>

      {/* Two equal halves, like every other row of the settings page: the
          list and what the agent sees stand side by side at one height. */}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700" data-testid="route-target-rows">
          {rows.map((row, index) => {
            // The unfiltered button is always there, always first and always on
            // (coerceMtmRouteTargetTypes): only its name is the organization's.
            const fixed = row.id === MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS.id
            const lastEnabled = row.enabled && enabledCount === 1
            const audience = routeTargetAudience(row)
            const open = openId === row.id
            const name = routeTargetLabel(row, language)
            return (
              <li key={row.id} data-testid={`route-target-row-${row.id}`}>
                <div className="flex items-center gap-1 py-1.5">
                  {fixed ? (
                    // The first button never moves: its slot says so instead
                    // of standing empty and pushing the name out of line.
                    <span className="inline-flex min-h-11 w-[4.75rem] shrink-0 items-center justify-center text-muted-foreground" title={t("routeTargetAlways")} data-testid="route-target-fixed-slot">
                      <Lock className="h-4 w-4" aria-hidden="true" />
                    </span>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-9"
                        aria-label={t("routeTargetMoveUp")}
                        onClick={() => moveRow(index, -1)}
                        disabled={index <= 1}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-9"
                        aria-label={t("routeTargetMoveDown")}
                        onClick={() => moveRow(index, 1)}
                        disabled={index === rows.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={t("routeTargetEdit", { name })}
                    onClick={() => { setOpenId(open ? null : row.id); setTranslationsOpen(false) }}
                    className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-muted/60", !row.enabled && "opacity-60")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t("routeTargetShows", { who: audienceName(audience) })}{row.organizationKind ? ` · ${row.organizationKind}` : ""}
                      </span>
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-disabled={fixed || lastEnabled}
                    aria-label={t("routeTargetEnabled")}
                    title={fixed ? t("routeTargetAlways") : lastEnabled ? t("routeTargetLastEnabled") : undefined}
                    onClick={() => {
                      if (fixed || lastEnabled) return
                      update(row.id, { enabled: !row.enabled })
                    }}
                    className={cn(
                      "relative mx-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      row.enabled ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-700",
                      (fixed || lastEnabled) && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className={cn("inline-block h-5 w-5 rounded-full bg-white transition-transform", row.enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
                  </button>
                </div>

                {open ? (
                  <div className="space-y-3 pb-3 pl-[4.75rem] pr-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">{t("routeTargetName")}</span>
                        <Input value={row.labels[language]} maxLength={60} onChange={(event) => updateLabel(row.id, language, event.target.value)} />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-muted-foreground">{t("routeTargetAudience")}</span>
                        <Select
                          value={audience}
                          disabled={fixed}
                          onChange={(event) => update(row.id, routeTargetAudiencePatch(event.target.value as MtmRouteTargetAudience))}
                        >
                          {audience === "custom" ? <option value="custom" disabled>{audienceChoice("custom")}</option> : null}
                          {MTM_ROUTE_TARGET_AUDIENCES.map((option) => <option key={option} value={option}>{audienceChoice(option)}</option>)}
                        </Select>
                      </label>
                    </div>

                    {fixed ? (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("routeTargetAlways")}
                      </p>
                    ) : audience !== "doctors" ? (
                      <label className="block space-y-1 text-xs">
                        <span className="text-muted-foreground">{t("routeTargetKind")}</span>
                        <Input
                          value={row.organizationKind ?? ""}
                          maxLength={120}
                          placeholder={t("routeTargetKindPlaceholder")}
                          onChange={(event) => update(row.id, { organizationKind: event.target.value || null })}
                        />
                      </label>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        aria-expanded={translationsOpen}
                        onClick={() => setTranslationsOpen((current) => !current)}
                        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", translationsOpen && "rotate-180")} aria-hidden="true" />
                        {t("routeTargetOtherLanguages")}
                      </button>
                      {fixed ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
                          disabled={rows.length <= 1 || lastEnabled}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />{t("routeTargetDelete")}
                        </Button>
                      )}
                    </div>
                    {translationsOpen ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {LANGUAGES.filter((other) => other !== language).map((other) => (
                          <label key={other} className="space-y-1 text-xs">
                            <span className="text-muted-foreground">{t(labelKeys[other])}</span>
                            <Input value={row.labels[other]} maxLength={60} onChange={(event) => updateLabel(row.id, other, event.target.value)} />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        {/* The picker as the agent's phone draws it, from the rows on the left:
            what is switched off is not here, and the order is the order. */}
        <aside className="rounded-2xl border border-zinc-200 bg-muted/40 p-4 dark:border-zinc-700" aria-label={t("routeTargetPreviewTitle")} data-testid="route-target-preview">
          <div className="mx-auto w-full max-w-xs">
          <p className="text-center text-xs text-muted-foreground">{t("routeTargetPreviewTitle")}</p>
          <p className="mt-2 text-sm font-semibold">{t("routeTargetPreviewQuestion")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {shown.map((row, index) => {
              const name = routeTargetLabel(row, language)
              return (
                <span
                  key={row.id}
                  className={cn(
                    "truncate rounded-xl border px-2 py-2 text-center text-xs font-medium",
                    index === 0 ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 bg-background dark:border-zinc-700",
                    // Pairs; an odd last button takes the whole row instead of half of it.
                    shown.length % 2 === 1 && index === shown.length - 1 && "col-span-2",
                  )}
                >
                  {name}
                </span>
              )
            })}
          </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
