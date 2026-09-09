import { withRlsAuth } from "@/lib/with-rls"
import { getWhatsAppCallSessionRoute } from "./_impl"

export const GET = withRlsAuth("inbox", "write", getWhatsAppCallSessionRoute)
