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
    subject: `LeadDrive — ${singleLine(input.company)} üçün şəxsi demo`,
    transactional: true,
    html: emailFrame(`
      <p style="margin:0 0 8px;font-size:14px;color:#667069">${safeCompany} üçün hazırlanıb</p>
      <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#17221d">Şəxsi LeadDrive demonuz hazırdır</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7">Salam, ${safeName}. Sizin üçün aşağıdakı modulları əhatə edən qorunan demo hazırladıq:</p>
      <ul style="margin:0 0 24px;padding-left:22px;font-size:14px;line-height:1.5">${modules}</ul>
      <a href="${safeUrl}" style="display:inline-block;background:#d45420;color:#fff7ef;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px">Demonu aç</a>
      <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#667069">Giriş e-poçt kodu ilə qorunur və yalnız bir brauzerdə bir sessiya üçün işləyir. Səhifəni yeniləmək həmin sessiyanı dayandırmır. Link ${escapeHtml(expiry)} tarixinədək aktivləşdirilə bilər.</p>
    `),
    text: [
      `Salam, ${input.name}.`,
      "Şəxsi LeadDrive demonuz hazırdır.",
      `Modullar: ${input.moduleNames.join(", ")}`,
      `Demonu açın: ${demoUrl}`,
      "Giriş yalnız bir brauzerdə bir sessiya üçün işləyir.",
      `Linkin aktivləşdirmə müddəti: ${expiry}`,
    ].join("\n\n"),
  })
}

export async function sendDemoOtpEmail(input: { to: string; name: string; code: string }) {
  return sendEmail({
    to: input.to,
    subject: `${input.code} — LeadDrive demo giriş kodu`,
    transactional: true,
    html: emailFrame(`
      <p style="margin:0 0 8px;font-size:14px;color:#667069">Şəxsi demo girişi</p>
      <h1 style="margin:0 0 16px;font-size:26px;color:#17221d">Təsdiq kodunuz</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.7">Salam, ${escapeHtml(input.name)}. Demonun sizə aid olduğunu təsdiqləmək üçün bu kodu daxil edin:</p>
      <div style="display:inline-block;padding:14px 20px;background:#f1ede3;border:1px solid #d8d3c7;border-radius:12px;font-size:30px;font-weight:800;letter-spacing:8px;color:#17221d">${escapeHtml(input.code)}</div>
      <p style="margin:22px 0 0;font-size:13px;color:#667069">Kod 10 dəqiqə ərzində etibarlıdır. Siz bu sorğunu etməmisinizsə, məktubu nəzərə almayın.</p>
    `),
    text: `Salam, ${input.name}. LeadDrive demo giriş kodunuz: ${input.code}. Kod 10 dəqiqə etibarlıdır.`,
  })
}

export async function sendDemoRequestNotification(input: {
  to: string
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
      <h1 style="margin:0 0 18px;font-size:24px">Yeni demo sorğusu</h1>
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
