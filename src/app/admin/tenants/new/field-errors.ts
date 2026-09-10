/**
 * Where a rejected field lives on the new-tenant wizard.
 *
 * The provisioning API answers with the field path it validated
 * (`primaryBrand.website: Invalid URL`). That is not what the screen calls the
 * box, and the wizard posts five steps at once — so the admin is left hunting.
 * Map the path back to the wizard's own label and the step holding it.
 */
const FIELD_LOCATIONS: Record<string, { step: number; field: string }> = {
  "primaryBrand.name": { step: 2, field: "Primary brand" },
  "primaryBrand.legalName": { step: 2, field: "Legal entity" },
  "primaryBrand.website": { step: 2, field: "Official website" },
  "primaryBrand.supportEmail": { step: 2, field: "Support email" },
  "primaryBrand.aliases": { step: 2, field: "Aliases" },
  "primaryBrand.languages": { step: 2, field: "Languages" },
  "primaryBrand.geographies": { step: 2, field: "Markets" },
  "primaryBrand.voice": { step: 2, field: "AI voice" },
  "primaryBrand.description": { step: 2, field: "Brand description" },
  "primaryBrand.customInstructions": { step: 2, field: "Additional AI instructions" },
  channels: { step: 3, field: "Channels" },
  providers: { step: 3, field: "Providers" },
}

export type LocatedFieldError = {
  /** Index into the wizard's STEPS. */
  step: number
  /** The label the wizard prints above the input. */
  field: string
  /** What the API said was wrong with it. */
  reason: string
}

/**
 * Read a `path: reason` API rejection. Returns null for anything else — a
 * server message that is not about one input is shown as it arrived, never
 * dressed up as a field error.
 */
export function locateFieldError(message: string): LocatedFieldError | null {
  const separator = message.indexOf(": ")
  if (separator < 0) return null
  // `channels.1` and `primaryBrand.languages.0` point at the same input as
  // their parent; the index is noise to someone looking at the form.
  const path = message
    .slice(0, separator)
    .split(".")
    .filter((segment) => !/^\d+$/.test(segment))
    .join(".")
  const location = FIELD_LOCATIONS[path]
  if (!location) return null
  return { ...location, reason: message.slice(separator + 2) }
}
