import { filterWritableFields } from "@/lib/field-filter"
import { CrmCommandError } from "./errors"

/**
 * Legacy routes commonly drop non-editable fields. Commands must fail closed:
 * the confirmed receipt and the committed mutation must describe the same keys.
 */
export function requireWritableFields<T extends Record<string, unknown>>(
  input: T,
  permissions: Record<string, string>,
  role: string,
): T {
  const writable = filterWritableFields(input, permissions, role) as Partial<T>
  const rejectedFields = Object.keys(input).filter((key) =>
    !Object.prototype.hasOwnProperty.call(writable, key),
  )
  if (rejectedFields.length > 0) {
    throw new CrmCommandError(
      "FORBIDDEN_FIELD",
      `Fields are not editable: ${rejectedFields.join(", ")}`,
      403,
      { fields: rejectedFields },
    )
  }
  return writable as T
}
