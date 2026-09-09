import { getAnthropicClient } from "./anthropic-client"
import { PiiMasker } from "./pii-masker"

const INTENT_CATEGORIES = [
  "sales_inquiry",    // Product questions, pricing, discounts
  "support_request",  // Issues, bugs, complaints
  "billing_question", // Payments, invoices, subscriptions
  "marketing_info",   // Marketing reports, campaigns
  "data_analysis",    // Analytics, forecasts, dashboards
  "general",          // General questions, greetings
] as const

export type Intent = typeof INTENT_CATEGORIES[number]

export async function classifyIntent(message: string): Promise<{
  intent: Intent
  confidence: number
}> {
  try {
    const client = getAnthropicClient()
    const piiMasker = new PiiMasker()
    const maskedMessage = piiMasker.mask(message)

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: `You are an intent classifier for a CRM system. Classify the user message into ONE of these categories:
${INTENT_CATEGORIES.join(", ")}

Respond ONLY with JSON: {"intent": "category", "confidence": 0.0-1.0}`,
      messages: [{ role: "user", content: maskedMessage }],
    })

    const text = response.content[0].type === "text" ? response.content[0].text : ""
    const parsed = JSON.parse(text)
    if (INTENT_CATEGORIES.includes(parsed.intent)) {
      return { intent: parsed.intent, confidence: parsed.confidence ?? 0.8 }
    }
    return { intent: "general", confidence: 0.5 }
  } catch {
    return { intent: "general", confidence: 0.5 }
  }
}
