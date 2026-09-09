import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { buildSocialMonitoringPdf } from "@/lib/social/social-monitoring-pdf"
import type { VisualMonitoringReportSnapshot } from "@/lib/social/visual-monitoring-report"
import { VISUAL_REPORT_SECTIONS } from "@/lib/social/visual-report-schema"

function snapshot(locale: VisualMonitoringReportSnapshot["locale"] = "az"): VisualMonitoringReportSnapshot {
  return {
    schemaVersion: "1",
    locale,
    generatedAt: "2026-07-31T14:15:00.000Z",
    range: {
      from: "2026-07-01",
      to: "2026-07-31",
      fromInclusive: "2026-07-01T00:00:00.000Z",
      toExclusive: "2026-08-01T00:00:00.000Z",
      days: 31,
    },
    sections: [...VISUAL_REPORT_SECTIONS],
    organization: {
      name: "LeadDrive — Müştəri Təcrübəsi",
      primaryColor: "#f45113",
    },
    subjects: [
      { id: "araz", name: "Araz Supermarket", total: 18, positive: 6, neutral: 4, negative: 7, unknown: 1 },
      { id: "baku", name: "Bakı Elektroniks", total: 13, positive: 5, neutral: 3, negative: 4, unknown: 1 },
    ],
    totals: {
      findings: 30,
      positive: 12,
      neutral: 7,
      negative: 9,
      unknown: 2,
      engagement: 12_450,
      reach: 284_300,
    },
    summaryText: locale === "az"
      ? "İyul ərzində iki brend üzrə 30 tapıntı qeydə alınıb. Mənfi rəylər əsasən çatdırılma və xidmət keyfiyyəti ilə bağlıdır."
      : locale === "ru"
        ? "За июль по двум брендам найдено 30 материалов. Негатив в основном связан с доставкой и качеством обслуживания."
        : "Thirty findings were recorded for two brands in July. Negative feedback mainly concerns delivery and service quality.",
    sentiment: [
      { sentiment: "positive", count: 12, percentage: 40 },
      { sentiment: "neutral", count: 7, percentage: 23.3 },
      { sentiment: "negative", count: 9, percentage: 30 },
      { sentiment: "unknown", count: 2, percentage: 6.7 },
    ],
    platforms: [
      { platform: "instagram", count: 14, percentage: 46.7 },
      { platform: "tiktok", count: 9, percentage: 30 },
      { platform: "facebook", count: 7, percentage: 23.3 },
    ],
    trend: [
      { date: "2026-07-01", total: 3, positive: 1, neutral: 1, negative: 1, unknown: 0 },
      { date: "2026-07-10", total: 7, positive: 3, neutral: 1, negative: 2, unknown: 1 },
      { date: "2026-07-20", total: 12, positive: 4, neutral: 3, negative: 4, unknown: 1 },
      { date: "2026-07-31", total: 8, positive: 4, neutral: 2, negative: 2, unknown: 0 },
    ],
    contentTypes: [
      { contentType: "post", count: 18, percentage: 60 },
      { contentType: "comment", count: 10, percentage: 33.3 },
      { contentType: "article", count: 2, percentage: 6.7 },
    ],
    topFindings: [
      {
        id: "finding-1",
        subjectIds: ["araz"],
        platform: "instagram",
        contentType: "comment",
        sentiment: "negative",
        publishedAt: "2026-07-29T12:00:00.000Z",
        author: "Əli Məmmədov",
        authorProfile: {
          name: "Əli Məmmədov",
          handle: "ali.reader",
          label: "Əli Məmmədov · @ali.reader",
          profileUrl: "https://www.instagram.com/ali.reader/",
        },
        text: "Çatdırılma gecikdi, amma dəstək komandası müraciətimi qeydə aldı.",
        url: "https://www.instagram.com/p/example/?comment_id=178",
        directCommentUrl: "https://www.instagram.com/p/example/?comment_id=178",
        parentPostUrl: "https://www.instagram.com/p/example/",
        linkKind: "direct_comment",
        source: { label: "@example_shop", handle: "example_shop", url: "https://www.instagram.com/example_shop/", kind: "account" as const },
        engagement: 87,
        reach: 1_400,
      },
      {
        id: "finding-2",
        subjectIds: ["baku"],
        platform: "tiktok",
        contentType: "video",
        sentiment: "positive",
        publishedAt: "2026-07-28T09:30:00.000Z",
        author: "Мария",
        authorProfile: {
          name: "Мария",
          handle: "maria",
          label: "Мария · @maria",
          profileUrl: "https://www.tiktok.com/@maria",
        },
        text: "Быстро помогли с обменом товара — спасибо команде поддержки.",
        url: "https://www.tiktok.com/@example/video/123",
        directCommentUrl: null,
        parentPostUrl: "https://www.tiktok.com/@example/video/123",
        linkKind: "publication",
        source: null,
        engagement: 112,
        reach: 3_800,
      },
    ],
    topFindingsFilter: {
      sentiments: ["positive", "neutral", "negative", "unknown"] as const,
      matched: 2,
      shown: 2,
    },
    comments: [
      {
        id: "comment-1",
        subjectIds: ["araz"],
        platform: "instagram",
        contentType: "comment",
        sentiment: "negative",
        publishedAt: "2026-07-29T12:00:00.000Z",
        author: "Əli Məmmədov",
        authorProfile: {
          name: "Əli Məmmədov",
          handle: "ali.reader",
          label: "Əli Məmmədov · @ali.reader",
          profileUrl: "https://www.instagram.com/ali.reader/",
        },
        text: "Çatdırılma gecikdi, amma dəstək komandası müraciətimi qeydə aldı.",
        url: "https://www.instagram.com/p/example/?comment_id=178",
        directCommentUrl: "https://www.instagram.com/p/example/?comment_id=178",
        parentPostUrl: "https://www.instagram.com/p/example/",
        linkKind: "direct_comment",
        source: { label: "@example_shop", handle: "example_shop", url: "https://www.instagram.com/example_shop/", kind: "account" as const },
        engagement: 87,
        reach: 1_400,
      },
    ],
    commentsFilter: {
      matched: 3,
      shown: 1,
    },
    methodology: {
      dateField: "publishedAt|firstSeenAt",
      globalDeduplication: "mentionId",
      subjectMatchStatus: "MATCHED",
      unclassifiedSentiment: "unknown",
      dataLimit: 20_000,
      truncated: false,
    },
  }
}

function pdfText(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString("latin1")
}

function pageCount(pdf: Uint8Array): number {
  return pdfText(pdf).match(/\/Type \/Page\b/g)?.length ?? 0
}

describe("buildSocialMonitoringPdf", () => {
  it("creates a deterministic vector PDF with the embedded Unicode font", () => {
    const first = buildSocialMonitoringPdf(snapshot("az"))
    const second = buildSocialMonitoringPdf(snapshot("az"))

    expect(first).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(first.subarray(0, 5)).toString("ascii")).toBe("%PDF-")
    expect(first.byteLength).toBeGreaterThan(100_000)
    expect(pdfText(first)).toContain("DejaVuSans")
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it.each(["az", "ru", "en"] as const)("renders the %s locale without relying on a remote resource", locale => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("PDF rendering must not fetch remote resources")
    })

    try {
      const pdf = buildSocialMonitoringPdf(snapshot(locale))
      expect(pdf.byteLength).toBeGreaterThan(100_000)
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(1)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("wraps bounded long findings across pages and ignores unsafe source URLs", () => {
    const input = snapshot("ru")
    input.organization.name = `Очень длинное название организации ${"и партнёры ".repeat(30)}`
    input.topFindings = Array.from({ length: 18 }, (_, index) => ({
      ...input.topFindings[0],
      id: `long-${index}`,
      author: `${"Длинное имя автора ".repeat(20)}\u0000`,
      authorProfile: {
        name: null,
        handle: null,
        label: `${"Длинное имя автора ".repeat(20)}\u0000`,
        profileUrl: index === 0 ? "https://user:password@example.com/private-profile" : null,
      },
      source: {
        label: `${"Очень длинное имя страницы ".repeat(20)}`,
        handle: null,
        url: index === 0 ? "http://10.0.0.2/private-page" : null,
        kind: "page" as const,
      },
      text: `${index + 1}. ${"Подробное описание обращения клиента с азербайджанскими символами ə, ş, ğ и безопасным переносом строк. ".repeat(30)}`,
      url: index === 0 ? "javascript:alert(1)" : `https://example.com/findings/${index}`,
      directCommentUrl: null,
      parentPostUrl: index === 0 ? null : `https://example.com/findings/${index}`,
      linkKind: "publication" as const,
    }))
    input.methodology.truncated = true

    const pdf = buildSocialMonitoringPdf(input)

    expect(pageCount(pdf)).toBeGreaterThan(2)
    const rendered = pdfText(pdf)
    expect(rendered).not.toContain("javascript:alert")
    expect(rendered).not.toContain("10.0.0.2/private-page")
    expect(rendered).not.toContain("user:password@example.com")
  })

  it("renders selected empty infographic sections without throwing", () => {
    const input = snapshot("en")
    input.sections = ["sentiment", "platforms", "trend", "contentTypes", "topFindings", "comments"]
    input.sentiment = []
    input.platforms = []
    input.trend = []
    input.contentTypes = []
    input.topFindings = []
    input.topFindingsFilter = { sentiments: ["negative"], matched: 0, shown: 0 }
    input.comments = []
    input.commentsFilter = { matched: 0, shown: 0 }

    const pdf = buildSocialMonitoringPdf(input)

    expect(pdf.byteLength).toBeGreaterThan(100_000)
    expect(pageCount(pdf)).toBe(1)
  })

  // Клиент просил видеть, ОТКУДА находка и КТО написал. Обе строки должны
  // печататься как ссылки и участвовать в расчёте высоты карточки: рамка по
  // содержимому не растягивается, поэтому забытое слагаемое выпустит текст.
  it("печатает кликабельные страницу-источник и профиль автора внутри карточки", () => {
    const renderer = readFileSync(join(process.cwd(), "src/lib/social/social-monitoring-pdf.ts"), "utf8")
    const heightStart = renderer.indexOf("const cardHeight = 19")
    const heightEnd = renderer.indexOf("ensureSpace(", heightStart)

    expect(heightStart).toBeGreaterThan(-1)
    expect(heightEnd).toBeGreaterThan(heightStart)
    expect(renderer.slice(heightStart, heightEnd)).toContain("originLineCount * 4")
    expect(renderer.slice(heightStart, heightEnd)).toContain("authorLineCount * 4")
    expect(renderer).toContain("const sourceUrl = safeHttpUrl(finding.source?.url)")
    expect(renderer).toContain("const authorUrl = safeHttpUrl(finding.authorProfile?.profileUrl)")
    expect(renderer).toContain("drawMetadataLine(copy.origin, originText, sourceUrl, copy.openPage)")
    expect(renderer).toContain("drawMetadataLine(copy.authorProfile, authorText, authorUrl, copy.openAuthorProfile)")
    expect(renderer).toContain("doc.textWithLink(visible, valueX, y, { url })")

    const input = snapshot("az")
    input.sections = ["topFindings"]
    const pdf = buildSocialMonitoringPdf(input)

    expect(pageCount(pdf)).toBe(1)
    expect(pdf.byteLength).toBeGreaterThan(100_000)
  })

  it("renders a separate comments section with direct-comment and parent-post link fallbacks", () => {
    const renderer = readFileSync(join(process.cwd(), "src/lib/social/social-monitoring-pdf.ts"), "utf8")
    const commentsStart = renderer.indexOf('if (selected(snapshot.sections, "comments"))')

    expect(commentsStart).toBeGreaterThan(-1)
    expect(renderer.slice(commentsStart)).toContain("snapshot.commentsFilter")
    expect(renderer.slice(commentsStart)).toContain("drawEmptyState(copy.noComments)")
    expect(renderer.slice(commentsStart)).toContain("drawReportItems(snapshot.comments)")
    expect(renderer).toContain('finding.linkKind === "direct_comment" && directCommentUrl')
    expect(renderer).toContain("linkRows.push({ label: copy.openComment, url: directCommentUrl })")
    expect(renderer).toContain("linkRows.push({ label: copy.openParentPublication, url: parentPostUrl })")
    expect(renderer).toContain('finding.linkKind === "parent_post" ? copy.openParentPublication : copy.openPublication')

    const input = snapshot("en")
    input.sections = ["comments"]
    const pdf = buildSocialMonitoringPdf(input)
    const rendered = pdfText(pdf)

    expect(pdf.byteLength).toBeGreaterThan(100_000)
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1)
    expect(rendered).toContain("/URI (https://www.instagram.com/p/example/?comment_id=178)")
    expect(rendered).toContain("/URI (https://www.instagram.com/p/example/)")
    expect(rendered).toContain("/URI (https://www.instagram.com/example_shop/)")
    expect(rendered).toContain("/URI (https://www.instagram.com/ali.reader/)")
  })

  // Раздел, суженный по тональности, обязан объявлять это прямо в отчёте —
  // иначе KPI со 137 находками и список из 12 выглядят как потеря данных.
  it("объявляет сужение раздела находок по тональности", () => {
    const renderer = readFileSync(join(process.cwd(), "src/lib/social/social-monitoring-pdf.ts"), "utf8")
    const findingsStart = renderer.indexOf('if (selected(snapshot.sections, "topFindings"))')
    const noteStart = renderer.indexOf("copy.findingsFilter", findingsStart)

    expect(findingsStart).toBeGreaterThan(-1)
    expect(noteStart).toBeGreaterThan(findingsStart)
    expect(renderer).toContain("findingsFilter.sentiments.length < 4")
    // Лимит режет раздел так же, как фильтр тональностей: молчать про это
    // нельзя, иначе превью обещает строку, которой в файле нет.
    expect(renderer).toContain("findingsFilter.shown < findingsFilter.matched")
    expect(renderer).toContain("copy.findingsCount")

    const input = snapshot("ru")
    input.sections = ["topFindings"]
    input.topFindingsFilter = { sentiments: ["negative", "neutral"], matched: 137, shown: 2 }
    const pdf = buildSocialMonitoringPdf(input)

    expect(pdf.byteLength).toBeGreaterThan(100_000)
  })

  // Методология — сноска в подвале, а не секция в потоке. Пока она шла потоком,
  // её резерв в 22 мм не помещался в остаток листа и уносил блок на новую
  // страницу: клиент получал лист, где кроме шапки и трёх строк параметров нет
  // ничего. Секция, дотягивающая до низа полосы, обязана остаться одностраничной.
  // 36 — та самая величина, на которой старая вёрстка ломалась.
  it.each([30, 36, 40, 45])("не отводит отдельную страницу под блок методологии (%i)", paragraphs => {
    const input = snapshot("en")
    input.sections = ["summary"]
    input.summaryText = Array.from({ length: paragraphs }, (_, index) => `L${index + 1} ${"abcdefgh ".repeat(11)}`).join("")

    expect(pageCount(buildSocialMonitoringPdf(input))).toBe(1)
  })

  it("discloses truncation even when the summary section is disabled", () => {
    const renderer = readFileSync(join(process.cwd(), "src/lib/social/social-monitoring-pdf.ts"), "utf8")
    const summaryStart = renderer.indexOf('if (selected(snapshot.sections, "summary"))')
    const warningStart = renderer.indexOf("if (snapshot.methodology.truncated)", summaryStart)
    const kpisStart = renderer.indexOf('if (selected(snapshot.sections, "kpis"))', warningStart)

    expect(summaryStart).toBeGreaterThan(-1)
    expect(warningStart).toBeGreaterThan(summaryStart)
    expect(kpisStart).toBeGreaterThan(warningStart)
    expect(renderer.slice(summaryStart, warningStart)).not.toContain("snapshot.methodology.truncated")
    expect(renderer).toContain('`truncated=${snapshot.methodology.truncated}`')
  })
})
