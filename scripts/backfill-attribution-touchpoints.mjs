// One-shot + repeatable backfill: derive C9 CampaignTouchpoint rows from
// existing marketing data so the attribution worker has history to compute on.
//
// Sources (each row carries a deterministic sourceKey → idempotent):
//   • EmailLog   → email_sent (createdAt) / email_opened (openedAt) /
//                  email_clicked (clickedAt)         [channel "email"]
//   • EventParticipant (via Event.campaignId) → event_registered (registeredAt)
//                  + event_attended for status="attended"   [channel "event"]
//   • Deal (campaignId set) → deal_campaign_link (createdAt); contact resolved
//                  via Deal.contactId ?? primary DealContactRole [channel "other"]
//
// Writes go through createMany({ skipDuplicates }) against the partial UNIQUE
// (organizationId, sourceKey) index — re-running is a no-op for already-recorded
// touchpoints and never trips the append-only UPDATE trigger.
//
// Cross-tenant operator script → RLS bypass (makeScriptPrisma).
//
// Usage:
//   node scripts/backfill-attribution-touchpoints.mjs            # dry-run (counts only)
//   node scripts/backfill-attribution-touchpoints.mjs --execute  # actually insert

import { makeScriptPrisma } from "./_rls.mjs"

const CHUNK = 1000

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function emailRows(prisma) {
  const logs = await prisma.emailLog.findMany({
    where: { campaignId: { not: null }, contactId: { not: null } },
    select: {
      id: true, organizationId: true, contactId: true, campaignId: true,
      variantId: true, createdAt: true, openedAt: true, clickedAt: true,
    },
  })
  const rows = []
  for (const l of logs) {
    const base = {
      organizationId: l.organizationId,
      contactId: l.contactId,
      campaignId: l.campaignId,
      dealId: null,
      channel: "email",
      metadata: { variantId: l.variantId ?? undefined },
    }
    rows.push({ ...base, touchpointType: "email_sent", occurredAt: l.createdAt, sourceKey: `email:${l.id}:sent` })
    if (l.openedAt) rows.push({ ...base, touchpointType: "email_opened", occurredAt: l.openedAt, sourceKey: `email:${l.id}:opened` })
    if (l.clickedAt) rows.push({ ...base, touchpointType: "email_clicked", occurredAt: l.clickedAt, sourceKey: `email:${l.id}:clicked` })
  }
  return rows
}

async function eventRows(prisma) {
  const parts = await prisma.eventParticipant.findMany({
    where: { contactId: { not: null }, event: { campaignId: { not: null } } },
    select: {
      id: true, contactId: true, role: true, status: true, registeredAt: true,
      event: { select: { id: true, organizationId: true, campaignId: true } },
    },
  })
  const rows = []
  for (const p of parts) {
    if (!p.event?.campaignId) continue
    const base = {
      organizationId: p.event.organizationId,
      contactId: p.contactId,
      campaignId: p.event.campaignId,
      dealId: null,
      channel: "event",
      metadata: { eventId: p.event.id, role: p.role },
    }
    rows.push({ ...base, touchpointType: "event_registered", occurredAt: p.registeredAt, sourceKey: `event:${p.id}:registered` })
    if (p.status === "attended") {
      rows.push({ ...base, touchpointType: "event_attended", occurredAt: p.registeredAt, sourceKey: `event:${p.id}:attended` })
    }
  }
  return rows
}

async function dealRows(prisma) {
  const deals = await prisma.deal.findMany({
    where: { campaignId: { not: null } },
    select: {
      id: true, organizationId: true, campaignId: true, contactId: true, createdAt: true,
      // Deterministic order so the fallback pick (and dry-run counts) are
      // reproducible: primary role first, then by contactId.
      contactRoles: {
        select: { contactId: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { contactId: "asc" }],
      },
    },
  })
  const rows = []
  for (const d of deals) {
    // Resolve a contact: direct link first, else primary role, else any role.
    const primary = d.contactRoles.find((r) => r.isPrimary)?.contactId
    const any = d.contactRoles[0]?.contactId
    const contactId = d.contactId ?? primary ?? any
    if (!contactId) continue // no contact → cannot attribute (touchpoint.contactId is NOT NULL)
    rows.push({
      organizationId: d.organizationId,
      contactId,
      campaignId: d.campaignId,
      dealId: d.id,
      channel: "other",
      touchpointType: "deal_campaign_link",
      occurredAt: d.createdAt,
      sourceKey: `deal:${d.id}:campaign_link`,
      metadata: {},
    })
  }
  return rows
}

async function main() {
  const execute = process.argv.includes("--execute")
  const prisma = await makeScriptPrisma()
  try {
    const [emails, events, deals] = await Promise.all([
      emailRows(prisma),
      eventRows(prisma),
      dealRows(prisma),
    ])
    const all = [...emails, ...deals, ...events]
    console.log(
      `Derived ${all.length} candidate touchpoints ` +
      `(email=${emails.length}, event=${events.length}, deal=${deals.length}).`,
    )
    if (!execute) {
      console.log("Dry-run — pass --execute to insert (createMany skipDuplicates, idempotent).")
      return
    }
    let inserted = 0
    let quarantined = 0
    for (const part of chunk(all, CHUNK)) {
      const data = part.map((r) => ({
        organizationId: r.organizationId,
        contactId: r.contactId,
        campaignId: r.campaignId,
        dealId: r.dealId ?? null,
        channel: r.channel,
        touchpointType: r.touchpointType,
        occurredAt: r.occurredAt,
        sourceKey: r.sourceKey,
        metadata: r.metadata ?? {},
      }))
      try {
        const res = await prisma.campaignTouchpoint.createMany({ data, skipDuplicates: true })
        inserted += res.count
      } catch (e) {
        // One bad row (e.g. a deal whose campaignId points at another org —
        // the deal API doesn't validate that, so the coherence trigger rejects
        // it) would otherwise fail the whole chunk. Retry row-by-row so a
        // single invalid row is quarantined, not the batch.
        console.warn(
          `Chunk of ${data.length} failed (${e instanceof Error ? e.message : e}); retrying row-by-row…`,
        )
        for (const row of data) {
          try {
            const res = await prisma.campaignTouchpoint.createMany({ data: [row], skipDuplicates: true })
            inserted += res.count
          } catch {
            quarantined++
          }
        }
      }
    }
    console.log(
      `Inserted ${inserted} new touchpoints (duplicates skipped` +
      (quarantined ? `, ${quarantined} invalid rows quarantined` : "") +
      `).`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
