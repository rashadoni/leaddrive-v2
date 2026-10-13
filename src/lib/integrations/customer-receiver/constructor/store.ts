import { createHash } from "node:crypto"
import { canonicalJson } from "../../../event-platform/canonical-json"
import { identifier } from "../contract"
import { builderProfileSchema, type BuilderProfile } from "./profile"

export const BUILDER_CHANNEL_TYPE = "customer-receiver-draft"
export class BuilderStoreError extends Error {
  constructor(readonly code: "not_found" | "revision_conflict" | "invalid_profile" | "invalid_stored_profile") { super(code); this.name = "BuilderStoreError" }
}
export interface BuilderRow { id: string; organizationId: string; channelType: string; isActive: boolean; settings: unknown; updatedAt: Date }
interface DraftSettings { builderVersion: "1.0"; revision: number; profile: BuilderProfile; history: { revision: number; profile: BuilderProfile; recordedAt: string }[] }
export interface BuilderTransaction {
  find: (id: string, organizationId: string) => Promise<BuilderRow | null>
  create: (organizationId: string, userId: string, settings: DraftSettings) => Promise<BuilderRow>
  compareAndUpdate: (row: BuilderRow, settings: DraftSettings) => Promise<number>
  audit: (entry: { organizationId: string; userId: string; entityId: string; action: string; evidence: { revision: number; profileHash: string; environment: string; resources: string[] } }) => Promise<void>
}
export interface BuilderStore { transaction: <T>(work: (tx: BuilderTransaction) => Promise<T>) => Promise<T> }

export function publicBuilderDraft(row: BuilderRow, organizationId: string) {
  if (row.organizationId !== organizationId || row.channelType !== BUILDER_CHANNEL_TYPE || row.isActive) throw new BuilderStoreError("not_found")
  const settings = row.settings as Partial<DraftSettings> | null
  if (!settings || settings.builderVersion !== "1.0" || !Number.isSafeInteger(settings.revision) || settings.revision! < 1) throw new BuilderStoreError("invalid_stored_profile")
  const parsed = builderProfileSchema.safeParse(settings.profile)
  if (!parsed.success) throw new BuilderStoreError("invalid_stored_profile")
  const history = settings.history ?? []
  if (!Array.isArray(history) || history.length > 20) throw new BuilderStoreError("invalid_stored_profile")
  const snapshots = history.map((entry) => {
    const previous = builderProfileSchema.safeParse(entry.profile)
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision >= settings.revision! || !previous.success || !Number.isFinite(Date.parse(entry.recordedAt))) throw new BuilderStoreError("invalid_stored_profile")
    return { revision: entry.revision, profile: previous.data, recordedAt: entry.recordedAt }
  })
  if (new Set(snapshots.map((entry) => entry.revision)).size !== snapshots.length) throw new BuilderStoreError("invalid_stored_profile")
  return { id: row.id, revision: settings.revision!, profile: parsed.data, history: snapshots, updatedAt: row.updatedAt.toISOString(), externalSendingAvailable: false as const }
}

/** Profile write and metadata-only audit must commit together. */
export async function saveBuilderDraft(store: BuilderStore, input: {
  organizationId: string; userId: string; id?: string; expectedRevision: number; profile: unknown
}) {
  identifier(input.organizationId); identifier(input.userId)
  if (input.id !== undefined) identifier(input.id)
  const parsed = builderProfileSchema.safeParse(input.profile)
  if (!parsed.success) throw new BuilderStoreError("invalid_profile")
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new BuilderStoreError("revision_conflict")
  return store.transaction(async (tx) => {
    const current = input.id === undefined ? null : await tx.find(input.id, input.organizationId)
    if (input.id !== undefined && !current) throw new BuilderStoreError("not_found")
    const prior = current ? publicBuilderDraft(current, input.organizationId) : null
    if ((prior?.revision ?? 0) !== input.expectedRevision) throw new BuilderStoreError("revision_conflict")
    const history = prior ? [{ revision: prior.revision, profile: prior.profile, recordedAt: prior.updatedAt }, ...prior.history].slice(0, 20) : []
    const settings: DraftSettings = { builderVersion: "1.0", revision: input.expectedRevision + 1, profile: parsed.data, history }
    while (settings.history.length && Buffer.byteLength(canonicalJson(settings), "utf8") > 512 * 1024) settings.history.pop()
    if (Buffer.byteLength(canonicalJson(settings), "utf8") > 512 * 1024) throw new BuilderStoreError("invalid_profile")
    let result: BuilderRow
    if (current) {
      if (await tx.compareAndUpdate(current, settings) !== 1) throw new BuilderStoreError("revision_conflict")
      const updated = await tx.find(current.id, input.organizationId)
      if (!updated) throw new BuilderStoreError("not_found")
      result = updated
    } else result = await tx.create(input.organizationId, input.userId, settings)
    await tx.audit({
      organizationId: input.organizationId, userId: input.userId, entityId: result.id,
      action: current ? "receiver_draft_updated" : "receiver_draft_created",
      evidence: { revision: settings.revision, profileHash: createHash("sha256").update(canonicalJson(parsed.data)).digest("hex"), environment: parsed.data.environment, resources: parsed.data.resources.filter((entry) => entry.enabled).map((entry) => entry.resource) },
    })
    return publicBuilderDraft(result, input.organizationId)
  })
}
