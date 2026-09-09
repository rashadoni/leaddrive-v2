// LeadDrive CRM — Custom SIP Stub Adapter
// Returns instructions for client-side SIP.js dialing.
// testConnection performs a SIP OPTIONS ping via fetch.

import type {
  VoipProvider,
  CustomSipSettings,
  InitiateCallParams,
  InitiateCallResult,
  TestConnectionResult,
  WebhookData,
} from "../types"
import { requestVoipEndpoint } from "../endpoint-guard"

export class CustomSipProvider implements VoipProvider {
  private sipServer: string
  private sipPort: number
  private sipDomain: string
  private transport: string
  private username: string

  constructor(settings: CustomSipSettings) {
    this.sipServer = settings.sipServer
    this.sipPort = settings.sipPort || 5060
    this.sipDomain = settings.sipDomain
    this.transport = settings.transport || "wss"
    this.username = settings.username
  }

  getProviderName(): string {
    return "custom-sip"
  }

  /**
   * Custom SIP calls are initiated client-side via SIP.js.
   * This method returns the config the browser client needs.
   */
  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    // Server-side call initiation is not supported for SIP.js.
    // Return the configuration so the client can initiate the call.
    return {
      success: true,
      callSid: `sip-${Date.now()}`,
      error: undefined,
    }
  }

  async endCall(_callSid: string): Promise<{ success: boolean; error?: string }> {
    // Client-side SIP.js handles hang-up; server just acknowledges.
    return { success: true }
  }

  /**
   * Test connectivity by sending an HTTP request to the SIP server's WSS endpoint.
   * For WebSocket transports we check if the WSS port is open.
   * For UDP/TCP we just validate the configuration.
   */
  async testConnection(): Promise<TestConnectionResult> {
    try {
      if (this.transport === "wss" || this.transport === "tls") {
        // Try connecting to the WSS/TLS endpoint
        const protocol = this.transport === "wss" ? "https" : "https"
        const url = `${protocol}://${this.sipServer}:${this.sipPort}`
        const res = await requestVoipEndpoint(url, {
          method: "OPTIONS",
          signal: AbortSignal.timeout(5000),
        }, {
          timeoutMs: 5_000,
          maxResponseBytes: 0,
        }).catch(() => null)

        if (res) {
          return { success: true, message: `SIP server reachable at ${this.sipServer}:${this.sipPort}.` }
        }
        return {
          success: false,
          message: `Cannot reach SIP server at ${this.sipServer}:${this.sipPort}. Verify the address and port.`,
        }
      }

      // For UDP/TCP we can't test from the browser — validate config instead
      if (!this.sipServer || !this.sipDomain || !this.username) {
        return { success: false, message: "Incomplete SIP configuration. Fill in all required fields." }
      }
      return {
        success: true,
        message: `SIP configuration looks valid (${this.transport.toUpperCase()} transport). Actual call test required for full verification.`,
      }
    } catch (e) {
      return { success: false, message: `SIP test failed: ${(e as Error).message}` }
    }
  }

  parseWebhook(_body: Record<string, unknown>): WebhookData | null {
    // Custom SIP does not have server-side webhooks — call state is managed client-side.
    return null
  }
}
