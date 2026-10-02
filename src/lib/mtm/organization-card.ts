/**
 * What the "Details" tab of an MTM organization card has to show beyond the
 * organization's own contact data.
 *
 * The card was built against a pharma master-data reference: licence, medical
 * category, territory polygon, imported shipments. On production (2026-10-02)
 * only the demo tenant fills any of it — every real tenant keeps an address, a
 * phone and a contact person — yet the tab printed a row of dashes per unused
 * attribute and never showed the phone or the contact person at all. Reference
 * attributes are therefore listed only for an organization that has them: a
 * tenant that imports master data sees it, everybody else sees contacts.
 */

export type OrganizationReferenceKey =
  | "specialization"
  | "category"
  | "license"
  | "attributeSource"
  | "region"
  | "administrativeDistrict"
  | "territory"
  | "polygon"

/** `value` is null where the label alone is the fact (a configured polygon). */
export type OrganizationReferenceRow = { key: OrganizationReferenceKey; value: string | null }

type ReferenceSource = {
  specialization: string | null
  region: string | null
  administrativeDistrict: string | null
  territoryCode: string | null
  polygon: unknown
  attributeFacts: Array<{
    medicalCategoryCode: string | null
    licenseStatus: string | null
    package: { version: number; sourceSystem: string }
  }>
}

type CommercialSource = {
  monthTotals: unknown[]
  yearTotals: unknown[]
  latestSource: unknown
}

function filled(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** Reference attributes this organization actually carries, in display order. */
export function organizationReferenceRows(organization: ReferenceSource): OrganizationReferenceRow[] {
  const fact = organization.attributeFacts[0] ?? null
  const candidates: Array<[OrganizationReferenceKey, string | null]> = [
    ["specialization", filled(organization.specialization)],
    ["category", filled(fact?.medicalCategoryCode)],
    ["license", filled(fact?.licenseStatus)],
    ["attributeSource", fact ? `${fact.package.sourceSystem} · v${fact.package.version}` : null],
    ["region", filled(organization.region)],
    ["administrativeDistrict", filled(organization.administrativeDistrict)],
    ["territory", filled(organization.territoryCode)],
  ]
  const rows: OrganizationReferenceRow[] = candidates.flatMap(([key, value]) => (value ? [{ key, value }] : []))
  if (organization.polygon) rows.push({ key: "polygon", value: null })
  return rows
}

/** True once a shipment document was ever imported for the organization. */
export function hasCommercialFacts(commercial: CommercialSource | null | undefined): boolean {
  return Boolean(commercial && (commercial.latestSource || commercial.monthTotals.length || commercial.yearTotals.length))
}
