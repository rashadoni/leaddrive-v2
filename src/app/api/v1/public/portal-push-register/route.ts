/**
 * Native loyalty app — push-token registration (Slice 3).
 *
 * POST   /api/v1/public/portal-push-register  body: { expoPushToken }
 * DELETE /api/v1/public/portal-push-register  body: { expoPushToken }
 *
 * The member (identity from the portal JWT — Bearer or cookie, NEVER the body)
 * registers / unregisters the Expo push token for the device they signed in on.
 * Stored on `Contact.expoPushTokens`; the loyalty earn hooks push to it. Dedup
 * on register; full-array rewrite on unregister (Postgres has no array-remove
 * in Prisma's typed API).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { isExpoPushToken } from "@/lib/push/expo-push"

async function readToken(req: Request): Promise<string | null> {
  let body: { expoPushToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return null
  }
  return isExpoPushToken(body.expoPushToken) ? body.expoPushToken : null
}

export async function POST(req: Request) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await readToken(req)
  if (!token) return NextResponse.json({ error: "Invalid expoPushToken" }, { status: 400 })

  return runWithTenant(user.organizationId, async () => {
    const contact = await prisma.contact.findFirst({
      where: { id: user.contactId, organizationId: user.organizationId },
      select: { expoPushTokens: true },
    })
    if (!contact) return NextResponse.json({ error: "Member not found" }, { status: 404 })

    // Cast: the $extends client degrades String[] → the column is TEXT[] NOT NULL.
    const current = (contact.expoPushTokens ?? []) as string[]
    if (!current.includes(token)) {
      await prisma.contact.updateMany({
        where: { id: user.contactId, organizationId: user.organizationId },
        data: { expoPushTokens: { push: token } },
      })
    }
    return NextResponse.json({ success: true })
  })
}

export async function DELETE(req: Request) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = await readToken(req)
  if (!token) return NextResponse.json({ error: "Invalid expoPushToken" }, { status: 400 })

  return runWithTenant(user.organizationId, async () => {
    const contact = await prisma.contact.findFirst({
      where: { id: user.contactId, organizationId: user.organizationId },
      select: { expoPushTokens: true },
    })
    if (!contact) return NextResponse.json({ error: "Member not found" }, { status: 404 })

    const current = (contact.expoPushTokens ?? []) as string[]
    if (current.includes(token)) {
      await prisma.contact.updateMany({
        where: { id: user.contactId, organizationId: user.organizationId },
        data: { expoPushTokens: { set: current.filter((t) => t !== token) } },
      })
    }
    return NextResponse.json({ success: true })
  })
}
