/**
 * What the «Products and presentations» screen shows about a group, worked out
 * from the two lists the page already reads (/api/v1/mtm/product-groups and
 * /api/v1/mtm/products). Pure — the page and its tests read the same answers.
 *
 * Owner, 2026-10-15, on the screen: «этот раздел не очень понятен… нужно
 * подтянуть интуитивность и интерактивность». It was a form to create a group
 * on top, a flat list of groups and three boxes under each other, and nothing
 * said what a group is for or whether an agent will ever see the file. The
 * screen now says it step by step — presentations, agents, the visit — and
 * this file decides each step's state.
 */

export type ProductCatalogMember = { agentId: string; role: "MANAGER" | "AGENT" }

export type ProductCatalogGroup = {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  members: ProductCatalogMember[]
}

export type ProductCatalogProduct = {
  id: string
  groupId: string
  isActive: boolean
  document: { deletedAt: string | null } | null
  _count: { presentationSessions: number }
}

/** The groups in the order of their tree, each with how deep it sits. */
export function productGroupTree<T extends ProductCatalogGroup>(groups: T[]): Array<{ group: T; depth: number }> {
  const byParent = new Map<string | null, T[]>()
  const ids = new Set(groups.map((group) => group.id))
  for (const group of groups) {
    // A parent the caller cannot see puts the group at the top, not nowhere.
    const parent = group.parentId && ids.has(group.parentId) ? group.parentId : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), group])
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }
  const ordered: Array<{ group: T; depth: number }> = []
  const seen = new Set<string>()
  const visit = (parent: string | null, depth: number) => {
    for (const group of byParent.get(parent) ?? []) {
      if (seen.has(group.id)) continue
      seen.add(group.id)
      ordered.push({ group, depth })
      visit(group.id, depth + 1)
    }
  }
  visit(null, 0)
  return ordered
}

/** The group and every group above it, nearest first. */
export function productGroupAncestry<T extends ProductCatalogGroup>(groups: T[], groupId: string): T[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const chain: T[] = []
  let current = byId.get(groupId)
  while (current && !chain.includes(current)) {
    chain.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return chain
}

/**
 * The field agents who get this group in the app: its own, and those of every
 * group above it — a membership grants the group's subgroups too
 * (`expandVisibleProductGroupIds`).
 */
export function agentsWhoSeeProductGroup(groups: ProductCatalogGroup[], groupId: string): {
  own: Set<string>
  inherited: Set<string>
} {
  const [group, ...above] = productGroupAncestry(groups, groupId)
  const own = new Set(group?.members.filter((member) => member.role === "AGENT").map((member) => member.agentId) ?? [])
  const inherited = new Set<string>()
  for (const ancestor of above) {
    for (const member of ancestor.members) {
      if (member.role === "AGENT" && !own.has(member.agentId)) inherited.add(member.agentId)
    }
  }
  return { own, inherited }
}

/** A product an agent can open: active, with a file that still exists. */
export function productPresentationReady(product: ProductCatalogProduct): boolean {
  return product.isActive && product.document != null && product.document.deletedAt == null
}

export type ProductGroupReadiness = "READY" | "NO_PRESENTATIONS" | "NO_AGENTS"

/**
 * Will an agent see something of this group on a visit? Presentations first —
 * without one there is nothing to show, whoever is ticked.
 */
export function productGroupReadiness(
  groups: ProductCatalogGroup[],
  products: ProductCatalogProduct[],
  groupId: string,
): ProductGroupReadiness {
  if (!products.some((product) => product.groupId === groupId && productPresentationReady(product))) return "NO_PRESENTATIONS"
  const { own, inherited } = agentsWhoSeeProductGroup(groups, groupId)
  return own.size + inherited.size > 0 ? "READY" : "NO_AGENTS"
}

/** How many times agents opened this group's presentations on a visit. */
export function productGroupShowings(products: ProductCatalogProduct[], groupId: string): number {
  return products
    .filter((product) => product.groupId === groupId)
    .reduce((sum, product) => sum + product._count.presentationSessions, 0)
}

/** «Gastro_Omez-2026_v3.pdf» → «Gastro Omez-2026 v3»: the name the form offers for a chosen file. */
export function productNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(pdf|pptx?|key)$/i, "")
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
}

export type PresentationKind = "PDF" | "PPT"

export const PRESENTATION_ACCEPT =
  ".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"

/** What the file is, for its badge; null for a file the server will refuse. */
export function presentationKind(file: { mimeType?: string | null; fileName?: string | null; type?: string; name?: string }): PresentationKind | null {
  const mime = (file.mimeType ?? file.type ?? "").toLowerCase()
  const name = (file.fileName ?? file.name ?? "").toLowerCase()
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF"
  if (mime.includes("powerpoint") || mime.includes("presentationml") || /\.pptx?$/.test(name)) return "PPT"
  return null
}
