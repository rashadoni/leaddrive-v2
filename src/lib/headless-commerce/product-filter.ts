/**
 * Public product field projection — D6 Phase 6 Block A slice 1.
 *
 * Strips internal-only Product columns and returns the anonymous-safe
 * `PublicProduct` shape. Pure synchronous — slice-2 caller pipes the
 * Prisma findMany result through `filterPublicProducts`.
 *
 * Picked fields are documented in `PublicProduct` (types.ts). Adding
 * a new Product column to the schema does NOT auto-expose it — this
 * filter explicitly names each field. That's a defense-in-depth choice
 * against accidental data leaks (e.g. a future `cost` / `margin` /
 * `internalNotes` column landing on Product silently).
 */
import type { PublicProduct } from "./types"

/**
 * Shape we accept from Prisma. Loose-typed so the helper can be called
 * with the result of any Product `findMany` regardless of whether the
 * caller passed a `select` clause — extra fields are simply ignored.
 */
export interface ProductLike {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  currency: string
  features: readonly string[]
  tags: readonly string[]
}

export function filterPublicProduct(p: ProductLike): PublicProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    price: p.price,
    currency: p.currency,
    // Force readonly + defensive copy so a downstream mutation of
    // the response object doesn't bleed back into the Prisma row
    // (matters when the caller caches the rows in-process).
    features: [...p.features],
    tags: [...p.tags],
  }
}

export function filterPublicProducts(rows: readonly ProductLike[]): PublicProduct[] {
  return rows.map(filterPublicProduct)
}
