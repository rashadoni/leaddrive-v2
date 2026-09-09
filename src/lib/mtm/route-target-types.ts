export type MtmRouteTargetDirection = "DOCTOR" | "PHARMACY" | "ORGANIZATION"
export type MtmRouteTargetObjectType = "PHARMACY" | "CLINIC" | "STORE" | "OTHER"

export type MtmRouteTargetType = {
  id: string
  labels: { az: string; ru: string; en: string }
  direction: MtmRouteTargetDirection
  objectType: MtmRouteTargetObjectType | null
  organizationKind: string | null
  enabled: boolean
}

// This is a picker scope, not a business category. It must always be present
// so a planner never mistakes a category-filtered list for the whole catalogue.
// Server-side assignment and role checks still define which records it returns.
export const MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS: MtmRouteTargetType = {
  id: "all-customers",
  labels: { az: "Bütün müştərilər", ru: "Все клиенты", en: "All customers" },
  direction: "ORGANIZATION",
  objectType: null,
  organizationKind: null,
  enabled: true,
}

export const MTM_ROUTE_TARGET_TYPE_DEFAULTS: MtmRouteTargetType[] = [
  MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS,
  {
    id: "doctors",
    labels: { az: "Həkimlər", ru: "Врачи", en: "Doctors" },
    direction: "DOCTOR",
    objectType: null,
    organizationKind: null,
    enabled: true,
  },
  {
    id: "pharmacies",
    labels: { az: "Apteklər", ru: "Аптеки", en: "Pharmacies" },
    direction: "PHARMACY",
    objectType: "PHARMACY",
    organizationKind: null,
    enabled: true,
  },
  {
    id: "clinics",
    labels: { az: "Klinikalar", ru: "Клиники", en: "Clinics" },
    direction: "ORGANIZATION",
    objectType: "CLINIC",
    organizationKind: null,
    enabled: true,
  },
  {
    id: "organizations",
    labels: { az: "Digər təşkilatlar", ru: "Другие организации", en: "Other organizations" },
    direction: "ORGANIZATION",
    objectType: "OTHER",
    organizationKind: null,
    enabled: true,
  },
]

const idPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/
const objectTypes = new Set<MtmRouteTargetObjectType>(["PHARMACY", "CLINIC", "STORE", "OTHER"])
const directions = new Set<MtmRouteTargetDirection>(["DOCTOR", "PHARMACY", "ORGANIZATION"])

export function routeTargetLabel(target: MtmRouteTargetType, locale: string): string {
  if (locale === "az") return target.labels.az
  if (locale === "en") return target.labels.en
  return target.labels.ru
}

export function parseMtmRouteTargetTypes(raw: unknown):
  | { success: true; data: MtmRouteTargetType[] }
  | { success: false; error: string } {
  if (!Array.isArray(raw)) return { success: false, error: "Route target types must be an array" }
  if (raw.length < 1 || raw.length > 20) return { success: false, error: "Configure between 1 and 20 route target types" }

  const result: MtmRouteTargetType[] = []
  const ids = new Set<string>()
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { success: false, error: "Every route target type must be an object" }
    }
    const entry = value as Record<string, unknown>
    const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : ""
    if (!idPattern.test(id) || ids.has(id)) return { success: false, error: "Route target type IDs must be unique" }
    ids.add(id)

    const labelsValue = entry.labels
    if (!labelsValue || typeof labelsValue !== "object" || Array.isArray(labelsValue)) {
      return { success: false, error: "Every route target type needs labels" }
    }
    const labelsRecord = labelsValue as Record<string, unknown>
    const labels = {
      az: typeof labelsRecord.az === "string" ? labelsRecord.az.trim() : "",
      ru: typeof labelsRecord.ru === "string" ? labelsRecord.ru.trim() : "",
      en: typeof labelsRecord.en === "string" ? labelsRecord.en.trim() : "",
    }
    if (Object.values(labels).some((label) => label.length < 1 || label.length > 60)) {
      return { success: false, error: "Route target labels must contain 1 to 60 characters" }
    }

    const direction = entry.direction as MtmRouteTargetDirection
    if (!directions.has(direction)) return { success: false, error: "Invalid route target source" }
    const objectType = entry.objectType == null || entry.objectType === ""
      ? null
      : entry.objectType as MtmRouteTargetObjectType
    if (objectType && !objectTypes.has(objectType)) return { success: false, error: "Invalid organization type" }
    const organizationKind = entry.organizationKind == null || entry.organizationKind === ""
      ? null
      : typeof entry.organizationKind === "string" ? entry.organizationKind.trim() : ""
    if (organizationKind && organizationKind.length > 120) return { success: false, error: "Organization kind is too long" }
    if (typeof entry.enabled !== "boolean") return { success: false, error: "Route target enabled state must be a boolean" }

    result.push({
      id,
      labels,
      direction,
      objectType: direction === "DOCTOR" ? null : objectType,
      organizationKind: direction === "DOCTOR" ? null : organizationKind || null,
      enabled: entry.enabled,
    })
  }
  if (!result.some((entry) => entry.enabled)) return { success: false, error: "At least one route target type must be enabled" }
  return { success: true, data: result }
}

export function coerceMtmRouteTargetTypes(raw: unknown): MtmRouteTargetType[] {
  const parsed = parseMtmRouteTargetTypes(raw)
  const configured = (parsed.success ? parsed.data : MTM_ROUTE_TARGET_TYPE_DEFAULTS).map((entry) => ({
    ...entry,
    labels: { ...entry.labels },
  }))

  // Older tenants saved only the category tabs (doctors, pharmacies,
  // clinics, other organizations). Keep their category customizations, but
  // add a stable unfiltered entry at the beginning. Otherwise stores and
  // newly introduced organization types can look as if they have disappeared.
  const configuredAllCustomers = configured.find((entry) => entry.id === MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS.id)
  const allCustomers: MtmRouteTargetType = configuredAllCustomers
    ? {
      ...configuredAllCustomers,
      direction: "ORGANIZATION",
      objectType: null,
      organizationKind: null,
      enabled: true,
    }
    : {
      ...MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS,
      labels: { ...MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS.labels },
    }

  return [
    allCustomers,
    ...configured.filter((entry) => entry.id !== MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS.id),
  ]
}
