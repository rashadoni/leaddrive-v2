import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const profileList = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-profile-list.tsx"),
  "utf8",
)
const profileGrid = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-profile-grid.tsx"),
  "utf8",
)
const progress = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-run-progress.tsx"),
  "utf8",
)
const page = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/social-monitoring/page.tsx"),
  "utf8",
)
const legalPanel = readFileSync(
  join(process.cwd(), "src/components/social/legal-case-panel.tsx"),
  "utf8",
)
const select = readFileSync(
  join(process.cwd(), "src/components/ui/select.tsx"),
  "utf8",
)
const messages = Object.fromEntries(
  ["en", "ru", "az"].map(locale => [
    locale,
    JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8")),
  ]),
) as Record<string, {
  socialMonitoring: {
    views: { mentions: string }
    profiles: {
      workflow: {
        results: string
        resultsTitle: string
        openCleanResults: string
        openFilteredResults: string
      }
      report: {
        view: string
        platformResultsLabel: string
      }
      actions: { openResults: string }
    }
  }
}>

// «Yeni» на карточке означало «статус ещё new», то есть «менеджер не трогал».
// Разбором почти не пользуются, поэтому счётчик совпадал с общим и карточка
// дважды показывала одно число. Три счётчика отвечают на три разных вопроса.
describe("счётчики карточки клиента", () => {
  const summaries = readFileSync(
    join(process.cwd(), "src/lib/social/monitoring-profiles.ts"),
    "utf8",
  )

  it("показывает свежесть, объём и работу вместо повторённого «нового»", () => {
    expect(profileGrid).toContain("social-profile-card-findings-last24h-")
    expect(profileGrid).toContain("social-profile-card-findings-total-")
    expect(profileGrid).toContain("social-profile-card-findings-needs-action-")
    expect(profileGrid).toContain("profile.findings.last24Hours")
    expect(profileGrid).toContain("profile.findings.needsAction")
    // Счётчик «менеджер не трогал» ушёл с карточки целиком, вместе с плиткой.
    expect(profileGrid).not.toContain("social-profile-card-findings-new-")
    expect(profileGrid).not.toContain("profile.findings.new")
    expect(profileGrid).not.toContain('t("card.findings.new")')
  })

  it("открывает ровно тот срез, который посчитала каждая плитка", () => {
    expect(profileGrid).toContain('onOpenFindings(profile.id, { dateRange: "24h" })')
    expect(profileGrid).toContain('onOpenFindings(profile.id, { status: "new", sentiment: "negative" })')
    // Иначе плитка «за 24 часа» открыла бы ленту за весь период.
    expect(page).toContain('setMentionDateRange(target.dateRange ?? "all")')
  })

  it("считает «требуют реакции» как нетронутый негатив или юридического кандидата", () => {
    expect(summaries).toContain('AS "needsAction"')
    expect(summaries).toContain("sm.status = 'new'")
    expect(summaries).toContain("social_legal_candidates lc")
    expect(summaries).toContain("lc.status <> 'DISMISSED'")
  })

  it("только читает статусы и не трогает очередь авто-ревью", () => {
    // Правка счётчиков не имеет права закрывать статусы или переразбирать
    // очередь: три контекстные REVIEW-записи должны остаться нетронутыми.
    const needsActionBlock = summaries.slice(
      summaries.indexOf("«Требуют реакции»"),
      summaries.indexOf('AS "needsAction"'),
    )
    expect(needsActionBlock).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i)
    expect(summaries).toContain('0::int AS "needsReview"')
  })

  // Карточка и лента обязаны показывать одно число: клик по счётчику должен
  // открывать ровно те строки, которые он посчитал.
  it("считает счётчики по тому же языку, что и лента по умолчанию", () => {
    expect(summaries).toContain('const CARD_LANGUAGES = ["az", "ru"] as const')
    expect(page).toContain('const DEFAULT_LANGUAGE_FILTERS = ["az", "ru"]')
    // Оба запроса счётчиков — и по находкам, и по площадкам — под фильтром.
    const languageClauses = summaries.match(
      /sm\."sourceMetadata" -> 'socialTriage' ->> 'language' = ANY\(\$\{\[\.\.\.CARD_LANGUAGES\]\}::text\[\]\)/g,
    )
    expect(languageClauses?.length).toBe(2)
    // Переход по счётчику больше не сбрасывает язык — иначе числа разойдутся.
    expect(page).toContain("setLanguageFilters(DEFAULT_LANGUAGE_FILTERS)")
    expect(page).not.toContain("setLanguageFilters([])")
  })

  it("несёт подписи во всех трёх локалях", () => {
    for (const locale of ["en", "ru", "az"] as const) {
      const findings = (messages[locale] as unknown as {
        socialMonitoring: { profiles: { card: { findings: Record<string, string> } } }
      }).socialMonitoring.profiles.card.findings
      expect(findings.last24Hours?.trim()).toBeTruthy()
      expect(findings.totalRelevant?.trim()).toBeTruthy()
      expect(findings.needsAction?.trim()).toBeTruthy()
    }
  })
})

describe("social monitoring brand-card workspace", () => {
  it("uses a visible card grid and exposes one server-backed bulk action", () => {
    expect(profileList).toContain("<MonitoringProfileGrid")
    expect(profileList).not.toContain("function MonitoringProfileSelector(")
    expect(profileList).toContain('data-testid="social-profile-run-all"')
    expect(profileList).toContain('kind: "PROFILE_FULL"')
    expect(profileList).toContain('"Idempotency-Key": requestKey')
    expect(profileList).not.toContain("runMonitoringProfileBulkPlan({")
    expect(profileList).toContain("<MonitoringBulkRunStatus")
  })

  it("uses each card as an accessible workspace link while keeping logo upload separate", () => {
    expect(profileGrid).toContain('role="listitem"')
    expect(profileGrid).toContain("onClick={() => onSelect(profile.id)}")
    expect(profileGrid).not.toContain("aria-pressed={selected}")
    expect(profileGrid).toContain("<ArrowRight")
    expect(profileGrid).toContain('accept="image/png,image/jpeg,image/webp"')
    expect(profileGrid).toContain('className="pointer-events-auto relative z-10 flex h-11 w-11')
    expect(profileGrid).toContain('profile.logoUrl ? "logo.replaceFor" : "logo.uploadFor"')
    expect(profileGrid).toContain("social-profile-selector-delete-${profile.id}")
    expect(profileGrid).toContain("disabled={deleting || actionLocked}")
  })

  it("keeps review totals out of directory cards", () => {
    expect(profileGrid).not.toContain('t("workflow.reviewShort")')
    expect(profileGrid).toContain('t("card.findings.totalRelevant")')
    expect(profileGrid).toContain('t("card.findings.last24Hours")')
    expect(profileGrid).toContain('t("card.findings.needsAction")')
  })

  it("keeps run progress and stop controls reachable by locking workspace navigation", () => {
    expect(profileList).toContain("onRunActivityChange(runNavigationLocked)")
    expect(profileList).toContain("navigationLocked={runNavigationLocked}")
    expect(profileList).toContain("disabled={runNavigationLocked}")
    expect(profileList).toContain("const stageSwitchLocked = runActive && !active")
    expect(profileList).toContain("disabled={stageSwitchLocked}")
    expect(profileGrid).toContain("disabled={navigationLocked}")
    expect(page).toContain("disabled={monitoringRunActive}")
    expect(page).toContain('window.addEventListener("beforeunload", protectActiveRun)')
    expect(profileList).toContain("data-testid={`social-profile-stop-${profile.id}`}")
  })

  it("makes findings the primary, direct destination inside a brand", () => {
    expect(profileList).toContain('data-testid="social-profile-open-findings"')
    expect(profileList).toContain("setActiveStage(preferredProfileStage(profile))")
    expect(profileList).toContain('id: "results"')
    expect(profileList.indexOf('id: "results"')).toBeLessThan(
      profileList.indexOf('id: "collection"'),
    )
    expect(profileList).toContain('data-testid={`social-profile-open-platform-${platform}`}')
    expect(profileList).toContain("onOpenResults(profile, { platform })")
    expect(profileList).toContain('testId="social-profile-open-metric-all"')
    expect(profileList).toContain('testId="social-profile-open-metric-posts"')
    expect(profileList).toContain('testId="social-profile-open-metric-comments"')
    expect(profileList).toContain('testId="social-profile-open-metric-media"')
    expect(profileList).toContain('testId="social-profile-open-metric-negative"')
    expect(profileList).toContain('onOpenResults(profile, { surface: "posts" })')
    expect(profileList).toContain('onOpenResults(profile, { surface: "comments" })')
    expect(profileList).toContain('onOpenResults(profile, { surface: "media" })')
    expect(profileList).toContain('onOpenResults(profile, { sentiment: "negative" })')
    expect(profileList).toContain('role="tablist"')
    expect(profileList).toContain('role="tab"')
    expect(profileList).toContain("aria-selected={active}")
    expect(profileList).toContain('role="tabpanel"')
  })

  it("shows the detailed findings breakdown without a duplicate activity summary", () => {
    expect(profileList).not.toContain('t("workflow.summaryLabel"')
    expect(profileList).not.toContain('t("card.findings.last24Hours"')
    expect(profileList).not.toContain('t("card.findings.last7Days"')
    expect(profileList).toContain('t("workflow.resultsSummaryLabel"')
    expect(profileList).toContain('t("workflow.posts"')
    expect(profileList).toContain('t("workflow.comments"')
  })

  it("uses one findings term across navigation and every primary CTA", () => {
    const expected = {
      en: "Findings",
      ru: "Находки",
      az: "Tapıntılar",
    }
    const expectedOpen = {
      en: "Open findings",
      ru: "Открыть находки",
      az: "Tapıntıları aç",
    }

    for (const locale of Object.keys(expected)) {
      const social = messages[locale].socialMonitoring
      expect(social.views.mentions).toBe(expected[locale as keyof typeof expected])
      expect(social.profiles.workflow.results).toBe(expected[locale as keyof typeof expected])
      expect(social.profiles.report.view).toBe(expectedOpen[locale as keyof typeof expectedOpen])
      expect(social.profiles.actions.openResults).toBe(expectedOpen[locale as keyof typeof expectedOpen])
      expect(social.profiles.workflow.resultsTitle.toLocaleLowerCase(locale)).toContain(
        expected[locale as keyof typeof expected].toLocaleLowerCase(locale),
      )
      expect(social.profiles.workflow.openCleanResults.toLocaleLowerCase(locale)).toContain(
        expected[locale as keyof typeof expected].toLocaleLowerCase(locale),
      )
      expect(social.profiles.report.platformResultsLabel.toLocaleLowerCase(locale)).toContain(
        expected[locale as keyof typeof expected].toLocaleLowerCase(locale),
      )
    }
  })

  it("separates the directory, brand workspace, and all-brand entry", () => {
    expect(profileList).toContain('workspaceMode === "directory"')
    expect(profileList).toContain('workspaceMode === "brand"')
    expect(profileList).toContain('data-testid="social-profile-open-all-brands"')
    expect(page).toContain('workspace.kind !== "directory"')
    expect(page).toContain("openBrandWorkspace")
    expect(page).toContain("openAllBrandsWorkspace")
    expect(page).toContain("returnToBrandDirectory")
  })

  it("pins brand findings to their subject and resets aggregate filters", () => {
    expect(page).toContain("const effectiveMentionSubjectFilter")
    expect(page).toContain('if (effectiveMentionSubjectFilter?.id) params.set("subjectId", effectiveMentionSubjectFilter.id)')
    expect(page).toContain("resetWorkspaceMentionFilters()")
    expect(page).toContain('workspace.kind !== "brand" && (')
    expect(page).toContain('(nextView !== "monitors" && !workspace.subjectId)')
    expect(page).toContain('const defaultToExternalAuthors = (')
    expect(page).toContain('nextWorkspace.kind === "brand"')
    expect(page).toContain('setAuthorScopeFilter("others")')
    expect(page).toMatch(
      /if \(nextView === "mentions" \|\| nextView === "replies"\) \{[\s\S]*?setMentionStream\("all"\)[\s\S]*?setAuthorScopeFilter\("others"\)/,
    )
    expect(page).toContain("onOpenResults={openProfileResults}")
    expect(page).toContain("target: MonitoringProfileFindingsTarget = {},")
    expect(page).toContain("setPlatformFilters(target.platform ? [target.platform] : [])")
    expect(page).toContain("setSentimentFilters(target.sentiment ? [target.sentiment] : [])")
    expect(page).toContain("setStatusFilters(target.status ? [target.status] : [])")
    expect(page).toContain("setSurfaceFilters(target.surface ? [target.surface] : [])")
    // Полный период остаётся значением по умолчанию; его переопределяет только
    // плитка «за 24 часа», иначе она открыла бы не тот срез, что посчитала.
    expect(page).toContain('setMentionDateRange(target.dateRange ?? "all")')
  })

  it("opens the all-brands dashboard by default and keeps in-app directory returns intact", () => {
    // Голый URL без workspace-параметров ведёт на обзор, но только при первой
    // загрузке — popstate и возврат в каталог внутри приложения не перенаправляются.
    expect(page).toContain('if (isInitial && nextWorkspace.kind === "directory" && !rawView) {')
    expect(page).toContain('nextWorkspace = { kind: "all" }')
    // URL канонизируется сразу, иначе Back с голой записи истории открыл бы
    // каталог, где пользователь никогда не был.
    expect(page).toContain('applyMonitoringWorkspaceRoute(params, nextWorkspace, { view: "overview" })')
    expect(page).toContain("hydrateFromLocation(true)")
    expect(page).toContain("const handlePopstate = () => hydrateFromLocation(false)")
    expect(page).toContain("returnToBrandDirectory")
    // Каждая raw-запись URL сигналит сайдбару (его подсветка читает
    // window.location, а не устаревший canonicalUrl роутера).
    expect((page.match(/dispatchRawLocationChange\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
    // Счётчики карточек/дашборда языконезависимы — переход по ним открывает
    // ленту без AZ-фильтра, чтобы ненулевой счётчик не вёл в пустую ленту.
    // Язык больше не сбрасывается: счётчики карточек считаются по тому же
    // языку, что и лента, поэтому переход обязан его сохранять.
    expect(page).toMatch(/resetWorkspaceMentionFilters\(\)[\s\S]{0,600}setLanguageFilters\(DEFAULT_LANGUAGE_FILTERS\)[\s\S]{0,400}setPlatformFilters\(target\.platform/)
  })

  it("shows the per-client breakdown on the dashboard", () => {
    const clientOverview = readFileSync(
      join(process.cwd(), "src/components/social/monitoring-client-overview.tsx"),
      "utf8",
    )
    expect(page).toContain("<MonitoringClientOverview onOpenProfile={openProfileResults} />")
    expect(clientOverview).toContain("social-client-overview-row-")
    expect(clientOverview).toContain("findingsByPlatform")
    expect(clientOverview).toContain("const { positive, neutral, negative } = profile.findings")
    // Сводка тональности приходит с сервера: строка = positive+neutral+negative.
    for (const locale of ["en", "ru", "az"] as const) {
      const clientOverviewMessages = (messages[locale].socialMonitoring as unknown as {
        clientOverview: Record<string, string>
      }).clientOverview
      expect(clientOverviewMessages.title).toBeTruthy()
      expect(clientOverviewMessages.sentimentColumn).toBeTruthy()
      expect(clientOverviewMessages.platformsColumn).toBeTruthy()
    }
  })

  it("shows exact progress with activity only inside the current segment", () => {
    expect(progress).toContain('role="progressbar"')
    expect(progress).toContain("aria-valuenow={safeCompleted}")
    expect(progress).toContain("showActiveSegment")
    expect(progress).toContain("monitoring-progress-sweep")
  })

  it("uses semantic secondary navigation instead of orphaned tab roles", () => {
    expect(page).toContain("function SocialMonitoringNavigation({")
    expect(page).toContain('aria-current={active ? "page" : undefined}')
    expect(page).toContain('aria-label={t("views.navigationLabel")}')
    expect(page).not.toContain("<TabsList")
    expect(page).not.toContain("<TabsTrigger")
  })

  it("groups the full navigation without hiding any destination", () => {
    expect(page).toContain('["work", "setup", "tools"] as const')
    expect(page).toContain('aria-label={t(`views.groups.${group.value}`)}')
    expect(page).toContain('group: "work"')
    expect(page).toContain('group: "setup"')
    expect(page).toContain('group: "tools"')
    expect(page).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))]")
    expect(page).not.toContain("scrollIntoView")
    expect(page).not.toContain("scrollBy")
    expect(page).not.toContain("min-w-max")
    expect(page).toContain("const singleGroup = navigationGroups.length === 1")
    expect(page).toContain(".map(item => ({ ...item, count: undefined }))")
  })

  it("keeps nested section controls truthful and touch friendly", () => {
    expect(page).toContain('aria-label={t("sourcesTabs.label")}')
    expect(page).toContain('aria-controls="social-monitoring-advanced-filters"')
    expect(legalPanel).toContain('role="group"')
    expect(legalPanel).toContain("aria-pressed={view === id}")
    expect(legalPanel).not.toContain('role="tab"')
  })

  it("associates visible select labels with their controls", () => {
    expect(select).toContain("const generatedId = React.useId()")
    expect(select).toContain("<label htmlFor={selectId}")
    expect(select).toContain("id={selectId}")
    expect(page).toContain("<SocialMonitoringMultiFilter")
    expect(page).toContain('label={t("platformFilterLabel")}')
    expect(page).toContain('label={t("dateRangeLabel")}')
  })

  it("opens the matching finding set directly from each dashboard card", () => {
    expect(profileGrid).toContain("social-profile-card-findings-total-${profile.id}")
    expect(profileGrid).toContain("social-profile-card-findings-last24h-${profile.id}")
    expect(profileGrid).toContain("social-profile-card-findings-needs-action-${profile.id}")
    expect(profileGrid).toContain("onOpenFindings(profile.id)")
    expect(profileList).toContain("if (profile) onOpenResults(profile, target ?? {})")
  })
})
