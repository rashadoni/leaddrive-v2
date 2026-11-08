/**
 * Social Monitoring keeps nothing older than 30 days (owner, 2026-11-08:
 * «чтоб не было информации больше 30и дней. не харнилась вообще нигде»).
 *
 * The real nightly pass runs against a real Postgres built from schema.prisma
 * plus the two auto-review ledger triggers, taken verbatim from their
 * migrations: the original 2026-07-23 definitions first, then the 30-day
 * migration that lets the pass delete under its own flag. What has to hold:
 * - every collected row older than 30 days is gone — mentions with what hangs
 *   off them, envelopes, media observations and their cached preview files,
 *   clusters, collector runs, the auto-review ledger, rejected fingerprints,
 *   completed deletion-ledger rows, coverage alerts, module notifications;
 * - a mention published more than 30 days ago goes even if it was stored
 *   yesterday;
 * - everything fresh stays, a fresh mention leaves a dying cluster instead of
 *   being deleted with it, and a pending provider deletion stays owed;
 * - configuration (sources, subjects) and the omnichannel inbox
 *   (`social_conversations`) are not collected material and are untouched;
 * - outside the pass the ledger triggers still reject a direct DELETE.
 *
 * Set SOCIAL_RETENTION_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   SOCIAL_RETENTION_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped; CI runs it in `static-checks` with
 * SOCIAL_RETENTION_DB_GATE=required, so a missing URL fails instead.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SOCIAL_RETENTION_TEST_DATABASE_URL
if (!adminUrl && process.env.SOCIAL_RETENTION_DB_GATE === "required") {
  throw new Error("SOCIAL_RETENTION_TEST_DATABASE_URL is required by the social monitoring retention database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.SOCIAL_RETENTION_TEST_DATABASE_URL
  if (!admin) return null
  const name = `social_retention_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  // Preview cache files land in a throwaway runtime root (created on first write).
  const runtime = `${process.env.TMPDIR || "/tmp"}/social-retention-runtime-${process.pid}-${Date.now()}`
  process.env.LEADDRIVE_RUNTIME_DIR = runtime
  process.env.LEADDRIVE_LOG_DIR = `${runtime}-logs`
  return { name, url: url.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-retention"
const NOW = new Date("2026-11-08T12:00:00.000Z")
const OLD = new Date("2026-09-20T12:00:00.000Z")
const FRESH = new Date("2026-11-05T12:00:00.000Z")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "social-retention-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** The ledger trigger functions and triggers exactly as the 2026-07-23 migration created them. */
function originalLedgerTriggers(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20260723180000_social_discovery_auto_review_apply/migration.sql"), "utf8")
  const pieces = [
    /CREATE FUNCTION discovery_auto_review_decisions_lifecycle_fn\(\)[\s\S]*?\n\$\$;/,
    /CREATE TRIGGER discovery_auto_review_decisions_lifecycle_trigger[\s\S]*?;/,
    /CREATE FUNCTION discovery_auto_review_events_append_only_fn\(\)[\s\S]*?\n\$\$;/,
    /CREATE TRIGGER discovery_auto_review_events_append_only_trigger[\s\S]*?;/,
  ].map((pattern) => {
    const match = sql.match(pattern)
    if (!match) throw new Error(`ledger trigger not found in migration: ${pattern}`)
    return match[0]
  })
  return pieces.join("\n\n")
}

function previewPath(observationId: string): string {
  const key = createHash("sha256").update(observationId).digest("hex")
  return path.join(process.env.LEADDRIVE_RUNTIME_DIR!, "uploads", "social-media-previews", ORG, `${key}.bin`)
}

function writePreview(observationId: string) {
  const file = previewPath(observationId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, "image")
  writeFileSync(file.replace(/\.bin$/, ".mime"), "image/png")
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("social monitoring 30-day retention on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let run!: typeof import("@/lib/social/monitoring-age-retention").deleteSocialMonitoringDataBeyondRetention
  let result!: Awaited<ReturnType<typeof run>>

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, originalLedgerTriggers())
    prismaCli(["db", "execute", "--url", scratch!.url, "--file", path.join(ROOT, "prisma/migrations/20261205090000_social_monitoring_30_day_retention/migration.sql")], process.env)

    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    run = (await import("@/lib/social/monitoring-age-retention")).deleteSocialMonitoringDataBeyondRetention

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Retention", slug: ORG } })
      await prisma.user.create({ data: { id: "user-1", organizationId: ORG, email: "a@r.example", name: "A", passwordHash: "x", role: "admin" } })
      await prisma.monitoringSubject.create({ data: { id: "subject-1", organizationId: ORG, type: "BRAND", name: "Brand", createdAt: OLD } })
      await prisma.monitoringSource.create({ data: { id: "source-1", organizationId: ORG, platform: "youtube", sourceType: "keyword", collectionMode: "api", createdAt: OLD } })
      await prisma.socialConversation.create({ data: { id: "conversation-old", organizationId: ORG, platform: "instagram", externalId: "c-1", createdAt: OLD } })

      // Mentions: stored long ago; stored yesterday but published long ago; fresh.
      await prisma.socialMention.create({ data: { id: "mention-old", organizationId: ORG, platform: "youtube", externalId: "m-old", text: "old", createdAt: OLD, publishedAt: OLD } })
      await prisma.socialMention.create({ data: { id: "mention-old-post", organizationId: ORG, platform: "youtube", externalId: "m-old-post", text: "old post", createdAt: FRESH, publishedAt: OLD } })
      await prisma.socialMention.create({ data: { id: "mention-fresh", organizationId: ORG, platform: "youtube", externalId: "m-fresh", text: "fresh", createdAt: FRESH, publishedAt: FRESH } })
      await prisma.socialMentionVersion.create({ data: { organizationId: ORG, mentionId: "mention-old", version: 1, text: "old v1", capturedAt: OLD } as never })

      // A cluster whose primary mention is old still holds a fresh mention.
      await prisma.mentionCluster.create({ data: { id: "cluster-old", organizationId: ORG, clusterKey: "k-old", primaryMentionId: "mention-old", createdAt: OLD } })
      await prisma.socialMention.update({ where: { id: "mention-old" }, data: { clusterId: "cluster-old" } })
      await prisma.socialMention.update({ where: { id: "mention-fresh" }, data: { clusterId: "cluster-old" } })

      await prisma.collectorRun.create({ data: { id: "run-old", organizationId: ORG, sourceId: "source-1", claimToken: "t1", claimVersion: 1, leaseExpiresAt: OLD, startedAt: OLD, status: "success" } })
      await prisma.collectorRun.create({ data: { id: "run-fresh", organizationId: ORG, sourceId: "source-1", claimToken: "t2", claimVersion: 1, leaseExpiresAt: FRESH, startedAt: FRESH, status: "success" } })

      const envelope = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) => prisma.ingestEnvelope.create({
        data: {
          id, organizationId: ORG, adapterKey: "a", idempotencyKey: id, acquisitionMode: "API", contentKind: "POST",
          platform: "youtube", contentHmac: id, policySnapshot: {}, purgeAt: NOW, createdAt, ...extra,
        } as never,
      })
      await envelope("envelope-old", OLD, { collectorRunId: "run-old", acceptedMentionId: "mention-old" })
      await envelope("envelope-old-post", FRESH, { acceptedMentionId: "mention-old-post" })
      await envelope("envelope-fresh", FRESH, { collectorRunId: "run-fresh", acceptedMentionId: "mention-fresh" })
      await envelope("envelope-reviewed", OLD)

      // The auto-review ledger: one run, a terminal decision about an old envelope, an event.
      await prisma.discoveryAutoReviewRun.create({ data: {
        id: "review-run", organizationId: ORG, subjectId: "subject-1", idempotencyKey: "r", requestFingerprint: "f",
        resolverVersion: "v1", requestedBy: "user-1", plannedGroupCount: 1, plannedRowCount: 1, rollbackUntil: OLD, createdAt: OLD,
      } as never })
      await prisma.discoveryAutoReviewDecision.create({ data: {
        id: "review-decision", organizationId: ORG, runId: "review-run", envelopeId: "envelope-reviewed", resolverVersion: "v1",
        reason: "r", groupKeyHmac: "g", beforeStatus: "REVIEW", beforePurgeAt: OLD, beforeContentHmac: "h", beforeUpdatedAt: OLD,
        rollbackUntil: OLD, state: "SUPERSEDED", createdAt: OLD,
      } as never })
      await prisma.discoveryAutoReviewEvent.create({ data: { id: "review-event", organizationId: ORG, runId: "review-run", eventType: "APPLIED", createdAt: OLD } as never })

      const observation = (id: string, createdAt: Date, mentionId: string | null) => prisma.mediaObservation.create({
        data: {
          id, organizationId: ORG, idempotencyKey: id, mediaType: "VIDEO", sourceUrl: `https://x.example/${id}`,
          canonicalMediaUrl: `https://x.example/${id}`, contentHmac: id, purgeAt: NOW, createdAt, mentionId,
        } as never,
      })
      await observation("media-old-post", FRESH, "mention-old-post")
      await observation("media-fresh", FRESH, "mention-fresh")
      writePreview("media-old-post")
      writePreview("media-fresh")
      // A cached file whose observation is long gone.
      writePreview("media-orphan")
      utimesSync(previewPath("media-orphan"), OLD, OLD)
      utimesSync(previewPath("media-orphan").replace(/\.bin$/, ".mime"), OLD, OLD)

      await prisma.rejectedObservationFingerprint.create({ data: { id: "fp-old", organizationId: ORG, adapterKey: "a", fingerprintHmac: "fp-old", reasonCode: "r", expiresAt: NOW, firstSeenAt: OLD } as never })
      await prisma.rejectedObservationFingerprint.create({ data: { id: "fp-fresh", organizationId: ORG, adapterKey: "a", fingerprintHmac: "fp-fresh", reasonCode: "r", expiresAt: NOW, firstSeenAt: FRESH } as never })

      const ledger = (id: string, status: string, createdAt: Date) => prisma.socialDeletionLedgerEntry.create({
        data: { id, organizationId: ORG, idempotencyKey: id, targetType: "T", targetKeyHmac: id, storageScope: "DATABASE", reason: "r", dueAt: createdAt, status, createdAt } as never,
      })
      await ledger("ledger-done-old", "COMPLETED", OLD)
      await ledger("ledger-pending-old", "PENDING", OLD)
      await ledger("ledger-done-fresh", "COMPLETED", FRESH)

      await prisma.aiAlert.create({ data: { id: "alert-coverage-old", organizationId: ORG, type: "social_coverage_rule", message: "m", createdAt: OLD } as never })
      await prisma.aiAlert.create({ data: { id: "alert-coverage-fresh", organizationId: ORG, type: "social_coverage_rule", message: "m", createdAt: FRESH } as never })
      await prisma.aiAlert.create({ data: { id: "alert-other-old", organizationId: ORG, type: "deal_risk", message: "m", createdAt: OLD } as never })
      await prisma.notification.create({ data: { id: "notice-social-old", organizationId: ORG, userId: "user-1", type: "warning", title: "t", entityType: "social_mention", createdAt: OLD } as never })
      await prisma.notification.create({ data: { id: "notice-social-fresh", organizationId: ORG, userId: "user-1", type: "warning", title: "t", entityType: "social_mention", createdAt: FRESH } as never })
      await prisma.notification.create({ data: { id: "notice-other-old", organizationId: ORG, userId: "user-1", type: "info", title: "t", entityType: "task", createdAt: OLD } as never })
    })

    result = await bypass(() => run({ now: NOW, batch: 1 }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  const ids = async (table: string) => bypass(async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "${table}" ORDER BY id`)
    return rows.map((row) => row.id)
  })

  it("finishes without failures inside its budget", () => {
    expect(result.failures).toEqual([])
    expect(result.incomplete).toBe(false)
  })

  it("deletes old mentions, including a post published long ago but stored yesterday", async () => {
    expect(await ids("social_mentions")).toEqual(["mention-fresh"])
    expect(await ids("social_mention_versions")).toEqual([])
  })

  it("lets a fresh mention leave a dying cluster rather than be deleted with it", async () => {
    expect(await ids("mention_clusters")).toEqual([])
    const fresh = await bypass(() => prisma.socialMention.findUnique({ where: { id: "mention-fresh" }, select: { clusterId: true } }))
    expect(fresh?.clusterId).toBeNull()
  })

  it("deletes old envelopes, collector runs and the whole auto-review ledger", async () => {
    expect(await ids("ingest_envelopes")).toEqual(["envelope-fresh"])
    expect(await ids("collector_runs")).toEqual(["run-fresh"])
    expect(await ids("discovery_auto_review_decisions")).toEqual([])
    expect(await ids("discovery_auto_review_events")).toEqual([])
    expect(await ids("discovery_auto_review_runs")).toEqual([])
  })

  it("deletes media of old posts with their cached previews, and old orphan previews", async () => {
    expect(await ids("media_observations")).toEqual(["media-fresh"])
    expect(existsSync(previewPath("media-old-post"))).toBe(false)
    expect(existsSync(previewPath("media-orphan"))).toBe(false)
    expect(existsSync(previewPath("media-fresh"))).toBe(true)
  })

  it("deletes old fingerprints, completed ledger rows, coverage alerts and module notifications", async () => {
    expect(await ids("rejected_observation_fingerprints")).toEqual(["fp-fresh"])
    expect(await ids("social_deletion_ledger_entries")).toEqual(["ledger-done-fresh", "ledger-pending-old"])
    expect(await ids("ai_alerts")).toEqual(["alert-coverage-fresh", "alert-other-old"])
    expect(await ids("notifications")).toEqual(["notice-other-old", "notice-social-fresh"])
  })

  it("leaves configuration and the omnichannel inbox alone", async () => {
    expect(await ids("monitoring_sources")).toEqual(["source-1"])
    expect(await ids("monitoring_subjects")).toEqual(["subject-1"])
    expect(await ids("social_conversations")).toEqual(["conversation-old"])
  })

  it("still rejects a direct DELETE of the auto-review ledger outside the pass", async () => {
    await bypass(async () => {
      await prisma.discoveryAutoReviewRun.create({ data: {
        id: "review-run-2", organizationId: ORG, subjectId: "subject-1", idempotencyKey: "r2", requestFingerprint: "f",
        resolverVersion: "v1", requestedBy: "user-1", plannedGroupCount: 1, plannedRowCount: 1, rollbackUntil: OLD,
      } as never })
      await prisma.discoveryAutoReviewEvent.create({ data: { id: "review-event-2", organizationId: ORG, runId: "review-run-2", eventType: "APPLIED" } as never })
    })
    await expect(bypass(() => prisma.$executeRawUnsafe(`DELETE FROM "discovery_auto_review_events" WHERE id = 'review-event-2'`)))
      .rejects.toThrow(/append-only/)
  })
})
