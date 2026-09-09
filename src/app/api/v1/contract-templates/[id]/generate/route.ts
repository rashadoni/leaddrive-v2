/**
 * CLM Slice 1c — Generate a Contract from a ContractTemplate.
 *
 * POST /api/v1/contract-templates/:id/generate
 *
 * Runs the clause-substituter (template clauses + variables + caller-
 * supplied values) → renderedBody, then in a single $transaction:
 *   1. Creates Contract (status "draft", templateId + templateVersion pinned).
 *   2. Creates ContractVersion (versionNo: 1, sha256 contentHash, source: "draft").
 *
 * Returns the full Contract on success; 400 when required variables
 * are missing; 403 when the "contracts" module is disabled or the caller
 * lacks the "contracts:write" permission.
 *
 * Auth: requireAuth(contracts, write) — enforces role permission + module gate
 *       + tenant-binding/2FA checks. Read-only roles (sales/support) that have
 *       only contracts:read are rejected with 403 before reaching any business logic.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import crypto from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { substituteClauses } from "@/lib/contract-lifecycle/clause-substituter"
import type { TemplateClause, TemplateVariable } from "@/lib/contract-lifecycle/types"
import { normalizeContractRow } from "@/lib/prisma-decimal"
import { detectDeviations } from "@/lib/contract-lifecycle/deviation-detector"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

// ─── Request schema ───────────────────────────────────────────────────────────

const generateContractSchema = z.object({
  /** Caller-supplied variable values: keys = variable names, values = any JSON primitive. */
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Optional FK fields — all org-scoped, validated before the transaction (cross-tenant guard). */
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  contactId: z.string().optional(),
  /** Human-readable contract number. Generated as CONTRACT-<timestamp> if omitted. */
  contractNumber: z.string().min(1).max(100).optional(),
  /** Contract title. Defaults to the template name if omitted. */
  title: z.string().min(1).max(255).optional(),
  /** ISO-8601 date strings — coerced to Date; bad inputs → 400 not Invalid Date. */
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  valueAmount: nonNegativeFinancialAmountSchema.optional(),
  currency: z.string().optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** sha256 hex digest of a UTF-8 string. */
function sha256hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

/** Deterministic contract number: CONTRACT-<YYYYMMDDHHmmss>-<4 random hex chars>. */
function generateContractNumber(): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("")
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase()
  return `CONTRACT-${ts}-${suffix}`
}

// ─── POST /api/v1/contract-templates/:id/generate ────────────────────────────

export const POST = withRlsAuth("contracts", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  // requireAuth enforces: session validity + role permission (contracts:write) +
  // module gate (contracts) + tenant-binding / 2FA checks.
  // A read-only role (sales/support with contracts:["read"]) is rejected here with 403
  // before any contract is created.
  const { orgId, userId } = auth
  const { id } = await params

  const body = await req.json()
  const parsed = generateContractSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // 1. Load template (org-scoped).
    const template = await prisma.contractTemplate.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }
    if (!template.isActive) {
      return NextResponse.json({ error: "Template is not active" }, { status: 422 })
    }

    // 2. Cross-tenant FK validation — validate supplied FKs belong to this org BEFORE
    //    the $transaction. Without this, a caller could plant a foreign-org company/
    //    deal/contact FK onto a new contract (same class as the quotes route guard).
    if (parsed.data.companyId) {
      const c = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId: orgId },
        select: { id: true },
      })
      if (!c) return NextResponse.json({ error: "Company not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.dealId) {
      const d = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, organizationId: orgId },
        select: { id: true },
      })
      if (!d) return NextResponse.json({ error: "Deal not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.contactId) {
      const ct = await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId: orgId },
        select: { id: true },
      })
      if (!ct) return NextResponse.json({ error: "Contact not found in this tenant" }, { status: 404 })
    }

    // 3. Run clause-substituter.
    const clauses = template.clauses as TemplateClause[]
    const variables = template.variables as TemplateVariable[]
    const result = substituteClauses({
      clauses,
      variables,
      values: parsed.data.variables as Record<string, string | number | boolean>,
    })

    if (!result.ok) {
      const details: Record<string, unknown> = {}
      if (result.missingVars.length > 0) details.missingVars = result.missingVars
      if (result.unknownVars.length > 0) details.unknownVars = result.unknownVars
      if (result.typeMismatches.length > 0) details.typeMismatches = result.typeMismatches
      return NextResponse.json(
        {
          error: "Variable substitution failed",
          details,
          // Top-level missingVars array for easy client-side consumption
          missingVars: result.missingVars,
        },
        { status: 400 },
      )
    }

    const renderedBody = result.renderedBody
    const contentHash = sha256hex(renderedBody)

    // 4. Build contract fields.
    const contractNumber = parsed.data.contractNumber ?? generateContractNumber()
    const title = parsed.data.title ?? template.name
    const contractType = template.defaultContractType ?? "service_agreement"

    // 5. Atomic transaction: Contract + ContractVersion v1.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [contract] = await prisma.$transaction(async (tx: any) => {
      const newContract = await tx.contract.create({
        data: {
          organizationId: orgId,
          contractNumber,
          title,
          type: contractType,
          status: "draft",
          templateId: template.id,
          templateVersion: template.version,
          renderedBody,
          ...(parsed.data.companyId ? { companyId: parsed.data.companyId } : {}),
          ...(parsed.data.dealId ? { dealId: parsed.data.dealId } : {}),
          ...(parsed.data.contactId ? { contactId: parsed.data.contactId } : {}),
          // startDate/endDate are already Date objects from z.coerce.date() — no re-parse needed.
          ...(parsed.data.startDate ? { startDate: parsed.data.startDate } : {}),
          ...(parsed.data.endDate ? { endDate: parsed.data.endDate } : {}),
          ...(parsed.data.valueAmount !== undefined ? { valueAmount: parsed.data.valueAmount } : {}),
          ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
          ...(userId ? { createdBy: userId } : {}),
        },
        include: {
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true } },
          contact: { select: { id: true, fullName: true } },
        },
      })

      await tx.contractVersion.create({
        data: {
          organizationId: orgId,
          contractId: newContract.id,
          versionNo: 1,
          renderedBody,
          contentHash,
          source: "draft",
          ...(userId ? { createdBy: userId } : {}),
        },
      })

      return [newContract]
    })

    // 6. Best-effort deviation detection — MUST NOT break the hardened generate tx above.
    //    Runs after the contract is already persisted.  Any failure here is logged and swallowed.
    try {
      const libraryClauses = await prisma.contractClause.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, riskLevel: true, status: true, fallbackOfClauseId: true },
      })

      // Template clauses array from the raw template (TemplateClause has at least { title }).
      const templateClauseInputs = clauses.map((c) => ({ title: c.title }))
      const deviations = detectDeviations(templateClauseInputs, libraryClauses)

      if (deviations.length > 0) {
        await prisma.contractDeviationFlag.createMany({
          data: deviations.map((d) => ({
            organizationId: orgId,
            contractId:     contract.id,
            clauseId:       d.clauseId ?? undefined,
            clauseTitle:    d.clauseTitle,
            deviationType:  d.deviationType,
            severity:       d.severity,
            status:         "flagged",
            detectedBy:     userId ?? undefined,
          })),
        })
      }
    } catch (detectionErr) {
      // Best-effort — log but don't fail the request.
      console.error("[contract-templates/:id/generate] deviation detection failed (non-fatal):", detectionErr)
    }

    return NextResponse.json({ success: true, data: normalizeContractRow(contract) }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2003" || e.code === "P2025") {
        return NextResponse.json({ error: "Referenced record not found" }, { status: 404 })
      }
      if (e.code === "P2002") {
        return NextResponse.json({ error: "Contract number already exists" }, { status: 409 })
      }
    }
    console.error("[contract-templates/:id/generate POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
