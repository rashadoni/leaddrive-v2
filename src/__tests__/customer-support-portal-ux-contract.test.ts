import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")
const list = read("src/app/portal/tickets/page.tsx")
const detail = read("src/app/portal/tickets/[id]/page.tsx")
const chat = read("src/app/portal/chat/page.tsx")
const layout = read("src/app/portal/layout.tsx")
const closure = read("src/app/ticket-closure/[token]/page.tsx")
const knowledge = read("src/app/portal/knowledge-base/page.tsx")
const listApi = read("src/app/api/v1/public/portal-tickets/route.ts")
const detailApi = read("src/app/api/v1/public/portal-tickets/[id]/route.ts")
const fileApi = read("src/app/api/v1/public/portal-tickets/[id]/files/[fileId]/route.ts")
const kbApi = read("src/app/api/v1/public/portal-kb/route.ts")
const globalStyles = read("src/app/globals.css")
const surfaces = [list, detail, chat, layout, closure, knowledge]

describe("Customer Support Portal UX contract", () => {
  it("uses compact responsive composition without AI-palette or decorative-card tells", () => {
    const joined = surfaces.join("\n")
    expect(joined).toMatch(/sm:flex-row/)
    expect(joined).toMatch(/sm:grid-cols-2/)
    expect(joined).toMatch(/max-w-5xl/)
    expect(joined).not.toMatch(/from-(cyan|blue|purple)|to-(cyan|blue|purple)|bg-gradient|linear-gradient/)
    expect(joined).not.toMatch(/border-l-[2-9]|border-r-[2-9]/)
    expect(joined).not.toMatch(/text-[4-9]xl/)
    expect(joined).not.toMatch(/<Card|CardHeader|CardContent/)
  })

  it("keeps keyboard, focus, touch and reduced-motion behavior explicit", () => {
    const joined = surfaces.join("\n")
    expect(joined).toMatch(/min-h-11/)
    expect(joined).toMatch(/h-11 w-11/)
    expect(joined).toMatch(/focus-visible:ring-2/)
    expect(joined).toMatch(/motion-reduce:/)
    expect(detail).toContain("event.ctrlKey || event.metaKey")
    expect(chat).toContain("event.key === \"Enter\" && !event.shiftKey")
    expect(chat).toContain("event.nativeEvent.isComposing")
    expect(detail).toContain('aria-label={t("addAttachment")}')
    expect(detail).toContain('aria-labelledby="portal-ticket-reply-title"')
    expect(detail).toContain('aria-label={t("ratingCommentPlaceholder")}')
    expect(detail).toContain("new Intl.NumberFormat(locale")
  })

  it("uses valid date-time formatting and an AA-safe primary action surface", () => {
    expect(detail).toContain("formatDateTime(ticket.createdAt, locale")
    expect(detail).toContain("formatDateTime(comment.createdAt, locale")
    expect(closure).toContain("formatDateTime(request.dueAt, locale")
    expect(detail).not.toMatch(/formatDate\([^\n]*timeStyle/)
    expect(closure).not.toMatch(/formatDate\([^\n]*timeStyle/)
    expect(layout).toContain("customer-support-surface")
    expect(closure).toContain("customer-support-surface")
    expect(globalStyles).toContain('.customer-support-surface :where(button, a, [role="button"]).bg-primary')
    expect(globalStyles).toContain("background-color: hsl(20 92% 38%) !important")
  })

  it("implements recoverable loading, empty, error, offline and mutation states", () => {
    expect(list).toContain("ticketsLoading")
    expect(list).toContain("noTicketsTitle")
    expect(list).toContain("noTicketResults")
    expect(list).toContain("offlineDraftSaved")
    expect(list).toContain("ticketCreateFailed")
    expect(detail).toContain("attachmentRecoveryPending")
    expect(detail).toContain("uploadProgress")
    expect(detail).toContain("replySendFailed")
    expect(detail).toContain("ratingSendFailed")
    expect(closure).toContain("closureLoadFailed")
    expect(closure).toContain("closureSaveFailed")
  })

  it("preserves drafts and request identities until server-confirmed success", () => {
    expect(list).toContain("PORTAL_NEW_TICKET_DRAFT_KEY")
    expect(list).toContain("clientRequestId")
    expect(detail).toContain("portalReplyDraftKey")
    expect(detail).toContain("draftAttachmentIds")
    expect(detail).toContain("clientRequestId")
    expect(detailApi).toContain("ticketId_clientRequestId")
    expect(detailApi).toContain("replayed")
  })

  it("keeps manual support reachable in every AI availability state", () => {
    expect(chat).toContain('type Availability = "loading" | "enabled" | "disabled" | "unavailable"')
    expect(chat).toContain("createManualTicket")
    expect(chat).toContain("chatDegraded")
    expect(chat).toContain("chatOffline")
    expect(chat).toContain("PORTAL_NEW_TICKET_DRAFT_KEY")
    expect(layout).toContain("supportAiEnabled && <PortalChatWidget")
  })

  it("projects only customer-safe ticket fields and published tenant knowledge", () => {
    const listSelect = listApi.slice(listApi.indexOf("select: {"), listApi.indexOf("})\n  )"))
    expect(listSelect).not.toContain("priority: true")
    expect(listSelect).not.toContain("requesterEmail: true")
    expect(detailApi).toContain("where: { isInternal: false }")
    expect(detailApi).not.toContain("priority: ticket.priority")
    expect(kbApi).toMatch(/organizationId: user\.organizationId,[\s\S]*status: "published"/)
  })

  it("enforces tenant/contact/file boundaries and private download headers", () => {
    expect(listApi).toMatch(/organizationId: user\.organizationId,[\s\S]*contactId: user\.contactId/)
    expect(detailApi).toMatch(/id,[\s\S]*organizationId: user\.organizationId,[\s\S]*contactId: user\.contactId/)
    expect(fileApi).toContain('{ comment: { is: { isInternal: false } } }')
    expect(fileApi).toContain('{ commentId: null, uploadedBy: user.contactId }')
    expect(fileApi).toContain('"Cache-Control": "private, no-store"')
    expect(fileApi).toContain('"X-Content-Type-Options": "nosniff"')
  })

  it("has the complete portal keyset in AZ, RU and EN", () => {
    const dictionaries = ["az", "ru", "en"].map((locale) =>
      JSON.parse(read("messages/" + locale + ".json")) as {
        portal: Record<string, unknown>
        supportCalendar: { statusLabels: Record<string, string> }
      },
    )
    expect(Object.keys(dictionaries[0].portal).sort()).toEqual(Object.keys(dictionaries[1].portal).sort())
    expect(Object.keys(dictionaries[1].portal).sort()).toEqual(Object.keys(dictionaries[2].portal).sort())
    for (const dictionary of dictionaries) {
      expect(dictionary.portal).toHaveProperty("closureStatus")
      expect(dictionary.portal).toHaveProperty("closureOutcome")
      expect(dictionary.portal).toHaveProperty("chatStatusUnavailableTitle")
      expect(dictionary.portal).toHaveProperty("attachmentRecoveryPending")
      expect(dictionary.portal.statusNew).toBe(dictionary.supportCalendar.statusLabels.new)
      expect(dictionary.portal.statusOpen).toBe(dictionary.supportCalendar.statusLabels.open)
      expect(dictionary.portal.statusInProgress).toBe(dictionary.supportCalendar.statusLabels.in_progress)
      expect(dictionary.portal.statusWaiting).toBe(dictionary.supportCalendar.statusLabels.waiting)
      expect(dictionary.portal.statusResolved).toBe(dictionary.supportCalendar.statusLabels.resolved)
      expect(dictionary.portal.statusClosed).toBe(dictionary.supportCalendar.statusLabels.closed)
    }
  })
})
