"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ArrowRight, Copy, Download, Info, MessageCircle, Phone, RefreshCw, Save, Loader2, TestTube, CheckCircle, XCircle } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { VoiceCallingHours } from "@/components/voip/voice-calling-hours"
import { DEFAULT_VOICE_AGENT_PROMPT } from "@/lib/voice-agent/default-prompt"

type Provider = "twilio" | "threecx" | "asterisk" | "custom-sip"
type SipTransport = "udp" | "tcp" | "tls" | "wss"
type VoiceAgentMode = "inbound" | "outbound" | "both"

type ChannelSettings = {
  provider?: Provider
  recordCalls?: boolean
  accountSid?: string
  authToken?: string
  twilioNumber?: string
  serverUrl?: string
  extension?: string
  clientId?: string
  apiKey?: string
  webhookSecret?: string
  ariHost?: string
  ariPort?: number | string
  username?: string
  password?: string
  context?: string
  callerExtension?: string
  sipServer?: string
  sipPort?: number | string
  sipDomain?: string
  transport?: SipTransport
  secret?: string
  voiceAgentEnabled?: boolean
  manualLeadAiCallsEnabled?: boolean
  voiceQueueEnabled?: boolean
  voiceAgentMode?: VoiceAgentMode
  voiceAgentPrompt?: string
  voiceAgentKnowledge?: string
}

type ChannelConfig = {
  id: string
  isActive?: boolean
  phoneNumber?: string
  settings?: ChannelSettings
}

type ChannelsResponse = {
  success?: boolean
  data?: ChannelConfig | null
  error?: string
}

type ThreeCxSetupResponse = {
  success?: boolean
  data?: {
    ready?: boolean
    lookupUrl?: string | null
    journalUrl?: string | null
  }
}

/**
 * 32 hex chars from the Web Crypto RNG. The 3CX lookup/journal endpoints are
 * public (the PBX carries no session) and gated on this value alone, so it has
 * to be long enough to stand on its own.
 */
function generateIntegrationSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
}

function CopyableUrl({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the value stays selectable in the input */
    }
  }

  return (
    <div className="grid gap-1">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} />
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={copy}>
          {copied ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copyLabel}
        </Button>
      </div>
    </div>
  )
}

export default function VoipSettingsPage() {
  const t = useTranslations("voipSettings")
  useAutoTour("voip")

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const [configId, setConfigId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>("twilio")
  const [recordCalls, setRecordCalls] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [voiceAgentEnabled, setVoiceAgentEnabled] = useState(false)
  const [manualLeadAiCallsEnabled, setManualLeadAiCallsEnabled] = useState(false)
  const [voiceQueueEnabled, setVoiceQueueEnabled] = useState(false)
  const [voiceAgentMode, setVoiceAgentMode] = useState<VoiceAgentMode>("outbound")
  const [voiceAgentPrompt, setVoiceAgentPrompt] = useState(DEFAULT_VOICE_AGENT_PROMPT)
  const [voiceAgentKnowledge, setVoiceAgentKnowledge] = useState("")

  // Twilio fields
  const [accountSid, setAccountSid] = useState("")
  const [authToken, setAuthToken] = useState("")
  const [twilioNumber, setTwilioNumber] = useState("")

  // 3CX fields
  const [serverUrl, setServerUrl] = useState("")
  const [extension, setExtension] = useState("")
  const [clientId, setClientId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [threeCxUrls, setThreeCxUrls] = useState<{ lookupUrl: string; journalUrl: string } | null>(null)

  // Asterisk fields
  const [ariHost, setAriHost] = useState("")
  const [ariPort, setAriPort] = useState("8088")
  const [ariUsername, setAriUsername] = useState("")
  const [ariPassword, setAriPassword] = useState("")
  const [ariContext, setAriContext] = useState("from-internal")
  const [callerExtension, setCallerExtension] = useState("")

  // Custom SIP fields
  const [sipServer, setSipServer] = useState("")
  const [sipPort, setSipPort] = useState("5060")
  const [sipDomain, setSipDomain] = useState("")
  const [sipTransport, setSipTransport] = useState<SipTransport>("wss")
  const [sipUsername, setSipUsername] = useState("")
  const [sipSecret, setSipSecret] = useState("")

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/voip/config", { cache: "no-store" })
      const data = await res.json() as ChannelsResponse
      const config = data.success ? data.data ?? null : null
      if (config) {
        setConfigId(config.id)
        setIsActive(Boolean(config.isActive))
        const s = config.settings || {}
        const p = s.provider || "twilio"
        setProvider(p)
        setRecordCalls(s.recordCalls || false)
        setVoiceAgentEnabled(s.voiceAgentEnabled === true)
        setManualLeadAiCallsEnabled(s.manualLeadAiCallsEnabled === true)
        setVoiceQueueEnabled(s.voiceQueueEnabled === true)
        setVoiceAgentMode(s.voiceAgentMode || "outbound")
        setVoiceAgentPrompt(s.voiceAgentPrompt || DEFAULT_VOICE_AGENT_PROMPT)
        setVoiceAgentKnowledge(s.voiceAgentKnowledge || "")

        // Load provider-specific fields
        if (p === "twilio") {
          setAccountSid(s.accountSid || "")
          setAuthToken(s.authToken || "")
          setTwilioNumber(s.twilioNumber || config.phoneNumber || "")
        } else if (p === "threecx") {
          setServerUrl(s.serverUrl || "")
          setExtension(s.extension || "")
          setClientId(s.clientId || "")
          setApiKey(s.apiKey || "")
          setWebhookSecret(s.webhookSecret || "")
        } else if (p === "asterisk") {
          setAriHost(s.ariHost || "")
          setAriPort(String(s.ariPort || 8088))
          setAriUsername(s.username || "")
          setAriPassword(s.password || "")
          setAriContext(s.context || "from-internal")
          setCallerExtension(s.callerExtension || "")
        } else if (p === "custom-sip") {
          setSipServer(s.sipServer || "")
          setSipPort(String(s.sipPort || 5060))
          setSipDomain(s.sipDomain || "")
          setSipTransport(s.transport || "wss")
          setSipUsername(s.username || "")
          setSipSecret(s.secret || "")
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // The lookup/journal URLs embed the saved secret, so they are built server-side
  // and only exist once the config has been persisted.
  const loadThreeCxUrls = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/calls/threecx/setup")
      const data = await res.json() as ThreeCxSetupResponse
      const info = data.success ? data.data : null
      setThreeCxUrls(
        info?.ready && info.lookupUrl && info.journalUrl
          ? { lookupUrl: info.lookupUrl, journalUrl: info.journalUrl }
          : null,
      )
    } catch {
      setThreeCxUrls(null)
    }
  }, [])

  useEffect(() => {
    if (provider === "threecx" && configId) {
      loadThreeCxUrls()
    } else {
      setThreeCxUrls(null)
    }
  }, [provider, configId, loadThreeCxUrls])

  const voiceAgentPromptMissing = voiceAgentEnabled && !voiceAgentPrompt.trim()

  const buildSettings = () => {
    const common = {
      recordCalls,
      voiceAgentEnabled,
      manualLeadAiCallsEnabled:
        manualLeadAiCallsEnabled
        && provider === "asterisk"
        && voiceAgentEnabled
        && voiceAgentMode !== "inbound",
      voiceQueueEnabled:
        voiceQueueEnabled
        && manualLeadAiCallsEnabled
        && provider === "asterisk"
        && voiceAgentEnabled
        && voiceAgentMode !== "inbound",
      voiceAgentMode,
      voiceAgentPrompt: voiceAgentPrompt.trim(),
      voiceAgentKnowledge: voiceAgentKnowledge.trim(),
    }
    switch (provider) {
      case "twilio":
        return { provider: "twilio", accountSid, authToken, twilioNumber, ...common }
      case "threecx":
        return { provider: "threecx", serverUrl, extension, clientId, apiKey, webhookSecret, ...common }
      case "asterisk":
        return {
          provider: "asterisk",
          ariHost,
          ariPort: parseInt(ariPort) || 8088,
          username: ariUsername,
          password: ariPassword,
          context: ariContext,
          callerExtension,
          ...common,
        }
      case "custom-sip":
        return {
          provider: "custom-sip",
          sipServer,
          sipPort: parseInt(sipPort) || 5060,
          sipDomain,
          transport: sipTransport,
          username: sipUsername,
          secret: sipSecret,
          ...common,
        }
    }
  }

  const providerConfigName: Record<Provider, string> = {
    twilio: "Twilio VoIP",
    threecx: "3CX VoIP",
    asterisk: "Asterisk VoIP",
    "custom-sip": "Custom SIP",
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...(configId ? { id: configId } : {}),
        configName: providerConfigName[provider],
        phoneNumber: provider === "twilio" ? twilioNumber : "",
        isActive,
        settings: buildSettings(),
      }

      const res = await fetch("/api/v1/voip/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as ChannelsResponse
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.data?.id) setConfigId(data.data.id)
      setTestResult({ success: true, message: t("configSaved") })
      if (provider === "threecx") await loadThreeCxUrls()
    } catch (e) {
      console.error(e)
      setTestResult({ success: false, message: (e as Error).message || t("testFailed") })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/v1/calls/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerConfigId: configId }),
      })
      const data = await res.json()
      setTestResult({
        success: data.success,
        message: data.success ? t("testSuccess") : (data.message || data.error || t("testFailed")),
      })
    } catch {
      setTestResult({ success: false, message: t("testFailed") })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  const providerDescriptions: Record<Provider, string> = {
    twilio: t("twilioDesc"),
    threecx: t("threecxDesc"),
    asterisk: t("asteriskDesc"),
    "custom-sip": t("customSipDesc"),
  }

  return (
    <div className="space-y-6">
      <div data-tour-id="voip-header" className="flex items-center gap-2">
        <div className="flex-1">
          <PageDescription
            title={t("title")}
            description={t("description")}
          />
        </div>
        <TourReplayButton tourId="voip" />
        <HelpButton slug="settings-voip" variant="label" />
      </div>

      <Card className="bg-muted/30">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("whatsappCallingNoticeTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("whatsappCallingNoticeBody")}</p>
            </div>
          </div>
          <Button asChild variant="secondary" className="shrink-0 gap-2 border bg-background">
            <Link href="/settings/channels/connect/whatsapp-business-calls">
              <MessageCircle className="h-4 w-4" />
              {t("whatsappCallingNoticeAction")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Provider Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t("provider")}
            {configId && (
              <Badge variant={isActive ? "default" : "secondary"}>
                {isActive ? t("active") : t("inactive")}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{t("selectProvider")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={provider}
            onChange={(e) => {
              const nextProvider = e.target.value as Provider
              setProvider(nextProvider)
              if (nextProvider !== "asterisk") setVoiceQueueEnabled(false)
              setTestResult(null)
            }}
            className="w-full sm:w-[300px]"
          >
            <option value="twilio">{t("twilio")}</option>
            <option value="threecx">{t("threecx")}</option>
            <option value="asterisk">{t("asterisk")}</option>
            <option value="custom-sip">{t("customSip")}</option>
          </Select>

          <p className="text-sm text-muted-foreground">{providerDescriptions[provider]}</p>
          <p className="text-xs text-muted-foreground">{t("supportedProvidersHint")}</p>
        </CardContent>
      </Card>

      {/* Provider-specific fields */}
      <Card>
        <CardHeader>
          <CardTitle>{providerConfigName[provider]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Twilio fields */}
          {provider === "twilio" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("accountSid")}</Label>
                  <Input value={accountSid} onChange={e => setAccountSid(e.target.value)} placeholder="AC..." />
                  <p className="text-xs text-muted-foreground">{t("accountSidHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("authToken")}</Label>
                  <Input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder="Your Twilio Auth Token" />
                  <p className="text-xs text-muted-foreground">{t("authTokenHint")}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t("twilioNumber")}</Label>
                <Input value={twilioNumber} onChange={e => setTwilioNumber(e.target.value)} placeholder="+1234567890" />
                <p className="text-xs text-muted-foreground">{t("twilioNumberHint")}</p>
              </div>
            </>
          )}

          {/* 3CX fields */}
          {provider === "threecx" && (
            <>
              <div className="grid gap-2">
                <Label>{t("serverUrl")}</Label>
                <Input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://mycompany.3cx.eu" />
                <p className="text-xs text-muted-foreground">{t("serverUrlHint")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("extension")}</Label>
                  <Input value={extension} onChange={e => setExtension(e.target.value)} placeholder="101" />
                  <p className="text-xs text-muted-foreground">{t("extensionHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("threecxClientId")}</Label>
                  <Input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="leaddrivecrm" />
                  <p className="text-xs text-muted-foreground">{t("threecxClientIdHint")}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t("apiKey")}</Label>
                <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="3CX API Key" />
                <p className="text-xs text-muted-foreground">{t("apiKeyHint")}</p>
              </div>

              {/* Inbound side: 3CX pushes call events through a CRM template, so the
                  PBX needs a shared secret plus the generated XML. */}
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <Label>{t("threecxIntegrationTitle")}</Label>
                  <p className="text-xs text-muted-foreground">{t("threecxIntegrationHint")}</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={webhookSecret}
                    onChange={e => setWebhookSecret(e.target.value)}
                    placeholder={t("threecxSecretPlaceholder")}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-2"
                    onClick={() => setWebhookSecret(generateIntegrationSecret())}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t("threecxGenerateSecret")}
                  </Button>
                </div>

                {threeCxUrls ? (
                  <div className="space-y-2">
                    <CopyableUrl label={t("threecxLookupUrl")} value={threeCxUrls.lookupUrl} copyLabel={t("copy")} />
                    <CopyableUrl label={t("threecxJournalUrl")} value={threeCxUrls.journalUrl} copyLabel={t("copy")} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("threecxUrlsPending")}</p>
                )}

                {threeCxUrls ? (
                  <Button asChild variant="secondary" className="gap-2">
                    <a href="/api/v1/calls/threecx/template">
                      <Download className="h-4 w-4" />
                      {t("threecxDownloadTemplate")}
                    </a>
                  </Button>
                ) : (
                  <Button variant="secondary" className="gap-2" disabled>
                    <Download className="h-4 w-4" />
                    {t("threecxDownloadTemplate")}
                  </Button>
                )}

                <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>{t("threecxStep1")}</li>
                  <li>{t("threecxStep2")}</li>
                  <li>{t("threecxStep3")}</li>
                </ol>
              </div>
            </>
          )}

          {/* Asterisk fields */}
          {provider === "asterisk" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("ariHost")}</Label>
                  <Input value={ariHost} onChange={e => setAriHost(e.target.value)} placeholder="192.168.1.10" />
                  <p className="text-xs text-muted-foreground">{t("ariHostHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("ariPort")}</Label>
                  <Input value={ariPort} onChange={e => setAriPort(e.target.value)} placeholder="8088" />
                  <p className="text-xs text-muted-foreground">{t("ariPortHint")}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("username")}</Label>
                  <Input value={ariUsername} onChange={e => setAriUsername(e.target.value)} placeholder="ari_user" />
                </div>
                <div className="grid gap-2">
                  <Label>{t("password")}</Label>
                  <Input type="password" value={ariPassword} onChange={e => setAriPassword(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("context")}</Label>
                  <Input value={ariContext} onChange={e => setAriContext(e.target.value)} placeholder="from-internal" />
                  <p className="text-xs text-muted-foreground">{t("contextHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("callerExtension")}</Label>
                  <Input value={callerExtension} onChange={e => setCallerExtension(e.target.value)} placeholder="100" />
                  <p className="text-xs text-muted-foreground">{t("callerExtensionHint")}</p>
                </div>
              </div>
            </>
          )}

          {/* Custom SIP fields */}
          {provider === "custom-sip" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("sipServer")}</Label>
                  <Input value={sipServer} onChange={e => setSipServer(e.target.value)} placeholder="sip.example.com" />
                  <p className="text-xs text-muted-foreground">{t("sipServerHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("sipPort")}</Label>
                  <Input value={sipPort} onChange={e => setSipPort(e.target.value)} placeholder="5060" />
                  <p className="text-xs text-muted-foreground">{t("sipPortHint")}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("sipDomain")}</Label>
                  <Input value={sipDomain} onChange={e => setSipDomain(e.target.value)} placeholder="example.com" />
                  <p className="text-xs text-muted-foreground">{t("sipDomainHint")}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("transport")}</Label>
                  <Select
                    value={sipTransport}
                    onChange={(e) => setSipTransport(e.target.value as SipTransport)}
                  >
                    <option value="wss">WSS (WebSocket Secure)</option>
                    <option value="tls">TLS</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("transportHint")}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t("username")}</Label>
                  <Input value={sipUsername} onChange={e => setSipUsername(e.target.value)} placeholder="sip_user" />
                </div>
                <div className="grid gap-2">
                  <Label>{t("secret")}</Label>
                  <Input type="password" value={sipSecret} onChange={e => setSipSecret(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* AI voice-agent settings are additive. With the switch off every call remains a normal CRM call. */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="voice-agent-enabled" className="text-base">
                    {t("voiceAgentTitle")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("voiceAgentDisabledHint")}</p>
                </div>
                <Switch
                  id="voice-agent-enabled"
                  checked={voiceAgentEnabled}
                  onCheckedChange={(enabled) => {
                    setVoiceAgentEnabled(enabled)
                    if (enabled && !voiceAgentPrompt.trim()) {
                      setVoiceAgentPrompt(DEFAULT_VOICE_AGENT_PROMPT)
                    }
                    if (!enabled) setVoiceQueueEnabled(false)
                  }}
                  aria-label={t("voiceAgentTitle")}
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/30 p-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="manual-lead-ai-calls" className="text-sm font-medium">
                  {t("manualLeadAiCallsEnabled")}
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("manualLeadAiCallsEnabledHint")}
                </p>
              </div>
              <Switch
                id="manual-lead-ai-calls"
                checked={manualLeadAiCallsEnabled}
                onCheckedChange={(enabled) => {
                  setManualLeadAiCallsEnabled(enabled)
                  if (!enabled) setVoiceQueueEnabled(false)
                }}
                disabled={!voiceAgentEnabled || provider !== "asterisk" || voiceAgentMode === "inbound"}
                aria-label={t("manualLeadAiCallsEnabled")}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/30 p-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="voice-call-queue-enabled" className="text-sm font-medium">
                  {t("voiceQueueEnabled")}
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("voiceQueueEnabledHint")}
                </p>
              </div>
              <Switch
                id="voice-call-queue-enabled"
                checked={voiceQueueEnabled}
                onCheckedChange={setVoiceQueueEnabled}
                disabled={!manualLeadAiCallsEnabled || !voiceAgentEnabled || provider !== "asterisk" || voiceAgentMode === "inbound"}
                aria-label={t("voiceQueueEnabled")}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="voice-agent-mode">{t("voiceAgentModeLabel")}</Label>
              <Select
                id="voice-agent-mode"
                value={voiceAgentMode}
                onChange={event => {
                  const mode = event.target.value as VoiceAgentMode
                  setVoiceAgentMode(mode)
                  if (mode === "inbound") setVoiceQueueEnabled(false)
                }}
                disabled={!voiceAgentEnabled}
              >
                <option value="outbound">{t("voiceAgentModeOutbound")}</option>
                <option value="inbound">{t("voiceAgentModeInbound")}</option>
                <option value="both">{t("voiceAgentModeBoth")}</option>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="voice-agent-prompt">{t("voiceAgentRules")}</Label>
              <Textarea
                id="voice-agent-prompt"
                value={voiceAgentPrompt}
                onChange={event => setVoiceAgentPrompt(event.target.value)}
                disabled={!voiceAgentEnabled}
                rows={14}
                maxLength={20_000}
                required={voiceAgentEnabled}
                aria-invalid={voiceAgentPromptMissing}
                aria-describedby={voiceAgentPromptMissing
                  ? "voice-agent-prompt-hint voice-agent-prompt-error"
                  : "voice-agent-prompt-hint"}
              />
              <p id="voice-agent-prompt-hint" className="text-xs text-muted-foreground">
                {t("voiceAgentRulesHint")}
              </p>
              {voiceAgentPromptMissing && (
                <p id="voice-agent-prompt-error" role="alert" className="text-xs text-destructive">
                  {t("voiceAgentRulesRequired")}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="voice-agent-knowledge">{t("voiceAgentKnowledge")}</Label>
              <Textarea
                id="voice-agent-knowledge"
                value={voiceAgentKnowledge}
                onChange={event => setVoiceAgentKnowledge(event.target.value)}
                disabled={!voiceAgentEnabled}
                rows={14}
                maxLength={100_000}
                placeholder={t("voiceAgentKnowledgePlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("voiceAgentKnowledgeHint")}</p>
            </div>

            <section
              className="space-y-3 rounded-lg border border-dashed px-3 py-3"
              aria-labelledby="voice-agent-system-policy-title"
            >
              <Label id="voice-agent-system-policy-title" className="text-sm font-medium">
                {t("voiceAgentSystemPolicyTitle")}
              </Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("voiceAgentSystemPolicyDescription")}
              </p>
              <ul className="list-disc space-y-1.5 ps-5 text-xs leading-relaxed text-muted-foreground">
                <li>{t("voiceAgentSystemPolicyContext")}</li>
                <li>{t("voiceAgentSystemPolicyInterruption")}</li>
                <li>{t("voiceAgentSystemPolicyUnknowns")}</li>
                <li>{t("voiceAgentSystemPolicyIntroduction")}</li>
                <li>{t("voiceAgentSystemPolicyDelivery")}</li>
                <li>{t("voiceAgentSystemPolicyQuestions")}</li>
              </ul>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("voiceAgentSystemPolicyBoundary")}
              </p>
            </section>
          </div>

          {/* Common toggles */}
          <div className="flex items-center gap-3">
            <Switch checked={recordCalls} onCheckedChange={setRecordCalls} />
            <div>
              <Label>{t("recordCalls")}</Label>
              <p className="text-xs text-muted-foreground">{t("recordCallsHint")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <div>
              <Label>{t("enableVoip")}</Label>
              <p className="text-xs text-muted-foreground">{t("enableVoipHint")}</p>
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.success ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"}`}>
              {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testResult.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={handleTest} disabled={testing || !configId}>
              {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube className="h-4 w-4 mr-1" />}
              {testing ? t("testing") : t("testConnection")}
            </Button>
            <Button onClick={handleSave} disabled={saving || voiceAgentPromptMissing}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <VoiceCallingHours />
    </div>
  )
}
