#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { makeScriptPrisma } from "./_rls.mjs"

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=")
  return [key.replace(/^--/, ""), rest.length ? rest.join("=") : "1"]
}))

const slug = args.get("slug") || "brandprotection"
const subjectName = args.get("subject") || "Araz Supermarket"
const requestedSubjectId = String(args.get("subject-id") || "").trim()
const requestedHandles = String(args.get("handle") || "")
  .split(",")
  .map(normalizedIdentity)
  .filter(Boolean)
const execute = args.has("execute")
const confirm = args.get("confirm") || ""
const backupDir = args.get("backup-dir") || "backups"
const matcherVersion = args.get("matcher-version") || "official_author_backfill_v2_handle_alias"
const dryRunLimit = Number(args.get("sample") || "12")

function usage() {
  console.log([
    "Usage:",
    "  node scripts/backfill-social-official-authors.mjs --slug=brandprotection --subject-id=<id> --handle=arazsupermarket",
    "  node scripts/backfill-social-official-authors.mjs --slug=brandprotection --subject-id=<id> --handle=arazsupermarket --execute --confirm=brandprotection",
    "",
    "Dry-run is the default. Execute writes a timestamped JSON backup before any DB update.",
  ].join("\n"))
}

function normalizedIdentity(value) {
  return (value || "").normalize("NFKC").trim().replace(/^@/, "").toLocaleLowerCase()
}

function profileHandle(url) {
  if (!url) return null
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean)
    const candidate = normalizedIdentity(parts.at(-1))
    return candidate && !["profile.php", "pages", "posts", "reel", "watch", "share", "photo", "groups", "people", "story.php"].includes(candidate)
      ? candidate
      : null
  } catch {
    return null
  }
}

function isCommentLike(mention) {
  const sourceType = String(mention.sourceType || "").toLowerCase()
  const contentKind = String(mention.contentKind || "").toUpperCase()
  return sourceType === "comment" || sourceType === "reply" || contentKind === "COMMENT" || contentKind === "REPLY"
}

function officialUrlMatch(value, identities) {
  if (!value) return false
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean).map(normalizedIdentity)
    return parts.some((part) =>
      !["profile.php", "pages", "posts", "reel", "watch", "share", "photo", "groups", "people", "story.php"].includes(part)
      && identities.has(part),
    )
  } catch {
    return false
  }
}

function officialAuthorMatch(mention, identities) {
  const handle = normalizedIdentity(mention.authorHandle)
  return handle ? identities.has(handle) : false
}

async function main() {
  if (args.has("help")) {
    usage()
    return
  }
  if (execute && confirm !== slug) {
    throw new Error(`execute requires --confirm=${slug}`)
  }
  if (execute && !requestedSubjectId) {
    throw new Error("execute requires --subject-id to avoid an ambiguous name match")
  }

  const prisma = await makeScriptPrisma()
  try {
    const org = await prisma.organization.findFirst({
      where: { slug },
      select: { id: true, slug: true, name: true },
    })
    if (!org) throw new Error(`tenant_not_found:${slug}`)

    const subjects = await prisma.monitoringSubject.findMany({
      where: {
        organizationId: org.id,
        status: { not: "deleted" },
        ...(requestedSubjectId ? { id: requestedSubjectId } : { name: subjectName }),
      },
      take: 2,
      select: {
        id: true,
        name: true,
        aliasesVersion: true,
        aliases: {
          where: { kind: "HANDLE", isNegative: false },
          select: { id: true, kind: true, value: true, normalizedValue: true },
        },
        sources: {
          where: {
            source: { sourceType: { in: ["profile", "page"] } },
            OR: [
              { relationType: { in: ["OWNED", "OFFICIAL"] } },
              { source: { ownership: "owned" } },
            ],
          },
          select: {
            id: true,
            relationType: true,
            sourceId: true,
            source: { select: { id: true, platform: true, sourceType: true, ownership: true, handle: true, url: true, query: true } },
          },
        },
      },
    })
    if (subjects.length === 0) throw new Error(`subject_not_found:${requestedSubjectId || subjectName}`)
    if (subjects.length > 1) throw new Error(`subject_ambiguous_use_subject_id:${subjectName}`)
    const subject = subjects[0]

    const identities = new Set(requestedHandles)
    for (const alias of subject.aliases) {
      identities.add(normalizedIdentity(alias.normalizedValue || alias.value))
    }
    for (const link of subject.sources) {
      if (link.source.handle) identities.add(normalizedIdentity(link.source.handle))
      const fromUrl = profileHandle(link.source.url)
      if (fromUrl) identities.add(normalizedIdentity(fromUrl))
    }
    identities.delete("")
    if (identities.size === 0) throw new Error("official_identity_not_found")
    const existingHandleIdentities = new Set(subject.aliases.map((alias) => normalizedIdentity(alias.normalizedValue || alias.value)))
    const handleAliasesToCreate = requestedHandles.filter((handle) => !existingHandleIdentities.has(handle))

    const matches = await prisma.socialMentionSubjectMatch.findMany({
      where: { organizationId: org.id, subjectId: subject.id, status: "MATCHED" },
      select: {
        id: true,
        mentionId: true,
        status: true,
        reason: true,
        confidence: true,
        matcherVersion: true,
        matchedAliasIds: true,
        contextSignals: true,
        mention: {
          select: {
            id: true,
            platform: true,
            sourceType: true,
            contentKind: true,
            sourceProvider: true,
            authorName: true,
            authorHandle: true,
            url: true,
            parentPostUrl: true,
            externalId: true,
            matchedTerm: true,
            publishedAt: true,
          },
        },
      },
    })

    const officialMatches = matches.filter(({ mention }) => {
      if (isCommentLike(mention)) return false
      // Parent lineage is not author identity: a third party may quote or
      // repost an official publication. Only the mention's own author fields
      // and exact handle segments in its own permalink are authoritative.
      return officialAuthorMatch(mention, identities) || officialUrlMatch(mention.url, identities)
    })
    const comments = matches.filter(({ mention }) => isCommentLike(mention))
    const officialLinkUpdates = subject.sources.filter((link) => link.relationType === "MONITORS")

    const summary = {
      mode: execute ? "execute" : "dry-run",
      tenant: { slug: org.slug, name: org.name },
      subject: { id: subject.id, name: subject.name },
      officialIdentities: [...identities].sort(),
      handleAliasesToCreate,
      officialLinkUpdates: officialLinkUpdates.map((link) => ({
        id: link.id,
        from: link.relationType,
        to: "OFFICIAL",
        source: link.source,
      })),
      matchedRows: matches.length,
      reclassifyOfficialNonComment: officialMatches.length,
      preserveMatchedComments: comments.length,
      sample: officialMatches.slice(0, dryRunLimit).map(({ id, mention }) => ({
        matchId: id,
        mentionId: mention.id,
        platform: mention.platform,
        sourceType: mention.sourceType,
        contentKind: mention.contentKind,
        authorName: mention.authorName,
        authorHandle: mention.authorHandle,
        url: mention.url,
        parentPostUrl: mention.parentPostUrl,
      })),
    }

    if (!execute) {
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    await mkdir(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T").replace("Z", "Z")
    const backupPath = path.join(backupDir, `social-official-authors-${slug}-${subject.id}-${timestamp}.json`)
    await writeFile(backupPath, JSON.stringify({
      ...summary,
      officialMatches,
      subjectSourceLinks: subject.sources,
      subjectHandleAliases: subject.aliases,
    }, null, 2))

    const result = await prisma.$transaction(async (tx) => {
      const aliasResult = handleAliasesToCreate.length > 0
        ? await tx.monitoringSubjectAlias.createMany({
            data: handleAliasesToCreate.map((handle) => ({
              organizationId: org.id,
              subjectId: subject.id,
              kind: "HANDLE",
              value: handle,
              normalizedValue: handle,
              weight: 1,
              isNegative: false,
              isAmbiguous: false,
            })),
            skipDuplicates: true,
          })
        : { count: 0 }
      if (aliasResult.count > 0) {
        await tx.monitoringSubject.update({
          where: { organizationId_id: { organizationId: org.id, id: subject.id } },
          data: { aliasesVersion: { increment: 1 } },
        })
      }
      const sourceUpdates = await Promise.all(officialLinkUpdates.map((link) =>
        tx.monitoringSubjectSource.update({
          where: { id: link.id },
          data: { relationType: "OFFICIAL" },
          select: { id: true },
        }),
      ))

      const matchUpdates = await Promise.all(officialMatches.map((match) =>
        tx.socialMentionSubjectMatch.update({
          where: { id: match.id },
          data: {
            status: "REJECTED",
            reason: "official_author_excluded_backfill",
            confidence: Math.max(Number(match.confidence || 0), 1),
            matcherVersion,
            contextSignals: {
              ...(match.contextSignals && typeof match.contextSignals === "object" && !Array.isArray(match.contextSignals) ? match.contextSignals : {}),
              backfill: {
                reason: "official_author_excluded_backfill",
                source: "scripts/backfill-social-official-authors.mjs",
                backupPath,
                decidedAt: new Date().toISOString(),
              },
            },
          },
          select: { id: true },
        }),
      ))

      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          action: "backfill",
          entityType: "social_official_authors",
          entityId: subject.id,
          entityName: subject.name,
          oldValue: {
            aliasesVersion: subject.aliasesVersion,
            handleAliases: subject.aliases,
            sourceRelationTypes: subject.sources.map((link) => ({ id: link.id, relationType: link.relationType })),
            matchedRows: matches.length,
          },
          newValue: {
            backupPath,
            createdHandleAliases: handleAliasesToCreate,
            officialSourceLinks: sourceUpdates.length,
            reclassifiedMatches: matchUpdates.length,
            preservedMatchedComments: comments.length,
            matcherVersion,
          },
        },
      })

      return { handleAliases: aliasResult.count, sourceUpdates: sourceUpdates.length, matchUpdates: matchUpdates.length }
    })

    console.log(JSON.stringify({ ...summary, backupPath, applied: result }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`[backfill-social-official-authors] ${error.message}`)
  process.exit(1)
})
