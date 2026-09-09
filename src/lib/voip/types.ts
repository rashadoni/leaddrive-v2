// LeadDrive CRM — VoIP Provider Abstraction Types

export interface InitiateCallParams {
  toNumber: string
  fromNumber: string
  /**
   * Caller-generated provider correlation id. AI/Asterisk callers should
   * persist a UUID before initiating the call and pass the same value here so
   * an uncertain ARI response cannot orphan the provider call.
   */
  correlationId?: string
  callbackUrl?: string   // status callback URL
  twimlUrl?: string      // TwiML instruction URL (Twilio-specific, ignored by others)
  record?: boolean
  voiceAgent?: boolean   // connect the answered call to the configured AI voice bridge
  // Connect the answered call to the PBX-local bridge that carries audio to a
  // salesperson's BROWSER instead of ringing a second phone. Mutually
  // exclusive with voiceAgent: one answered call has one destination.
  browserAudio?: boolean
  /**
   * Where to reach the salesperson on a manual call — their own number rather
   * than the organisation's single configured extension. Without it every
   * click-to-call rang the same phone no matter who pressed the button.
   * Ignored for AI calls, which bridge to the voice agent instead.
   */
  agentNumber?: string
}

export interface InitiateCallResult {
  success: boolean
  callSid?: string       // provider-specific call identifier
  error?: string
  /**
   * A failed originate is either known not to have been accepted, or its
   * delivery is unknowable because the transport response was lost. Callers
   * must never retry `unknown_delivery` automatically.
   */
  failureCertainty?: "definite_rejection" | "unknown_delivery"
}

export interface WebhookData {
  callSid: string
  status: string         // initiated | ringing | in-progress | completed | busy | no-answer | failed
  duration?: number
  recordingUrl?: string
  from?: string
  to?: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
}

/**
 * Read-only ARI channel diagnostics. Channel absence is not provider
 * finality: a delayed originate request can create the channel after a 404.
 * Callers must never release a dispatch fence from this result.
 */
export type CallActivityResult =
  | { state: "active" }
  | { state: "unknown" }

export type AsteriskTerminalOutcome =
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  | "cancelled"

/**
 * Durable PBX attempt-registry proof. `not_accepted` is an immutable
 * cancellation tombstone: the PBX guarantees that the UUID never dialled and
 * that a delayed/replayed originate can never dial later. `terminal` is also
 * immutable. HTTP status or ARI channel absence alone never creates either
 * proof.
 */
export type CallFinalityResult =
  | { state: "not_accepted"; revision: number; updatedAt: string }
  | { state: "accepted"; revision: number; updatedAt: string }
  | { state: "active"; revision: number; updatedAt: string }
  | {
      state: "terminal"
      outcome: AsteriskTerminalOutcome
      revision: number
      updatedAt: string
    }
  | { state: "unknown" }

/**
 * Unified VoIP provider interface.
 * Every adapter (Twilio, 3CX, Asterisk, Custom SIP) implements this.
 */
export interface VoipProvider {
  getProviderName(): string
  initiateCall(params: InitiateCallParams): Promise<InitiateCallResult>
  endCall(callSid: string): Promise<{ success: boolean; error?: string }>
  /** Optional only for providers with a durable attempt registry. */
  inspectCallFinality?(callSid: string): Promise<CallFinalityResult>
  /**
   * Atomically install the provider-side cancellation tombstone, then return
   * its durable state. `accepted`/`active` means cancellation is not final yet.
   */
  cancelAndInspectCallFinality?(callSid: string): Promise<CallFinalityResult>
  testConnection(): Promise<TestConnectionResult>
  parseWebhook(body: Record<string, unknown>): WebhookData | null
}

// --- Settings discriminated union per provider ---

export interface TwilioSettings {
  provider: "twilio"
  accountSid: string
  authToken: string
  twilioNumber: string
  recordCalls?: boolean
}

export interface ThreeCxSettings {
  provider: "threecx"
  serverUrl: string     // e.g. https://mycompany.3cx.eu
  extension: string     // DN the call originates from, e.g. "101"
  apiKey: string        // Call Control API client secret (Admin → Integrations → API)
  clientId?: string     // API client id, when it differs from the DN; defaults to `extension`
  deviceId?: string     // optional specific registered device for makecall
  webhookSecret?: string // shared secret for the CRM-template lookup/journal endpoints
  /**
   * How a destination number is shaped before dialling.
   *  - "az-national" (default) — rewrite +994XXXXXXXXX to 0XXXXXXXXX, the form
   *    an AZ trunk's outbound rule matches (Prefix 0 / Length 10). Non-AZ
   *    numbers and extensions pass through untouched.
   *  - "as-is" — hand the stored number to the PBX verbatim, for a dial plan
   *    that expects E.164.
   */
  dialFormat?: "az-national" | "as-is"
  timeout?: number
  recordCalls?: boolean
}

export interface AsteriskSettings {
  provider: "asterisk"
  /** Tenant binding for the single pilot HMAC control plane. */
  organizationId?: string
  /** Pilot-only pinned-TLS capability; registry semantics also require the global gate. */
  voiceAttemptRegistryEnabled?: boolean
  /** Technical maintenance fence; only the reviewed cutover workflow mutates it. */
  outboundCallDispatchPaused?: boolean
  ariHost: string       // e.g. "192.168.1.10"
  ariPort: number       // default 8088
  username: string
  password: string
  context: string       // dialplan context, e.g. "from-internal"
  callerExtension: string
  recordCalls?: boolean
}

export interface CustomSipSettings {
  provider: "custom-sip"
  sipServer: string
  sipPort: number       // default 5060
  sipDomain: string
  transport: "udp" | "tcp" | "tls" | "wss"
  username: string
  secret: string
  recordCalls?: boolean
}

export type VoipSettings = TwilioSettings | ThreeCxSettings | AsteriskSettings | CustomSipSettings
