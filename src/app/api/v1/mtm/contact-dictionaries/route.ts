import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  ContactDictionaryCreateSchema,
  contactDictionaryHash,
} from "@/lib/mtm/contact-dictionary"
import {
  CONTACT_DICTIONARY_ADMIN_REQUIRED,
  contactDictionaryDate,
  requireCurrentContactDictionaryAdministrator,
  resolveContactDictionaryActor,
  resolveContactDictionaryAdministrator,
} from "@/lib/mtm/contact-dictionary-admin"

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Contact dictionary configuration is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_CONTACT_DICTIONARY_WEB_ONLY"
      : "MTM_CONTACT_DICTIONARY_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const actor = await resolveContactDictionaryActor(prisma, auth)
  if (!actor) return accessDenied(auth)
  const canConfigure = actor.role === "ADMIN"
  const dictionaries = await prisma.mtmContactDictionary.findMany({
    where: { organizationId: auth.orgId, ...(canConfigure ? {} : { status: "ACTIVE" }) },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  })
  return NextResponse.json({ success: true, data: { dictionaries, capabilities: { canConfigure } } })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveContactDictionaryAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(ContactDictionaryCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const entriesHash = contactDictionaryHash(parsed.data.entries)
  try {
    const dictionary = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const actor = await requireCurrentContactDictionaryAdministrator(tx as typeof prisma, auth)
      const created = await tx.mtmContactDictionary.create({
        data: {
          organizationId: auth.orgId,
          kind: parsed.data.kind,
          version: parsed.data.version,
          nameRu: parsed.data.nameRu,
          nameAz: parsed.data.nameAz,
          nameEn: parsed.data.nameEn,
          schemaVersion: 1,
          entries: parsed.data.entries as unknown as Prisma.InputJsonValue,
          entriesHash,
          sourceSystem: parsed.data.sourceSystem,
          sourceReference: parsed.data.sourceReference,
          sourceObservedAt: new Date(parsed.data.sourceObservedAt),
          effectiveFrom: contactDictionaryDate(parsed.data.effectiveFrom),
          status: "DRAFT",
          createdByUserId: auth.userId,
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "CONTACT_DICTIONARY_DRAFT_CREATED",
          entity: "mtm_contact_dictionary",
          entityId: created.id,
          metadataKind: "contact_dictionary_configuration",
          newData: {
            kind: created.kind,
            version: created.version,
            entriesHash: created.entriesHash,
            entryCount: parsed.data.entries.length,
            sourceSystem: created.sourceSystem,
            sourceReference: created.sourceReference,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: dictionary }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === CONTACT_DICTIONARY_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "This dictionary kind and version already exist",
        code: "MTM_CONTACT_DICTIONARY_VERSION_EXISTS",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Dictionary creation conflicted with another change",
        code: "MTM_CONTACT_DICTIONARY_CAS_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/contact-dictionaries POST]", error)
    return NextResponse.json({
      error: "Failed to create contact dictionary draft",
      code: "MTM_CONTACT_DICTIONARY_CREATE_FAILED",
    }, { status: 500 })
  }
})
