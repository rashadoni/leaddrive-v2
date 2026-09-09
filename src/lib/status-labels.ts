"use client"

/**
 * Enum-label resolver (i18n root #1 — enum-bypass).
 *
 * Pages historically hardcoded English `*_LABELS` maps and rendered raw enum
 * values (`{item.category}`, `{item.priority}`, `{item.status}`), bypassing the
 * dictionary — so those labels never localized to az/ru. This util resolves a
 * *known* enum value to its localized label from existing dictionary keys, and
 * returns the raw value for unknown ones (so a free-form column never renders a
 * dotted key path).
 *
 * Dict-key convention: `<prefix><Pascal>` (e.g. status "in_progress" →
 * `statusInProgress`, category "partner" → `categoryPartner`, priority "high" →
 * `priorityHigh`). snake_case / kebab-case values are camel-joined.
 *
 * Why "known values" instead of probing the dictionary: next-intl's CLIENT
 * `t.has()` is a stub that always returns `true`
 * (use-intl/dist/.../react.js:226 — `return true`), so a "does this key exist?"
 * gate is impossible client-side. Instead the caller declares the enum's value
 * set; known values translate, everything else falls back to raw.
 *
 * The pure helpers (`enumKey`, `categoryKey`, `pickEnumLabel`) are unit-tested;
 * the hooks just wire next-intl's `useTranslations` to them.
 */
import { useTranslations } from "next-intl"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

/** Loosely-typed translator (next-intl rejects computed keys; cast once). */
export type DynamicTranslator = (key: string) => string

/** snake_case / kebab-case → PascalCase. "in_progress" → "InProgress". */
function pascalize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
}

/** Build the `<prefix><Pascal>` dict key for an enum value. */
export function enumKey(prefix: string, value: string): string {
  return prefix + pascalize(value)
}

/** category<Pascal> convenience (companies/products/leads/contacts). */
export function categoryKey(value: string): string {
  return enumKey("category", value)
}

/**
 * Pure: localized label for a *known* enum value, else the raw value.
 * `known` is the set of values that have dictionary keys; `keyOf` builds the key.
 */
export function pickEnumLabel(
  t: DynamicTranslator,
  known: ReadonlySet<string>,
  keyOf: (value: string) => string,
  value: string,
): string {
  return known.has(value) ? t(keyOf(value)) : value
}

/**
 * Hook: returns a `(value) => label` resolver for an enum family in `namespace`,
 * keyed `<prefix><Pascal>`. Pass the known value set. Empty/nullish → "";
 * unknown value → the raw value (never a dotted key).
 *
 *   const statusLabel = useEnumLabel("invoices", "status", ["draft","sent","paid","overdue"])
 *   statusLabel(inv.status) // t("statusPaid") → "Ödənilib", or raw value
 */
export function useEnumLabel(
  namespace: string,
  prefix: string,
  knownValues: readonly string[],
): (value: string | null | undefined) => string {
  return useEnumLabelBy(namespace, (v) => enumKey(prefix, v), knownValues)
}

/**
 * Hook (lower-level): resolve enum values with a custom `keyOf` builder — for
 * namespaces whose dict uses a non-flat convention, e.g. nested `status.${value}`
 * (invoices/offers) instead of flat `<prefix><Pascal>`. Unknown value → raw.
 *
 *   const statusLabel = useEnumLabelBy("invoices", (v) => `status.${v}`, ["draft","paid",…])
 */
export function useEnumLabelBy(
  namespace: string,
  keyOf: (value: string) => string,
  knownValues: readonly string[],
): (value: string | null | undefined) => string {
  const t = useTranslations(namespace) as unknown as DynamicTranslator
  const known = new Set(knownValues)
  return (value) => (value ? pickEnumLabel(t, known, keyOf, value) : "")
}

/** Category convenience: `useEnumLabel(namespace, "category", knownValues)`. */
export function useCategoryLabel(
  namespace: string,
  knownValues: readonly string[],
): (value: string | null | undefined) => string {
  return useEnumLabel(namespace, "category", knownValues)
}

/** Translator that accepts interpolation values (next-intl rejects computed keys; cast once). */
type ParamTranslator = (key: string, values?: Record<string, string | number>) => string

/** Da Vinci recommendation `reasonKey` → `common` dict key. */
const DAVINCI_REASON_KEYS: Record<string, string> = {
  high: "davinciReasonHigh",
  good: "davinciReasonGood",
  upsell: "davinciReasonUpsell",
  base: "davinciReasonBase",
  dealProfile: "davinciReasonDealProfile",
}

/**
 * Hook: localized Da Vinci recommendation reason. The `/api/v1/ai/recommend`
 * endpoint returns a stable `reasonKey` + resolved `company` (the thresholds live
 * there); this resolves it against the `common` dictionary so the same response
 * localizes per-locale on every surface (contacts tab, deal Next-Best-Offers).
 * Unknown/missing key → `fallback` (e.g. the API's pre-rendered English `reason`).
 */
export function useDavinciReason(): (
  reasonKey: string | null | undefined,
  company?: string | null,
  fallback?: string,
) => string {
  const t = useTranslations("common") as unknown as ParamTranslator
  return (reasonKey, company, fallback) => {
    const dictKey = reasonKey ? DAVINCI_REASON_KEYS[reasonKey] : undefined
    if (!dictKey) return fallback ?? ""
    return t(dictKey, { company: company || t("davinciThisClient") })
  }
}

/**
 * Default pipeline-stage `name` → `deals` dict key (i18n root #2).
 * `Pipeline.stages[].displayName` is seeded in English (constants.ts
 * DEFAULT_PIPELINE_STAGES), so rendering displayName raw leaks English. The
 * stable UPPERCASE `name` maps to the dictionary instead.
 */
const STAGE_DICT_KEYS: Record<string, string> = {
  LEAD: "stageLead",
  QUALIFIED: "stageQualified",
  PROPOSAL: "stageProposal",
  NEGOTIATION: "stageNegotiation",
  WON: "stageWon",
  LOST: "stageLost",
}

/** Pure: deals dict key for a default stage `name`, or undefined for a custom stage. */
export function stageDictKey(name: string): string | undefined {
  return STAGE_DICT_KEYS[canonicalDealStage(name)]
}

/**
 * Hook: localized pipeline-stage label. Default stages (by stable `name`) resolve
 * from the `deals` dictionary; custom stages fall back to their user-authored
 * `displayName`, then the raw name. Replaces raw `displayName` renders on /deals.
 */
export function useStageLabel(): (name: string, displayName?: string | null) => string {
  const t = useTranslations("deals") as unknown as DynamicTranslator
  return (name, displayName) => {
    const key = stageDictKey(name)
    return key ? t(key) : (displayName || name)
  }
}
