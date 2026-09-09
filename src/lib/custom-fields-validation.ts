import { prisma } from "@/lib/prisma"

export type CustomFieldEntityType = "task" | "contact" | "deal" | "lead" | "company"

/**
 * Validates that all active+required CustomField definitions for the given
 * entity have a non-empty value in `finalCustomFields`.
 *
 * Returns:
 *  - null     → all required fields satisfied
 *  - string   → human-readable error message naming the first missing field
 *
 * "Empty" means: undefined, null, "", or empty array.
 * "Non-empty" includes: any string with content, any number (including 0),
 * any boolean (including false), any object/array with at least one element.
 *
 * IMPORTANT: This validates the FINAL state (after merging incoming patch
 * with existing customFields). Callers must pass the post-merge object,
 * not just the incoming patch.
 *
 * Usage:
 *   - CREATE: always call with the incoming customFields (new tasks start empty)
 *   - UPDATE: only call when the operation touches customFields (otherwise
 *             validation could trip pre-existing tasks that miss a field
 *             added as required AFTER they were created)
 *   - BULK update_custom_field: only call when the operation would clear
 *             a required field (e.g. setting it to null)
 */
export async function validateRequiredCustomFields(
  orgId: string,
  entityType: CustomFieldEntityType,
  finalCustomFields: Record<string, unknown>,
): Promise<string | null> {
  const requiredDefs = await prisma.customField.findMany({
    where: { organizationId: orgId, entityType, isActive: true, isRequired: true },
    select: { fieldName: true, fieldLabel: true },
  })

  for (const def of requiredDefs) {
    const v = finalCustomFields?.[def.fieldName]
    const isEmpty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    if (isEmpty) {
      return `Field "${def.fieldLabel}" is required`
    }
  }
  return null
}
