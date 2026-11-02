/**
 * CLM Slice 2d-2 — E-sign reminder cron.
 *
 * POST /api/cron/esign-reminders
 * Protected by x-cron-secret (same pattern as renewal-alerts, mtm-cleanup, etc.)
 *
 * Logic:
 *  1. Find pending signers: status in (sent, viewed), envelope not expired/completed/
 *     voided/declined, remindersSent < MAX_REMINDERS, and due for a reminder
 *     (lastRemindedAt is null AND sentAt older than REMINDER_INTERVAL_DAYS,
 *      OR lastRemindedAt older than REMINDER_INTERVAL_DAYS).
 *  2. Respect sequential signing order: skip signers who are still waiting for
 *     an earlier signer (same logic as the sign POST route).
 *  3. Re-issue a fresh HMAC token (overwrite tokenHash → old link dies, new link works).
 *  4. Best-effort email the new signing link. On failure: continue batch, count error.
 *  5. Update lastRemindedAt = now, remindersSent += 1.
 *  6. Return summary { remindersSent, skipped, errors, timestamp }.
 *
 * SECURITY:
 *  - Raw token is NEVER stored in DB; only the HMAC hash (tokenHash) is stored.
 *  - Re-issue overwrites tokenHash, invalidating the previous link.
 *  - ESIGN_SECRET must be set; if missing the cron returns 503 (misconfiguration).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { issueToken } from "@/lib/esign/token-issuer"
import { sendEmail } from "@/lib/email"
import { runWithRlsBypass } from "@/lib/rls-context"
import { signingEmail } from "@/lib/contract-lifecycle/notification-text"
import { organizationLocale } from "@/lib/ticketing/customer-locale"

export const dynamic = "force-dynamic"

const MAX_REMINDERS = 3
const REMINDER_INTERVAL_DAYS = 3
const BATCH_LIMIT = 500

// Terminal envelope statuses — don't remind for these
const ENVELOPE_TERMINAL = ["completed", "declined", "voided", "expired"]

// Active signer statuses eligible for reminders
const SIGNER_REMINDABLE = ["sent", "viewed"]

export async function POST(req: NextRequest) {
  // Authenticate before entering the bypass: an unauthenticated request must
  // never reach a context that can see every tenant.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const esignSecret = process.env.ESIGN_SECRET
  if (!esignSecret) {
    return NextResponse.json({ error: "ESIGN_SECRET not configured" }, { status: 503 })
  }
  // The deploy proves the schedule answers, and can sign links, without sending.
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({ success: true, data: { smoke: true } })
  }

  return runWithRlsBypass(async () => {

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://app.leaddrivecrm.org"

  const now = new Date()
  const intervalMs = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  const intervalCutoff = new Date(now.getTime() - intervalMs)

  const results = { remindersSent: 0, skipped: 0, errors: 0 }
  // A signer is outside the CRM: the reminder speaks the organization's language.
  const localeByOrg = new Map<string, ReturnType<typeof organizationLocale>>()
  const localeOf = async (organizationId: string) => {
    const known = localeByOrg.get(organizationId)
    if (known) return known
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
    const locale = organizationLocale(organization?.settings)
    localeByOrg.set(organizationId, locale)
    return locale
  }

  try {
    // Fetch candidates: pending signers with a non-terminal envelope.
    // We filter remindersSent < MAX_REMINDERS and timing at the app layer
    // (some DBs handle nullable comparisons awkwardly in Prisma).
    const candidates = await prisma.esignSigner.findMany({
      where: {
        status: { in: SIGNER_REMINDABLE },
        remindersSent: { lt: MAX_REMINDERS },
        envelope: {
          status: { notIn: ENVELOPE_TERMINAL },
          // Only remind for envelopes that are not yet expired
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
      },
      include: {
        envelope: {
          select: {
            id: true,
            organizationId: true,
            subject: true,
            expiresAt: true,
            status: true,
            sentAt: true,
          },
        },
      },
      take: BATCH_LIMIT,
      orderBy: { createdAt: "asc" },
    })

    for (const signer of candidates) {
      const envelope = signer.envelope

      // Timing check: must be due for a reminder
      const sentAt = envelope.sentAt ?? signer.createdAt
      const lastRemindedAt = signer.lastRemindedAt
      const isDue =
        (lastRemindedAt === null && sentAt <= intervalCutoff) ||
        (lastRemindedAt !== null && lastRemindedAt <= intervalCutoff)
      if (!isDue) {
        results.skipped++
        continue
      }

      // Order check: skip if this signer is still waiting for an earlier signer.
      // Only role=signer can be blocked; cc/copy are always eligible.
      if (signer.role === "signer") {
        let earlierUnsigned = 0
        try {
          earlierUnsigned = await prisma.esignSigner.count({
            where: {
              envelopeId: signer.envelopeId,
              role: "signer",
              order: { lt: signer.order },
              status: { not: "signed" },
            },
          })
        } catch {
          results.errors++
          continue
        }
        if (earlierUnsigned > 0) {
          results.skipped++
          continue
        }
      }

      // Re-issue a fresh HMAC token. exp = envelope.expiresAt (if set) or
      // 30 days from now as a safe fallback.
      const expUnix = envelope.expiresAt
        ? Math.floor(envelope.expiresAt.getTime() / 1000)
        : Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60

      let rawToken: string
      let newTokenHash: string
      try {
        const issued = issueToken({
          claims: { eid: signer.envelopeId, sid: signer.id, exp: expUnix },
          secret: esignSecret,
        })
        rawToken = issued.token
        newTokenHash = issued.tokenHash
      } catch (err) {
        console.error(`[esign-reminders] issueToken failed for signer ${signer.id}:`, err)
        results.errors++
        continue
      }

      // FIX 7 (LOW): Conditional write — only update if signer is still active
      // and remindersSent hasn't changed since selection. This prevents:
      //   (a) Emailing a dead link to a signer who signed between select + write.
      //   (b) Concurrent cron instances double-processing / exceeding MAX_REMINDERS.
      // If count === 0 the signer flipped terminal → skip email (token not written).
      let writeCount = 0
      try {
        const writeResult = await prisma.esignSigner.updateMany({
          where: {
            id: signer.id,
            status: { in: SIGNER_REMINDABLE },
            remindersSent: signer.remindersSent ?? 0,
            envelope: { status: { notIn: ENVELOPE_TERMINAL } },
          },
          data: {
            tokenHash: newTokenHash,
            lastRemindedAt: now,
            remindersSent: { increment: 1 },
          },
        })
        writeCount = writeResult.count
      } catch (err) {
        console.error(`[esign-reminders] DB update failed for signer ${signer.id}:`, err)
        results.errors++
        continue
      }

      if (writeCount === 0) {
        // Signer signed/declined/expired between selection and write, or another
        // cron instance already processed this signer — skip email entirely so
        // we don't send a link that references a cleared tokenHash.
        results.skipped++
        continue
      }

      // Best-effort email the new signing link
      const signingUrl = `${baseUrl}/sign/${rawToken}`
      try {
        const email = signingEmail(await localeOf(signer.organizationId), {
          kind: "reminder",
          fullName: signer.fullName,
          subject: envelope.subject,
          signingLink: signingUrl,
        })
        await sendEmail({
          to: signer.email,
          subject: email.subject,
          html: email.html,
          organizationId: signer.organizationId,
          transactional: true,
        })
      } catch (err) {
        // Best-effort: token is already rotated; log but don't fail the batch entry
        console.error(`[esign-reminders] email send failed for signer ${signer.id}:`, err)
        // Do NOT increment errors here — the token was successfully rotated
        // which is the critical part. The old link is dead; re-run will send again.
      }

      // Audit: only append if "token_issued" is a valid AUDIT_EVENT_TYPES member.
      // Spec says: skip audit if no suitable eventType exists — do NOT expand enum.
      // "token_issued" IS in AUDIT_EVENT_TYPES, so we can use it.
      try {
        await prisma.esignAuditEvent.create({
          data: {
            organizationId: signer.organizationId,
            envelopeId: signer.envelopeId,
            signerId: signer.id,
            eventType: "token_issued",
            actorType: "system",
            actorId: null,
            ipAddress: null,
            userAgent: null,
            metadata: { reason: "reminder", remindersSent: (signer.remindersSent ?? 0) + 1 },
            createdAt: now,
          },
        })
      } catch {
        // Audit is non-fatal
      }

      results.remindersSent++
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (err) {
    console.error("[esign-reminders] cron error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
