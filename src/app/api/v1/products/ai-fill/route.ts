/**
 * POST { name } — «AI ilə doldur» on the product form (src/lib/products/ai-fill.ts).
 * Nothing is written: the form shows the proposal and saves on «Yarat».
 * Behind the same «pricing» write right as the product form, and Da Vinci.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { getOrgModuleContext } from "@/lib/api-auth"
import { hasModule } from "@/lib/modules"
import { moduleContextForUser } from "@/lib/user-module-access"
import { AiFillUnavailableError, suggestProductCard } from "@/lib/products/ai-fill"

const bodySchema = z.object({ name: z.string().trim().min(2).max(300) }).strict()

export const POST = withRlsAuth("pricing", "write", async (req, auth) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Write the product name first", code: "NAME_REQUIRED" }, { status: 400 })
  const modules = moduleContextForUser(await getOrgModuleContext(auth.orgId), auth)
  if (!hasModule(modules, "ai")) return NextResponse.json({ error: "Da Vinci AI is not enabled", code: "NO_AI_MODULE" }, { status: 403 })
  try {
    return NextResponse.json({ success: true, data: await suggestProductCard({ orgId: auth.orgId, name: parsed.data.name }) })
  } catch (error) {
    if (error instanceof AiFillUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code === "BUDGET" ? "AI_BUDGET" : "AI_UNAVAILABLE" }, { status: error.code === "BUDGET" ? 429 : 502 })
    }
    console.error("[products/ai-fill] failed", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "AI is not answering", code: "AI_UNAVAILABLE" }, { status: 502 })
  }
})
