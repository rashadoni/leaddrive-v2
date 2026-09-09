import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function GET() {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id as string
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, backupCodes: true },
  })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  let hasBackupCodes = false
  try {
    const parsed = typeof user.backupCodes === "string"
      ? JSON.parse(user.backupCodes)
      : user.backupCodes
    if (Array.isArray(parsed) && parsed.length > 0) hasBackupCodes = true
  } catch (err) { console.error(err) }

  return NextResponse.json({
    success: true,
    data: {
      totpEnabled: user.totpEnabled,
      hasBackupCodes,
    },
  })
  })
}
