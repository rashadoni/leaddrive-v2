import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("knowledge base UX contract", () => {
  it("keeps a stable accessible document title across list filter navigation", () => {
    const layout = source("src/app/(dashboard)/knowledge-base/layout.tsx")
    expect(layout).toContain('title: "Knowledge Base · LeadDrive CRM"')
  })

  it("uses a two-pane desktop library and an equivalent mobile category selector", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    expect(page).toContain('className="hidden w-60')
    expect(page).toContain('className="lg:hidden"')
    expect(page).toContain("CategoryFilterButton")
    expect(page).toContain('aria-label={t("categoryFilterLabel")}')
  })

  it("communicates publication state without relying on color", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    const detail = source("src/app/(dashboard)/knowledge-base/[id]/page.tsx")
    expect(page).toContain("PublicationBadge")
    expect(page).toContain("CheckCircle2")
    expect(page).toContain("FilePenLine")
    expect(page).toContain('t("publishedStatus")')
    expect(page).toContain('t("draftStatus")')
    expect(detail).toContain('t("visibleInPortal")')
    expect(detail).toContain('t("hiddenFromPortal")')
  })

  it("keeps row actions discoverable and category groups keyboard-operable", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    expect(page).toContain("DropdownMenuTrigger")
    expect(page).toContain('aria-label={t("articleActionsNamed"')
    expect(page).toContain("aria-expanded={expanded}")
    expect(page).toContain("aria-controls={panelId}")
    expect(page).not.toContain("group-hover:opacity-100")
  })

  it("covers loading, empty, no-results, error, permission and recovery states", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    expect(page).toContain("LibrarySkeleton")
    expect(page).toContain("LibraryError")
    expect(page).toContain("noResultsTitle")
    expect(page).toContain("emptyTitle")
    expect(page).toContain("permissionDenied")
    expect(page).toContain("readOnlyHint")
    expect(page).toContain("fetchArticles(true)")
    expect(page).toContain("fetchCategories()")
    expect(page).toContain('data-testid="knowledge-base-workspace"')
    expect(page).toContain('data-testid="knowledge-base-load-error"')
    expect(page).toContain('data-testid="knowledge-base-categories-error"')
    expect(page).toContain("articlesErrorRetryable")
    expect(page).toContain("categoriesErrorRetryable")
  })

  it("preserves list context across detail navigation and exposes related content", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    const detail = source("src/app/(dashboard)/knowledge-base/[id]/page.tsx")
    expect(page).toContain("returnTo=${encodeURIComponent(returnContext)}")
    expect(detail).toContain("safeReturnPath")
    expect(detail).toContain("relatedArticles")
    expect(detail).toContain("returnTo")
    expect(detail).toContain('data-testid="knowledge-article-workspace"')
    expect(detail).toContain('data-testid="knowledge-article-content"')
    expect(detail).toContain("loadErrorRetryable")
  })

  it("shows dependency impact and supports undo for article and category deletion", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    const categoryRoute = source("src/app/api/v1/kb-categories/[id]/route.ts")
    expect(page).toContain("deleteCategoryDescription")
    expect(page).toContain("restoreArticle")
    expect(page).toContain("restoreCategory")
    expect(page).toContain('label: t("undo")')
    expect(categoryRoute).toContain("prisma.$transaction")
    expect(categoryRoute).toContain("childCategoryIds")
  })

  it("uses compact, responsive, touch-safe, reduced-motion-friendly styling without AI palette tropes", () => {
    const files = [
      source("src/app/(dashboard)/knowledge-base/page.tsx"),
      source("src/app/(dashboard)/knowledge-base/[id]/page.tsx"),
      source("src/app/portal/knowledge-base/page.tsx"),
    ].join("\n")
    expect(files).toContain("min-h-11")
    expect(files).toContain("motion-reduce:animate-none")
    expect(files).not.toMatch(/text-(?:3xl|4xl)/)
    expect(files).not.toMatch(/(?:violet|purple|cyan|fuchsia)-/)
    expect(files).not.toContain("bg-gradient")
    expect(files).not.toContain("ColorStatCard")
    expect(files).not.toContain("DidYouKnow")
  })

  it("keeps portal visibility server-enforced and portal rows keyboard accessible", () => {
    const portal = source("src/app/portal/knowledge-base/page.tsx")
    const route = source("src/app/api/v1/public/portal-kb/route.ts")
    expect(route.match(/status: "published"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(route).toContain("organizationId: user.organizationId")
    expect(portal).toContain("Array.isArray(payload.data)")
    expect(portal).toContain('<button\n              key={article.id}')
    expect(portal).toContain("knowledgeBaseUnavailable")
    expect(portal).toContain("pendingArticleId")
    expect(portal).toContain('data-testid="portal-knowledge-workspace"')
    expect(portal).toContain('data-testid="portal-knowledge-article-row"')
  })

  it("does not create a nested main landmark inside the dashboard shell", () => {
    const page = source("src/app/(dashboard)/knowledge-base/page.tsx")
    const detail = source("src/app/(dashboard)/knowledge-base/[id]/page.tsx")
    expect(page).not.toContain("<main")
    expect(detail).not.toContain("<main")
  })
})
