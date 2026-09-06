import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-customer-portal-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const list = readFileSync("src/app/portal/tickets/page.tsx", "utf8")
const detail = readFileSync("src/app/portal/tickets/[id]/page.tsx", "utf8")
const chat = readFileSync("src/app/portal/chat/page.tsx", "utf8")
const closure = readFileSync("src/app/ticket-closure/[token]/page.tsx", "utf8")

describe("Customer Support Portal flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
    expect(flow).toContain("SUPPORT_EVIDENCE_COMMIT must be an exact Git commit")
  })

  it("proves the customer journey, recovery, AI fallbacks and access boundaries", () => {
    for (const id of [
      "ticket-list-recovery-filter-draft-and-offline",
      "ticket-detail-load-attachment-send-recovery-and-reopen",
      "chat-disabled-unavailable-and-manual-handoff",
      "chat-send-offline-degraded-and-escalation-recovery",
      "closure-load-save-recovery-and-terminal-outcomes",
      "direct-route-authentication-and-invalid-resource-boundaries",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("portal_create_failure_lost_draft")
    expect(flow).toContain("portal_reply_failure_lost_draft")
    expect(flow).toContain("portal_chat_degraded_manual_handoff_missing")
    expect(flow).toContain("portal_invalid_direct_route_exposed_ticket_content")
    expect(flow).toContain('"customer-portal-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("uses stable selectors for all customer-facing states", () => {
    for (const marker of [
      'data-testid="portal-tickets-workspace"',
      'data-testid="portal-tickets-error"',
      'data-testid="portal-tickets-empty-state"',
      'data-testid="portal-new-ticket-form"',
    ]) expect(list).toContain(marker)
    for (const marker of [
      'data-testid="portal-ticket-workspace"',
      'data-testid="portal-ticket-conversation"',
      'data-testid="portal-ticket-reply"',
      'data-testid="portal-ticket-file"',
      'data-testid="portal-ticket-send"',
    ]) expect(detail).toContain(marker)
    for (const marker of [
      'data-testid="portal-chat-workspace"',
      'data-testid="portal-chat-log"',
      'data-testid="portal-chat-manual-ticket"',
      'data-testid="portal-chat-send-error"',
    ]) expect(chat).toContain(marker)
    for (const marker of [
      'data-testid="ticket-closure-workspace"',
      'data-testid="ticket-closure-error"',
      'data-testid="ticket-closure-confirm"',
      'data-testid="ticket-closure-outcome"',
    ]) expect(closure).toContain(marker)
  })

  it("runs only when a customer portal scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-customer-portal-flow-evidence.mjs")
    expect(workflow).toContain("*,portal-tickets,*|*,portal-ticket-detail,*|*,portal-chat,*|*,ticket-closure,*")
    expect(workflow).toContain("customer_portal_flow_status")
  })
})
