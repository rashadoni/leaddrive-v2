// LeadDrive CRM — Twilio VoIP Adapter

import type {
  VoipProvider,
  TwilioSettings,
  InitiateCallParams,
  InitiateCallResult,
  TestConnectionResult,
  WebhookData,
} from "../types"

export class TwilioProvider implements VoipProvider {
  private accountSid: string
  private authToken: string
  private twilioNumber: string

  constructor(settings: TwilioSettings) {
    this.accountSid = settings.accountSid
    this.authToken = settings.authToken
    this.twilioNumber = settings.twilioNumber
  }

  getProviderName(): string {
    return "twilio"
  }

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")

    const body = new URLSearchParams({
      To: params.toNumber,
      From: params.fromNumber || this.twilioNumber,
      Url: params.twimlUrl || params.callbackUrl || "",
      StatusCallback: params.callbackUrl || "",
      StatusCallbackEvent: "initiated ringing answered completed",
      ...(params.record ? { Record: "true" } : {}),
    })

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    const data = await res.json()

    if (data.sid) {
      return { success: true, callSid: data.sid }
    }
    return { success: false, error: data.message || "Failed to initiate call" }
  }

  async endCall(callSid: string): Promise<{ success: boolean; error?: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${callSid}.json`
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }).toString(),
    })

    if (res.ok) {
      return { success: true }
    }
    const data = await res.json()
    return { success: false, error: data.message || "Failed to end call" }
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")

      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      })

      if (res.ok) {
        return { success: true, message: "Twilio credentials verified successfully." }
      }
      return { success: false, message: "Invalid Twilio credentials." }
    } catch (e) {
      return { success: false, message: `Connection failed: ${(e as Error).message}` }
    }
  }

  parseWebhook(body: Record<string, unknown>): WebhookData | null {
    const callSid = body.CallSid as string
    if (!callSid) return null

    const statusMap: Record<string, string> = {
      initiated: "initiated",
      ringing: "ringing",
      "in-progress": "in-progress",
      completed: "completed",
      busy: "busy",
      "no-answer": "no-answer",
      failed: "failed",
      canceled: "failed",
    }

    return {
      callSid,
      status: statusMap[(body.CallStatus as string)?.toLowerCase()] || (body.CallStatus as string) || "unknown",
      duration: body.CallDuration ? parseInt(body.CallDuration as string, 10) : undefined,
      recordingUrl: body.RecordingUrl as string | undefined,
      from: body.From as string | undefined,
      to: body.To as string | undefined,
    }
  }
}
