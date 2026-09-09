"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Save, Settings, Building2, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, Upload, X, Mail } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/invoice-html"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

type Loc = "en" | "ru" | "az"
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const COPY: Record<Loc, Record<string, string>> = {
  en: {
    companyInfo: "Company information",
    companyInfoDesc: "Legal details shown on invoices. These may differ from the CRM organization name.",
    companyName: "Company name",
    companyAddress: "Company address",
    companyEmail: "Email",
    companyPhone: "Phone",
    logoUrl: "Logo URL",
    logoHint: "Optional. Displayed in the invoice header.",
    defaults: "Default settings",
    defaultsDesc: "Default values for new invoices. You can override them on each invoice.",
    numberPrefix: "Number prefix",
    numberPrefixHint: "Prefix for invoice numbers, for example INV-001 or KP-001.",
    paymentTerms: "Default payment terms",
    dueOnReceipt: "Due on receipt",
    taxRate: "Default tax rate",
    taxHint: "Standard VAT rate in Azerbaijan is 18%.",
    currency: "Default currency",
    bankDetails: "Bank details",
    bankDetailsDesc: "Bank information printed on invoices.",
    bankName: "Bank name",
    bankCode: "Code (MFO)",
    bankAccount: "Account number",
    bankCorrAccount: "Correspondent account",
    signer: "Signer and stamp",
    signerDesc: "Details of the person signing the invoice and the company stamp.",
    signerName: "Full name",
    signerTitle: "Title",
    companyStamp: "Company stamp (scan)",
    stampHint: "Upload a PNG/JPG stamp image. It is added when generating a stamped PDF.",
    stampUploaded: "Stamp uploaded",
    replace: "Replace",
    uploadStamp: "Upload stamp image",
    fileHint: "PNG, JPG — max 2MB",
    actSigner: "Act signer (handover act)",
    signature: "Signature (scan)",
    signatureHint: "Upload a PNG/JPG signature image. It is added to the act document.",
    signatureUploaded: "Signature uploaded",
    uploadSignature: "Upload signature image",
    defaultText: "Default text",
    defaultTextDesc: "Default terms and footer text included on every invoice.",
    terms: "Default terms and conditions",
    footer: "Default footer note",
    emailTemplates: "Email templates",
    emailTemplatesDesc: "Email text used when sending invoices. Configure a separate template for each language.",
  },
  ru: {
    companyInfo: "Данные компании",
    companyInfoDesc: "Юридические данные, которые печатаются в счетах. Они могут отличаться от названия организации в CRM.",
    companyName: "Название компании",
    companyAddress: "Адрес компании",
    companyEmail: "Email",
    companyPhone: "Телефон",
    logoUrl: "URL логотипа",
    logoHint: "Необязательно. Показывается в шапке счета.",
    defaults: "Настройки по умолчанию",
    defaultsDesc: "Значения для новых счетов. В каждом счете их можно изменить отдельно.",
    numberPrefix: "Префикс номера",
    numberPrefixHint: "Префикс номеров счетов, например INV-001 или KP-001.",
    paymentTerms: "Условия оплаты по умолчанию",
    dueOnReceipt: "Оплата при получении",
    taxRate: "Налоговая ставка по умолчанию",
    taxHint: "Стандартная ставка НДС в Азербайджане — 18%.",
    currency: "Валюта по умолчанию",
    bankDetails: "Банковские реквизиты",
    bankDetailsDesc: "Банковские данные, которые будут напечатаны в счетах.",
    bankName: "Название банка",
    bankCode: "Код (MFO)",
    bankAccount: "Номер счета",
    bankCorrAccount: "Корреспондентский счет",
    signer: "Подписант и печать",
    signerDesc: "Данные подписанта счета и печать компании.",
    signerName: "Имя и фамилия",
    signerTitle: "Должность",
    companyStamp: "Печать компании (скан)",
    stampHint: "Загрузите PNG/JPG изображение печати. Оно добавится при генерации PDF с печатью.",
    stampUploaded: "Печать загружена",
    replace: "Заменить",
    uploadStamp: "Загрузить изображение печати",
    fileHint: "PNG, JPG — максимум 2MB",
    actSigner: "Подписант акта (акт приема-передачи)",
    signature: "Подпись (скан)",
    signatureHint: "Загрузите PNG/JPG изображение подписи. Оно добавится в акт.",
    signatureUploaded: "Подпись загружена",
    uploadSignature: "Загрузить изображение подписи",
    defaultText: "Текст по умолчанию",
    defaultTextDesc: "Условия и нижний текст, которые добавляются в каждый счет.",
    terms: "Условия оплаты по умолчанию",
    footer: "Нижняя заметка по умолчанию",
    emailTemplates: "Email-шаблоны",
    emailTemplatesDesc: "Текст письма при отправке счета. Для каждого языка настраивается отдельный шаблон.",
  },
  az: {
    companyInfo: "Şirkət məlumatları",
    companyInfoDesc: "Hesab-fakturalarda görünən hüquqi məlumatlar. CRM təşkilat adından fərqli ola bilər.",
    companyName: "Şirkət adı",
    companyAddress: "Şirkət ünvanı",
    companyEmail: "E-poçt",
    companyPhone: "Telefon",
    logoUrl: "Logo URL",
    logoHint: "İstəyə bağlıdır. Hesab-faktura başlığında göstərilir.",
    defaults: "Defolt parametrlər",
    defaultsDesc: "Yeni hesab-fakturalara tətbiq olunan dəyərlər. Hər fakturada ayrıca dəyişmək olar.",
    numberPrefix: "Nömrə prefiksi",
    numberPrefixHint: "Hesab-faktura nömrələri üçün prefiks, məsələn INV-001 və ya KP-001.",
    paymentTerms: "Defolt ödəniş şərtləri",
    dueOnReceipt: "Alındıqda ödəniş",
    taxRate: "Defolt vergi dərəcəsi",
    taxHint: "Azərbaycanda standart ƏDV dərəcəsi 18%-dir.",
    currency: "Defolt valyuta",
    bankDetails: "Bank rekvizitləri",
    bankDetailsDesc: "Hesab-fakturada göstəriləcək bank məlumatları.",
    bankName: "Bank adı",
    bankCode: "Kod (MFO)",
    bankAccount: "Hesab nömrəsi",
    bankCorrAccount: "Müxbir hesab",
    signer: "İmzalayan və möhür",
    signerDesc: "Hesab-fakturanı imzalayan şəxsin məlumatları və şirkət möhürü.",
    signerName: "Ad Soyad",
    signerTitle: "Vəzifə",
    companyStamp: "Şirkət möhürü (skan)",
    stampHint: "PNG/JPG formatında möhür şəkli yükləyin. Möhürlü PDF yaradılarkən əlavə ediləcək.",
    stampUploaded: "Möhür yüklənib",
    replace: "Dəyişdir",
    uploadStamp: "Möhür şəklini yükləyin",
    fileHint: "PNG, JPG — maks 2MB",
    actSigner: "Akt imzalayan (təhvil-təslim aktı)",
    signature: "İmza (skan)",
    signatureHint: "PNG/JPG formatında imza şəkli yükləyin. Akt sənədinə əlavə ediləcək.",
    signatureUploaded: "İmza yüklənib",
    uploadSignature: "İmza şəklini yükləyin",
    defaultText: "Defolt mətn",
    defaultTextDesc: "Hər hesab-fakturaya əlavə olunan defolt şərtlər və alt mətn.",
    terms: "Defolt şərtlər",
    footer: "Defolt alt qeyd",
    emailTemplates: "E-poçt şablonları",
    emailTemplatesDesc: "Hesab-faktura göndərilərkən istifadə olunan e-poçt mətni. Hər dil üçün ayrı şablon.",
  },
}

export default function InvoiceSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  useAutoTour("invoiceSettings")
  const tc = useTranslations("common")
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const orgId = (session?.user as { organizationId?: string })?.organizationId

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [templateLang, setTemplateLang] = useState<"az" | "ru" | "en">("az")
  const [emailTemplates, setEmailTemplates] = useState<Record<string, { greeting: string; body: string; closing: string; note: string }>>({
    az: { ...DEFAULT_EMAIL_TEMPLATES.az },
    ru: { ...DEFAULT_EMAIL_TEMPLATES.ru },
    en: { ...DEFAULT_EMAIL_TEMPLATES.en },
  })

  const [settings, setSettings] = useState({
    companyName: "",
    companyAddress: "",
    companyVoen: "",
    companyEmail: "",
    companyPhone: "",
    companyLogoUrl: "",
    numberPrefix: "INV-",
    defaultPaymentTerms: "net30",
    defaultTaxRate: 0.18,
    defaultCurrency: DEFAULT_CURRENCY,
    bankName: "",
    bankCode: "",
    bankSwift: "",
    bankAccount: "",
    bankVoen: "",
    bankCorrAccount: "",
    signerName: "",
    signerTitle: "",
    companyStampUrl: "",
    actSignerName: "",
    actSignerTitle: "",
    actSignerSignatureUrl: "",
    termsAndConditions: "",
    footerNote: "",
  })

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/settings/invoice", {
      headers: { "x-organization-id": String(orgId) },
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success && j.data) {
          const { emailTemplates: savedTemplates, ...rest } = j.data
          setSettings((prev) => ({ ...prev, ...rest }))
          if (savedTemplates && typeof savedTemplates === "object") {
            setEmailTemplates((prev) => {
              const merged = { ...prev }
              for (const lang of ["az", "ru", "en"]) {
                if (savedTemplates[lang]) {
                  merged[lang] = { ...prev[lang], ...savedTemplates[lang] }
                }
              }
              return merged
            })
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  function updateField(field: string, value: string | number) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function removeWhiteBackground(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2]
          // Remove white and near-white pixels
          if (r > 200 && g > 200 && b > 200) {
            // Soft edge: partially transparent for grey pixels
            const brightness = (r + g + b) / 3
            data[i + 3] = Math.round(255 - ((brightness - 200) / 55) * 255)
          }
        }
        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL("image/png"))
      }
      img.src = dataUrl
    })
  }

  function handleStampUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const transparent = await removeWhiteBackground(dataUrl)
      updateField("companyStampUrl", transparent)
    }
    reader.readAsDataURL(file)
  }

  function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const transparent = await removeWhiteBackground(dataUrl)
      updateField("actSignerSignatureUrl", transparent)
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch("/api/v1/settings/invoice", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ...settings, emailTemplates }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      setMsg({ type: "success", text: tc("savedSuccessfully") })
    } catch (err) {
      setMsg({ type: "error", text: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("invoiceSettings")}</h1>
        <div className="animate-pulse">
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-lg">
            <Settings className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 data-tour-id="inv-settings-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("invoiceSettings")} <TourReplayButton tourId="invoiceSettings" /><HelpButton slug="invoice-settings" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">
              {t("invoiceSettingsDesc")}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t("hintInvoiceSettings")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {msg && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-sm",
                msg.type === "success" ? "text-green-600" : "text-red-500"
              )}
            >
              {msg.type === "success" ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {msg.text}
            </div>
          )}
          <Button onClick={handleSave} disabled={saving} className="min-w-[120px]">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {tc("save")}
          </Button>
        </div>
      </div>

      {/* Company Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{c.companyInfo}</CardTitle>
          </div>
          <CardDescription>
            {c.companyInfoDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm">{c.companyName}</Label>
            <Input
              value={settings.companyName}
              onChange={(e) => updateField("companyName", e.target.value)}
              placeholder="Your Company LLC"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">{c.companyAddress}</Label>
            <Textarea
              value={settings.companyAddress}
              onChange={(e) => updateField("companyAddress", e.target.value)}
              placeholder="123 Main St, Baku, Azerbaijan"
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">VÖEN</Label>
              <Input
                value={settings.companyVoen}
                onChange={(e) => updateField("companyVoen", e.target.value)}
                placeholder="1406777811"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.companyEmail}</Label>
              <Input
                type="email"
                value={settings.companyEmail}
                onChange={(e) => updateField("companyEmail", e.target.value)}
                placeholder="info@leaddrivecrm.org"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{c.companyPhone}</Label>
              <Input
                value={settings.companyPhone}
                onChange={(e) => updateField("companyPhone", e.target.value)}
                placeholder="+994 12 000 00 00"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.logoUrl}</Label>
              <Input
                value={settings.companyLogoUrl}
                onChange={(e) => updateField("companyLogoUrl", e.target.value)}
                placeholder="https://example.com/logo.png"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">{c.logoHint}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Default Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{c.defaults}</CardTitle>
          </div>
          <CardDescription>
            {c.defaultsDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{c.numberPrefix}</Label>
              <Input
                value={settings.numberPrefix}
                onChange={(e) => updateField("numberPrefix", e.target.value)}
                placeholder="INV-"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {c.numberPrefixHint}
              </p>
            </div>
            <div>
              <Label className="text-sm">{c.paymentTerms}</Label>
              <Select
                value={settings.defaultPaymentTerms}
                onChange={(e) => updateField("defaultPaymentTerms", e.target.value)}
                className="mt-1"
              >
                <option value="due_on_receipt">{c.dueOnReceipt}</option>
                <option value="net15">Net 15</option>
                <option value="net30">Net 30</option>
                <option value="net45">Net 45</option>
                <option value="net60">Net 60</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{c.taxRate}</Label>
              <div className="relative mt-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={Math.round(settings.defaultTaxRate * 100 * 100) / 100}
                  onChange={(e) => updateField("defaultTaxRate", Number(e.target.value) / 100)}
                  placeholder="18"
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {c.taxHint}
              </p>
            </div>
            <div>
              <Label className="text-sm">{c.currency}</Label>
              <Select
                value={settings.defaultCurrency}
                onChange={(e) => updateField("defaultCurrency", e.target.value)}
                className="mt-1"
              >
                {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                  <option key={code} value={code}>{code} {sym}</option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader>
          <CardTitle>{c.bankDetails}</CardTitle>
          <CardDescription>
            {c.bankDetailsDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{c.bankName}</Label>
              <Input
                value={settings.bankName}
                onChange={(e) => updateField("bankName", e.target.value)}
                placeholder="Example Bank ASC"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.bankCode}</Label>
              <Input
                value={settings.bankCode}
                onChange={(e) => updateField("bankCode", e.target.value)}
                placeholder="200087"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">SWIFT</Label>
              <Input
                value={settings.bankSwift}
                onChange={(e) => updateField("bankSwift", e.target.value)}
                placeholder="AIIBAZ2X"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.bankAccount}</Label>
              <Input
                value={settings.bankAccount}
                onChange={(e) => updateField("bankAccount", e.target.value)}
                placeholder="AZ00AIIB00000000000000000000"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">VÖEN</Label>
              <Input
                value={settings.bankVoen}
                onChange={(e) => updateField("bankVoen", e.target.value)}
                placeholder="1234567890"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.bankCorrAccount}</Label>
              <Input
                value={settings.bankCorrAccount}
                onChange={(e) => updateField("bankCorrAccount", e.target.value)}
                placeholder="AZ00NABZ00000000000000000000"
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signer */}
      <Card>
        <CardHeader>
          <CardTitle>{c.signer}</CardTitle>
          <CardDescription>
            {c.signerDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{c.signerName}</Label>
              <Input
                value={settings.signerName}
                onChange={(e) => updateField("signerName", e.target.value)}
                placeholder="Yusif Rzayev"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{c.signerTitle}</Label>
              <Input
                value={settings.signerTitle}
                onChange={(e) => updateField("signerTitle", e.target.value)}
                placeholder="Director of LeadDrive Inc."
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-sm">{c.companyStamp}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              {c.stampHint}
            </p>
            {settings.companyStampUrl ? (
              <div className="flex items-start gap-4 mt-1">
                <div className="relative border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={settings.companyStampUrl}
                    alt="Company stamp"
                    className="w-32 h-32 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => updateField("companyStampUrl", "")}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 hover:bg-destructive/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-green-600 font-medium mb-2">✓ {c.stampUploaded}</p>
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 hover:bg-muted/50 w-fit">
                      <Upload className="h-4 w-4" />
                      {c.replace}
                    </div>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={handleStampUpload}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <label className="cursor-pointer mt-1 block">
                <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 hover:bg-muted/30 transition-colors">
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">{c.uploadStamp}</span>
                  <span className="text-xs text-muted-foreground mt-1">{c.fileHint}</span>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={handleStampUpload}
                />
              </label>
            )}
          </div>

          {/* Act signer section */}
          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-semibold mb-3">{c.actSigner}</h4>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <Label className="text-sm">{c.signerName}</Label>
                <Input
                  value={settings.actSignerName || ""}
                  onChange={(e) => updateField("actSignerName", e.target.value)}
                  placeholder="Rəşad Rəhimov"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm">{c.signerTitle}</Label>
                <Input
                  value={settings.actSignerTitle || ""}
                  onChange={(e) => updateField("actSignerTitle", e.target.value)}
                  placeholder="Biznes və strateji şirkətlər üzrə xüsusi nümayəndə"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">{c.signature}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                {c.signatureHint}
              </p>
              {settings.actSignerSignatureUrl ? (
                <div className="flex items-start gap-4 mt-1">
                  <div className="relative border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-muted/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={settings.actSignerSignatureUrl}
                      alt="Signature"
                      className="w-32 h-20 object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => updateField("actSignerSignatureUrl", "")}
                      className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 hover:bg-destructive/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-green-600 font-medium mb-2">✓ {c.signatureUploaded}</p>
                    <label className="cursor-pointer">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 hover:bg-muted/50 w-fit">
                        <Upload className="h-4 w-4" />
                        {c.replace}
                      </div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        onChange={handleSignatureUpload}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="cursor-pointer mt-1 block">
                  <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 hover:bg-muted/30 transition-colors">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm font-medium">{c.uploadSignature}</span>
                    <span className="text-xs text-muted-foreground mt-1">{c.fileHint}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={handleSignatureUpload}
                  />
                </label>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Default Text */}
      <Card>
        <CardHeader>
          <CardTitle>{c.defaultText}</CardTitle>
          <CardDescription>
            {c.defaultTextDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm">{c.terms}</Label>
            <Textarea
              value={settings.termsAndConditions}
              onChange={(e) => updateField("termsAndConditions", e.target.value)}
              placeholder="Payment is due within the specified terms. Late payments may incur additional charges."
              rows={4}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm">{c.footer}</Label>
            <Textarea
              value={settings.footerNote}
              onChange={(e) => updateField("footerNote", e.target.value)}
              placeholder="Thank you for your business!"
              rows={3}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Email Templates */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{c.emailTemplates}</CardTitle>
              <CardDescription>
                {c.emailTemplatesDesc}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Language tabs */}
          <div className="flex gap-1 border-b">
            {(["az", "ru", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setTemplateLang(lang)}
                className={cn(
                  "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  templateLang === lang
                    ? "border-cyan-500 text-cyan-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {lang === "az" ? tc("langAzerbaijani") : lang === "ru" ? tc("langRussian") : tc("langEnglish")}
              </button>
            ))}
          </div>

          {/* Template fields for selected language */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm">{t("emailTemplateGreeting")}</Label>
              <Input
                value={emailTemplates[templateLang]?.greeting || ""}
                onChange={(e) => setEmailTemplates((prev) => ({
                  ...prev,
                  [templateLang]: { ...prev[templateLang], greeting: e.target.value },
                }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{t("emailTemplateBody")}</Label>
              <Textarea
                value={emailTemplates[templateLang]?.body || ""}
                onChange={(e) => setEmailTemplates((prev) => ({
                  ...prev,
                  [templateLang]: { ...prev[templateLang], body: e.target.value },
                }))}
                rows={4}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{t("emailTemplateClosing")}</Label>
              <Textarea
                value={emailTemplates[templateLang]?.closing || ""}
                onChange={(e) => setEmailTemplates((prev) => ({
                  ...prev,
                  [templateLang]: { ...prev[templateLang], closing: e.target.value },
                }))}
                rows={2}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">{t("emailTemplateNote")}</Label>
              <Textarea
                value={emailTemplates[templateLang]?.note || ""}
                onChange={(e) => setEmailTemplates((prev) => ({
                  ...prev,
                  [templateLang]: { ...prev[templateLang], note: e.target.value },
                }))}
                rows={2}
                className="mt-1"
              />
            </div>
          </div>

          <div className="bg-muted/50 rounded-md px-3 py-2 text-xs text-muted-foreground">
            <strong>Dəyişənlər:</strong> {"{orgName}"} — şirkət adı, {"{invoiceNumber}"} — faktura nömrəsi, {"{total}"} — yekun məbləğ, {"{currency}"} — valyuta, {"{dueDate}"} — ödəniş tarixi
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
