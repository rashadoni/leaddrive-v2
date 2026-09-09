/**
 * GET /api/v1/zapier/samples/[trigger]
 *
 * Returns a sample payload for a given trigger. Zapier's Platform UI calls
 * this when a user is setting up a Zap and previewing how data looks before
 * the first real event fires.
 *
 * Strategy: serve the most recent real record from the org's data when one
 * exists (richer preview), fall back to a static sample shape otherwise so
 * Zapier never sees an empty payload.
 *
 * Part of L6 Native Zapier Connector.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getZapierAuth, hasAnyScope, requiredScopesForEvent } from "@/lib/zapier-auth"
import { ZAPIER_TRIGGER_KEYS } from "@/lib/zapier-triggers"

/** Static fallback samples — used when no real data exists in the org yet. */
const STATIC_SAMPLES: Record<string, Record<string, unknown>> = {
  "lead.created": {
    id: "lead_sample_001",
    contactName: "Sample Lead",
    companyName: "Sample Co.",
    email: "lead@example.com",
    phone: "+1 555-0100",
    source: "website",
    status: "new",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "deal.created": {
    id: "deal_sample_001",
    name: "Sample Deal — $50K",
    valueAmount: 50000,
    currency: "USD",
    stage: "Qualified",
    pipelineId: "pipeline_sample",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "deal.stage_changed": {
    id: "deal_sample_001",
    name: "Sample Deal",
    valueAmount: 50000,
    fromStage: "Qualified",
    toStage: "Proposal",
    changedAt: "2026-05-14T10:00:00.000Z",
  },
  "deal.won": {
    id: "deal_sample_001",
    name: "Sample Deal",
    valueAmount: 50000,
    closedAt: "2026-05-14T10:00:00.000Z",
  },
  "deal.lost": {
    id: "deal_sample_001",
    name: "Sample Deal",
    valueAmount: 50000,
    lostReason: "Budget",
    closedAt: "2026-05-14T10:00:00.000Z",
  },
  "contact.created": {
    id: "contact_sample_001",
    fullName: "Jane Doe",
    email: "jane@example.com",
    phone: "+1 555-0200",
    position: "VP of Operations",
    companyId: "company_sample",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "company.created": {
    id: "company_sample_001",
    name: "Sample Co.",
    industry: "Software",
    website: "https://example.com",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "ticket.created": {
    id: "ticket_sample_001",
    ticketNumber: "TICK-2026-0001",
    subject: "Sample support request",
    status: "open",
    priority: "normal",
    category: "billing",
    contactId: "contact_sample_001",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "ticket.resolved": {
    id: "ticket_sample_001",
    subject: "Sample support request",
    status: "resolved",
    resolvedAt: "2026-05-14T10:00:00.000Z",
  },
  "task.created": {
    id: "task_sample_001",
    title: "Follow up with prospect",
    assignedToId: "user_sample",
    dueAt: "2026-05-21T10:00:00.000Z",
    createdAt: "2026-05-14T10:00:00.000Z",
  },
  "campaign.sent": {
    id: "campaign_sample_001",
    name: "Q2 Newsletter",
    channel: "email",
    recipientCount: 1234,
    sentAt: "2026-05-14T10:00:00.000Z",
  },
}

/**
 * Map a trigger key → live DB fetch for a richer sample, or null when no fetcher.
 *
 * SECURITY: Each entity uses an explicit `select` whitelist to prevent leaking
 * internal/credential fields (portalPasswordHash, portalVerificationToken,
 * apiKey secrets, etc.) into the Zapier UI preview. Adding a new entity here
 * MUST go through the same whitelist treatment — never `as any` raw findFirst.
 */
async function liveSampleFor(trigger: string, orgId: string): Promise<unknown> {
  try {
    switch (trigger) {
      case "lead.created":
      case "lead.updated":
      case "lead.converted":
        // SECURITY: explicit whitelist; do not include `scoreDetails` (internal weights).
        return await prisma.lead.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, contactName: true, companyName: true, email: true,
            phone: true, source: true, status: true, score: true,
            assignedTo: true, estimatedValue: true,
            createdAt: true, updatedAt: true,
          },
        })

      case "deal.created":
      case "deal.updated":
      case "deal.stage_changed":
      case "deal.won":
      case "deal.lost":
        // SECURITY: explicit whitelist; exclude `metadata` (org-internal JSON).
        return await prisma.deal.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, valueAmount: true, currency: true,
            stage: true, pipelineId: true, companyId: true, contactId: true,
            assignedTo: true, expectedClose: true, probability: true,
            createdAt: true, updatedAt: true,
          },
        })

      case "contact.created":
      case "contact.updated":
        // SECURITY: NEVER include portal* fields — they contain credentials
        // (portalPasswordHash, portalVerificationToken).
        return await prisma.contact.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, fullName: true, email: true, phone: true,
            position: true, department: true, companyId: true,
            source: true, createdAt: true, updatedAt: true,
          },
        })

      case "company.created":
      case "company.updated":
        // SECURITY: explicit whitelist; exclude `creditLimit`/`voen` (financial PII).
        return await prisma.company.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, industry: true, website: true,
            phone: true, email: true, address: true, city: true, country: true,
            employeeCount: true, createdAt: true, updatedAt: true,
          },
        })

      case "ticket.created":
      case "ticket.updated":
      case "ticket.resolved":
        // SECURITY: explicit whitelist; `sourceMeta` may carry channel secrets — exclude.
        return await prisma.ticket.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, ticketNumber: true, subject: true, description: true,
            status: true, priority: true, category: true,
            contactId: true, companyId: true, assignedTo: true,
            source: true, createdAt: true, updatedAt: true, resolvedAt: true,
          },
        })

      // TODO L6.2: live samples for task.* and campaign.*. Currently fall through to static.
      default:
        return null
    }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ trigger: string }> }) {
  const auth = await getZapierAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }

  const { trigger } = await params
  if (!ZAPIER_TRIGGER_KEYS.has(trigger)) {
    return NextResponse.json({ error: "unknown_trigger", trigger }, { status: 404 })
  }

  // Scope check
  const needed = requiredScopesForEvent(trigger)
  if (!hasAnyScope(auth, needed)) {
    return NextResponse.json(
      { error: "insufficient_scope", required_any_of: needed },
      { status: 403 }
    )
  }

  const live = await runWithTenant(auth.orgId, () => liveSampleFor(trigger, auth.orgId))
  if (live) {
    return NextResponse.json({ trigger, source: "live", sample: live })
  }

  const fallback = STATIC_SAMPLES[trigger]
  if (!fallback) {
    return NextResponse.json(
      { trigger, source: "none", sample: { note: "No sample available for this trigger" } },
      { status: 200 }
    )
  }

  return NextResponse.json({ trigger, source: "static", sample: fallback })
}
