/**
 * CLM Slice 3d — Submit a contract intake request.
 *
 * POST /api/v1/contract-intake-forms/:id/submit
 *
 * A user fills in the active intake form and submits it. This route:
 *   1. Validates responses against the form's question definitions.
 *   2. In a single $transaction:
 *      a. Creates a draft Contract auto-filled via the form's mapping.
 *         Any companyId/dealId in responses is cross-tenant validated (same org).
 *      b. Creates a ContractIntakeSubmission linked to the contract.
 *   3. If form.defaultStages is non-empty:
 *      - Fetches active approval rules (org-wide + no template filter for intake).
 *      - Runs applyApprovalRules + resolveApprovalAssignee (delegation).
 *      - Creates ContractApprovalStage rows + sets status "pending_approval".
 *      - If rules skip all stages → leaves contract as "draft" (no error).
 *   4. Notifies org admins/managers ("new contract request").
 *
 * Auth: any authenticated org member (users submit requests, admins process them).
 *       Org-scoped + "contracts" module gate.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { createNotification } from "@/lib/notifications"
import { resolveApprovalAssignee } from "@/lib/contract-lifecycle/delegation"
import {
  applyApprovalRules,
  ApprovalRulesCapError,
  type StageSpec,
} from "@/lib/contract-lifecycle/approval-rules"
import { coercedNonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

// Supported contract field mappings from form responses.
const MAPPABLE_FIELDS = ["title", "valueAmount", "currency", "notes", "type"] as const
type MappableField = (typeof MAPPABLE_FIELDS)[number]

function isMappableField(f: string): f is MappableField {
  return (MAPPABLE_FIELDS as readonly string[]).includes(f)
}

const submitSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
})

export const POST = withRlsSessionAuth(async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = session

  // Module gate
  if (session.role !== "superadmin" && !(await orgHasModule(orgId, "contracts"))) {
    return moduleDisabledResponse("contracts")
  }

  const { id: formId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { responses } = parsed.data

  try {
    // ─── 1. Load active form (org-scoped) ────────────────────────────────────
    const form = await prisma.contractIntakeForm.findFirst({
      where: { id: formId, organizationId: orgId, isActive: true },
    })
    if (!form) {
      return NextResponse.json({ error: "Intake form not found or inactive." }, { status: 404 })
    }

    // ─── 2. Validate responses against form questions ─────────────────────────
    const questions = form.questions as Array<{
      id: string
      label: string
      type: "text" | "textarea" | "number" | "date" | "select"
      required: boolean
      options?: string[]
    }>

    const validationErrors: string[] = []
    for (const q of questions) {
      const val = responses[q.id]
      if (q.required && (val === undefined || val === null || val === "")) {
        validationErrors.push(`Required field "${q.label}" is missing.`)
        continue
      }
      if (val === undefined || val === null || val === "") continue

      // Type coercion checks
      if (q.type === "number" && isNaN(Number(val))) {
        validationErrors.push(`Field "${q.label}" must be a number.`)
      }
      if (q.type === "date" && isNaN(Date.parse(String(val)))) {
        validationErrors.push(`Field "${q.label}" must be a valid date.`)
      }
      if (q.type === "select" && q.options?.length && !q.options.includes(String(val))) {
        validationErrors.push(`Field "${q.label}" must be one of: ${q.options.join(", ")}.`)
      }
    }
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors[0], errors: validationErrors }, { status: 400 })
    }

    // ─── 3. Build contract data from mapping ──────────────────────────────────
    const mapping = form.mapping as Record<string, string>
    const contractPatch: Record<string, string | number | null> = {}

    for (const [questionId, fieldName] of Object.entries(mapping)) {
      const rawVal = responses[questionId]
      if (rawVal === undefined || rawVal === null || rawVal === "") continue

      if (!isMappableField(fieldName)) continue // unknown field → skip (fail-safe)

      if (fieldName === "valueAmount") {
        const amount = coercedNonNegativeFinancialAmountSchema.safeParse(rawVal)
        if (!amount.success) {
          return NextResponse.json(
            { error: "Mapped contract value must be a finite, non-negative amount within the supported limit." },
            { status: 400 },
          )
        }
        contractPatch.valueAmount = amount.data
      } else {
        contractPatch[fieldName] = String(rawVal)
      }
    }

    // ─── 4. Cross-tenant guard for companyId / dealId in responses ────────────
    // The form might map a response to companyId/dealId via a custom question.
    // We look for any response key whose mapped field is "companyId" or "dealId"
    // OR any response key literally named companyId/dealId.
    const companyIdCandidate = findForeignIdInResponses(responses, mapping, "companyId")
    const dealIdCandidate = findForeignIdInResponses(responses, mapping, "dealId")

    if (companyIdCandidate) {
      const company = await prisma.company.findFirst({
        where: { id: companyIdCandidate, organizationId: orgId },
        select: { id: true },
      })
      if (!company) {
        return NextResponse.json(
          { error: `Company "${companyIdCandidate}" not found in your organization.` },
          { status: 400 },
        )
      }
    }

    if (dealIdCandidate) {
      const deal = await prisma.deal.findFirst({
        where: { id: dealIdCandidate, organizationId: orgId },
        select: { id: true },
      })
      if (!deal) {
        return NextResponse.json(
          { error: `Deal "${dealIdCandidate}" not found in your organization.` },
          { status: 400 },
        )
      }
    }

    // ─── 5. Build default approval stages from form ───────────────────────────
    const defaultStageSpecs = (form.defaultStages as Array<{
      label: string
      assigneeUserId?: string
      assigneeRole?: string
      slaHours?: number
    }>).map((s) => ({
      label: s.label,
      assigneeUserId: s.assigneeUserId ?? null,
      assigneeRole: s.assigneeRole ?? null,
      slaHours: s.slaHours ?? null,
    }))

    // ─── 6. Apply conditional rules if defaultStages present ──────────────────
    let finalStages: StageSpec[] = []
    let shouldAutoRoute = false

    if (defaultStageSpecs.length > 0) {
      // Contract attributes for rule evaluation — use patch values (type + currency).
      const contractForRules = {
        valueAmount: contractPatch.valueAmount != null
          ? new Prisma.Decimal(contractPatch.valueAmount)
          : null,
        type: String(contractPatch.type ?? form.contractType ?? "service_agreement"),
        currency: String(contractPatch.currency ?? "AZN"),
      }

      const activeRules = await prisma.contractApprovalRule.findMany({
        where: { organizationId: orgId, isActive: true, templateId: null },
        orderBy: { createdAt: "asc" },
        include: { actions: { orderBy: { sortOrder: "asc" } } },
      })

      try {
        finalStages = applyApprovalRules(defaultStageSpecs, activeRules, contractForRules)
      } catch (err) {
        if (err instanceof ApprovalRulesCapError) {
          // Cap exceeded: fall back to defaultStages directly (not a user error on intake)
          finalStages = defaultStageSpecs
        } else {
          throw err
        }
      }
      shouldAutoRoute = finalStages.length > 0
    }

    // ─── 7. Resolve delegation for stages ────────────────────────────────────
    const submittedAt = new Date()
    type ResolvedStage = StageSpec & {
      resolvedAssigneeUserId: string | null
      originalAssigneeUserId: string | null
    }

    let resolvedStages: ResolvedStage[] = []
    if (shouldAutoRoute) {
      resolvedStages = await Promise.all(
        finalStages.map(async (s) => {
          if (!s.assigneeUserId) {
            return { ...s, resolvedAssigneeUserId: null, originalAssigneeUserId: null }
          }
          const resolved = await resolveApprovalAssignee(prisma, orgId, s.assigneeUserId, submittedAt)
          return {
            ...s,
            resolvedAssigneeUserId: resolved.resolvedUserId,
            originalAssigneeUserId: resolved.delegated ? resolved.originalUserId : s.assigneeUserId,
          }
        }),
      )
    }

    // ─── 8. $transaction: create contract + submission (+ optional stages) ────
    const contractType = String(contractPatch.type ?? form.contractType ?? "service_agreement")
    const contractStatus = shouldAutoRoute ? "pending_approval" : "draft"

    // Generate a simple contract number for the intake-spawned draft.
    const contractCount = await prisma.contract.count({ where: { organizationId: orgId } })
    const contractNumber = `INT-${String(contractCount + 1).padStart(5, "0")}`

    const stage1DueAt =
      shouldAutoRoute && resolvedStages[0]?.slaHours
        ? new Date(submittedAt.getTime() + resolvedStages[0].slaHours * 3600 * 1000)
        : null

    const { submission, contractId } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create draft contract
      const contract = await tx.contract.create({
        data: {
          organizationId: orgId,
          contractNumber,
          title: String(contractPatch.title ?? `${form.name} Request`),
          type: contractType,
          status: contractStatus,
          currency: String(contractPatch.currency ?? "AZN"),
          ...(contractPatch.valueAmount != null
            ? { valueAmount: new Prisma.Decimal(contractPatch.valueAmount) }
            : {}),
          ...(contractPatch.notes ? { notes: String(contractPatch.notes) } : {}),
          ...(companyIdCandidate ? { companyId: companyIdCandidate } : {}),
          ...(dealIdCandidate ? { dealId: dealIdCandidate } : {}),
          createdBy: userId,
          ...(shouldAutoRoute ? { currentApprovalStage: 1 } : {}),
        },
        select: { id: true },
      })

      // Create ContractIntakeSubmission linked to the contract
      const sub = await tx.contractIntakeSubmission.create({
        data: {
          organizationId: orgId,
          formId,
          responses: responses as object,
          contractId: contract.id,
          status: "contract_created",
          submittedBy: userId,
          submittedAt,
          processedAt: submittedAt,
        },
      })

      // Create approval stages if auto-routing
      if (shouldAutoRoute && resolvedStages.length > 0) {
        await tx.contractApprovalStage.createMany({
          data: resolvedStages.map((s, i) => ({
            organizationId: orgId,
            contractId: contract.id,
            order: i + 1,
            label: s.label,
            assigneeUserId: s.resolvedAssigneeUserId ?? null,
            originalAssigneeUserId: s.originalAssigneeUserId ?? null,
            assigneeRole: s.assigneeRole ?? null,
            slaHours: s.slaHours ?? null,
            dueAt: i === 0 ? stage1DueAt : null,
            status: "pending",
          })),
        })
      }

      return { submission: sub, contractId: contract.id }
    })

    // ─── 9. Notify admins/managers (processing queue) ─────────────────────────
    try {
      const recipients = await prisma.user.findMany({
        where: { organizationId: orgId, role: { in: ["admin", "manager"] }, isActive: true },
        select: { id: true },
      })
      await Promise.allSettled(
        recipients.map((r: { id: string }) =>
          createNotification({
            organizationId: orgId,
            userId: r.id,
            type: "info",
            title: `New contract request: ${form.name}`,
            message: `A contract intake request has been submitted. A draft contract has been created and is awaiting processing.`,
            entityType: "contract",
            entityId: contractId,
            kind: "contract.approval_requested",
          }),
        ),
      )
    } catch {
      // Best-effort — never fail the submission on notification error
    }

    // ─── 10. Audit log ───────────────────────────────────────────────────────
    await prisma.auditLog
      .create({
        data: {
          organizationId: orgId,
          userId,
          action: "create",
          entityType: "contract",
          entityId: contractId,
          entityName: String(contractPatch.title ?? `${form.name} Request`),
          newValue: {
            source: "intake_form",
            formId,
            formName: form.name,
            contractStatus,
            autoRouted: shouldAutoRoute,
            stages: shouldAutoRoute ? resolvedStages.length : 0,
          },
        },
      })
      .catch(() => {})

    return NextResponse.json(
      {
        success: true,
        data: {
          submissionId: submission.id,
          contractId,
          contractStatus,
          autoRouted: shouldAutoRoute,
          stagesCreated: shouldAutoRoute ? resolvedStages.length : 0,
        },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error("[contract-intake-forms submit]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look for a foreign-key candidate in responses:
 * 1. Via the field mapping (questionId → fieldName === targetField).
 * 2. Directly as a response key named targetField.
 * Returns the candidate id string or null.
 */
function findForeignIdInResponses(
  responses: Record<string, unknown>,
  mapping: Record<string, string>,
  targetField: string,
): string | null {
  // Via mapping
  for (const [qId, fieldName] of Object.entries(mapping)) {
    if (fieldName === targetField) {
      const val = responses[qId]
      if (typeof val === "string" && val.length > 0) return val
    }
  }
  // Directly in responses
  const direct = responses[targetField]
  if (typeof direct === "string" && direct.length > 0) return direct
  return null
}
