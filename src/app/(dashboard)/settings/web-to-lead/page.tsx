"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Code, Copy, Check, ExternalLink, Globe } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

type Loc = "en" | "ru" | "az"

const COPY: Record<Loc, Record<string, string>> = {
  en: {
    formConfig: "Form configuration",
    orgSlug: "Organization slug",
    orgSlugHint: "Auto-filled from the current tenant. Change it only if support asks you to target another tenant.",
    formTitle: "Form title",
    submitButtonText: "Submit button text",
    redirectUrl: "Redirect URL (optional)",
    fields: "Fields",
    fieldsHint: "Click badges to toggle optional fields. Name and email are always required.",
    apiEndpoint: "API endpoint",
    apiHint: "CORS is enabled. Requests are rate limited to 10 per minute per IP.",
    embedCode: "Embed code",
    copy: "Copy",
    copied: "Copied!",
    preview: "Preview",
    name: "Name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    message: "Message",
    messagePlaceholder: "Tell us about your needs...",
    thankYou: "Thank you! We'll be in touch soon.",
    submitError: "Something went wrong. Please try again.",
    connectionError: "Connection error. Please try again.",
  },
  ru: {
    formConfig: "Настройка формы",
    orgSlug: "Slug организации",
    orgSlugHint: "Автоматически подставлен из текущего tenant-а. Меняйте только если поддержка попросила направить лиды в другой tenant.",
    formTitle: "Заголовок формы",
    submitButtonText: "Текст кнопки",
    redirectUrl: "Redirect URL (необязательно)",
    fields: "Поля",
    fieldsHint: "Нажимайте на бейджи, чтобы включать поля. Имя и email всегда обязательны.",
    apiEndpoint: "API endpoint",
    apiHint: "CORS включен. Лимит: 10 запросов в минуту с одного IP.",
    embedCode: "Код для сайта",
    copy: "Копировать",
    copied: "Скопировано",
    preview: "Предпросмотр",
    name: "Имя",
    email: "Email",
    phone: "Телефон",
    company: "Компания",
    message: "Сообщение",
    messagePlaceholder: "Напишите, что вам нужно...",
    thankYou: "Спасибо! Мы скоро свяжемся с вами.",
    submitError: "Что-то пошло не так. Попробуйте еще раз.",
    connectionError: "Ошибка соединения. Попробуйте еще раз.",
  },
  az: {
    formConfig: "Formanın tənzimlənməsi",
    orgSlug: "Təşkilat slug-u",
    orgSlugHint: "Cari tenant-dan avtomatik doldurulur. Yalnız dəstək başqa tenant-a yönləndirməyi istəsə dəyişin.",
    formTitle: "Forma başlığı",
    submitButtonText: "Düymə mətni",
    redirectUrl: "Redirect URL (istəyə bağlı)",
    fields: "Sahələr",
    fieldsHint: "İstəyə bağlı sahələri açıb-bağlamaq üçün nişanlara klikləyin. Ad və email həmişə tələb olunur.",
    apiEndpoint: "API endpoint",
    apiHint: "CORS aktivdir. Limit: bir IP üçün dəqiqədə 10 sorğu.",
    embedCode: "Sayta yerləşdirmə kodu",
    copy: "Kopyala",
    copied: "Kopyalandı",
    preview: "Ön baxış",
    name: "Ad",
    email: "Email",
    phone: "Telefon",
    company: "Şirkət",
    message: "Mesaj",
    messagePlaceholder: "Ehtiyacınızı yazın...",
    thankYou: "Təşəkkürlər! Tezliklə sizinlə əlaqə saxlayacağıq.",
    submitError: "Xəta baş verdi. Yenidən cəhd edin.",
    connectionError: "Bağlantı xətası. Yenidən cəhd edin.",
  },
}

export default function WebToLeadPage() {
  const t = useTranslations("settings")
  const { data: session } = useSession()
  useAutoTour("webToLeadSettings")
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const [copied, setCopied] = useState(false)
  const sessionOrgSlug = session?.user?.organizationSlug || ""
  const [orgSlugOverride, setOrgSlugOverride] = useState<string | null>(null)
  const orgSlug = orgSlugOverride ?? sessionOrgSlug
  const [formTitle, setFormTitle] = useState("Contact Us")
  const [showPhone, setShowPhone] = useState(true)
  const [showCompany, setShowCompany] = useState(true)
  const [showMessage, setShowMessage] = useState(true)
  const [submitText, setSubmitText] = useState("Submit")
  const [redirectUrl, setRedirectUrl] = useState("")

  const apiEndpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/public/leads`
  const embedOrgSlug = orgSlug.trim() || "your-tenant-slug"

  // Escape HTML special characters to prevent code injection in embed code
  const escapeHtml = (str: string) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")

  // Validate redirect URL — only allow http/https protocols
  const safeRedirectUrl = redirectUrl && /^https?:\/\//i.test(redirectUrl.trim()) ? escapeHtml(redirectUrl.trim()) : ""

  const embedCode = `<!-- LeadDrive Web-to-Lead Form -->
<form id="leaddrive-form" onsubmit="return submitLeadDriveForm(event)">
  <h3>${escapeHtml(formTitle)}</h3>
  <div>
    <label for="ld-name">${escapeHtml(c.name)} *</label>
    <input type="text" id="ld-name" name="name" required />
  </div>
  <div>
    <label for="ld-email">${escapeHtml(c.email)} *</label>
    <input type="email" id="ld-email" name="email" required />
  </div>${showPhone ? `
  <div>
    <label for="ld-phone">${escapeHtml(c.phone)}</label>
    <input type="tel" id="ld-phone" name="phone" />
  </div>` : ""}${showCompany ? `
  <div>
    <label for="ld-company">${escapeHtml(c.company)}</label>
    <input type="text" id="ld-company" name="company" />
  </div>` : ""}${showMessage ? `
  <div>
    <label for="ld-message">${escapeHtml(c.message)}</label>
    <textarea id="ld-message" name="message" rows="3"></textarea>
  </div>` : ""}
  <div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden">
    <label for="ld-website">Website</label>
    <input type="text" id="ld-website" name="website" tabindex="-1" autocomplete="off" />
  </div>
  <button type="submit">${escapeHtml(submitText)}</button>
</form>
<script>
async function submitLeadDriveForm(e) {
  e.preventDefault();
  const f = e.target;
  const data = {
    name: f.name.value,
    email: f.email.value,${showPhone ? "\n    phone: f.phone?.value || ''," : ""}${showCompany ? "\n    company: f.company?.value || ''," : ""}${showMessage ? "\n    message: f.message?.value || ''," : ""}
    website: f.website?.value || '',
    source: "web_form",
    org_slug: "${escapeHtml(embedOrgSlug)}"
  };
  try {
    const r = await fetch("${apiEndpoint}", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data)
    });
    if (r.ok) {
      ${safeRedirectUrl ? `window.location.href = "${safeRedirectUrl}";` : `alert(${JSON.stringify(c.thankYou)});`}
      f.reset();
    } else {
      alert(${JSON.stringify(c.submitError)});
    }
  } catch(err) {
    alert(${JSON.stringify(c.connectionError)});
  }
  return false;
}
</script>`

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between" data-tour-id="web-to-lead-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6" /> {t("webToLead")}
            <HelpButton slug="web-to-lead" variant="label" />
            <TourReplayButton tourId="webToLeadSettings" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("webToLeadDesc")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("hintWebToLead")}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card data-tour-id="web-to-lead-config">
            <CardHeader><CardTitle className="text-base">{c.formConfig}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">{c.orgSlug}</label>
                <Input value={orgSlug} onChange={e => setOrgSlugOverride(e.target.value)} placeholder={sessionOrgSlug || "your-tenant-slug"} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">{c.orgSlugHint}</p>
              </div>
              <div>
                <label className="text-sm font-medium">{c.formTitle}</label>
                <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">{c.submitButtonText}</label>
                <Input value={submitText} onChange={e => setSubmitText(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">{c.redirectUrl}</label>
                <Input value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)} placeholder="https://yoursite.com/thank-you" className="mt-1" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{c.fields}</label>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">{c.name} *</Badge>
                  <Badge variant="default">{c.email} *</Badge>
                  <Badge
                    variant={showPhone ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setShowPhone(!showPhone)}
                  >{c.phone}</Badge>
                  <Badge
                    variant={showCompany ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setShowCompany(!showCompany)}
                  >{c.company}</Badge>
                  <Badge
                    variant={showMessage ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setShowMessage(!showMessage)}
                  >{c.message}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.fieldsHint}</p>
              </div>
            </CardContent>
          </Card>

          <Card data-tour-id="web-to-lead-endpoint">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{c.apiEndpoint}</CardTitle>
                <Badge variant="outline">POST</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <code className="block text-sm bg-muted/50 rounded p-2 break-all">
                {apiEndpoint}
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                {c.apiHint}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card data-tour-id="web-to-lead-embed">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Code className="h-4 w-4" /> {c.embedCode}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? c.copied : c.copy}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap">
                {embedCode}
              </pre>
            </CardContent>
          </Card>

          <Card data-tour-id="web-to-lead-preview">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4" /> {c.preview}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-background">
                <h3 className="text-lg font-semibold mb-3">{formTitle}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">{c.name} *</label>
                    <Input placeholder="John Doe" className="mt-1" disabled />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{c.email} *</label>
                    <Input placeholder="john@company.com" className="mt-1" disabled />
                  </div>
                  {showPhone && (
                    <div>
                      <label className="text-sm font-medium">{c.phone}</label>
                      <Input placeholder="+994 50 123 4567" className="mt-1" disabled />
                    </div>
                  )}
                  {showCompany && (
                    <div>
                      <label className="text-sm font-medium">{c.company}</label>
                      <Input placeholder="Acme Corp" className="mt-1" disabled />
                    </div>
                  )}
                  {showMessage && (
                    <div>
                      <label className="text-sm font-medium">{c.message}</label>
                      <textarea className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm" placeholder={c.messagePlaceholder} rows={3} disabled />
                    </div>
                  )}
                  <Button disabled className="w-full">{submitText}</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
