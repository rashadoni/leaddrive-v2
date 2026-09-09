export type WhatsAppTemplateConfig = {
  name: string
  languageCode?: string
  variables?: Record<string, string> | string[]
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function getTruthyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function getStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null
}

function getStringRecord(value: unknown): Record<string, string> | null {
  if (!isObjectRecord(value)) return null
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(value)) {
    out[key] = typeof val === "string" ? val : String(val ?? "")
  }
  return out
}

export function parseWhatsAppTemplateConfig(flowData: unknown): WhatsAppTemplateConfig | null {
  if (!isObjectRecord(flowData)) return null
  const nested = isObjectRecord(flowData.whatsappTemplate) ? flowData.whatsappTemplate : null
  const directName =
    getTruthyString(flowData.whatsappTemplate) ||
    getTruthyString(flowData.whatsappTemplateName) ||
    getTruthyString(flowData.templateName)
  const name = getTruthyString(nested?.name) || directName
  if (!name) return null

  const rawVariables = nested?.variables ?? flowData.whatsappTemplateVariables ?? flowData.templateVariables
  const variables = getStringArray(rawVariables) ?? getStringRecord(rawVariables) ?? undefined
  return {
    name,
    languageCode:
      getTruthyString(nested?.languageCode) ||
      getTruthyString(flowData.whatsappTemplateLanguage) ||
      getTruthyString(flowData.languageCode) ||
      undefined,
    variables,
  }
}
