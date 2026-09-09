import { withRlsAuth } from "@/lib/with-rls"
import { createWhatsAppCallingSmokeScenario } from "./_impl"

export const POST = withRlsAuth("settings", "write", createWhatsAppCallingSmokeScenario)
