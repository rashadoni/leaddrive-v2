import type { Prisma } from "@prisma/client"

/** The existing scope lock is shared by creation, editing and activation. */
export function workforcePolicyScopeLock(organizationId: string, teamId: string | null): string {
  return ["workforce-configuration", organizationId, "policy", teamId ?? "organization"].join(":")
}

/** Caller holds the exact scope advisory lock inside this tenant transaction. */
export async function createWorkforcePolicyDraftRow(tx: Prisma.TransactionClient, input: {
  organizationId: string
  teamId: string | null
  createdByUserId: string
  name: string
  effectiveFrom: string
  effectiveTo: string | null
  definition: Prisma.InputJsonValue
  definitionHash: string
  restoreAnchor?: { operationId: string; requestHash: string }
}) {
  const latest = await tx.workforcePolicy.findFirst({
    where: { organizationId: input.organizationId, teamId: input.teamId },
    orderBy: { version: "desc" }, select: { version: true },
  })
  return tx.workforcePolicy.create({
    data: {
      organizationId: input.organizationId, teamId: input.teamId,
      version: (latest?.version ?? 0) + 1, status: "DRAFT", name: input.name,
      effectiveFrom: new Date(input.effectiveFrom + "T00:00:00.000Z"),
      effectiveTo: input.effectiveTo == null ? null : new Date(input.effectiveTo + "T00:00:00.000Z"),
      definition: input.definition, definitionHash: input.definitionHash,
      provenance: "TENANT_ADMIN", systemProfileVersion: null, createdByUserId: input.createdByUserId,
      ...(input.restoreAnchor ? { restoreOperationId: input.restoreAnchor.operationId, restoreRequestHash: input.restoreAnchor.requestHash } : {}),
    },
    // Preserve the legacy creator's exact return projection.
    select: { id: true, teamId: true, version: true, status: true, name: true,
      effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true,
      createdAt: true, updatedAt: true },
  })
}
