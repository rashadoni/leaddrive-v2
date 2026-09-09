// Owner request (2026-07-19): the mentions feed must show ONLY comments whose
// own text contains a monitored keyword/alias. The new Bright Data pipeline
// already enforces this at ingest (REJECTED comments are not persisted), but
// legacy Apify-era TikTok comment-mentions were collected from matched VIDEOS
// without a per-comment keyword filter, so keyword-less comments pollute the
// feed. This script hides those legacy rows via the standard triage flag
// (sourceMetadata.socialTriage.hiddenNoise=true — the mentions API excludes
// them from the default view). Reversible; nothing is deleted; evidence and
// audit rows untouched. Scope: brandprotection tenant, platform=tiktok,
// contentKind COMMENT/REPLY only.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const TRIAGE_VERSION = "social_triage_v1" // ai-triage.ts SOCIAL_TRIAGE_VERSION

const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ")

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  const [subjects, aliases] = await Promise.all([
    prisma.monitoringSubject.findMany({ where: { organizationId: org.id }, select: { name: true } }),
    prisma.monitoringSubjectAlias.findMany({
      where: { organizationId: org.id, isNegative: false },
      select: { value: true, normalizedValue: true },
    }),
  ])
  const terms = new Set()
  for (const s of subjects) { const t = fold(s.name); if (t.length >= 3) terms.add(t) }
  for (const a of aliases) {
    for (const v of [a.value, a.normalizedValue]) { const t = fold(v); if (t.length >= 3) terms.add(t) }
  }
  console.log(`[hide-legacy] alias/name terms loaded: ${terms.size}`)

  const mentions = await prisma.socialMention.findMany({
    where: { organizationId: org.id, platform: "tiktok", contentKind: { in: ["COMMENT", "REPLY"] } },
    select: { id: true, text: true, sourceMetadata: true, createdAt: true },
  })
  console.log(`[hide-legacy] tiktok COMMENT/REPLY mentions: ${mentions.length}`)

  let hidden = 0, kept = 0, alreadyHidden = 0
  for (const m of mentions) {
    const meta = m.sourceMetadata && typeof m.sourceMetadata === "object" && !Array.isArray(m.sourceMetadata) ? m.sourceMetadata : {}
    const triage = meta.socialTriage && typeof meta.socialTriage === "object" ? meta.socialTriage : {}
    if (triage.hiddenNoise === true) { alreadyHidden++; continue }
    const text = fold(m.text)
    // Squash keeps letters/digits of ANY script (\p{L}\p{N}), so Cyrillic and
    // Azerbaijani aliases never squash to "" (empty-needle matches everything).
    const squash = (s) => s.replace(/[^\p{L}\p{N}]/gu, "")
    const squashedText = squash(text)
    const matched = [...terms].filter((t) => {
      if (t.length >= 4 && text.includes(t)) return true
      const st = squash(t)
      return st.length >= 6 && squashedText.includes(st)
    })
    if (matched.length) {
      kept++
      console.log(`  kept   ${m.id.slice(0, 10)}… (${m.createdAt.toISOString().slice(0, 10)}) matchedTerms=[${matched.slice(0, 4).join(", ")}]`)
      continue
    }
    await prisma.socialMention.update({
      where: { id: m.id },
      data: {
        sourceMetadata: {
          ...meta,
          socialTriage: {
            ...triage,
            version: TRIAGE_VERSION,
            hiddenNoise: true,
            recommendedAction: "ignore_noise",
            relevanceScore: 0,
            reasons: Array.from(new Set([...(Array.isArray(triage.reasons) ? triage.reasons : []), "legacy_comment_no_keyword"])),
            hiddenBy: "hide-legacy-comments",
            hiddenAt: new Date().toISOString(),
          },
        },
      },
    })
    hidden++
    console.log(`  hidden ${m.id.slice(0, 10)}… (${m.createdAt.toISOString().slice(0, 10)}, no keyword in text)`)
  }
  await prisma.auditLog.create({
    data: {
      organizationId: org.id, userId: "canary-ci-operator", action: "update",
      entityType: "social_mention_triage_bulk", entityId: org.id,
      newValue: { via: "hide-legacy-comments", scope: "tiktok COMMENT/REPLY", hidden, kept, alreadyHidden, ownerRequest: "keyword-only comments 2026-07-19" },
    },
  })
  console.log(`[hide-legacy] DONE: hidden=${hidden} kept(with keyword)=${kept} alreadyHidden=${alreadyHidden}`)
}

main()
  .catch((err) => { console.error("[hide-legacy] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
