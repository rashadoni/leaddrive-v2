"use client"

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  PhoneCall,
  PlayCircle,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Webhook,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { AccordionItem } from "@/components/ui/accordion"
import { ChannelConfigForm } from "@/components/channel-config-form"
import { TikTokChannelHub } from "@/components/channels/tiktok-channel-hub"
import { cn } from "@/lib/utils"
import { channelConnectionState, channelIsLiveConnection } from "@/lib/channels/live-connection"
import { metaConnectionReason } from "@/lib/channels/connection-reason"

type Loc = "en" | "ru" | "az"
type ConnectMode = "new" | "existing"
type ConnectStage = "intro" | "eligibility" | "connect"

interface ScenarioOption {
  value: ConnectMode
  title: string
  description: string
  checklist: string[]
}

interface ChannelGuide {
  id: string
  title: string
  sideDescription: string
  bodyDescription: string
  icon: typeof MessageCircle
  logo: string
  badge?: string
  formChannelId?: string
  defaultMode?: ConnectMode
  resources: string[]
  tutorial: {
    title: string
    duration: string
    description: string
    steps: string[]
  }
  eligibility: {
    title: string
    steps: Array<{
      label: string
      question: string
      options: string[]
      info?: string
    }>
  }
  connect: {
    title: string
    description: string
    primary: string
    secondary: string
    note: string
  }
}

interface ChannelConfigSummary {
  id: string
  channelType: string
  configName: string
  phoneNumber?: string | null
  pageId?: string | null
  appId?: string | null
  webhookUrl?: string | null
  verifyToken?: string | null
  displayName?: string | null
  isActive: boolean
  settings?: Record<string, unknown> | null
  hasAccessToken?: boolean
  hasPhoneNumberId?: boolean
  hasBusinessAccountId?: boolean
  hasVerifyToken?: boolean
  hasAppSecret?: boolean
}

type ChannelFetchError = "moduleDisabled" | "requestFailed"

const LEADDRIVE_APP_ORIGIN = "https://app.leaddrivecrm.org"
const TENANT_SLUG_PLACEHOLDER = "tenant-slug"

interface ChannelsSnapshot {
  orgId: string
  data: ChannelConfigSummary[]
  error?: ChannelFetchError | null
}

type WhatsAppCallingSmokeResult =
  | {
      ok: true
      callSid: string
      status: string
      conversationId: string
      customerPhone: string
      inboxUrl: string
      warning: string
    }
  | {
      ok: false
      message: string
    }

const whatsappCredentialStatusCopy: Record<Loc, {
  title: string
  hint: string
  noChannel: string
  moduleDisabled: string
  moduleDisabledAction: string
  unavailable: string
  loadFailed: string
  loading: string
  accessToken: string
  phoneNumberId: string
  verifyToken: string
  appSecret: string
  ready: string
  missing: string
  blocked: string
  openForm: string
}> = {
  en: {
    title: "Saved WhatsApp credentials",
    hint: "These checks come from the active WhatsApp Business API channel saved for this tenant.",
    noChannel: "No active WhatsApp Business API channel is saved yet. The CRM smoke test can still run, but a real Meta call needs saved WhatsApp credentials.",
    moduleDisabled: "The Omni-channel module is not enabled for this tenant. Enable the Channels/Omni-channel add-on before saving WhatsApp API credentials or testing WhatsApp Calling.",
    moduleDisabledAction: "Omni-channel module is disabled",
    unavailable: "Unavailable",
    loadFailed: "LeadDrive could not check saved WhatsApp credentials. Refresh the page or try again after confirming channel access.",
    loading: "Checking saved WhatsApp credentials...",
    accessToken: "Access token",
    phoneNumberId: "Phone Number ID",
    verifyToken: "Verify token",
    appSecret: "App Secret",
    ready: "Ready",
    missing: "Missing",
    blocked: "Signed calls webhooks will be rejected until App Secret is saved.",
    openForm: "Open WhatsApp API credentials",
  },
  ru: {
    title: "Сохраненные учетные данные WhatsApp",
    hint: "Проверка идет по активному каналу WhatsApp Business API, сохраненному для этого тенанта.",
    noChannel: "Активный WhatsApp Business API канал еще не сохранен. CRM-тест можно запустить сейчас, но реальный звонок Meta потребует сохраненные ключи WhatsApp.",
    moduleDisabled: "Модуль Omni-channel не включен для этого тенанта. Сначала включите дополнение Channels/Omni-channel, иначе LeadDrive не сохранит ключи WhatsApp API и WhatsApp Calling нельзя протестировать.",
    moduleDisabledAction: "Модуль Omni-channel выключен",
    unavailable: "Недоступно",
    loadFailed: "LeadDrive не смог проверить сохраненные ключи WhatsApp. Обновите страницу или проверьте доступ к каналам.",
    loading: "Проверяю сохраненные ключи WhatsApp...",
    accessToken: "Access token",
    phoneNumberId: "Phone Number ID",
    verifyToken: "Verify token",
    appSecret: "App Secret",
    ready: "Готово",
    missing: "Отсутствует",
    blocked: "Подписанные webhook-и звонков будут отклоняться, пока App Secret не сохранен.",
    openForm: "Открыть ключи WhatsApp API",
  },
  az: {
    title: "Saxlanmış WhatsApp açarları",
    hint: "Yoxlama bu tenant üçün saxlanmış aktiv WhatsApp Business API kanalından gəlir.",
    noChannel: "Aktiv WhatsApp Business API kanalı hələ saxlanmayıb. WhatsApp Calling testindən əvvəl onu yaradın.",
    moduleDisabled: "Bu tenant üçün Omni-channel modulu aktiv deyil. WhatsApp API açarlarını saxlamaq və WhatsApp Calling test etmək üçün əvvəl Channels/Omni-channel əlavəsi aktiv edilməlidir.",
    moduleDisabledAction: "Omni-channel modulu söndürülüb",
    unavailable: "Əlçatan deyil",
    loadFailed: "LeadDrive saxlanmış WhatsApp açarlarını yoxlaya bilmədi. Səhifəni yeniləyin və ya kanal girişini yoxlayın.",
    loading: "Saxlanmış WhatsApp açarları yoxlanır...",
    accessToken: "Access token",
    phoneNumberId: "Phone Number ID",
    verifyToken: "Verify token",
    appSecret: "App Secret",
    ready: "Hazırdır",
    missing: "Çatışmır",
    blocked: "App Secret saxlanmayınca imzalanmış zəng webhook-ları rədd ediləcək.",
    openForm: "WhatsApp API açarlarını aç",
  },
}

const routeAliases: Record<string, string> = {
  whatsapp_business_platform: "whatsapp-business",
  whatsapp_business_api: "whatsapp-business",
  whatsapp_business: "whatsapp-business",
  whatsapp: "whatsapp-business",
  whatsapp_business_calls: "whatsapp-business-calls",
  "whatsapp-business-calls": "whatsapp-business-calls",
  whatsapp_calling: "whatsapp-business-calls",
  "whatsapp-calling": "whatsapp-business-calls",
  tiktok_chatwoot: "tiktok",
  "tiktok-chatwoot": "tiktok",
  tiktok: "tiktok",
  facebook_messenger: "facebook",
  "facebook-messenger": "facebook",
  facebook_messenger_api: "facebook",
  "facebook-messenger-api": "facebook",
  facebook: "facebook",
  instagram_direct: "instagram",
  "instagram-direct": "instagram",
  instagram: "instagram",
  telegram_bot: "telegram",
  "telegram-bot": "telegram",
  telegram: "telegram",
  atl_sms: "atl-sms",
  "atl-sms": "atl-sms",
  twilio_sms: "twilio-sms",
  "twilio-sms": "twilio-sms",
  vonage_sms: "vonage-sms",
  "vonage-sms": "vonage-sms",
  sms: "atl-sms",
  vk: "vkontakte",
  vkontakte: "vkontakte",
  google_workspace: "google-workspace",
  "google-workspace": "google-workspace",
  other_email: "other-email",
  "other-email": "other-email",
  email: "google-workspace",
  webchat: "website-chat",
  live_chat: "website-chat",
  "live-chat": "website-chat",
  website_chat: "website-chat",
  "website-chat": "website-chat",
  custom_business: "custom-business",
  "custom-business": "custom-business",
  custom_channel: "custom-business",
  "custom-channel": "custom-business",
  custom_live_chat: "custom-live-chat",
  "custom-live-chat": "custom-live-chat",
  voip: "twilio-calls",
  calls: "twilio-calls",
  custom_sip: "custom-sip",
  "custom-sip": "custom-sip",
}

/**
 * `?pages=` / `?ig=` as a count. Absent, non-numeric or zero all mean "nothing of this kind was
 * wired" — the Instagram callback, for instance, sends `ig` and no `pages` at all.
 */
function positiveCountParam(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const copy = {
  en: {
    back: "Back to Channel Catalog",
    oauthSuccessTitle: "Channel connected",
    oauthSuccessDesc: "Meta returned {pages} Facebook Page(s) and {ig} Instagram account(s). Send one message to the account to confirm it reaches Inbox.",
    oauthPartialTitle: "This channel is still not connected",
    oauthNoInstagramDesc: "Meta returned {pages} Facebook Page(s) and no Instagram account. Instagram Direct is delivered through the Facebook Page that an Instagram BUSINESS account is linked to, so until that link exists nothing can reach Inbox here. Link the Instagram business account to the Page in Meta Business settings, then run Connect with Meta again.",
    oauthNoPageDesc: "Meta finished the login but returned no Facebook Page for this channel, so no message can arrive yet. Run Connect with Meta again and tick the Page you want to use.",
    oauthErrorTitle: "Connection did not finish",
    oauthErrorDesc: "Meta returned: {code}. Try again, or open \"I have my own Meta app\" and enter your own credentials.",
    oauthNotDeliveringTitle: "Connected, but not delivering yet",
    oauthNoChannelRowDesc: "Meta finished the login, but this workspace still holds no channel for it, so there is nothing for an inbound message to arrive in. Run Connect with Meta again; if it keeps ending here, the callback could not save the channel.",
    oauthCheckingTitle: "Checking what actually got wired",
    oauthCheckingDesc: "Meta has reported back. LeadDrive is reading the saved channel before it calls anything connected.",
    oauthUnverifiedDesc: "Meta has reported back, but LeadDrive could not read this workspace's channels, so it cannot confirm that the connection works. Reload the page, and open the channel catalog if it fails again.",
    helpBanner: "Need help connecting this channel? Use the guide below before entering credentials.",
    additionalResources: "Additional Resources",
    videoTutorial: "Step-by-step setup guide",
    watchGuideTitle: "Need a walkthrough before saving?",
    watchGuideDesc: "Open the on-screen guide if you want to see where the provider work happens, what to paste in LeadDrive and how to verify the channel.",
    tutorialPlayerTitle: "Interactive setup walkthrough",
    tutorialPlayerDesc: "Follow this like a short video: prepare the provider, paste only the required LeadDrive fields, then run one safe test.",
    tutorialPlayerNow: "Now showing",
    tutorialPlayerProvider: "Provider work",
    tutorialPlayerLeadDrive: "LeadDrive fields",
    tutorialPlayerVerify: "Safe test",
    tutorialPlayerFieldMap: "Fields to fill",
    tutorialPlayerOpenFull: "Open full walkthrough",
    openGuide: "Open guide",
    tutorialStepsTitle: "What this guide covers",
    learnMore: "Learn more",
    eligibilityBadge: "Eligibility check",
    channelSetup: "Channel setup",
    selectScenario: "Connect scenario",
    selectedScenario: "Selected scenario",
    readinessSummary: "Readiness summary",
    wizardPlanTitle: "Your connection plan",
    wizardPlanDesc: "LeadDrive keeps the provider work, saved credentials and the first safe test in one visible plan.",
    wizardScenarioLabel: "Scenario",
    wizardReadinessLabel: "Readiness answers",
    wizardNotAnswered: "Not answered yet",
    wizardEditReadiness: "Edit readiness check",
    wizardProviderLabel: "Provider",
    wizardLeadDriveLabel: "LeadDrive",
    wizardVerifyLabel: "Verify",
    currentChoice: "Current answer",
    readinessQuestionTitle: "Answer this before credentials",
    readinessQuestionDesc: "This check prevents a half-connected channel. If access is missing, stop here and get the provider owner involved before saving anything.",
    readinessProgress: "Readiness progress",
    readinessWhyTitle: "Why this matters",
    readinessWhyDesc: "LeadDrive can save credentials, but live inbox traffic only works after provider access, webhook setup and one controlled verification event are confirmed.",
    readinessNextTitle: "After this check",
    readinessNextDesc: "You will land on the locked credential form for this channel. No live customer traffic is sent from this screen.",
    nextActionTitle: "Next action",
    quickStartTitle: "Start here",
    quickStartDesc: "This is the shortest safe path for the selected channel. Do these in order before enabling live customer traffic.",
    quickStartProvider: "1. Provider",
    quickStartProviderDesc: "Open this provider surface and prepare the account or sender first.",
    quickStartFields: "2. LeadDrive fields",
    quickStartFieldsDesc: "Paste these fields in the locked LeadDrive form for this channel.",
    quickStartVerify: "3. Safe verification",
    quickStartVerifyDesc: "Run this one controlled test before live use.",
    quickStartGuideAction: "Show guide",
    quickStartFormAction: "Go to form",
    operatorNextTitle: "What to do now",
    operatorNextDesc: "Use this checklist as the operator path for this channel. It keeps provider work, LeadDrive credentials and the final live check separate.",
    operatorStepProviderTitle: "Open the provider",
    operatorStepProviderDesc: "Complete the external account, page, inbox, sender or phone setup first.",
    operatorStepLeadDriveTitle: "Fill LeadDrive fields",
    operatorStepLeadDriveDesc: "Save only the credentials for this selected channel. The channel type is locked.",
    operatorStepVerifyTitle: "Run one safe test",
    operatorStepVerifyDesc: "Send one controlled inbound event and confirm it appears in Inbox before production traffic.",
    operatorPrimaryAction: "Continue below",
    operatorExternalAction: "Open setup page",
    operatorVerifyAction: "Review verification",
    faqTitle: "Common questions",
    faqDesc: "Quick answers for the operator before saving this channel.",
    connectionMapTitle: "How this connection works",
    connectionMapDesc: "Follow the same route for every provider: prepare the external account, save only the selected channel in LeadDrive, then verify one controlled message before live use.",
    providerWorkTitle: "Provider side",
    providerWorkDesc: "Create or confirm the account, page, inbox, sender, bot, mailbox or phone provider outside LeadDrive.",
    leadDriveWorkTitle: "LeadDrive side",
    leadDriveWorkDesc: "Paste the exact credentials for this selected channel. The form below is locked so the channel type cannot drift.",
    validationWorkTitle: "Verification",
    validationWorkDesc: "Send one controlled inbound message, email, SMS or call and confirm it lands in Inbox before production traffic.",
    credentialsRequired: "What you need to prepare",
    verificationRequired: "How to verify it works",
    nextActionInlineFormHint: "Use the locked form on this page. It is already scoped to this channel, so operators do not need to choose the channel type again.",
    nextActionExternalHint: "Open the dedicated settings page below. This channel uses its own setup surface instead of the generic credential form.",
    setupOutcomeTitle: "What happens next",
    setupOutcomeDesc: "LeadDrive only opens the selected setup and saves credentials for this channel. It does not send live customer traffic until you run the verification step.",
    whatsappCallingSmokeTitle: "CRM smoke test",
    whatsappCallingSmokeDesc: "Create a CRM-only outbound WhatsApp call so the admin can confirm Inbox routing, permission state, call log creation, live popup eligibility and call controls before a real Meta call.",
    whatsappCallingSmokeButton: "Create outbound test call",
    whatsappCallingSmokeRunning: "Creating test call...",
    whatsappCallingSmokeSuccess: "Outbound test call is active in Inbox",
    whatsappCallingSmokeFailed: "LeadDrive could not create the WhatsApp Calling test.",
    whatsappCallingSmokeOpenInbox: "Open call in Inbox",
    whatsappCallingSmokeNoExternal: "No real WhatsApp call is placed. This checks LeadDrive routing, the call log, temporary media session and Inbox controls only.",
    whatsappCallingSmokeMetaReminder: "After this passes, request permission from a real WhatsApp customer and place one approved outbound WhatsApp call to confirm Meta delivery on app.leaddrivecrm.org.",
    whatsappCallingWebhookTitle: "Meta calls webhook",
    whatsappCallingWebhookCallback: "Callback URL",
    whatsappCallingWebhookVerify: "Verify token",
    whatsappCallingWebhookSubscribe: "Subscribe event",
    whatsappCallingWebhookHint: "Copy this callback into Meta Webhooks for this tenant and subscribe the WhatsApp app to calls events. The verify token and app secret must match the saved WhatsApp Business API channel.",
    whatsappCallingTenantFallback: "Tenant slug appears after login",
    newAccount: "Create and connect a new account",
    newAccountDesc: "Use this if you are setting up a fresh provider account, page, inbox or phone number.",
    existingAccount: "Connect an existing account",
    existingAccountDesc: "Use this if the provider account already exists and you have the credentials.",
    getStarted: "Get Started",
    skip: "Skip eligibility check",
    next: "Next",
    previous: "Previous",
    yesContinue: "Yes, I have access",
    createLater: "I will create one later",
    continueManual: "Continue to credential form",
    closeTutorial: "Close tutorial",
    startSetupFromTutorial: "Start readiness check",
    resourceAction: "Open on-screen guide",
    tutorialPreviewTitle: "On-screen walkthrough",
    tutorialProviderSide: "Provider workspace",
    tutorialLeadDriveSide: "LeadDrive setup",
    processTitle: "Connection path",
    stepIntro: "Overview",
    stepEligibility: "Readiness check",
    stepConnect: "Credentials",
    readyBeforeTitle: "Prepare before you start",
    afterConnectTitle: "After saving",
    guideFooter: "Visit the Help Center if you need step-by-step guidance to connect this channel.",
    notFoundTitle: "Channel guide not found",
    notFoundDesc: "Return to the catalog and choose a supported channel.",
    guides: {
      whatsapp: {
        title: "WhatsApp Business Platform (API)",
        sideDescription: "Connect WhatsApp Business API via Meta to enable inbox replies, approved templates and notifications.",
        bodyDescription: "LeadDrive follows Meta's setup path: phone readiness, Business Manager access, then credentials/webhook setup.",
        badge: "Popular",
        resources: ["Everything you need to know about WhatsApp Business Platform (API)", "WhatsApp pricing", "Meta webhook checklist"],
        tutorial: {
          title: "Using WhatsApp Business Platform (API)",
          duration: "1:45",
          description: "Understand WABA, phone numbers, Meta Business Manager and why API setup is different from the WhatsApp Business mobile app.",
          steps: ["Choose new or existing WABA", "Confirm phone number readiness", "Check Meta Business Manager access", "Connect through Meta or paste Cloud API credentials"],
        },
        eligibilityTitle: "Let's get started with a simple eligibility check",
        eligibility: [
          {
            label: "Valid phone number",
            question: "Do you have a valid phone number that can send and receive SMS?",
            options: ["I have a new phone number not tied to any WhatsApp account", "I have a phone number tied to a WhatsApp Personal Account", "I do not have a new number"],
          },
          {
            label: "Meta Business Manager Access",
            question: "Do you have access to the Meta Business Manager account associated with your company?",
            info: "Good to know: you need the customer-facing company name, legal company name and official address to create a WABA.",
            options: ["Yes, I have admin access", "I will create one later"],
          },
        ],
        connectTitle: "Connect WhatsApp Business Platform (API)",
        connectDesc: "After clicking Continue, enter the Meta Cloud API credentials saved for this tenant. Embedded Meta signup can be added later without changing this page architecture.",
        primary: "Continue to WhatsApp credentials",
        secondary: "Skip and connect existing credentials",
        note: "This saves WhatsApp messaging credentials. For calls, return to Channels -> Calls -> WhatsApp Business Calling and finish the Meta calls checklist.",
      },
      tiktok: {
        title: "TikTok via Chatwoot",
        sideDescription: "Connect TikTok DMs through Chatwoot. Chatwoot remains the transport; LeadDrive mirrors the conversation as TikTok.",
        bodyDescription: "TikTok is not connected directly to LeadDrive here. First create the TikTok inbox in Chatwoot, then paste Chatwoot credentials.",
        badge: "Chatwoot bridge",
        resources: ["Create TikTok inbox in Chatwoot", "Chatwoot API token", "LeadDrive webhook mapping"],
        tutorial: {
          title: "Using TikTok through Chatwoot",
          duration: "3 min",
          description: "The channel works as Chatwoot transport plus LeadDrive inbox routing, so agents still see TikTok as its own conversation type.",
          steps: ["Create/select TikTok inbox in Chatwoot", "Copy Chatwoot base URL, account ID and token", "Save TikTok via Chatwoot in LeadDrive", "Send one TikTok DM and verify Inbox"],
        },
        eligibilityTitle: "Check Chatwoot readiness first",
        eligibility: [
          {
            label: "TikTok inbox",
            question: "Is the TikTok channel already connected in Chatwoot?",
            options: ["Yes, TikTok inbox exists in Chatwoot", "I need to create it first"],
          },
          {
            label: "Chatwoot API access",
            question: "Do you have Chatwoot base URL, account ID, access token and webhook secret?",
            options: ["Yes, credentials are ready", "I will collect them later"],
          },
        ],
        connectTitle: "Connect TikTok via Chatwoot",
        connectDesc: "Continue to the credential form and save this as a Chatwoot channel with provider = TikTok.",
        primary: "Continue to Chatwoot credentials",
        secondary: "Skip and paste credentials",
        note: "Do not configure TikTok as a direct TikTok API channel; LeadDrive expects Chatwoot to be the TikTok transport.",
      },
      facebook: {
        title: "Facebook Messenger",
        sideDescription: "Connect Messenger from the tenant's own Meta app and Facebook Page.",
        bodyDescription: "The safest setup is Meta app access first, then page/messaging permissions, then LeadDrive credentials.",
        badge: "Meta",
        resources: ["Meta app setup", "Page messaging permissions", "Webhook verification"],
        tutorial: {
          title: "Using Facebook Messenger",
          duration: "3 min",
          description: "Prepare the Meta app, page permissions and webhook before saving the channel.",
          steps: ["Select tenant Meta app", "Choose Facebook Page", "Grant pages_messaging and webhook permissions", "Save and verify one inbound message"],
        },
        eligibilityTitle: "Check Meta Messenger access",
        eligibility: [
          { label: "Facebook Page", question: "Do you manage the Facebook Page that will receive messages?", options: ["Yes, I have admin access", "I need access first"] },
          { label: "Meta app", question: "Do you run your own Meta app?", options: ["No — use LeadDrive's connection", "Yes, I have my own Meta app"] },
        ],
        connectTitle: "Connect Facebook Messenger",
        connectDesc: "Click Connect with Meta, sign in and pick the Page. Keys are only needed if you run your own Meta app.",
        primary: "Continue to connect",
        secondary: "Open my own Meta app settings",
        note: "The Meta consent dialog must grant the messaging permissions — without them the Page connects but DMs never reach Inbox.",
      },
      instagram: {
        title: "Instagram Direct",
        sideDescription: "Connect Instagram Direct via Facebook Page or Instagram Login path.",
        bodyDescription: "Choose the account model first: linked Facebook Page or Instagram Login for accounts not linked to a Page.",
        badge: "Meta",
        resources: ["Instagram business setup", "Instagram Login path", "DM permission checklist"],
        tutorial: {
          title: "Using Instagram Direct",
          duration: "3 min",
          description: "Prepare the correct Meta path before saving Instagram credentials.",
          steps: ["Choose Facebook Page or Instagram Login path", "Confirm Instagram business account", "Grant messaging permissions", "Send one inbound DM to verify Inbox"],
        },
        eligibilityTitle: "Check Instagram account model",
        eligibility: [
          { label: "Account type", question: "Is the Instagram account a business/professional account?", options: ["Yes, it is business/professional", "I need to convert it first"] },
          { label: "Meta app", question: "Do you run your own Meta app?", options: ["No — use LeadDrive's connection", "Yes, I have my own Meta app"] },
        ],
        connectTitle: "Connect Instagram Direct",
        connectDesc: "Click Connect with Meta and pick the Facebook Page linked to the Instagram account. Instagram Direct is delivered through that Page.",
        primary: "Continue to connect",
        secondary: "Open my own Meta app settings",
        note: "Instagram Direct arrives over the linked Facebook Page's webhook, so pick that Page in the Meta dialog. Instagram Login is only for accounts with no linked Page.",
      },
      telegram: {
        title: "Telegram Bot",
        sideDescription: "Connect a Telegram bot for real-time inbox conversations.",
        bodyDescription: "Create the bot with BotFather, copy the token, then save it in LeadDrive.",
        resources: ["BotFather token", "Webhook verification", "Inbound message test"],
        tutorial: {
          title: "Using Telegram Bot",
          duration: "2 min",
          description: "A short bot-token setup before the first inbound message appears in Inbox.",
          steps: ["Create/select bot in BotFather", "Copy bot token", "Save Telegram channel", "Send one message to verify routing"],
        },
        eligibilityTitle: "Check Telegram bot readiness",
        eligibility: [
          { label: "Bot exists", question: "Do you already have the Telegram bot token?", options: ["Yes, token is ready", "I need to create a bot"] },
          { label: "Test chat", question: "Can you send a test message to the bot after saving?", options: ["Yes", "I will test later"] },
        ],
        connectTitle: "Connect Telegram Bot",
        connectDesc: "Paste the bot token and save the channel. Then send one inbound message to verify routing.",
        primary: "Continue to Telegram credentials",
        secondary: "Skip and paste token",
        note: "Do not reuse a personal Telegram account; LeadDrive expects a Bot token.",
      },
      vkontakte: {
        title: "VKontakte",
        sideDescription: "Connect VK messages into the same LeadDrive inbox routing model as the rest of omni-channel.",
        bodyDescription: "Prepare the VK community/app access first, then save the token and webhook settings in LeadDrive.",
        resources: ["VK community access", "VK API token", "Webhook verification"],
        tutorial: {
          title: "Using VKontakte",
          duration: "2 min",
          description: "A short setup path for VK community messages before they enter the shared inbox.",
          steps: ["Confirm VK community admin access", "Copy the VK API token", "Save VKontakte channel", "Send one inbound VK message to verify routing"],
        },
        eligibilityTitle: "Check VKontakte readiness",
        eligibility: [
          { label: "Community access", question: "Do you manage the VK community that will receive customer messages?", options: ["Yes, admin access is ready", "I need community access first"] },
          { label: "API token", question: "Do you have the VK token and webhook settings ready?", options: ["Yes, credentials are ready", "I will collect them later"] },
        ],
        connectTitle: "Connect VKontakte",
        connectDesc: "Continue to save the VK token and webhook configuration.",
        primary: "Continue to VK credentials",
        secondary: "Skip and paste VK token",
        note: "Use a community/app token. Personal VK account credentials should not be pasted into LeadDrive.",
      },
      smsAtl: {
        title: "ATL SMS",
        sideDescription: "Azerbaijan-first SMS delivery through ATL, the default LeadDrive SMS provider.",
        bodyDescription: "Confirm ATL sender and API credentials before saving. This avoids unclear SMS provider choices.",
        badge: "LeadDrive default",
        resources: ["ATL sender profile", "ATL API credentials", "Controlled SMS test"],
        tutorial: {
          title: "Using ATL SMS",
          duration: "2 min",
          description: "Prepare ATL credentials and sender title before sending test SMS.",
          steps: ["Confirm ATL login and sender title", "Copy API credentials", "Save ATL SMS in LeadDrive", "Send one controlled test SMS"],
        },
        eligibilityTitle: "Check ATL SMS readiness",
        eligibility: [
          { label: "ATL account", question: "Is the ATL sender account approved?", options: ["Yes, ATL account is ready", "I need ATL approval first"] },
          { label: "Credentials", question: "Do you have ATL login, password/API secret and sender title?", options: ["Yes, credentials are ready", "I will collect them later"] },
        ],
        connectTitle: "Connect ATL SMS",
        connectDesc: "Continue to save ATL as the SMS provider. Use this for Azerbaijan SMS by default.",
        primary: "Continue to ATL credentials",
        secondary: "Skip and paste ATL keys",
        note: "For other countries, use Twilio/Vonage fallback; ATL remains the default local SMS provider.",
      },
      smsProvider: {
        title: "SMS Provider",
        sideDescription: "Connect an international SMS fallback provider when ATL is not the right route for this tenant.",
        bodyDescription: "LeadDrive keeps ATL as the default SMS provider for Azerbaijan, while Twilio/Vonage can cover other markets.",
        resources: ["Sender ID approval", "Provider API credentials", "Controlled SMS test"],
        tutorial: {
          title: "Using SMS Provider",
          duration: "2 min",
          description: "Prepare provider credentials and sender approval before sending test SMS.",
          steps: ["Choose Twilio or Vonage", "Confirm sender ID approval", "Save provider credentials", "Send one controlled test SMS"],
        },
        eligibilityTitle: "Check SMS provider readiness",
        eligibility: [
          { label: "Provider account", question: "Is the SMS provider account approved for this sender/country?", options: ["Yes, provider account is ready", "I need provider approval first"] },
          { label: "Credentials", question: "Do you have API key/secret and sender settings?", options: ["Yes, credentials are ready", "I will collect them later"] },
        ],
        connectTitle: "Connect SMS Provider",
        connectDesc: "Continue to save this provider. For Azerbaijan tenants prefer ATL unless there is a clear reason to use another SMS route.",
        primary: "Continue to SMS credentials",
        secondary: "Skip and paste SMS keys",
        note: "SMS can send real external messages. Use a controlled test number before enabling live customer campaigns.",
      },
      googleWorkspace: {
        title: "Google Workspace",
        sideDescription: "Connect Google Workspace mailboxes through SMTP/IMAP credentials.",
        bodyDescription: "Prepare mailbox/admin access first, then save the email credentials.",
        resources: ["Google Admin access", "Mailbox security", "Email forwarding test"],
        tutorial: {
          title: "Using Google Workspace Email",
          duration: "2 min",
          description: "Confirm admin/security settings before saving the mailbox channel.",
          steps: ["Confirm Google Workspace admin policy", "Prepare app password or SMTP access", "Save mailbox credentials", "Send and receive one test email"],
        },
        eligibilityTitle: "Check mailbox readiness",
        eligibility: [
          { label: "Mailbox", question: "Do you have the mailbox that will receive customer messages?", options: ["Yes, mailbox is ready", "I need to create it"] },
          { label: "Security", question: "Do you have SMTP/app password access allowed?", options: ["Yes, access is allowed", "I need admin approval"] },
        ],
        connectTitle: "Connect Google Workspace",
        connectDesc: "Continue to save mailbox credentials and verify one inbound email.",
        primary: "Continue to email credentials",
        secondary: "Skip and paste SMTP keys",
        note: "Email replies depend on SMTP/IMAP provider settings; verify with one controlled email before live use.",
      },
      websiteChat: {
        title: "Website Chat",
        sideDescription: "Configure the LeadDrive web chat widget, launcher, AI handoff and escalation.",
        bodyDescription: "Website chat has a dedicated settings page because it is not just credentials; it controls widget behavior.",
        resources: ["Widget settings", "AI handoff", "Escalation rules"],
        tutorial: {
          title: "Using Website Chat",
          duration: "2 min",
          description: "Configure widget behavior and then test it from your site.",
          steps: ["Open web chat settings", "Configure launcher and greeting", "Set handoff/escalation", "Send one test web-chat message"],
        },
        eligibilityTitle: "Check website chat readiness",
        eligibility: [
          { label: "Website access", question: "Can you add or update the LeadDrive widget snippet on your website?", options: ["Yes, website access is ready", "I need developer access"] },
          { label: "Routing", question: "Do you know which team should receive web-chat conversations?", options: ["Yes", "I will configure routing later"] },
        ],
        connectTitle: "Configure Website Chat",
        connectDesc: "Open the dedicated Web Chat settings page for widget configuration.",
        primary: "Open Web Chat settings",
        secondary: "Back to catalog",
        note: "This channel uses widget settings, not the generic channel credential form.",
      },
      customWebhook: {
        title: "Custom Webhook Channel",
        sideDescription: "Use Integrations to connect a provider that LeadDrive does not support natively yet.",
        bodyDescription: "This path explains what the tenant must prepare before opening Integrations: provider event type, webhook secret, payload sample and one controlled inbound test.",
        badge: "Webhook",
        resources: ["Provider webhook documentation", "Payload sample", "Controlled inbound test"],
        tutorial: {
          title: "Using Custom Webhook Channel",
          duration: "2 min",
          description: "Prepare a webhook-based provider connection, map events into LeadDrive, then verify one inbound event before routing live traffic.",
          steps: ["Open the provider webhook settings", "Create a LeadDrive integration endpoint", "Map channel, contact and message fields", "Send one controlled inbound event and verify Inbox"],
        },
        eligibilityTitle: "Check custom integration readiness",
        eligibility: [
          { label: "Provider webhook", question: "Does the provider support outbound webhooks for new messages or chat events?", options: ["Yes, webhook events are available", "I need provider documentation first"] },
          { label: "Payload sample", question: "Do you have a sample payload and a secret/signature rule for verification?", options: ["Yes, sample and secret are ready", "I will collect them later"] },
        ],
        connectTitle: "Connect a custom webhook channel",
        connectDesc: "Open Integrations to create the webhook endpoint, map the inbound payload and keep a controlled test before sending customer traffic.",
        primary: "Open Integrations",
        secondary: "Back to catalog",
        note: "Use this only for providers without a native channel card. Native WhatsApp, Facebook, Instagram, Telegram, SMS and email should use their own guides.",
      },
      whatsappCalling: {
        title: "WhatsApp Business Calling",
        sideDescription: "Enable live WhatsApp calls for the same Cloud API number that already receives messages in Inbox.",
        bodyDescription: "This setup enables inbound calls and permission-gated outbound calls. Customers can call the WhatsApp business number, and operators can request WhatsApp call permission before starting an outbound live call from Inbox.",
        badge: "Calling",
        resources: ["Correct Meta app and App Secret", "LeadDrive callback and verify token", "Inbound and approved outbound call tests in Inbox"],
        tutorial: {
          title: "Using WhatsApp Business Calling",
          duration: "3 min",
          description: "Connect the correct Meta app, subscribe calls events, then verify real behavior: answer one inbound call and start one outbound call after the customer approves the WhatsApp permission request.",
          steps: ["Open the Meta app that owns the WhatsApp Phone Number ID saved in LeadDrive", "Copy App Secret from App settings -> Basic and save it in the WhatsApp API channel", "Paste the LeadDrive callback and verify token in Meta Webhooks, then subscribe calls", "Answer one inbound call in Inbox, then request permission and start one approved outbound call"],
        },
        eligibilityTitle: "Check WhatsApp Calling readiness",
        eligibility: [
          { label: "Same number", question: "Does this Meta app contain the same WhatsApp number that is already used by this tenant in LeadDrive?", options: ["Yes, the same number is selected", "I need to find the correct Meta app"] },
          { label: "Calls events", question: "Can you edit the WhatsApp webhook configuration and subscribe the app to calls events?", options: ["Yes, Meta app admin access is ready", "I need Meta app admin access first"] },
        ],
        connectTitle: "Prepare WhatsApp Business Calling",
        connectDesc: "First save the WhatsApp API keys for the existing messaging channel. Then subscribe calls in Meta, test one inbound call, request customer call permission, and start one approved outbound WhatsApp call in Inbox.",
        primary: "Continue to WhatsApp API credentials",
        secondary: "Back to catalog",
        note: "Phone Number ID is not the phone number to dial. The customer dials the visible WhatsApp business number; LeadDrive uses Phone Number ID only for the API connection.",
      },
      calls: {
        title: "Calls / VoIP",
        sideDescription: "Connect Twilio, 3CX, Asterisk or SIP for call logs, recordings and click-to-call.",
        bodyDescription: "Voice infrastructure is configured separately from messaging channels.",
        resources: ["VoIP provider setup", "Call recordings", "CRM call history"],
        tutorial: {
          title: "Using Calls",
          duration: "2 min",
          description: "Choose a voice provider and wire call logs into CRM.",
          steps: ["Choose Twilio/3CX/Asterisk/SIP", "Save provider credentials", "Enable call logging", "Make one controlled test call"],
        },
        eligibilityTitle: "Check VoIP readiness",
        eligibility: [
          { label: "Provider", question: "Do you already have a telephony provider?", options: ["Yes, provider exists", "I need to choose one"] },
          { label: "Call logging", question: "Do you need recordings/transcripts in CRM?", options: ["Yes", "Not yet"] },
        ],
        connectTitle: "Configure Calls",
        connectDesc: "Open VoIP settings to connect Twilio, 3CX, Asterisk or custom SIP.",
        primary: "Open VoIP settings",
        secondary: "Back to catalog",
        note: "WhatsApp Business Calling is separate from regular VoIP and is not enabled here.",
      },
    },
  },
  ru: {
    back: "Назад в каталог каналов",
    oauthSuccessTitle: "Канал подключён",
    oauthSuccessDesc: "Meta вернула страниц Facebook: {pages}, аккаунтов Instagram: {ig}. Отправьте одно сообщение на аккаунт, чтобы убедиться, что оно доходит в Inbox.",
    oauthPartialTitle: "Этот канал всё ещё не подключён",
    oauthNoInstagramDesc: "Meta вернула страниц Facebook: {pages}, аккаунтов Instagram — ни одного. Instagram Direct доставляется через страницу Facebook, к которой привязан БИЗНЕС-аккаунт Instagram, поэтому пока такой привязки нет, сюда ничего не придёт. Привяжите бизнес-аккаунт Instagram к странице в настройках Meta Business и запустите «Подключить через Meta» ещё раз.",
    oauthNoPageDesc: "Meta завершила вход, но не вернула для этого канала ни одной страницы Facebook, поэтому сообщения приходить не будут. Запустите «Подключить через Meta» ещё раз и отметьте нужную страницу.",
    oauthErrorTitle: "Подключение не завершилось",
    oauthErrorDesc: "Meta вернула: {code}. Повторите попытку или откройте «У меня своё приложение Meta» и введите свои ключи.",
    oauthNotDeliveringTitle: "Подключено, но пока не доставляет",
    oauthNoChannelRowDesc: "Meta завершила вход, но в этом рабочем пространстве до сих пор нет канала для него — входящему сообщению просто некуда прийти. Запустите «Подключить через Meta» ещё раз; если всё повторится, значит callback не смог сохранить канал.",
    oauthCheckingTitle: "Проверяем, что подключилось на самом деле",
    oauthCheckingDesc: "Meta ответила. LeadDrive читает сохранённый канал, прежде чем называть что-либо подключённым.",
    oauthUnverifiedDesc: "Meta ответила, но LeadDrive не смог прочитать каналы этого рабочего пространства и не может подтвердить, что подключение работает. Обновите страницу, а если снова не выйдет — откройте каталог каналов.",
    helpBanner: "Нужна помощь с подключением канала? Сначала пройдите инструкцию ниже, потом вводите ключи.",
    additionalResources: "Полезные материалы",
    videoTutorial: "Пошаговая инструкция подключения",
    watchGuideTitle: "Нужна инструкция перед сохранением?",
    watchGuideDesc: "Откройте экранную инструкцию: там видно, что делать у провайдера, что вставить в LeadDrive и как проверить канал.",
    tutorialPlayerTitle: "Интерактивная инструкция подключения",
    tutorialPlayerDesc: "Используйте как короткое видео: подготовьте провайдера, вставьте только нужные поля LeadDrive и сделайте один безопасный тест.",
    tutorialPlayerNow: "Сейчас показываем",
    tutorialPlayerProvider: "Работа у провайдера",
    tutorialPlayerLeadDrive: "Поля LeadDrive",
    tutorialPlayerVerify: "Безопасный тест",
    tutorialPlayerFieldMap: "Что заполнить",
    tutorialPlayerOpenFull: "Открыть полную инструкцию",
    openGuide: "Открыть инструкцию",
    tutorialStepsTitle: "Что объясняет инструкция",
    learnMore: "Подробнее",
    eligibilityBadge: "Проверка готовности",
    channelSetup: "Подключение канала",
    selectScenario: "Сценарий подключения",
    selectedScenario: "Выбранный сценарий",
    readinessSummary: "Итог готовности",
    wizardPlanTitle: "Ваш план подключения",
    wizardPlanDesc: "LeadDrive держит работу у провайдера, сохранение ключей и первый безопасный тест в одном понятном плане.",
    wizardScenarioLabel: "Сценарий",
    wizardReadinessLabel: "Ответы проверки",
    wizardNotAnswered: "Пока не отвечено",
    wizardEditReadiness: "Изменить проверку готовности",
    wizardProviderLabel: "Провайдер",
    wizardLeadDriveLabel: "LeadDrive",
    wizardVerifyLabel: "Проверка",
    currentChoice: "Текущий ответ",
    readinessQuestionTitle: "Ответьте перед вводом ключей",
    readinessQuestionDesc: "Эта проверка не даёт сохранить наполовину подключённый канал. Если доступа нет, остановитесь здесь и запросите владельца провайдера.",
    readinessProgress: "Прогресс готовности",
    readinessWhyTitle: "Зачем это нужно",
    readinessWhyDesc: "LeadDrive может сохранить ключи, но живой inbox-трафик заработает только после доступа к провайдеру, webhook-настройки и одного контролируемого теста.",
    readinessNextTitle: "После этой проверки",
    readinessNextDesc: "Вы попадёте на закреплённую форму ключей для этого канала. С этого экрана живой клиентский трафик не отправляется.",
    nextActionTitle: "Следующее действие",
    quickStartTitle: "Начните отсюда",
    quickStartDesc: "Самый короткий безопасный путь для выбранного канала. Выполните шаги по порядку до живого клиентского трафика.",
    quickStartProvider: "1. Провайдер",
    quickStartProviderDesc: "Откройте эту панель провайдера и сначала подготовьте аккаунт или отправителя.",
    quickStartFields: "2. Поля LeadDrive",
    quickStartFieldsDesc: "Вставьте эти поля в закреплённую форму LeadDrive для выбранного канала.",
    quickStartVerify: "3. Безопасная проверка",
    quickStartVerifyDesc: "Сделайте один контролируемый тест до живого использования.",
    quickStartGuideAction: "Показать инструкцию",
    quickStartFormAction: "К форме",
    operatorNextTitle: "Что делать сейчас",
    operatorNextDesc: "Используйте этот checklist как путь оператора для этого канала. Он разделяет работу у провайдера, ключи LeadDrive и финальную проверку.",
    operatorStepProviderTitle: "Откройте провайдера",
    operatorStepProviderDesc: "Сначала подготовьте внешний account, Page, inbox, отправителя или телефонный номер.",
    operatorStepLeadDriveTitle: "Заполните поля LeadDrive",
    operatorStepLeadDriveDesc: "Сохраните только ключи выбранного канала. Тип канала уже зафиксирован.",
    operatorStepVerifyTitle: "Сделайте один безопасный тест",
    operatorStepVerifyDesc: "Отправьте одно контролируемое входящее событие и проверьте Inbox до живого трафика.",
    operatorPrimaryAction: "Продолжить ниже",
    operatorExternalAction: "Открыть настройку",
    operatorVerifyAction: "Посмотреть проверку",
    faqTitle: "Частые вопросы",
    faqDesc: "Короткие ответы для оператора перед сохранением канала.",
    connectionMapTitle: "Как работает это подключение",
    connectionMapDesc: "Для каждого провайдера один порядок: подготовить внешний аккаунт, сохранить только выбранный канал в LeadDrive, затем проверить один контролируемый диалог до живого использования.",
    providerWorkTitle: "Сторона провайдера",
    providerWorkDesc: "Создайте или проверьте аккаунт, страницу, inbox, отправителя, бота, почтовый ящик или телефонию вне LeadDrive.",
    leadDriveWorkTitle: "Сторона LeadDrive",
    leadDriveWorkDesc: "Введите точные ключи только для выбранного канала. Форма ниже закреплена, тип канала не может случайно измениться.",
    validationWorkTitle: "Проверка",
    validationWorkDesc: "Отправьте одно контролируемое входящее сообщение, email, SMS или звонок и проверьте Inbox до живого трафика.",
    credentialsRequired: "Что подготовить",
    verificationRequired: "Как проверить работу",
    nextActionInlineFormHint: "Заполните закреплённую форму на этой странице. Тип канала уже выбран, оператору не нужно искать его повторно.",
    nextActionExternalHint: "Откройте отдельную страницу настроек ниже. Этот канал настраивается в своём разделе, не через общую форму ключей.",
    setupOutcomeTitle: "Что будет дальше",
    setupOutcomeDesc: "LeadDrive только открывает выбранную настройку и сохраняет ключи этого канала. Живой клиентский трафик не отправляется, пока вы не выполните проверочный шаг.",
    whatsappCallingSmokeTitle: "Тест CRM без реального звонка",
    whatsappCallingSmokeDesc: "Создайте тестовый исходящий WhatsApp-звонок внутри CRM, чтобы админ проверил Inbox, разрешение, журнал звонков, live popup и кнопки управления до реального звонка Meta.",
    whatsappCallingSmokeButton: "Создать исходящий тестовый звонок",
    whatsappCallingSmokeRunning: "Создаю тестовый звонок...",
    whatsappCallingSmokeSuccess: "Исходящий тестовый звонок активен в Inbox",
    whatsappCallingSmokeFailed: "LeadDrive не смог создать тест WhatsApp Calling.",
    whatsappCallingSmokeOpenInbox: "Открыть звонок в Inbox",
    whatsappCallingSmokeNoExternal: "Реальный WhatsApp-звонок не создаётся. Проверяются только маршрутизация LeadDrive, журнал звонка, временная media-сессия и кнопки Inbox.",
    whatsappCallingSmokeMetaReminder: "После успешного теста запросите разрешение у реального WhatsApp-клиента и сделайте один approved outbound WhatsApp-звонок, чтобы подтвердить доставку Meta на app.leaddrivecrm.org.",
    whatsappCallingWebhookTitle: "Webhook звонков Meta",
    whatsappCallingWebhookCallback: "Callback URL",
    whatsappCallingWebhookVerify: "Verify token",
    whatsappCallingWebhookSubscribe: "Событие подписки",
    whatsappCallingWebhookHint: "Скопируйте этот callback в Meta Webhooks для этого tenant-а и подпишите WhatsApp app на calls events. Verify token и app secret должны совпадать с сохранённым каналом WhatsApp Business API.",
    whatsappCallingTenantFallback: "Tenant slug появится после входа",
    newAccount: "Создать и подключить новый аккаунт",
    newAccountDesc: "Если вы заводите новый аккаунт провайдера, страницу, inbox или номер.",
    existingAccount: "Подключить существующий аккаунт",
    existingAccountDesc: "Если аккаунт провайдера уже есть и ключи готовы.",
    getStarted: "Начать",
    skip: "Пропустить проверку",
    next: "Дальше",
    previous: "Назад",
    yesContinue: "Да, доступ есть",
    createLater: "Создам позже",
    continueManual: "Перейти к форме ключей",
    closeTutorial: "Закрыть туториал",
    startSetupFromTutorial: "Начать проверку готовности",
    resourceAction: "Открыть экранную инструкцию",
    tutorialPreviewTitle: "Экранная инструкция",
    tutorialProviderSide: "Сторона провайдера",
    tutorialLeadDriveSide: "Настройка LeadDrive",
    processTitle: "Путь подключения",
    stepIntro: "Обзор",
    stepEligibility: "Проверка готовности",
    stepConnect: "Ключи",
    readyBeforeTitle: "Подготовьте заранее",
    afterConnectTitle: "После сохранения",
    guideFooter: "Если нужна пошаговая инструкция, откройте Help Center для этого канала.",
    notFoundTitle: "Инструкция для канала не найдена",
    notFoundDesc: "Вернитесь в каталог и выберите поддерживаемый канал.",
    guides: {
      whatsapp: {
        title: "WhatsApp Business Platform (API)",
        sideDescription: "Подключение WhatsApp Business API через Meta: ответы из инбокса, одобренные шаблоны и уведомления.",
        bodyDescription: "LeadDrive ведёт по логике Meta: готовность номера, доступ к Business Manager, затем ключи и webhook.",
        badge: "Popular",
        resources: ["Всё о WhatsApp Business Platform (API)", "WhatsApp pricing", "Meta webhook checklist"],
        tutorial: {
          title: "Как работает WhatsApp Business Platform (API)",
          duration: "1:45",
          description: "WABA, номера, Meta Business Manager и отличие API от мобильного WhatsApp Business.",
          steps: ["Выбрать новый или существующий WABA", "Проверить готовность номера", "Проверить доступ Meta Business Manager", "Подключить через Meta или вставить ключи Cloud API"],
        },
        eligibilityTitle: "Начнём с простой проверки готовности",
        eligibility: [
          { label: "Номер телефона", question: "Есть номер, который может получать SMS?", options: ["У меня новый номер, не привязанный к WhatsApp", "Номер привязан к личному WhatsApp", "Нового номера нет"] },
          { label: "Доступ к Meta Business Manager", question: "Есть доступ к Meta Business Manager компании?", info: "Полезно знать: для WABA нужны публичное название компании, юридическое название и официальный адрес.", options: ["Да, доступ администратора есть", "Создам позже"] },
        ],
        connectTitle: "Подключить WhatsApp Business Platform (API)",
        connectDesc: "Дальше введите ключи Meta Cloud API для этого тенанта. Встроенную регистрацию Meta можно добавить позже без смены архитектуры этой страницы.",
        primary: "Перейти к ключам WhatsApp",
        secondary: "Пропустить и вставить готовые ключи",
        note: "Это сохраняет ключи WhatsApp messaging. Для звонков вернитесь в Каналы -> Звонки -> WhatsApp Business Calling и завершите чеклист Meta calls.",
      },
      tiktok: {
        title: "TikTok через Chatwoot",
        sideDescription: "TikTok DM подключаются через Chatwoot. Chatwoot остаётся транспортом, LeadDrive показывает диалог как TikTok.",
        bodyDescription: "TikTok здесь не подключается напрямую к LeadDrive. Сначала создайте TikTok inbox в Chatwoot, затем вставьте ключи Chatwoot.",
        badge: "Chatwoot bridge",
        resources: ["Создать TikTok inbox в Chatwoot", "API-токен Chatwoot", "Сопоставление webhook в LeadDrive"],
        tutorial: {
          title: "TikTok через Chatwoot",
          duration: "3 мин",
          description: "Канал работает как транспорт Chatwoot + маршрутизация в инбокс LeadDrive.",
          steps: ["Создать или выбрать TikTok inbox в Chatwoot", "Скопировать базовый URL Chatwoot, account ID и токен", "Сохранить TikTok через Chatwoot в LeadDrive", "Отправить один TikTok DM и проверить инбокс"],
        },
        eligibilityTitle: "Сначала проверьте готовность Chatwoot",
        eligibility: [
          { label: "TikTok inbox", question: "TikTok уже подключён в Chatwoot?", options: ["Да, TikTok inbox есть в Chatwoot", "Сначала нужно создать"] },
          { label: "Доступ к API Chatwoot", question: "Есть базовый URL Chatwoot, account ID, access token и webhook secret?", options: ["Да, ключи готовы", "Соберу позже"] },
        ],
        connectTitle: "Подключить TikTok через Chatwoot",
        connectDesc: "Дальше сохраните это как канал Chatwoot с провайдером TikTok.",
        primary: "Перейти к ключам Chatwoot",
        secondary: "Пропустить и вставить ключи",
        note: "Не настраивайте TikTok как прямой TikTok API канал; LeadDrive ожидает Chatwoot как транспорт TikTok.",
      },
      facebook: {
        title: "Facebook Messenger",
        sideDescription: "Messenger подключается через Meta-приложение тенанта и Facebook Page.",
        bodyDescription: "Правильный порядок: доступ к Meta-приложению, затем права страницы и разрешения на сообщения, затем ключи в LeadDrive.",
        badge: "Meta",
        resources: ["Настройка Meta app", "Права сообщений страницы", "Проверка webhook"],
        tutorial: {
          title: "Facebook Messenger",
          duration: "3 мин",
          description: "Подготовьте Meta-приложение, права страницы и webhook до сохранения канала.",
          steps: ["Выбрать Meta-приложение тенанта", "Выбрать Facebook Page", "Выдать pages_messaging и права webhook", "Сохранить и проверить входящее сообщение"],
        },
        eligibilityTitle: "Проверьте доступ к Messenger",
        eligibility: [
          { label: "Facebook Page", question: "Вы администратор Facebook Page, где будут сообщения?", options: ["Да, доступ администратора есть", "Сначала нужен доступ"] },
          { label: "Meta app", question: "У вас есть собственное приложение Meta?", options: ["Нет — использую подключение LeadDrive", "Да, есть своё приложение Meta"] },
        ],
        connectTitle: "Подключить Facebook Messenger",
        connectDesc: "Нажмите «Подключить через Meta», войдите и выберите страницу. Ключи нужны, только если у вас своё приложение Meta.",
        primary: "Перейти к подключению",
        secondary: "Открыть настройки своего приложения Meta",
        note: "В диалоге Meta нужно выдать права на сообщения — без них страница подключится, но личные сообщения в Inbox не придут.",
      },
      instagram: {
        title: "Instagram Direct",
        sideDescription: "Instagram Direct через Facebook Page или отдельный путь Instagram Login.",
        bodyDescription: "Сначала выберите модель: привязка к Facebook Page или Instagram Login для аккаунтов без Page.",
        badge: "Meta",
        resources: ["Настройка business-аккаунта Instagram", "Путь Instagram Login", "Чеклист прав для DM"],
        tutorial: {
          title: "Instagram Direct",
          duration: "3 мин",
          description: "Подготовьте правильный путь Meta перед сохранением ключей Instagram.",
          steps: ["Выбрать Facebook Page или путь Instagram Login", "Проверить business-аккаунт Instagram", "Выдать messaging permissions", "Отправить входящий DM и проверить инбокс"],
        },
        eligibilityTitle: "Проверьте модель Instagram",
        eligibility: [
          { label: "Тип аккаунта", question: "Instagram account — business/professional?", options: ["Да, business/professional", "Сначала нужно конвертировать"] },
          { label: "Meta app", question: "У вас есть собственное приложение Meta?", options: ["Нет — использую подключение LeadDrive", "Да, есть своё приложение Meta"] },
        ],
        connectTitle: "Подключить Instagram Direct",
        connectDesc: "Нажмите «Подключить через Meta» и выберите Facebook-страницу, связанную с Instagram-аккаунтом. Instagram Direct приходит через неё.",
        primary: "Перейти к подключению",
        secondary: "Открыть настройки своего приложения Meta",
        note: "Instagram Direct приходит через вебхук связанной Facebook-страницы, поэтому в диалоге Meta выбирайте именно её. Instagram Login — только для аккаунтов без связанной страницы.",
      },
      telegram: {
        title: "Telegram Bot",
        sideDescription: "Telegram bot для realtime-диалогов в инбоксе.",
        bodyDescription: "Создайте bot через BotFather, скопируйте token и сохраните в LeadDrive.",
        resources: ["Токен BotFather", "Проверка webhook", "Тест входящего сообщения"],
        tutorial: {
          title: "Telegram Bot",
          duration: "2 мин",
          description: "Короткая настройка bot token до первого входящего сообщения.",
          steps: ["Создать или выбрать bot в BotFather", "Скопировать token", "Сохранить Telegram channel", "Отправить сообщение и проверить маршрутизацию"],
        },
        eligibilityTitle: "Проверьте готовность Telegram bot",
        eligibility: [
          { label: "Bot готов", question: "Telegram bot token уже есть?", options: ["Да, token готов", "Нужно создать bot"] },
          { label: "Тестовый чат", question: "Сможете отправить test message после сохранения?", options: ["Да", "Проверю позже"] },
        ],
        connectTitle: "Подключить Telegram Bot",
        connectDesc: "Вставьте bot token и сохраните канал. Потом отправьте входящее сообщение.",
        primary: "Перейти к ключам Telegram",
        secondary: "Пропустить и вставить token",
        note: "Не используйте личный Telegram account; LeadDrive ожидает Bot token.",
      },
      vkontakte: {
        title: "VKontakte",
        sideDescription: "Сообщения VK подключаются к той же маршрутизации omni-channel inbox, что и остальные каналы.",
        bodyDescription: "Сначала подготовьте доступ к VK community/app, потом сохраните token и настройки webhook в LeadDrive.",
        resources: ["VK community access", "VK API token", "Webhook verification"],
        tutorial: {
          title: "VKontakte",
          duration: "2 мин",
          description: "Короткая настройка для сообщений VK community перед попаданием в общий инбокс.",
          steps: ["Проверить доступ администратора к VK community", "Скопировать VK API token", "Сохранить канал VKontakte", "Отправить входящее VK-сообщение и проверить маршрутизацию"],
        },
        eligibilityTitle: "Проверьте готовность VKontakte",
        eligibility: [
          { label: "Доступ к community", question: "Вы администратор VK community, где будут сообщения?", options: ["Да, доступ администратора есть", "Сначала нужен доступ"] },
          { label: "API token", question: "VK token и настройки webhook готовы?", options: ["Да, ключи готовы", "Соберу позже"] },
        ],
        connectTitle: "Подключить VKontakte",
        connectDesc: "Дальше сохраните VK token и настройки webhook.",
        primary: "Перейти к ключам VK",
        secondary: "Пропустить и вставить VK token",
        note: "Используйте community/app token. Личные VK-логины нельзя вставлять в LeadDrive.",
      },
      smsAtl: {
        title: "ATL SMS",
        sideDescription: "SMS-доставка через ATL для Азербайджана — основной SMS-провайдер LeadDrive.",
        bodyDescription: "Сначала подтвердите отправителя ATL и API-ключи, чтобы не было путаницы с SMS-провайдером.",
        badge: "Основной",
        resources: ["Профиль отправителя ATL", "API-ключи ATL", "Контролируемый SMS-тест"],
        tutorial: {
          title: "ATL SMS",
          duration: "2 мин",
          description: "Подготовьте ключи ATL и имя отправителя перед тестовым SMS.",
          steps: ["Подтвердить ATL login и имя отправителя", "Скопировать API-ключи", "Сохранить ATL SMS в LeadDrive", "Отправить контролируемое тестовое SMS"],
        },
        eligibilityTitle: "Проверьте готовность ATL SMS",
        eligibility: [
          { label: "ATL account", question: "Аккаунт отправителя ATL одобрен?", options: ["Да, ATL account готов", "Сначала нужно одобрение ATL"] },
          { label: "Ключи", question: "Есть ATL login, password/API secret и имя отправителя?", options: ["Да, ключи готовы", "Соберу позже"] },
        ],
        connectTitle: "Подключить ATL SMS",
        connectDesc: "Дальше сохраните ATL как SMS-провайдер. Для Азербайджана используем это по умолчанию.",
        primary: "Перейти к ключам ATL",
        secondary: "Пропустить и вставить ключи ATL",
        note: "Для других стран используйте Twilio/Vonage как резервный маршрут; ATL остаётся основным локальным SMS-провайдером.",
      },
      smsProvider: {
        title: "SMS-провайдер",
        sideDescription: "Подключение международного SMS-провайдера, если ATL не подходит для тенанта.",
        bodyDescription: "Для Азербайджана LeadDrive оставляет ATL основным провайдером; Twilio/Vonage нужны для других рынков.",
        resources: ["Одобрение Sender ID", "API-ключи провайдера", "Контролируемый SMS-тест"],
        tutorial: {
          title: "SMS-провайдер",
          duration: "2 мин",
          description: "Подготовьте ключи провайдера и одобрение отправителя перед тестовым SMS.",
          steps: ["Выбрать Twilio или Vonage", "Проверить одобрение Sender ID", "Сохранить ключи провайдера", "Отправить контролируемое тестовое SMS"],
        },
        eligibilityTitle: "Проверьте готовность SMS-провайдера",
        eligibility: [
          { label: "Аккаунт провайдера", question: "SMS-аккаунт одобрен для этого отправителя и страны?", options: ["Да, аккаунт провайдера готов", "Сначала нужно одобрение провайдера"] },
          { label: "Ключи", question: "API key/secret и настройки отправителя готовы?", options: ["Да, ключи готовы", "Соберу позже"] },
        ],
        connectTitle: "Подключить SMS-провайдер",
        connectDesc: "Дальше сохраните провайдера. Для тенантов в Азербайджане используйте ATL, если нет явной причины брать другой SMS-маршрут.",
        primary: "Перейти к SMS-ключам",
        secondary: "Пропустить и вставить SMS-ключи",
        note: "SMS отправляет реальные внешние сообщения. Перед живыми кампаниями используйте контролируемый тестовый номер.",
      },
      googleWorkspace: {
        title: "Google Workspace",
        sideDescription: "Почтовые ящики Google Workspace через SMTP/IMAP-ключи.",
        bodyDescription: "Сначала подготовьте доступ к mailbox/admin, потом сохраните email-ключи.",
        resources: ["Доступ Google Admin", "Безопасность mailbox", "Тест пересылки email"],
        tutorial: {
          title: "Google Workspace Email",
          duration: "2 мин",
          description: "Проверьте настройки администратора и безопасности перед сохранением mailbox-канала.",
          steps: ["Проверить admin policy Google Workspace", "Подготовить app password или SMTP access", "Сохранить ключи mailbox", "Отправить и принять тестовый email"],
        },
        eligibilityTitle: "Проверьте готовность mailbox",
        eligibility: [
          { label: "Mailbox", question: "Mailbox для сообщений клиентов готов?", options: ["Да, mailbox готов", "Нужно создать"] },
          { label: "Безопасность", question: "SMTP/app password access разрешён?", options: ["Да, доступ разрешён", "Нужно одобрение администратора"] },
        ],
        connectTitle: "Подключить Google Workspace",
        connectDesc: "Дальше сохраните ключи mailbox и проверьте один входящий email.",
        primary: "Перейти к email-ключам",
        secondary: "Пропустить и вставить SMTP-ключи",
        note: "Ответы email зависят от настроек SMTP/IMAP-провайдера; проверьте контролируемый email перед живым использованием.",
      },
      websiteChat: {
        title: "Веб-чат",
        sideDescription: "Виджет LeadDrive для сайта: кнопка запуска, передача ИИ оператору и правила эскалации.",
        bodyDescription: "Веб-чат настраивается на отдельной странице, потому что здесь важны не только ключи, но и поведение виджета.",
        resources: ["Настройки виджета", "Передача ИИ оператору", "Правила эскалации"],
        tutorial: {
          title: "Веб-чат",
          duration: "2 мин",
          description: "Настройте поведение виджета и проверьте с сайта.",
          steps: ["Открыть настройки веб-чата", "Настроить кнопку запуска и приветствие", "Настроить передачу оператору и эскалацию", "Отправить тестовое сообщение из веб-чата"],
        },
        eligibilityTitle: "Проверьте готовность веб-чата",
        eligibility: [
          { label: "Доступ к сайту", question: "Можете добавить или обновить код виджета LeadDrive на сайте?", options: ["Да, доступ к сайту есть", "Нужен доступ разработчика"] },
          { label: "Маршрутизация", question: "Понимаете, какая команда получает диалоги из веб-чата?", options: ["Да", "Настрою позже"] },
        ],
        connectTitle: "Настроить веб-чат",
        connectDesc: "Откройте отдельную страницу веб-чата для настройки виджета.",
        primary: "Открыть настройки веб-чата",
        secondary: "Назад в каталог",
        note: "Этот канал использует настройки виджета, а не универсальную форму ключей.",
      },
      customWebhook: {
        title: "Пользовательский webhook-канал",
        sideDescription: "Используйте раздел интеграций для провайдера, которого пока нет как встроенного канала LeadDrive.",
        bodyDescription: "Этот путь объясняет, что администратор должен подготовить до открытия интеграций: тип события провайдера, секрет webhook, пример payload и один контролируемый входящий тест.",
        badge: "Webhook",
        resources: ["Документация webhook провайдера", "Пример payload", "Контролируемый входящий тест"],
        tutorial: {
          title: "Пользовательский webhook-канал",
          duration: "2 мин",
          description: "Подготовьте webhook-подключение провайдера, сопоставьте события в LeadDrive и проверьте одно входящее событие до живой маршрутизации.",
          steps: ["Открыть настройки webhook у провайдера", "Создать endpoint в интеграциях LeadDrive", "Сопоставить поля канала, контакта и сообщения", "Отправить контролируемое входящее событие и проверить Inbox"],
        },
        eligibilityTitle: "Проверьте готовность пользовательской интеграции",
        eligibility: [
          { label: "Webhook провайдера", question: "Провайдер умеет отправлять исходящие webhook-события по новым сообщениям или чатам?", options: ["Да, webhook-события доступны", "Сначала нужна документация провайдера"] },
          { label: "Пример payload", question: "Есть пример payload и правило проверки секрета/подписи?", options: ["Да, пример и секрет готовы", "Соберу позже"] },
        ],
        connectTitle: "Подключить пользовательский webhook-канал",
        connectDesc: "Откройте интеграции, создайте webhook endpoint, сопоставьте входящий payload и сделайте контролируемый тест до клиентского трафика.",
        primary: "Открыть интеграции",
        secondary: "Назад в каталог",
        note: "Используйте это только для провайдеров без отдельной карточки. WhatsApp, Facebook, Instagram, Telegram, SMS и email подключаются через свои инструкции.",
      },
      whatsappCalling: {
        title: "WhatsApp Business Calling",
        sideDescription: "Включите live WhatsApp-звонки для того же Cloud API номера, который уже принимает сообщения в Inbox.",
        bodyDescription: "Эта настройка включает входящие звонки и исходящие звонки с разрешением клиента. Клиент может звонить на WhatsApp business номер, а оператор может запросить WhatsApp call permission и начать исходящий live-звонок из Inbox.",
        badge: "Calling",
        resources: ["Правильное Meta app и App Secret", "Callback LeadDrive и verify token", "Тест входящего и разрешённого исходящего звонка в Inbox"],
        tutorial: {
          title: "WhatsApp Business Calling",
          duration: "3 мин",
          description: "Подключите правильное Meta app, подпишите calls events и проверьте реальное поведение: ответьте на один входящий звонок и начните один исходящий звонок после разрешения клиента в WhatsApp.",
          steps: ["Откройте Meta app, где находится WhatsApp Phone Number ID, сохранённый в LeadDrive", "Скопируйте App Secret из App settings -> Basic и сохраните его в WhatsApp API канале", "Вставьте callback LeadDrive и verify token в Meta Webhooks, затем подпишите calls", "Ответьте на один входящий звонок в Inbox, затем запросите разрешение и начните один разрешённый исходящий звонок"],
        },
        eligibilityTitle: "Проверьте готовность WhatsApp Calling",
        eligibility: [
          { label: "Тот же номер", question: "В этом Meta app находится тот же WhatsApp-номер, который уже используется tenant-ом в LeadDrive?", options: ["Да, выбран тот же номер", "Нужно найти правильное Meta app"] },
          { label: "События звонков", question: "Можете редактировать WhatsApp webhook configuration и подписать app на calls events?", options: ["Да, admin-доступ к Meta app готов", "Сначала нужен admin-доступ к Meta app"] },
        ],
        connectTitle: "Подготовить WhatsApp Business Calling",
        connectDesc: "Сначала сохраните WhatsApp API ключи для существующего messaging-канала. Затем подпишите calls в Meta, проверьте один входящий звонок, запросите разрешение клиента и начните один разрешённый исходящий WhatsApp-звонок в Inbox.",
        primary: "Перейти к ключам WhatsApp API",
        secondary: "Назад в каталог",
        note: "Phone Number ID — это не номер, на который звонят. Клиент набирает видимый WhatsApp business номер; LeadDrive использует Phone Number ID только для API-подключения.",
      },
      calls: {
        title: "Calls / VoIP",
        sideDescription: "Twilio, 3CX, Asterisk или SIP для журнала звонков, записей и click-to-call.",
        bodyDescription: "Голосовая инфраструктура настраивается отдельно от каналов сообщений.",
        resources: ["Настройка VoIP-провайдера", "Записи звонков", "История звонков в CRM"],
        tutorial: {
          title: "Calls",
          duration: "2 мин",
          description: "Выберите голосового провайдера и подключите журнал звонков в CRM.",
          steps: ["Выбрать Twilio/3CX/Asterisk/SIP", "Сохранить ключи провайдера", "Включить журнал звонков", "Сделать контролируемый тестовый звонок"],
        },
        eligibilityTitle: "Проверьте готовность VoIP",
        eligibility: [
          { label: "Провайдер", question: "Телефонный провайдер уже есть?", options: ["Да, провайдер есть", "Нужно выбрать"] },
          { label: "Журнал звонков", question: "Нужны записи или расшифровки звонков в CRM?", options: ["Да", "Пока нет"] },
        ],
        connectTitle: "Настроить Calls",
        connectDesc: "Откройте настройки VoIP для Twilio, 3CX, Asterisk или пользовательского SIP.",
        primary: "Открыть настройки VoIP",
        secondary: "Назад в каталог",
        note: "WhatsApp Business Calling отдельно от обычного VoIP и здесь не включается.",
      },
    },
  },
  az: {
    back: "Kanal kataloquna qayıt",
    oauthSuccessTitle: "Kanal qoşuldu",
    oauthSuccessDesc: "Meta {pages} Facebook səhifəsi və {ig} Instagram hesabı qaytardı. Inbox-a çatdığını yoxlamaq üçün hesaba bir mesaj göndərin.",
    oauthPartialTitle: "Bu kanal hələ də qoşulmayıb",
    oauthNoInstagramDesc: "Meta {pages} Facebook səhifəsi qaytardı, Instagram hesabı isə qaytarmadı. Instagram Direct mesajları Instagram BİZNES hesabı bağlanmış Facebook səhifəsi vasitəsilə çatdırılır, ona görə həmin bağlantı olmayana qədər bura heç nə gələ bilməz. Meta Business tənzimləmələrində Instagram biznes hesabını səhifəyə bağlayın və «Meta ilə qoş» addımını yenidən işə salın.",
    oauthNoPageDesc: "Meta girişi tamamladı, amma bu kanal üçün heç bir Facebook səhifəsi qaytarmadı, ona görə mesaj gələ bilməz. «Meta ilə qoş» addımını yenidən işə salın və istifadə edəcəyiniz səhifəni seçin.",
    oauthErrorTitle: "Qoşulma tamamlanmadı",
    oauthErrorDesc: "Meta qaytardı: {code}. Yenidən cəhd edin və ya «Öz Meta tətbiqim var» bölməsini açıb öz açarlarınızı daxil edin.",
    oauthNotDeliveringTitle: "Qoşulub, amma hələ çatdırmır",
    oauthNoChannelRowDesc: "Meta girişi tamamladı, amma bu iş sahəsində hələ də bunun üçün kanal yoxdur — gələn mesajın düşəcəyi yer yoxdur. «Meta ilə qoş» addımını yenidən işə salın; təkrarlanarsa, deməli callback kanalı saxlaya bilməyib.",
    oauthCheckingTitle: "Əslində nəyin qoşulduğunu yoxlayırıq",
    oauthCheckingDesc: "Meta cavab verdi. LeadDrive nəyisə qoşulmuş adlandırmazdan əvvəl saxlanılmış kanalı oxuyur.",
    oauthUnverifiedDesc: "Meta cavab verdi, amma LeadDrive bu iş sahəsinin kanallarını oxuya bilmədi və qoşulmanın işlədiyini təsdiqləyə bilmir. Səhifəni yeniləyin, yenə alınmasa kanal kataloqunu açın.",
    helpBanner: "Kanal qoşmaq üçün kömək lazımdır? Açarları yazmazdan əvvəl aşağıdakı təlimatdan keçin.",
    additionalResources: "Əlavə materiallar",
    videoTutorial: "Addım-addım qoşulma təlimatı",
    watchGuideTitle: "Saxlamazdan əvvəl təlimat lazımdır?",
    watchGuideDesc: "Ekran təlimatını açın: provayder tərəfində nə etmək, LeadDrive-a nə yazmaq və kanalı necə yoxlamaq göstərilir.",
    tutorialPlayerTitle: "İnteraktiv qoşulma təlimatı",
    tutorialPlayerDesc: "Qısa video kimi izləyin: provayderi hazırlayın, yalnız lazım olan LeadDrive sahələrini doldurun və bir təhlükəsiz test edin.",
    tutorialPlayerNow: "İndi göstərilir",
    tutorialPlayerProvider: "Provayder işi",
    tutorialPlayerLeadDrive: "LeadDrive sahələri",
    tutorialPlayerVerify: "Təhlükəsiz test",
    tutorialPlayerFieldMap: "Doldurulacaq sahələr",
    tutorialPlayerOpenFull: "Tam təlimatı aç",
    openGuide: "Təlimatı aç",
    tutorialStepsTitle: "Təlimat nəyi izah edir",
    learnMore: "Ətraflı",
    eligibilityBadge: "Hazırlıq yoxlaması",
    channelSetup: "Kanal qoşulması",
    selectScenario: "Qoşulma ssenarisi",
    selectedScenario: "Seçilmiş ssenari",
    readinessSummary: "Hazırlıq xülasəsi",
    wizardPlanTitle: "Qoşulma planınız",
    wizardPlanDesc: "LeadDrive provayder işini, açarların saxlanmasını və ilk təhlükəsiz testi bir aydın planda saxlayır.",
    wizardScenarioLabel: "Ssenari",
    wizardReadinessLabel: "Hazırlıq cavabları",
    wizardNotAnswered: "Hələ cavab yoxdur",
    wizardEditReadiness: "Hazırlıq yoxlamasını dəyiş",
    wizardProviderLabel: "Provayder",
    wizardLeadDriveLabel: "LeadDrive",
    wizardVerifyLabel: "Yoxlama",
    currentChoice: "Cari cavab",
    readinessQuestionTitle: "Açarları yazmazdan əvvəl cavab verin",
    readinessQuestionDesc: "Bu yoxlama yarımçıq qoşulmuş kanalın saxlanmasının qarşısını alır. Giriş yoxdursa burada dayanın və provayder sahibindən giriş istəyin.",
    readinessProgress: "Hazırlıq prosesi",
    readinessWhyTitle: "Bu niyə vacibdir",
    readinessWhyDesc: "LeadDrive açarları saxlaya bilər, amma canlı inbox trafiki yalnız provayder girişi, webhook qurulumu və bir nəzarətli test təsdiqləndikdən sonra işləyir.",
    readinessNextTitle: "Bu yoxlamadan sonra",
    readinessNextDesc: "Bu kanal üçün kilidlənmiş açar formasına keçəcəksiniz. Bu ekrandan canlı müştəri trafiki göndərilmir.",
    nextActionTitle: "Növbəti addım",
    quickStartTitle: "Buradan başlayın",
    quickStartDesc: "Seçilmiş kanal üçün ən qısa təhlükəsiz yol. Canlı müştəri trafikinə keçməzdən əvvəl addımları ardıcıllıqla edin.",
    quickStartProvider: "1. Provayder",
    quickStartProviderDesc: "Bu provayder panelini açın və əvvəl hesabı və ya göndərəni hazırlayın.",
    quickStartFields: "2. LeadDrive sahələri",
    quickStartFieldsDesc: "Bu sahələri seçilmiş kanal üçün kilidlənmiş LeadDrive formasına daxil edin.",
    quickStartVerify: "3. Təhlükəsiz yoxlama",
    quickStartVerifyDesc: "Canlı istifadədən əvvəl bir nəzarətli test edin.",
    quickStartGuideAction: "Təlimatı göstər",
    quickStartFormAction: "Formaya keç",
    operatorNextTitle: "İndi nə etməli",
    operatorNextDesc: "Bu checklist-i kanal üçün operator yolu kimi istifadə edin. Provayder işi, LeadDrive açarları və final yoxlamanı ayırır.",
    operatorStepProviderTitle: "Provayderi açın",
    operatorStepProviderDesc: "Əvvəl xarici hesab, Page, inbox, göndərən və ya telefon nömrəsini hazırlayın.",
    operatorStepLeadDriveTitle: "LeadDrive sahələrini doldurun",
    operatorStepLeadDriveDesc: "Yalnız seçilmiş kanalın açarlarını saxlayın. Kanal tipi artıq kilidlənib.",
    operatorStepVerifyTitle: "Bir təhlükəsiz test edin",
    operatorStepVerifyDesc: "Canlı trafikdən əvvəl bir nəzarətli inbound event göndərin və Inbox-da göründüyünü yoxlayın.",
    operatorPrimaryAction: "Aşağıda davam et",
    operatorExternalAction: "Quraşdırmanı aç",
    operatorVerifyAction: "Yoxlamaya bax",
    faqTitle: "Tez-tez verilən suallar",
    faqDesc: "Kanalı saxlamazdan əvvəl operator üçün qısa cavablar.",
    connectionMapTitle: "Bu qoşulma necə işləyir",
    connectionMapDesc: "Hər provayder üçün eyni ardıcıllıq: xarici hesabı hazırlayın, LeadDrive-da yalnız seçilmiş kanalı saxlayın, sonra canlı istifadədən əvvəl bir nəzarətli dialoq yoxlayın.",
    providerWorkTitle: "Provayder tərəfi",
    providerWorkDesc: "LeadDrive-dan kənarda hesab, səhifə, inbox, göndərən, bot, mailbox və ya telefon provayderini yaradın və yoxlayın.",
    leadDriveWorkTitle: "LeadDrive tərəfi",
    leadDriveWorkDesc: "Yalnız seçilmiş kanal üçün dəqiq açarları yazın. Aşağıdakı forma kilidlənib, kanal tipi təsadüfən dəyişə bilməz.",
    validationWorkTitle: "Yoxlama",
    validationWorkDesc: "Canlı trafikdən əvvəl bir nəzarətli gələn mesaj, email, SMS və ya zəng göndərin və Inbox-u yoxlayın.",
    credentialsRequired: "Nə hazırlamaq lazımdır",
    verificationRequired: "Necə yoxlamaq lazımdır",
    nextActionInlineFormHint: "Bu səhifədəki kilidlənmiş formanı doldurun. Kanal tipi artıq seçilib, operator onu yenidən axtarmalı deyil.",
    nextActionExternalHint: "Aşağıdakı xüsusi parametrlər səhifəsini açın. Bu kanal ümumi açar forması ilə deyil, öz bölməsində qurulur.",
    setupOutcomeTitle: "Sonra nə olacaq",
    setupOutcomeDesc: "LeadDrive yalnız seçilmiş quraşdırmanı açır və bu kanalın açarlarını saxlayır. Yoxlama addımı edilməyincə canlı müştəri trafiki göndərilmir.",
    whatsappCallingSmokeTitle: "Real zəngsiz CRM testi",
    whatsappCallingSmokeDesc: "CRM daxilində test gedən WhatsApp zəngi yaradın ki, admin real Meta zəngindən əvvəl Inbox routing, icazə vəziyyəti, zəng jurnalı, live popup və idarə düymələrini yoxlasın.",
    whatsappCallingSmokeButton: "Gedən test zəngi yarat",
    whatsappCallingSmokeRunning: "Test zəngi yaradılır...",
    whatsappCallingSmokeSuccess: "Gedən test zəngi Inbox-da aktivdir",
    whatsappCallingSmokeFailed: "LeadDrive WhatsApp Calling testini yarada bilmədi.",
    whatsappCallingSmokeOpenInbox: "Zəngi Inbox-da aç",
    whatsappCallingSmokeNoExternal: "Real WhatsApp zəngi yaradılmır. Yalnız LeadDrive routing, zəng jurnalı, müvəqqəti media sessiya və Inbox düymələri yoxlanır.",
    whatsappCallingSmokeMetaReminder: "Bu test keçdikdən sonra real WhatsApp müştərisindən icazə alın və app.leaddrivecrm.org üzərində Meta çatdırılmasını təsdiqləmək üçün bir approved outbound WhatsApp zəngi edin.",
    whatsappCallingWebhookTitle: "Meta zəng webhook-u",
    whatsappCallingWebhookCallback: "Callback URL",
    whatsappCallingWebhookVerify: "Verify token",
    whatsappCallingWebhookSubscribe: "Abunə hadisəsi",
    whatsappCallingWebhookHint: "Bu callback-i həmin tenant üçün Meta Webhooks-a kopyalayın və WhatsApp app-i calls events üçün abunə edin. Verify token və app secret saxlanmış WhatsApp Business API kanalı ilə eyni olmalıdır.",
    whatsappCallingTenantFallback: "Tenant slug girişdən sonra görünəcək",
    newAccount: "Yeni hesab yaradıb qoş",
    newAccountDesc: "Yeni provayder hesabı, səhifə, inbox və ya nömrə qurursunuzsa.",
    existingAccount: "Mövcud hesabı qoş",
    existingAccountDesc: "Provider hesabı artıq var və açarlar hazırdırsa.",
    getStarted: "Başla",
    skip: "Yoxlamanı keç",
    next: "İrəli",
    previous: "Geri",
    yesContinue: "Bəli, giriş var",
    createLater: "Sonra yaradacağam",
    continueManual: "Açar formasına keç",
    closeTutorial: "Təlimatı bağla",
    startSetupFromTutorial: "Hazırlıq yoxlamasına başla",
    resourceAction: "Ekran təlimatını aç",
    tutorialPreviewTitle: "Ekran təlimatı",
    tutorialProviderSide: "Provider tərəfi",
    tutorialLeadDriveSide: "LeadDrive qurulumu",
    processTitle: "Qoşulma yolu",
    stepIntro: "İcmal",
    stepEligibility: "Hazırlıq yoxlaması",
    stepConnect: "Açarlar",
    readyBeforeTitle: "Başlamazdan əvvəl hazırlayın",
    afterConnectTitle: "Saxladıqdan sonra",
    guideFooter: "Addım-addım təlimat lazımdırsa, bu kanal üçün Yardım mərkəzini açın.",
    notFoundTitle: "Kanal təlimatı tapılmadı",
    notFoundDesc: "Kataloqa qayıdın və dəstəklənən kanal seçin.",
    guides: {
      whatsapp: {
        title: "WhatsApp Business Platform (API)",
        sideDescription: "WhatsApp Business API Meta vasitəsilə qoşulur: inbox cavabları, təsdiqlənmiş şablonlar və bildirişlər.",
        bodyDescription: "LeadDrive Meta ardıcıllığını izləyir: nömrə hazırdır, Business Manager girişi var, sonra açarlar və webhook qurulur.",
        badge: "Populyar",
        resources: ["WhatsApp Business Platform (API) üçün əsaslar", "WhatsApp qiymətləri", "Meta webhook checklist"],
        tutorial: {
          title: "WhatsApp Business Platform (API) necə qoşulur",
          duration: "1:45",
          description: "WABA, telefon nömrələri, Meta Business Manager və API yolunun mobil WhatsApp Business-dən fərqi.",
          steps: ["Yeni və ya mövcud WABA seçin", "Nömrənin hazır olduğunu yoxlayın", "Meta Business Manager girişini yoxlayın", "Meta ilə qoşun və ya Cloud API açarlarını yazın"],
        },
        eligibilityTitle: "Sadə hazırlıq yoxlamasından başlayaq",
        eligibility: [
          { label: "Telefon nömrəsi", question: "SMS qəbul edə bilən telefon nömrəniz var?", options: ["WhatsApp-a bağlı olmayan yeni nömrəm var", "Nömrə şəxsi WhatsApp hesabına bağlıdır", "Yeni nömrəm yoxdur"] },
          { label: "Meta Business Manager girişi", question: "Şirkətin Meta Business Manager hesabına girişiniz var?", info: "WABA yaratmaq üçün müştəriyə görünən şirkət adı, hüquqi şirkət adı və rəsmi ünvan lazımdır.", options: ["Bəli, admin girişim var", "Sonra yaradacağam"] },
        ],
        connectTitle: "WhatsApp Business Platform (API) qoş",
        connectDesc: "Sonra bu tenant üçün Meta Cloud API açarlarını yazın. Daxili Meta qeydiyyatı sonradan bu səhifənin arxitekturasını dəyişmədən əlavə oluna bilər.",
        primary: "WhatsApp açarları formasına keç",
        secondary: "Keç və hazır açarları yaz",
        note: "Bu WhatsApp mesajlaşma açarlarını saxlayır. Zənglər üçün Kanallar -> Zənglər -> WhatsApp Business Calling bölməsinə qayıdın və Meta calls checklist-ini tamamlayın.",
      },
      tiktok: {
        title: "TikTok Chatwoot vasitəsilə",
        sideDescription: "TikTok DM-ləri Chatwoot vasitəsilə qoşulur. Chatwoot nəqliyyat qatı olaraq qalır, LeadDrive dialoqu TikTok kimi göstərir.",
        bodyDescription: "TikTok burada LeadDrive-a birbaşa qoşulmur. Əvvəl Chatwoot-da TikTok inbox yaradın, sonra Chatwoot açarlarını yazın.",
        badge: "Chatwoot",
        resources: ["Chatwoot-da TikTok inbox yarat", "Chatwoot API token", "LeadDrive webhook uyğunluğu"],
        tutorial: {
          title: "TikTok Chatwoot vasitəsilə",
          duration: "3 dəq",
          description: "Kanal Chatwoot nəqliyyat qatı və LeadDrive inbox marşrutlaşdırması kimi işləyir; operatorlar TikTok-u ayrıca dialoq tipi kimi görür.",
          steps: ["Chatwoot-da TikTok inbox yaradın və ya seçin", "Chatwoot base URL, account ID və token-i kopyalayın", "LeadDrive-da TikTok via Chatwoot kimi saxlayın", "Bir TikTok DM göndərin və Inbox-da yoxlayın"],
        },
        eligibilityTitle: "Əvvəl Chatwoot hazırlığını yoxlayın",
        eligibility: [
          { label: "TikTok inbox", question: "TikTok kanalı artıq Chatwoot-da qoşulub?", options: ["Bəli, TikTok inbox Chatwoot-da var", "Əvvəl yaratmalıyam"] },
          { label: "Chatwoot API girişi", question: "Chatwoot base URL, account ID, access token və webhook secret hazırdır?", options: ["Bəli, açarlar hazırdır", "Sonra toplayacağam"] },
        ],
        connectTitle: "TikTok-u Chatwoot vasitəsilə qoş",
        connectDesc: "Açar formasına keçin və bunu TikTok provayderli Chatwoot kanalı kimi saxlayın.",
        primary: "Chatwoot açarları formasına keç",
        secondary: "Keç və açarları yaz",
        note: "TikTok-u birbaşa TikTok API kanalı kimi qurmayın; LeadDrive TikTok nəqliyyat qatı kimi Chatwoot gözləyir.",
      },
      facebook: {
        title: "Facebook Messenger",
        sideDescription: "Messenger tenantın öz Meta tətbiqi və Facebook Page-i ilə qoşulur.",
        bodyDescription: "Ən təhlükəsiz ardıcıllıq: əvvəl Meta tətbiq girişi, sonra səhifə və mesajlaşma icazələri, sonra LeadDrive açarları.",
        badge: "Meta",
        resources: ["Meta tətbiq qurulması", "Page messaging icazələri", "Webhook yoxlaması"],
        tutorial: {
          title: "Facebook Messenger necə qoşulur",
          duration: "3 dəq",
          description: "Kanalı saxlamazdan əvvəl Meta tətbiq, səhifə icazələri və webhook hazırlayın.",
          steps: ["Tenant Meta tətbiqini seçin", "Facebook Page seçin", "pages_messaging və webhook icazələrini verin", "Saxlayın və bir gələn mesajla yoxlayın"],
        },
        eligibilityTitle: "Messenger girişini yoxlayın",
        eligibility: [
          { label: "Facebook Page", question: "Mesajları qəbul edəcək Facebook Page-in adminisiniz?", options: ["Bəli, admin girişim var", "Əvvəl giriş almalıyam"] },
          { label: "Meta tətbiq", question: "Öz Meta tətbiqiniz var?", options: ["Xeyr — LeadDrive qoşulmasından istifadə edirəm", "Bəli, öz Meta tətbiqim var"] },
        ],
        connectTitle: "Facebook Messenger qoş",
        connectDesc: "«Meta ilə qoş» düyməsini basın, daxil olun və səhifəni seçin. Açarlar yalnız öz Meta tətbiqiniz varsa lazımdır.",
        primary: "Qoşulmaya keç",
        secondary: "Öz Meta tətbiqimin parametrlərini aç",
        note: "Meta dialoqunda mesajlaşma icazələri verilməlidir — onlarsız səhifə qoşulur, amma DM-lər Inbox-a düşmür.",
      },
      instagram: {
        title: "Instagram Direct",
        sideDescription: "Instagram Direct Facebook Page və ya ayrıca Instagram Login yolu ilə qoşulur.",
        bodyDescription: "Əvvəl hesab modelini seçin: Facebook Page-ə bağlı hesab və ya Page olmayan hesab üçün Instagram Login.",
        badge: "Meta",
        resources: ["Instagram business qurulması", "Instagram Login yolu", "DM icazə checklist-i"],
        tutorial: {
          title: "Instagram Direct necə qoşulur",
          duration: "3 dəq",
          description: "Instagram açarlarını saxlamazdan əvvəl düzgün Meta yolunu hazırlayın.",
          steps: ["Facebook Page və ya Instagram Login yolu seçin", "Instagram business account olduğunu yoxlayın", "Mesajlaşma icazələrini verin", "Gələn DM göndərin və Inbox-da yoxlayın"],
        },
        eligibilityTitle: "Instagram modelini yoxlayın",
        eligibility: [
          { label: "Hesab tipi", question: "Instagram hesabı business/professional hesabdır?", options: ["Bəli, business/professional-dır", "Əvvəl çevirməliyəm"] },
          { label: "Meta tətbiq", question: "Öz Meta tətbiqiniz var?", options: ["Xeyr — LeadDrive qoşulmasından istifadə edirəm", "Bəli, öz Meta tətbiqim var"] },
        ],
        connectTitle: "Instagram Direct qoş",
        connectDesc: "«Meta ilə qoş» düyməsini basın və Instagram hesabına bağlı Facebook səhifəsini seçin. Instagram Direct həmin səhifə vasitəsilə gəlir.",
        primary: "Qoşulmaya keç",
        secondary: "Öz Meta tətbiqimin parametrlərini aç",
        note: "Instagram Direct bağlı Facebook səhifəsinin webhook-u ilə gəlir, ona görə Meta dialoqunda məhz həmin səhifəni seçin. Instagram Login yalnız bağlı səhifəsi olmayan hesablar üçündür.",
      },
      telegram: {
        title: "Telegram Bot",
        sideDescription: "Realtime inbox dialoqları üçün Telegram bot qoşun.",
        bodyDescription: "BotFather ilə bot yaradın, token-i kopyalayın və LeadDrive-da saxlayın.",
        resources: ["BotFather token", "Webhook yoxlaması", "Gələn mesaj testi"],
        tutorial: {
          title: "Telegram Bot necə qoşulur",
          duration: "2 dəq",
          description: "İlk gələn mesaj Inbox-a düşməzdən əvvəl qısa bot-token qurulması.",
          steps: ["BotFather-də bot yaradın və ya seçin", "Bot token-i kopyalayın", "Telegram kanalını saxlayın", "Bir mesaj göndərin və marşrutlaşdırmanı yoxlayın"],
        },
        eligibilityTitle: "Telegram bot hazırlığını yoxlayın",
        eligibility: [
          { label: "Bot var", question: "Telegram bot token artıq hazırdır?", options: ["Bəli, token hazırdır", "Bot yaratmalıyam"] },
          { label: "Test chat", question: "Saxladıqdan sonra bota test mesajı göndərə biləcəksiniz?", options: ["Bəli", "Sonra yoxlayacağam"] },
        ],
        connectTitle: "Telegram Bot qoş",
        connectDesc: "Bot token-i yazın və kanalı saxlayın. Sonra bir gələn mesajla marşrutlaşdırmanı yoxlayın.",
        primary: "Telegram açarları formasına keç",
        secondary: "Keç və token-i yaz",
        note: "Şəxsi Telegram hesabını istifadə etməyin; LeadDrive Bot token gözləyir.",
      },
      vkontakte: {
        title: "VKontakte",
        sideDescription: "VK mesajları digər omni-channel kanalları ilə eyni LeadDrive inbox marşrutlaşdırma modelinə qoşulur.",
        bodyDescription: "Əvvəl VK community/app girişini hazırlayın, sonra token və webhook parametrlərini LeadDrive-da saxlayın.",
        resources: ["VK community girişi", "VK API token", "Webhook yoxlaması"],
        tutorial: {
          title: "VKontakte necə qoşulur",
          duration: "2 dəq",
          description: "VK community mesajları ümumi inbox-a düşməzdən əvvəl qısa hazırlıq.",
          steps: ["VK community admin girişini yoxlayın", "VK API token-i kopyalayın", "VKontakte kanalını saxlayın", "Gələn VK mesajı göndərin və marşrutlaşdırmanı yoxlayın"],
        },
        eligibilityTitle: "VKontakte hazırlığını yoxlayın",
        eligibility: [
          { label: "Community girişi", question: "Müştəri mesajlarını qəbul edəcək VK community-ni idarə edirsiniz?", options: ["Bəli, admin girişim var", "Əvvəl community girişi lazımdır"] },
          { label: "API token", question: "VK token və webhook parametrləri hazırdır?", options: ["Bəli, açarlar hazırdır", "Sonra toplayacağam"] },
        ],
        connectTitle: "VKontakte qoş",
        connectDesc: "VK token və webhook parametrlərini saxlamaq üçün davam edin.",
        primary: "VK açarları formasına keç",
        secondary: "Keç və VK token-i yaz",
        note: "Community/app token istifadə edin. Şəxsi VK loginləri LeadDrive-a yazılmamalıdır.",
      },
      smsAtl: {
        title: "ATL SMS",
        sideDescription: "Azərbaycan üçün ATL SMS çatdırılması LeadDrive-da əsas SMS provayderidir.",
        bodyDescription: "Saxlamazdan əvvəl ATL göndərənini və API açarlarını təsdiqləyin ki, SMS provayder seçimi qarışmasın.",
        badge: "Əsas",
        resources: ["ATL göndərən profili", "ATL API açarları", "Nəzarətli SMS testi"],
        tutorial: {
          title: "ATL SMS necə qoşulur",
          duration: "2 dəq",
          description: "Test SMS göndərməzdən əvvəl ATL açarlarını və göndərən adını hazırlayın.",
          steps: ["ATL login və göndərən adını təsdiqləyin", "API açarlarını kopyalayın", "LeadDrive-da ATL SMS saxlayın", "Bir nəzarətli test SMS göndərin"],
        },
        eligibilityTitle: "ATL SMS hazırlığını yoxlayın",
        eligibility: [
          { label: "ATL hesabı", question: "ATL göndərən hesabı təsdiqlənib?", options: ["Bəli, ATL hesabı hazırdır", "Əvvəl ATL təsdiqi lazımdır"] },
          { label: "Açarlar", question: "ATL login, password/API secret və göndərən adı var?", options: ["Bəli, açarlar hazırdır", "Sonra toplayacağam"] },
        ],
        connectTitle: "ATL SMS qoş",
        connectDesc: "ATL-i SMS provayder kimi saxlayın. Azərbaycan üçün əsas olaraq bunu istifadə edirik.",
        primary: "ATL açarları formasına keç",
        secondary: "Keç və ATL açarlarını yaz",
        note: "Başqa ölkələr üçün Twilio/Vonage ehtiyat marşrutu istifadə edin; ATL lokal SMS provayder olaraq qalır.",
      },
      smsProvider: {
        title: "SMS provayder",
        sideDescription: "ATL bu tenant üçün uyğun deyilsə, beynəlxalq SMS provayder qoşun.",
        bodyDescription: "LeadDrive Azərbaycan üçün ATL-i əsas SMS provayder saxlayır; Twilio/Vonage başqa bazarlar üçündür.",
        resources: ["Sender ID təsdiqi", "Provayder API açarları", "Nəzarətli SMS testi"],
        tutorial: {
          title: "SMS provayder necə qoşulur",
          duration: "2 dəq",
          description: "Test SMS-dən əvvəl provayder açarlarını və göndərən təsdiqini hazırlayın.",
          steps: ["Twilio və ya Vonage seçin", "Sender ID təsdiqini yoxlayın", "Provayder açarlarını saxlayın", "Bir nəzarətli test SMS göndərin"],
        },
        eligibilityTitle: "SMS provayder hazırlığını yoxlayın",
        eligibility: [
          { label: "Provayder hesabı", question: "SMS provayder hesabı bu göndərən və ölkə üçün təsdiqlənib?", options: ["Bəli, provayder hesabı hazırdır", "Əvvəl provayder təsdiqi lazımdır"] },
          { label: "Açarlar", question: "API key/secret və göndərən parametrləri hazırdır?", options: ["Bəli, açarlar hazırdır", "Sonra toplayacağam"] },
        ],
        connectTitle: "SMS provayder qoş",
        connectDesc: "Provayderi saxlayın. Azərbaycan tenant-ları üçün xüsusi səbəb yoxdursa ATL istifadə edin.",
        primary: "SMS açarları formasına keç",
        secondary: "Keç və SMS açarlarını yaz",
        note: "SMS real xarici mesaj göndərir. Canlı kampaniyaları aktiv etməzdən əvvəl nəzarətli test nömrəsi istifadə edin.",
      },
      googleWorkspace: {
        title: "Google Workspace",
        sideDescription: "Google Workspace mailbox-ları SMTP/IMAP açarları ilə qoşulur.",
        bodyDescription: "Əvvəl mailbox/admin girişini hazırlayın, sonra email açarlarını saxlayın.",
        resources: ["Google Admin girişi", "Mailbox təhlükəsizliyi", "Email yönləndirmə testi"],
        tutorial: {
          title: "Google Workspace Email necə qoşulur",
          duration: "2 dəq",
          description: "Mailbox kanalını saxlamazdan əvvəl admin/security parametrlərini yoxlayın.",
          steps: ["Google Workspace admin policy yoxlayın", "App password və ya SMTP access hazırlayın", "Mailbox açarlarını saxlayın", "Bir test email göndərin və qəbul edin"],
        },
        eligibilityTitle: "Mailbox hazırlığını yoxlayın",
        eligibility: [
          { label: "Mailbox", question: "Müştəri mesajlarını qəbul edəcək mailbox hazırdır?", options: ["Bəli, mailbox hazırdır", "Yaratmalıyam"] },
          { label: "Təhlükəsizlik", question: "SMTP/app password access icazəlidir?", options: ["Bəli, giriş icazəlidir", "Admin təsdiqi lazımdır"] },
        ],
        connectTitle: "Google Workspace qoş",
        connectDesc: "Mailbox açarlarını saxlayın və bir gələn email ilə yoxlayın.",
        primary: "Email açarları formasına keç",
        secondary: "Keç və SMTP açarlarını yaz",
        note: "Email cavabları SMTP/IMAP provayder parametrlərindən asılıdır; canlı istifadədən əvvəl nəzarətli email ilə yoxlayın.",
      },
      websiteChat: {
        title: "Veb-çat",
        sideDescription: "LeadDrive sayt vidceti: açılış düyməsi, AI-dan operatora ötürmə və eskalasiya qaydaları.",
        bodyDescription: "Veb-çat ayrıca parametrlər səhifəsi istifadə edir, çünki burada yalnız açarlar deyil, vidcetin davranışı da qurulur.",
        resources: ["Vidcet parametrləri", "AI-dan operatora ötürmə", "Eskalasiya qaydaları"],
        tutorial: {
          title: "Veb-çat necə qurulur",
          duration: "2 dəq",
          description: "Vidcetin davranışını qurun və saytdan test edin.",
          steps: ["Veb-çat parametrlərini açın", "Açılış düyməsini və salamlamanı qurun", "Operatora ötürmə və eskalasiya qurun", "Bir test veb-çat mesajı göndərin"],
        },
        eligibilityTitle: "Veb-çat hazırlığını yoxlayın",
        eligibility: [
          { label: "Sayt girişi", question: "LeadDrive vidcet kodunu sayta əlavə edə və ya yeniləyə bilərsiniz?", options: ["Bəli, sayt girişi var", "Developer girişi lazımdır"] },
          { label: "Marşrutlaşdırma", question: "Veb-çat dialoqları hansı komandaya düşməlidir bilirsiniz?", options: ["Bəli", "Sonra quracağam"] },
        ],
        connectTitle: "Veb-çat qur",
        connectDesc: "Vidceti qurmaq üçün ayrıca veb-çat parametrlər səhifəsini açın.",
        primary: "Veb-çat parametrlərini aç",
        secondary: "Kataloqa qayıt",
        note: "Bu kanal universal açar forması deyil, vidcet parametrləri istifadə edir.",
      },
      customWebhook: {
        title: "Fərdi webhook kanalı",
        sideDescription: "LeadDrive-da ayrıca kartı olmayan provayderi İnteqrasiyalar bölməsi ilə qoşun.",
        bodyDescription: "Bu yol İnteqrasiyalar bölməsini açmazdan əvvəl adminin nə hazırlamalı olduğunu izah edir: provayder hadisə tipi, webhook sirri, payload nümunəsi və bir nəzarətli inbound test.",
        badge: "Webhook",
        resources: ["Provayder webhook sənədləri", "Payload nümunəsi", "Nəzarətli inbound test"],
        tutorial: {
          title: "Fərdi webhook kanalı necə qoşulur",
          duration: "2 dəq",
          description: "Webhook əsaslı provayder bağlantısını hazırlayın, hadisələri LeadDrive-a map edin və canlı marşrutlaşdırmadan əvvəl bir inbound event yoxlayın.",
          steps: ["Provayderin webhook parametrlərini açın", "LeadDrive İnteqrasiyalar bölməsində endpoint yaradın", "Kanal, kontakt və mesaj sahələrini map edin", "Nəzarətli inbound event göndərin və Inbox-da yoxlayın"],
        },
        eligibilityTitle: "Fərdi inteqrasiya hazırlığını yoxlayın",
        eligibility: [
          { label: "Provayder webhook", question: "Provayder yeni mesajlar və ya çat hadisələri üçün outbound webhook göndərə bilir?", options: ["Bəli, webhook hadisələri mövcuddur", "Əvvəl provayder sənədləri lazımdır"] },
          { label: "Payload nümunəsi", question: "Payload nümunəsi və yoxlama üçün secret/signature qaydası var?", options: ["Bəli, nümunə və secret hazırdır", "Sonra toplayacağam"] },
        ],
        connectTitle: "Fərdi webhook kanalını qoş",
        connectDesc: "İnteqrasiyalar bölməsini açın, webhook endpoint yaradın, inbound payload-u map edin və müştəri trafikinə keçməzdən əvvəl nəzarətli test edin.",
        primary: "İnteqrasiyaları aç",
        secondary: "Kataloqa qayıt",
        note: "Bunu yalnız ayrıca kanal kartı olmayan provayderlər üçün istifadə edin. WhatsApp, Facebook, Instagram, Telegram, SMS və email öz təlimatları ilə qoşulmalıdır.",
      },
      whatsappCalling: {
        title: "WhatsApp Business Calling",
        sideDescription: "Inbox-da artıq mesaj qəbul edən eyni Cloud API nömrəsi üçün live WhatsApp zənglərini aktiv edin.",
        bodyDescription: "Bu ayar inbound zəngləri və müştəri icazəli outbound zəngləri aktiv edir. Müştəri WhatsApp business nömrəsinə zəng edə bilər, operator isə WhatsApp call permission istəyib Inbox-dan outbound live zəng başlada bilər.",
        badge: "Calling",
        resources: ["Düzgün Meta app və App Secret", "LeadDrive callback və verify token", "Inbox-da inbound və icazəli outbound zəng testi"],
        tutorial: {
          title: "WhatsApp Business Calling necə hazırlanır",
          duration: "3 dəq",
          description: "Düzgün Meta app-i qoşun, calls events abunəliyini edin və real davranışı yoxlayın: bir inbound zəngi cavablayın və müştəri WhatsApp-da icazə verdikdən sonra bir outbound zəng başladın.",
          steps: ["LeadDrive-da saxlanan WhatsApp Phone Number ID-nin olduğu Meta app-i açın", "App settings -> Basic-dən App Secret-i kopyalayıb WhatsApp API kanalında saxlayın", "LeadDrive callback və verify token-i Meta Webhooks-a yazın, sonra calls event-ə abunə olun", "Inbox-da bir inbound zəngi cavablayın, sonra icazə istəyib bir icazəli outbound zəng başladın"],
        },
        eligibilityTitle: "WhatsApp Calling hazırlığını yoxlayın",
        eligibility: [
          { label: "Eyni nömrə", question: "Bu Meta app-də LeadDrive tenant-ının artıq istifadə etdiyi eyni WhatsApp nömrəsi var?", options: ["Bəli, eyni nömrə seçilib", "Düzgün Meta app-i tapmalıyam"] },
          { label: "Calls events", question: "WhatsApp webhook configuration-u redaktə edib app-i calls events-ə abunə edə bilərsiniz?", options: ["Bəli, Meta app admin girişi hazırdır", "Əvvəl Meta app admin girişi lazımdır"] },
        ],
        connectTitle: "WhatsApp Business Calling hazırla",
        connectDesc: "Əvvəl mövcud messaging kanalı üçün WhatsApp API açarlarını saxlayın. Sonra Meta-da calls abunəliyini edin, bir inbound zəngi test edin, müştəri icazəsi istəyin və Inbox-da bir icazəli outbound WhatsApp zəngi başladın.",
        primary: "WhatsApp API açarları formasına keç",
        secondary: "Kataloqa qayıt",
        note: "Phone Number ID zəng edilən nömrə deyil. Müştəri görünən WhatsApp business nömrəsini yığır; LeadDrive Phone Number ID-ni yalnız API qoşulması üçün istifadə edir.",
      },
      calls: {
        title: "Calls / VoIP",
        sideDescription: "Zəng jurnalı, qeydlər və click-to-call üçün Twilio, 3CX, Asterisk və ya SIP qoşun.",
        bodyDescription: "Səs infrastrukturu messaging kanallarından ayrıca qurulur.",
        resources: ["VoIP provayder qurulması", "Zəng qeydləri", "CRM zəng tarixi"],
        tutorial: {
          title: "Calls necə qurulur",
          duration: "2 dəq",
          description: "Voice provider seçin və zəng jurnalını CRM-ə qoşun.",
          steps: ["Twilio/3CX/Asterisk/SIP seçin", "Provayder açarlarını saxlayın", "Zəng jurnalını aktiv edin", "Bir nəzarətli test zəngi edin"],
        },
        eligibilityTitle: "VoIP hazırlığını yoxlayın",
        eligibility: [
          { label: "Provayder", question: "Telephony provider artıq var?", options: ["Bəli, provider var", "Seçməliyəm"] },
          { label: "Zəng jurnalı", question: "CRM-də recordings/transcripts lazımdır?", options: ["Bəli", "Hələ yox"] },
        ],
        connectTitle: "Calls qur",
        connectDesc: "Twilio, 3CX, Asterisk və ya custom SIP qoşmaq üçün VoIP parametrlərini açın.",
        primary: "VoIP parametrlərini aç",
        secondary: "Kataloqa qayıt",
        note: "WhatsApp Business Calling adi VoIP-dən ayrıdır və burada aktiv edilmir.",
      },
    },
  },
} as const

function localeKey(locale: string): Loc {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

function connectStageFromParam(stage: string | null): ConnectStage | null {
  if (stage === "intro" || stage === "eligibility" || stage === "connect") return stage
  return null
}

interface GuideRouteOverride {
  title?: string
  sideDescription?: string
  bodyDescription?: string
  resources?: string[]
  tutorialTitle?: string
  tutorialDescription?: string
  connectTitle?: string
  connectDescription?: string
}

interface GuideSource {
  title: string
  sideDescription: string
  bodyDescription: string
  badge?: string
  resources: readonly string[]
  tutorial: {
    title: string
    duration: string
    description: string
    steps: readonly string[]
  }
  eligibilityTitle: string
  eligibility: ReadonlyArray<{
    label: string
    question: string
    options: readonly string[]
    info?: string
  }>
  connectTitle: string
  connectDesc: string
  primary: string
  secondary: string
  note: string
}

function guideOverrideForRoute(normalized: string, loc: Loc): GuideRouteOverride {
  const byRoute: Record<string, Record<Loc, GuideRouteOverride>> = {
    gmail: {
      en: {
        title: "Gmail",
        sideDescription: "Connect a Gmail mailbox through SMTP/app password access.",
        bodyDescription: "Prepare the Gmail account, app password or SMTP access, then verify one inbound and outbound email.",
        resources: ["Gmail app password", "SMTP access", "Controlled email test"],
        tutorialTitle: "Using Gmail",
        tutorialDescription: "Prepare Gmail security settings before saving the mailbox channel.",
        connectTitle: "Connect Gmail",
        connectDescription: "Continue to save the Gmail mailbox credentials and verify one controlled email.",
      },
      ru: {
        title: "Gmail",
        sideDescription: "Подключение Gmail mailbox через SMTP/app password.",
        bodyDescription: "Подготовьте Gmail account, app password или SMTP access, затем проверьте один входящий и исходящий email.",
        resources: ["Gmail app password", "SMTP access", "Контролируемый email-тест"],
        tutorialTitle: "Gmail",
        tutorialDescription: "Подготовьте security settings Gmail перед сохранением mailbox-канала.",
        connectTitle: "Подключить Gmail",
        connectDescription: "Дальше сохраните ключи Gmail mailbox и проверьте один контролируемый email.",
      },
      az: {
        title: "Gmail",
        sideDescription: "Gmail mailbox-u SMTP/app password ilə qoşun.",
        bodyDescription: "Gmail hesabı, app password və ya SMTP access hazırlayın, sonra bir gələn və bir gedən email yoxlayın.",
        resources: ["Gmail app password", "SMTP access", "Nəzarətli email testi"],
        tutorialTitle: "Gmail",
        tutorialDescription: "Mailbox kanalını saxlamazdan əvvəl Gmail security settings hazırlayın.",
        connectTitle: "Gmail qoş",
        connectDescription: "Gmail mailbox açarlarını saxlayın və bir nəzarətli email yoxlayın.",
      },
    },
    "other-email": {
      en: {
        title: "Other Email / SMTP",
        sideDescription: "Connect any SMTP/IMAP-capable mailbox when Google Workspace is not the provider.",
        bodyDescription: "Prepare host, port, encryption mode, mailbox login and app password before saving.",
        resources: ["SMTP host and port", "Mailbox login", "Forwarding/inbound test"],
        tutorialTitle: "Using Other Email / SMTP",
        tutorialDescription: "Map your provider SMTP settings into LeadDrive before testing delivery.",
        connectTitle: "Connect Other Email",
        connectDescription: "Continue to save SMTP credentials and verify one inbound email.",
      },
      ru: {
        title: "Other Email / SMTP",
        sideDescription: "Подключение любого SMTP/IMAP mailbox, когда провайдер не Google Workspace.",
        bodyDescription: "Подготовьте host, port, encryption mode, mailbox login и app password до сохранения.",
        resources: ["SMTP host и port", "Mailbox login", "Проверка forwarding/inbound"],
        tutorialTitle: "Other Email / SMTP",
        tutorialDescription: "Сопоставьте SMTP settings провайдера с полями LeadDrive перед тестом доставки.",
        connectTitle: "Подключить Other Email",
        connectDescription: "Дальше сохраните SMTP-ключи и проверьте один входящий email.",
      },
      az: {
        title: "Other Email / SMTP",
        sideDescription: "Google Workspace olmayan SMTP/IMAP mailbox qoşulması.",
        bodyDescription: "Saxlamazdan əvvəl host, port, encryption mode, mailbox login və app password hazırlayın.",
        resources: ["SMTP host və port", "Mailbox login", "Forwarding/inbound testi"],
        tutorialTitle: "Other Email / SMTP",
        tutorialDescription: "Çatdırılma testindən əvvəl provayder SMTP settings-i LeadDrive sahələrinə uyğunlaşdırın.",
        connectTitle: "Other Email qoş",
        connectDescription: "SMTP açarlarını saxlayın və bir gələn email yoxlayın.",
      },
    },
    "twilio-sms": {
      en: {
        title: "Twilio SMS",
        sideDescription: "Connect Twilio as the SMS fallback provider for international tenants.",
        bodyDescription: "Prepare Twilio Account SID, Auth Token and sender phone number before sending a controlled SMS.",
        resources: ["Twilio Account SID", "Twilio Auth Token", "Controlled SMS test"],
        tutorialTitle: "Using Twilio SMS",
        connectTitle: "Connect Twilio SMS",
      },
      ru: {
        title: "Twilio SMS",
        sideDescription: "Twilio как резервный SMS-провайдер для международных tenant-ов.",
        bodyDescription: "Подготовьте Twilio Account SID, Auth Token и номер отправителя до контролируемого SMS-теста.",
        resources: ["Twilio Account SID", "Twilio Auth Token", "Контролируемый SMS-тест"],
        tutorialTitle: "Twilio SMS",
        connectTitle: "Подключить Twilio SMS",
      },
      az: {
        title: "Twilio SMS",
        sideDescription: "Beynəlxalq tenant-lar üçün Twilio SMS ehtiyat provayderi.",
        bodyDescription: "Nəzarətli SMS testindən əvvəl Twilio Account SID, Auth Token və göndərən nömrəsini hazırlayın.",
        resources: ["Twilio Account SID", "Twilio Auth Token", "Nəzarətli SMS testi"],
        tutorialTitle: "Twilio SMS",
        connectTitle: "Twilio SMS qoş",
      },
    },
    "vonage-sms": {
      en: {
        title: "Vonage SMS",
        sideDescription: "Connect Vonage as an SMS fallback provider when the tenant already uses Vonage.",
        bodyDescription: "Prepare Vonage API key, API secret and sender name before sending a controlled SMS.",
        resources: ["Vonage API key", "Vonage API secret", "Controlled SMS test"],
        tutorialTitle: "Using Vonage SMS",
        connectTitle: "Connect Vonage SMS",
      },
      ru: {
        title: "Vonage SMS",
        sideDescription: "Vonage как резервный SMS-маршрут, если tenant уже использует Vonage.",
        bodyDescription: "Подготовьте Vonage API key, API secret и имя отправителя до контролируемого SMS-теста.",
        resources: ["Vonage API key", "Vonage API secret", "Контролируемый SMS-тест"],
        tutorialTitle: "Vonage SMS",
        connectTitle: "Подключить Vonage SMS",
      },
      az: {
        title: "Vonage SMS",
        sideDescription: "Tenant artıq Vonage istifadə edirsə SMS ehtiyat provayderi kimi qoşulur.",
        bodyDescription: "Nəzarətli SMS testindən əvvəl Vonage API key, API secret və göndərən adını hazırlayın.",
        resources: ["Vonage API key", "Vonage API secret", "Nəzarətli SMS testi"],
        tutorialTitle: "Vonage SMS",
        connectTitle: "Vonage SMS qoş",
      },
    },
    "twilio-calls": {
      en: { title: "Twilio VoIP", sideDescription: "Connect Twilio for cloud telephony, call logs and recordings.", tutorialTitle: "Using Twilio VoIP", connectTitle: "Configure Twilio VoIP" },
      ru: { title: "Twilio VoIP", sideDescription: "Twilio для облачной телефонии, журнала звонков и записей.", tutorialTitle: "Twilio VoIP", connectTitle: "Настроить Twilio VoIP" },
      az: { title: "Twilio VoIP", sideDescription: "Bulud telefoniyası, zəng jurnalı və qeydlər üçün Twilio.", tutorialTitle: "Twilio VoIP", connectTitle: "Twilio VoIP qur" },
    },
    threecx: {
      en: { title: "3CX", sideDescription: "Connect 3CX PBX call events into CRM call history.", tutorialTitle: "Using 3CX", connectTitle: "Configure 3CX" },
      ru: { title: "3CX", sideDescription: "Подключение событий 3CX PBX в историю звонков CRM.", tutorialTitle: "3CX", connectTitle: "Настроить 3CX" },
      az: { title: "3CX", sideDescription: "3CX PBX zəng hadisələri CRM zəng tarixinə qoşulur.", tutorialTitle: "3CX", connectTitle: "3CX qur" },
    },
    asterisk: {
      en: { title: "Asterisk", sideDescription: "Connect Asterisk ARI for self-hosted PBX call history.", tutorialTitle: "Using Asterisk", connectTitle: "Configure Asterisk" },
      ru: { title: "Asterisk", sideDescription: "Asterisk ARI для self-hosted PBX и истории звонков.", tutorialTitle: "Asterisk", connectTitle: "Настроить Asterisk" },
      az: { title: "Asterisk", sideDescription: "Self-hosted PBX və zəng tarixi üçün Asterisk ARI qoşulur.", tutorialTitle: "Asterisk", connectTitle: "Asterisk qur" },
    },
    "custom-sip": {
      en: { title: "Custom SIP", sideDescription: "Connect a custom SIP/PBX provider when Twilio, 3CX or Asterisk are not used.", tutorialTitle: "Using Custom SIP", connectTitle: "Configure Custom SIP" },
      ru: { title: "Custom SIP", sideDescription: "Подключение custom SIP/PBX-провайдера, если Twilio, 3CX или Asterisk не используются.", tutorialTitle: "Custom SIP", connectTitle: "Настроить Custom SIP" },
      az: { title: "Custom SIP", sideDescription: "Twilio, 3CX və ya Asterisk istifadə edilmirsə custom SIP/PBX provayderi qoşulur.", tutorialTitle: "Custom SIP", connectTitle: "Custom SIP qur" },
    },
    "custom-business": {
      en: { title: "Custom Channel", sideDescription: "Connect a non-native messaging provider through Integrations webhooks.", tutorialTitle: "Using Custom Channel", connectTitle: "Connect Custom Channel" },
      ru: { title: "Пользовательский канал", sideDescription: "Подключение внешнего провайдера сообщений через webhook-и интеграций.", tutorialTitle: "Пользовательский канал", connectTitle: "Подключить пользовательский канал" },
      az: { title: "Fərdi kanal", sideDescription: "Xarici mesaj provayderini İnteqrasiyalar webhook-ları ilə qoşun.", tutorialTitle: "Fərdi kanal", connectTitle: "Fərdi kanalı qoş" },
    },
    "custom-live-chat": {
      en: { title: "Custom Channel (Live Chat)", sideDescription: "Connect an external website chat provider through Integrations webhooks.", tutorialTitle: "Using Custom Live Chat", connectTitle: "Connect Custom Live Chat" },
      ru: { title: "Пользовательский канал (веб-чат)", sideDescription: "Подключение внешнего провайдера веб-чата через webhook-и интеграций.", tutorialTitle: "Пользовательский веб-чат", connectTitle: "Подключить пользовательский веб-чат" },
      az: { title: "Fərdi kanal (veb-çat)", sideDescription: "Xarici veb-çat provayderini İnteqrasiyalar webhook-ları ilə qoşun.", tutorialTitle: "Fərdi veb-çat", connectTitle: "Fərdi veb-çatı qoş" },
    },
  }

  return byRoute[normalized]?.[loc] || {}
}

function getGuide(rawChannel: string, loc: Loc): ChannelGuide | null {
  const normalized = routeAliases[rawChannel] || rawChannel
  const enGuides = copy.en.guides
  const localizedGuides = loc === "ru" ? copy.ru.guides : loc === "az" ? copy.az.guides : enGuides
  const key =
    normalized === "whatsapp-business" ? "whatsapp" :
    normalized === "facebook" ? "facebook" :
    normalized === "instagram" ? "instagram" :
    normalized === "tiktok" ? "tiktok" :
    normalized === "telegram" ? "telegram" :
    normalized === "vkontakte" ? "vkontakte" :
    normalized === "atl-sms" ? "smsAtl" :
    normalized === "twilio-sms" || normalized === "vonage-sms" ? "smsProvider" :
    normalized === "google-workspace" || normalized === "gmail" || normalized === "other-email" ? "googleWorkspace" :
    normalized === "website-chat" ? "websiteChat" :
    normalized === "custom-business" || normalized === "custom-live-chat" ? "customWebhook" :
    normalized === "whatsapp-business-calls" ? "whatsappCalling" :
    normalized === "twilio-calls" || normalized === "threecx" || normalized === "asterisk" || normalized === "custom-sip" ? "calls" :
    null
  if (!key) return null
  const source =
    (localizedGuides as unknown as Record<string, GuideSource>)[key] ||
    (enGuides as unknown as Record<string, GuideSource>)[key]
  const formChannelId =
    key === "whatsapp" ? "whatsapp-business" :
    key === "facebook" ? "facebook" :
    key === "instagram" ? "instagram" :
    key === "tiktok" ? "tiktok" :
    key === "telegram" ? "telegram" :
    key === "vkontakte" ? "vkontakte" :
    key === "smsAtl" ? "atl-sms" :
    key === "smsProvider" ? normalized :
    key === "googleWorkspace" ? normalized :
    key === "whatsappCalling" ? "whatsapp-business" :
    undefined
  const icon =
    key === "whatsapp" ? MessageCircle :
    key === "facebook" ? MessagesSquare :
    key === "instagram" ? AtSign :
    key === "tiktok" ? Sparkles :
    key === "telegram" ? Send :
    key === "vkontakte" ? MessageCircle :
    key === "smsAtl" ? Smartphone :
    key === "smsProvider" ? Smartphone :
    key === "googleWorkspace" ? Mail :
    key === "websiteChat" ? Webhook :
    key === "customWebhook" ? Webhook :
    key === "whatsappCalling" ? MessageCircle :
    key === "calls" ? PhoneCall :
    MessageCircle
  const logo =
    key === "whatsapp" ? "WA" :
    key === "facebook" ? "f" :
    key === "instagram" ? "◎" :
    key === "tiktok" ? "♪" :
    key === "telegram" ? "✈" :
    key === "vkontakte" ? "VK" :
    key === "smsAtl" ? "ATL" :
    key === "smsProvider" ? "SMS" :
    key === "googleWorkspace" ? "@" :
    key === "websiteChat" ? "💬" :
    key === "customWebhook" ? "WH" :
    key === "whatsappCalling" ? "WA" :
    "☎"
  const override = guideOverrideForRoute(normalized, loc)
  return {
    id: normalized,
    title: override.title || source.title,
    sideDescription: override.sideDescription || source.sideDescription,
    bodyDescription: override.bodyDescription || source.bodyDescription,
    icon,
    logo,
    badge: source.badge,
    formChannelId,
    defaultMode: "new",
    resources: [...(override.resources || source.resources)],
    tutorial: {
      ...source.tutorial,
      title: override.tutorialTitle || source.tutorial.title,
      description: override.tutorialDescription || source.tutorial.description,
      steps: [...source.tutorial.steps],
    },
    eligibility: {
      title: source.eligibilityTitle,
      steps: source.eligibility.map((step) => ({
        ...step,
        options: [...step.options],
      })),
    },
    connect: {
      title: override.connectTitle || source.connectTitle,
      description: override.connectDescription || source.connectDesc,
      primary: source.primary,
      secondary: source.secondary,
      note: source.note,
    },
  }
}

function getChannelRequirements(guide: ChannelGuide, loc: Loc) {
  const isRu = loc === "ru"
  const isAz = loc === "az"
  const text = {
    whatsapp: {
      prepare: isRu
        ? ["Доступ администратора к Meta Business Manager", "WABA ID, Phone Number ID и постоянный token Cloud API", "Verify token для webhook LeadDrive"]
        : isAz
          ? ["Meta Business Manager admin girişi", "WABA ID, Phone Number ID və permanent Cloud API token", "LeadDrive webhook üçün verify token"]
          : ["Meta Business Manager admin access", "WABA ID, Phone Number ID and permanent Cloud API token", "Verify token for the LeadDrive webhook"],
      verify: isRu
        ? ["Отправьте входящее WhatsApp-сообщение на подключённый номер", "Проверьте, что диалог появился в Inbox", "Отправьте контролируемый ответ или шаблон из LeadDrive"]
        : isAz
          ? ["Qoşulmuş nömrəyə gələn WhatsApp mesajı göndərin", "Dialoqun Inbox-da göründüyünü yoxlayın", "LeadDrive-dan nəzarətli cavab və ya şablon göndərin"]
          : ["Send one inbound WhatsApp message to the connected number", "Confirm the conversation appears in Inbox", "Send a controlled reply/template from LeadDrive"],
    },
    whatsappCalling: {
      prepare: isRu
        ? ["Выбран тот же Meta app, где находится WhatsApp-номер этого tenant-а", "В WhatsApp API канале сохранены Phone Number ID, permanent token, verify token и app secret", "Meta webhook на app.leaddrivecrm.org подписан на calls"]
        : isAz
          ? ["Bu tenant-ın WhatsApp nömrəsi olan eyni Meta app seçilib", "WhatsApp API kanalında Phone Number ID, permanent token, verify token və app secret saxlanıb", "Meta webhook app.leaddrivecrm.org üzərində calls üçün abunədir"]
          : ["The same Meta app that owns this tenant's WhatsApp number is selected", "Phone Number ID, permanent token, verify token and app secret are saved in the WhatsApp API channel", "Meta webhook on app.leaddrivecrm.org is subscribed to calls"],
      verify: isRu
        ? ["Примите один входящий WhatsApp-звонок в Inbox", "Запросите у клиента WhatsApp call permission", "После approve начните один исходящий WhatsApp-звонок из Inbox"]
        : isAz
          ? ["Inbox-da bir inbound WhatsApp zəngini qəbul edin", "Müştəridən WhatsApp call permission istəyin", "Approve-dan sonra Inbox-dan bir outbound WhatsApp zəngi başladın"]
          : ["Accept one inbound WhatsApp call in Inbox", "Request WhatsApp call permission from the customer", "After approval, start one outbound WhatsApp call from Inbox"],
    },
    tiktok: {
      prepare: isRu
        ? ["Базовый URL Chatwoot и account ID", "Chatwoot access token и webhook secret", "TikTok inbox уже создан в Chatwoot"]
        : isAz
          ? ["Chatwoot base URL və account ID", "Chatwoot access token və webhook secret", "TikTok inbox artıq Chatwoot-da yaradılıb"]
          : ["Chatwoot base URL and account ID", "Chatwoot access token and webhook secret", "TikTok inbox already created in Chatwoot"],
      verify: isRu
        ? ["Напишите тестовый DM в TikTok", "Проверьте доставку в Chatwoot", "Проверьте, что LeadDrive показывает диалог как TikTok"]
        : isAz
          ? ["TikTok-da test DM göndərin", "Chatwoot-da çatdırılmanı yoxlayın", "LeadDrive dialoqu TikTok kimi göstərdiyini yoxlayın"]
          : ["Send a test TikTok DM", "Confirm delivery in Chatwoot", "Confirm LeadDrive shows the conversation as TikTok"],
    },
    facebook: {
      prepare: isRu
        ? ["Meta App ID, App Secret и Verify Token", "Доступ администратора к Facebook Page", "pages_messaging permission и подписка webhook"]
        : isAz
          ? ["Meta App ID, App Secret və Verify Token", "Facebook Page admin girişi", "pages_messaging permission və webhook subscription"]
          : ["Meta App ID, App Secret and Verify Token", "Facebook Page admin access", "pages_messaging permission and webhook subscription"],
      verify: isRu
        ? ["Отправьте входящий Messenger DM с тестового аккаунта", "Проверьте, что сообщение пришло в Inbox", "Ответьте из LeadDrive и проверьте доставку в Meta"]
        : isAz
          ? ["Test hesabdan gələn Messenger DM göndərin", "Mesajın Inbox-a gəldiyini yoxlayın", "LeadDrive-dan cavab verib Meta çatdırılmasını yoxlayın"]
          : ["Send an inbound Messenger DM from a test account", "Confirm the message arrives in Inbox", "Reply from LeadDrive and confirm Meta delivery"],
    },
    instagram: {
      prepare: isRu
        ? ["Meta App ID, App Secret и Verify Token", "Instagram business/professional account", "Instagram Login или messaging permissions Facebook Page"]
        : isAz
          ? ["Meta App ID, App Secret və Verify Token", "Instagram business/professional account", "Instagram Login və ya Facebook Page messaging permissions"]
          : ["Meta App ID, App Secret and Verify Token", "Instagram business/professional account", "Instagram Login or Facebook Page messaging permissions"],
      verify: isRu
        ? ["Отправьте входящий Instagram DM с тестового аккаунта", "Проверьте, что сообщение пришло в Inbox", "Ответьте из LeadDrive и проверьте доставку в Meta"]
        : isAz
          ? ["Test hesabdan gələn Instagram DM göndərin", "Mesajın Inbox-a gəldiyini yoxlayın", "LeadDrive-dan cavab verib Meta çatdırılmasını yoxlayın"]
          : ["Send an inbound Instagram DM from a test account", "Confirm the message arrives in Inbox", "Reply from LeadDrive and confirm Meta delivery"],
    },
    telegram: {
      prepare: isRu
        ? ["Bot token из BotFather", "Название канала для операторов", "Доступ к тестовому чату с ботом"]
        : isAz
          ? ["BotFather-dən bot token", "Operatorlar üçün kanal adı", "Bot ilə test chat girişi"]
          : ["Bot token from BotFather", "Operator-facing channel name", "Access to a test chat with the bot"],
      verify: isRu
        ? ["Напишите боту тестовое сообщение", "Проверьте диалог в Inbox", "Ответьте из LeadDrive"]
        : isAz
          ? ["Bota test mesajı yazın", "Inbox-da dialoqu yoxlayın", "LeadDrive-dan cavab verin"]
          : ["Send the bot a test message", "Confirm the conversation in Inbox", "Reply from LeadDrive"],
    },
    vk: {
      prepare: isRu
        ? ["Доступ администратора к VK community", "VK API token и настройки webhook", "Название канала для операторов"]
        : isAz
          ? ["VK community admin girişi", "VK API token və webhook parametrləri", "Operatorlar üçün kanal adı"]
          : ["VK community admin access", "VK API token and webhook settings", "Operator-facing channel name"],
      verify: isRu
        ? ["Отправьте входящее VK-сообщение", "Проверьте диалог в Inbox", "Ответьте из LeadDrive и проверьте доставку"]
        : isAz
          ? ["Gələn VK mesajı göndərin", "Inbox-da dialoqu yoxlayın", "LeadDrive-dan cavab verib çatdırılmanı yoxlayın"]
          : ["Send one inbound VK message", "Confirm the conversation in Inbox", "Reply from LeadDrive and confirm delivery"],
    },
    sms: {
      prepare: isRu
        ? ["Ключи провайдера и sender title", "Одобренный маршрут отправитель/страна", "Контролируемый тестовый номер"]
        : isAz
          ? ["Provayder açarları və göndərən adı", "Təsdiqlənmiş göndərən/ölkə marşrutu", "Nəzarətli test telefon nömrəsi"]
          : ["Provider credentials and sender title", "Approved sender/country route", "Controlled test phone number"],
      verify: isRu
        ? ["Отправьте одно контролируемое SMS", "Проверьте статус доставки у провайдера", "Не включайте живые кампании до успешного теста"]
        : isAz
          ? ["Bir nəzarətli SMS göndərin", "Provayder çatdırılma statusunu yoxlayın", "Uğurlu testdən əvvəl canlı kampaniyaları açmayın"]
          : ["Send one controlled SMS", "Confirm provider delivery status", "Do not enable live campaigns before a successful test"],
    },
    email: {
      prepare: isRu
        ? ["SMTP/IMAP host, port и security mode", "Mailbox username и app password", "From name / reply address"]
        : isAz
          ? ["SMTP/IMAP host, port və security mode", "Mailbox username və app password", "From name / reply address"]
          : ["SMTP/IMAP host, port and security mode", "Mailbox username and app password", "From name / reply address"],
      verify: isRu
        ? ["Отправьте входящий email в mailbox", "Проверьте диалог в Inbox", "Ответьте из LeadDrive и проверьте полученный email"]
        : isAz
          ? ["Mailbox-a gələn email göndərin", "Inbox-da dialoqu yoxlayın", "LeadDrive-dan cavab verib alınan email-i yoxlayın"]
          : ["Send one inbound email to the mailbox", "Confirm the conversation in Inbox", "Reply from LeadDrive and confirm the received email"],
    },
    external: {
      prepare: isRu
        ? ["Откройте отдельную страницу настроек", "Настройте маршрутизацию и видимость", "Подготовьте контролируемого тестового пользователя"]
        : isAz
          ? ["Ayrıca parametrlər səhifəsini açın", "Marşrutlaşdırma və görünməni qurun", "Nəzarətli test istifadəçisi hazırlayın"]
          : ["Open the dedicated settings page", "Configure routing/visibility", "Prepare a controlled test user"],
      verify: isRu
        ? ["Сохраните настройки", "Запустите одно контролируемое взаимодействие", "Проверьте запись в Inbox/CRM history"]
        : isAz
          ? ["Parametrləri saxlayın", "Bir nəzarətli qarşılıqlı əlaqə başladın", "Inbox/CRM history-də yazını yoxlayın"]
          : ["Save settings", "Run one controlled interaction", "Confirm the Inbox/CRM history entry"],
    },
    customWebhook: {
      prepare: isRu
        ? ["Webhook endpoint или исходящие события у провайдера", "Payload sample с полями контакта и сообщения", "Правило secret/signature для проверки webhook"]
        : isAz
          ? ["Provayderdə webhook endpoint və ya outbound hadisələr", "Kontakt/mesaj sahələri olan payload nümunəsi", "Webhook yoxlaması üçün secret/signature qaydası"]
          : ["Provider webhook endpoint or outbound events", "Payload sample with contact/message fields", "Secret/signature rule for webhook verification"],
      verify: isRu
        ? ["Отправьте одно контролируемое входящее событие", "Проверьте, что LeadDrive создал диалог в Inbox", "Проверьте fallback: неподписанное или битое событие должно отклоняться"]
        : isAz
          ? ["Bir nəzarətli inbound event göndərin", "LeadDrive Inbox-da dialoq yaratdığını yoxlayın", "Fallback yoxlayın: imzasız və ya səhv event rədd edilməlidir"]
          : ["Send one controlled inbound event", "Confirm LeadDrive creates the conversation in Inbox", "Verify fallback: unsigned/bad events are rejected"],
    },
  }

  if (guide.id === "whatsapp-business-calls") return text.whatsappCalling
  if (guide.id === "custom-business" || guide.id === "custom-live-chat") return text.customWebhook
  if (guide.formChannelId === "whatsapp-business") return text.whatsapp
  if (guide.formChannelId === "tiktok") return text.tiktok
  if (guide.formChannelId === "facebook") return text.facebook
  if (guide.formChannelId === "instagram") return text.instagram
  if (guide.formChannelId === "telegram") return text.telegram
  if (guide.formChannelId === "vkontakte") return text.vk
  if (guide.formChannelId?.includes("sms")) return text.sms
  if (guide.formChannelId === "google-workspace" || guide.formChannelId === "gmail" || guide.formChannelId === "other-email") return text.email
  return text.external
}

interface TutorialScreenGuide {
  providerSurface: string
  providerUrl: string
  providerActions: string[]
  leadDriveRoute: string
  leadDriveActions: string[]
  leadDriveFields: string[]
  finalCheck: string
}

function getTutorialScreenGuide(
  guide: ChannelGuide,
  loc: Loc,
  channelRequirements: ReturnType<typeof getChannelRequirements>,
): TutorialScreenGuide {
  const isRu = loc === "ru"
  const isAz = loc === "az"
  const common = {
    leadDriveRoute: isRu ? "Настройки > Каналы" : isAz ? "Tənzimləmələr > Kanallar" : "Settings > Channels",
    saveCredentials: isRu ? "Сохраните форму ключей в LeadDrive" : isAz ? "LeadDrive-da açar formasını saxlayın" : "Save the credential form in LeadDrive",
    verifyInbox: isRu ? "Проверьте контролируемое событие в Inbox" : isAz ? "Inbox-da nəzarətli hadisəni yoxlayın" : "Verify the controlled event in Inbox",
  }
  const leadDriveActions = [
    isRu ? "Выберите сценарий: новый или существующий аккаунт" : isAz ? "Ssenarini seçin: yeni və ya mövcud hesab" : "Choose the scenario: new or existing account",
    ...channelRequirements.prepare.slice(0, 2),
    common.saveCredentials,
  ].slice(0, 4)
  const fallback: TutorialScreenGuide = {
    providerSurface: isRu ? "Панель провайдера" : isAz ? "Provayder paneli" : "Provider console",
    providerUrl: "provider.example.com",
    providerActions: channelRequirements.prepare,
    leadDriveRoute: common.leadDriveRoute,
    leadDriveActions,
    leadDriveFields: channelRequirements.prepare,
    finalCheck: channelRequirements.verify[0] || common.verifyInbox,
  }

  if (guide.id === "whatsapp-business-calls") {
    return {
      providerSurface: isRu ? "Meta Developers / WhatsApp" : isAz ? "Meta Developers / WhatsApp" : "Meta Developers / WhatsApp",
      providerUrl: "developers.facebook.com/apps -> WhatsApp -> Configuration",
      providerActions: isRu
        ? ["Откройте Meta app, где находится номер этого tenant-а", "Проверьте Phone Number ID в WhatsApp configuration", "Вставьте callback и verify token LeadDrive", "Подпишите calls и попросите клиента позвонить"]
        : isAz
          ? ["Bu tenant-ın nömrəsi olan Meta app-i açın", "WhatsApp configuration-da Phone Number ID-ni yoxlayın", "LeadDrive callback və verify token yazın", "Calls-a abunə olun və müştəridən zəng etməsini istəyin"]
          : ["Open the Meta app that owns this tenant's number", "Check Phone Number ID in WhatsApp configuration", "Paste the LeadDrive callback and verify token", "Subscribe calls and ask the client to call"],
      leadDriveRoute: `${common.leadDriveRoute} > WhatsApp Business API`,
      leadDriveActions,
      leadDriveFields: ["WABA ID", "Phone Number ID", "Access token", "Verify token", "App Secret"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "whatsapp-business") {
    return {
      providerSurface: "Meta Business Suite / WhatsApp Manager",
      providerUrl: "business.facebook.com -> WhatsApp accounts",
      providerActions: isRu
        ? ["Откройте WABA в WhatsApp Manager", "Выберите номер телефона", "Скопируйте Phone Number ID и постоянный token", "Добавьте webhook LeadDrive"]
        : isAz
          ? ["WhatsApp Manager-də WABA açın", "Telefon nömrəsini seçin", "Phone Number ID və daimi token-i kopyalayın", "LeadDrive webhook əlavə edin"]
          : ["Open the WABA in WhatsApp Manager", "Select the phone number", "Copy Phone Number ID and permanent token", "Add the LeadDrive webhook"],
      leadDriveRoute: `${common.leadDriveRoute} > WhatsApp Business API`,
      leadDriveActions,
      leadDriveFields: ["WABA ID", "Phone Number ID", "Access token", "Verify token"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "facebook" || guide.formChannelId === "instagram") {
    const isInstagram = guide.formChannelId === "instagram"
    return {
      providerSurface: isInstagram ? "Meta Developers / Instagram" : "Meta Developers / Messenger",
      providerUrl: isInstagram ? "developers.facebook.com -> Instagram Login" : "developers.facebook.com -> Messenger",
      providerActions: isRu
        ? [
            "Откройте Meta-приложение этого тенанта",
            isInstagram ? "Выберите Instagram Login или linked Page путь" : "Выберите Facebook Page",
            "Выдайте messaging permissions",
            "Подпишите webhook и отправьте тестовый DM",
          ]
        : isAz
          ? [
              "Bu tenantın Meta tətbiqini açın",
              isInstagram ? "Instagram Login və ya linked Page yolunu seçin" : "Facebook Page seçin",
              "Messaging permissions verin",
              "Webhook abunə edin və test DM göndərin",
            ]
          : [
              "Open the tenant Meta app",
              isInstagram ? "Choose Instagram Login or linked Page path" : "Choose the Facebook Page",
              "Grant messaging permissions",
              "Subscribe the webhook and send a test DM",
            ],
      leadDriveRoute: `${common.leadDriveRoute} > ${guide.title}`,
      leadDriveActions,
      leadDriveFields: ["App ID", "App Secret", "Verify token", isInstagram ? "Instagram account/Page" : "Facebook Page ID"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "tiktok") {
    return {
      providerSurface: "Chatwoot",
      providerUrl: "chatwoot.example.com -> Inboxes -> TikTok",
      providerActions: isRu
        ? ["Создайте TikTok inbox в Chatwoot", "Скопируйте Chatwoot base URL и account ID", "Создайте access token", "Включите webhook в сторону LeadDrive"]
        : isAz
          ? ["Chatwoot-da TikTok inbox yaradın", "Chatwoot base URL və account ID-ni kopyalayın", "Access token yaradın", "LeadDrive üçün webhook aktiv edin"]
          : ["Create the TikTok inbox in Chatwoot", "Copy Chatwoot base URL and account ID", "Create an access token", "Enable the webhook toward LeadDrive"],
      leadDriveRoute: `${common.leadDriveRoute} > TikTok via Chatwoot`,
      leadDriveActions,
      leadDriveFields: ["Chatwoot base URL", "Account ID", "Access token", "Webhook secret"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "telegram") {
    return {
      providerSurface: "Telegram BotFather",
      providerUrl: "t.me/BotFather",
      providerActions: isRu
        ? ["Откройте BotFather", "Создайте или выберите bot", "Скопируйте bot token", "Отправьте тестовое сообщение bot-у"]
        : isAz
          ? ["BotFather-i açın", "Bot yaradın və ya seçin", "Bot token-i kopyalayın", "Bot-a test mesajı göndərin"]
          : ["Open BotFather", "Create or select the bot", "Copy the bot token", "Send the bot a test message"],
      leadDriveRoute: `${common.leadDriveRoute} > Telegram Bot`,
      leadDriveActions,
      leadDriveFields: ["Bot token", "Channel name"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "vkontakte") {
    return {
      providerSurface: "VK Developers / Community",
      providerUrl: "vk.com -> Community -> API settings",
      providerActions: isRu
        ? ["Откройте настройки VK community", "Создайте или скопируйте API token", "Настройте webhook callback URL", "Отправьте тестовое сообщение в community"]
        : isAz
          ? ["VK community parametrlərini açın", "API token yaradın və ya kopyalayın", "Webhook callback URL qurun", "Community-yə test mesajı göndərin"]
          : ["Open VK community settings", "Create or copy the API token", "Configure the webhook callback URL", "Send a test message to the community"],
      leadDriveRoute: `${common.leadDriveRoute} > VKontakte`,
      leadDriveActions,
      leadDriveFields: ["VK token", "Community ID", "Webhook secret", "Channel name"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId?.includes("sms")) {
    return {
      providerSurface: guide.formChannelId === "atl-sms" ? "ATL SMS panel" : "SMS provider console",
      providerUrl: guide.formChannelId === "atl-sms" ? "ATL -> Sender profile" : "Twilio/Vonage -> Messaging",
      providerActions: isRu
        ? ["Откройте профиль отправителя", "Проверьте одобрение отправителя", "Скопируйте API-ключи", "Отправьте один тестовый SMS"]
        : isAz
          ? ["Göndərən profilini açın", "Göndərən təsdiqini yoxlayın", "API açarlarını kopyalayın", "Bir test SMS göndərin"]
          : ["Open the sender profile", "Confirm sender approval", "Copy API credentials", "Send one test SMS"],
      leadDriveRoute: `${common.leadDriveRoute} > ${guide.title}`,
      leadDriveActions,
      leadDriveFields: ["Provider", "API key/login", "API secret/password", "Sender title"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.id === "website-chat") {
    return {
      providerSurface: isRu ? "Сайт клиента" : isAz ? "Müştəri saytı" : "Customer website",
      providerUrl: "website -> LeadDrive widget snippet",
      providerActions: isRu
        ? ["Откройте CMS или код сайта", "Вставьте код виджета", "Проверьте кнопку запуска на сайте", "Отправьте тестовое сообщение из веб-чата"]
        : isAz
          ? ["CMS və ya sayt kodunu açın", "Vidcet kodunu əlavə edin", "Saytda açılış düyməsini yoxlayın", "Test veb-çat mesajı göndərin"]
          : ["Open the CMS or website code", "Paste the widget snippet", "Check the launcher on the site", "Send a test web-chat"],
      leadDriveRoute: isRu ? "Настройки > Веб-чат" : isAz ? "Tənzimləmələr > Veb-çat" : "Settings > Web Chat",
      leadDriveActions,
      leadDriveFields: ["Widget color", "Greeting", "Routing team", "AI handoff", "Escalation rule"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.id === "custom-business" || guide.id === "custom-live-chat") {
    return {
      providerSurface: isRu ? "Внешний провайдер / webhook" : isAz ? "Xarici provayder / webhook" : "External provider / webhook",
      providerUrl: "provider.example.com -> Webhooks",
      providerActions: isRu
        ? ["Откройте настройки webhook у провайдера", "Выберите событие сообщения или чата", "Добавьте endpoint и secret LeadDrive", "Отправьте контролируемый payload"]
        : isAz
          ? ["Provayder webhook parametrlərini açın", "Mesaj və ya çat hadisəsini seçin", "LeadDrive endpoint və secret əlavə edin", "Nəzarətli payload göndərin"]
          : ["Open provider webhook settings", "Choose the message/chat event", "Add the LeadDrive endpoint and secret", "Send a controlled payload"],
      leadDriveRoute: isRu ? "Настройки > Интеграции" : isAz ? "Tənzimləmələr > İnteqrasiyalar" : "Settings > Integrations",
      leadDriveActions: [
        isRu ? "Создайте входящую webhook-интеграцию" : isAz ? "Inbound webhook inteqrasiyası yaradın" : "Create an inbound webhook integration",
        ...channelRequirements.prepare.slice(0, 2),
        common.verifyInbox,
      ].slice(0, 4),
      leadDriveFields: ["Webhook URL", "Webhook secret", "Channel label", "Contact mapping", "Message mapping"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.id === "twilio-calls" || guide.id === "threecx" || guide.id === "asterisk" || guide.id === "custom-sip") {
    return {
      providerSurface: guide.title,
      providerUrl: "voice provider -> call events",
      providerActions: isRu
        ? ["Откройте панель голосового провайдера", "Скопируйте SIP/API-ключи", "Включите события звонков или webhook записей", "Сделайте контролируемый тестовый звонок"]
        : isAz
          ? ["Səs provayderi panelini açın", "SIP/API açarlarını kopyalayın", "Zəng hadisələrini və ya recording webhook aktiv edin", "Nəzarətli test zəngi edin"]
          : ["Open the voice provider console", "Copy SIP/API credentials", "Enable call events or recording webhook", "Run one controlled test call"],
      leadDriveRoute: isRu ? "Настройки > VoIP Звонки" : isAz ? "Tənzimləmələr > VoIP Zənglər" : "Settings > VoIP Calls",
      leadDriveActions,
      leadDriveFields: ["Provider", "Account ID", "Auth token", "Webhook secret", "Recording toggle"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  if (guide.formChannelId === "google-workspace" || guide.formChannelId === "gmail" || guide.formChannelId === "other-email") {
    return {
      providerSurface: guide.formChannelId === "google-workspace" || guide.formChannelId === "gmail" ? "Google Admin / Gmail" : "Mail provider",
      providerUrl: guide.formChannelId === "other-email" ? "mail provider -> SMTP/IMAP" : "admin.google.com -> Security",
      providerActions: isRu
        ? ["Откройте mailbox settings", "Разрешите app password или SMTP access", "Скопируйте host/port/login", "Отправьте тестовый email"]
        : isAz
          ? ["Mailbox settings açın", "App password və ya SMTP access icazə verin", "Host/port/login kopyalayın", "Test email göndərin"]
          : ["Open mailbox settings", "Allow app password or SMTP access", "Copy host/port/login", "Send a test email"],
      leadDriveRoute: `${common.leadDriveRoute} > ${guide.title}`,
      leadDriveActions,
      leadDriveFields: ["SMTP host", "Port", "Security mode", "Mailbox login", "App password"],
      finalCheck: channelRequirements.verify[0] || common.verifyInbox,
    }
  }

  return fallback
}

function getScenarioOptions(
  guide: ChannelGuide,
  loc: Loc,
  fallback: {
    newTitle: string
    newDescription: string
    existingTitle: string
    existingDescription: string
  },
): ScenarioOption[] {
  const isRu = loc === "ru"
  const isAz = loc === "az"
  const pair = (
    newTitle: string,
    newDescription: string,
    newChecklist: string[],
    existingTitle: string,
    existingDescription: string,
    existingChecklist: string[],
  ): ScenarioOption[] => [
    { value: "new", title: newTitle, description: newDescription, checklist: newChecklist },
    { value: "existing", title: existingTitle, description: existingDescription, checklist: existingChecklist },
  ]

  if (guide.formChannelId === "whatsapp-business") {
    return pair(
      isRu ? "Создать новый WABA" : isAz ? "Yeni WABA yarat" : "Create a new WABA",
      isRu
        ? "Выберите это, если номер ещё не подключён к WhatsApp Business Platform и нужно пройти Meta setup."
        : isAz
          ? "Nömrə hələ WhatsApp Business Platform-a qoşulmayıbsa və Meta setup lazımdırsa bunu seçin."
          : "Choose this if the phone number is not on WhatsApp Business Platform yet and needs Meta setup.",
      isRu
        ? ["Новый или свободный номер", "Meta Business Manager admin", "Юридические данные компании"]
        : isAz
          ? ["Yeni və ya boş nömrə", "Meta Business Manager admin", "Şirkətin hüquqi məlumatları"]
          : ["New or free phone number", "Meta Business Manager admin", "Legal company details"],
      isRu ? "Подключить существующий WABA" : isAz ? "Mövcud WABA qoş" : "Connect an existing WABA",
      isRu
        ? "Выберите это, если WABA уже создан и у вас есть WABA ID, Phone Number ID и permanent token."
        : isAz
          ? "WABA artıq yaradılıbsa və WABA ID, Phone Number ID və permanent token varsa bunu seçin."
          : "Choose this if the WABA already exists and you have WABA ID, Phone Number ID and a permanent token.",
      ["WABA ID", "Phone Number ID", "Permanent access token"],
    )
  }

  if (guide.formChannelId === "facebook") {
    return pair(
      isRu ? "Создать Meta app + Page setup" : isAz ? "Meta app + Page setup yarat" : "Create Meta app + Page setup",
      isRu
        ? "Для нового Messenger подключения: подготовьте Meta app, Facebook Page и webhook."
        : isAz
          ? "Yeni Messenger bağlantısı üçün Meta app, Facebook Page və webhook hazırlayın."
          : "For a new Messenger connection: prepare the Meta app, Facebook Page and webhook.",
      isRu
        ? ["Facebook Page admin", "Meta app", "pages_messaging permission"]
        : isAz
          ? ["Facebook Page admin", "Meta app", "pages_messaging icazəsi"]
          : ["Facebook Page admin", "Meta app", "pages_messaging permission"],
      isRu ? "Подключить готовую Page" : isAz ? "Hazır Page qoş" : "Connect an existing Page",
      isRu
        ? "Если Page и Meta app уже готовы, просто сохраните App ID, App Secret, Verify Token и Page ID."
        : isAz
          ? "Page və Meta app hazırdırsa App ID, App Secret, Verify Token və Page ID saxlayın."
          : "If the Page and Meta app already exist, save App ID, App Secret, Verify Token and Page ID.",
      ["App ID", "App Secret", "Verify Token", "Page ID"],
    )
  }

  if (guide.formChannelId === "instagram") {
    return pair(
      isRu ? "Instagram Login path" : isAz ? "Instagram Login yolu" : "Instagram Login path",
      isRu
        ? "Для Instagram аккаунта без linked Facebook Page: используйте Instagram Login и Meta permissions."
        : isAz
          ? "Linked Facebook Page olmayan Instagram hesabı üçün Instagram Login və Meta permissions istifadə edin."
          : "For an Instagram account without a linked Facebook Page: use Instagram Login and Meta permissions.",
      isRu
        ? ["Business/professional account", "Instagram Login", "DM permissions"]
        : isAz
          ? ["Business/professional hesab", "Instagram Login", "DM icazələri"]
          : ["Business/professional account", "Instagram Login", "DM permissions"],
      isRu ? "Linked Facebook Page" : isAz ? "Linked Facebook Page" : "Linked Facebook Page",
      isRu
        ? "Если Instagram уже связан с Page, подключайте через Page и сохраните Meta app credentials."
        : isAz
          ? "Instagram artıq Page ilə bağlıdırsa Page vasitəsilə qoşun və Meta app credentials saxlayın."
          : "If Instagram is already linked to a Page, connect through the Page and save Meta app credentials.",
      ["Facebook Page", "Instagram account/Page", "App ID", "App Secret"],
    )
  }

  if (guide.formChannelId === "tiktok") {
    return pair(
      isRu ? "Создать TikTok inbox в Chatwoot" : isAz ? "Chatwoot-da TikTok inbox yarat" : "Create TikTok inbox in Chatwoot",
      isRu
        ? "Правильный путь для TikTok: сначала Chatwoot inbox, потом LeadDrive сохраняет Chatwoot-ключи как TikTok."
        : isAz
          ? "TikTok üçün doğru yol: əvvəl Chatwoot inbox, sonra LeadDrive Chatwoot açarlarını TikTok kimi saxlayır."
          : "Correct TikTok path: create the Chatwoot inbox first, then LeadDrive saves Chatwoot credentials as TikTok.",
      isRu
        ? ["TikTok inbox в Chatwoot", "Base URL + Account ID", "Chatwoot token"]
        : isAz
          ? ["Chatwoot-da TikTok inbox", "Base URL + Account ID", "Chatwoot token"]
          : ["TikTok inbox in Chatwoot", "Base URL + Account ID", "Chatwoot token"],
      isRu ? "Использовать готовый Chatwoot inbox" : isAz ? "Hazır Chatwoot inbox istifadə et" : "Use an existing Chatwoot inbox",
      isRu
        ? "Если TikTok уже работает в Chatwoot, не создавайте direct TikTok API — просто вставьте Chatwoot данные."
        : isAz
          ? "TikTok artıq Chatwoot-da işləyirsə direct TikTok API yaratmayın — Chatwoot məlumatlarını yazın."
          : "If TikTok already works in Chatwoot, do not create a direct TikTok API channel — paste Chatwoot details.",
      ["Chatwoot base URL", "Account ID", "Access token", "Webhook secret"],
    )
  }

  if (guide.formChannelId === "atl-sms") {
    return pair(
      isRu ? "Запросить ATL sender" : isAz ? "ATL sender tələb et" : "Request an ATL sender",
      isRu
        ? "Если отправитель ещё не одобрен, сначала получите ATL sender title и API доступ."
        : isAz
          ? "Göndərən hələ təsdiqlənməyibsə əvvəl ATL sender title və API giriş alın."
          : "If the sender is not approved yet, get the ATL sender title and API access first.",
      isRu
        ? ["ATL account", "Approved sender title", "API login/password"]
        : isAz
          ? ["ATL account", "Təsdiqlənmiş sender title", "API login/password"]
          : ["ATL account", "Approved sender title", "API login/password"],
      isRu ? "Подключить готовый ATL sender" : isAz ? "Hazır ATL sender qoş" : "Connect an existing ATL sender",
      isRu
        ? "Если ATL уже выдал ключи, сохраните provider=ATL, sender title и API credentials."
        : isAz
          ? "ATL artıq açarları veribsə provider=ATL, sender title və API credentials saxlayın."
          : "If ATL already issued credentials, save provider=ATL, sender title and API credentials.",
      ["Provider = ATL", "Sender title", "API login", "API secret/password"],
    )
  }

  return pair(
    fallback.newTitle,
    fallback.newDescription,
    [],
    fallback.existingTitle,
    fallback.existingDescription,
    [],
  )
}

function getChannelFaq(
  guide: ChannelGuide,
  loc: Loc,
  channelRequirements: ReturnType<typeof getChannelRequirements>,
  tutorialScreen: TutorialScreenGuide,
) {
  const isRu = loc === "ru"
  const isAz = loc === "az"
  const safeTest = channelRequirements.verify[0] || tutorialScreen.finalCheck
  const firstField = tutorialScreen.leadDriveFields[0] || channelRequirements.prepare[0]
  const externalAccessAnswer = isRu
    ? "Остановитесь на этом шаге и запросите доступ у владельца провайдера. Не вводите чужие или тестовые ключи в production-канал."
    : isAz
      ? "Bu addımda dayanın və provayder sahibindən giriş istəyin. Production kanalına yad və ya test açarları yazmayın."
      : "Stop at this step and request access from the provider owner. Do not paste someone else's or test credentials into a production channel."
  const liveAnswer = isRu
    ? `После сохранения выполните проверку: ${safeTest}. До этого не включайте живые кампании, automation или массовые ответы.`
    : isAz
      ? `Saxladıqdan sonra yoxlayın: ${safeTest}. Bundan əvvəl canlı kampaniya, automation və kütləvi cavabları açmayın.`
      : `After saving, verify it with: ${safeTest}. Do not enable live campaigns, automation or bulk replies before that.`
  const keyAnswer = isRu
    ? `Начните с поля ${firstField}. Остальные значения берите только из указанной панели: ${tutorialScreen.providerSurface}.`
    : isAz
      ? `${firstField} sahəsindən başlayın. Qalan dəyərləri yalnız göstərilən paneldən götürün: ${tutorialScreen.providerSurface}.`
      : `Start with ${firstField}. Take the remaining values only from the listed provider surface: ${tutorialScreen.providerSurface}.`

  const generic = [
    {
      q: isRu ? "Где взять ключи для этой формы?" : isAz ? "Bu forma üçün açarları haradan götürüm?" : "Where do I get the credentials for this form?",
      a: keyAnswer,
    },
    {
      q: isRu ? "Что делать, если доступа к провайдеру нет?" : isAz ? "Provayderə giriş yoxdursa nə etməliyəm?" : "What if I do not have provider access?",
      a: externalAccessAnswer,
    },
    {
      q: isRu ? "Когда можно включать живой трафик?" : isAz ? "Canlı trafiki nə vaxt açmaq olar?" : "When can I enable live traffic?",
      a: liveAnswer,
    },
  ]

  if (guide.formChannelId === "tiktok") {
    return [
      {
        q: isRu ? "TikTok подключается напрямую к LeadDrive?" : isAz ? "TikTok birbaşa LeadDrive-a qoşulur?" : "Does TikTok connect directly to LeadDrive?",
        a: isRu
          ? "Нет. TikTok остаётся в Chatwoot, а LeadDrive принимает и показывает эти диалоги как отдельный TikTok-канал."
          : isAz
            ? "Xeyr. TikTok Chatwoot-da qalır, LeadDrive isə bu dialoqları ayrıca TikTok kanalı kimi göstərir."
            : "No. TikTok stays in Chatwoot, while LeadDrive receives and shows those conversations as a separate TikTok channel.",
      },
      ...generic.slice(0, 2),
    ]
  }

  if (guide.formChannelId === "facebook" || guide.formChannelId === "instagram" || guide.formChannelId === "whatsapp-business") {
    return [
      {
        q: isRu ? "Нужен ли отдельный Meta-доступ?" : isAz ? "Ayrıca Meta girişi lazımdır?" : "Do I need Meta access?",
        a: isRu
          ? "Да. Для WhatsApp, Facebook и Instagram нужен доступ к правильному Meta Business / Meta-приложению тенанта и webhook-настройкам."
          : isAz
            ? "Bəli. WhatsApp, Facebook və Instagram üçün düzgün tenant Meta Business / Meta tətbiq və webhook parametrlərinə giriş lazımdır."
            : "Yes. WhatsApp, Facebook and Instagram need access to the correct tenant Meta Business / Meta app and webhook settings.",
      },
      ...generic,
    ]
  }

  if (guide.formChannelId?.includes("sms")) {
    return [
      {
        q: isRu ? "Почему для SMS выбран ATL?" : isAz ? "SMS üçün niyə ATL seçilib?" : "Why is ATL used for SMS?",
        a: isRu
          ? "ATL — основной SMS-маршрут для Азербайджана. Twilio/Vonage оставлены как fallback для международных случаев."
          : isAz
            ? "ATL Azərbaycan üçün əsas SMS marşrutudur. Twilio/Vonage beynəlxalq hallar üçün fallback kimi saxlanılıb."
            : "ATL is the primary SMS route for Azerbaijan. Twilio/Vonage remain fallback options for international cases.",
      },
      ...generic,
    ]
  }

  if (guide.id === "website-chat" || guide.id === "custom-business" || guide.id === "custom-live-chat") {
    return [
      {
        q: isRu ? "Почему здесь нет обычной формы ключей?" : isAz ? "Niyə burada adi açar forması yoxdur?" : "Why is there no normal credential form here?",
        a: isRu
          ? "Этот канал настраивается на отдельной странице: веб-чат — в настройках виджета, custom channel — в интеграциях и webhook mapping."
          : isAz
            ? "Bu kanal ayrıca səhifədə qurulur: veb-çat widget parametrlərində, custom channel isə inteqrasiyalar və webhook mapping-də."
            : "This channel uses a dedicated setup page: web chat in widget settings, custom channel in integrations and webhook mapping.",
      },
      ...generic.slice(1),
    ]
  }

  return generic
}

export default function ChannelConnectPage() {
  return (
    <Suspense fallback={<div className="force-light min-h-[calc(100vh-170px)] rounded-[28px] border bg-white" />}>
      <ChannelConnectInner />
    </Suspense>
  )
}

function ChannelConnectInner() {
  const params = useParams<{ channel: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const loc = localeKey(useLocale())
  const c = loc === "ru" ? copy.ru : loc === "az" ? copy.az : copy.en
  const guide = useMemo(() => getGuide(String(params.channel || ""), loc), [params.channel, loc])
  const initialMode = searchParams.get("mode") === "existing" ? "existing" : "new"
  const urlStage = searchParams.get("stage")
  const requestedChannelId = searchParams.get("channelId")
  // Result of a Meta OAuth round trip — the callback now returns here instead of Social Monitoring.
  const oauthConnected = searchParams.get("connected")
  const oauthPages = searchParams.get("pages")
  const oauthIg = searchParams.get("ig")
  const oauthError = searchParams.get("error")
  const [mode, setMode] = useState<ConnectMode>(initialMode)
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState(0)
  const [readinessAnswersByGuide, setReadinessAnswersByGuide] = useState<Record<string, Record<number, number>>>({})
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0)
  const [channelsSnapshot, setChannelsSnapshot] = useState<ChannelsSnapshot | null>(null)
  const [whatsappSmokeRunning, setWhatsappSmokeRunning] = useState(false)
  const [whatsappSmokeResult, setWhatsappSmokeResult] = useState<WhatsAppCallingSmokeResult | null>(null)
  const orgId = session?.user?.organizationId
  const orgSlug = session?.user?.organizationSlug
  const isWhatsAppCallingGuide = guide?.id === "whatsapp-business-calls"
  // Facebook/Instagram connect in one OAuth click, which creates the ChannelConfig server-side. The
  // card must then EDIT that row: without the snapshot the form stays in create mode and a save
  // would produce a second channel of the same type.
  const isMetaOneClickGuide = guide?.formChannelId === "facebook" || guide?.formChannelId === "instagram"
  // The callback reports what the OAuth wired for the whole Meta login, not for the card the user is
  // standing on — and the Instagram card deliberately starts the FACEBOOK flow, because IG Direct is
  // delivered through the linked Page's webhook. So a Page with no linked Instagram business account
  // comes back as ?connected=facebook&pages=1&ig=0: real for Facebook, nothing at all for Instagram.
  // A green "Channel connected" on the Instagram card in that state is simply false, and it is the
  // state the user is least able to diagnose on their own — hence the explicit explanation below.
  const oauthPageCount = positiveCountParam(oauthPages)
  const oauthIgCount = positiveCountParam(oauthIg)
  // Only the two Meta cards can be an OAuth return target (lib/social/oauth-return), so on any other
  // guide a `?connected=` is hand-typed, not a result — say nothing rather than describe someone
  // else's Facebook Page.
  const showOauthResult = Boolean(oauthConnected) && isMetaOneClickGuide
  const oauthWiredForThisChannel =
    guide?.formChannelId === "instagram" ? oauthIgCount > 0 : oauthPageCount > 0
  const needsChannelSnapshot = isWhatsAppCallingGuide || isMetaOneClickGuide || Boolean(requestedChannelId)
  const stage = connectStageFromParam(urlStage) || "intro"
  const whatsappCallingTenantSlug = orgSlug || TENANT_SLUG_PLACEHOLDER
  const whatsappCallingCallbackUrl = `${LEADDRIVE_APP_ORIGIN}/api/v1/webhooks/whatsapp?t=${encodeURIComponent(whatsappCallingTenantSlug)}`

  useEffect(() => {
    if (!needsChannelSnapshot || !orgId) return
    let cancelled = false
    fetch("/api/v1/channels", {
      headers: { "x-organization-id": String(orgId) },
    })
      .then(async (res) => {
        const result = await res.json().catch(() => ({ data: [] })) as {
          data?: ChannelConfigSummary[]
          message?: string
          error?: string
        }
        if (!res.ok) {
          const error: ChannelFetchError =
            res.status === 403 && typeof result.message === "string" && result.message.includes("omnichannel")
              ? "moduleDisabled"
              : "requestFailed"
          if (!cancelled) setChannelsSnapshot({ orgId: String(orgId), data: [], error })
          return
        }
        if (!cancelled) setChannelsSnapshot({ orgId: String(orgId), data: result.data || [], error: null })
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setChannelsSnapshot({ orgId: String(orgId), data: [], error: "requestFailed" })
      })
    return () => {
      cancelled = true
    }
  }, [needsChannelSnapshot, orgId])

  const channels = useMemo(
    () => channelsSnapshot?.orgId === String(orgId || "") ? channelsSnapshot.data : [],
    [channelsSnapshot, orgId]
  )
  const channelsError = channelsSnapshot?.orgId === String(orgId || "") ? channelsSnapshot.error : null
  const channelsLoading = needsChannelSnapshot && Boolean(orgId) && channelsSnapshot?.orgId !== String(orgId || "")
  const requestedChannel = useMemo(
    () => requestedChannelId ? channels.find((channel) => channel.id === requestedChannelId) || null : null,
    [channels, requestedChannelId]
  )
  const whatsappMessagingChannel = useMemo(
    () => channels.find((channel) => channel.channelType === "whatsapp" && channel.isActive)
      || channels.find((channel) => channel.channelType === "whatsapp")
      || null,
    [channels]
  )
  const metaFormChannelType = isMetaOneClickGuide ? guide?.formChannelId : undefined
  const existingMetaChannel = useMemo(
    () => {
      if (!metaFormChannelType) return null
      const matches = channels.filter((channel) => channel.channelType === metaFormChannelType)
      // Same preference as the catalog: a Model B tenant can hold a Meta-app config row AND the page
      // row OAuth wrote. Editing the delivering one keeps the form's connection state truthful.
      return matches.find((channel) => channelIsLiveConnection(channel))
        || matches.find((channel) => channel.isActive)
        || matches[0]
        || null
    },
    [channels, metaFormChannelType]
  )
  // Memoised so its identity is stable across re-renders: ChannelConfigForm resets its fields
  // whenever `initialData` changes, and a fresh object each render would wipe what the user typed.
  const metaFormInitialData = useMemo(
    () => existingMetaChannel
      ? {
          ...existingMetaChannel,
          phoneNumber: existingMetaChannel.phoneNumber || undefined,
          pageId: existingMetaChannel.pageId || undefined,
          appId: existingMetaChannel.appId || undefined,
          webhookUrl: existingMetaChannel.webhookUrl || undefined,
          verifyToken: existingMetaChannel.verifyToken || undefined,
          displayName: existingMetaChannel.displayName || undefined,
          settings: existingMetaChannel.settings || undefined,
        }
      : null,
    [existingMetaChannel]
  )
  const formInitialData = useMemo(() => (
    guide?.formChannelId
      ? {
          configName:
            guide.formChannelId === "tiktok" ? "TikTok via Chatwoot" :
            guide.formChannelId === "whatsapp-business" ? "WhatsApp Business" :
            guide.title,
          channelType:
            guide.formChannelId === "whatsapp-business" ? "whatsapp" :
            guide.formChannelId === "tiktok" ? "chatwoot" :
            guide.formChannelId === "atl-sms" || guide.formChannelId === "twilio-sms" || guide.formChannelId === "vonage-sms" ? "sms" :
            guide.formChannelId === "google-workspace" || guide.formChannelId === "gmail" || guide.formChannelId === "other-email" ? "email" :
            guide.formChannelId,
          settings:
            guide.formChannelId === "tiktok" ? { provider: "tiktok" } :
            guide.formChannelId === "atl-sms" ? { smsProvider: "atl" } :
            guide.formChannelId === "twilio-sms" ? { smsProvider: "twilio" } :
            guide.formChannelId === "vonage-sms" ? { smsProvider: "vonage" } :
            undefined,
          isActive: true,
        }
      : undefined
  ), [guide])
  const effectiveFormInitialData =
    requestedChannel
      ? {
          ...requestedChannel,
          phoneNumber: requestedChannel.phoneNumber || undefined,
          pageId: requestedChannel.pageId || undefined,
          appId: requestedChannel.appId || undefined,
          webhookUrl: requestedChannel.webhookUrl || undefined,
          verifyToken: requestedChannel.verifyToken || undefined,
          displayName: requestedChannel.displayName || undefined,
          settings: requestedChannel.settings || undefined,
        }
      : isWhatsAppCallingGuide && whatsappMessagingChannel
      ? {
          ...whatsappMessagingChannel,
          phoneNumber: whatsappMessagingChannel.phoneNumber || undefined,
          pageId: whatsappMessagingChannel.pageId || undefined,
          appId: whatsappMessagingChannel.appId || undefined,
          webhookUrl: whatsappMessagingChannel.webhookUrl || undefined,
          verifyToken: whatsappMessagingChannel.verifyToken || undefined,
          displayName: whatsappMessagingChannel.displayName || undefined,
          settings: whatsappMessagingChannel.settings || undefined,
        }
      : isMetaOneClickGuide && metaFormInitialData
      ? metaFormInitialData
      : formInitialData

  // ---- What the OAuth return banner is allowed to claim -----------------------------------------
  // The banner used to be decided by the URL alone (`?connected=…&pages=…&ig=…`), i.e. by what Meta
  // said happened, never by what LeadDrive actually stored. That is how a green "Channel connected"
  // came to sit directly above the form's "Not delivering — Meta refused the subscription" on the very
  // same screen, and how it survived a missing channel row and a switched-off one.
  //
  // So the banner reads the SAME row the form below it renders (`effectiveFormInitialData` resolves to
  // requestedChannel, else the Meta row) through the SAME predicate the catalog uses. Two elements of
  // one screen, one source of truth: whatever they say, they now say together.
  const oauthBannerRow = isMetaOneClickGuide ? (requestedChannel || existingMetaChannel) : null
  const oauthBannerRowState = oauthBannerRow ? channelConnectionState(oauthBannerRow) : null
  // "There is no row" is a verdict, and it is only available once the channel list is in hand. While
  // it is still loading, or the session has no org yet, or the list failed to load, the page knows
  // nothing beyond the URL — the exact half-truth this banner exists to stop repeating. Say so
  // instead of guessing in either direction.
  const oauthRowUnknown = !oauthBannerRow && (!orgId || channelsLoading || Boolean(channelsError))
  const oauthBannerTone: "success" | "pending" | "warning" =
    // Meta itself reported nothing for this card — no row lookup can rescue that.
    !oauthWiredForThisChannel
      ? "warning"
      : oauthRowUnknown
        ? "pending"
        : oauthBannerRowState === "live"
          ? "success"
          : "warning"
  const oauthBannerTitle =
    oauthBannerTone === "pending"
      ? c.oauthCheckingTitle
      : oauthBannerTone === "success"
        ? c.oauthSuccessTitle
        // A stored, wired Page that is switched off or unsubscribed IS connected — it just does not
        // deliver. Calling that "still not connected" would send the user back through an OAuth that
        // has nothing left to fix.
        : oauthWiredForThisChannel
          && (oauthBannerRowState === "paused" || oauthBannerRowState === "needsReconnect")
          ? c.oauthNotDeliveringTitle
          : c.oauthPartialTitle
  const oauthBannerDesc =
    oauthBannerTone === "pending"
      ? (channelsError ? c.oauthUnverifiedDesc : c.oauthCheckingDesc)
      : oauthBannerTone === "success"
        ? c.oauthSuccessDesc
            .replace("{pages}", String(oauthPageCount))
            .replace("{ig}", String(oauthIgCount))
        : !oauthWiredForThisChannel
          ? (guide?.formChannelId === "instagram"
              ? c.oauthNoInstagramDesc.replace("{pages}", String(oauthPageCount))
              : c.oauthNoPageDesc)
          // Word-for-word the sentence the form prints for this state (lib/channels/connection-reason),
          // so the two elements cannot drift into describing one row two ways.
          : oauthBannerRowState && oauthBannerRowState !== "live"
            ? metaConnectionReason(loc, oauthBannerRowState)
            : c.oauthNoChannelRowDesc

  if (!guide) {
    return (
      <div className="force-light rounded-[28px] border bg-white p-8 text-zinc-950 shadow-sm">
        <Button asChild variant="ghost" className="mb-6 gap-2">
          <Link href="/settings/channels">
            <ArrowLeft className="h-4 w-4" />
            {c.back}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{c.notFoundTitle}</h1>
        <p className="mt-2 text-sm text-zinc-600">{c.notFoundDesc}</p>
      </div>
    )
  }

  const Icon = guide.icon
  const readinessAnswers = readinessAnswersByGuide[guide.id] || {}
  const currentStep = guide.eligibility.steps[stepIndex]
  const isLastStep = stepIndex >= guide.eligibility.steps.length - 1
  const scenarioOptions = getScenarioOptions(guide, loc, {
    newTitle: c.newAccount,
    newDescription: c.newAccountDesc,
    existingTitle: c.existingAccount,
    existingDescription: c.existingAccountDesc,
  })
  const selectedScenario = scenarioOptions.find((item) => item.value === mode) || scenarioOptions[0]
  const selectedScenarioTitle = selectedScenario.title
  const selectedScenarioDescription = selectedScenario.description
  const currentAnswerIndex = readinessAnswers[stepIndex] ?? selectedOption
  const selectedAnswer = currentStep?.options[currentAnswerIndex]
  const processSteps: Array<{ key: ConnectStage; label: string }> = [
    { key: "intro", label: c.stepIntro },
    { key: "eligibility", label: c.stepEligibility },
    { key: "connect", label: c.stepConnect },
  ]
  const activeStepIndex = processSteps.findIndex((item) => item.key === stage)
  const readyChecklist = Array.from(new Set([
    ...guide.resources.slice(0, 2),
    ...guide.tutorial.steps.slice(0, 2),
  ])).slice(0, 4)
  const channelRequirements = getChannelRequirements(guide, loc)
  const stageHref = (nextStage: ConnectStage) => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set("stage", nextStage)
    nextParams.set("mode", mode)
    // The OAuth result belongs to the moment it arrived. stageHref deliberately forwards unknown
    // params between stages, so without this the "Channel connected" banner would follow the user
    // to intro/eligibility and describe an action they are no longer taking.
    nextParams.delete("connected")
    nextParams.delete("pages")
    nextParams.delete("ig")
    nextParams.delete("error")
    return `/settings/channels/connect/${guide.id}?${nextParams.toString()}`
  }
  const externalCredentialHref = guide.id === "website-chat"
    ? "/settings/web-chat"
    : guide.id === "custom-business" || guide.id === "custom-live-chat"
      ? "/settings/integrations"
      : guide.id === "twilio-calls" || guide.id === "threecx" || guide.id === "asterisk" || guide.id === "custom-sip"
        ? "/settings/voip"
        : "/settings/channels"
  const credentialHref = guide.formChannelId ? stageHref("connect") : externalCredentialHref
  const goToStage = (nextStage: ConnectStage) => {
    if (nextStage === "eligibility") {
      setStepIndex(0)
      setSelectedOption(readinessAnswers[0] ?? 0)
    }
    router.push(stageHref(nextStage), { scroll: false })
  }
  const tutorialSteps = guide.tutorial.steps
  const tutorialStep = tutorialSteps[tutorialStepIndex] || tutorialSteps[0] || guide.tutorial.title
  const tutorialProgress = tutorialSteps.length ? tutorialStepIndex + 1 : 1
  const tutorialStageLabels = [c.stepIntro, c.stepEligibility, c.stepConnect, c.afterConnectTitle]
  const tutorialStageLabel = tutorialStageLabels[Math.min(tutorialStepIndex, tutorialStageLabels.length - 1)] || c.stepIntro
  const tutorialScreen = getTutorialScreenGuide(guide, loc, channelRequirements)
  const providerPreviewSteps = tutorialScreen.providerActions
  const leadDrivePreviewSteps = tutorialScreen.leadDriveActions
  const faqItems = getChannelFaq(guide, loc, channelRequirements, tutorialScreen)
  const isMetaGuide =
    guide.formChannelId === "whatsapp-business"
    || guide.formChannelId === "facebook"
    || guide.formChannelId === "instagram"
  const isTikTokChatwootGuide = guide.formChannelId === "tiktok"
  const metaCopy = loc === "ru"
    ? {
        title: "Meta setup: что именно нужно сделать",
        description: "Эти каналы подключаются через Meta. Сначала проверьте доступы и права, потом сохраните ключи в LeadDrive и только после этого отправьте один тестовый входящий диалог.",
        appTitle: "1. Meta App и права",
        appDescription: "Откройте Meta Developers или Business Manager, проверьте App ID, App Secret, Verify Token и нужные permissions.",
        accountTitle:
          guide.formChannelId === "whatsapp-business"
            ? "2. WABA и телефон"
            : guide.formChannelId === "instagram"
              ? "2. Instagram Login или linked Page"
              : "2. Facebook Page",
        accountDescription:
          guide.formChannelId === "whatsapp-business"
            ? "Выберите WhatsApp Business Account, номер, шаблоны и webhook-подписку для сообщений."
            : guide.formChannelId === "instagram"
              ? "Подключите professional Instagram account через Instagram Login или связанную Facebook Page."
              : "Выберите Facebook Page и выдайте доступ к сообщениям Page для Messenger.",
        verifyTitle: "3. Webhook и тест",
        verifyDescription: "Подпишите webhook, сохраните канал в LeadDrive и отправьте один тестовый DM/сообщение в Inbox до живого трафика.",
        badge: "Meta-подключение",
      }
    : loc === "az"
      ? {
          title: "Meta setup: dəqiq nə etmək lazımdır",
          description: "Bu kanallar Meta üzərindən qoşulur. Əvvəl girişləri və icazələri yoxlayın, sonra açarları LeadDrive-da saxlayın və yalnız bundan sonra bir test inbound dialoq göndərin.",
          appTitle: "1. Meta App və icazələr",
          appDescription: "Meta Developers və ya Business Manager-i açın, App ID, App Secret, Verify Token və lazımi permissions yoxlayın.",
          accountTitle:
            guide.formChannelId === "whatsapp-business"
              ? "2. WABA və telefon"
              : guide.formChannelId === "instagram"
                ? "2. Instagram Login və ya linked Page"
                : "2. Facebook Page",
          accountDescription:
            guide.formChannelId === "whatsapp-business"
              ? "WhatsApp Business Account, nömrə, şablonlar və message webhook abunəsini seçin."
              : guide.formChannelId === "instagram"
                ? "Professional Instagram hesabını Instagram Login və ya bağlı Facebook Page ilə qoşun."
                : "Facebook Page seçin və Messenger üçün Page messages girişini verin.",
          verifyTitle: "3. Webhook və test",
          verifyDescription: "Webhook-u abunə edin, kanalı LeadDrive-da saxlayın və canlı trafikdən əvvəl Inbox-a bir test DM/mesaj göndərin.",
          badge: "Meta qoşulması",
        }
      : {
          title: "Meta setup: the exact path",
          description: "These channels connect through Meta. Confirm access and permissions first, save the credentials in LeadDrive, then send one controlled inbound conversation before live traffic.",
          appTitle: "1. Meta App and permissions",
          appDescription: "Open Meta Developers or Business Manager, then confirm App ID, App Secret, Verify Token and the required permissions.",
          accountTitle:
            guide.formChannelId === "whatsapp-business"
              ? "2. WABA and phone number"
              : guide.formChannelId === "instagram"
                ? "2. Instagram Login or linked Page"
                : "2. Facebook Page",
          accountDescription:
            guide.formChannelId === "whatsapp-business"
              ? "Choose the WhatsApp Business Account, phone number, templates and message webhook subscription."
              : guide.formChannelId === "instagram"
                ? "Connect the professional Instagram account through Instagram Login or a linked Facebook Page."
                : "Choose the Facebook Page and grant Page messaging access for Messenger.",
          verifyTitle: "3. Webhook and test",
          verifyDescription: "Subscribe the webhook, save the channel in LeadDrive and send one test DM/message into Inbox before live traffic.",
          badge: "Meta connection",
        }
  const metaSetupItems = [
    {
      title: metaCopy.appTitle,
      description: metaCopy.appDescription,
      icon: ShieldCheck,
    },
    {
      title: metaCopy.accountTitle,
      description: metaCopy.accountDescription,
      icon: guide.formChannelId === "instagram" ? AtSign : MessagesSquare,
    },
    {
      title: metaCopy.verifyTitle,
      description: metaCopy.verifyDescription,
      icon: Webhook,
    },
  ]
  const chatwootCopy = loc === "ru"
    ? {
        title: "TikTok подключается через Chatwoot",
        description: "LeadDrive не подключает TikTok напрямую. Chatwoot принимает TikTok DM, а LeadDrive зеркалит диалог в Inbox как отдельный TikTok-канал.",
        inboxTitle: "1. TikTok inbox в Chatwoot",
        inboxDescription: "Создайте или выберите TikTok inbox в Chatwoot и убедитесь, что туда приходит тестовый DM.",
        credentialsTitle: "2. Ключи Chatwoot",
        credentialsDescription: "Подготовьте Base URL, Account ID, API access token и webhook secret. Inbox ID в LeadDrive не вводится.",
        leadDriveTitle: "3. LeadDrive mirror",
        leadDriveDescription: "Сохраните канал как TikTok через Chatwoot, затем проверьте один TikTok DM в LeadDrive Inbox.",
        badge: "Chatwoot bridge",
      }
    : loc === "az"
      ? {
          title: "TikTok Chatwoot vasitəsilə qoşulur",
          description: "LeadDrive TikTok-u birbaşa qoşmur. Chatwoot TikTok DM-ləri qəbul edir, LeadDrive isə dialoqu Inbox-da ayrıca TikTok kanalı kimi göstərir.",
          inboxTitle: "1. Chatwoot-da TikTok inbox",
          inboxDescription: "Chatwoot-da TikTok inbox yaradın və ya seçin, test DM-in ora gəldiyini yoxlayın.",
          credentialsTitle: "2. Chatwoot açarları",
          credentialsDescription: "Base URL, Account ID, API access token və webhook secret hazırlayın. LeadDrive-da Inbox ID yazılmır.",
          leadDriveTitle: "3. LeadDrive mirror",
          leadDriveDescription: "Kanalı TikTok via Chatwoot kimi saxlayın, sonra LeadDrive Inbox-da bir TikTok DM yoxlayın.",
          badge: "Chatwoot bridge",
        }
      : {
          title: "TikTok connects through Chatwoot",
          description: "LeadDrive does not connect TikTok directly. Chatwoot receives TikTok DMs, while LeadDrive mirrors the thread into Inbox as its own TikTok channel.",
          inboxTitle: "1. TikTok inbox in Chatwoot",
          inboxDescription: "Create or select the TikTok inbox in Chatwoot and confirm one test DM reaches it.",
          credentialsTitle: "2. Chatwoot credentials",
          credentialsDescription: "Prepare Base URL, Account ID, API access token and webhook secret. LeadDrive does not ask for Inbox ID.",
          leadDriveTitle: "3. LeadDrive mirror",
          leadDriveDescription: "Save the channel as TikTok via Chatwoot, then verify one TikTok DM in LeadDrive Inbox.",
          badge: "Chatwoot bridge",
        }
  const chatwootSetupItems = [
    {
      title: chatwootCopy.inboxTitle,
      description: chatwootCopy.inboxDescription,
      icon: MessageCircle,
    },
    {
      title: chatwootCopy.credentialsTitle,
      description: chatwootCopy.credentialsDescription,
      icon: ShieldCheck,
    },
    {
      title: chatwootCopy.leadDriveTitle,
      description: chatwootCopy.leadDriveDescription,
      icon: Webhook,
    },
  ]
  const readinessSummaryItems = guide.eligibility.steps.map((step, index) => ({
    label: step.label,
    answer: typeof readinessAnswers[index] === "number"
      ? step.options[readinessAnswers[index]]
      : undefined,
  }))
  const credentialFormBlock = effectiveFormInitialData ? (
    <div id="channel-credential-form" className="mt-6 scroll-mt-24" data-channel-config-form>
      <ChannelConfigForm
        variant="inline"
        open
        onOpenChange={(open) => {
          if (!open) router.push("/settings/channels")
        }}
        onSaved={() => router.push("/settings/channels")}
        initialData={effectiveFormInitialData}
        orgId={orgId}
        orgSlug={orgSlug}
        lockChannelType
        lockChannelTypeLabel={guide.title}
        lockChannelTypeHint={guide.connect.description}
        setupIntent={mode}
        guidanceMode="compact"
      />
    </div>
  ) : null
  const externalCredentialActions = !effectiveFormInitialData ? (
    <div className="mt-6 flex flex-wrap gap-4">
      <Button asChild className="gap-2 bg-orange-600 text-white hover:bg-orange-700">
        <Link href={credentialHref}>
          {guide.connect.primary}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
      <Button asChild variant="ghost" className="text-orange-700 hover:bg-orange-50 hover:text-orange-800">
        <Link href={credentialHref}>{guide.connect.secondary}</Link>
      </Button>
    </div>
  ) : null
  const connectionMapItems = [
    {
      title: c.providerWorkTitle,
      description: c.providerWorkDesc,
      icon: ExternalLink,
      items: providerPreviewSteps.slice(0, 3),
      tone: "neutral" as const,
    },
    {
      title: c.leadDriveWorkTitle,
      description: c.leadDriveWorkDesc,
      icon: ShieldCheck,
      items: leadDrivePreviewSteps.slice(0, 3),
      tone: "accent" as const,
    },
    {
      title: c.validationWorkTitle,
      description: c.validationWorkDesc,
      icon: CheckCircle2,
      items: channelRequirements.verify.slice(0, 3),
      tone: "success" as const,
    },
  ]
  const compactConnectSteps = [
    {
      title: c.providerWorkTitle,
      description: providerPreviewSteps[0] || channelRequirements.prepare[0],
      icon: ExternalLink,
      tone: "neutral" as const,
    },
    {
      title: c.leadDriveWorkTitle,
      description: tutorialScreen.leadDriveFields.slice(0, 3).join(" · "),
      icon: ShieldCheck,
      tone: "accent" as const,
    },
    {
      title: c.validationWorkTitle,
      description: channelRequirements.verify[0] || tutorialScreen.finalCheck,
      icon: CheckCircle2,
      tone: "success" as const,
    },
  ]
  const statusCopy = whatsappCredentialStatusCopy[loc]
  const whatsappModuleDisabled = channelsError === "moduleDisabled"
  const whatsappReadinessMessage =
    channelsLoading
      ? statusCopy.loading
      : whatsappModuleDisabled
        ? statusCopy.moduleDisabled
        : channelsError
          ? statusCopy.loadFailed
          : whatsappMessagingChannel
            ? statusCopy.hint
            : statusCopy.noChannel
  const whatsappCredentialChecks = whatsappMessagingChannel
    ? [
        { label: statusCopy.accessToken, ready: Boolean(whatsappMessagingChannel.hasAccessToken) },
        { label: statusCopy.phoneNumberId, ready: Boolean(whatsappMessagingChannel.hasPhoneNumberId) },
        { label: statusCopy.verifyToken, ready: Boolean(whatsappMessagingChannel.hasVerifyToken) },
        { label: statusCopy.appSecret, ready: Boolean(whatsappMessagingChannel.hasAppSecret) },
      ]
    : []
  const whatsappCredentialsReady =
    whatsappCredentialChecks.length > 0 && whatsappCredentialChecks.every((check) => check.ready)
  const whatsappSmokeCanRun = !whatsappModuleDisabled && !channelsLoading
  const whatsappSmokeDisabledReason =
    channelsLoading
      ? statusCopy.loading
      : whatsappModuleDisabled
        ? statusCopy.moduleDisabled
        : null
  const openTutorial = (index = 0) => {
    const lastIndex = Math.max(0, tutorialSteps.length - 1)
    setTutorialStepIndex(Math.min(Math.max(index, 0), lastIndex))
    setTutorialOpen(true)
  }
  const runWhatsAppCallingSmoke = async () => {
    if (!whatsappSmokeCanRun || whatsappSmokeRunning) return
    setWhatsappSmokeRunning(true)
    setWhatsappSmokeResult(null)
    try {
      const res = await fetch("/api/v1/calls/whatsapp/smoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ confirm: "create-whatsapp-calling-smoke", direction: "outbound" }),
      })
      const payload = await res.json().catch(() => ({})) as {
        success?: boolean
        error?: string
        data?: Partial<{
          callSid: string
          status: string
          conversationId: string
          customerPhone: string
          inboxUrl: string
          warning: string
        }>
      }
      if (!res.ok || !payload.success || !payload.data?.inboxUrl) {
        throw new Error(payload.error || c.whatsappCallingSmokeFailed)
      }
      setWhatsappSmokeResult({
        ok: true,
        callSid: payload.data.callSid || "wa-smoke",
        status: payload.data.status || "ringing",
        conversationId: payload.data.conversationId || "",
        customerPhone: payload.data.customerPhone || "",
        inboxUrl: payload.data.inboxUrl,
        warning: payload.data.warning || c.whatsappCallingSmokeNoExternal,
      })
    } catch (error) {
      setWhatsappSmokeResult({
        ok: false,
        message: error instanceof Error ? error.message : c.whatsappCallingSmokeFailed,
      })
    } finally {
      setWhatsappSmokeRunning(false)
    }
  }
  return (
    <div className="force-light overflow-hidden rounded-[28px] border border-zinc-200 bg-[#f8fafc] text-zinc-950 shadow-[0_24px_80px_rgba(15,23,42,0.10)] lg:overflow-visible">
      <div className={cn(
        "grid min-h-[calc(100vh-170px)]",
        stage === "connect" ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-[320px_minmax(0,1fr)]",
      )}>
        <aside
          data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-sidebar" : undefined}
          className={cn(
            "min-w-0 border-b border-zinc-200 bg-white p-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r",
            stage === "connect" ? "order-last lg:order-none lg:p-5" : "",
          )}
        >
          <Button asChild variant="ghost" className={cn("-ml-2 gap-2 text-orange-700 hover:bg-orange-50 hover:text-orange-800", stage === "connect" ? "mb-5" : "mb-8")}>
            <Link href="/settings/channels">
              <ArrowLeft className="h-4 w-4" />
              {c.back}
            </Link>
          </Button>

          <div className={cn(
            "grid place-items-center border border-orange-200 bg-orange-50 font-black text-orange-600 shadow-inner",
            stage === "connect" ? "h-14 w-14 rounded-2xl" : "h-28 w-28 rounded-[32px] text-3xl",
          )}>
            <Icon className={cn(stage === "connect" ? "h-7 w-7" : "h-14 w-14")} />
          </div>
          <h1 className={cn("break-words font-semibold leading-tight tracking-tight", stage === "connect" ? "mt-4 text-xl" : "mt-7 text-3xl")}>{guide.title}</h1>
          <p className={cn("max-w-[24rem] text-sm text-zinc-600", stage === "connect" ? "mt-2 leading-6" : "mt-5 leading-7")}>{guide.sideDescription}</p>

          {stage !== "connect" ? (
            <button
              type="button"
              onClick={() => openTutorial(0)}
              className="mt-8 flex items-center gap-3 text-left text-sm font-semibold text-orange-700 hover:text-orange-800"
            >
              <PlayCircle className="h-4 w-4" />
              {c.videoTutorial}
            </button>
          ) : null}

          <div className={cn("rounded-3xl border border-zinc-200 bg-zinc-50 p-4", stage === "connect" ? "mt-5" : "mt-8")}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {c.processTitle}
            </p>
            <div className="mt-4 space-y-2">
              {processSteps.map((item, index) => {
                const isActive = item.key === stage
                const isDone = index < activeStepIndex
                return (
                  <Link
                    data-video-target={isWhatsAppCallingGuide ? `whatsapp-calls-stage-${item.key}` : undefined}
                    key={item.key}
                    href={stageHref(item.key)}
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`${index + 1}. ${item.label}`}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm font-semibold transition",
                      isActive
                        ? "border-orange-300 bg-white text-orange-700 shadow-sm"
                        : isDone
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-transparent bg-transparent text-zinc-600 hover:border-orange-200 hover:bg-white hover:text-orange-700",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs",
                        isActive
                          ? "bg-orange-600 text-white"
                          : isDone
                            ? "bg-emerald-600 text-white"
                            : "bg-white text-zinc-500 ring-1 ring-zinc-200",
                      )}
                      aria-hidden="true"
                    >
                      {isDone ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>

          {stage !== "connect" ? (
            <>
              <div className="mt-5 grid gap-3">
                <div className="rounded-3xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                    {c.readyBeforeTitle}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {channelRequirements.prepare.slice(0, 3).map((item) => (
                      <li key={item} className="flex gap-2 text-xs leading-5 text-zinc-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {c.afterConnectTitle}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {channelRequirements.verify.slice(0, 2).map((item) => (
                      <li key={item} className="flex gap-2 text-xs leading-5 text-zinc-700">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-10">
                <h2 className="text-lg font-semibold">{c.additionalResources}</h2>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-orange-700">
                  {guide.resources.map((resource, index) => (
                    <li key={resource}>
                      <button
                        type="button"
                        onClick={() => openTutorial(index)}
                        aria-label={`${resource}. ${c.resourceAction}`}
                        className="group flex w-full gap-3 rounded-2xl border border-transparent p-2 text-left transition hover:border-orange-200 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                      >
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                        <span className="min-w-0 break-words">
                          <span className="block text-zinc-700 group-hover:text-orange-800">{resource}</span>
                          <span className="mt-1 block text-xs font-semibold text-orange-600">{c.resourceAction}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="secondary" className="mt-5 border border-zinc-200 bg-white">
                  <Link href="/knowledge-base">
                    <BookOpen className="mr-2 h-4 w-4" />
                    {c.learnMore}
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.tutorialPlayerFieldMap}</p>
              <p className="mt-2 break-words text-sm font-semibold leading-6 text-orange-950">
                {tutorialScreen.leadDriveFields.slice(0, 3).join(" · ")}
              </p>
              <button
                type="button"
                onClick={() => openTutorial(0)}
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-orange-700 hover:text-orange-900"
              >
                <PlayCircle className="h-4 w-4" />
                {c.quickStartGuideAction}
              </button>
            </div>
          )}
        </aside>

        <main
          className={cn(
            "relative min-w-0 p-6 lg:p-10",
            stage === "connect" ? "order-first lg:order-none" : "",
          )}
        >
          <div className="mx-auto max-w-5xl">
            {stage !== "connect" ? (
              <div className="mb-8 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm">
                <Info className="h-5 w-5 shrink-0 text-orange-600" />
                <span>{c.helpBanner}</span>
              </div>
            ) : null}

            {stage !== "connect" ? (
              <section
                data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-map" : undefined}
                className="mb-8 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm"
              >
                <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                        {c.channelSetup}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                        {c.connectionMapTitle}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                        {c.connectionMapDesc}
                      </p>
                    </div>
                    {guide.badge ? (
                      <Badge className="w-fit border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                        {guide.badge}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div
                  className="grid gap-4 p-5"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))" }}
                >
                  {connectionMapItems.map((item, index) => {
                    const MapIcon = item.icon
                    const iconClass =
                      item.tone === "success"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : item.tone === "accent"
                          ? "bg-orange-50 text-orange-700 ring-orange-200"
                          : "bg-zinc-100 text-zinc-700 ring-zinc-200"
                    const numberClass =
                      item.tone === "success"
                        ? "bg-emerald-600 text-white"
                        : item.tone === "accent"
                          ? "bg-orange-600 text-white"
                          : "bg-white text-zinc-600 ring-1 ring-zinc-200"
                    return (
                      <article
                        key={item.title}
                        className={cn(
                          "relative min-w-0 rounded-[1.35rem] border p-4",
                          item.tone === "success"
                            ? "border-emerald-200 bg-emerald-50/55"
                            : item.tone === "accent"
                              ? "border-orange-200 bg-orange-50/60"
                              : "border-zinc-200 bg-zinc-50",
                        )}
                      >
                        {index < connectionMapItems.length - 1 ? (
                          <div
                            aria-hidden="true"
                            className="absolute -right-5 top-10 z-10 hidden h-10 w-10 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm lg:grid"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        ) : null}
                        <div className="flex items-start gap-3">
                          <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1", iconClass)}>
                            <MapIcon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-bold", numberClass)}>
                                {index + 1}
                              </span>
                              <h3 className="break-words text-sm font-semibold leading-6 text-zinc-950">{item.title}</h3>
                            </div>
                            <p className="mt-2 break-words text-xs leading-5 text-zinc-600">{item.description}</p>
                          </div>
                        </div>
                        <ul className="mt-4 space-y-2">
                          {item.items.slice(0, 3).map((step) => (
                            <li key={step} className="flex gap-2 text-xs leading-5 text-zinc-700">
                              <CheckCircle2
                                className={cn(
                                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                                  item.tone === "success"
                                    ? "text-emerald-600"
                                    : item.tone === "accent"
                                      ? "text-orange-600"
                                      : "text-zinc-500",
                                )}
                              />
                              <span className="min-w-0 break-words">{step}</span>
                            </li>
                          ))}
                        </ul>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <div
              className={cn(
                "mb-8 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm lg:hidden",
                stage === "connect" ? "hidden" : "",
              )}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">{c.processTitle}</p>
                  <p className="mt-2 text-sm text-zinc-600">{guide.connect.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {processSteps.map((item, index) => {
                    const isActive = item.key === stage
                    const isDone = index < activeStepIndex
                    return (
                      <Link
                        key={item.key}
                        href={stageHref(item.key)}
                        aria-current={isActive ? "step" : undefined}
                        aria-label={`${index + 1}. ${item.label}`}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition",
                          isActive
                            ? "border-orange-300 bg-orange-50 text-orange-700"
                            : isDone
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-orange-200 hover:bg-zinc-100 hover:text-zinc-900",
                        )}
                      >
                        {isActive ? (
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-orange-600 text-[10px] text-white" aria-hidden="true">
                            {index + 1}
                          </span>
                        ) : isDone ? (
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-[10px] text-white" aria-hidden="true">
                            <CheckCircle2 className="h-3 w-3" />
                          </span>
                        ) : (
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] text-zinc-500" aria-hidden="true">
                            {index + 1}
                          </span>
                        )}
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>

            {isWhatsAppCallingGuide ? (
              <section
                data-tour-id="whatsapp-calls-readiness"
                className="mb-8 rounded-3xl border border-orange-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                      {c.readinessSummary}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-zinc-950">{statusCopy.title}</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                      {whatsappReadinessMessage}
                    </p>
                  </div>
                  {whatsappMessagingChannel || whatsappModuleDisabled ? (
                    <Badge className={cn(
                      "w-fit border text-xs",
                      whatsappModuleDisabled
                        ? "border-zinc-200 bg-zinc-100 text-zinc-600 hover:bg-zinc-100"
                        : whatsappCredentialsReady
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                        : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50"
                    )}>
                      {whatsappModuleDisabled
                        ? statusCopy.unavailable
                        : whatsappCredentialsReady
                          ? statusCopy.ready
                          : statusCopy.missing}
                    </Badge>
                  ) : null}
                </div>

                {whatsappMessagingChannel ? (
                  <>
                    <div className="mt-5 grid gap-2">
                      {whatsappCredentialChecks.map((check) => (
                        <div
                          key={check.label}
                          className={cn(
                            "min-w-0 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-medium",
                            check.ready
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-900"
                          )}
                        >
                          {check.ready ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <Info className="h-4 w-4 shrink-0 text-amber-700" />
                          )}
                          <span className="min-w-0 flex-1 break-words">{check.label}</span>
                          <span className="shrink-0">{check.ready ? statusCopy.ready : statusCopy.missing}</span>
                        </div>
                      ))}
                    </div>
                    {!whatsappCredentialsReady ? (
                      <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                        {statusCopy.blocked}
                      </p>
                    ) : null}
                  </>
                ) : null}

                {whatsappModuleDisabled ? (
                  <Button disabled variant="secondary" className="mt-5 border border-zinc-200 bg-zinc-100 text-zinc-500">
                    {statusCopy.moduleDisabledAction}
                  </Button>
                ) : (
                  <Button asChild variant="secondary" className="mt-5 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50">
                    <Link href={stageHref("connect")}>{statusCopy.openForm}</Link>
                  </Button>
                )}

                <div data-tour-id="whatsapp-calls-webhook" className="mt-5 rounded-3xl border border-orange-200 bg-orange-50/70 p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-orange-700 ring-1 ring-orange-200">
                      <Webhook className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-950">{c.whatsappCallingWebhookTitle}</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-700">{c.whatsappCallingWebhookHint}</p>
                      <dl className="mt-4 grid gap-3">
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.whatsappCallingWebhookCallback}</dt>
                          <dd className="mt-2 break-all rounded-2xl border border-orange-200 bg-white px-3 py-2 font-mono text-xs text-orange-900">
                            {whatsappCallingCallbackUrl}
                          </dd>
                          {!orgSlug ? (
                            <p className="mt-2 text-xs leading-5 text-orange-800">{c.whatsappCallingTenantFallback}</p>
                          ) : null}
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.whatsappCallingWebhookVerify}</dt>
                          <dd className="mt-2 rounded-2xl border border-orange-200 bg-white px-3 py-2 text-xs font-medium text-orange-900">
                            {statusCopy.verifyToken}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.whatsappCallingWebhookSubscribe}</dt>
                          <dd className="mt-2 rounded-2xl border border-orange-200 bg-white px-3 py-2 text-xs font-medium text-orange-900">
                            calls
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>

                <div data-tour-id="whatsapp-calls-smoke" className="mt-5 rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white text-orange-700 ring-1 ring-orange-200">
                          <PhoneCall className="h-4 w-4" />
                        </span>
                        <p className="text-sm font-semibold text-zinc-950">{c.whatsappCallingSmokeTitle}</p>
                      </div>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">{c.whatsappCallingSmokeDesc}</p>
                      <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">{c.whatsappCallingSmokeNoExternal}</p>
                    </div>
                    <Button
                      data-video-target="whatsapp-calls-smoke-button"
                      type="button"
                      onClick={runWhatsAppCallingSmoke}
                      disabled={!whatsappSmokeCanRun || whatsappSmokeRunning}
                      className="w-full shrink-0 bg-orange-600 text-white hover:bg-orange-700 disabled:bg-zinc-200 disabled:text-zinc-500 lg:w-auto"
                    >
                      {whatsappSmokeRunning ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <PhoneCall className="mr-2 h-4 w-4" />
                      )}
                      {whatsappSmokeRunning ? c.whatsappCallingSmokeRunning : c.whatsappCallingSmokeButton}
                    </Button>
                  </div>

                  {!whatsappSmokeCanRun && whatsappSmokeDisabledReason ? (
                    <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                      {whatsappSmokeDisabledReason}
                    </p>
                  ) : null}

                  {whatsappSmokeResult ? (
                    <div
                      aria-live="polite"
                      className={cn(
                        "mt-4 rounded-2xl border px-4 py-3 text-sm leading-6",
                        whatsappSmokeResult.ok
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-red-200 bg-red-50 text-red-900",
                      )}
                    >
                      {whatsappSmokeResult.ok ? (
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold">{c.whatsappCallingSmokeSuccess}</p>
                            <p className="mt-1 text-xs leading-5 text-emerald-900">
                              {whatsappSmokeResult.callSid} · {whatsappSmokeResult.status}
                              {whatsappSmokeResult.customerPhone ? ` · ${whatsappSmokeResult.customerPhone}` : ""}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-emerald-900">
                              {whatsappSmokeResult.warning} {c.whatsappCallingSmokeMetaReminder}
                            </p>
                          </div>
                          <Button asChild size="sm" className="shrink-0 bg-emerald-700 text-white hover:bg-emerald-800">
                            <Link href={whatsappSmokeResult.inboxUrl}>
                              {c.whatsappCallingSmokeOpenInbox}
                              <ArrowRight className="ml-2 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        <p>{whatsappSmokeResult.message}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {stage === "intro" ? (
              <section
                data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-intro" : undefined}
                className="grid max-w-6xl gap-6"
              >
                <div className="space-y-6">
                  <div>
                    <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      {c.channelSetup}
                    </Badge>
                    <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight">{guide.connect.title}</h2>
                    <p className="mt-4 max-w-3xl text-base leading-8 text-zinc-600">{guide.bodyDescription}</p>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
                    <div className="grid gap-5 border-b border-zinc-200 bg-[linear-gradient(135deg,#fff7ed,#ffffff_52%,#f4f4f5)] p-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="border-zinc-200 bg-white text-zinc-700 hover:bg-white">
                            {guide.tutorial.duration}
                          </Badge>
                          {guide.badge ? (
                            <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">{guide.badge}</Badge>
                          ) : null}
                        </div>
                        <h3 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950">{guide.tutorial.title}</h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{guide.tutorial.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openTutorial(0)}
                        className="group flex h-full min-h-32 items-center justify-center rounded-[1.35rem] border border-orange-200 bg-white p-5 text-center shadow-sm transition hover:border-orange-300 hover:bg-orange-50"
                      >
                        <span className="grid h-16 w-16 place-items-center rounded-full bg-orange-600 text-white shadow-[0_14px_30px_rgba(249,115,22,0.24)] transition group-hover:scale-105">
                          <PlayCircle className="h-8 w-8" />
                        </span>
                        <span className="sr-only">{c.tutorialPlayerOpenFull}</span>
                      </button>
                    </div>
                    <div className="p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        {c.tutorialStepsTitle}
                      </p>
                      <ol className="mt-4 grid gap-3">
                        {guide.tutorial.steps.map((step, index) => (
                          <li key={step} className="flex gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-6 text-zinc-700">
                            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-700">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  {isMetaGuide ? (
                    <section className="rounded-3xl border border-orange-200 bg-orange-50/70 p-5 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <Badge className="border-orange-200 bg-white text-orange-700 hover:bg-white">
                            {metaCopy.badge}
                          </Badge>
                          <h3 className="mt-3 text-xl font-semibold tracking-tight text-zinc-950">
                            {metaCopy.title}
                          </h3>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-orange-950/75">
                            {metaCopy.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3">
                        {metaSetupItems.map((item) => {
                          const ItemIcon = item.icon
                          return (
                            <article key={item.title} className="rounded-[1.35rem] border border-orange-200 bg-white p-4">
                              <div className="flex items-start gap-3">
                                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-700 ring-1 ring-orange-200">
                                  <ItemIcon className="h-5 w-5" />
                                </div>
                                <div>
                                  <h4 className="text-sm font-semibold leading-6 text-zinc-950">{item.title}</h4>
                                  <p className="mt-1 text-xs leading-5 text-zinc-600">{item.description}</p>
                                </div>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}

                  {isTikTokChatwootGuide ? (
                    <TikTokChannelHub orgId={orgId} locale={loc} />
                  ) : null}

                  {isTikTokChatwootGuide ? (
                    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                            {chatwootCopy.badge}
                          </Badge>
                          <h3 className="mt-3 text-xl font-semibold tracking-tight text-zinc-950">
                            {chatwootCopy.title}
                          </h3>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                            {chatwootCopy.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3">
                        {chatwootSetupItems.map((item) => {
                          const ItemIcon = item.icon
                          return (
                            <article key={item.title} className="rounded-[1.35rem] border border-zinc-200 bg-zinc-50 p-4">
                              <div className="flex items-start gap-3">
                                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-orange-700 ring-1 ring-orange-200">
                                  <ItemIcon className="h-5 w-5" />
                                </div>
                                <div>
                                  <h4 className="text-sm font-semibold leading-6 text-zinc-950">{item.title}</h4>
                                  <p className="mt-1 text-xs leading-5 text-zinc-600">{item.description}</p>
                                </div>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}

                  <div className="grid gap-4">
                    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-zinc-100 text-zinc-700">
                          <ExternalLink className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            {c.tutorialProviderSide}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-zinc-950">{guide.title}</p>
                        </div>
                      </div>
                      <ol className="mt-5 space-y-3">
                        {providerPreviewSteps.map((step, index) => (
                          <li key={step} className="flex gap-3 text-sm leading-6 text-zinc-700">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-700 ring-1 ring-zinc-200">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </section>

                    <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-orange-700 ring-1 ring-orange-200">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                            {c.tutorialLeadDriveSide}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-zinc-950">{c.channelSetup}</p>
                        </div>
                      </div>
                      <ol className="mt-5 space-y-3">
                        {leadDrivePreviewSteps.map((step, index) => (
                          <li key={step} className="flex gap-3 text-sm leading-6 text-zinc-800">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-600 text-[11px] font-bold text-white">
                              {index + providerPreviewSteps.length + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </div>

                <aside
                  data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-scenario" : undefined}
                  className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <h3 className="text-lg font-semibold">{c.selectScenario}</h3>
                  <div className="mt-5 space-y-3">
                    {scenarioOptions.map((option) => {
                      const selected = mode === option.value
                      const optionToneClass = selected
                        ? "border-orange-300 bg-orange-50 text-orange-950"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200"
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMode(option.value)}
                          className={cn(
                            "flex w-full gap-3 rounded-2xl border p-4 text-left transition",
                            optionToneClass,
                          )}
                        >
                          <span className={cn("mt-1 h-4 w-4 shrink-0 rounded-full border", selected ? "border-orange-600 bg-orange-600" : "border-zinc-400")} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{option.title}</span>
                            <span className={cn(
                              "mt-1 block text-xs leading-5",
                              selected ? "text-orange-800" : "text-zinc-500",
                            )}>{option.description}</span>
                            {option.checklist.length ? (
                              <span className="mt-3 flex flex-wrap gap-1.5">
                                {option.checklist.slice(0, 4).map((item) => (
                                  <span
                                    key={item}
                                    className={cn(
                                      "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                                      selected
                                        ? "bg-white/80 text-orange-900 ring-orange-200"
                                        : "bg-zinc-50 text-zinc-600 ring-zinc-200",
                                    )}
                                  >
                                    {item}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">{c.selectedScenario}</p>
                    <p className="mt-2 text-sm font-semibold text-orange-950">{selectedScenarioTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-orange-800">{selectedScenarioDescription}</p>
                    {selectedScenario.checklist.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedScenario.checklist.slice(0, 4).map((item) => (
                          <span key={item} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-200">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-6 flex flex-col gap-3">
                    <Button
                      type="button"
                      onClick={() => goToStage("eligibility")}
                      className="bg-orange-600 text-white hover:bg-orange-700"
                    >
                      {c.getStarted}
                    </Button>
                    {effectiveFormInitialData ? (
                      <Link
                        href={stageHref("connect")}
                        className={cn(buttonVariants({ variant: "ghost" }), "text-orange-700 hover:bg-orange-50 hover:text-orange-800")}
                      >
                        {c.skip}
                      </Link>
                    ) : (
                      <Button asChild variant="ghost" className="text-orange-700 hover:bg-orange-50 hover:text-orange-800">
                        <Link href={credentialHref}>{c.skip}</Link>
                      </Button>
                    )}
                  </div>
                  <div className="mt-7 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.readyBeforeTitle}</p>
                    <ul className="mt-3 space-y-2">
                      {readyChecklist.map((item) => (
                        <li key={item} className="flex gap-2 text-xs leading-5 text-zinc-600">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </aside>
              </section>
            ) : stage === "eligibility" && currentStep ? (
              <section
                data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-eligibility" : undefined}
                className="max-w-6xl"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                      {c.eligibilityBadge}
                    </Badge>
                    <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight">{guide.eligibility.title}</h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">{c.readinessQuestionDesc}</p>
                  </div>
                  <Badge className="w-fit border-zinc-200 bg-white text-zinc-700 hover:bg-white">
                    {stepIndex + 1}/{guide.eligibility.steps.length}
                  </Badge>
                </div>

                <div className="mt-8 grid max-w-5xl gap-6">
                  <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                        {c.readinessQuestionTitle}
                      </p>
                      <p className="mt-2 text-lg font-semibold leading-7 text-zinc-950">{currentStep.question}</p>
                    </div>

                    <div className="p-5">
                      <div className="grid gap-3">
                        {guide.eligibility.steps.map((step, index) => {
                          const answered = typeof readinessAnswers[index] === "number"
                          const active = index === stepIndex
                          return (
                            <button
                              key={step.label}
                              type="button"
                              onClick={() => {
                                setStepIndex(index)
                                setSelectedOption(readinessAnswers[index] ?? 0)
                              }}
                              className={cn(
                                "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition",
                                active
                                  ? "border-orange-300 bg-orange-50 text-orange-950"
                                  : answered
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-200 hover:bg-zinc-50 hover:text-zinc-950",
                              )}
                            >
                              <span
                                className={cn(
                                  "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
                                  active
                                    ? "bg-orange-600 text-white"
                                    : answered
                                      ? "bg-emerald-600 text-white"
                                      : "bg-zinc-100 text-zinc-600",
                                )}
                              >
                                {answered && !active ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                              </span>
                              <span className="min-w-0">{step.label}</span>
                            </button>
                          )
                        })}
                      </div>

                      {currentStep.info ? (
                        <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-950">
                          <Info className="mr-2 inline h-4 w-4 text-orange-700" />
                          {currentStep.info}
                        </div>
                      ) : null}

                      <div className="mt-6 space-y-3">
                        {currentStep.options.map((option, index) => {
                          const active = currentAnswerIndex === index
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setSelectedOption(index)
                                setReadinessAnswersByGuide((state) => ({
                                  ...state,
                                  [guide.id]: {
                                    ...(state[guide.id] || {}),
                                    [stepIndex]: index,
                                  },
                                }))
                              }}
                              className={cn(
                                "flex w-full items-start gap-4 rounded-2xl border px-4 py-4 text-left transition",
                                active
                                  ? "border-orange-300 bg-orange-50 text-orange-950 shadow-sm"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200 hover:bg-zinc-50",
                              )}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2",
                                  active ? "border-orange-600 bg-white" : "border-zinc-300 bg-zinc-50",
                                )}
                              >
                                {active ? <span className="h-3 w-3 rounded-full bg-orange-600" /> : null}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold leading-6">{option}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      {selectedAnswer ? (
                        <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.currentChoice}</p>
                          <p className="mt-2 font-medium text-zinc-950">{selectedAnswer}</p>
                        </div>
                      ) : null}

                      <div className="mt-6 flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          onClick={() => {
                            setReadinessAnswersByGuide((state) => ({
                              ...state,
                              [guide.id]: {
                                ...(state[guide.id] || {}),
                                [stepIndex]: currentAnswerIndex,
                              },
                            }))
                            if (isLastStep) goToStage("connect")
                            else {
                              const nextIndex = stepIndex + 1
                              setStepIndex(nextIndex)
                              setSelectedOption(readinessAnswers[nextIndex] ?? 0)
                            }
                          }}
                          className="bg-orange-600 text-white hover:bg-orange-700"
                        >
                          {isLastStep ? c.yesContinue : c.next}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        {effectiveFormInitialData ? (
                          <Link
                            href={stageHref("connect")}
                            className={cn(buttonVariants({ variant: "ghost" }), "text-orange-700 hover:bg-orange-50 hover:text-orange-800")}
                          >
                            {c.skip}
                          </Link>
                        ) : (
                          <Button asChild variant="ghost" className="text-orange-700 hover:bg-orange-50 hover:text-orange-800">
                            <Link href={credentialHref}>{c.skip}</Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.readinessProgress}</p>
                      <div className="mt-4 space-y-2">
                        {readinessSummaryItems.map((item, index) => (
                          <button
                            key={`${item.label}-${index}`}
                            type="button"
                            onClick={() => {
                              setStepIndex(index)
                              setSelectedOption(readinessAnswers[index] ?? 0)
                            }}
                            className="flex w-full items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left transition hover:border-orange-200 hover:bg-white"
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white",
                                item.answer ? "bg-emerald-600" : index === stepIndex ? "bg-orange-600" : "bg-zinc-400",
                              )}
                            >
                              {item.answer ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-zinc-950">{item.label}</span>
                              <span className={cn("mt-1 block text-xs leading-5", item.answer ? "text-zinc-600" : "text-amber-700")}>
                                {item.answer || c.wizardNotAnswered}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">{c.selectedScenario}</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-orange-950">{selectedScenarioTitle}</p>
                      <p className="mt-2 text-xs leading-5 text-orange-800">{selectedScenarioDescription}</p>
                      {selectedScenario.checklist.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedScenario.checklist.slice(0, 4).map((item) => (
                            <span key={item} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-200">
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.readinessWhyTitle}</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-600">{c.readinessWhyDesc}</p>
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">{c.readinessNextTitle}</p>
                        <p className="mt-2 text-xs leading-5 text-emerald-900">{c.readinessNextDesc}</p>
                      </div>
                    </section>
                  </aside>
                </div>
              </section>
            ) : (
              <section
                data-tour-id={isWhatsAppCallingGuide ? "whatsapp-calls-connect" : undefined}
                className="max-w-5xl"
              >
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  {c.channelSetup}
                </Badge>
                <h2 className="mt-5 text-3xl font-semibold tracking-tight">{guide.connect.title}</h2>
                <p className="mt-5 max-w-4xl text-base leading-8 text-zinc-700">{guide.connect.description}</p>
                {showOauthResult ? (
                  <div
                    data-testid="oauth-result-banner"
                    data-tone={oauthBannerTone}
                    className={cn(
                      "mt-5 rounded-2xl border p-4",
                      oauthBannerTone === "success"
                        ? "border-emerald-200 bg-emerald-50"
                        : oauthBannerTone === "pending"
                          ? "border-zinc-200 bg-zinc-50"
                          : "border-amber-200 bg-amber-50",
                    )}
                  >
                    <p className={cn(
                      "text-sm font-semibold",
                      oauthBannerTone === "success"
                        ? "text-emerald-800"
                        : oauthBannerTone === "pending"
                          ? "text-zinc-800"
                          : "text-amber-900",
                    )}>
                      {oauthBannerTitle}
                    </p>
                    <p className={cn(
                      "mt-1 text-sm leading-6",
                      oauthBannerTone === "success"
                        ? "text-emerald-700"
                        : oauthBannerTone === "pending"
                          ? "text-zinc-600"
                          : "text-amber-800",
                    )}>
                      {oauthBannerDesc}
                    </p>
                  </div>
                ) : null}
                {oauthError ? (
                  <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-800">{c.oauthErrorTitle}</p>
                    <p className="mt-1 text-sm leading-6 text-red-700">
                      {c.oauthErrorDesc.replace("{code}", oauthError)}
                    </p>
                  </div>
                ) : null}
                {isTikTokChatwootGuide ? (
                  <TikTokChannelHub orgId={orgId} locale={loc} />
                ) : null}
                {credentialFormBlock}
                {externalCredentialActions}
                <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.afterConnectTitle}</p>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700">{c.setupOutcomeDesc}</p>
                    </div>
                    <Badge className="w-fit border-orange-200 bg-white text-orange-700 hover:bg-white">
                      {selectedScenarioTitle}
                    </Badge>
                  </div>
                  <div className="grid divide-y divide-zinc-200 md:grid-cols-3 md:divide-x md:divide-y-0">
                    {compactConnectSteps.map((item, index) => {
                      const StepIcon = item.icon
                      const iconClass =
                        item.tone === "success"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : item.tone === "accent"
                            ? "bg-orange-50 text-orange-700 ring-orange-200"
                            : "bg-zinc-100 text-zinc-700 ring-zinc-200"
                      return (
                        <article key={item.title} className="min-w-0 p-4">
                          <div className="flex items-start gap-3">
                            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1", iconClass)}>
                              <StepIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-zinc-500">{index + 1}</span>
                                <h3 className="break-words text-sm font-semibold text-zinc-950">{item.title}</h3>
                              </div>
                              <p className="mt-1 break-words text-xs leading-5 text-zinc-600">{item.description}</p>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>

                <details className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <Info className="h-4 w-4 shrink-0 text-orange-600" />
                      <span className="break-words">{c.watchGuideTitle}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                      {guide.tutorial.duration}
                    </span>
                  </summary>
                  <div className="grid gap-5 border-t border-zinc-200 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <section className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">{c.tutorialPlayerFieldMap}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {tutorialScreen.leadDriveFields.slice(0, 5).map((field) => (
                          <span key={field} className="max-w-full break-words rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium leading-5 text-orange-900">
                            {field}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTutorial(0)}
                          className="border-orange-200 bg-white text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                        >
                          <PlayCircle className="mr-2 h-4 w-4" />
                          {c.quickStartGuideAction}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => goToStage("eligibility")}
                          className="border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        >
                          {c.wizardEditReadiness}
                        </Button>
                      </div>
                    </section>
                    <section className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{c.faqTitle}</p>
                      <div className="mt-2 divide-y divide-zinc-200">
                        {faqItems.slice(0, 2).map((item, index) => (
                          <AccordionItem
                            key={`${item.q}-${index}`}
                            title={item.q}
                            icon={index === 0 ? <Info className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                            defaultOpen={index === 0}
                            className="border-zinc-200"
                          >
                            <p className="px-8 pb-1 text-sm leading-6 text-zinc-600">
                              {item.a}
                            </p>
                          </AccordionItem>
                        ))}
                      </div>
                    </section>
                  </div>
                </details>
              </section>
            )}

            <p className="mt-14 text-center text-sm text-zinc-500">
              {c.guideFooter} <ExternalLink className="inline h-3.5 w-3.5" />
            </p>
          </div>
        </main>
      </div>
      <Dialog
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        widthClassName="max-w-6xl"
        maxHeightClassName="max-h-[92vh]"
      >
        <DialogHeader className="border-b border-zinc-200 bg-white pr-14">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600">
              <PlayCircle className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">{c.tutorialPreviewTitle}</p>
              <DialogTitle className="mt-1 text-2xl font-semibold tracking-tight">{guide.tutorial.title}</DialogTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{guide.tutorial.description}</p>
            </div>
          </div>
        </DialogHeader>
        <DialogContent className="force-light bg-[#f8fafc] p-5">
          <div className="grid gap-5">
            <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400" />
                </div>
                <div className="max-w-[min(18rem,60vw)] break-words rounded-full border border-zinc-200 bg-white px-3 py-1 text-right text-xs font-medium leading-5 text-zinc-600">
                  {guide.title}
                </div>
              </div>
              <div className="p-5">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                    {tutorialProgress}/{Math.max(tutorialSteps.length, 1)}
                  </Badge>
                  <div className="min-w-[160px] flex-1">
                    <Progress
                      value={tutorialProgress}
                      max={Math.max(tutorialSteps.length, 1)}
                      className="bg-orange-100"
                      indicatorClassName="bg-orange-600"
                    />
                  </div>
                  <Badge className="border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-50">
                    {tutorialStageLabel}
                  </Badge>
                </div>

                <div className="grid gap-4">
                  <section className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-white to-orange-50/60 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.tutorialProviderSide}</p>
                    <div className="mt-5 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-lg font-black text-orange-700">
                          {guide.logo}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-950">{tutorialScreen.providerSurface}</p>
                          <p className="mt-1 max-w-[18rem] break-all text-xs leading-5 text-zinc-500">{tutorialScreen.providerUrl}</p>
                        </div>
                      </div>
                      <div className="mt-5 space-y-2">
                        {providerPreviewSteps.map((step, index) => (
                          <div
                            key={`${step}-${index}`}
                            className={cn(
                              "flex gap-3 rounded-xl border px-3 py-2 text-sm leading-6",
                              index === Math.min(tutorialStepIndex, providerPreviewSteps.length - 1)
                                ? "border-orange-300 bg-orange-50 text-orange-900"
                                : "border-zinc-200 bg-zinc-50 text-zinc-600",
                            )}
                          >
                            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-orange-700 ring-1 ring-orange-200">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-zinc-200 bg-white p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.tutorialLeadDriveSide}</p>
                    <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f8fafc] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 break-all text-sm font-semibold leading-5 text-zinc-950">{tutorialScreen.leadDriveRoute}</p>
                        <Badge className="border-orange-200 bg-white text-orange-700 hover:bg-white">
                          {tutorialStageLabel}
                        </Badge>
                      </div>
                      <div className="mt-5 grid gap-2">
                        {leadDrivePreviewSteps.map((item, index) => {
                          const highlighted = index <= Math.min(tutorialStepIndex, leadDrivePreviewSteps.length - 1)
                          return (
                            <div
                              key={`${item}-${index}`}
                              aria-label={`${index + 1}. ${item}`}
                              className={cn(
                                "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm",
                                highlighted ? "border-orange-200 bg-white text-orange-950" : "border-zinc-200 bg-zinc-50 text-zinc-500",
                              )}
                            >
                              {highlighted ? (
                                <span className="grid h-7 w-7 place-items-center rounded-full bg-orange-600 text-xs font-semibold text-white" aria-hidden="true">
                                  {index + 1}
                                </span>
                              ) : (
                                <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-xs font-semibold text-zinc-500" aria-hidden="true">
                                  {index + 1}
                                </span>
                              )}
                              <span>{item}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-4 grid gap-2">
                        {tutorialScreen.leadDriveFields.slice(0, 6).map((field) => (
                          <div key={field} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600">
                            {field}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">{c.nextActionTitle}</p>
                      <p className="mt-2 text-base font-semibold leading-7 text-orange-950">{tutorialStep}</p>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <aside className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{c.tutorialStepsTitle}</p>
              <div className="mt-4 space-y-2">
                {tutorialSteps.map((step, index) => {
                  const active = index === tutorialStepIndex
                  return (
                    <button
                      key={`${step}-${index}`}
                      type="button"
                      onClick={() => setTutorialStepIndex(index)}
                      className={cn(
                        "flex w-full gap-3 rounded-2xl border p-3 text-left text-sm leading-6 transition",
                        active
                          ? "border-orange-300 bg-orange-50 text-orange-900"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200 hover:bg-zinc-50 hover:text-zinc-950",
                      )}
                    >
                      {active ? (
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-orange-600 text-xs font-bold text-white">
                          {index + 1}
                        </span>
                      ) : (
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                          {index + 1}
                        </span>
                      )}
                      <span>{step}</span>
                    </button>
                  )
                })}
              </div>
            </aside>
          </div>
        </DialogContent>
        <DialogFooter className="flex-wrap justify-between gap-3 bg-white">
          <Button
            type="button"
            variant="outline"
            onClick={() => setTutorialStepIndex((index) => Math.max(0, index - 1))}
            disabled={tutorialStepIndex === 0}
          >
            {c.previous}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTutorialOpen(false)}
            >
              {c.closeTutorial}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTutorialStepIndex((index) => Math.min(Math.max(tutorialSteps.length - 1, 0), index + 1))}
              disabled={tutorialStepIndex >= tutorialSteps.length - 1}
            >
              {c.next}
            </Button>
            <Button
              type="button"
              className="bg-orange-600 text-white hover:bg-orange-700"
              onClick={() => {
                setTutorialOpen(false)
                goToStage("eligibility")
              }}
            >
              {c.startSetupFromTutorial}
            </Button>
          </div>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
