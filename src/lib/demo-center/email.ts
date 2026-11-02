import { APP_URL } from "@/lib/domains"
import { sendEmail } from "@/lib/email"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim()
}

function emailFrame(content: string): string {
  return `
    <div style="background:#f5f3ee;padding:32px 16px;font-family:Arial,sans-serif;color:#17221d">
      <div style="max-width:600px;margin:0 auto;background:#fffdf8;border:1px solid #dfddd4;border-radius:18px;overflow:hidden">
        <div style="padding:22px 28px;border-bottom:1px solid #ebe8df;font-weight:700;color:#c84b1b">LeadDrive</div>
        <div style="padding:30px 28px">${content}</div>
        <div style="padding:18px 28px;background:#f3f0e8;color:#667069;font-size:12px;line-height:1.5">
          Bu məktub yalnız sizin korporativ ünvanınıza göndərilib. Linki paylaşmayın.
        </div>
      </div>
    </div>`
}

/**
 * The one email a prospect gets: confirm the address and the demo opens.
 * Pressing the button on the page the link opens is the confirmation
 * (`demo-access/[token]/confirm`) — no second email with a code.
 */
export async function sendDemoAccessEmail(input: {
  to: string
  name: string
  company: string
  token: string
  moduleNames: string[]
  linkExpiresAt: Date
}) {
  const demoUrl = `${APP_URL.replace(/\/$/, "")}/demo-access/${encodeURIComponent(input.token)}`
  const safeName = escapeHtml(input.name)
  const safeCompany = escapeHtml(input.company)
  const safeUrl = escapeHtml(demoUrl)
  const modules = input.moduleNames.map((name) => `<li style="margin:7px 0">${escapeHtml(name)}</li>`).join("")
  const expiry = new Intl.DateTimeFormat("az-AZ", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Baku" })
    .format(input.linkExpiresAt)

  return sendEmail({
    to: input.to,
    subject: `LeadDrive demo — e-poçtunuzu təsdiqləyin`,
    transactional: true,
    html: emailFrame(`
      <p style="margin:0 0 8px;font-size:14px;color:#667069">${safeCompany} üçün hazırlanıb</p>
      <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#17221d">E-poçtunuzu təsdiqləyin — demo açılacaq</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7">Salam, ${safeName}. LeadDrive demosunu istədiyiniz üçün təşəkkür edirik. Demoda sizi gözləyir:</p>
      <ul style="margin:0 0 24px;padding-left:22px;font-size:14px;line-height:1.5">${modules}</ul>
      <a href="${safeUrl}" style="display:inline-block;background:#d45420;color:#fff7ef;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px">E-poçtu təsdiqlə və demonu aç</a>
      <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#667069">Linkə keçin və səhifədəki düyməni basın — e-poçtunuz təsdiqlənəcək və demo həmin brauzerdə açılacaq. Link ${escapeHtml(expiry)} tarixinədək işləyir. Bu sorğunu siz göndərməmisinizsə, məktubu nəzərə almayın: təsdiq olmadan demo açılmır.</p>
    `),
    text: [
      `Salam, ${input.name}.`,
      "LeadDrive demosunu açmaq üçün e-poçtunuzu təsdiqləyin.",
      `Demoda: ${input.moduleNames.join(", ")}`,
      `Linkə keçin və səhifədəki düyməni basın: ${demoUrl}`,
      `Link ${expiry} tarixinədək işləyir.`,
      "Bu sorğunu siz göndərməmisinizsə, məktubu nəzərə almayın: təsdiq olmadan demo açılmır.",
    ].join("\n\n"),
  })
}

/**
 * The owner's «Yeni demo sorğusu». `confirmed`: the prospect opened the link
 * and confirmed the address (src/lib/demo-center/email-confirmation.ts).
 * `link_not_sent`: the link could not go out, so nobody can confirm, and the
 * request would otherwise wait unseen.
 */
export async function sendDemoRequestNotification(input: {
  to: string
  confirmation: "confirmed" | "link_not_sent"
  requestId: string
  name: string
  company: string
  email: string
  phone?: string | null
  jobTitle?: string | null
  message?: string | null
  requestedModuleNames: string[]
}) {
  const adminUrl = `${APP_URL.replace(/\/$/, "")}/admin/demo-requests/${encodeURIComponent(input.requestId)}`
  const row = (label: string, value: string) => `<tr><td style="padding:6px 14px 6px 0;color:#667069">${label}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(value)}</td></tr>`
  return sendEmail({
    to: input.to,
    subject: `Yeni demo sorğusu — ${singleLine(input.company)}`,
    transactional: true,
    replyTo: input.email,
    html: emailFrame(`
      <h1 style="margin:0 0 12px;font-size:24px">Yeni demo sorğusu</h1>
      ${input.confirmation === "confirmed"
        ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#1f6b45;font-weight:700">E-poçt təsdiqləndi: müştəri məktubdakı linkə keçib demonu açdı.</p>`
        : `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#a33a1a;font-weight:700">Demo linkini göndərə bilmədik, e-poçt təsdiqlənməyib. Müştəri ilə özünüz əlaqə saxlayın.</p>`}
      <table style="border-collapse:collapse;font-size:14px">
        ${row("Ad", input.name)}
        ${row("Şirkət", input.company)}
        ${row("Vəzifə", input.jobTitle || "—")}
        ${row("E-poçt", input.email)}
        ${row("Telefon", input.phone || "—")}
        ${row("Maraqlandığı modullar", input.requestedModuleNames.join(", ") || "Göstərilməyib")}
        ${row("Mesaj", input.message || "—")}
      </table>
      <p style="margin:24px 0 0"><a href="${escapeHtml(adminUrl)}" style="color:#c84b1b;font-weight:700">Sorğunu Demo Center-də aç</a></p>
    `),
  })
}
