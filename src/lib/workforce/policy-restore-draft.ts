import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { WorkforcePolicyCalculationDefinitionSchema, canonicalWorkforcePolicyJson, workforcePolicyDefinitionHash } from "./policy-definition"
import { createWorkforcePolicyDraftRow, workforcePolicyScopeLock } from "./policy-draft-write"
import type { WorkforceConfigurationAuditContext } from "./configuration-management"

const id = z.string().min(1).max(191).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value))
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.number().int().positive().refine(Number.isSafeInteger)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isDateKey)
export const WorkforcePolicyRestoreSourceIdSchema = id
export const WorkforcePolicyRestoreDraftSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/),
  expectedSourceVersion: version,
  expectedSourceDefinitionHash: hash,
  name: z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  effectiveFrom: date,
}).strict()
export type WorkforcePolicyRestoreDraft = z.infer<typeof WorkforcePolicyRestoreDraftSchema>
const action = "WORKFORCE_POLICY_RESTORED_AS_DRAFT"
const entity = "workforce_policy_restore_operation"

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1), requestHash: hash, organizationId: id, operationId: WorkforcePolicyRestoreDraftSchema.shape.operationId,
  source: z.object({ id, version, definitionHash: hash }).strict(),
  result: z.object({ id, teamId: id.nullable(), version, createdByUserId: id,
    createdAt: z.string().datetime(), statusAtCreation: z.literal("DRAFT"), provenanceAtCreation: z.literal("TENANT_ADMIN"),
    name: WorkforcePolicyRestoreDraftSchema.shape.name, effectiveFrom: date, effectiveTo: z.null(), definitionHash: hash }).strict(),
}).strict()
type Receipt = z.infer<typeof ReceiptSchema>

export class WorkforcePolicyRestoreError extends Error {
  constructor(readonly code:
    | "WORKFORCE_POLICY_RESTORE_INPUT_INVALID" | "WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE"
    | "WORKFORCE_POLICY_RESTORE_SOURCE_CHANGED" | "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID"
    | "WORKFORCE_POLICY_RESTORE_NOT_FUTURE" | "WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT") { super(code) }
}
const integrity = () => new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID")

export function workforcePolicyRestoreRequestHash(organizationId: string, sourceId: string, draft: WorkforcePolicyRestoreDraft): string {
  return createHash("sha256").update(canonicalWorkforcePolicyJson({ organizationId, sourceId, ...draft })).digest("hex")
}

const anchorSelect = { id: true, organizationId: true, teamId: true, version: true, restoreOperationId: true,
  restoreRequestHash: true, createdByUserId: true, createdAt: true } as const
const sourceSelect = { id: true, organizationId: true, teamId: true, version: true, status: true,
  definition: true, definitionHash: true } as const

async function readOperation(tx: Prisma.TransactionClient, organizationId: string, operationId: string) {
  const anchor = await tx.workforcePolicy.findFirst({ where: { organizationId, restoreOperationId: operationId }, select: anchorSelect })
  const audits = await tx.mtmAuditLog.findMany({ where: { organizationId, action, entity, entityId: operationId },
    select: { organizationId: true, entityId: true, metadataKind: true, actorUserId: true, newData: true }, take: 2 })
  if (audits.length > 1) throw integrity()
  const audit = audits[0]
  const parsed = audit == null ? null : ReceiptSchema.safeParse(audit.newData)
  if (parsed && (!parsed.success || audit.organizationId !== parsed.data.organizationId
    || audit.entityId !== parsed.data.operationId || audit.metadataKind !== "workforce_configuration"
    || audit.actorUserId !== parsed.data.result.createdByUserId)) throw integrity()
  return { anchor, receipt: parsed?.success ? parsed.data : null }
}

function response(receipt: Receipt, replayed: boolean) {
  return { schemaVersion: 1 as const, basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE" as const, replayed,
    creation: { policyId: receipt.result.id, teamId: receipt.result.teamId, version: receipt.result.version,
      name: receipt.result.name, effectiveFrom: receipt.result.effectiveFrom, effectiveTo: null,
      definitionHash: receipt.result.definitionHash, createdAt: receipt.result.createdAt,
      statusAtCreation: "DRAFT" as const, sourcePolicyId: receipt.source.id, sourceVersion: receipt.source.version } }
}

/** Copies one recorded published definition; it never activates or edits historical facts. */
export async function restoreWorkforcePolicyAsDraft(input: {
  organizationId: string; sourcePolicyId: string; draft: WorkforcePolicyRestoreDraft
  audit: WorkforceConfigurationAuditContext; db?: PrismaClient
}) {
  const parsed = WorkforcePolicyRestoreDraftSchema.safeParse(input.draft)
  if (!parsed.success || !id.safeParse(input.sourcePolicyId).success || !id.safeParse(input.organizationId).success
    || !id.safeParse(input.audit.actorUserId).success) throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_INPUT_INVALID")
  const draft = parsed.data, requestHash = workforcePolicyRestoreRequestHash(input.organizationId, input.sourcePolicyId, draft)
  const db: PrismaClient = input.db ?? prisma
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true), set_config('statement_timeout', '10s', true)`
    const initial = await readOperation(tx, input.organizationId, draft.operationId)
    const source = initial.anchor || initial.receipt ? null : await tx.workforcePolicy.findFirst({
      where: { organizationId: input.organizationId, id: input.sourcePolicyId }, select: sourceSelect,
    })
    if (!initial.anchor && !initial.receipt && !source) throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE")
    const teamId = initial.anchor ? initial.anchor.teamId : initial.receipt ? initial.receipt.result.teamId : source!.teamId
    const scopeLock = workforcePolicyScopeLock(input.organizationId, teamId)
    const operationLock = ["workforce-policy-restore", input.organizationId, draft.operationId].join(":")
    for (const lock of [scopeLock, operationLock].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`
    const current = await readOperation(tx, input.organizationId, draft.operationId)
    if (current.anchor || current.receipt) {
      const { anchor, receipt } = current
      if (!anchor || !receipt) throw integrity()
      if (anchor.restoreRequestHash !== requestHash || receipt.requestHash !== requestHash) {
        throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT")
      }
      if (anchor.organizationId !== input.organizationId || receipt.organizationId !== input.organizationId
        || anchor.restoreOperationId !== draft.operationId || receipt.operationId !== draft.operationId
        || anchor.id !== receipt.result.id || anchor.teamId !== receipt.result.teamId || anchor.teamId !== teamId
        || anchor.version !== receipt.result.version || anchor.createdByUserId !== receipt.result.createdByUserId
        || anchor.createdAt.toISOString() !== receipt.result.createdAt
        || receipt.source.id !== input.sourcePolicyId || receipt.source.version !== draft.expectedSourceVersion
        || receipt.source.definitionHash !== draft.expectedSourceDefinitionHash
        || receipt.result.definitionHash !== draft.expectedSourceDefinitionHash
        || receipt.result.name !== draft.name || receipt.result.effectiveFrom !== draft.effectiveFrom) throw integrity()
      // No live status/content or today's date is represented by a creation receipt.
      return response(receipt, true)
    }
    // Re-read the source after locking, never copy a pre-lock definition.
    const published = await tx.workforcePolicy.findFirst({ where: { organizationId: input.organizationId, id: input.sourcePolicyId }, select: sourceSelect })
    if (!published || !["ACTIVE", "RETIRED"].includes(published.status)) throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE")
    if (published.teamId !== teamId || published.version !== draft.expectedSourceVersion
      || published.definitionHash.toLowerCase() !== draft.expectedSourceDefinitionHash) throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_SOURCE_CHANGED")
    const definition = WorkforcePolicyCalculationDefinitionSchema.safeParse(published.definition)
    if (!definition.success || workforcePolicyDefinitionHash(definition.data) !== draft.expectedSourceDefinitionHash) throw integrity()
    const setting: { value: unknown } | null = await tx.mtmSetting.findFirst({ where: { organizationId: input.organizationId, key: "timezone" }, select: { value: true } })
    const configured = typeof setting?.value === "string" ? setting.value : MTM_SETTING_DEFAULTS.timezone
    const timezone = isValidTimezone(configured) ? configured : "UTC"
    const observedAt = new Date()
    if (draft.effectiveFrom <= currentDateKey(observedAt, timezone)) throw new WorkforcePolicyRestoreError("WORKFORCE_POLICY_RESTORE_NOT_FUTURE")
    const policy = await createWorkforcePolicyDraftRow(tx, { organizationId: input.organizationId, teamId,
      createdByUserId: input.audit.actorUserId, name: draft.name, effectiveFrom: draft.effectiveFrom, effectiveTo: null,
      definition: JSON.parse(canonicalWorkforcePolicyJson(definition.data)) as Prisma.InputJsonValue,
      definitionHash: draft.expectedSourceDefinitionHash, restoreAnchor: { operationId: draft.operationId, requestHash } })
    const receipt: Receipt = { schemaVersion: 1, organizationId: input.organizationId, operationId: draft.operationId, requestHash,
      source: { id: published.id, version: published.version, definitionHash: draft.expectedSourceDefinitionHash },
      result: { id: policy.id, teamId, version: policy.version, createdByUserId: input.audit.actorUserId,
        createdAt: policy.createdAt.toISOString(), statusAtCreation: "DRAFT", provenanceAtCreation: "TENANT_ADMIN",
        name: draft.name, effectiveFrom: draft.effectiveFrom, effectiveTo: null, definitionHash: policy.definitionHash } }
    await tx.mtmAuditLog.create({ data: { organizationId: input.organizationId, agentId: null, actorUserId: input.audit.actorUserId,
      action, entity, entityId: draft.operationId, metadataKind: "workforce_configuration", newData: receipt,
      ipAddress: input.audit.ipAddress ?? null, userAgent: input.audit.userAgent ?? null } })
    return response(receipt, false)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 20_000 })
}
