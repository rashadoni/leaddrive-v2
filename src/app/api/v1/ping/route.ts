import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Cheap DB-path health check. Used by scripts/server-deploy.sh to decide
// whether a fresh standalone build actually booted with a working Prisma
// query engine — the page/CSS checks alone pass even on a build where the
// engine binary is missing. If Prisma can't initialise, this returns 500
// and the deploy rolls back.
//
// Public: no auth required. Keep the response deliberately minimal: callers
// only need the HTTP status and `ok`, while DB metadata, tenant counts, timing,
// and exception text would disclose internal state to unauthenticated users.
export async function GET() {
  try {
    await prisma.organization.count()

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    console.error("[ping] database readiness check failed", e)
    return NextResponse.json(
      { ok: false },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
