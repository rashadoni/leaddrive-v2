/**
 * SMS provider abstraction.
 *
 * Each provider implements this interface. The registry in `src/lib/sms.ts`
 * picks one based on the org's ChannelConfig.settings.smsProvider or the
 * SMS_PROVIDER env var (default: "twilio").
 *
 * To add a new provider:
 *   1. Create src/lib/sms/providers/<name>.ts implementing SmsProvider
 *   2. Register it in PROVIDERS inside src/lib/sms.ts
 *   3. Document required env vars / org settings shape
 */

export interface SmsSendParams {
  to: string
  from?: string
  message: string
}

export interface SmsSendResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface SmsProviderSettings {
  [key: string]: unknown
}

export interface SmsProvider {
  readonly name: string

  /** Whether this provider has enough config to send. Used for preflight checks.
   *  `allowEnv` (default true) gates the shared env-var credential fallback — pass
   *  false for a tenant that must use only its OWN config (multi-tenant isolation). */
  isConfigured(settings: SmsProviderSettings, allowEnv?: boolean): boolean

  /** Actually send the SMS. Returns success=false with error string on failure.
   *  `allowEnv` (default true) gates the shared env-var credential fallback.
   *  NOTE: `params.from` is caller-supplied (never env-derived) and is intentionally NOT
   *  gated by allowEnv — sendSms() never sets it on the org-scoped path, so it cannot smuggle
   *  shared env creds for a guarded tenant. Do not "fix" it into an allowEnv branch. */
  send(settings: SmsProviderSettings, params: SmsSendParams, allowEnv?: boolean): Promise<SmsSendResult>
}
