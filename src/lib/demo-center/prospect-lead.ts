import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { matchInboundLeadId } from "@/lib/inbound-lead-match"
import { isPlausibleLeadPhone } from "@/lib/inbox/customer-phone"
import { createLeadCommand } from "@/lib/crm-commands/lead/create-lead"
import type { CrmCommandActorContext } from "@/lib/crm-commands/actor-context"

/**
 * A prospect who proved their email in a private demo becomes exactly one
 * lead in LeadDrive's own CRM.
 *
 * This is the one place a public demo request reaches tenant data, so the
 * rules are strict:
 *
 *  - The organisation comes from server configuration only, never from the
 *    request. The owner chose LeadDrive Inc. (2026-09-21). By default it is
 *    the voice agent's organisation, and that is not a convenience: the demo's
 *    live call is placed by the voice agent, which serves exactly one
 *    organisation, so a demo lead anywhere else could never be called.
 *    `DEMO_LEAD_ORGANIZATION_ID` overrides it if that ever changes.
 *
 *  - Only verified identity links. The email was proven with a one-time code;
 *    the phone on the form was not, so it is stored on a new lead but never
 *    used to match an existing one — a typed phone could belong to anybody.
 *
 *  - Exactly one lead. A request is claimed with a lease before anything is
 *    written, so two concurrent calls cannot both create. A crash after the
 *    lead is created but before the link is saved is healed by the next call:
 *    the lease expires, the email now matches that lead, and it is linked
 *    instead of duplicated.
 *
 *  - It never throws and never delays the prospect's own flow with an error.
 *    Failures are recorded on the request for the admin, and the next call
 *    (the session start, or a retry) tries again.
 *
 *  - Nothing here is returned to the public player. The lead and organisation
 *    ids stay on the request, in the control plane.
 */

export const DEMO_LEAD_SOURCE = "demo"
export const DEMO_LEAD_CLAIM_LEASE_MS = 5 * 60_000

export type DemoLeadLinkStatus = "PENDING" | "LINKED" | "FAILED" | "UNCONFIGURED"

export type DemoLeadLinkResult =
  | { status: "LINKED"; leadId: string; mode: "created" | "matched" | "already" }
  | { status: "PENDING" | "FAILED" | "UNCONFIGURED" | "NOT_VERIFIED" | "NOT_FOUND" }

type DemoLeadEnv = Partial<Record<"DEMO_LEAD_ORGANIZATION_ID" | "VOICE_AGENT_ORGANIZATION_ID", string>>

export function demoLeadOrganizationId(
  env: DemoLeadEnv = {
    DEMO_LEAD_ORGANIZATION_ID: process.env.DEMO_LEAD_ORGANIZATION_ID,
    VOICE_AGENT_ORGANIZATION_ID: process.env.VOICE_AGENT_ORGANIZATION_ID,
  },
): string | null {
  return env.DEMO_LEAD_ORGANIZATION_ID?.trim() || env.VOICE_AGENT_ORGANIZATION_ID?.trim() || null
}

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

/** What the sales side needs to know, in the language the demo speaks. */
export function demoLeadNotes(request: {
  source: string
  jobTitle: string | null
  phone: string | null
  requestedModules: string[]
  message: string | null
  consentAt: Date
}, verifiedAt: Date): string {
  // A phone the lead card would refuse still belongs in front of the seller.
  const unusablePhone = request.phone?.trim() && !isPlausibleLeadPhone(request.phone) ? request.phone.trim() : null
  const lines = [
    "LeadDrive demo sorğusu",
    `Kanal: ${request.source}`,
    request.jobTitle ? `Vəzifə: ${request.jobTitle}` : null,
    unusablePhone ? `Telefon (yoxlanılmayıb): ${unusablePhone}` : null,
    request.requestedModules.length ? `Maraq: ${request.requestedModules.join(", ")}` : null,
    request.message ? `Mesaj: ${request.message}` : null,
    `Razılıq: ${formatUtc(request.consentAt)}`,
    `E-poçt təsdiqlənib: ${formatUtc(verifiedAt)}`,
  ]
  return lines.filter(Boolean).join("\n").slice(0, 5000)
}

function errorSummary(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error"
  const message = error instanceof Error ? error.message : String(error)
  return `${name}: ${message}`.slice(0, 300)
}

async function markRequest(
  requestId: string,
  data: { leadLinkStatus: DemoLeadLinkStatus; leadLinkError?: string | null },
  now: Date,
): Promise<void> {
  await runWithRlsBypass(() =>
    prisma.demoRequest.updateMany({
      where: { id: requestId, leadLinkStatus: { not: "LINKED" } },
      data: { ...data, leadLinkUpdatedAt: now },
    }),
  )
}

export async function ensureDemoProspectLead(requestId: string, now: Date = new Date()): Promise<DemoLeadLinkResult> {
  try {
    return await linkDemoProspectLead(requestId, now)
  } catch (error) {
    console.error("[demo-lead] link failed", { requestId, error: errorSummary(error) })
    await markRequest(requestId, { leadLinkStatus: "FAILED", leadLinkError: errorSummary(error) }, now).catch(() => {})
    return { status: "FAILED" }
  }
}

async function linkDemoProspectLead(requestId: string, now: Date): Promise<DemoLeadLinkResult> {
  const request = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        name: true,
        company: true,
        jobTitle: true,
        email: true,
        phone: true,
        message: true,
        source: true,
        requestedModules: true,
        consentAt: true,
        internalLeadId: true,
        leadLinkStatus: true,
        grants: {
          where: { verifiedAt: { not: null } },
          select: { verifiedAt: true },
          orderBy: { verifiedAt: "asc" },
          take: 1,
        },
      },
    }),
  )
  if (!request) return { status: "NOT_FOUND" }
  if (request.leadLinkStatus === "LINKED" && request.internalLeadId) {
    return { status: "LINKED", leadId: request.internalLeadId, mode: "already" }
  }
  const verifiedAt = request.grants[0]?.verifiedAt
  if (!verifiedAt) return { status: "NOT_VERIFIED" }

  const organizationId = demoLeadOrganizationId()
  const organization = organizationId
    ? await runWithRlsBypass(() =>
        prisma.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { id: true } }),
      )
    : null
  if (!organizationId || !organization) {
    await markRequest(requestId, { leadLinkStatus: "UNCONFIGURED", leadLinkError: null }, now)
    return { status: "UNCONFIGURED" }
  }

  // Claim before writing anything. A PENDING claim younger than the lease
  // belongs to someone else who is creating the lead right now.
  const leaseCutoff = new Date(now.getTime() - DEMO_LEAD_CLAIM_LEASE_MS)
  const claimed = await runWithRlsBypass(() =>
    prisma.demoRequest.updateMany({
      where: {
        id: requestId,
        OR: [
          { leadLinkStatus: null },
          { leadLinkStatus: { in: ["FAILED", "UNCONFIGURED"] } },
          { leadLinkStatus: "PENDING", leadLinkUpdatedAt: { lt: leaseCutoff } },
          { leadLinkStatus: "PENDING", leadLinkUpdatedAt: null },
        ],
      },
      data: { leadLinkStatus: "PENDING", leadLinkUpdatedAt: now, leadLinkError: null },
    }),
  )
  if (!claimed.count) return { status: "PENDING" }

  const { leadId, mode } = await runWithTenant(organizationId, async () => {
    const existing = await matchInboundLeadId(organizationId, { email: request.email })
    if (existing) {
      await prisma.activity.create({
        data: {
          organizationId,
          type: "note",
          subject: "LeadDrive demo: e-poçt təsdiqləndi",
          description: demoLeadNotes(request, verifiedAt),
          relatedType: "lead",
          relatedId: existing,
          completedAt: now,
        },
      })
      return { leadId: existing, mode: "matched" as const }
    }

    const actor: CrmCommandActorContext = {
      organizationId,
      userId: null,
      role: "admin",
      source: "demo",
      requestId: `demo-request:${request.id}`,
    }
    const created = await createLeadCommand(actor, {
      contactName: request.name,
      companyName: request.company,
      email: request.email,
      // Only a phone the lead card accepts: a malformed one would fail the
      // whole create, and it is kept in the notes instead.
      ...(request.phone && isPlausibleLeadPhone(request.phone) ? { phone: request.phone.trim() } : {}),
      source: DEMO_LEAD_SOURCE,
      sourceDetail: `demo:${request.source}`.slice(0, 200),
      ...(request.requestedModules.length ? { interest: request.requestedModules.join(", ").slice(0, 2000) } : {}),
      notes: demoLeadNotes(request, verifiedAt),
    })
    return { leadId: created.entity.id, mode: "created" as const }
  })

  await runWithRlsBypass(() =>
    prisma.demoRequest.updateMany({
      where: { id: requestId, leadLinkStatus: "PENDING", leadLinkUpdatedAt: now },
      data: {
        leadLinkStatus: "LINKED",
        internalLeadId: leadId,
        internalLeadOrganizationId: organizationId,
        leadLinkedAt: now,
        leadLinkUpdatedAt: now,
        leadLinkError: null,
      },
    }),
  )
  return { status: "LINKED", leadId, mode }
}
