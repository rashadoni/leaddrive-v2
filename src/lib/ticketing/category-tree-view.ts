export type FilteredTreeNode<T> = T & {
  children: FilteredTreeNode<T>[]
  contextOnly: boolean
}

export type VisibleTreeRow<T> = T & {
  depth: number
  contextOnly: boolean
}

type TreeNode = {
  id: string
  children?: TreeNode[]
}

/**
 * Keeps matching nodes plus every ancestor needed to understand their place in
 * the hierarchy. Ancestors that do not match the current filter are marked as
 * context-only instead of leaving an unexplained indented child behind.
 */
export function filterCategoryTree<T extends TreeNode>(
  nodes: T[],
  matches: (category: T) => boolean,
): FilteredTreeNode<T>[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterCategoryTree((node.children || []) as T[], matches)
    const selfMatches = matches(node)
    if (!selfMatches && filteredChildren.length === 0) return []
    return [{ ...node, children: filteredChildren, contextOnly: !selfMatches }]
  })
}

/** Flattens the filtered tree while respecting disclosure state. */
export function flattenVisibleCategoryTree<T extends TreeNode>(
  nodes: FilteredTreeNode<T>[],
  collapsed: ReadonlySet<string>,
  forceExpanded: boolean,
  depth = 0,
): VisibleTreeRow<T>[] {
  return nodes.flatMap((node) => {
    const row = { ...node, depth, contextOnly: node.contextOnly }
    if (!forceExpanded && collapsed.has(node.id)) return [row]
    return [row, ...flattenVisibleCategoryTree(node.children, collapsed, forceExpanded, depth + 1)]
  })
}
