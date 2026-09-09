/**
 * GET  /api/v1/users/me/preferences  → { favorites: string[], recents: {href,at}[] }
 * PUT  /api/v1/users/me/preferences  → upsert the caller's favorites/recents
 *
 * Per-user (NOT per-org) UI state for the App Launcher: pinned favorites +
 * recently-used modules. Self-service — every authenticated user manages only
 * their OWN row (keyed on the session userId), so no settings/write permission
 * is required. Same self-service pattern as users/me/availability.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { navItems } from "@/lib/nav-items"
import { withRlsSessionAuth } from "@/lib/with-rls"

// Only real navigation destinations may be stored — guards against stale
// localStorage entries (a renamed/removed route) and client tampering.
const VALID_HREFS = new Set(navItems.map((i) => i.href))
const MAX_RECENTS = 12

// Переадресация легаси-href'ов: когда раздел меняет адрес (одиночный пункт
// «Sosial monitorinq» стал группой query-видов, 2026-07-31), сохранённые пины
// и recents пользователей не должны молча пропадать — ремапим на обеих
// сторонах: GET (чтобы плитка сразу резолвилась) и PUT (чтобы записи от
// клиентов со старым href не отфильтровались в никуда).
const LEGACY_HREF_REMAP: Record<string, string> = {
  "/social-monitoring": "/social-monitoring?scope=all&view=overview",
}
const remapHref = (href: string) => LEGACY_HREF_REMAP[href] ?? href

const recentSchema = z.object({
  href: z.string(),
  at: z.number().int().nonnegative(),
})

const schema = z.object({
  favorites: z.array(z.string()).optional(),
  recents: z.array(recentSchema).optional(),
})

type Recent = { href: string; at: number }

export const GET = withRlsSessionAuth(async (_req, session) => {
  const { userId } = session

  try {
    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    return NextResponse.json({
      success: true,
      data: {
        favorites: [...new Set(((pref?.favorites as string[] | undefined) ?? []).map(remapHref))],
        recents: ((pref?.recents as Recent[] | undefined) ?? []).map((r) => ({ ...r, href: remapHref(r.href) })),
      },
    })
  } catch (e) {
    console.error("[me/preferences GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsSessionAuth(async (req, session) => {
  const { userId, orgId } = session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Sanitize: keep only real hrefs, dedupe, cap recents so the row can't grow
  // unbounded. `undefined` = field not sent → leave existing value untouched.
  const favorites = parsed.data.favorites
    ? [...new Set(parsed.data.favorites.map(remapHref).filter((h) => VALID_HREFS.has(h)))]
    : undefined
  const recents = parsed.data.recents
    ? dedupeRecents(parsed.data.recents.map((r) => ({ ...r, href: remapHref(r.href) })).filter((r) => VALID_HREFS.has(r.href))).slice(0, MAX_RECENTS)
    : undefined

  const data: { favorites?: string[]; recents?: Recent[] } = {}
  if (favorites !== undefined) data.favorites = favorites
  if (recents !== undefined) data.recents = recents

  try {
    const pref = await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, organizationId: orgId, ...data },
      update: data,
    })
    return NextResponse.json({
      success: true,
      data: {
        favorites: (pref.favorites as string[]) ?? [],
        recents: (pref.recents as Recent[]) ?? [],
      },
    })
  } catch (e) {
    console.error("[me/preferences PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

function dedupeRecents(recents: Recent[]): Recent[] {
  const seen = new Set<string>()
  const out: Recent[] = []
  for (const r of recents) {
    if (seen.has(r.href)) continue
    seen.add(r.href)
    out.push(r)
  }
  return out
}
