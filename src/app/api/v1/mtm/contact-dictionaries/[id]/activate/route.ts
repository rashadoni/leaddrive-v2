import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  ContactDictionaryActivateSchema,
  ContactDictionaryEntriesSchema,
  contactDictionaryHash,
  contactDictionarySignatureIsCoherent,
} from "@/lib/mtm/contact-dictionary"
import {
  CONTACT_DICTIONARY_ADMIN_REQUIRED,
  requireCurrentContactDictionaryAdministrator,
  resolveContactDictionaryAdministrator,
} from "@/lib/mtm/contact-dictionary-admin"

type RouteContext = { params: Promise<{ id: string }> }

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

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  if (!await resolveContactDictionaryAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(ContactDictionaryActivateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const expectedEntriesHash = parsed.data.expectedEntriesHash.toLowerCase()
  const { id } = await params

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-contact-dictionary-activation:${auth.orgId}`}, 0))`
      const actor = await requireCurrentContactDictionaryAdministrator(tx as typeof prisma, auth)
      const current = await tx.mtmContactDictionary.findFirst({ where: { id, organizationId: auth.orgId } })
      if (!current) return { kind: "NOT_FOUND" as const }

      const entries = ContactDictionaryEntriesSchema.safeParse(current.entries)
      if (!entries.success || current.entriesHash !== contactDictionaryHash(entries.data)) {
        return { kind: "DEFINITION_INVALID" as const }
      }
      if (current.entriesHash.toLowerCase() !== expectedEntriesHash) {
        return { kind: "HASH_CONFLICT" as const, actualEntriesHash: current.entriesHash }
      }
      if (current.status === "ACTIVE") {
        if (!contactDictionarySignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }
        if (current.approvalReference !== parsed.data.approvalReference) {
          return { kind: "SIGNATURE_CONFLICT" as const }
        }
        return { kind: "OK" as const, dictionary: current, idempotent: true }
      }
      if (current.status !== "DRAFT") return { kind: "STATE_CONFLICT" as const, status: current.status }
      if (!contactDictionarySignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }

      const signedAt = new Date()
      const previousActive = await tx.mtmContactDictionary.findFirst({
        where: { organizationId: auth.orgId, kind: current.kind, status: "ACTIVE", id: { not: current.id } },
        select: { id: true, version: true },
      })
      const retired = await tx.mtmContactDictionary.updateMany({
        where: { organizationId: auth.orgId, kind: current.kind, status: "ACTIVE", id: { not: current.id } },
        data: { status: "RETIRED", retiredAt: signedAt },
      })
      if (previousActive && retired.count !== 1) throw new Error("MTM_CONTACT_DICTIONARY_CAS_CONFLICT")

      const changed = await tx.mtmContactDictionary.updateMany({
        where: {
          id: current.id,
          organizationId: auth.orgId,
          status: "DRAFT",
          entriesHash: expectedEntriesHash,
          approvalReference: null,
          signedByUserId: null,
          signedAt: null,
          activatedAt: null,
          retiredAt: null,
        },
        data: {
          status: "ACTIVE",
          approvalReference: parsed.data.approvalReference,
          signedByUserId: auth.userId,
          signedAt,
          activatedAt: signedAt,
        },
      })
      if (changed.count !== 1) throw new Error("MTM_CONTACT_DICTIONARY_CAS_CONFLICT")

      const activated = await tx.mtmContactDictionary.findFirst({ where: { id: current.id, organizationId: auth.orgId } })
      if (!activated || !contactDictionarySignatureIsCoherent(activated)) {
        throw new Error("MTM_CONTACT_DICTIONARY_SIGNATURE_WRITE_INCOHERENT")
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "CONTACT_DICTIONARY_ACTIVATED",
          entity: "mtm_contact_dictionary",
          entityId: activated.id,
          metadataKind: "contact_dictionary_configuration",
          oldData: { status: current.status, entriesHash: current.entriesHash },
          newData: {
            status: activated.status,
            kind: activated.kind,
            version: activated.version,
            entriesHash: activated.entriesHash,
            approvalReference: activated.approvalReference,
            signedByUserId: activated.signedByUserId,
            signedAt: activated.signedAt!.toISOString(),
            retiredDictionaryId: previousActive?.id ?? null,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, dictionary: activated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Contact dictionary not found", code: "MTM_CONTACT_DICTIONARY_NOT_FOUND" }, { status: 404 })
    }
    if (result.kind === "DEFINITION_INVALID" || result.kind === "SIGNATURE_INCOHERENT") {
      return NextResponse.json({ error: "Stored contact dictionary signature is not coherent", code: "MTM_CONTACT_DICTIONARY_SIGNATURE_INCOHERENT" }, { status: 409 })
    }
    if (result.kind === "HASH_CONFLICT") {
      return NextResponse.json({
        error: "Contact dictionary entries changed since review",
        code: "MTM_CONTACT_DICTIONARY_HASH_CONFLICT",
        actualEntriesHash: result.actualEntriesHash,
      }, { status: 409 })
    }
    if (result.kind === "SIGNATURE_CONFLICT") {
      return NextResponse.json({ error: "Dictionary is active under a different approval reference", code: "MTM_CONTACT_DICTIONARY_SIGNATURE_CONFLICT" }, { status: 409 })
    }
    if (result.kind === "STATE_CONFLICT") {
      return NextResponse.json({ error: "Only draft dictionaries can be activated", code: "MTM_CONTACT_DICTIONARY_STATE_CONFLICT", status: result.status }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: result.dictionary, idempotent: result.idempotent })
  } catch (error) {
    if (error instanceof Error && error.message === CONTACT_DICTIONARY_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Error && error.message === "MTM_CONTACT_DICTIONARY_CAS_CONFLICT") {
      return NextResponse.json({ error: "Dictionary changed concurrently; reload before activation", code: "MTM_CONTACT_DICTIONARY_CAS_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({ error: "Dictionary activation conflicted with another change", code: "MTM_CONTACT_DICTIONARY_CAS_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/contact-dictionaries activate]", error)
    return NextResponse.json({ error: "Failed to activate contact dictionary", code: "MTM_CONTACT_DICTIONARY_ACTIVATION_FAILED" }, { status: 500 })
  }
})
