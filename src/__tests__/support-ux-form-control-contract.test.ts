import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const convertDialog = readFileSync("src/components/convert-to-complaint-dialog.tsx", "utf8")
const globalStyles = readFileSync("src/app/globals.css", "utf8")
const complaintDetail = readFileSync("src/app/(dashboard)/complaints/[id]/page.tsx", "utf8")
const dataTable = readFileSync("src/components/data-table.tsx", "utf8")
const knowledgeArticleForm = readFileSync("src/components/kb-article-form.tsx", "utf8")
const macros = readFileSync("src/app/(dashboard)/settings/macros/page.tsx", "utf8")
const portalChat = readFileSync("src/components/portal-chat-widget.tsx", "utf8")
const portalTicket = readFileSync("src/app/portal/tickets/[id]/page.tsx", "utf8")
const portalTickets = readFileSync("src/app/portal/tickets/page.tsx", "utf8")

describe("Support form and touch-control contract", () => {
  it("binds every convert-to-complaint label to its control", () => {
    for (const id of [
      "convert-complaint-type",
      "convert-risk-level",
      "convert-brand",
      "convert-production-area",
      "convert-product-category",
      "convert-object",
      "convert-object-detail",
      "convert-responsible-department",
    ]) {
      expect(convertDialog).toContain(`htmlFor="${id}"`)
      expect(convertDialog).toContain(`id="${id}"`)
    }
  })

  it("announces failures and keeps dialog actions touch-safe", () => {
    expect(convertDialog).toContain('role="alert"')
    expect(convertDialog.match(/className="min-h-11"/g)).toHaveLength(2)
  })

  it("enforces critical control height for coarse pointers inside Support", () => {
    expect(globalStyles).toContain("@media (pointer: coarse)")
    expect(globalStyles).toContain('.support-page-shell :where(button, [role="button"]')
    expect(globalStyles).toContain("min-height: var(--support-control-min-size)")
  })

  it("programmatically names shared search, response, chat, portal, and macro controls", () => {
    expect(dataTable).toContain('aria-label={searchPlaceholder || t("search")}')
    expect(complaintDetail).toContain('aria-label={t("responsePlaceholder")}')
    expect(portalChat).toContain('aria-label={t("chatPlaceholder")}')
    expect(portalTicket).toContain('aria-labelledby="portal-ticket-reply-title"')
    expect(portalTicket).toContain('aria-label={t("addAttachment")}')
    expect(portalTicket).toContain('aria-label={t("ratingCommentPlaceholder")}')
    expect(macros).toContain('aria-label={`${t("renameAction")}: ${categoryLabel(item)}`}')
  })

  it("binds the knowledge article selects and keeps portal recovery actions touch-safe", () => {
    expect(knowledgeArticleForm).toContain('<Select id="categoryId"')
    expect(knowledgeArticleForm).toContain('<Select id="status"')
    expect(portalTicket).toContain('variant="ghost" size="sm" className="min-h-11"')
    expect(portalTickets).toContain('variant="ghost" size="sm" className="min-h-11" onClick={resetDraft}')
  })
})
