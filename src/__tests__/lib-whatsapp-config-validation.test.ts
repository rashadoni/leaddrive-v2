import { describe, it, expect } from "vitest"
import { whatsappChannelCredentialsError } from "@/lib/channels/whatsapp-config-validation"

/**
 * What the channels API demands of a WhatsApp row (lib/channels/whatsapp-config-validation).
 *
 * A number set up by hand needs its own Verify Token and App Secret: Meta posts to `?t=<slug>` and the webhook
 * verifies with that row's secret. A number connected through Embedded Signup has neither — the shared app's
 * callback and secret serve it — so requiring them made the row impossible to rename. Only the stored row may
 * waive them; a request that merely claims `embeddedSignup` must not.
 */
const stored = {
  channelType: "whatsapp",
  accessToken: "token",
  phoneNumberId: "444555666",
  businessAccountId: "111222333",
  verifyToken: null,
  appSecret: null,
}

describe("whatsappChannelCredentialsError", () => {
  it("lets a number connected through Embedded Signup be saved without a Verify Token or App Secret", () => {
    expect(whatsappChannelCredentialsError({ channelType: "whatsapp" }, { ...stored, settings: { embeddedSignup: true } })).toBeNull()
  })

  it("still requires them on a number set up by hand", () => {
    expect(whatsappChannelCredentialsError({ channelType: "whatsapp" }, { ...stored, settings: {} }))
      .toMatch(/Webhook Verify Token, App Secret/)
  })

  it("does not take the request's word for it", () => {
    const claim = { channelType: "whatsapp", settings: { embeddedSignup: true } }
    expect(whatsappChannelCredentialsError(claim, { ...stored, settings: {} })).toMatch(/Webhook Verify Token, App Secret/)
    // A brand-new row has nothing stored, so a create can never skip them either.
    expect(whatsappChannelCredentialsError({ ...stored, ...claim })).toMatch(/Webhook Verify Token, App Secret/)
  })

  it("still requires the token, number and account on an Embedded Signup row", () => {
    expect(whatsappChannelCredentialsError(
      { channelType: "whatsapp", accessToken: "", apiKey: "" },
      { ...stored, accessToken: null, settings: { embeddedSignup: true } },
    )).toMatch(/Access Token/)
  })
})
