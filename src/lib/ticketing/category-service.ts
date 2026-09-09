import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  normalizeLegacyTicketCategory,
  normalizeTicketCategorySlug,
  type TicketCategoryScope,
  type TicketPriorityLevel,
} from "@/lib/ticketing/categories"

export class TicketingValidationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "TicketingValidationError"
    this.status = status
  }
}

export type TicketCategoryTreeNode<T extends { id: string; parentId: string | null }> =
  T & { children: TicketCategoryTreeNode<T>[] }

type TicketCategoryLookup = {
  id: string
  slug: string
  name: string
  scope: string
  defaultPriority: string | null
}

type RequesterInput = {
  name?: string | null
  email?: string | null
  phone?: string | null
  externalId?: string | null
  meta?: Prisma.InputJsonObject | null
}

export function normalizeNullableString(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized || null
}

export function ticketCategoryScopeAllows(categoryScope: string, requestedScope?: TicketCategoryScope): boolean {
  if (!requestedScope || categoryScope === "both") return true
  return categoryScope === requestedScope
}

export function buildTicketCategoryTree<T extends { id: string; parentId: string | null }>(
  categories: readonly T[],
): TicketCategoryTreeNode<T>[] {
  const nodes = new Map<string, TicketCategoryTreeNode<T>>()

  for (const category of categories) {
    nodes.set(category.id, { ...category, children: [] } as TicketCategoryTreeNode<T>)
  }

  const roots: TicketCategoryTreeNode<T>[] = []
  for (const category of categories) {
    const node = nodes.get(category.id)
    if (!node) continue

    const parent = category.parentId ? nodes.get(category.parentId) : null
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export function buildTicketRequesterSnapshot(input: RequesterInput) {
  const requesterName = normalizeNullableString(input.name)
    || normalizeNullableString(input.email)
    || normalizeNullableString(input.phone)

  return {
    requesterName,
    requesterEmail: normalizeNullableString(input.email),
    requesterPhone: normalizeNullableString(input.phone),
    requesterExternalId: normalizeNullableString(input.externalId),
    requesterMeta: input.meta ?? undefined,
  }
}

export async function getContactRequesterSnapshot(orgId: string, contactId?: string | null) {
  const normalizedContactId = normalizeNullableString(contactId)
  if (!normalizedContactId) return {}

  const contact = await prisma.contact.findFirst({
    where: { id: normalizedContactId, organizationId: orgId },
    select: { id: true, fullName: true, email: true, phone: true },
  })
  if (!contact) {
    throw new TicketingValidationError("contactId not found in this organization")
  }

  return buildTicketRequesterSnapshot({
    name: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    externalId: contact.id,
  })
}

export async function assertTicketCategoryParent(
  orgId: string,
  parentId?: string | null,
  currentId?: string,
): Promise<string | null> {
  const normalizedParentId = normalizeNullableString(parentId)
  if (!normalizedParentId) return null
  if (currentId && normalizedParentId === currentId) {
    throw new TicketingValidationError("A category cannot be its own parent")
  }

  let cursor: string | null = normalizedParentId
  const visited = new Set<string>()
  while (cursor) {
    if (currentId && cursor === currentId) {
      throw new TicketingValidationError("Category parent would create a cycle")
    }
    if (visited.has(cursor)) {
      throw new TicketingValidationError("Category tree has a cycle")
    }
    visited.add(cursor)

    const parent: { id: string; parentId: string | null } | null = await prisma.ticketCategory.findFirst({
      where: { id: cursor, organizationId: orgId },
      select: { id: true, parentId: true },
    })
    if (!parent) {
      throw new TicketingValidationError("parentId not found in this organization")
    }
    cursor = parent.parentId
  }

  return normalizedParentId
}

export async function assertTicketCategoryQueue(orgId: string, defaultQueueId?: string | null): Promise<string | null> {
  const normalizedQueueId = normalizeNullableString(defaultQueueId)
  if (!normalizedQueueId) return null

  const queue = await prisma.ticketQueue.findFirst({
    where: { id: normalizedQueueId, organizationId: orgId },
    select: { id: true },
  })
  if (!queue) {
    throw new TicketingValidationError("defaultQueueId not found in this organization")
  }

  return normalizedQueueId
}

export async function resolveTicketCategoryForWrite(
  orgId: string,
  input: {
    categoryId?: string | null
    category?: string | null
    scope?: TicketCategoryScope
    preserveUnknown?: boolean
  },
): Promise<{
  category: string
  categoryId: string | null
  defaultPriority: TicketPriorityLevel | null
  scope: TicketCategoryScope
}> {
  const categoryId = normalizeNullableString(input.categoryId)
  if (categoryId) {
    const category = await prisma.ticketCategory.findFirst({
      where: { id: categoryId, organizationId: orgId, isActive: true },
      select: { id: true, slug: true, name: true, scope: true, defaultPriority: true },
    })
    if (!category) {
      throw new TicketingValidationError("categoryId not found in this organization")
    }
    if (!ticketCategoryScopeAllows(category.scope, input.scope)) {
      throw new TicketingValidationError("categoryId is not available for this ticket scope")
    }

    return {
      category: category.slug,
      categoryId: category.id,
      defaultPriority: normalizePriority(category.defaultPriority),
      scope: normalizeScope(category.scope),
    }
  }

  const requestedSlug = normalizeTicketCategorySlug(input.category)
  const category = await findActiveCategoryBySlug(orgId, requestedSlug)
  if (category && ticketCategoryScopeAllows(category.scope, input.scope)) {
    return {
      category: category.slug,
      categoryId: category.id,
      defaultPriority: normalizePriority(category.defaultPriority),
      scope: normalizeScope(category.scope),
    }
  }

  if (input.preserveUnknown) {
    const unknownScope: TicketCategoryScope = requestedSlug === "complaint" ? "complaint" : "ticket"
    if (ticketCategoryScopeAllows(unknownScope, input.scope)) {
      return {
        category: requestedSlug,
        categoryId: null,
        defaultPriority: null,
        scope: unknownScope,
      }
    }
  }

  const legacyCategory = normalizeLegacyFallback(input.category, input.scope)
  const legacy = legacyCategory === requestedSlug ? category : await findActiveCategoryBySlug(orgId, legacyCategory)
  if (legacy && ticketCategoryScopeAllows(legacy.scope, input.scope)) {
    return {
      category: legacy.slug,
      categoryId: legacy.id,
      defaultPriority: normalizePriority(legacy.defaultPriority),
      scope: normalizeScope(legacy.scope),
    }
  }

  return {
    category: legacyCategory,
    categoryId: null,
    defaultPriority: null,
    scope: legacyCategory === "complaint" ? "complaint" : "ticket",
  }
}

async function findActiveCategoryBySlug(orgId: string, slug: string): Promise<TicketCategoryLookup | null> {
  return prisma.ticketCategory.findFirst({
    where: { organizationId: orgId, slug, isActive: true },
    select: { id: true, slug: true, name: true, scope: true, defaultPriority: true },
  })
}

function normalizePriority(priority?: string | null): TicketPriorityLevel | null {
  if (priority === "low" || priority === "medium" || priority === "high" || priority === "critical") {
    return priority
  }
  return null
}

function normalizeScope(scope?: string | null): TicketCategoryScope {
  if (scope === "complaint" || scope === "both") return scope
  return "ticket"
}

function normalizeLegacyFallback(category?: string | null, scope?: TicketCategoryScope) {
  const legacyCategory = normalizeLegacyTicketCategory(category)
  if (scope === "ticket" && legacyCategory === "complaint") return "general"
  if (scope === "complaint" && legacyCategory !== "complaint") return "complaint"
  return legacyCategory
}
