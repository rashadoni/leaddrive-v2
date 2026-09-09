import { withRlsAuth } from "@/lib/with-rls"
import { postWhatsAppCallAction } from "./_impl"

export const POST = withRlsAuth("inbox", "write", postWhatsAppCallAction)
