import type { Prisma } from "@prisma/client"
import { BUILDER_FIELDS } from "./catalog"
import { BuilderEvaluationError } from "./engine"
import type { BuilderSourceReader } from "./source"

/** Concrete adapter for the same tenant transaction that owns a CRM mutation. */
export function prismaBuilderSourceReader(tx: Pick<Prisma.TransactionClient, "company" | "contact" | "deal" | "customFieldValue">): BuilderSourceReader {
  return {
    find: async (entity, input) => {
      const allowed = BUILDER_FIELDS.filter((entry) => entry.entity === entity).map((entry) => entry.key.split(".")[1])
      if (input.fields.some((key) => key !== "organizationId" && !allowed.includes(key))) throw new BuilderEvaluationError("unregistered_source_field")
      const where = { id: input.id, organizationId: input.organizationId }
      const select = Object.fromEntries(input.fields.map((key) => [key, true]))
      const result = entity === "company" ? await tx.company.findFirst({ where, select }) : entity === "contact" ? await tx.contact.findFirst({ where, select }) : await tx.deal.findFirst({ where, select })
      return result as Record<string, unknown> | null
    },
    customValues: (input) => tx.customFieldValue.findMany({ where: { organizationId: input.organizationId, entityId: input.entityId, fieldId: { in: [...input.fieldIds] } }, select: { fieldId: true, value: true } }),
  }
}
