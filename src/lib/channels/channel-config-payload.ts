export type SmsProvider = "atl" | "twilio" | "vonage"

export interface ChannelConfigFormData {
  configName: string
  channelType: string
  botToken: string
  webhookUrl: string
  apiKey: string
  phoneNumber: string
  chatId: string
  accountSid: string
  appId: string
  appSecret: string
  pageId: string
  confirmationCode: string
  isActive: boolean
  smsProvider: SmsProvider
  atlLogin: string
  atlTitle: string
  twilioAccountSid: string
  twilioNumber: string
  vonageApiKey: string
  vonageFromName: string
  smsSecret: string
  smsEditing: boolean
  verifyToken: string
  displayName: string
  igLogin: boolean
  appReviewOnly: boolean
  loginConfigId: string
  chatwootBaseUrl: string
  chatwootAccountId: string
  chatwootWebhookSecret: string
  emailTicketIntakeAddress: string
  emailComplaintIntakeAddress: string
}

export function buildChannelPayload(form: ChannelConfigFormData) {
  if (form.channelType === "sms") {
    const settings: Record<string, unknown> = { smsProvider: form.smsProvider }
    let secret: string | undefined
    let phoneNumber: string | undefined
    if (form.smsProvider === "atl") {
      if (form.atlLogin) settings.atlLogin = form.atlLogin
      if (form.atlTitle) settings.atlTitle = form.atlTitle
      secret = form.smsSecret || undefined
    } else if (form.smsProvider === "twilio") {
      if (form.twilioAccountSid) settings.accountSid = form.twilioAccountSid
      if (form.twilioNumber) settings.twilioNumber = form.twilioNumber
      secret = form.smsSecret || undefined
      phoneNumber = form.twilioNumber || undefined
    } else if (form.smsProvider === "vonage") {
      if (form.vonageApiKey) settings.apiKey = form.vonageApiKey
      if (form.vonageFromName) settings.fromName = form.vonageFromName
      secret = form.smsSecret || undefined
    }
    return {
      configName: form.configName,
      channelType: "sms",
      apiKey: secret,
      phoneNumber,
      settings,
      isActive: form.isActive,
    }
  }

  if (form.channelType === "chatwoot") {
    const settings: Record<string, unknown> = {
      provider: "tiktok",
      platform: "tiktok",
      surface: "dm",
      routingProvider: "chatwoot",
      baseUrl: form.chatwootBaseUrl.trim(),
      accountId: form.chatwootAccountId.trim(),
    }
    const webhookSecret = form.chatwootWebhookSecret.trim()
    if (webhookSecret) settings.webhookSecret = webhookSecret

    return {
      configName: form.configName,
      channelType: "chatwoot",
      apiKey: form.apiKey || undefined,
      settings,
      isActive: form.isActive,
    }
  }

  if (form.channelType === "email") {
    const routes: Record<string, string>[] = []
    if (form.emailTicketIntakeAddress.trim()) {
      routes.push({ address: form.emailTicketIntakeAddress.trim(), target: "ticket", category: "general" })
    }
    if (form.emailComplaintIntakeAddress.trim()) {
      routes.push({ address: form.emailComplaintIntakeAddress.trim(), target: "complaint", category: "complaint", complaintType: "complaint" })
    }

    return {
      configName: form.configName,
      channelType: "email",
      apiKey: form.apiKey || undefined,
      webhookUrl: form.webhookUrl || undefined,
      settings: routes.length > 0 ? { emailIntake: { routes } } : {},
      isActive: form.isActive,
    }
  }

  const base = {
    configName: form.configName,
    channelType: form.channelType,
    botToken: form.botToken || undefined,
    webhookUrl: form.webhookUrl || undefined,
    apiKey: form.apiKey || undefined,
    phoneNumber: form.phoneNumber || undefined,
    appId: form.appId || undefined,
    appSecret: form.appSecret || undefined,
    pageId: form.pageId || undefined,
    // Only the keys this form owns. On a Facebook/Instagram row the keys the server writes (the Meta
    // subscription outcome, the Instagram token metadata, the reply policy) are kept by the PUT route —
    // lib/channels/meta-server-settings — so they are neither echoed back here nor erased by a save.
    settings: {
      ...(form.chatId ? { chatId: form.chatId } : {}),
      ...(form.accountSid ? { accountSid: form.accountSid } : {}),
      ...(form.confirmationCode ? { confirmationCode: form.confirmationCode } : {}),
      ...(form.channelType === "instagram" && form.igLogin ? { igLogin: true } : {}),
      // A STAGED Meta app, isolated from the tenant's live channels: `appReviewOnly` hides the row
      // from the org-wide resolvers in lib/social/tenant-meta-app.ts, so entering a second Meta app
      // (e.g. one under App Review) cannot become the app that an existing channel's reconnect runs
      // through. It must be re-sent on every save — this builder rebuilds `settings` from scratch, so
      // omitting it here would silently clear the flag on the next edit and promote the staged app to
      // the tenant default, which is the precise accident the flag exists to prevent.
      ...((form.channelType === "facebook" || form.channelType === "instagram") && form.appReviewOnly
        ? { appReviewOnly: true }
        : {}),
      // Facebook Login for Business configuration id. Meta's docs state that "config_id has replaced
      // scope (which should not be used)", so an app set up that way needs this instead of a scope
      // list — without it the dialog rejects the request and, if it opens at all, the grant lands on
      // the selected assets and /me/accounts comes back empty.
      ...((form.channelType === "facebook" || form.channelType === "instagram") && form.loginConfigId.trim()
        ? { loginConfigId: form.loginConfigId.trim() }
        : {}),
    },
    isActive: form.isActive,
  } as Record<string, unknown>

  if (form.channelType === "whatsapp") {
    base.accessToken = form.apiKey || undefined
    base.phoneNumberId = form.phoneNumber || undefined
    base.businessAccountId = form.webhookUrl || undefined
    base.verifyToken = form.verifyToken || undefined
    base.displayName = form.displayName || undefined
  }

  if (form.channelType === "facebook" || form.channelType === "instagram") {
    base.verifyToken = form.verifyToken || undefined
  }

  return base
}
