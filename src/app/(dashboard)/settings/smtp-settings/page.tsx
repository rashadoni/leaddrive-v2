"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Mail, Save, Send, Server, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

const presets: Record<string, { host: string; port: number; tls: boolean }> = {
  gmail: { host: "smtp.gmail.com", port: 587, tls: true },
  yandex: { host: "smtp.yandex.ru", port: 465, tls: true },
  mailru: { host: "smtp.mail.ru", port: 465, tls: true },
  outlook: { host: "smtp.office365.com", port: 587, tls: true },
}

type Loc = "en" | "ru" | "az"
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const COPY: Record<Loc, Record<string, string>> = {
  en: {
    configured: "Configured",
    quickSetup: "Quick setup",
    smtpServer: "SMTP server",
    smtpServerHint: "SMTP server address, for example smtp.gmail.com, smtp.mail.ru, smtp.office365.com.",
    portHint: "Use 587 for TLS or 465 for SSL. Port 25 is often blocked by hosting providers.",
    tlsHint: "Enable TLS encryption. For most providers this should stay on.",
    login: "Login",
    loginHint: "SMTP username, usually the same email address.",
    password: "Password",
    passwordHint: "SMTP password or app-specific password. Regular Gmail passwords will not work.",
    fromEmail: "From email",
    fromEmailHint: "Email address recipients see as the sender.",
    fromName: "From name",
    fromNameHint: "Display name recipients see, for example your company name.",
    saveSettings: "Save settings",
    testEmail: "Test email",
    testEmailAddress: "Test email address",
    sendTest: "Send test email",
    saveFirst: "Save SMTP settings first, then send a test email to verify delivery.",
    enterEmail: "Enter a test email address.",
    testSent: "Test email sent to {email}.",
    gmailTitle: "Important for Gmail",
    gmailDesc: "Gmail does not allow regular account passwords. Use an app password instead.",
    gmailStep1: "Go to myaccount.google.com/apppasswords",
    gmailStep2: "Enable two-factor authentication if it is not enabled yet",
    gmailStep3: "Create an app password and select Mail",
    gmailStep4: "Copy the 16-character password and paste it here",
  },
  ru: {
    configured: "Настроено",
    quickSetup: "Быстрая настройка",
    smtpServer: "SMTP сервер",
    smtpServerHint: "Адрес SMTP сервера, например smtp.gmail.com, smtp.mail.ru, smtp.office365.com.",
    portHint: "Обычно 587 для TLS или 465 для SSL. Порт 25 часто заблокирован у хостинг-провайдеров.",
    tlsHint: "Включите TLS-шифрование. Для большинства провайдеров это должно быть включено.",
    login: "Логин",
    loginHint: "SMTP username, обычно тот же email адрес.",
    password: "Пароль",
    passwordHint: "SMTP пароль или app-specific password. Обычный пароль Gmail не подойдет.",
    fromEmail: "Email отправителя",
    fromEmailHint: "Email, который получатели увидят как отправителя.",
    fromName: "Имя отправителя",
    fromNameHint: "Имя, которое увидят получатели, например название компании.",
    saveSettings: "Сохранить настройки",
    testEmail: "Тестовое письмо",
    testEmailAddress: "Email для теста",
    sendTest: "Отправить тест",
    saveFirst: "Сначала сохраните SMTP настройки, затем отправьте тестовое письмо.",
    enterEmail: "Введите email для теста.",
    testSent: "Тестовое письмо отправлено на {email}.",
    gmailTitle: "Важно для Gmail",
    gmailDesc: "Gmail не принимает обычный пароль аккаунта. Используйте app password.",
    gmailStep1: "Откройте myaccount.google.com/apppasswords",
    gmailStep2: "Включите двухфакторную аутентификацию, если она еще не включена",
    gmailStep3: "Создайте app password и выберите Mail",
    gmailStep4: "Скопируйте 16-значный пароль и вставьте его сюда",
  },
  az: {
    configured: "Qurulub",
    quickSetup: "Sürətli quraşdırma",
    smtpServer: "SMTP server",
    smtpServerHint: "SMTP server ünvanı, məsələn smtp.gmail.com, smtp.mail.ru, smtp.office365.com.",
    portHint: "Adətən TLS üçün 587, SSL üçün 465 istifadə olunur. 25 portu çox vaxt bloklanır.",
    tlsHint: "TLS şifrələməsini aktiv saxlayın. Əksər provayderlər üçün bu lazımdır.",
    login: "Login",
    loginHint: "SMTP istifadəçi adı, adətən eyni email ünvanı.",
    password: "Şifrə",
    passwordHint: "SMTP şifrəsi və ya app-specific password. Adi Gmail şifrəsi işləməyəcək.",
    fromEmail: "Göndərən email",
    fromEmailHint: "Qəbul edənlərin göndərən kimi gördüyü email.",
    fromName: "Göndərən adı",
    fromNameHint: "Qəbul edənlərin gördüyü ad, məsələn şirkət adı.",
    saveSettings: "Parametrləri saxla",
    testEmail: "Test email",
    testEmailAddress: "Test email ünvanı",
    sendTest: "Test göndər",
    saveFirst: "Əvvəl SMTP parametrlərini saxlayın, sonra test email göndərin.",
    enterEmail: "Test üçün email yazın.",
    testSent: "Test email {email} ünvanına göndərildi.",
    gmailTitle: "Gmail üçün vacibdir",
    gmailDesc: "Gmail adi hesab şifrəsini qəbul etmir. App password istifadə edin.",
    gmailStep1: "myaccount.google.com/apppasswords səhifəsinə keçin",
    gmailStep2: "İki faktorlu autentifikasiya aktiv deyilsə, aktiv edin",
    gmailStep3: "App password yaradın və Mail seçin",
    gmailStep4: "16 simvollu şifrəni kopyalayıb bura yapışdırın",
  },
}

export default function SmtpSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  useAutoTour("smtpSettings")
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const orgId = session?.user?.organizationId

  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState("587")
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpPass, setSmtpPass] = useState("")
  const [smtpTls, setSmtpTls] = useState(true)
  const [fromEmail, setFromEmail] = useState("")
  const [fromName, setFromName] = useState("")
  const [testEmail, setTestEmail] = useState("")
  const [isConfigured, setIsConfigured] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [testMsg, setTestMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Load settings
  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/settings/smtp", {
      headers: { "x-organization-id": String(orgId) },
    })
      .then(r => r.json())
      .then(j => {
        if (j.success) {
          setSmtpHost(j.data.smtpHost)
          setSmtpPort(String(j.data.smtpPort))
          setSmtpUser(j.data.smtpUser)
          setSmtpPass(j.data.smtpPass)
          setSmtpTls(j.data.smtpTls)
          setFromEmail(j.data.fromEmail)
          setFromName(j.data.fromName)
          setIsConfigured(j.data.isConfigured)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  function applyPreset(key: string) {
    const p = presets[key]
    if (!p) return
    setSmtpHost(p.host)
    setSmtpPort(String(p.port))
    setSmtpTls(p.tls)
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/v1/settings/smtp", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpUser,
          smtpPass,
          smtpTls,
          fromEmail: fromEmail || smtpUser,
          fromName,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Save error")
      setSaveMsg({ type: "success", text: tc("savedSuccessfully") })
      setIsConfigured(true)
    } catch (err) {
      setSaveMsg({ type: "error", text: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!testEmail) { setTestMsg({ type: "error", text: c.enterEmail }); return }
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await fetch("/api/v1/settings/smtp/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ email: testEmail }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Send error")
      setTestMsg({ type: "success", text: c.testSent.replace("{email}", testEmail) })
    } catch (err) {
      setTestMsg({ type: "error", text: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("smtp")}</h1>
        <div className="animate-pulse"><div className="h-96 bg-muted rounded-lg" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div data-tour-id="smtp-header" className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-lg">
          <Server className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("smtp")}<TourReplayButton tourId="smtpSettings" /><HelpButton slug="smtp" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("smtpDesc")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("hintSmtp")}</p>
        </div>
        {isConfigured && (
          <div className="ml-auto flex items-center gap-1.5 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-full">
            <CheckCircle className="h-4 w-4" /> {c.configured}
          </div>
        )}
      </div>

      {/* Centralized email banner — LeadDrive ships with a managed outbound
          service (Resend + leaddrivecrm.org). Per-tenant SMTP below is only
          needed if the tenant wants their own domain on From. */}
      <div data-tour-id="smtp-managed-email" className="rounded-lg border border-sky-200 dark:border-sky-900/50 bg-sky-50/50 dark:bg-sky-950/20 p-4">
        <div className="flex gap-3">
          <Mail className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium text-sky-900 dark:text-sky-200">
              LeadDrive Managed Email
            </p>
            <p className="text-sky-800/80 dark:text-sky-300/80">
              {t("smtpBannerDesc1a")}{" "}
              <code className="px-1 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-xs">
                no-reply@mail.leaddrivecrm.org
              </code>{" "}
              {t("smtpBannerDesc1b")}
            </p>
            <p className="text-sky-800/80 dark:text-sky-300/80">
              {t("smtpBannerDesc2a")} <strong>{t("smtpBannerDesc2b")}</strong>{t("smtpBannerDesc2c")}
            </p>
          </div>
        </div>
      </div>

      {/* Quick presets */}
      <div data-tour-id="smtp-presets" className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card">
        <p className="text-sm font-medium text-muted-foreground mb-3">{c.quickSetup}:</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "gmail", label: "Gmail", color: "bg-red-500 hover:bg-red-600" },
            { key: "yandex", label: "Yandex", color: "bg-yellow-500 hover:bg-yellow-600" },
            { key: "mailru", label: "Mail.ru", color: "bg-blue-500 hover:bg-blue-600" },
            { key: "outlook", label: "Outlook", color: "bg-blue-600 hover:bg-blue-700" },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={cn("text-white text-sm font-medium px-4 py-2 rounded-md transition-colors", color)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* SMTP Settings */}
      <div data-tour-id="smtp-credentials" className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 bg-card space-y-5">
        {/* Host */}
        <div>
          <Label className="text-sm">{c.smtpServer}</Label>
          <Input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="mt-1" />
          <p className="text-xs text-muted-foreground mt-1">{c.smtpServerHint}</p>
        </div>

        {/* Port + TLS */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">Port</Label>
            <Input value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{c.portHint}</p>
          </div>
          <div>
            <Label className="text-sm">Use TLS</Label>
            <Select value={smtpTls ? "yes" : "no"} onChange={e => setSmtpTls(e.target.value === "yes")} className="mt-1">
              <option value="yes">{tc("yes")}</option>
              <option value="no">{tc("no")}</option>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{c.tlsHint}</p>
          </div>
        </div>

        {/* Login + Password */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">{c.login}</Label>
            <Input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="user@gmail.com" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{c.loginHint}</p>
          </div>
          <div>
            <Label className="text-sm">{c.password}</Label>
            <Input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{c.passwordHint}</p>
          </div>
        </div>

        {/* Gmail warning */}
        {smtpHost.includes("gmail") && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">{c.gmailTitle}:</p>
            <p className="text-sm text-amber-600 dark:text-amber-300">
              {c.gmailDesc}
            </p>
            <ol className="text-sm text-amber-600 dark:text-amber-300 mt-1 ml-4 list-decimal space-y-0.5">
              <li>{c.gmailStep1}</li>
              <li>{c.gmailStep2}</li>
              <li>{c.gmailStep3}</li>
              <li>{c.gmailStep4}</li>
            </ol>
          </div>
        )}

        {/* From Email + From Name */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">{c.fromEmail}</Label>
            <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="your@gmail.com" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{c.fromEmailHint}</p>
          </div>
          <div>
            <Label className="text-sm">{c.fromName}</Label>
            <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="LeadDrive CRM" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">{c.fromNameHint}</p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving || !smtpHost || !smtpUser || !smtpPass} className="min-w-[200px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {c.saveSettings}
          </Button>
          {saveMsg && (
            <div className={cn(
              "flex items-center gap-1.5 text-sm",
              saveMsg.type === "success" ? "text-green-600" : "text-red-500"
            )}>
              {saveMsg.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {saveMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Test Email */}
      <div data-tour-id="smtp-test-email" className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 bg-card space-y-4">
        <h2 className="text-lg font-semibold">{c.testEmail}</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Label className="text-sm">{c.testEmailAddress}</Label>
            <Input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="your@email.com"
              className="mt-1"
            />
          </div>
          <Button onClick={handleTest} disabled={testing || !isConfigured} variant="outline" className="gap-1.5">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {c.sendTest}
          </Button>
        </div>
        {testMsg && (
          <div className={cn(
            "flex items-center gap-1.5 text-sm p-3 rounded-lg",
            testMsg.type === "success"
              ? "text-green-700 bg-green-50 dark:bg-green-900/20"
              : "text-red-600 bg-red-50 dark:bg-red-900/20"
          )}>
            {testMsg.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {testMsg.text}
          </div>
        )}
        {!isConfigured && (
          <p className="text-xs text-muted-foreground">{c.saveFirst}</p>
        )}
      </div>
    </div>
  )
}
