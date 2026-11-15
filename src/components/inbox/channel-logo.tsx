import { Globe, Mail, MessageSquare, Phone } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A channel's own mark in its own colour — the WhatsApp phone in green, the
 * Instagram camera on its gradient — the way the owner-approved mock-up of the
 * dense inbox shows channels (2026-11-15). The lucide `ChannelIcon` drew every
 * messenger as the same grey speech bubble, so a list of WhatsApp and
 * Instagram threads could not be told apart at a glance.
 *
 * Brand glyphs are single-path marks on a 24×24 box (the shapes Simple Icons
 * publishes); channels with no brand (a call, e-mail, the website chat, SMS)
 * get a plain lucide icon on a calm colour.
 */

const BRAND_PATHS: Record<string, string> = {
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z",
  instagram:
    "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  telegram:
    "M21.6 3.5 2.7 10.8c-1 .4-1 1.3.1 1.6l4.8 1.5 1.9 5.8c.2.7 1 .9 1.5.4l2.7-2.6 4.9 3.6c.6.4 1.4.1 1.5-.6L23 4.7c.2-.9-.6-1.5-1.4-1.2zM9.7 14.7l8.6-7.5-6.7 8.5-.3 3.4z",
  facebook:
    "M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.15.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.98-.87c.17-.07.36-.09.53-.04.91.25 1.88.38 2.91.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46-2.93 4.66c-.47.74-1.47.92-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.93-4.66c.47-.74 1.47-.92 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63z",
  tiktok:
    "M16 3c.3 2 1.5 3.4 3.5 3.7V9c-1.3 0-2.5-.4-3.5-1v5.8c0 3-2.2 5.2-5 5.2S6 16.8 6 13.9s2.4-5 5.2-4.7v2.4c-1.4-.3-2.7.6-2.7 2.1 0 1.3 1 2.3 2.3 2.3 1.4 0 2.4-1 2.4-2.6V3z",
}

/** Background per channel: the brand's colour, or a calm one for channels with no brand. */
const BACKGROUND: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)",
  telegram: "#2AABEE",
  facebook: "linear-gradient(135deg, #00B2FF, #006AFF 60%, #A033FF)",
  tiktok: "#111111",
  vkontakte: "#0077FF",
  voip: "#64748B",
  email: "#F59E0B",
  "web-chat": "#8B5CF6",
  sms: "#10B981",
}

const PLAIN_ICON: Record<string, typeof Phone> = {
  voip: Phone,
  email: Mail,
  "web-chat": Globe,
  sms: MessageSquare,
  vkontakte: MessageSquare,
}

export function ChannelLogo({
  channel,
  className,
  title,
}: {
  channel: string
  /** Size it with height and width classes (the glyph takes 60 % of it). */
  className?: string
  title?: string
}) {
  const path = BRAND_PATHS[channel]
  const Plain = PLAIN_ICON[channel] ?? MessageSquare
  return (
    <span
      data-channel-logo={channel}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center text-white",
        channel === "instagram" ? "rounded-[30%]" : "rounded-full",
        className,
      )}
      style={{ background: BACKGROUND[channel] ?? "#94A3B8" }}
    >
      {path ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[60%] w-[60%]" aria-hidden="true">
          <path d={path} />
        </svg>
      ) : (
        <Plain className="h-[58%] w-[58%]" strokeWidth={2.4} aria-hidden="true" />
      )}
    </span>
  )
}
