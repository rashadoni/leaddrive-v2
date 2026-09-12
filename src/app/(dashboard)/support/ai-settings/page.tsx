import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import {
  hasSupportAiSettingsEntitlement,
  isSupportAiSettingsRole,
} from "@/lib/ai/support-settings-access"
import { SupportAiSettingsClient } from "./support-ai-settings-client"

export const dynamic = "force-dynamic"

export default async function SupportAiSettingsPage() {
  const session = await auth()
  const user = session?.user

  if (!user?.id || !user.organizationId) redirect("/login")

  if (
    !isSupportAiSettingsRole(user.role)
    || !(await hasSupportAiSettingsEntitlement(user.organizationId))
  ) {
    redirect("/dashboard")
  }

  return <SupportAiSettingsClient />
}
