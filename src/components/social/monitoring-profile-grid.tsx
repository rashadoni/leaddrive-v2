"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Archive,
  ArrowRight,
  ImagePlus,
  Loader2,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"

export type MonitoringProfileGridStatus = "active" | "paused" | "needs_resume" | "archived"
export type MonitoringProfileGridQueueState = "queued" | "running" | "completed" | "issue"

export type MonitoringProfileGridItem = {
  id: string
  subjectId: string | null
  name: string
  status: MonitoringProfileGridStatus
  logoUrl: string | null
  platforms: string[]
  findings: {
    total: number
    new: number
    last24Hours: number
    needsReview: number
    needsAction: number
  }
  lastCollectedAt: string | null
}

type MonitoringProfileGridProps = {
  liveProfiles: MonitoringProfileGridItem[]
  archivedProfiles: MonitoringProfileGridItem[]
  queueStates: Record<string, MonitoringProfileGridQueueState>
  navigationLocked: boolean
  canUploadLogo: boolean
  uploadingLogoId: string | null
  deletingProfileId: string | null
  actionLocked: boolean
  onSelect: (profileId: string) => void
  // Структурно совместимо с MonitoringProfileFindingsTarget; отдельным типом,
  // чтобы сетка не зависела от модуля списка.
  onOpenFindings: (
    profileId: string,
    target?: { status?: "new"; sentiment?: "negative"; dateRange?: "24h" },
  ) => void
  onUploadLogo: (profile: MonitoringProfileGridItem, file: File) => void
  onDelete: (profile: MonitoringProfileGridItem) => void
}

export function MonitoringProfileGrid({
  liveProfiles,
  archivedProfiles,
  queueStates,
  navigationLocked,
  canUploadLogo,
  uploadingLogoId,
  deletingProfileId,
  actionLocked,
  onSelect,
  onOpenFindings,
  onUploadLogo,
  onDelete,
}: MonitoringProfileGridProps) {
  const t = useTranslations("socialMonitoring.profiles")
  const [query, setQuery] = useState("")
  const [archiveOpen, setArchiveOpen] = useState(liveProfiles.length === 0)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filter = (profile: MonitoringProfileGridItem) =>
    !normalizedQuery || profile.name.toLocaleLowerCase().includes(normalizedQuery)
  const filteredLiveProfiles = liveProfiles.filter(filter)
  const filteredArchivedProfiles = archivedProfiles.filter(filter)
  const hasMatches = filteredLiveProfiles.length + filteredArchivedProfiles.length > 0

  return (
    <section className="space-y-4" aria-labelledby="monitoring-profile-grid-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="monitoring-profile-grid-title" className="text-base font-semibold">
            {t("workflow.brandGridTitle")}
          </h3>
          <p className="mt-1 max-w-[70ch] text-sm leading-5 text-muted-foreground">
            {t("workflow.brandGridHint")}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 lg:w-auto">
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("workflow.monitoringCount", { count: liveProfiles.length })}
          </span>
          {(liveProfiles.length + archivedProfiles.length > 4 || query) && (
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={event => {
                  const nextQuery = event.target.value
                  setQuery(nextQuery)
                  const normalizedNextQuery = nextQuery.trim().toLocaleLowerCase()
                  if (
                    normalizedNextQuery
                    && archivedProfiles.some(profile =>
                      profile.name.toLocaleLowerCase().includes(normalizedNextQuery))
                  ) {
                    setArchiveOpen(true)
                  }
                }}
                placeholder={t("workflow.selectorSearchPlaceholder")}
                aria-label={t("workflow.selectorSearchPlaceholder")}
                className="h-11 pl-9 pr-10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("workflow.selectorClearSearch")}
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!hasMatches && (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t("workflow.selectorNoResults")}
        </p>
      )}

      {filteredLiveProfiles.length > 0 && (
        <div
          role="list"
          aria-label={t("workflow.selectorActiveGroup")}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3"
        >
          {filteredLiveProfiles.map(profile => (
            <MonitoringProfileCard
              key={profile.id}
              profile={profile}
              queueState={queueStates[profile.id] ?? null}
              navigationLocked={navigationLocked}
              canUploadLogo={canUploadLogo}
              uploadingLogo={uploadingLogoId === profile.id}
              deleting={deletingProfileId === profile.id}
              actionLocked={actionLocked}
              onSelect={onSelect}
              onOpenFindings={onOpenFindings}
              onUploadLogo={onUploadLogo}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {filteredArchivedProfiles.length > 0 && (
        <details
          className="group rounded-xl border bg-muted/15"
          open={archiveOpen}
          onToggle={event => setArchiveOpen(event.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{t("archivedSectionTitle")}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {filteredArchivedProfiles.length}
            </span>
          </summary>
          <div
            role="list"
            aria-label={t("workflow.selectorArchivedGroup")}
            className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3 border-t p-3"
          >
            {filteredArchivedProfiles.map(profile => (
              <MonitoringProfileCard
                key={profile.id}
                profile={profile}
                queueState={queueStates[profile.id] ?? null}
                navigationLocked={navigationLocked}
                canUploadLogo={canUploadLogo}
                uploadingLogo={uploadingLogoId === profile.id}
                deleting={deletingProfileId === profile.id}
                actionLocked={actionLocked}
                onSelect={onSelect}
                onOpenFindings={onOpenFindings}
                onUploadLogo={onUploadLogo}
                onDelete={onDelete}
                archived
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function MonitoringProfileCard({
  profile,
  queueState,
  navigationLocked,
  canUploadLogo,
  uploadingLogo,
  deleting,
  actionLocked,
  onSelect,
  onOpenFindings,
  onUploadLogo,
  onDelete,
  archived = false,
}: {
  profile: MonitoringProfileGridItem
  queueState: MonitoringProfileGridQueueState | null
  navigationLocked: boolean
  canUploadLogo: boolean
  uploadingLogo: boolean
  deleting: boolean
  actionLocked: boolean
  onSelect: (profileId: string) => void
  // Структурно совместимо с MonitoringProfileFindingsTarget; отдельным типом,
  // чтобы сетка не зависела от модуля списка.
  onOpenFindings: (
    profileId: string,
    target?: { status?: "new"; sentiment?: "negative"; dateRange?: "24h" },
  ) => void
  onUploadLogo: (profile: MonitoringProfileGridItem, file: File) => void
  onDelete: (profile: MonitoringProfileGridItem) => void
  archived?: boolean
}) {
  const t = useTranslations("socialMonitoring.profiles")
  const locale = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const statusTone = profile.status === "active"
    ? "text-emerald-700 dark:text-emerald-300"
    : profile.status === "paused"
      ? "text-amber-800 dark:text-amber-300"
      : "text-muted-foreground"
  const visiblePlatforms = profile.platforms.slice(0, 4)

  return (
    <article
      role="listitem"
      data-testid={`social-profile-card-${profile.id}`}
      className={[
        "group/card relative min-w-0 overflow-hidden rounded-xl border bg-card p-4 transition-[transform,border-color,background-color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]",
        "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm motion-reduce:transform-none",
        archived ? "opacity-80" : "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label={t("workflow.selectBrand", { name: profile.name })}
        disabled={navigationLocked}
        onClick={() => onSelect(profile.id)}
        className="absolute inset-0 z-0 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
      >
        <span className="sr-only">{t("workflow.selectBrand", { name: profile.name })}</span>
      </button>

      <div className="pointer-events-none relative z-[1] flex min-w-0 items-start gap-3">
        <MonitoringProfileLogo name={profile.name} logoUrl={profile.logoUrl} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="truncate text-sm font-semibold" title={profile.name}>
              {profile.name}
            </h4>
          </div>
          <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${statusTone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {t(`status.${profile.status}`)}
          </p>
        </div>

        {canUploadLogo && profile.subjectId && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) onUploadLogo(profile, file)
                event.target.value = ""
              }}
            />
            <button
              type="button"
              disabled={uploadingLogo}
              aria-label={t(
                profile.logoUrl ? "logo.replaceFor" : "logo.uploadFor",
                { name: profile.name },
              )}
              title={t(profile.logoUrl ? "logo.replace" : "logo.upload")}
              onClick={() => inputRef.current?.click()}
              className="pointer-events-auto relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground opacity-100 transition-[color,border-color,background-color,opacity] hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait sm:opacity-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:opacity-100"
            >
              {uploadingLogo
                ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : profile.logoUrl
                  ? <Pencil className="h-4 w-4" aria-hidden="true" />
                  : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
            </button>
          </>
        )}
        {archived && profile.subjectId && (
          <button
            type="button"
            data-testid={`social-profile-selector-delete-${profile.id}`}
            disabled={deleting || actionLocked}
            aria-label={`${t("actions.delete")}: ${profile.name}`}
            title={t("actions.delete")}
            onClick={() => onDelete(profile)}
            className="pointer-events-auto relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting
              ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* «Yeni» здесь раньше означало «статус ещё new», то есть «менеджер не
          трогал». Разбором никто не пользуется, поэтому счётчик почти всегда
          совпадал с общим и карточка дважды показывала одно число. Теперь:
          свежесть (24 часа), объём (всего релевантных) и работа (требуют
          реакции) — три разных ответа вместо одного повторённого. */}
      <div className="pointer-events-auto relative z-10 mt-4 grid grid-cols-3 gap-2" role="group" aria-label={t("workflow.clientFindingSummary", { name: profile.name })}>
        <button
          type="button"
          data-testid={`social-profile-card-findings-last24h-${profile.id}`}
          disabled={navigationLocked || !profile.subjectId}
          onClick={() => onOpenFindings(profile.id, { dateRange: "24h" })}
          className="group/metric flex min-h-16 items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-left transition-[border-color,background-color] hover:border-primary/30 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("workflow.openFilteredResults", { filter: t("card.findings.last24Hours"), count: profile.findings.last24Hours })}
        >
          <span>
            <span className="block text-lg font-semibold tabular-nums text-foreground">{profile.findings.last24Hours}</span>
            <span className="block text-[11px] text-muted-foreground">{t("card.findings.last24Hours")}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover/metric:translate-x-0.5 group-hover/metric:text-primary motion-reduce:transform-none" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid={`social-profile-card-findings-total-${profile.id}`}
          disabled={navigationLocked || !profile.subjectId}
          onClick={() => onOpenFindings(profile.id)}
          className="group/metric flex min-h-16 items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-left transition-[border-color,background-color] hover:border-primary/30 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("workflow.openFilteredResults", { filter: t("card.findings.totalRelevant"), count: profile.findings.total })}
        >
          <span>
            <span className="block text-lg font-semibold tabular-nums text-foreground">{profile.findings.total}</span>
            <span className="block text-[11px] text-muted-foreground">{t("card.findings.totalRelevant")}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover/metric:translate-x-0.5 group-hover/metric:text-primary motion-reduce:transform-none" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid={`social-profile-card-findings-needs-action-${profile.id}`}
          disabled={navigationLocked || !profile.subjectId}
          onClick={() => onOpenFindings(profile.id, { status: "new", sentiment: "negative" })}
          className="group/metric flex min-h-16 items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/[0.045] px-3 py-2 text-left transition-[border-color,background-color] hover:border-primary/40 hover:bg-primary/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("workflow.openFilteredResults", { filter: t("card.findings.needsAction"), count: profile.findings.needsAction })}
        >
          <span>
            <span className="block text-lg font-semibold tabular-nums text-primary">{profile.findings.needsAction}</span>
            <span className="block text-[11px] text-muted-foreground">{t("card.findings.needsAction")}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-primary/70 transition-transform group-hover/metric:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
        </button>
      </div>

      <div className="pointer-events-none relative z-[1] mt-3 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1">
            {visiblePlatforms.map(platform => (
              <span
                key={platform}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {t.has(`platforms.${platform}`) ? t(`platforms.${platform}`) : platform}
              </span>
            ))}
            {profile.platforms.length > visiblePlatforms.length && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                +{profile.platforms.length - visiblePlatforms.length}
              </span>
            )}
          </div>
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            {profile.lastCollectedAt
              ? t("report.lastCollected", {
                  date: new Date(profile.lastCollectedAt).toLocaleString(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })
              : t("report.neverCollected")}
          </p>
        </div>
        {queueState && (
          <span
            className={[
              "shrink-0 rounded-full px-2 py-1 text-[10px] font-medium",
              queueState === "running"
                ? "bg-primary/10 text-primary"
                : queueState === "completed"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : queueState === "issue"
                    ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "bg-muted text-muted-foreground",
            ].join(" ")}
          >
            {t(`bulk.cardState.${queueState}`)}
          </span>
        )}
      </div>
    </article>
  )
}

export function MonitoringProfileLogo({
  name,
  logoUrl,
}: {
  name: string
  logoUrl: string | null
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-background">
        {/* Runtime brand logos are authenticated, same-origin uploads. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          className="h-full w-full object-contain p-1.5"
          onError={() => setFailedUrl(logoUrl)}
        />
      </span>
    )
  }

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase())
    .join("")

  return (
    <span
      aria-hidden="true"
      className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/[0.08] text-sm font-semibold tracking-wide text-primary"
    >
      {initials || "—"}
    </span>
  )
}
