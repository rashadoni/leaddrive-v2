import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/social-monitoring/page.tsx"),
  "utf8",
)
const multiFilter = readFileSync(
  join(process.cwd(), "src/components/social/social-monitoring-multi-filter.tsx"),
  "utf8",
)

describe("social monitoring friendly multi-filters", () => {
  it("uses inclusive multi-select filters and preserves them in shareable URLs", () => {
    expect(page).toContain("function parseMultiValueParam(")
    expect(page).toContain("params.getAll(key)")
    expect(page).toContain("params.set(key, values.join(\",\"))")
    expect(page).toContain("values={platformFilters}")
    expect(page).toContain("values={sentimentFilters}")
    expect(page).toContain("values={statusFilters}")
    expect(page).toContain("values={languageFilters}")
    expect(page).toContain("current.includes(value)")
  })

  it("defaults the findings feed to Azerbaijani and Russian while allowing an explicit all-language view", () => {
    expect(page).toContain('const DEFAULT_LANGUAGE_FILTERS = ["az", "ru"]')
    expect(page).toContain('emptyValue: "all"')
    expect(page).toContain('value.trim().toLowerCase() === "all"')
    expect(page).toContain('{ value: "az", label: t("languages.az") }')
  })

  it("offers deterministic sentiment ordering in both directions", () => {
    expect(page).toContain('value="sentiment_negative_first"')
    expect(page).toContain('value="sentiment_positive_first"')
    expect(page).toContain('t("sentimentNegativeFirst")')
    expect(page).toContain('t("sentimentPositiveFirst")')
  })

  it("shows the material type before accepted and review content", () => {
    expect(page).toContain("function mentionMaterialType(")
    expect(page).toContain("function reviewEnvelopeMaterialType(")
    expect(page).toContain('t("materialTypeBadge", { type: t(`materialTypes.${reviewEnvelopeMaterialType(envelope)}`) })')
    expect(page).toContain('t("materialTypeBadge", { type: t(`materialTypes.${materialType}`) })')
  })

  it("uses touch-sized, keyboard-operable toggle buttons with visible state", () => {
    expect(multiFilter).toContain('"h-11 w-full min-w-0')
    expect(multiFilter).toContain('role="group"')
    expect(multiFilter).toContain("aria-pressed={active}")
    expect(multiFilter).not.toContain('role="listbox"')
    expect(multiFilter).not.toContain('role="option"')
  })
})

describe("social monitoring compact filter panel", () => {
  it("keeps the filter set collapsed behind one labelled toggle", () => {
    expect(page).toContain("const [showFilterPanel, setShowFilterPanel] = useState(false)")
    expect(page).toContain('aria-controls="social-monitoring-filter-panel"')
    expect(page).toContain('id="social-monitoring-filter-panel"')
    expect(page).toContain("{showFilterPanel && (")
    expect(page).toContain("const panelFilterCount = [")
  })

  it("leaves search, active-filter chips and the scoped-monitor banner outside the panel", () => {
    const panel = page.indexOf("{showFilterPanel && (")
    expect(panel).toBeGreaterThan(-1)
    expect(page.indexOf('id="social-mention-search"')).toBeLessThan(panel)
    expect(page.indexOf("{selectedFilterChips.length > 0 && (")).toBeLessThan(panel)
    expect(page.indexOf("{t(\"monitorResultsTitle\", { name: effectiveMentionSubjectFilter.name })}")).toBeLessThan(panel)
  })

  it("caps scenario quick-pick chips instead of rendering the whole scenario vocabulary", () => {
    expect(page).toContain("const SCENARIO_CHIP_PREVIEW = 8")
    expect(page).toContain("showAllScenarioChips ? scenarioFilterOptions : scenarioFilterOptions.slice(0, SCENARIO_CHIP_PREVIEW)")
    expect(page).toContain('t("scenarioFilterShowMore", { count: scenarioFilterOptions.length - SCENARIO_CHIP_PREVIEW })')
    expect(page).not.toContain("scenarioFilterOptions.slice(0, 18)")
  })
})

// Комментарий — реакция на пост бренда: его релевантность держится на родителе,
// а не на своём тексте. Тексты короткие и часто без диакритики, поэтому детектор
// оставляет их без метки, и языковой фильтр прятал жалобы. На проде это скрывало
// 138 принятых комментариев из 305, среди них 33 негативных.
describe("комментарии и языковой фильтр", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/api/v1/social/mentions/route.ts"),
    "utf8",
  )
  const summaries = readFileSync(
    join(process.cwd(), "src/lib/social/monitoring-profiles.ts"),
    "utf8",
  )

  it("лента не отсекает комментарии по языку", () => {
    expect(route).toContain("const COMMENT_LIKE_WHERE: Prisma.SocialMentionWhereInput")
    // Освобождение стоит именно внутри языкового фильтра, а не рядом с ним.
    const languageFn = route.slice(
      route.indexOf("function languageFilterWhere"),
      route.indexOf("type MentionListSort"),
    )
    expect(languageFn).toContain("COMMENT_LIKE_WHERE")
  })

  it("определение комментария одно на файл, без дубля", () => {
    expect(route).toContain("const commentLike = COMMENT_LIKE_WHERE")
    // Две копии списка разъедутся: одна пропустит REPLY, другая sourceType.
    expect(route.match(/contentKind: \{ in: \["COMMENT", "REPLY"\] \}/g)?.length).toBe(1)
  })

  // Иначе карточка и лента снова разойдутся в числах — регрессия #651.
  it("счётчики карточек освобождают комментарии так же, как лента", () => {
    const clauses = summaries.match(/OR UPPER\(sm\."contentKind"::text\) IN \('COMMENT', 'REPLY'\)/g)
    expect(clauses?.length).toBe(2)
  })
})
