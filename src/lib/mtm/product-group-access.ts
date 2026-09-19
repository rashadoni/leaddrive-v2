export type ProductGroupAccessRow = {
  id: string
  parentId: string | null
  hasDirectMembership: boolean
}

export function expandVisibleProductGroupIds(groups: ProductGroupAccessRow[]): Set<string> {
  const visible = new Set(
    groups.filter((group) => group.hasDirectMembership).map((group) => group.id),
  )

  let changed = true
  while (changed) {
    changed = false
    for (const group of groups) {
      if (group.parentId && visible.has(group.parentId) && !visible.has(group.id)) {
        visible.add(group.id)
        changed = true
      }
    }
  }

  return visible
}
