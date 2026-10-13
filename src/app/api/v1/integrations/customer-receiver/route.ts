import { NextResponse } from "next/server"
import type { Prisma, CustomField } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { BUILDER_FIELDS, type BuilderField } from "@/lib/integrations/customer-receiver/constructor/catalog"
import { builderProfileSchema, defaultBuilderProfile, validateProfileCatalogue } from "@/lib/integrations/customer-receiver/constructor/profile"
import { previewBuilderResource, syntheticBuilderInput } from "@/lib/integrations/customer-receiver/constructor/engine"
import { BUILDER_CHANNEL_TYPE, BuilderStoreError, publicBuilderDraft, saveBuilderDraft, type BuilderStore, type BuilderRow } from "@/lib/integrations/customer-receiver/constructor/store"

const saveSchema = z.object({ id: z.string().max(128).optional(), expectedRevision: z.number().int().min(0), profile: builderProfileSchema }).strict()
const previewSchema = z.object({ action: z.literal("preview"), profile: builderProfileSchema, resource: z.enum(["customers", "contacts", "deals"]), sample: z.enum(["typical", "missing_optional", "precision"]) }).strict()
const allowedRole = (role: string) => role === "admin" || role === "superadmin"
const unavailable = () => NextResponse.json({ error: "Receiver configuration unavailable" }, { status: 503 })

async function catalogue(organizationId: string): Promise<BuilderField[]> {
  const fields: Pick<CustomField, "id" | "entityType" | "fieldLabel" | "fieldType">[] = await prisma.customField.findMany({ where: { organizationId, isActive: true, entityType: { in: ["company", "contact", "deal"] } }, take: 501, orderBy: { id: "asc" }, select: { id: true, entityType: true, fieldLabel: true, fieldType: true } })
  if (fields.length > 500) throw new Error("custom_field_catalogue_limit")
  const types: Record<string, BuilderField["kind"]> = { text: "text", textarea: "text", email: "text", phone: "text", select: "text", number: "decimal", date: "date", checkbox: "boolean" }
  return [...BUILDER_FIELDS, ...fields.filter((entry) => types[entry.fieldType]).map((entry) => ({ key: `custom.${entry.entityType}.${entry.id}`, entity: entry.entityType as BuilderField["entity"], kind: types[entry.fieldType], label: { ru: entry.fieldLabel, az: entry.fieldLabel, en: entry.fieldLabel } }))]
}

const json = (value: unknown) => value as Prisma.InputJsonValue
const store: BuilderStore = {
  transaction: (work) => prisma.$transaction(async (tx: Prisma.TransactionClient) => work({
    find: (id, organizationId) => tx.channelConfig.findFirst({ where: { id, organizationId, channelType: BUILDER_CHANNEL_TYPE, isActive: false } }),
    create: (organizationId, userId, settings) => tx.channelConfig.create({ data: { organizationId, createdBy: userId, channelType: BUILDER_CHANNEL_TYPE, configName: settings.profile.label, isActive: false, settings: json(settings) } }),
    compareAndUpdate: async (row, settings) => (await tx.channelConfig.updateMany({ where: { id: row.id, organizationId: row.organizationId, channelType: BUILDER_CHANNEL_TYPE, isActive: false, updatedAt: row.updatedAt, settings: { path: ["revision"], equals: settings.revision - 1 } }, data: { configName: settings.profile.label, settings: json(settings), isActive: false } })).count,
    audit: async (entry) => { await tx.auditLog.create({ data: { organizationId: entry.organizationId, userId: entry.userId, action: entry.action, entityType: "receiver_draft", entityId: entry.entityId, newValue: json(entry.evidence) } }) },
  })),
}

export const GET = withRlsSessionAuth(async (_request, session) => {
  if (!allowedRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  try {
    const [rows, fields] = await Promise.all([
      prisma.channelConfig.findMany({ where: { organizationId: session.orgId, channelType: BUILDER_CHANNEL_TYPE, isActive: false }, orderBy: { updatedAt: "desc" }, take: 51 }) as Promise<BuilderRow[]>,
      catalogue(session.orgId),
    ])
    const drafts = rows.slice(0, 50).map((row) => publicBuilderDraft(row, session.orgId))
    const environments = [...new Set(drafts.length ? drafts.map((draft) => draft.profile.environment) : ["TEST"])]
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const environment of environments) await tx.auditLog.create({ data: { organizationId: session.orgId, userId: session.userId, action: "receiver_draft_read", entityType: "receiver_draft", newValue: { environment, profiles: drafts.filter((draft) => draft.profile.environment === environment).map((draft) => ({ id: draft.id, revision: draft.revision })), catalogueFields: fields.length } } })
    })
    return NextResponse.json({ success: true, data: { drafts, hasMore: rows.length > 50, fields, defaultProfile: defaultBuilderProfile(), externalSendingAvailable: false } }, { headers: { "Cache-Control": "no-store" } })
  } catch { return unavailable() }
})

export const POST = withRlsSessionAuth(async (request, session) => {
  if (!allowedRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await readJsonRequestWithinLimit(request, 256 * 1024)
  if (!body.ok) return NextResponse.json({ error: "Invalid or oversized request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const preview = previewSchema.safeParse(body.value)
  const save = preview.success ? null : saveSchema.safeParse(body.value)
  if (!preview.success && !save?.success) return NextResponse.json({ error: "Invalid receiver profile" }, { status: 400 })
  try {
    const fields = await catalogue(session.orgId)
    const profile = preview.success ? preview.data.profile : save!.data!.profile
    try { validateProfileCatalogue(profile, fields) } catch { return NextResponse.json({ error: "Unregistered source field" }, { status: 400 }) }
    if (preview.success) {
      let result
      try { result = previewBuilderResource({ profile, resource: preview.data.resource, ...syntheticBuilderInput(session.orgId, preview.data.resource, preview.data.sample, fields), catalogue: fields }) }
      catch (error) { return NextResponse.json({ error: "Preview validation failed", code: error instanceof Error ? error.message : "invalid_preview" }, { status: 422 }) }
      await prisma.auditLog.create({ data: { organizationId: session.orgId, userId: session.userId, action: "receiver_draft_previewed", entityType: "receiver_draft", newValue: json({ environment: profile.environment, resource: preview.data.resource, sample: preview.data.sample, bytes: result.bytes, externalSendingAvailable: false }) } })
      return NextResponse.json({ success: true, data: result })
    }
    const result = await saveBuilderDraft(store, { ...save!.data!, organizationId: session.orgId, userId: session.userId })
    return NextResponse.json({ success: true, data: result }, { status: save!.data!.id ? 200 : 201 })
  } catch (error) {
    if (error instanceof BuilderStoreError) return NextResponse.json({ error: error.code }, { status: error.code === "not_found" ? 404 : error.code === "revision_conflict" ? 409 : 400 })
    return unavailable()
  }
})
