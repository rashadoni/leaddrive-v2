import { decryptToken, encryptToken, hmacToken, isEncrypted } from "@/lib/secure-token"

const CURSOR_PURPOSE = "mtm-route-candidate-cursor"
const CURSOR_SCHEMA_VERSION = 1
const MAX_CURSOR_LENGTH = 4096
const DEFAULT_CURSOR_TTL_MS = 15 * 60 * 1000

export const MTM_ROUTE_CANDIDATE_KEYSET_DEFAULT_LIMIT = 50
export const MTM_ROUTE_CANDIDATE_KEYSET_MAX_LIMIT = 100

export type MtmRouteCandidateKeysetSort = "NAME" | "PRIORITY"
export type MtmRouteCandidateCursorKind = "CONTACT" | "CUSTOMER"

export type MtmRouteCandidateCursorValues = {
  name: string
  id: string
  category?: string
}

export type MtmRouteCandidateCursorBindingInput = {
  organizationId: string
  userId: string
  principal: "web" | "mobile"
  authAgentId: string | null
  actorRole: string
  actorAgentId: string | null
  scopedAgentIds: readonly string[] | null
  query: Record<string, string | null>
}

type MtmRouteCandidateCursorPayload = {
  schemaVersion: 1
  expiresAt: number
  binding: string
  kind: MtmRouteCandidateCursorKind
  sort: MtmRouteCandidateKeysetSort
  values: MtmRouteCandidateCursorValues
}

export class MtmRouteCandidateCursorError extends Error {
  constructor(readonly code: "INVALID" | "EXPIRED" | "MISMATCH") {
    super(`MTM route candidate cursor ${code.toLowerCase()}`)
  }
}

export function isMtmRouteCandidateKeysetSort(value: string): value is MtmRouteCandidateKeysetSort {
  return value === "NAME" || value === "PRIORITY"
}

function sortedQuery(query: Record<string, string | null>) {
  return Object.fromEntries(Object.entries(query).sort(([left], [right]) => left.localeCompare(right)))
}

export function mtmRouteCandidateCursorBinding(input: MtmRouteCandidateCursorBindingInput): string {
  return hmacToken(JSON.stringify({
    schemaVersion: CURSOR_SCHEMA_VERSION,
    organizationId: input.organizationId,
    userId: input.userId,
    principal: input.principal,
    authAgentId: input.authAgentId,
    actorRole: input.actorRole,
    actorAgentId: input.actorAgentId,
    scopedAgentIds: input.scopedAgentIds ? [...input.scopedAgentIds].sort((left, right) => left.localeCompare(right)) : null,
    query: sortedQuery(input.query),
  }), `${CURSOR_PURPOSE}:binding`)
}

export function createMtmRouteCandidateCursor(input: {
  binding: string
  kind: MtmRouteCandidateCursorKind
  sort: MtmRouteCandidateKeysetSort
  values: MtmRouteCandidateCursorValues
  now?: number
  ttlMs?: number
}): string {
  const now = input.now ?? Date.now()
  const payload: MtmRouteCandidateCursorPayload = {
    schemaVersion: CURSOR_SCHEMA_VERSION,
    expiresAt: now + (input.ttlMs ?? DEFAULT_CURSOR_TTL_MS),
    binding: input.binding,
    kind: input.kind,
    sort: input.sort,
    values: input.values,
  }
  return encryptToken(JSON.stringify(payload), CURSOR_PURPOSE)
}

function text(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength ? value : null
}

function parsePayload(value: unknown): MtmRouteCandidateCursorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MtmRouteCandidateCursorError("INVALID")
  const raw = value as Record<string, unknown>
  const name = text((raw.values as Record<string, unknown> | undefined)?.name, 1024)
  const id = text((raw.values as Record<string, unknown> | undefined)?.id, 256)
  const category = (raw.values as Record<string, unknown> | undefined)?.category
  const sort = typeof raw.sort === "string" ? raw.sort : ""
  const kind = raw.kind

  if (
    raw.schemaVersion !== CURSOR_SCHEMA_VERSION
    || typeof raw.expiresAt !== "number"
    || !Number.isSafeInteger(raw.expiresAt)
    || !text(raw.binding, 256)
    || (kind !== "CONTACT" && kind !== "CUSTOMER")
    || !isMtmRouteCandidateKeysetSort(sort)
    || !name
    || !id
    || (sort === "PRIORITY" && !text(category, 128))
    || (category !== undefined && !text(category, 128))
  ) {
    throw new MtmRouteCandidateCursorError("INVALID")
  }

  return {
    schemaVersion: CURSOR_SCHEMA_VERSION,
    expiresAt: raw.expiresAt,
    binding: raw.binding as string,
    kind,
    sort,
    values: {
      name,
      id,
      ...(typeof category === "string" ? { category } : {}),
    },
  }
}

export function readMtmRouteCandidateCursor(input: {
  token: string
  binding: string
  now?: number
}): Omit<MtmRouteCandidateCursorPayload, "expiresAt" | "binding"> {
  if (!input.token || input.token.length > MAX_CURSOR_LENGTH || !isEncrypted(input.token)) {
    throw new MtmRouteCandidateCursorError("INVALID")
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(decryptToken(input.token, CURSOR_PURPOSE))
  } catch {
    throw new MtmRouteCandidateCursorError("INVALID")
  }
  const payload = parsePayload(decoded)
  if (payload.expiresAt <= (input.now ?? Date.now())) throw new MtmRouteCandidateCursorError("EXPIRED")
  if (payload.binding !== input.binding) throw new MtmRouteCandidateCursorError("MISMATCH")

  return {
    schemaVersion: payload.schemaVersion,
    kind: payload.kind,
    sort: payload.sort,
    values: payload.values,
  }
}
