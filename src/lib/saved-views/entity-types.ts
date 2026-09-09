/**
 * Allowed `entityType` strings for saved views. Single source of truth
 * shared between the server endpoint and the `<SavedViewBar>` component
 * so adding a new entity (e.g. `"mtm_tasks"`) is a one-line change.
 *
 * Roadmap #20 — architect P2 from initial review.
 */

export const SAVED_VIEW_ENTITY_TYPES = [
  "tasks",
  "contacts",
  "deals",
  "leads",
  "companies",
  "projects",
  "contracts",
] as const

export type SavedViewEntityType = typeof SAVED_VIEW_ENTITY_TYPES[number]

export function isSavedViewEntityType(s: string): s is SavedViewEntityType {
  return (SAVED_VIEW_ENTITY_TYPES as readonly string[]).includes(s)
}
