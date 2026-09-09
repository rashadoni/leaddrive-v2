import { redirect } from "next/navigation"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { FEATURE_CATALOG, ADDON_CATALOG } from "@/lib/plan-catalog"
import { MODULE_REGISTRY } from "@/lib/modules"
import PlansClient from "./plans-client"

export default async function AdminPlansPage() {
  if (!(await isSuperAdminSession())) redirect("/dashboard")
  // RLS: superadmin surface → explicit bypass classification (plan_templates
  // is a global catalog table — no policy — but the admin page is classified
  // uniformly; server component → .run() form).
  const plans = await runWithRlsBypass(() => prisma.planTemplate.findMany({ orderBy: { sortOrder: "asc" } }))
  const featureOptions = FEATURE_CATALOG.map((id) => ({ id, name: (MODULE_REGISTRY as Record<string, { name: string }>)[id]?.name ?? id }))
  const addonOptions = ADDON_CATALOG.map((id) => ({ id, name: id }))
  return (
    <PlansClient
      initialPlans={JSON.parse(JSON.stringify(plans))}
      featureOptions={featureOptions}
      addonOptions={addonOptions}
    />
  )
}
