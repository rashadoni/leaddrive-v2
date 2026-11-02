/**
 * What the «Products and presentations» screen shows about a group, worked out
 * from the two lists the page already reads (/api/v1/mtm/product-groups and
 * /api/v1/mtm/products). Pure — the page and its tests read the same answers.
 *
 * Owner, 2026-10-21: «нет выбора презентации… я хочу выбрать несколько
 * презентаций и указать, для какого агента будут видны… и нет сохранения».
 * So who sees what is decided per presentation: choose presentations, tick
 * agents, «Yadda saxla».
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
  /** The field agents who get this presentation in the app. */
  viewerAgentIds: string[]
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

/** A product an agent can open: active, with a file that still exists. */
export function productPresentationReady(product: ProductCatalogProduct): boolean {
  return product.isActive && product.document != null && product.document.deletedAt == null
}

/**
 * The field agents who see at least one of this group's presentations. Each
 * presentation has its own list (owner, 2026-10-21); a group hands nobody
 * anything by itself, and a subgroup inherits nobody from above.
 */
export function productGroupViewers(products: ProductCatalogProduct[], groupId: string): Set<string> {
  const viewers = new Set<string>()
  for (const product of products) {
    if (product.groupId !== groupId) continue
    for (const agentId of product.viewerAgentIds) viewers.add(agentId)
  }
  return viewers
}

/** The group's presentations an agent could open but nobody gets. */
export function productsNobodySees(products: ProductCatalogProduct[], groupId: string): ProductCatalogProduct[] {
  return products.filter((product) =>
    product.groupId === groupId && productPresentationReady(product) && product.viewerAgentIds.length === 0)
}

export type ProductGroupReadiness = "READY" | "PARTLY" | "NO_PRESENTATIONS" | "NO_AGENTS"

/**
 * Will an agent see something of this group on a visit? Presentations first —
 * without one there is nothing to show, whoever is ticked. PARTLY: some are
 * seen, and some nobody gets.
 */
export function productGroupReadiness(products: ProductCatalogProduct[], groupId: string): ProductGroupReadiness {
  const ready = products.filter((product) => product.groupId === groupId && productPresentationReady(product))
  if (ready.length === 0) return "NO_PRESENTATIONS"
  const unseen = ready.filter((product) => product.viewerAgentIds.length === 0).length
  if (unseen === ready.length) return "NO_AGENTS"
  return unseen > 0 ? "PARTLY" : "READY"
}

/**
 * How many times agents opened this group's presentations on a visit —
 * deleted ones included: a deleted presentation leaves the list, not the
 * history.
 */
export function productGroupShowings(
  products: ProductCatalogProduct[],
  groupId: string,
  deletedShowings: Record<string, number> = {},
): number {
  return products
    .filter((product) => product.groupId === groupId)
    .reduce((sum, product) => sum + product._count.presentationSessions, deletedShowings[groupId] ?? 0)
}

export type ViewerState = "all" | "some" | "none"

/** Does the agent see all the chosen presentations, some of them, or none? */
export function viewerState(chosen: ProductCatalogProduct[], agentId: string): ViewerState {
  const seen = chosen.filter((product) => product.viewerAgentIds.includes(agentId)).length
  if (chosen.length > 0 && seen === chosen.length) return "all"
  return seen > 0 ? "some" : "none"
}

/**
 * What «Yadda saxla» will send: a tick (`true`) gives the agent every chosen
 * presentation, an untick (`false`) takes them all away. A tick that changes
 * nothing — the agent already sees them all — is not a change.
 */
export function viewerChanges(chosen: ProductCatalogProduct[], pending: ReadonlyMap<string, boolean>): {
  add: string[]
  remove: string[]
} {
  const add: string[] = []
  const remove: string[] = []
  if (chosen.length === 0) return { add, remove }
  for (const [agentId, on] of pending) {
    const state = viewerState(chosen, agentId)
    if (on && state !== "all") add.push(agentId)
    if (!on && state !== "none") remove.push(agentId)
  }
  return { add, remove }
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
