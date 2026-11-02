import { describe, expect, it } from "vitest"
import {
  presentationKind,
  productGroupReadiness,
  productGroupShowings,
  productGroupTree,
  productGroupViewers,
  productNameFromFileName,
  productsNobodySees,
  viewerChanges,
  viewerState,
  type ProductCatalogGroup,
  type ProductCatalogProduct,
} from "@/lib/mtm/product-catalog-view"

const group = (id: string, parentId: string | null, agents: string[] = [], over: Partial<ProductCatalogGroup> = {}): ProductCatalogGroup => ({
  id, parentId, name: id, sortOrder: 0, members: agents.map((agentId) => ({ agentId, role: "AGENT" as const })), ...over,
})
const product = (groupId: string, over: Partial<ProductCatalogProduct> = {}): ProductCatalogProduct => ({
  id: `${groupId}-p`, groupId, isActive: true, document: { deletedAt: null }, viewerAgentIds: [], _count: { presentationSessions: 0 }, ...over,
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

  it("counts as a group's agents those who see one of its own presentations, and inherits nobody from above", () => {
    const products = [
      product("Gastro", { id: "forlaks", viewerAgentIds: ["a1", "a2"] }),
      product("Gastro", { id: "gastal", viewerAgentIds: ["a2"] }),
      product("Gastro kids", { id: "kids", viewerAgentIds: [] }),
    ]
    expect([...productGroupViewers(products, "Gastro")].sort()).toEqual(["a1", "a2"])
    // A tick on «Gastro»'s presentations hands «Gastro kids» nothing.
    expect(productGroupViewers(products, "Gastro kids").size).toBe(0)
  })

  it("calls a group ready only when every presentation an agent could open is seen by somebody", () => {
    const seen = product("Gastro", { id: "forlaks", viewerAgentIds: ["a1"] })
    const unseen = product("Gastro", { id: "mezim" })
    expect(productGroupReadiness([seen], "Gastro")).toBe("READY")
    expect(productGroupReadiness([seen, unseen], "Gastro")).toBe("PARTLY")
    expect(productsNobodySees([seen, unseen], "Gastro").map((entry) => entry.id)).toEqual(["mezim"])
    expect(productGroupReadiness([unseen], "Gastro")).toBe("NO_AGENTS")
    // Presentations first: without a file nobody has anything to show, whoever is ticked.
    expect(productGroupReadiness([], "Gastro")).toBe("NO_PRESENTATIONS")
    // A deleted file or a switched-off product is not something to show.
    expect(productGroupReadiness([product("Gastro", { viewerAgentIds: ["a1"], document: { deletedAt: "2026-10-01T00:00:00.000Z" } })], "Gastro")).toBe("NO_PRESENTATIONS")
    expect(productGroupReadiness([product("Gastro", { viewerAgentIds: ["a1"], document: null })], "Gastro")).toBe("NO_PRESENTATIONS")
    expect(productGroupReadiness([product("Gastro", { viewerAgentIds: ["a1"], isActive: false })], "Gastro")).toBe("NO_PRESENTATIONS")
  })

  it("adds up the showings of a group's presentations, the deleted ones' included", () => {
    const products = [
      product("Gastro", { id: "x", _count: { presentationSessions: 2 } }),
      product("Gastro", { id: "y", _count: { presentationSessions: 5 } }),
      product("Kardio", { _count: { presentationSessions: 9 } }),
    ]
    expect(productGroupShowings(products, "Gastro")).toBe(7)
    expect(productGroupShowings(products, "Gastro", { Gastro: 4, Kardio: 1 })).toBe(11)
    expect(productGroupShowings([], "Gastro", { Gastro: 5 })).toBe(5)
  })

  it("tells for the chosen presentations whether an agent sees all, some or none of them", () => {
    const chosen = [
      product("Gastro", { id: "forlaks", viewerAgentIds: ["kamran", "leyla"] }),
      product("Gastro", { id: "gastal", viewerAgentIds: ["leyla"] }),
    ]
    expect(viewerState(chosen, "leyla")).toBe("all")
    expect(viewerState(chosen, "kamran")).toBe("some")
    expect(viewerState(chosen, "aysel")).toBe("none")
    expect(viewerState([], "leyla")).toBe("none")
  })

  it("sends only the ticks that change something, and leaves an untouched half-ticked agent alone", () => {
    const chosen = [
      product("Gastro", { id: "forlaks", viewerAgentIds: ["kamran", "leyla"] }),
      product("Gastro", { id: "gastal", viewerAgentIds: ["leyla"] }),
    ]
    // Kamran sees only Forlaks and is ticked: he gets both. Leyla sees both: ticking her changes nothing.
    expect(viewerChanges(chosen, new Map([["kamran", true], ["leyla", true]]))).toEqual({ add: ["kamran"], remove: [] })
    // Unticking somebody who sees none of them changes nothing either.
    expect(viewerChanges(chosen, new Map([["aysel", false], ["leyla", false]]))).toEqual({ add: [], remove: ["leyla"] })
    // Nobody touched — nothing to send, whatever Kamran's half state.
    expect(viewerChanges(chosen, new Map())).toEqual({ add: [], remove: [] })
    expect(viewerChanges([], new Map([["kamran", true]]))).toEqual({ add: [], remove: [] })
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
