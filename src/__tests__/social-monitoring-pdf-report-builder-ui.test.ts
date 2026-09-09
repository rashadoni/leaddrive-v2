import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/social-monitoring/page.tsx"),
  "utf8",
)
const builder = readFileSync(
  join(process.cwd(), "src/components/social/social-monitoring-pdf-report-builder.tsx"),
  "utf8",
)

describe("social monitoring visual PDF report builder", () => {
  it("is a first-class all-client tool", () => {
    expect(page).toContain('| "reports" |')
    expect(page).toContain('{ value: "reports", label: t("views.reports"), icon: FileText, group: "tools" }')
    expect(page).toContain('activeView === "reports" && <SocialMonitoringPdfReportBuilder orgId={orgId} />')
    expect(page).toContain('"replies", "reports", "media"')
  })

  it("supports explicit multi-client selection without silently treating none as all", () => {
    expect(builder).toContain("selectedSubjectIds.length > 0")
    expect(builder).toContain("selectedSubjectIds.length <= 20")
    expect(builder).toContain("aria-pressed={selected}")
    expect(builder).toContain("setSelectedSubjectIds([])")
    expect(builder).toContain("eligibleSubjects.slice(0, 20)")
  })

  it("supports preset and custom periods plus selectable data sections", () => {
    expect(builder).toContain('["7", "30", "90", "custom"]')
    expect(builder).toContain('type="date"')
    expect(builder).toContain("days <= 366")
    expect(builder).toContain("const REPORT_SECTIONS = [")
    expect(builder).toContain("sections.length > 0")
    expect(builder).toContain("toggleSection(section)")
  })

  it("uses the same tenant-scoped endpoint for the live preview and PDF download", () => {
    expect(builder.match(/\/api\/v1\/social\/reports\/visual/g)).toHaveLength(2)
    expect(builder).toContain('format: "json"')
    expect(builder).toContain('format: "pdf"')
    expect(builder).toContain('"x-organization-id"')
    expect(builder).toContain('response.headers.get("content-disposition")')
  })

  it("never reuses a stale preview and applies section toggles without refetching data", () => {
    expect(builder).toContain("setPreview(null)\n    setPreviewError(false)\n    setPreviewLoading(true)")
    expect(builder).toContain("previewError ? (")
    expect(builder).toContain("sections: REPORT_SECTIONS")
    expect(builder).toContain("setPreviewRevision(current => current + 1)")
    expect(builder).not.toContain("setSections(current => [...current])")
  })

  it("resets tenant-bound report state before loading another organization", () => {
    const loadEffect = builder.slice(builder.indexOf("useEffect(() => {", builder.indexOf("validSelection")))
    expect(loadEffect).toContain("setSubjects([])")
    expect(loadEffect).toContain("setSelectedSubjectIds([])")
    expect(loadEffect).toContain("setPreview(null)")
  })

  // Клиент просил управлять объёмом и составом раздела находок, а не жить с
  // зашитой десяткой. Лимит и тональности — ДАННЫЕ: они обязаны попасть в
  // общий для превью и PDF запрос, иначе скачанный файл разойдётся с экраном.
  it("даёт выбрать количество находок и тональности раздела", () => {
    expect(builder).toContain("const FINDINGS_LIMITS = [10, 20, 30, 50] as const")
    expect(builder).toContain("topFindingsLimit: findingsLimit")
    expect(builder).toContain("topFindingsSentiments: findingsSentiments")
    expect(builder).not.toContain("topFindingsLimit: 10,")
    expect(builder).toContain("toggleFindingSentiment(sentiment)")
    expect(builder).toContain("findingsSentiments.length > 0")

    const dataBody = builder.slice(builder.indexOf("const dataRequestBody = useMemo("))
    const deps = dataBody.slice(0, dataBody.indexOf("])"))
    expect(deps).toContain("findingsLimit")
    expect(deps).toContain("findingsSentiments")
  })

  it("даёт комментариям отдельный раздел, лимит и независимое превью", () => {
    expect(builder).toContain('  "comments",')
    expect(builder).toContain('sectionSelected("comments")')
    expect(builder).toContain('t("commentsLabel")')
    expect(builder).toContain("commentsLimit === limit")
    expect(builder).toContain("setCommentsLimit(limit)")
    expect(builder).toContain("commentsLimit,")
    expect(builder).toContain("[commentsLimit, findingsLimit")
    expect(builder).toContain('(sectionSelected("topFindings") || sectionSelected("comments"))')
    expect(builder).toContain("preview.comments.slice(0, 1).map(previewItem)")
    expect(builder).toContain("preview.commentsFilter.shown < preview.commentsFilter.matched")
    expect(builder).toContain('t("noComments")')
  })

  it("показывает кликабельные публикацию, страницу-источник и профиль автора", () => {
    expect(builder).toContain("item.source && (")
    expect(builder).toContain("item.authorProfile && (")
    expect(builder).toContain("authorProfile: { name: string | null; handle: string | null; label: string; profileUrl: string | null } | null")
    expect(builder).toContain("source: { label: string; handle: string | null; url: string | null; kind: string } | null")
    expect(builder).toContain('item.linkKind === "direct_comment" && item.directCommentUrl')
    expect(builder).toContain('{ url: item.directCommentUrl, label: t("directComment") }')
    expect(builder).toContain('{ url: item.parentPostUrl, label: t("parentPublication") }')
    expect(builder).toContain('item.linkKind === "publication" ? t("publication") : t("parentPublication")')
    expect(builder).toContain('<a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer"')
    expect(builder).toContain('<a href={item.source.url} target="_blank" rel="noopener noreferrer"')
    expect(builder).toContain('<a href={item.authorProfile.profileUrl} target="_blank" rel="noopener noreferrer"')
  })

  it("renders responsive infographic previews with touch-sized controls", () => {
    expect(builder).toContain("aspect-[210/297]")
    expect(builder).toContain("<TrendPreview")
    expect(builder).toContain("<MiniDistribution")
    expect(builder).toContain('className="h-11')
    expect(builder).toContain("xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.35fr)]")
  })
})
