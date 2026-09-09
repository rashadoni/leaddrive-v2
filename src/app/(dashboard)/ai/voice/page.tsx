import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { VoiceConsoleLoader } from "@/components/ai/voice-console-loader"

/**
 * The voice console. This is the ONLY path in the app where
 * `Permissions-Policy` grants the microphone (src/proxy.ts), which is why the
 * console lives on its own page rather than in the globally-mounted assistant
 * panel: a global mount would have required opening the microphone across the
 * whole dashboard.
 *
 * The gate runs BEFORE render, not inside the client component. A denied user
 * never receives the console markup at all — there is nothing in the DOM to
 * re-enable from devtools, and the ~11 MB WebRTC bundle is never requested.
 */
export const dynamic = "force-dynamic"

export default async function VoicePage() {
  const session = await auth()
  const user = session?.user as { id?: string; organizationId?: string; role?: string } | undefined

  if (!user?.id || !user?.organizationId) {
    redirect("/login")
  }

  const gate = await checkVoicePilotAccess({
    orgId: user.organizationId,
    userId: user.id,
    role: user.role ?? "viewer",
  })

  if (!gate.ok) {
    // Deliberately a plain 404-ish surface rather than an explanatory error:
    // the pilot allowlist is not something the app should advertise.
    redirect("/dashboard")
  }

  return <VoiceConsoleLoader />
}
