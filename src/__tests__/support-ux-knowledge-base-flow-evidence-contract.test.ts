import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-knowledge-base-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const list = readFileSync("src/app/(dashboard)/knowledge-base/page.tsx", "utf8")
const detail = readFileSync("src/app/(dashboard)/knowledge-base/[id]/page.tsx", "utf8")
const form = readFileSync("src/components/kb-article-form.tsx", "utf8")
const portal = readFileSync("src/app/portal/knowledge-base/page.tsx", "utf8")

describe("Knowledge Base mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("covers list, detail, edit, publication and portal recovery", () => {
    for (const id of [
      "library-load-failure-and-keyboard-recovery",
      "category-partial-failure-and-recovery",
      "empty-library-and-recovery",
      "filter-category-keyboard-and-return-context",
      "article-load-failure-permission-and-recovery",
      "edit-form-recovery",
      "publication-failure-portal-boundary-and-restore",
      "portal-load-search-and-recovery",
      "portal-article-failure-and-recovery",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("publication_failure_changed_status")
    expect(flow).toContain("portal_publication_boundary_failed")
    expect(flow).toContain("knowledge_return_context_lost")
    expect(flow).toContain("article_permission_offered_misleading_retry")
    expect(flow).toContain("library_permission_offered_misleading_retry")
    expect(flow).toContain('"knowledge-base-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 9")
  })

  it("uses stable observable state selectors", () => {
    for (const marker of [
      'data-testid="knowledge-base-workspace"',
      'data-testid="knowledge-base-load-error"',
      'data-testid="knowledge-base-categories-error"',
      'data-testid="knowledge-base-empty-state"',
      'data-testid="knowledge-base-category-toggle"',
      'data-testid="knowledge-base-article-row"',
    ]) expect(list).toContain(marker)
    for (const marker of [
      'data-testid="knowledge-article-workspace"',
      'data-testid="knowledge-article-load-error"',
      'data-testid="knowledge-article-status"',
      'data-testid="knowledge-article-publication"',
    ]) expect(detail).toContain(marker)
    expect(form).toContain('data-testid="knowledge-article-save-error"')
    expect(portal).toContain('data-testid="portal-knowledge-workspace"')
    expect(portal).toContain('data-testid="portal-knowledge-article-row"')
  })

  it("runs only for Knowledge Base scenarios in mutating ephemeral mode", () => {
    expect(workflow).toContain("scripts/support-ux-knowledge-base-flow-evidence.mjs")
    expect(workflow).toContain("*,knowledge-base,*")
    expect(workflow).toContain("*,knowledge-article,*")
    expect(workflow).toContain("*,portal-knowledge,*")
    expect(workflow).toContain("knowledge_base_flow_status")
  })
})
