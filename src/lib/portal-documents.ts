/**
 * The counterparty's cabinet in the client portal — «Sənədlər» (owner
 * 2026-11-25, mock «Кабинет контрагента»): its company's contracts, their
 * price protocols, invoices and acceptance acts, what waits for this person's
 * signature, and the PDFs.
 *
 * Who sees what — the rules every portal-documents route goes through:
 *   - a portal contact with «Sənədlər» switched on (Contact.portalDocumentsEnabled)
 *     and a company, in an organisation with the Contracts module;
 *   - only that company's contracts, and only agreed ones (no draft, nothing
 *     in internal approval, nothing rejected or cancelled);
 *   - only documents sent for signing or signed — never a draft;
 *   - only invoices that were issued — never a draft or a cancelled one.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser, type PortalUser } from "@/lib/portal-auth"
import { orgHasModule } from "@/lib/api-auth"

export const PORTAL_CONTRACT_STATUSES = ["approved", "active", "renewing", "renewed", "expired", "terminated"]
export const PORTAL_DOCUMENT_STATUSES = ["in_signing", "signed"]
export const PORTAL_INVOICE_STATUSES = ["sent", "viewed", "partially_paid", "paid", "overdue"]
const LIVE_ENVELOPE = ["sent", "in_progress"]
const SIGNABLE_SIGNER = ["sent", "viewed"]

export type PortalDocumentsAccess =
  | { ok: true; user: PortalUser; companyId: string; email: string }
  | { ok: false; status: number; code: string }

/** The portal contact, if «Sənədlər» is theirs to open. */
export async function portalDocumentsAccess(): Promise<PortalDocumentsAccess> {
  const user = await getPortalUser()
  if (!user) return { ok: false, status: 401, code: "UNAUTHORIZED" }
  return runWithTenant(user.organizationId, async () => {
    const contact = await prisma.contact.findFirst({
      where: { id: user.contactId, organizationId: user.organizationId },
      select: { portalDocumentsEnabled: true, companyId: true, email: true },
    })
    if (!contact?.portalDocumentsEnabled) return { ok: false, status: 403, code: "DOCUMENTS_DISABLED" } as const
    if (!contact.companyId) return { ok: false, status: 403, code: "NO_COMPANY" } as const
    if (!contact.email) return { ok: false, status: 403, code: "NO_EMAIL" } as const
    if (!(await orgHasModule(user.organizationId, "contracts"))) return { ok: false, status: 403, code: "MODULE_DISABLED" } as const
    return { ok: true, user, companyId: contact.companyId, email: contact.email } as const
  })
}

/** The «where» that keeps a contract the counterparty's: its company, agreed. */
export function portalContractWhere(orgId: string, companyId: string, contractId?: string) {
  return {
    organizationId: orgId,
    companyId,
    status: { in: PORTAL_CONTRACT_STATUSES },
    ...(contractId ? { id: contractId } : {}),
  }
}

export interface EnvelopeForWaiting {
  id: string
  status: string
  subject: string
  sentAt: Date | null
  expiresAt: Date | null
  documentId: string | null
  contract: { id: string; contractNumber: string; title: string }
  document: { kind: string; number: number } | null
  signers: Array<{ id: string; email: string; role: string; status: string; order: number }>
}

export interface WaitingItem {
  signerId: string
  envelopeId: string
  contractId: string
  contractNumber: string
  title: string
  kind: "contract" | "price_protocol" | "acceptance_act"
  number: number | null
  sentAt: Date | null
  /** False while an earlier signer has not signed: the sign page would refuse. */
  canSignNow: boolean
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What waits for this person's signature: a live envelope where they are a
 * signer (by e-mail) who has not signed yet. Expired envelopes are left out —
 * their link would only say «expired».
 */
export function waitingForSigner(envelopes: EnvelopeForWaiting[], email: string, now: Date): WaitingItem[] {
  const out: WaitingItem[] = []
  for (const env of envelopes) {
    if (!LIVE_ENVELOPE.includes(env.status)) continue
    if (env.expiresAt && env.expiresAt.getTime() <= now.getTime()) continue
    for (const signer of env.signers) {
      if (signer.role !== "signer" || !SIGNABLE_SIGNER.includes(signer.status) || !sameEmail(signer.email, email)) continue
      const earlierUnsigned = env.signers.some((s) => s.role === "signer" && s.order < signer.order && s.status !== "signed")
      out.push({
        signerId: signer.id,
        envelopeId: env.id,
        contractId: env.contract.id,
        contractNumber: env.contract.contractNumber,
        title: env.documentId ? env.subject : env.contract.title,
        kind: env.document ? (env.document.kind as WaitingItem["kind"]) : "contract",
        number: env.document?.number ?? null,
        sentAt: env.sentAt,
        canSignNow: !earlierUnsigned,
      })
    }
  }
  return out.sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))
}

export const WAITING_ENVELOPE_SELECT = {
  id: true,
  status: true,
  subject: true,
  sentAt: true,
  expiresAt: true,
  documentId: true,
  contract: { select: { id: true, contractNumber: true, title: true } },
  document: { select: { kind: true, number: true } },
  signers: { select: { id: true, email: true, role: true, status: true, order: true } },
} as const
