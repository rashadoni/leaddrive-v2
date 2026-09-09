"use client"

import { useState, useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shield, ShieldCheck, ShieldOff, Copy, Check, Loader2, ArrowLeft, Smartphone, Key, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { Sms2FACard } from "@/components/sms-2fa-card"


type SecurityApiKey = {
  id: string
  name: string
  keyPrefix: string
  scopes?: string[]
  isActive: boolean
  expiresAt?: string | null
  lastUsedAt?: string | null
}

type Loc = "en" | "ru" | "az"
const SECURITY_COPY: Record<Loc, Record<string, string>> = {
  en: {
    keyName: "Key name",
    scopes: "Scopes",
    selectAllRead: "Select all read",
    clear: "Clear",
    read: "read",
    write: "write",
    generateKey: "Generate key",
    keyCreated: "Key created. Copy it now because it will not be shown again.",
    done: "Done",
    totpEnabledTitle: "2FA Enabled",
    totpDisabledTitle: "2FA Not Enabled",
    totpEnabledDesc: "Your account is protected with two-factor authentication.",
    totpDisabledDesc: "Add an extra layer of security to your account.",
    howItWorksTitle: "How it works",
    howItWorksDesc: "After enabling 2FA, you will need to enter a 6-digit code from your authenticator app every time you sign in.",
    disable2fa: "Disable 2FA",
    enable2fa: "Enable 2FA",
    scanQrTitle: "Step 1: Scan QR Code",
    scanQrDesc: "Scan this QR code with your authenticator app, such as Google Authenticator, Authy, or Microsoft Authenticator.",
    qrAlt: "2FA QR Code",
    manualKeyHint: "Cannot scan? Enter this key manually:",
    codeStepTitle: "Step 2: Enter verification code",
    verifyAndEnable: "Verify & Enable",
    backupSuccessTitle: "2FA Enabled Successfully!",
    backupCodesTitle: "Save your backup codes!",
    backupCodesDesc: "Store these codes safely. If you lose your authenticator app, you can use them to sign in. Each code can only be used once.",
    copyAllCodes: "Copy All Codes",
    copied: "Copied!",
    disable2faDesc: "Enter your current 6-digit code from the authenticator app to disable 2FA.",
  },
  ru: {
    keyName: "Название ключа",
    scopes: "Scopes",
    selectAllRead: "Выбрать все read",
    clear: "Очистить",
    read: "read",
    write: "write",
    generateKey: "Сгенерировать ключ",
    keyCreated: "Ключ создан. Скопируйте его сейчас, потому что он больше не будет показан.",
    done: "Готово",
    totpEnabledTitle: "2FA включена",
    totpDisabledTitle: "2FA не включена",
    totpEnabledDesc: "Ваш аккаунт защищён двухфакторной аутентификацией.",
    totpDisabledDesc: "Добавьте второй фактор, чтобы лучше защитить вход в аккаунт.",
    howItWorksTitle: "Как это работает",
    howItWorksDesc: "После включения 2FA при каждом входе нужно будет вводить 6-значный код из приложения-аутентификатора.",
    disable2fa: "Отключить 2FA",
    enable2fa: "Включить 2FA",
    scanQrTitle: "Шаг 1: отсканируйте QR-код",
    scanQrDesc: "Отсканируйте этот QR-код в приложении-аутентификаторе, например Google Authenticator, Authy или Microsoft Authenticator.",
    qrAlt: "QR-код 2FA",
    manualKeyHint: "Не получается сканировать? Введите этот ключ вручную:",
    codeStepTitle: "Шаг 2: введите код подтверждения",
    verifyAndEnable: "Проверить и включить",
    backupSuccessTitle: "2FA успешно включена!",
    backupCodesTitle: "Сохраните резервные коды!",
    backupCodesDesc: "Храните эти коды в безопасном месте. Если вы потеряете приложение-аутентификатор, их можно использовать для входа. Каждый код работает только один раз.",
    copyAllCodes: "Скопировать все коды",
    copied: "Скопировано!",
    disable2faDesc: "Введите текущий 6-значный код из приложения-аутентификатора, чтобы отключить 2FA.",
  },
  az: {
    keyName: "Açar adı",
    scopes: "Scopes",
    selectAllRead: "Bütün read icazələrini seç",
    clear: "Təmizlə",
    read: "read",
    write: "write",
    generateKey: "Açar yarat",
    keyCreated: "Açar yaradıldı. İndi kopyalayın, çünki bir daha göstərilməyəcək.",
    done: "Hazırdır",
    totpEnabledTitle: "2FA aktivdir",
    totpDisabledTitle: "2FA aktiv deyil",
    totpEnabledDesc: "Hesabınız iki faktorlu autentifikasiya ilə qorunur.",
    totpDisabledDesc: "Hesab girişini daha yaxşı qorumaq üçün ikinci təsdiq addımı əlavə edin.",
    howItWorksTitle: "Necə işləyir",
    howItWorksDesc: "2FA aktivləşdirildikdən sonra hər girişdə autentifikator tətbiqindən 6 rəqəmli kod daxil etməlisiniz.",
    disable2fa: "2FA deaktiv et",
    enable2fa: "2FA aktiv et",
    scanQrTitle: "Addım 1: QR kodu skan edin",
    scanQrDesc: "Bu QR kodu Google Authenticator, Authy və ya Microsoft Authenticator kimi autentifikator tətbiqində skan edin.",
    qrAlt: "2FA QR kodu",
    manualKeyHint: "Skan edə bilmirsiniz? Bu açarı əl ilə daxil edin:",
    codeStepTitle: "Addım 2: təsdiq kodunu daxil edin",
    verifyAndEnable: "Təsdiqlə və aktiv et",
    backupSuccessTitle: "2FA uğurla aktiv edildi!",
    backupCodesTitle: "Ehtiyat kodları saxlayın!",
    backupCodesDesc: "Bu kodları təhlükəsiz yerdə saxlayın. Autentifikator tətbiqini itirsəniz, giriş üçün istifadə edə bilərsiniz. Hər kod yalnız bir dəfə işləyir.",
    copyAllCodes: "Bütün kodları kopyala",
    copied: "Kopyalandı!",
    disable2faDesc: "2FA-nı deaktiv etmək üçün autentifikator tətbiqindən cari 6 rəqəmli kodu daxil edin.",
  },
}

export default function SecuritySettingsPage() {
  const t = useTranslations("settings")
  const ta = useTranslations("apiKeys")
  const locale = useLocale()
  const c = SECURITY_COPY[(locale as Loc) || "en"] ?? SECURITY_COPY.en
  useAutoTour("security")
  const tc = useTranslations("common")
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<"status" | "setup" | "verify" | "backup" | "disable">("status")
  const [qrCode, setQrCode] = useState("")
  const [secret, setSecret] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [processing, setProcessing] = useState(false)
  const [copied, setCopied] = useState(false)

  // API Keys state
  const [apiKeys, setApiKeys] = useState<SecurityApiKey[]>([])
  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read:companies", "read:contacts", "read:deals"])
  const [newKeyExpiry, setNewKeyExpiry] = useState("90")
  const [generatedKey, setGeneratedKey] = useState("")
  const [keyCopied, setKeyCopied] = useState(false)
  const [keyLoading, setKeyLoading] = useState(false)
  const [availableModules, setAvailableModules] = useState<string[]>([])

  const fetchApiKeys = () => {
    fetch("/api/v1/api-keys").then(r => r.json()).then(j => {
      if (j.success) setApiKeys(j.data)
    })
  }

  const fetchApiKeyScopes = () => {
    fetch("/api/v1/api-keys/scopes").then(r => r.json()).then(j => {
      if (j.success) setAvailableModules(j.data.modules)
    })
  }

  useEffect(() => {
    fetch("/api/v1/auth/2fa")
      .then(r => r.json())
      .then(j => {
        if (j.success) setEnabled(j.data.enabled)
      })
      .finally(() => setLoading(false))
    fetchApiKeys()
    fetchApiKeyScopes()
  }, [])

  const handleSetup = async () => {
    setProcessing(true)
    setError("")
    try {
      const res = await fetch("/api/v1/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      })
      const json = await res.json()
      if (json.success) {
        setQrCode(json.data.qrCode)
        setSecret(json.data.secret)
        setBackupCodes(json.data.backupCodes)
        setStep("setup")
      } else {
        setError(json.error)
      }
    } catch { setError(tc("errorGeneric")) }
    finally { setProcessing(false) }
  }

  const handleVerify = async () => {
    if (code.length !== 6) { setError("Enter 6-digit code"); return }
    setProcessing(true)
    setError("")
    try {
      const res = await fetch("/api/v1/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      })
      const json = await res.json()
      if (json.success) {
        setEnabled(true)
        setStep("backup")
      } else {
        setError(json.error || "Invalid code")
      }
    } catch { setError(tc("errorVerification")) }
    finally { setProcessing(false) }
  }

  const handleDisable = async () => {
    if (code.length !== 6) { setError("Enter 6-digit code"); return }
    setProcessing(true)
    setError("")
    try {
      const res = await fetch("/api/v1/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code }),
      })
      const json = await res.json()
      if (json.success) {
        setEnabled(false)
        setStep("status")
        setCode("")
      } else {
        setError(json.error || "Invalid code")
      }
    } catch { setError(tc("errorGeneric")) }
    finally { setProcessing(false) }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 data-tour-id="security-header" className="text-xl font-bold flex items-center gap-2">{t("security")} <TourReplayButton tourId="security" /><HelpButton slug="security-settings" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("hintSecurity")}</p>
        </div>
      </div>

      {/* Status card */}
      {step === "status" && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className={`h-14 w-14 rounded-2xl flex items-center justify-center ${enabled ? "bg-green-100" : "bg-orange-100"}`}>
                {enabled ? <ShieldCheck className="h-7 w-7 text-green-600" /> : <ShieldOff className="h-7 w-7 text-orange-600" />}
              </div>
              <div>
                <h2 className="text-lg font-bold">{enabled ? c.totpEnabledTitle : c.totpDisabledTitle}</h2>
                <p className="text-sm text-muted-foreground">
                  {enabled ? c.totpEnabledDesc : c.totpDisabledDesc}
                </p>
              </div>
              <Badge className={`ml-auto ${enabled ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                {enabled ? tc("active") : tc("inactive")}
              </Badge>
            </div>

            <div className="bg-muted/50 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <Smartphone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{c.howItWorksTitle}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.howItWorksDesc}
                  </p>
                </div>
              </div>
            </div>

            {enabled ? (
              <Button variant="destructive" onClick={() => { setStep("disable"); setCode(""); setError("") }}>
                <ShieldOff className="h-4 w-4 mr-2" /> {c.disable2fa}
              </Button>
            ) : (
              <Button onClick={handleSetup} disabled={processing}>
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                {c.enable2fa}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Setup step — QR code */}
      {step === "setup" && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{c.scanQrTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {c.scanQrDesc}
            </p>

            <div className="flex justify-center">
              <div className="bg-card p-4 rounded-xl shadow-inner border border-zinc-200 dark:border-zinc-700">
                {qrCode && <Image src={qrCode} alt={c.qrAlt} width={192} height={192} unoptimized />}
              </div>
            </div>

            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">{c.manualKeyHint}</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono bg-background rounded px-2 py-1 flex-1 overflow-hidden text-ellipsis">
                  {secret}
                </code>
                <Button variant="ghost" size="sm" onClick={copySecret}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{c.codeStepTitle}</p>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full text-center text-2xl font-mono tracking-[0.5em] border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary"
                maxLength={6}
                autoFocus
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep("status"); setCode(""); setError("") }}>{tc("cancel")}</Button>
              <Button onClick={handleVerify} disabled={processing || code.length !== 6} className="flex-1">
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                {c.verifyAndEnable}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup codes */}
      {step === "backup" && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              {c.backupSuccessTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">{c.backupCodesTitle}</p>
              <p className="text-xs text-amber-700">
                {c.backupCodesDesc}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((bc, i) => (
                <div key={i} className="font-mono text-sm bg-muted/50 rounded-lg px-3 py-2 text-center">
                  {bc}
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(backupCodes.join("\n"))
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? c.copied : c.copyAllCodes}
            </Button>

            <Button onClick={() => setStep("status")} className="w-full">
              {c.done}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Disable step */}
      {step === "disable" && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-red-600">{c.disable2fa}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {c.disable2faDesc}
            </p>

            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full text-center text-2xl font-mono tracking-[0.5em] border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-red-500"
              maxLength={6}
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep("status"); setCode(""); setError("") }}>{tc("cancel")}</Button>
              <Button variant="destructive" onClick={handleDisable} disabled={processing || code.length !== 6} className="flex-1">
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-2" />}
                {c.disable2fa}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* ═══ SMS 2FA Section ═══ */}
      <div className="border-t pt-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-sky-100 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-sky-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{t("sms2faSectionTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("sms2faSectionDesc")}</p>
          </div>
        </div>
        <Sms2FACard />
      </div>

      {/* ═══ API Keys Section ═══ */}
      <div className="border-t pt-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Key className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{ta("title")}</h2>
              <p className="text-sm text-muted-foreground">{ta("subtitle")}</p>
            </div>
          </div>
          <Button onClick={() => { setShowNewKey(true); setGeneratedKey(""); setNewKeyName("") }} className="gap-2">
            <Plus className="h-4 w-4" /> {ta("createKey")}
          </Button>
        </div>

        {/* Generate new key form */}
        {showNewKey && (
          <Card className="border-amber-200 bg-amber-50/50 mb-4">
            <CardContent className="p-4 space-y-3">
              {generatedKey ? (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-green-800 mb-1">{c.keyCreated}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <code className="text-xs font-mono bg-card rounded px-2 py-1.5 flex-1 overflow-hidden text-ellipsis border border-zinc-200 dark:border-zinc-700">
                        {generatedKey}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => {
                        navigator.clipboard.writeText(generatedKey)
                        setKeyCopied(true)
                        setTimeout(() => setKeyCopied(false), 2000)
                      }}>
                        {keyCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => { setShowNewKey(false); setGeneratedKey("") }} className="w-full">
                    {c.done}
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">{c.keyName}</Label>
                    <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder={ta("namePlaceholder")} className="mt-1" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs">{c.scopes}</Label>
                      <div className="flex gap-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setNewKeyScopes(availableModules.map(m => `read:${m}`))}
                          className="text-primary hover:underline"
                        >
                          {c.selectAllRead}
                        </button>
                        <span className="text-muted-foreground">·</span>
                        <button
                          type="button"
                          onClick={() => setNewKeyScopes([])}
                          className="text-muted-foreground hover:underline"
                        >
                          {c.clear}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {availableModules.map(mod => {
                        const readScope = `read:${mod}`
                        const writeScope = `write:${mod}`
                        const readOn = newKeyScopes.includes(readScope)
                        const writeOn = newKeyScopes.includes(writeScope)
                        const toggle = (scope: string) =>
                          setNewKeyScopes(prev =>
                            prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
                          )
                        return (
                          <div key={mod} className="flex items-center justify-between gap-2 py-1">
                            <span className="text-xs font-medium capitalize">{mod}</span>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggle(readScope)}
                                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${readOn ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 hover:bg-muted"}`}
                              >
                                {c.read}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggle(writeScope)}
                                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${writeOn ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 hover:bg-muted"}`}
                              >
                                {c.write}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{ta("expiresLabel")}</Label>
                    <select value={newKeyExpiry} onChange={(e) => setNewKeyExpiry(e.target.value)} className="mt-1 w-full border border-zinc-200 dark:border-zinc-700 rounded-md p-2 text-sm">
                      <option value="30">{ta("thirtyDays")}</option>
                      <option value="90">{ta("ninetyDays")}</option>
                      <option value="365">{ta("oneYear")}</option>
                      <option value="">{ta("neverExpires")}</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowNewKey(false)}>{tc("cancel")}</Button>
                    <Button
                      disabled={!newKeyName || newKeyScopes.length === 0 || keyLoading}
                      onClick={async () => {
                        setKeyLoading(true)
                        try {
                          const res = await fetch("/api/v1/api-keys", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: newKeyName, scopes: newKeyScopes, expiresInDays: newKeyExpiry ? parseInt(newKeyExpiry) : null }),
                          })
                          const json = await res.json()
                          if (json.success) {
                            setGeneratedKey(json.data.key)
                            fetchApiKeys()
                          }
                        } catch {} finally { setKeyLoading(false) }
                      }}
                      className="flex-1 gap-2"
                    >
                      {keyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                      {c.generateKey}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Existing keys list */}
        {apiKeys.length === 0 && !showNewKey ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">{ta("noKeys")}</p>
              <p className="mt-1 text-xs">{ta("noKeysDesc")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => { setShowNewKey(true); setGeneratedKey(""); setNewKeyName("") }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {ta("createFirstKey")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {apiKeys.map(key => (
              <Card key={key.id} className={!key.isActive ? "opacity-50" : ""}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{key.name}</span>
                      <Badge variant={key.isActive ? "default" : "secondary"} className="text-[10px]">
                        {key.isActive ? tc("active") : ta("revokedBadge")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <code className="bg-muted rounded px-1.5 py-0.5">{key.keyPrefix}...</code>
                      <span>{ta("scopeCount", { count: key.scopes?.length || 0 })}</span>
                      {key.expiresAt && <span>{ta("expires")}: {new Date(key.expiresAt).toLocaleDateString(locale)}</span>}
                      {key.lastUsedAt && <span>{ta("lastUsed")}: {new Date(key.lastUsedAt).toLocaleDateString(locale)}</span>}
                    </div>
                  </div>
                  {key.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={async () => {
                        if (!confirm(ta("revokeConfirm", { name: key.name }))) return
                        await fetch(`/api/v1/api-keys/${key.id}`, { method: "DELETE" })
                        fetchApiKeys()
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
