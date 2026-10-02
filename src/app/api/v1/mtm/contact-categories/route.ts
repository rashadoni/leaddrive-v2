import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { contactDictionaryHash } from "@/lib/mtm/contact-dictionary"
import {
  CONTACT_DICTIONARY_ADMIN_REQUIRED,
  contactDictionaryDate,
  requireCurrentContactDictionaryAdministrator,
  resolveContactDictionaryActor,
  resolveContactDictionaryAdministrator,
} from "@/lib/mtm/contact-dictionary-admin"
import {
  CONTACT_CATEGORY_APPROVAL_REFERENCE,
  CONTACT_CATEGORY_SOURCE_SYSTEM,
} from "@/lib/mtm/contact-category-editor"
import {
  CONTACT_CATEGORY_DICTIONARY_NAMES,
  ContactCategoriesSaveSchema,
  contactCategoriesOrDefault,
  contactCategoryRemovalsInUse,
  parseStoredContactCategories,
  readContactCategoryUsage,
} from "@/lib/mtm/contact-categories"

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Client categories are configured only in the web application"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_CONTACT_CATEGORIES_WEB_ONLY"
      : "MTM_CONTACT_CATEGORIES_ADMIN_REQUIRED",
  }, { status: 403 })
}

const ACTIVE_CLIENT_TYPE = { kind: "CLIENT_TYPE" as const, status: "ACTIVE" as const }

/**
 * GET /api/v1/mtm/contact-categories
 * The tenant's client categories with their own fields. A tenant that has not
 * configured any gets the three built-in types, so every screen can render
 * one list instead of branching on "is there a dictionary".
 */
export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const actor = await resolveContactDictionaryActor(prisma, auth)
  if (!actor) return accessDenied(auth)
  const canConfigure = actor.role === "ADMIN"
  const active = await prisma.mtmContactDictionary.findFirst({
    where: { organizationId: auth.orgId, ...ACTIVE_CLIENT_TYPE },
    select: { id: true, version: true, entries: true, updatedAt: true },
  })
  const stored = active ? parseStoredContactCategories(active.entries) : null
  // Tenant-wide counts are an administrator's view; a scoped agent must not
  // learn how many contacts exist outside their territory.
  const usage = canConfigure ? await readContactCategoryUsage(prisma, auth.orgId) : null
  return NextResponse.json({
    success: true,
    data: {
      dictionaryId: active?.id ?? null,
      version: active?.version ?? null,
      configured: Boolean(active && stored),
      categories: contactCategoriesOrDefault(stored),
      usage,
      capabilities: { canConfigure },
    },
  })
})

/**
 * PUT /api/v1/mtm/contact-categories
 * Replaces the tenant's categories in one step: the previous signed version is
 * retired and the new one is active before the response returns.
 */
export const PUT = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveContactDictionaryAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(ContactCategoriesSaveSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const categories = parsed.data.categories.map((category) => ({ ...category, fields: category.fields ?? [] }))
  const entriesHash = contactDictionaryHash(categories)

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Same lock as manual activation: the two ways of activating a
      // dictionary must not interleave.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-contact-dictionary-activation:${auth.orgId}`}, 0))`
      const actor = await requireCurrentContactDictionaryAdministrator(tx as typeof prisma, auth)
      const active = await tx.mtmContactDictionary.findFirst({
        where: { organizationId: auth.orgId, ...ACTIVE_CLIENT_TYPE },
      })
      if ((active?.id ?? null) !== parsed.data.expectedDictionaryId) {
        return { kind: "STALE" as const }
      }

      const previous = contactCategoriesOrDefault(active ? parseStoredContactCategories(active.entries) : null)
      const usage = await readContactCategoryUsage(tx, auth.orgId)
      const inUse = contactCategoryRemovalsInUse(previous, categories, usage)
      if (inUse.length > 0) return { kind: "IN_USE" as const, inUse }

      if (active && active.entriesHash === entriesHash) {
        return { kind: "OK" as const, dictionary: active, changed: false }
      }

      const now = new Date()
      const latest = await tx.mtmContactDictionary.findFirst({
        where: { organizationId: auth.orgId, kind: "CLIENT_TYPE" },
        orderBy: { version: "desc" },
        select: { version: true },
      })
      // The partial unique index allows one ACTIVE row per kind, so the old
      // version has to leave that state before the new one enters it.
      if (active) {
        const retired = await tx.mtmContactDictionary.updateMany({
          where: { id: active.id, organizationId: auth.orgId, status: "ACTIVE" },
          data: { status: "RETIRED", retiredAt: now },
        })
        if (retired.count !== 1) throw new Error("MTM_CONTACT_CATEGORIES_CONFLICT")
      }
      const created = await tx.mtmContactDictionary.create({
        data: {
          organizationId: auth.orgId,
          kind: "CLIENT_TYPE",
          version: (latest?.version ?? 0) + 1,
          nameRu: active?.nameRu ?? CONTACT_CATEGORY_DICTIONARY_NAMES.nameRu,
          nameAz: active?.nameAz ?? CONTACT_CATEGORY_DICTIONARY_NAMES.nameAz,
          nameEn: active?.nameEn ?? CONTACT_CATEGORY_DICTIONARY_NAMES.nameEn,
          schemaVersion: 1,
          entries: categories as unknown as Prisma.InputJsonValue,
          entriesHash,
          sourceSystem: CONTACT_CATEGORY_SOURCE_SYSTEM,
          sourceObservedAt: now,
          // The contact card only offers a dictionary whose effective date is
          // not after the tenant's own "today".
          effectiveFrom: contactDictionaryDate(currentDateKey(now, timezone)),
          status: "ACTIVE",
          approvalReference: CONTACT_CATEGORY_APPROVAL_REFERENCE,
          createdByUserId: auth.userId,
          signedByUserId: auth.userId,
          signedAt: now,
          activatedAt: now,
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "CONTACT_CATEGORIES_SAVED",
          entity: "mtm_contact_dictionary",
          entityId: created.id,
          metadataKind: "contact_dictionary_configuration",
          ...(active ? {
            oldData: { dictionaryId: active.id, version: active.version, entriesHash: active.entriesHash },
          } : {}),
          newData: {
            kind: created.kind,
            version: created.version,
            entriesHash: created.entriesHash,
            categories: categories.map((category) => ({
              code: category.code,
              fields: category.fields.map((field) => field.key),
            })),
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, dictionary: created, changed: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "STALE") {
      return NextResponse.json({
        error: "Client categories were changed by someone else; reload before saving",
        code: "MTM_CONTACT_CATEGORIES_STALE",
      }, { status: 409 })
    }
    if (result.kind === "IN_USE") {
      return NextResponse.json({
        error: "A category that still has contacts cannot be removed",
        code: "MTM_CONTACT_CATEGORY_IN_USE",
        data: { inUse: result.inUse },
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: {
        dictionaryId: result.dictionary.id,
        version: result.dictionary.version,
        configured: true,
        categories,
        changed: result.changed,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === CONTACT_DICTIONARY_ADMIN_REQUIRED) return accessDenied(auth)
    if (
      (error instanceof Error && error.message === "MTM_CONTACT_CATEGORIES_CONFLICT")
      || (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034"))
    ) {
      return NextResponse.json({
        error: "Client categories were changed by someone else; reload before saving",
        code: "MTM_CONTACT_CATEGORIES_STALE",
      }, { status: 409 })
    }
    console.error("[MTM/contact-categories PUT]", error)
    return NextResponse.json({
      error: "Failed to save client categories",
      code: "MTM_CONTACT_CATEGORIES_SAVE_FAILED",
    }, { status: 500 })
  }
})
