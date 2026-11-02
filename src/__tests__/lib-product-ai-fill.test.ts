/**
 * «AI ilə doldur» on a product: the model's answer is read into values the form
 * can show — never a price or a SKU, never a category outside the list — and
 * the AI budget is asked before the model is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const budget = vi.hoisted(() => ({ allowed: true, logged: [] as unknown[] }))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: async () => ({ allowed: budget.allowed, spent: 0, limit: 1, remaining: 1 }),
  resolveAiModel: () => "claude-test",
}))
vi.mock("@/lib/prisma", () => ({ prisma: { aiInteractionLog: { create: async (args: unknown) => { budget.logged.push(args) } } } }))

import { AiFillUnavailableError, readProductCard, suggestProductCard } from "@/lib/products/ai-fill"

describe("reading the model's product card", () => {
  it("keeps only the categories and types the form has, and clean features and tags", () => {
    expect(readProductCard({
      description: " İbuprofen əsaslı ağrıkəsici. ",
      category: "product",
      productType: "medicine",
      features: ["200 mq", "200 mq", "10 tablet, qutu", ""],
      tags: ["Ağrıkəsici", "İbuprofen", "OTC", "a", "b", "c"],
      unclear: "",
      price: 4.5,
      sku: "NUR-200",
    })).toEqual({
      description: "İbuprofen əsaslı ağrıkəsici.",
      category: "product",
      productType: null,
      features: ["200 mq", "10 tablet qutu"],
      tags: ["ağrıkəsici", "ibuprofen", "otc", "a", "b"],
      unclear: null,
    })
  })

  it("says what is missing instead of guessing", () => {
    expect(readProductCard({ description: "", category: "", productType: "", features: [], tags: [], unclear: "Adda məhsulun nə olduğu görünmür." }))
      .toMatchObject({ description: null, category: null, productType: null, unclear: "Adda məhsulun nə olduğu görünmür." })
    expect(readProductCard(null)).toMatchObject({ description: null, features: [], tags: [] })
  })
})

describe("asking the model", () => {
  beforeEach(() => {
    budget.allowed = true
    budget.logged = []
  })

  it("forces the card tool, sends only the name, and logs the use", async () => {
    const calls: Record<string, unknown>[] = []
    const client = { messages: { create: async (params: Record<string, unknown>) => {
      calls.push(params)
      return { usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "tool_use", id: "t", name: "product_card", input: { description: "Ağrıkəsici.", category: "product", productType: "other", features: [], tags: [], unclear: "" } }] }
    } } }
    const card = await suggestProductCard({ orgId: "org-1", name: "Nurofen 200 mq, 10 tablet", client: client as never })

    expect(card).toMatchObject({ description: "Ağrıkəsici.", category: "product", productType: "other" })
    expect(calls[0]).toMatchObject({ tool_choice: { type: "tool", name: "product_card" }, messages: [{ role: "user", content: "Product name: Nurofen 200 mq, 10 tablet" }] })
    expect(budget.logged).toHaveLength(1)
  })

  it("does not call the model when the month's AI budget is spent", async () => {
    budget.allowed = false
    const create = vi.fn()
    await expect(suggestProductCard({ orgId: "org-1", name: "Nurofen", client: { messages: { create } } as never })).rejects.toBeInstanceOf(AiFillUnavailableError)
    expect(create).not.toHaveBeenCalled()
  })
})
