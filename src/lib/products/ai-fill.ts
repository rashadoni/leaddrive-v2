/**
 * «AI ilə doldur» on a product (task 5; mockup accepted 2026-10-26): from the
 * product's name, the model proposes a description, category, type, features
 * and tags — in Azerbaijani, like the rest of the owner's screens. Never a
 * price or a SKU: the model cannot know them, and an invented price is worse
 * than an empty one. When the name does not say what the product is, the
 * model says so instead of guessing.
 *
 * The answer is a forced tool call with closed enums, read field by field, so
 * the form only ever receives values it can show. Same Claude as Da Vinci,
 * under the organization's AI budget, logged to ai_interaction_logs.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { checkAiBudget, resolveAiModel } from "@/lib/ai/budget"
import { LINE_TYPES } from "@/lib/cpq/line-types"

export const PRODUCT_CATEGORIES = ["service", "product", "addon", "consulting"] as const

export interface ProductCardSuggestion {
  description: string | null
  category: (typeof PRODUCT_CATEGORIES)[number] | null
  productType: (typeof LINE_TYPES)[number] | null
  features: string[]
  tags: string[]
  /** Set when the name did not say enough; the fields it could not fill stay empty. */
  unclear: string | null
}

const TOOL: Anthropic.Tool = {
  name: "product_card",
  description: "Return the product card fields. Leave a field empty rather than guess.",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "2-3 plain sentences in Azerbaijani: what it is, what it is for. No price, no marketing superlatives. Empty if unclear." },
      category: { type: "string", enum: [...PRODUCT_CATEGORIES, ""], description: "service, product (a physical or packaged good), addon (an add-on to another product) or consulting. Empty if unclear." },
      productType: { type: "string", enum: [...LINE_TYPES, ""], description: "hardware, license, subscription, service or other. Empty if unclear." },
      features: { type: "array", items: { type: "string" }, maxItems: 6, description: "Short Azerbaijani facts taken from the name (dose, pack size, term, capacity…), at most 6." },
      tags: { type: "array", items: { type: "string" }, maxItems: 5, description: "Lower-case search words, at most 5." },
      unclear: { type: "string", description: "In Azerbaijani: what is missing to describe it, when the name is too vague. Empty otherwise." },
    },
    required: ["description", "category", "productType", "features", "tags", "unclear"],
  },
}

const answerSchema = z.object({
  description: z.string().max(1200).catch(""),
  category: z.string().catch(""),
  productType: z.string().catch(""),
  features: z.array(z.string()).catch([]),
  tags: z.array(z.string()).catch([]),
  unclear: z.string().max(400).catch(""),
})

const clean = (items: string[], max: number, length: number) =>
  [...new Set(items.map((item) => item.replace(/[,\n]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).map((item) => item.slice(0, length)))].slice(0, max)

/** The model's answer, as values the form can take. Exported for its test. */
export function readProductCard(input: unknown): ProductCardSuggestion {
  const answer = answerSchema.parse(input ?? {})
  const category = (PRODUCT_CATEGORIES as readonly string[]).includes(answer.category) ? answer.category as ProductCardSuggestion["category"] : null
  const productType = (LINE_TYPES as readonly string[]).includes(answer.productType) ? answer.productType as ProductCardSuggestion["productType"] : null
  return {
    description: answer.description.trim() || null,
    category,
    productType,
    features: clean(answer.features, 6, 80),
    tags: clean(answer.tags, 5, 40).map((tag) => tag.toLocaleLowerCase("az")),
    unclear: answer.unclear.trim() || null,
  }
}

export class AiFillUnavailableError extends Error {
  constructor(readonly code: "BUDGET" | "NO_ANSWER") {
    super(code)
    this.name = "AiFillUnavailableError"
  }
}

export async function suggestProductCard(input: { orgId: string; name: string; client?: Pick<Anthropic, "messages"> }): Promise<ProductCardSuggestion> {
  const budget = await checkAiBudget(input.orgId)
  if (!budget.allowed) throw new AiFillUnavailableError("BUDGET")
  const client = input.client ?? getAnthropicClient()
  const model = resolveAiModel(undefined)
  const started = Date.now()
  const response = await client.messages.create({
    model,
    max_tokens: 700,
    system: "You fill a product card in a CRM used by companies in Azerbaijan. Work only from the product name you are given and general knowledge of what such a product is. Write in Azerbaijani. Never state a price, a SKU, a supplier or a stock level. If the name does not make clear what the product is, leave the fields empty and say what is missing in `unclear`.",
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: `Product name: ${input.name.slice(0, 300)}` }],
  })
  const call = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
  if (!call) throw new AiFillUnavailableError("NO_ANSWER")
  const card = readProductCard(call.input)

  const promptTokens = response.usage?.input_tokens ?? 0
  const completionTokens = response.usage?.output_tokens ?? 0
  await prisma.aiInteractionLog.create({
    data: {
      organizationId: input.orgId,
      userMessage: input.name.slice(0, 500),
      aiResponse: (card.description ?? card.unclear ?? "").slice(0, 1000),
      model,
      latencyMs: Date.now() - started,
      promptTokens,
      completionTokens,
      costUsd: (promptTokens * 0.003 + completionTokens * 0.015) / 1000,
      toolsCalled: [TOOL.name],
      agentType: "product_fill",
    },
  }).catch(() => undefined)
  return card
}
