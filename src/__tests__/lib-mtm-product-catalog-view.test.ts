import { describe, expect, it } from "vitest"
import {
  agentsWhoSeeProductGroup,
  presentationKind,
  productGroupReadiness,
  productGroupShowings,
  productGroupTree,
  productNameFromFileName,
  type ProductCatalogGroup,
  type ProductCatalogProduct,
} from "@/lib/mtm/product-catalog-view"

const group = (id: string, parentId: string | null, agents: string[] = [], over: Partial<ProductCatalogGroup> = {}): ProductCatalogGroup => ({
  id, parentId, name: id, sortOrder: 0, members: agents.map((agentId) => ({ agentId, role: "AGENT" as const })), ...over,
})
const product = (groupId: string, over: Partial<ProductCatalogProduct> = {}): ProductCatalogProduct => ({
  id: `${groupId}-p`, groupId, isActive: true, document: { deletedAt: null }, _count: { presentationSessions: 0 }, ...over,
})

describe("the product catalog screen", () => {
  it("lists groups as their tree: parents first, subgroups under them, siblings by order then name", () => {
    const groups = [
      group("Kardio", null),
      group("Gastro kids", "Gastro"),
      group("Gastro", null, [], { sortOrder: -1 }),
      group("Gastro adults", "Gastro"),
      // Its parent is outside what this user sees: it stands at the top, not nowhere.
      group("Orphan", "hidden"),
    ]
    expect(productGroupTree(groups).map(({ group: { id }, depth }) => `${depth}:${id}`)).toEqual([
      "0:Gastro", "1:Gastro adults", "1:Gastro kids", "0:Kardio", "0:Orphan",
    ])
  })

  it("counts the agents a group reaches through the groups above it", () => {
    const groups = [group("Gastro", null, ["a1", "a2"]), group("Gastro kids", "Gastro", ["a2", "a3"])]
    const { own, inherited } = agentsWhoSeeProductGroup(groups, "Gastro kids")
    expect([...own].sort()).toEqual(["a2", "a3"])
    expect([...inherited]).toEqual(["a1"])
    expect(agentsWhoSeeProductGroup(groups, "Gastro").inherited.size).toBe(0)
  })

  it("calls a group ready only when an agent will see a file there on a visit", () => {
    const groups = [group("Gastro", null, ["a1"]), group("Gastro kids", "Gastro"), group("Kardio", null)]
    // A subgroup with no agents of its own is ready: the agents of «Gastro» get it.
    expect(productGroupReadiness(groups, [product("Gastro kids")], "Gastro kids")).toBe("READY")
    expect(productGroupReadiness(groups, [product("Kardio")], "Kardio")).toBe("NO_AGENTS")
    // Presentations first: without a file nobody has anything to show, whoever is ticked.
    expect(productGroupReadiness(groups, [], "Gastro")).toBe("NO_PRESENTATIONS")
    // A deleted file or a switched-off product is not something to show.
    expect(productGroupReadiness(groups, [product("Gastro", { document: { deletedAt: "2026-10-01T00:00:00.000Z" } })], "Gastro")).toBe("NO_PRESENTATIONS")
    expect(productGroupReadiness(groups, [product("Gastro", { document: null })], "Gastro")).toBe("NO_PRESENTATIONS")
    expect(productGroupReadiness(groups, [product("Gastro", { isActive: false })], "Gastro")).toBe("NO_PRESENTATIONS")
  })

  it("adds up the showings of a group's own presentations", () => {
    const products = [
      product("Gastro", { id: "x", _count: { presentationSessions: 2 } }),
      product("Gastro", { id: "y", _count: { presentationSessions: 5 } }),
      product("Kardio", { _count: { presentationSessions: 9 } }),
    ]
    expect(productGroupShowings(products, "Gastro")).toBe(7)
  })

  it("offers the file's own name as the product name, and knows a deck from anything else", () => {
    expect(productNameFromFileName("Forlaks_prezentasiya.pdf")).toBe("Forlaks prezentasiya")
    expect(productNameFromFileName("Omez  2026 v3.PPTX")).toBe("Omez 2026 v3")
    expect(presentationKind({ name: "deck.pptx", type: "" })).toBe("PPT")
    expect(presentationKind({ fileName: "x.bin", mimeType: "application/pdf" })).toBe("PDF")
    expect(presentationKind({ name: "photo.jpg", type: "image/jpeg" })).toBeNull()
    expect(presentationKind({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBeNull()
  })
})
