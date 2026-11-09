/**
 * A task edit shown before the server answers (owner, 2026-11-09: «Да,
 * делай» — only boards and task ticks; never money, orders or 1C).
 *
 * The screen takes the PATCH body as it will be sent and shows it at once;
 * if the server refuses, exactly the fields this edit touched go back to what
 * they were, so another edit to the same task still in flight is not undone
 * with it. The objects the screen draws from an id (the assignee's name, the
 * reporter, the co-assignees) follow the id, otherwise the row would show the
 * new id under the old name until the next load.
 */

export interface PersonRef { id: string; name: string; avatar?: string | null }

type Row = object
type Patch = Readonly<Record<string, unknown>>

const DONE_STATUSES = new Set(["completed", "done"])

/** Fields drawn from a patched field: restored together with it. */
const DERIVED: Readonly<Record<string, readonly string[]>> = {
  assignedTo: ["assignee"],
  reporterId: ["reporter"],
  collaboratorIds: ["collaborators"],
  status: ["completedAt"],
}

const person = (id: string, people: readonly PersonRef[]) => {
  const found = people.find((p) => p.id === id)
  return found ? { id: found.id, name: found.name, avatar: found.avatar ?? null } : null
}

/** The task as it will look once the server has taken `patch`. */
export function applyTaskPatch<T extends Row>(task: T, patch: Patch, people: readonly PersonRef[] = []): T {
  const current = task as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "customFields" && value && typeof value === "object") {
      // The server merges custom fields key by key; null removes a key.
      const merged: Record<string, unknown> = { ...((current.customFields as Record<string, unknown> | null) ?? {}) }
      for (const [field, fieldValue] of Object.entries(value as Record<string, unknown>)) {
        if (fieldValue === null) delete merged[field]
        else merged[field] = fieldValue
      }
      next.customFields = merged
      continue
    }
    next[key] = value
  }
  if ("assignedTo" in patch) {
    const id = patch.assignedTo as string | null
    // Someone not in the list: keep the old object rather than draw a nameless one.
    next.assignee = id ? person(id, people) ?? current.assignee : null
  }
  if ("reporterId" in patch) {
    const id = patch.reporterId as string | null
    next.reporter = id ? person(id, people) ?? current.reporter : null
  }
  if ("collaboratorIds" in patch) {
    const ids = (patch.collaboratorIds as string[] | null) ?? []
    next.collaborators = ids.map((id) => ({ user: person(id, people) ?? { id, name: id, avatar: null } }))
  }
  if (typeof patch.status === "string" && DONE_STATUSES.has(patch.status)) {
    next.completedAt = current.completedAt ?? new Date().toISOString()
  }
  return next as T
}

/** `current` with only the fields `patch` touched put back as they were in `original`. */
export function revertTaskPatch<T extends Row>(current: T, original: T, patch: Patch): T {
  const now = current as Record<string, unknown>
  const before = original as Record<string, unknown>
  const next: Record<string, unknown> = { ...now }
  for (const key of Object.keys(patch)) {
    if (key === "customFields" && patch.customFields && typeof patch.customFields === "object") {
      const was = (before.customFields as Record<string, unknown> | null) ?? {}
      const fields: Record<string, unknown> = { ...((now.customFields as Record<string, unknown> | null) ?? {}) }
      for (const field of Object.keys(patch.customFields as Record<string, unknown>)) {
        if (field in was) fields[field] = was[field]
        else delete fields[field]
      }
      next.customFields = before.customFields == null && Object.keys(fields).length === 0 ? before.customFields : fields
      continue
    }
    for (const field of [key, ...(DERIVED[key] ?? [])]) {
      if (field in before) next[field] = before[field]
      else delete next[field]
    }
  }
  return next as T
}
