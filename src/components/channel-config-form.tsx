"use client"

import type { ChangeEvent } from "react"
import { useState, useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Check, Copy, Mail, Send, MessageSquare, Smartphone, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { emailIntakeRoutesFromSettings } from "@/lib/ticketing/email-intake"
import { buildChannelPayload, type ChannelConfigFormData, type SmsProvider } from "@/lib/channels/channel-config-payload"
import { channelConnectionState } from "@/lib/channels/live-connection"
import { metaConnectionReason } from "@/lib/channels/connection-reason"

type Loc = "en" | "ru" | "az"

const LEADDRIVE_APP_ORIGIN = "https://app.leaddrivecrm.org"

function whatsappWebhookUrl(orgSlug?: string) {
  const slug = orgSlug ? encodeURIComponent(orgSlug) : "<your-workspace-slug>"
  return `${LEADDRIVE_APP_ORIGIN}/api/v1/webhooks/whatsapp?t=${slug}`
}

type ChannelSettings = Record<string, unknown>

interface ChannelInitialData extends Partial<ChannelConfigFormData> {
  id?: string
  settings?: ChannelSettings | null
  appId?: string
  appSecret?: string
  pageId?: string
  verifyToken?: string
  displayName?: string
  hasAccessToken?: boolean
  hasPhoneNumberId?: boolean
  hasBusinessAccountId?: boolean
  hasVerifyToken?: boolean
  /** Another workspace's claim on this pageId wins inbound routing (computed by the channels API). */
  claimedElsewhere?: boolean
  hasAppSecret?: boolean
  hasWebhookSecret?: boolean
}

interface ChannelConfigFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: ChannelInitialData
  orgId?: string
  /** Org slug — used to render the per-tenant FB/IG webhook callback URL (?t=<slug>). */
  orgSlug?: string
  /** When opened from the catalog card flow, keep users inside that provider instead of showing the legacy all-channel picker. */
  lockChannelType?: boolean
  lockChannelTypeLabel?: string
  lockChannelTypeHint?: string
  /** Whether the catalog flow was started for a new provider account or existing credentials. */
  setupIntent?: "new" | "existing"
  /** Render as the legacy modal dialog or as an embedded page section in guided setup. */
  variant?: "dialog" | "inline"
  /** Hide guided explainer panels while keeping the same channel fields. */
  guidanceMode?: "full" | "compact"
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

const channelTypes = [
  { value: "email", label: "Email", icon: Mail },
  { value: "telegram", label: "Telegram", icon: Send },
  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { value: "sms", label: "SMS", icon: Smartphone },
  { value: "facebook", label: "Facebook", icon: MessageSquare },
  { value: "instagram", label: "Instagram", icon: MessageSquare },
  { value: "vkontakte", label: "VKontakte", icon: MessageSquare },
  { value: "chatwoot", label: "TikTok via Chatwoot", icon: MessageSquare },
]

const localCopy: Record<Loc, Record<string, string>> = {
  en: {
    copyValue: "Copy",
    copiedValue: "Copied",
    whatsappMessagingOnly: "This connects WhatsApp Business messaging: inbound inbox messages, approved templates, and notifications. WhatsApp Business Calling is prepared separately from the Channels readiness guide; use Settings -> VoIP only for regular phone providers and call logs.",
    whatsappWebhookTitle: "Meta webhook callback on the test domain",
    whatsappWebhookHint: "Paste this Callback URL in Meta -> WhatsApp -> Configuration -> Webhook and use the same Verify Token you enter below. For our tests, use app.leaddrivecrm.org even if you opened a tenant subdomain.",
    whatsappCallingNote: "WhatsApp Calling uses this same Meta app and phone number. Saving this messaging channel does not subscribe Meta calls events by itself; finish the WhatsApp Calling checklist before testing inbound or permission-gated outbound calls in Inbox.",
    whatsappRequiredError: "WhatsApp Business API requires Access Token, Phone Number ID, Business Account ID, Webhook Verify Token, and App Secret.",
    setupStepLabel: "Step",
    setupCurrentStep: "Current step",
    setupStepperHint: "Click a step to focus it. Complete these provider-side checks before entering credentials.",
    setupPreviousStep: "Previous step",
    setupNextStep: "Next step",
    setupNextBlockTitle: "Next: enter credentials",
    inlineSetupEyebrow: "Credential setup",
    inlineSetupDesc: "This is the final step of the guided setup. Save only the credentials for the selected channel below.",
    scenarioBoxTitle: "Selected setup path",
    scenarioNewTitle: "New provider setup",
    scenarioNewDesc: "Use this path when the provider account, sender, inbox or number is being created now. Finish the provider checklist first, then paste credentials here.",
    scenarioExistingTitle: "Existing credentials",
    scenarioExistingDesc: "Use this path when the provider account already exists. Paste the current credentials and leave stored secrets blank when editing.",
    planProviderTitle: "Provider",
    planLeadDriveTitle: "LeadDrive fields",
    planVerifyTitle: "Safe test",
    credentialMapTitle: "What you need before saving",
    fieldMapTitle: "Credential field map",
    fieldMapHint: "Use this map while filling the form below. It explains the exact provider-side value expected by each LeadDrive field.",
    fieldMapField: "LeadDrive field",
    fieldMapWhere: "Where to get it",
    requiredBadge: "required",
    afterSaveTitle: "After saving",
    whatsappCredentialMap: "Meta access token, Phone Number ID, WABA / Business Account ID, Webhook Verify Token, and App Secret.",
    whatsappAfterSave: "Use the callback URL shown below in Meta Webhooks, subscribe message events, then test one inbound message before live traffic.",
    storedCredentialPlaceholder: "Stored - leave blank to keep",
    storedCredentialHint: "Already saved in LeadDrive. Leave this field blank to keep the current value.",
    missingCredentialHint: "Not saved yet. Paste the value from Meta before saving.",
    chatwootCredentialMap: "Chatwoot Base URL, Account ID, webhook secret, and API access token from Chatwoot Profile -> Access Token.",
    chatwootAfterSave: "Point Chatwoot webhooks to the URL below. TikTok stays connected in Chatwoot; LeadDrive mirrors it as TikTok in Inbox.",
    metaCredentialMap: "Nothing to paste for the standard connect. Only a tenant Meta app needs App ID, App Secret and Verify Token.",
    metaAfterSave: "After connecting, send one inbound message to the Page and check it lands in Inbox.",
    smsAtlCredentialMap: "ATL login, ATL password, and sender title approved by ATL. ATL is the default SMS provider for Azerbaijan.",
    smsAtlAfterSave: "After saving, open the saved channel and send one controlled test SMS before campaigns or automations.",
    smsGenericCredentialMap: "Provider account ID, sending number or sender name, and provider secret token.",
    smsGenericAfterSave: "After saving, run one controlled test SMS before using the channel in broadcasts or automations.",
    emailIntakeTitle: "Inbound Service Desk routing",
    emailTicketIntakeLabel: "Create tickets from this address",
    emailTicketIntakeHint: "Emails sent to this address become support tickets. Leave blank if this channel is outbound only.",
    emailComplaintIntakeLabel: "Create complaints from this address",
    emailComplaintIntakeHint: "Emails sent to this address enter the complaints register.",
    displayNameLabel: "Display Name",
    chatwootBridgeTitle: "TikTok via Chatwoot bridge",
    chatwootBridgeBody: "Chatwoot receives TikTok messages. LeadDrive mirrors inbound events into the inbox as TikTok and sends replies back through Chatwoot.",
    chatwootWebhookUrl: "Chatwoot webhook URL",
    chatwootBaseUrlHint: "Use your Chatwoot Cloud or self-hosted workspace URL.",
    chatwootWebhookSecretPlaceholder: "choose-a-long-secret",
    chatwootTokenPlaceholder: "api_access_token",
    chatwootTokenHint: "Create it in Chatwoot Profile -> Access Token. Leave blank on edit to keep the stored token.",
    instagramLoginOption: "Instagram Login — my Instagram account is not linked to a Facebook Page. Use this for Instagram's own login with a dedicated Instagram app. Leave unchecked if Instagram is managed through a Facebook Page. Requires your own Instagram app configured below.",
    metaOwnAppTitle: "{channel} — your own Meta app",
    metaStep1: "Create or select the right Meta app, then enter its App ID and App Secret below.",
    metaStep2: "In your Meta app -> Webhooks, set this Callback URL and use the same Verify Token you enter below.",
    metaStep3: "Add this OAuth redirect URI to your Meta app.",
    metaStep4: "Save the channel, then use Connect with Meta — OAuth will run against your own app.",
    metaAppSecretPlaceholder: "Meta app secret",
    metaVerifyTokenPlaceholder: "a-random-string-you-choose",
    metaVerifyTokenHint: "Any random string — it must match the Verify Token in your Meta app's Webhook config.",
    metaConnectFacebook: "Connect Facebook Page →",
    metaConnectInstagram: "Connect Instagram account →",
    metaOneClickTitle: "Connect with LeadDrive's Meta app",
    metaOneClickDesc: "One click: sign in to Facebook, pick the Page, and LeadDrive wires the inbox. No App ID, App Secret or Verify Token needed.",
    metaOneClickIgNote: "Instagram Direct arrives through the Facebook Page linked to the account.",
    metaOwnAppToggle: "I have my own Meta app (advanced)",
    metaOwnAppHint: "Fill all three fields together — App ID, App Secret and Verify Token. A partial set is ignored by LeadDrive's webhook and OAuth resolvers.",
    metaOwnAppRequiredError: "Enter Meta App ID, App Secret and Verify Token together, or clear all three to use LeadDrive's shared Meta app.",
    metaNeedsSetup: "One-click connect is not configured for this workspace. Use your own Meta app below.",
    metaSaveFirst: "You declared your own Meta app, but its App ID is not saved (or was edited and not saved). Save the channel first — OAuth resolves your app from the stored App ID, so connecting now would run against the old one.",
    metaStateConnected: "Connected. LeadDrive holds an access token for Page {page}; inbound messages reach Inbox.",
    metaStateDraft: metaConnectionReason("en", "draft"),
    metaStateNew: "Not connected yet. Saving this form only creates the channel; messages start arriving after Connect with Meta finishes.",
    metaStatePaused: metaConnectionReason("en", "paused"),
    metaStateReconnect: metaConnectionReason("en", "needsReconnect"),
    metaManualFallback: "Auto-filled after Connect. Enter manually only as a fallback:",
    metaPageIdLabel: "Page ID",
    metaPageIdPlaceholder: "Your Facebook Page ID",
  },
  ru: {
    copyValue: "Копировать",
    copiedValue: "Скопировано",
    whatsappMessagingOnly: "Здесь подключается WhatsApp Business messaging: входящие сообщения в inbox, одобренные шаблоны и уведомления. WhatsApp Business Calling готовится отдельно через чеклист в Каналах; Настройки -> VoIP используйте только для обычной телефонии и журнала звонков.",
    whatsappWebhookTitle: "Meta webhook callback на тестовом домене",
    whatsappWebhookHint: "Вставьте этот Callback URL в Meta -> WhatsApp -> Configuration -> Webhook и задайте тот же Verify Token, который укажете ниже. Для наших тестов используйте app.leaddrivecrm.org, даже если экран открыт на субдомене тенанта.",
    whatsappCallingNote: "WhatsApp Calling использует это же Meta-приложение и номер. Сохранение канала сообщений само не подписывает события звонков Meta; завершите чеклист WhatsApp Calling перед тестом входящих или исходящих звонков с разрешением клиента в Inbox.",
    whatsappRequiredError: "Для WhatsApp Business API нужны Access Token, Phone Number ID, Business Account ID, Webhook Verify Token и App Secret.",
    setupStepLabel: "Шаг",
    setupCurrentStep: "Текущий шаг",
    setupStepperHint: "Нажмите на шаг, чтобы сфокусироваться на нём. Эти проверки делаются у провайдера до ввода ключей.",
    setupPreviousStep: "Предыдущий шаг",
    setupNextStep: "Следующий шаг",
    setupNextBlockTitle: "Дальше: введите ключи",
    inlineSetupEyebrow: "Настройка ключей",
    inlineSetupDesc: "Это финальный шаг guided setup. Ниже сохраните только ключи выбранного канала.",
    scenarioBoxTitle: "Выбранный путь подключения",
    scenarioNewTitle: "Новая настройка у провайдера",
    scenarioNewDesc: "Используйте этот путь, если аккаунт провайдера, отправитель, inbox или номер создаётся сейчас. Сначала завершите чеклист у провайдера, потом вставьте ключи здесь.",
    scenarioExistingTitle: "Готовые ключи",
    scenarioExistingDesc: "Используйте этот путь, если аккаунт провайдера уже есть. Вставьте текущие ключи, а при редактировании оставляйте сохранённые секреты пустыми.",
    planProviderTitle: "Провайдер",
    planLeadDriveTitle: "Поля LeadDrive",
    planVerifyTitle: "Безопасный тест",
    credentialMapTitle: "Что нужно подготовить до сохранения",
    fieldMapTitle: "Карта полей ключей",
    fieldMapHint: "Используйте эту карту при заполнении формы ниже. Она объясняет, какое значение провайдера ожидает каждое поле LeadDrive.",
    fieldMapField: "Поле LeadDrive",
    fieldMapWhere: "Где взять",
    requiredBadge: "обязательно",
    afterSaveTitle: "После сохранения",
    whatsappCredentialMap: "Meta access token, Phone Number ID, WABA / Business Account ID, Webhook Verify Token и App Secret.",
    whatsappAfterSave: "Укажите callback URL ниже в Meta Webhooks, подпишите message events и проверьте одно входящее сообщение до живого трафика.",
    storedCredentialPlaceholder: "Сохранено - оставьте пустым, чтобы не менять",
    storedCredentialHint: "Уже сохранено в LeadDrive. Оставьте поле пустым, чтобы не менять текущее значение.",
    missingCredentialHint: "Ещё не сохранено. Вставьте значение из Meta перед сохранением.",
    chatwootCredentialMap: "Chatwoot Base URL, Account ID, webhook secret и API access token из Chatwoot Profile -> Access Token.",
    chatwootAfterSave: "Направьте Chatwoot webhooks на URL ниже. TikTok остаётся подключённым в Chatwoot, LeadDrive показывает его в Inbox как TikTok.",
    metaCredentialMap: "Для обычного подключения вставлять нечего. App ID, App Secret и Verify Token нужны только своему приложению Meta.",
    metaAfterSave: "После подключения отправьте одно входящее сообщение на страницу и убедитесь, что оно дошло в Inbox.",
    smsAtlCredentialMap: "ATL login, ATL password и имя отправителя, заранее одобренное ATL. ATL — основной SMS-провайдер для Азербайджана.",
    smsAtlAfterSave: "После сохранения откройте сохранённый канал и отправьте одно контролируемое SMS до кампаний или автоматизаций.",
    smsGenericCredentialMap: "Provider account ID, номер или имя отправителя, и секретный токен провайдера.",
    smsGenericAfterSave: "После сохранения выполните один контролируемый SMS-тест до рассылок или автоматизаций.",
    emailIntakeTitle: "Маршрутизация входящих в Service Desk",
    emailTicketIntakeLabel: "Создавать тикеты с этого адреса",
    emailTicketIntakeHint: "Письма на этот адрес будут создаваться как support тикеты. Оставьте пустым, если канал только для исходящей почты.",
    emailComplaintIntakeLabel: "Создавать жалобы с этого адреса",
    emailComplaintIntakeHint: "Письма на этот адрес будут попадать в реестр жалоб.",
    displayNameLabel: "Название в LeadDrive",
    chatwootBridgeTitle: "TikTok через Chatwoot",
    chatwootBridgeBody: "Chatwoot принимает TikTok-сообщения. LeadDrive показывает их в инбоксе как TikTok и отправляет ответы обратно через Chatwoot.",
    chatwootWebhookUrl: "Chatwoot webhook URL",
    chatwootBaseUrlHint: "Укажите URL вашего Chatwoot Cloud или self-hosted workspace.",
    chatwootWebhookSecretPlaceholder: "длинный-secret-для-webhook",
    chatwootTokenPlaceholder: "api_access_token",
    chatwootTokenHint: "Создайте токен в Chatwoot Profile -> Access Token. При редактировании оставьте поле пустым, чтобы сохранить текущий токен.",
    instagramLoginOption: "Instagram Login — аккаунт Instagram не привязан к Facebook Page. Используйте этот вариант для отдельного Instagram Login app. Оставьте выключенным, если Instagram управляется через Facebook Page. Требует своего приложения Instagram, настроенного ниже.",
    metaOwnAppTitle: "{channel} — собственное Meta-приложение тенанта",
    metaStep1: "Создайте или выберите правильное Meta-приложение, затем укажите App ID и App Secret ниже.",
    metaStep2: "В Meta-приложении -> Webhooks вставьте этот Callback URL и используйте тот же Verify Token, который укажете ниже.",
    metaStep3: "Добавьте этот OAuth redirect URI в Meta-приложение.",
    metaStep4: "Сохраните канал, затем нажмите «Подключить через Meta» — OAuth пойдёт через ваше приложение.",
    metaAppSecretPlaceholder: "секрет Meta-приложения",
    metaVerifyTokenPlaceholder: "любая-длинная-строка",
    metaVerifyTokenHint: "Любая строка — она должна совпадать с Verify Token в настройках webhook вашего Meta-приложения.",
    metaConnectFacebook: "Подключить Facebook Page →",
    metaConnectInstagram: "Подключить Instagram account →",
    metaOneClickTitle: "Подключение через приложение LeadDrive",
    metaOneClickDesc: "Один клик: вход в Facebook, выбор страницы — и LeadDrive сам подключает входящие. App ID, App Secret и Verify Token не нужны.",
    metaOneClickIgNote: "Instagram Direct приходит через связанную с аккаунтом Facebook-страницу.",
    metaOwnAppToggle: "У меня своё приложение Meta (для продвинутых)",
    metaOwnAppHint: "Заполняйте все три поля вместе — App ID, App Secret и Verify Token. Частичный набор игнорируется вебхуком и OAuth LeadDrive.",
    metaOwnAppRequiredError: "Введите Meta App ID, App Secret и Verify Token вместе — или очистите все три, чтобы использовать общее приложение LeadDrive.",
    metaNeedsSetup: "Подключение в один клик не настроено для этого рабочего пространства. Используйте своё приложение Meta ниже.",
    metaSaveFirst: "Вы указали своё приложение Meta, но его App ID не сохранён (или изменён и не сохранён). Сначала сохраните канал — OAuth берёт ваше приложение по сохранённому App ID, иначе подключение уйдёт против старого.",
    metaStateConnected: "Подключено. LeadDrive хранит токен доступа для страницы {page}; входящие приходят в Inbox.",
    metaStateDraft: metaConnectionReason("ru", "draft"),
    metaStateNew: "Ещё не подключено. Сохранение формы только создаёт канал; сообщения пойдут после завершения «Подключить через Meta».",
    metaStatePaused: metaConnectionReason("ru", "paused"),
    metaStateReconnect: metaConnectionReason("ru", "needsReconnect"),
    metaManualFallback: "Заполняется автоматически после подключения. Вручную вводите только как резервный вариант:",
    metaPageIdLabel: "Page ID",
    metaPageIdPlaceholder: "ID вашей Facebook Page",
  },
  az: {
    copyValue: "Kopyala",
    copiedValue: "Kopyalandı",
    whatsappMessagingOnly: "Burada WhatsApp Business messaging qoşulur: inbox-a gələn mesajlar, təsdiqlənmiş şablonlar və bildirişlər. WhatsApp Business Calling Kanallardakı checklist ilə ayrıca hazırlanır; Tənzimləmələr -> VoIP yalnız adi telefon provayderləri və zəng jurnalı üçündür.",
    whatsappWebhookTitle: "Test domenində Meta webhook callback",
    whatsappWebhookHint: "Bu Callback URL-i Meta -> WhatsApp -> Configuration -> Webhook bölməsinə yazın və aşağıda daxil etdiyiniz Verify Token-i istifadə edin. Testlər üçün ekran tenant subdomain-də açılsa belə app.leaddrivecrm.org istifadə edin.",
    whatsappCallingNote: "WhatsApp Calling eyni Meta tətbiq və nömrədən istifadə edir. Mesajlaşma kanalını saxlamaq Meta zəng hadisələrinə avtomatik abunə etmir; Inbox-da inbound və ya müştəri icazəli outbound zəng testindən əvvəl WhatsApp Calling checklist-ini tamamlayın.",
    whatsappRequiredError: "WhatsApp Business API üçün Access Token, Phone Number ID, Business Account ID, Webhook Verify Token və App Secret lazımdır.",
    setupStepLabel: "Addım",
    setupCurrentStep: "Cari addım",
    setupStepperHint: "Fokuslamaq üçün addıma klikləyin. Açarları daxil etməzdən əvvəl bu provayder yoxlamalarını tamamlayın.",
    setupPreviousStep: "Əvvəlki addım",
    setupNextStep: "Növbəti addım",
    setupNextBlockTitle: "Sonra: açarları daxil edin",
    inlineSetupEyebrow: "Açarların qurulması",
    inlineSetupDesc: "Bu guided setup-ın son addımıdır. Aşağıda yalnız seçilmiş kanalın açarlarını saxlayın.",
    scenarioBoxTitle: "Seçilmiş qoşulma yolu",
    scenarioNewTitle: "Yeni provayder qurulumu",
    scenarioNewDesc: "Provayder hesabı, göndərən, inbox və ya nömrə indi yaradılırsa bu yolu istifadə edin. Əvvəl provayder checklist-ini bitirin, sonra açarları burada yazın.",
    scenarioExistingTitle: "Hazır açarlar",
    scenarioExistingDesc: "Provayder hesabı artıq varsa bu yolu istifadə edin. Mövcud açarları yazın, redaktə zamanı saxlanmış secret-ləri boş saxlayın.",
    planProviderTitle: "Provayder",
    planLeadDriveTitle: "LeadDrive sahələri",
    planVerifyTitle: "Təhlükəsiz test",
    credentialMapTitle: "Saxlamazdan əvvəl nə lazımdır",
    fieldMapTitle: "Açar sahələrinin xəritəsi",
    fieldMapHint: "Aşağıdakı formanı doldurarkən bu xəritədən istifadə edin. Hər LeadDrive sahəsinə provayderdəki hansı dəyərin yazılmalı olduğunu izah edir.",
    fieldMapField: "LeadDrive sahəsi",
    fieldMapWhere: "Haradan götürmək",
    requiredBadge: "vacib",
    afterSaveTitle: "Saxladıqdan sonra",
    whatsappCredentialMap: "Meta access token, Phone Number ID, WABA / Business Account ID, Webhook Verify Token və App Secret.",
    whatsappAfterSave: "Aşağıdakı callback URL-i Meta Webhooks-a yazın, message events abunəliyini edin və canlı trafikdən əvvəl bir gələn mesajı yoxlayın.",
    storedCredentialPlaceholder: "Saxlanılıb — dəyişməmək üçün boş saxlayın",
    storedCredentialHint: "LeadDrive-da artıq saxlanılıb. Mövcud dəyəri saxlamaq üçün sahəni boş saxlayın.",
    missingCredentialHint: "Hələ saxlanılmayıb. Saxlamazdan əvvəl Meta-dakı dəyəri daxil edin.",
    chatwootCredentialMap: "Chatwoot Base URL, Account ID, webhook secret və Chatwoot Profile -> Access Token bölməsindən API access token.",
    chatwootAfterSave: "Chatwoot webhooks-u aşağıdakı URL-ə yönləndirin. TikTok Chatwoot-da qoşulu qalır, LeadDrive Inbox-da onu TikTok kimi göstərir.",
    metaCredentialMap: "Standart qoşulma üçün heç nə yazmaq lazım deyil. App ID, App Secret və Verify Token yalnız öz Meta tətbiqi üçündür.",
    metaAfterSave: "Qoşulduqdan sonra səhifəyə bir gələn mesaj göndərin və Inbox-a düşdüyünü yoxlayın.",
    smsAtlCredentialMap: "ATL login, ATL password və ATL tərəfindən təsdiqlənmiş göndərən adı. ATL Azərbaycan üçün əsas SMS provayderidir.",
    smsAtlAfterSave: "Saxladıqdan sonra saxlanmış kanalı açın və kampaniya/avtomatlaşdırmadan əvvəl bir nəzarətli SMS testi edin.",
    smsGenericCredentialMap: "Provider account ID, göndərən nömrə və ya göndərən adı, və provayder secret token.",
    smsGenericAfterSave: "Saxladıqdan sonra broadcast və ya avtomatlaşdırmadan əvvəl bir nəzarətli SMS testi edin.",
    emailIntakeTitle: "Service Desk inbound marşrutlama",
    emailTicketIntakeLabel: "Bu ünvandan tiket yarat",
    emailTicketIntakeHint: "Bu ünvana gələn emaillər support tiketi kimi yaradılacaq. Kanal yalnız outbound üçündürsə boş saxlayın.",
    emailComplaintIntakeLabel: "Bu ünvandan şikayət yarat",
    emailComplaintIntakeHint: "Bu ünvana gələn emaillər şikayət reyestrinə düşəcək.",
    displayNameLabel: "LeadDrive-da görünən ad",
    chatwootBridgeTitle: "TikTok Chatwoot ilə",
    chatwootBridgeBody: "Chatwoot TikTok mesajlarını qəbul edir. LeadDrive onları inbox-da TikTok kimi göstərir və cavabları Chatwoot vasitəsilə geri göndərir.",
    chatwootWebhookUrl: "Chatwoot webhook URL",
    chatwootBaseUrlHint: "Chatwoot Cloud və ya self-hosted workspace URL-ni yazın.",
    chatwootWebhookSecretPlaceholder: "uzun-webhook-secret",
    chatwootTokenPlaceholder: "api_access_token",
    chatwootTokenHint: "Token-i Chatwoot Profile -> Access Token bölməsində yaradın. Redaktə zamanı mövcud token-i saxlamaq üçün boş saxlayın.",
    instagramLoginOption: "Instagram Login — Instagram hesabı Facebook Page-ə bağlı deyil. Ayrı Instagram Login app üçün bu variantı istifadə edin. Instagram Facebook Page ilə idarə olunursa söndürülü saxlayın. Aşağıda konfiqurasiya edilmiş öz Instagram tətbiqinizi tələb edir.",
    metaOwnAppTitle: "{channel} — tenant-a məxsus Meta tətbiq",
    metaStep1: "Düzgün Meta tətbiq yaradın və ya seçin, sonra aşağıda App ID və App Secret yazın.",
    metaStep2: "Meta tətbiq -> Webhooks bölməsində bu Callback URL-i yazın və aşağıdakı Verify Token ilə eyni dəyəri istifadə edin.",
    metaStep3: "Bu OAuth redirect URI-ni Meta tətbiqə əlavə edin.",
    metaStep4: "Kanalı saxlayın, sonra «Meta ilə qoş» düyməsini basın — OAuth sizin tətbiqinizlə işləyəcək.",
    metaAppSecretPlaceholder: "Meta tətbiq secret",
    metaVerifyTokenPlaceholder: "istənilən-uzun-sətir",
    metaVerifyTokenHint: "İstənilən sətir — Meta tətbiqin webhook konfiqurasiyasındakı Verify Token ilə eyni olmalıdır.",
    metaConnectFacebook: "Facebook Page qoş →",
    metaConnectInstagram: "Instagram account qoş →",
    metaOneClickTitle: "LeadDrive-ın Meta tətbiqi ilə qoşulma",
    metaOneClickDesc: "Bir klik: Facebook-a daxil olun, səhifəni seçin — LeadDrive gələn mesajları özü qoşur. App ID, App Secret və Verify Token lazım deyil.",
    metaOneClickIgNote: "Instagram Direct hesaba bağlı Facebook səhifəsi vasitəsilə gəlir.",
    metaOwnAppToggle: "Öz Meta tətbiqim var (təcrübəlilər üçün)",
    metaOwnAppHint: "Üç sahəni birlikdə doldurun — App ID, App Secret və Verify Token. Yarımçıq dəst LeadDrive-ın webhook və OAuth mexanizmləri tərəfindən nəzərə alınmır.",
    metaOwnAppRequiredError: "Meta App ID, App Secret və Verify Token-i birlikdə daxil edin — və ya üçünü də boş buraxıb LeadDrive-ın ümumi tətbiqindən istifadə edin.",
    metaNeedsSetup: "Bu iş sahəsi üçün bir kliklə qoşulma konfiqurasiya edilməyib. Aşağıda öz Meta tətbiqinizi istifadə edin.",
    metaSaveFirst: "Öz Meta tətbiqinizi göstərmisiniz, amma onun App ID-si saxlanmayıb (və ya dəyişdirilib, saxlanmayıb). Əvvəl kanalı saxlayın — OAuth tətbiqinizi saxlanmış App ID ilə tapır, əks halda qoşulma köhnə ID ilə gedəcək.",
    metaStateConnected: "Qoşulub. LeadDrive {page} səhifəsi üçün giriş tokeni saxlayır; gələn mesajlar Inbox-a düşür.",
    metaStateDraft: metaConnectionReason("az", "draft"),
    metaStateNew: "Hələ qoşulmayıb. Bu formanı saxlamaq yalnız kanalı yaradır; mesajlar «Meta ilə qoş» tamamlandıqdan sonra gəlməyə başlayır.",
    metaStatePaused: metaConnectionReason("az", "paused"),
    metaStateReconnect: metaConnectionReason("az", "needsReconnect"),
    metaManualFallback: "Qoşulmadan sonra avtomatik doldurulur. Manual yalnız fallback üçün yazın:",
    metaPageIdLabel: "Page ID",
    metaPageIdPlaceholder: "Facebook Page ID-niz",
  },
}

function CopyableProviderValue({
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-1.5 rounded-2xl border border-orange-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-700">{label}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="h-7 shrink-0 px-2 text-xs text-orange-700 hover:bg-orange-50 hover:text-orange-800"
        >
          {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <code className="block break-all rounded-xl bg-orange-50 px-3 py-2 font-mono text-xs leading-5 text-orange-900 ring-1 ring-orange-100">
        {value}
      </code>
    </div>
  )
}

function setupStepKeysForChannel(channelType: string, smsProvider: SmsProvider, igLogin: boolean): string[] {
  if (channelType === "whatsapp") {
    return [
      "channelSetupWhatsapp1",
      "channelSetupWhatsapp2",
      "channelSetupWhatsapp3",
    ]
  }
  if (channelType === "chatwoot") {
    return [
      "channelSetupChatwoot1",
      "channelSetupChatwoot2",
      "channelSetupChatwoot3",
    ]
  }
  if (channelType === "facebook" || channelType === "instagram") {
    return [
      igLogin
        ? "channelSetupMetaIgLogin1"
        : "channelSetupMeta1",
      "channelSetupMeta2",
      "channelSetupMeta3",
    ]
  }
  if (channelType === "sms") {
    return smsProvider === "atl"
      ? [
          "channelSetupSmsAtl1",
          "channelSetupSmsAtl2",
          "channelSetupSmsAtl3",
        ]
      : [
          "channelSetupSmsGeneric1",
          "channelSetupSmsGeneric2",
          "channelSetupSmsGeneric3",
        ]
  }
  if (channelType === "email") {
    return [
      "channelSetupEmail1",
      "channelSetupEmail2",
      "channelSetupEmail3",
    ]
  }
  if (channelType === "telegram" || channelType === "vkontakte") {
    return [
      "channelSetupBot1",
      "channelSetupBot2",
      "channelSetupBot3",
    ]
  }
  return [
    "channelSetupGeneric1",
    "channelSetupGeneric2",
    "channelSetupGeneric3",
  ]
}

function setupStepTargetId(stepKey: string | undefined, channelType: string): string {
  switch (stepKey) {
    case "channelSetupWhatsapp1":
      return "whatsappProviderGuide"
    case "channelSetupWhatsapp2":
      return "apiKey"
    case "channelSetupWhatsapp3":
      return "channelSubmitButton"
    case "channelSetupChatwoot1":
      return "chatwootBridgeGuide"
    case "channelSetupChatwoot2":
      return "chatwootBaseUrl"
    case "channelSetupChatwoot3":
      return "chatwootWebhookSecret"
    case "channelSetupMeta1":
    case "channelSetupMetaIgLogin1":
      // KNOWN, NOT FIXED HERE: `metaProviderGuide` now lives inside the collapsed "I have my own Meta
      // app" <details>, so stepping to step 1 scrolls to a node the user cannot see until they expand
      // that block. Left alone on purpose — the fix is to either open the <details> from
      // moveToSetupStep or re-point Model A's step 1 at the one-click block, and both change the step
      // choreography, which is out of scope for the connection-honesty pass.
      return "metaProviderGuide"
    case "channelSetupMeta2":
      return "verifyToken"
    case "channelSetupMeta3":
      return "channelSubmitButton"
    case "channelSetupSmsAtl1":
    case "channelSetupSmsGeneric1":
      return "smsProviderStep"
    case "channelSetupSmsAtl2":
      return "smsAtlCredentialFields"
    case "channelSetupSmsGeneric2":
      return channelType === "sms" ? "smsGenericCredentialFields" : "apiKey"
    case "channelSetupSmsAtl3":
    case "channelSetupSmsGeneric3":
      return "channelSubmitButton"
    case "channelSetupEmail1":
      return "channelTypeSelector"
    case "channelSetupEmail2":
      return "apiKey"
    case "channelSetupEmail3":
      return "channelSubmitButton"
    case "channelSetupBot1":
      return channelType === "vkontakte" ? "vkontakteProviderGuide" : "channelTypeSelector"
    case "channelSetupBot2":
      return channelType === "telegram" ? "botToken" : channelType === "vkontakte" ? "pageId" : "apiKey"
    case "channelSetupBot3":
      return "channelSubmitButton"
    case "channelSetupGeneric1":
      return "channelTypeSelector"
    case "channelSetupGeneric2":
      return "webhookUrl"
    case "channelSetupGeneric3":
      return "channelSubmitButton"
    default:
      return "channelTypeSelector"
  }
}

interface CredentialFieldRow {
  field: string
  source: string
  required?: boolean
}

interface OperatorPlan {
  provider: string
  leadDrive: string
  verify: string
}

function operatorPlanForChannel(channelType: string, smsProvider: SmsProvider, igLogin: boolean, loc: Loc): OperatorPlan {
  const isRu = loc === "ru"
  const isAz = loc === "az"

  if (channelType === "whatsapp") {
    return {
      provider: isRu
        ? "Meta Developers / Business Manager: WABA, номер, Webhook и App Secret."
        : isAz
          ? "Meta Developers / Business Manager: WABA, nömrə, Webhook və App Secret."
          : "Meta Developers / Business Manager: WABA, phone number, Webhook and App Secret.",
      leadDrive: isRu
        ? "Access Token, Phone Number ID, Business Account ID, Verify Token и App Secret."
        : isAz
          ? "Access Token, Phone Number ID, Business Account ID, Verify Token və App Secret."
          : "Access Token, Phone Number ID, Business Account ID, Verify Token and App Secret.",
      verify: isRu
        ? "Отправьте одно входящее WhatsApp-сообщение и проверьте Inbox."
        : isAz
          ? "Bir inbound WhatsApp mesajı göndərin və Inbox-u yoxlayın."
          : "Send one inbound WhatsApp message and confirm it appears in Inbox.",
    }
  }

  if (channelType === "chatwoot") {
    return {
      provider: isRu
        ? "Chatwoot: TikTok inbox, webhook и API access token."
        : isAz
          ? "Chatwoot: TikTok inbox, webhook və API access token."
          : "Chatwoot: TikTok inbox, webhook and API access token.",
      leadDrive: isRu
        ? "Base URL, Account ID, Webhook Secret и Chatwoot API Token."
        : isAz
          ? "Base URL, Account ID, Webhook Secret və Chatwoot API Token."
          : "Base URL, Account ID, Webhook Secret and Chatwoot API Token.",
      verify: isRu
        ? "Отправьте один TikTok DM через Chatwoot и проверьте TikTok-диалог в Inbox."
        : isAz
          ? "Chatwoot vasitəsilə bir TikTok DM göndərin və Inbox-da TikTok dialoqunu yoxlayın."
          : "Send one TikTok DM through Chatwoot and confirm the TikTok conversation in Inbox.",
    }
  }

  if (channelType === "facebook" || channelType === "instagram") {
    const channel = channelType === "facebook" ? "Facebook Messenger" : igLogin ? "Instagram Login" : "Instagram via Facebook Page"
    return {
      provider: isRu
        ? `Meta app: ${channel}, webhook, OAuth redirect и messaging permissions.`
        : isAz
          ? `Meta app: ${channel}, webhook, OAuth redirect və messaging permissions.`
          : `Meta app: ${channel}, webhook, OAuth redirect and messaging permissions.`,
      leadDrive: isRu
        ? "App ID, App Secret, Verify Token; Page/token заполняется после OAuth."
        : isAz
          ? "App ID, App Secret, Verify Token; Page/token OAuth-dan sonra dolur."
          : "App ID, App Secret, Verify Token; Page/token is filled after OAuth.",
      verify: isRu
        ? "После OAuth отправьте один входящий DM и проверьте Inbox."
        : isAz
          ? "OAuth-dan sonra bir inbound DM göndərin və Inbox-u yoxlayın."
          : "After OAuth, send one inbound DM and confirm it appears in Inbox.",
    }
  }

  if (channelType === "sms") {
    const provider = smsProvider === "atl" ? "ATL" : smsProvider === "twilio" ? "Twilio" : "Vonage"
    return {
      provider: isRu
        ? `${provider}: sender approval и API-доступ до отправки теста.`
        : isAz
          ? `${provider}: testdən əvvəl sender approval və API girişini hazırlayın.`
          : `${provider}: sender approval and API access before any test send.`,
      leadDrive: smsProvider === "atl"
        ? (isRu ? "ATL login, password/API secret и sender title." : isAz ? "ATL login, password/API secret və sender title." : "ATL login, password/API secret and sender title.")
        : (isRu ? "Provider account/key, secret и sending number/from name." : isAz ? "Provider account/key, secret və sending number/from name." : "Provider account/key, secret and sending number/from name."),
      verify: isRu
        ? "Сначала отправьте одно SMS на контролируемый номер, не на клиентскую базу."
        : isAz
          ? "Əvvəl müştəri bazasına yox, bir nəzarətli nömrəyə SMS göndərin."
          : "Send one SMS to a controlled number first, not to the customer list.",
    }
  }

  return {
    provider: isRu
      ? "Подготовьте внешний аккаунт, bot, mailbox или webhook у провайдера."
      : isAz
        ? "Provayderdə xarici hesab, bot, mailbox və ya webhook hazırlayın."
        : "Prepare the external account, bot, mailbox or webhook at the provider.",
    leadDrive: isRu
      ? "Заполните только поля выбранного канала в закреплённой форме."
      : isAz
        ? "Kilidlənmiş formada yalnız seçilmiş kanalın sahələrini doldurun."
        : "Fill only this selected channel's fields in the locked form.",
    verify: isRu
      ? "Проверьте одно контролируемое входящее событие в Inbox."
      : isAz
        ? "Inbox-da bir nəzarətli inbound event yoxlayın."
        : "Verify one controlled inbound event in Inbox.",
  }
}

function credentialFieldRowsForChannel(channelType: string, smsProvider: SmsProvider, igLogin: boolean, loc: Loc): CredentialFieldRow[] {
  const isRu = loc === "ru"
  const isAz = loc === "az"
  if (channelType === "whatsapp") {
    return [
      {
        field: "Access Token",
        source: isRu
          ? "Meta Developers → WhatsApp → API Setup → permanent token"
          : isAz
            ? "Meta Developers → WhatsApp → API Setup → permanent token"
            : "Meta Developers → WhatsApp → API Setup → permanent token",
        required: true,
      },
      {
        field: "Phone Number ID",
        source: isRu
          ? "Meta WhatsApp API Setup: ID рядом с подключённым номером"
          : isAz
            ? "Meta WhatsApp API Setup: qoşulmuş nömrənin yanındakı ID"
            : "Meta WhatsApp API Setup: the ID next to the connected phone number",
        required: true,
      },
      {
        field: "Business Account ID / WABA ID",
        source: isRu
          ? "Meta Business Manager → WhatsApp accounts"
          : isAz
            ? "Meta Business Manager → WhatsApp accounts"
            : "Meta Business Manager → WhatsApp accounts",
        required: true,
      },
      {
        field: "Webhook Verify Token",
        source: isRu
          ? "Любая строка, которую вы сами задаёте и повторяете в Meta Webhook"
          : isAz
            ? "Özünüz seçdiyiniz və Meta Webhook-da təkrar yazdığınız istənilən sətir"
            : "Any string you choose and repeat in Meta Webhook settings",
        required: true,
      },
      {
        field: "App Secret",
        source: isRu
          ? "Meta Developers → App settings → Basic → App Secret"
          : isAz
            ? "Meta Developers → App settings → Basic → App Secret"
            : "Meta Developers → App settings → Basic → App Secret",
        required: true,
      },
    ]
  }

  if (channelType === "chatwoot") {
    return [
      {
        field: "Chatwoot Base URL",
        source: isRu ? "URL вашего Chatwoot workspace" : isAz ? "Chatwoot workspace URL-i" : "Your Chatwoot workspace URL",
        required: true,
      },
      {
        field: "Chatwoot Account ID",
        source: isRu ? "Chatwoot URL/API: числовой account id" : isAz ? "Chatwoot URL/API: rəqəmsal account id" : "Chatwoot URL/API: numeric account id",
        required: true,
      },
      {
        field: "Webhook Secret",
        source: isRu ? "Секрет, который вы задаёте в Chatwoot webhook URL" : isAz ? "Chatwoot webhook URL-də təyin etdiyiniz secret" : "The secret you put into the Chatwoot webhook URL",
        required: true,
      },
      {
        field: "Chatwoot API Token",
        source: isRu ? "Chatwoot Profile → Access Token" : isAz ? "Chatwoot Profile → Access Token" : "Chatwoot Profile → Access Token",
        required: true,
      },
    ]
  }

  if (channelType === "facebook" || channelType === "instagram") {
    // Model A (the default now) needs NO keys at all — one OAuth click through LeadDrive's shared Meta
    // app. The three fields below belong to Model B (the tenant runs its own Meta app), so they are
    // optional here. This mirrors the form's own validation: all three together, or none of them.
    return [
      {
        field: "Meta App ID",
        source: isRu
          ? "Только для своего приложения Meta: Meta Developers → ваш tenant app → App ID"
          : isAz
            ? "Yalnız öz Meta tətbiqi üçün: Meta Developers → tenant app → App ID"
            : "Only for your own Meta app: Meta Developers → your tenant app → App ID",
        required: false,
      },
      {
        field: "App Secret",
        source: isRu
          ? "Только для своего приложения Meta: Meta Developers → App settings → Basic → App Secret"
          : isAz
            ? "Yalnız öz Meta tətbiqi üçün: Meta Developers → App settings → Basic → App Secret"
            : "Only for your own Meta app: Meta Developers → App settings → Basic → App Secret",
        required: false,
      },
      {
        field: "Webhook Verify Token",
        source: isRu
          ? "Только для своего приложения Meta: любая строка, совпадающая с Verify Token в Meta Webhooks"
          : isAz
            ? "Yalnız öz Meta tətbiqi üçün: Meta Webhooks-dakı Verify Token ilə eyni olan istənilən sətir"
            : "Only for your own Meta app: any string matching the Verify Token in Meta Webhooks",
        required: false,
      },
      {
        field: channelType === "instagram" && igLogin ? "Instagram account token" : "Page Access Token / Page ID",
        source: isRu
          ? "Появится после Connect OAuth; вручную заполняется только как fallback"
          : isAz
            ? "Connect OAuth-dan sonra yaranır; manual yalnız fallback üçündür"
            : "Filled after Connect OAuth; manual entry is only a fallback",
      },
    ]
  }

  if (channelType === "sms") {
    if (smsProvider === "atl") {
      return [
        { field: "ATL Login", source: isRu ? "ATL cabinet / договор" : isAz ? "ATL kabinet / müqavilə" : "ATL cabinet / contract", required: true },
        { field: "ATL Password", source: isRu ? "ATL API password или secret" : isAz ? "ATL API password və ya secret" : "ATL API password or secret", required: true },
        { field: "Sender Title", source: isRu ? "Sender title, одобренный ATL" : isAz ? "ATL tərəfindən təsdiqlənmiş sender title" : "Sender title approved by ATL", required: true },
      ]
    }
    if (smsProvider === "twilio") {
      return [
        { field: "Twilio Account SID", source: "Twilio Console → Account Info", required: true },
        { field: "Twilio Auth Token", source: "Twilio Console → Account Info → Auth Token", required: true },
        { field: "Sender Phone", source: isRu ? "Twilio verified/sending number" : isAz ? "Twilio verified/sending number" : "Twilio verified/sending number", required: true },
      ]
    }
    return [
      { field: "Vonage API Key", source: "Vonage Dashboard → API settings", required: true },
      { field: "Vonage API Secret", source: "Vonage Dashboard → API settings", required: true },
      { field: "From Name", source: isRu ? "Sender name, разрешённый для страны" : isAz ? "Ölkə üçün icazəli sender name" : "Sender name allowed for the country", required: true },
    ]
  }

  if (channelType === "email") {
    return [
      { field: "SMTP password / app password", source: isRu ? "Mailbox security settings" : isAz ? "Mailbox security settings" : "Mailbox security settings", required: true },
      { field: "Webhook URL", source: isRu ? "Только если email provider присылает inbound events webhook-ом" : isAz ? "Yalnız email provider inbound events-i webhook ilə göndərirsə" : "Only if your email provider sends inbound events by webhook" },
    ]
  }

  if (channelType === "telegram") {
    return [
      { field: "Bot Token", source: "Telegram BotFather", required: true },
      { field: "Chat ID", source: isRu ? "Тестовый chat/group id, если нужен routing" : isAz ? "Routing lazımdırsa test chat/group id" : "Test chat/group id when routing needs it" },
    ]
  }

  if (channelType === "vkontakte") {
    return [
      { field: "Community ID", source: isRu ? "VK community numeric id" : isAz ? "VK community numeric id" : "VK community numeric id", required: true },
      { field: "Community Access Token", source: isRu ? "VK community → API usage → Access tokens" : isAz ? "VK community → API usage → Access tokens" : "VK community → API usage → Access tokens", required: true },
      { field: "Confirmation String", source: isRu ? "VK Callback API confirmation screen" : isAz ? "VK Callback API confirmation screen" : "VK Callback API confirmation screen", required: true },
    ]
  }

  return []
}

function getChannelNamePlaceholder(channelType: string, smsProvider: SmsProvider, locale: Loc) {
  const isRu = locale === "ru"
  const isAz = locale === "az"
  const examples: Record<string, string> = {
    email: isRu ? "напр. Основная почта поддержки" : isAz ? "məs. Əsas dəstək emaili" : "e.g. Main support email",
    telegram: isRu ? "напр. Telegram бот поддержки" : isAz ? "məs. Dəstək Telegram botu" : "e.g. Support Telegram bot",
    whatsapp: isRu ? "напр. Основной WhatsApp Business" : isAz ? "məs. Əsas WhatsApp Business" : "e.g. Main WhatsApp Business",
    sms: smsProvider === "atl"
      ? (isRu ? "напр. ATL SMS" : isAz ? "məs. ATL SMS" : "e.g. ATL SMS")
      : smsProvider === "twilio"
        ? (isRu ? "напр. Twilio SMS" : isAz ? "məs. Twilio SMS" : "e.g. Twilio SMS")
        : (isRu ? "напр. Vonage SMS" : isAz ? "məs. Vonage SMS" : "e.g. Vonage SMS"),
    facebook: isRu ? "напр. Facebook Messenger" : isAz ? "məs. Facebook Messenger" : "e.g. Facebook Messenger",
    instagram: isRu ? "напр. Instagram Direct" : isAz ? "məs. Instagram Direct" : "e.g. Instagram Direct",
    vkontakte: isRu ? "напр. VK сообщения" : isAz ? "məs. VK mesajları" : "e.g. VK messages",
    chatwoot: isRu ? "напр. TikTok через Chatwoot" : isAz ? "məs. TikTok Chatwoot ilə" : "e.g. TikTok via Chatwoot",
    tiktok: isRu ? "напр. TikTok Business" : isAz ? "məs. TikTok Business" : "e.g. TikTok Business",
  }
  return examples[channelType] || (isRu ? "напр. Канал поддержки" : isAz ? "məs. Dəstək kanalı" : "e.g. Support channel")
}

export function ChannelConfigForm({
  open,
  onOpenChange,
  onSaved,
  initialData,
  orgId,
  orgSlug,
  lockChannelType = false,
  lockChannelTypeLabel = "Selected channel",
  lockChannelTypeHint = "This setup was started from a catalog card, so the channel type is fixed.",
  setupIntent = "new",
  variant = "dialog",
  guidanceMode = "full",
}: ChannelConfigFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const ts = useTranslations("settings")
  const locale = (useLocale() as Loc) || "en"
  const c = localCopy[locale] ?? localCopy.en
  const whatsappCallbackUrl = whatsappWebhookUrl(orgSlug)
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : LEADDRIVE_APP_ORIGIN
  const isEdit = !!initialData?.id
  const isInline = variant === "inline"
  const compactGuidance = guidanceMode === "compact"
  const [form, setForm] = useState<ChannelConfigFormData>({
    configName: "",
    channelType: "email",
    botToken: "",
    webhookUrl: "",
    apiKey: "",
    phoneNumber: "",
    chatId: "",
    accountSid: "",
    appId: "",
    appSecret: "",
    pageId: "",
    confirmationCode: "",
    isActive: true,
    smsProvider: "atl",
    atlLogin: "",
    atlTitle: "",
    twilioAccountSid: "",
    twilioNumber: "",
    vonageApiKey: "",
    vonageFromName: "",
    smsSecret: "",
    smsEditing: false,
    verifyToken: "",
    displayName: "",
    igLogin: false,
    chatwootBaseUrl: "",
    chatwootAccountId: "",
    chatwootWebhookSecret: "",
    emailTicketIntakeAddress: "",
    emailComplaintIntakeAddress: "",
  })
  const [smsTesting, setSmsTesting] = useState(false)
  const [smsTestResult, setSmsTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [smsTestNumber, setSmsTestNumber] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // The save succeeded, but the webhook will deliver this account's DMs to another workspace. Held on
  // screen until acknowledged: navigating straight to the catalog is how the warning got missed before.
  const [savedClaimedElsewhere, setSavedClaimedElsewhere] = useState(false)
  const [activeSetupStepIndex, setActiveSetupStepIndex] = useState(0)
  // Is one-click OAuth actually connectable for this tenant? Same gate the Social Monitoring connect
  // tiles use: an unconfigured provider answers the start route with a JSON 500, which in a browser
  // navigation is a raw error page instead of the Meta dialog. null = still unknown -> show the button
  // optimistically; false = provably not configured -> point at the own-Meta-app section instead.
  const [metaOAuthReady, setMetaOAuthReady] = useState<boolean | null>(null)

  useEffect(() => {
    if (open) {
      const settings = initialData?.settings || {}
      const normalizedChannelType = initialData?.channelType === "tiktok" ? "chatwoot" : initialData?.channelType || "email"
      const normalizedSettings =
        initialData?.channelType === "tiktok"
          ? { ...settings, provider: "tiktok" }
          : settings
      // SMS provider detection: explicit settings.smsProvider wins;
      // otherwise, if row has legacy Twilio fields (apiKey + phoneNumber + settings.accountSid), surface as "twilio".
      let detectedSmsProvider: SmsProvider = "atl"
      if (normalizedSettings.smsProvider === "atl" || normalizedSettings.smsProvider === "twilio" || normalizedSettings.smsProvider === "vonage") {
        detectedSmsProvider = normalizedSettings.smsProvider
      } else if (normalizedChannelType === "sms" && (normalizedSettings.accountSid || initialData?.phoneNumber)) {
        detectedSmsProvider = "twilio"
      }
      const emailIntakeRoutes = emailIntakeRoutesFromSettings(normalizedSettings)
      const ticketIntakeRoute = emailIntakeRoutes.find(route => route.target === "ticket")
      const complaintIntakeRoute = emailIntakeRoutes.find(route => route.target === "complaint")
      const hasExistingSms = normalizedChannelType === "sms" && !!initialData?.id
      setForm({
        configName: initialData?.configName || "",
        channelType: normalizedChannelType,
        botToken: initialData?.botToken || "",
        webhookUrl: initialData?.webhookUrl || "",
        apiKey: initialData?.apiKey || "",
        phoneNumber: initialData?.phoneNumber || "",
        chatId: asString(normalizedSettings.chatId),
        accountSid: asString(normalizedSettings.accountSid),
        appId: initialData?.appId || "",
        appSecret: initialData?.appSecret || "",
        pageId: initialData?.pageId || "",
        confirmationCode: asString(normalizedSettings.confirmationCode),
        isActive: initialData?.isActive ?? true,
        smsProvider: detectedSmsProvider,
        atlLogin: asString(normalizedSettings.atlLogin),
        atlTitle: asString(normalizedSettings.atlTitle),
        twilioAccountSid: asString(normalizedSettings.accountSid),
        twilioNumber: asString(normalizedSettings.twilioNumber) || initialData?.phoneNumber || "",
        vonageApiKey: asString(normalizedSettings.apiKey),
        vonageFromName: asString(normalizedSettings.fromName),
        smsSecret: "",
        smsEditing: hasExistingSms,
        verifyToken: initialData?.verifyToken || "",
        displayName: initialData?.displayName || "",
        igLogin: normalizedSettings.igLogin === true,
        chatwootBaseUrl: asString(normalizedSettings.baseUrl),
        chatwootAccountId: normalizedSettings.accountId != null ? String(normalizedSettings.accountId) : "",
        chatwootWebhookSecret: asString(normalizedSettings.webhookSecret),
        emailTicketIntakeAddress: ticketIntakeRoute?.address || "",
        emailComplaintIntakeAddress: complaintIntakeRoute?.address || "",
      })
      setSmsTestResult(null)
      setSmsTestNumber("")
      setError("")
      setSavedClaimedElsewhere(false)
      setActiveSetupStepIndex(0)
    }
  }, [open, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.configName.trim()) {
      setError(tc("required"))
      return
    }
    // FB/IG: an EMPTY triple is Model A — LeadDrive's shared Meta app, connected with one OAuth click
    // and no tenant keys at all. That is the normal path and must save cleanly.
    // A PARTIAL triple is the failure this check exists for: the webhook + OAuth resolvers require
    // appId + appSecret + verifyToken together, so a half-filled row is silently excluded by them
    // (its ?t webhook 403s and OAuth quietly falls back to the shared app). So: all three, or none.
    // Stored secrets are no longer returned to the browser; on EDIT a blank field keeps a value when
    // the API says it exists — hence the hasStored* flags count as "declared".
    if (form.channelType === "facebook" || form.channelType === "instagram") {
      if (
        declaresOwnMetaApp
        && (
          !form.appId.trim()
          || (!hasStoredMetaVerifyToken && !form.verifyToken.trim())
          || (!hasStoredMetaAppSecret && !form.appSecret.trim())
        )
      ) {
        setError(c.metaOwnAppRequiredError)
        return
      }
    }
    if (form.channelType === "whatsapp") {
      if (
        (!hasStoredWhatsAppAccessToken && !form.apiKey.trim()) ||
        (!hasStoredWhatsAppPhoneNumberId && !form.phoneNumber.trim()) ||
        (!hasStoredWhatsAppBusinessAccountId && !form.webhookUrl.trim()) ||
        (!hasStoredWhatsAppVerifyToken && !form.verifyToken.trim()) ||
        (!hasStoredWhatsAppAppSecret && !form.appSecret.trim())
      ) {
        setError(c.whatsappRequiredError)
        return
      }
    }
    if (form.channelType === "chatwoot") {
      if (
        !form.chatwootBaseUrl.trim()
        || !form.chatwootAccountId.trim()
        || (!hasStoredChatwootWebhookSecret && !form.chatwootWebhookSecret.trim())
        || (!isEdit && !form.apiKey.trim())
      ) {
        setError("Chatwoot Base URL, Account ID, API Token, and Webhook Secret are required for TikTok via Chatwoot.")
        return
      }
    }
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/channels/${initialData!.id}` : "/api/v1/channels"
      const payload = buildChannelPayload(form)
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      if (json?.data?.claimedElsewhere === true) {
        setSavedClaimedElsewhere(true)
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tc("failedToSave"))
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof ChannelConfigFormData>(key: K, value: ChannelConfigFormData[K]) => setForm((f) => ({ ...f, [key]: value }))
  const selectedChannelType = channelTypes.find(ct => ct.value === form.channelType)
  const LockedChannelIcon = selectedChannelType?.icon
  const setupStepKeys = setupStepKeysForChannel(form.channelType, form.smsProvider, form.igLogin)
  const safeSetupStepIndex = Math.min(activeSetupStepIndex, Math.max(setupStepKeys.length - 1, 0))
  const activeSetupStepKey = setupStepKeys[safeSetupStepIndex]
  const activeSetupStepText = activeSetupStepKey ? tf(activeSetupStepKey) : ""
  const setupProgress = setupStepKeys.length ? ((safeSetupStepIndex + 1) / setupStepKeys.length) * 100 : 0
  const setupIntentLabel = isEdit || setupIntent === "existing" ? tf("channelSetupModeExisting") : tf("channelSetupModeNew")
  const setupIntentTitle = isEdit || setupIntent === "existing" ? c.scenarioExistingTitle : c.scenarioNewTitle
  const setupIntentDescription = isEdit || setupIntent === "existing" ? c.scenarioExistingDesc : c.scenarioNewDesc
  const operatorPlan = operatorPlanForChannel(form.channelType, form.smsProvider, form.igLogin, locale)
  const hasStoredWhatsAppAccessToken = form.channelType === "whatsapp" && isEdit && initialData?.hasAccessToken
  const hasStoredWhatsAppPhoneNumberId = form.channelType === "whatsapp" && isEdit && initialData?.hasPhoneNumberId
  const hasStoredWhatsAppBusinessAccountId = form.channelType === "whatsapp" && isEdit && initialData?.hasBusinessAccountId
  const hasStoredWhatsAppVerifyToken = form.channelType === "whatsapp" && isEdit && initialData?.hasVerifyToken
  const hasStoredWhatsAppAppSecret = form.channelType === "whatsapp" && isEdit && initialData?.hasAppSecret
  const hasStoredMetaVerifyToken = (form.channelType === "facebook" || form.channelType === "instagram") && isEdit && initialData?.hasVerifyToken
  const hasStoredMetaAppSecret = (form.channelType === "facebook" || form.channelType === "instagram") && isEdit && initialData?.hasAppSecret
  const isMetaChannel = form.channelType === "facebook" || form.channelType === "instagram"
  // Model B detector — the tenant runs its OWN Meta app. Single source of truth for both the
  // all-three-or-none save rule in handleSubmit and the OAuth guard below. It must be declared AFTER
  // the hasStoredMeta* flags it reads; handleSubmit sits earlier in the file but only evaluates this
  // when the user submits, i.e. after render, so there is no TDZ.
  const declaresOwnMetaApp = isMetaChannel && Boolean(
    form.appId.trim()
    || form.appSecret.trim()
    || form.verifyToken.trim()
    || hasStoredMetaAppSecret
    || hasStoredMetaVerifyToken
  )
  // Model-B-only guard (restored — the one-click rewrite dropped it): "Connect" navigates away and the
  // OAuth start/callback routes resolve the tenant's Meta app from the DB, so an App ID that is empty
  // or edited-but-unsaved would silently run the flow against the STORED (stale) one — or fall through
  // to LeadDrive's shared app, which is not what a tenant with its own app asked for.
  // Model A declares no app at all, so declaresOwnMetaApp is false there and one click stays one click.
  const ownMetaAppIdSaved = isEdit
    && Boolean(form.appId.trim())
    && form.appId.trim() === (initialData?.appId || "").trim()
  const metaOAuthBlockedByOwnApp = declaresOwnMetaApp && !ownMetaAppIdSaved
  // Honest connection state, from the SAME predicate the catalog uses (lib/channels/live-connection):
  // a saved row is not a connection, and neither is a wired row that is switched off or one whose Meta
  // message subscription explicitly failed.
  const metaConnectionState = channelConnectionState({
    channelType: form.channelType,
    pageId: initialData?.pageId,
    isActive: initialData?.isActive,
    hasAccessToken: initialData?.hasAccessToken,
    settings: initialData?.settings,
    claimedElsewhere: initialData?.claimedElsewhere,
  })
  const metaConnectionLive = isMetaChannel && isEdit && metaConnectionState === "live"
  // Each non-live state has a different fix, and the user cannot guess which one applies: an
  // unfinished OAuth, a channel someone switched off, a subscription Meta refused, and an account another
  // workspace connected first all look identical from the outside.
  const metaConnectionMessage = metaConnectionLive
    ? c.metaStateConnected.replace("{page}", initialData?.pageId || "")
    : !isEdit
      ? c.metaStateNew
      : metaConnectionState === "paused"
        ? c.metaStatePaused
        : metaConnectionState === "claimedElsewhere"
          ? ts("channelClaimedElsewhere.reason")
          : metaConnectionState === "needsReconnect"
            ? c.metaStateReconnect
            : c.metaStateDraft
  const hasStoredChatwootWebhookSecret = form.channelType === "chatwoot" && isEdit && initialData?.hasWebhookSecret
  const credentialStateHint = (isStored?: boolean) => (isStored ? c.storedCredentialHint : c.missingCredentialHint)
  const moveToSetupStep = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, Math.max(setupStepKeys.length - 1, 0)))
    const targetId = setupStepTargetId(setupStepKeys[nextIndex], form.channelType)

    setActiveSetupStepIndex(nextIndex)

    if (typeof window === "undefined") return
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId) || document.getElementById("channelTypeSelector")
      if (!target) return
      // Some step targets (the Meta provider guide, the Verify Token field) now live inside the
      // collapsed "I have my own Meta app" <details>. Scrolling to a hidden element would look like
      // the stepper doing nothing, so open its container first.
      target.closest("details")?.setAttribute("open", "")

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      target.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion ? "auto" : "smooth",
      })
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true })
      }
    })
  }
  const credentialGuide =
    form.channelType === "whatsapp"
      ? { needs: c.whatsappCredentialMap, afterSave: c.whatsappAfterSave }
      : form.channelType === "chatwoot"
        ? { needs: c.chatwootCredentialMap, afterSave: c.chatwootAfterSave }
        : form.channelType === "facebook" || form.channelType === "instagram"
          ? { needs: c.metaCredentialMap, afterSave: c.metaAfterSave }
          : form.channelType === "sms" && form.smsProvider === "atl"
            ? { needs: c.smsAtlCredentialMap, afterSave: c.smsAtlAfterSave }
            : form.channelType === "sms"
              ? { needs: c.smsGenericCredentialMap, afterSave: c.smsGenericAfterSave }
              : null
  const credentialFieldRows = credentialFieldRowsForChannel(form.channelType, form.smsProvider, form.igLogin, locale)
  const chatwootWebhookEndpoint = `${browserOrigin}/api/v1/webhooks/chatwoot?token=<webhook-secret>`
  const metaWebhookEndpoint = `${browserOrigin}/api/v1/webhooks/${form.igLogin ? "instagram" : "facebook"}?t=${orgSlug || "<your-workspace-slug>"}`
  const metaOAuthRedirectUri = `${browserOrigin}/api/v1/social/oauth/${form.igLogin ? "instagram" : "facebook"}/callback`

  useEffect(() => {
    if (activeSetupStepIndex >= setupStepKeys.length) {
      setActiveSetupStepIndex(Math.max(setupStepKeys.length - 1, 0))
    }
  }, [activeSetupStepIndex, setupStepKeys.length])

  // Ask whether this tenant's Meta OAuth is connectable at all (tenant app OR LeadDrive's env app).
  // Deps are the org ID STRING, never the session object — see
  // src/__tests__/no-session-object-in-effect-deps.test.ts for why that distinction matters.
  useEffect(() => {
    if (form.channelType !== "facebook" && form.channelType !== "instagram") return
    let cancelled = false
    setMetaOAuthReady(null)
    fetch("/api/v1/social/oauth/providers", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { providers?: Record<string, boolean> } | null) => {
        if (cancelled || !data?.providers) return
        setMetaOAuthReady(Boolean(form.igLogin ? data.providers.instagram : data.providers.facebook))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, form.channelType, form.igLogin])

  useEffect(() => {
    setActiveSetupStepIndex(0)
  }, [form.channelType, form.smsProvider, form.igLogin])

  const formBody = (
    <>
      <DialogHeader
        className={cn(
          "border-b border-zinc-200 text-zinc-950",
          compactGuidance ? "px-5 pb-4 pt-5" : "px-6 pb-5 pt-6",
          isInline ? "bg-zinc-50" : "bg-gradient-to-br from-white via-orange-50/60 to-white",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className={cn("flex min-w-0 items-start", compactGuidance ? "gap-3" : "gap-4")}>
            <div
              className={cn(
                "grid shrink-0 place-items-center border bg-white text-orange-600 shadow-sm",
                compactGuidance ? "h-10 w-10 rounded-xl border-zinc-200 shadow-none" : "h-12 w-12 rounded-2xl border-orange-200",
              )}
            >
              {LockedChannelIcon ? <LockedChannelIcon className={compactGuidance ? "h-5 w-5" : "h-6 w-6"} /> : <MessageSquare className={compactGuidance ? "h-5 w-5" : "h-6 w-6"} />}
            </div>
            <div className="min-w-0">
              {!compactGuidance && (
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">
                  {isInline && lockChannelType && selectedChannelType ? c.inlineSetupEyebrow : tf("channelSetupEyebrow")}
                </p>
              )}
              <DialogTitle className={cn("tracking-tight", compactGuidance ? "text-xl" : "mt-1 text-2xl")}>
                {isInline && lockChannelType && selectedChannelType
                  ? lockChannelTypeLabel
                  : isEdit
                    ? tf("editChannel")
                    : tf("newChannel")}
              </DialogTitle>
              {!compactGuidance && (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  {isInline && lockChannelType && selectedChannelType ? c.inlineSetupDesc : tf("channelSetupModalDesc")}
                </p>
              )}
            </div>
          </div>
          {lockChannelType && selectedChannelType && (
            <div
              className={cn(
                "w-fit rounded-full border bg-white font-semibold",
                compactGuidance
                  ? "border-zinc-200 px-2.5 py-1 text-xs text-zinc-600"
                  : "border-orange-200 px-3 py-1 text-sm text-orange-700 shadow-sm",
              )}
            >
              {setupIntentLabel}
            </div>
          )}
        </div>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent className={cn("bg-white text-zinc-950", isInline ? "p-5 lg:p-6" : "")}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className={compactGuidance ? "space-y-4" : "space-y-6"}>
            {/* Name */}
            <div>
              <Label htmlFor="configName" className="text-sm font-medium">{tc("name")}</Label>
              <Input
                id="configName"
                value={form.configName}
                onChange={(e) => update("configName", e.target.value)}
                placeholder={getChannelNamePlaceholder(form.channelType, form.smsProvider, locale)}
                className="mt-1.5"
              />
              {!compactGuidance && (
                <p className="text-xs text-muted-foreground mt-1">
                  {tf("channelNameHint")}
                </p>
              )}
            </div>

            {/* Channel type */}
            <div
              id="channelTypeSelector"
              tabIndex={-1}
              className="scroll-mt-6 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              <Label className="text-sm font-medium">{tf("channelType")}</Label>
              {lockChannelType && selectedChannelType ? (
                <div
                  className={cn(
                    "mt-1.5 flex gap-3 border",
                    compactGuidance
                      ? "items-center rounded-lg border-zinc-200 bg-zinc-50 px-3 py-2"
                      : "items-start rounded-2xl border-orange-200 bg-orange-50/80 p-4 shadow-sm",
                  )}
                >
                  <div
                    className={cn(
                      "grid shrink-0 place-items-center bg-white text-orange-600 ring-1",
                      compactGuidance ? "h-8 w-8 rounded-lg ring-zinc-200" : "h-11 w-11 rounded-xl ring-orange-200",
                    )}
                  >
                    {LockedChannelIcon && <LockedChannelIcon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-950">{lockChannelTypeLabel}</p>
                    {!compactGuidance && (
                      <p className="mt-1 text-xs leading-5 text-zinc-600">{selectedChannelType.label} · {lockChannelTypeHint}</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 mt-1.5 sm:grid-cols-7 lg:grid-cols-7">
                    {channelTypes.map(ct => {
                      const Icon = ct.icon
                      const selected = form.channelType === ct.value
                      return (
                        <button
                          key={ct.value}
                          type="button"
                          onClick={() => update("channelType", ct.value)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs font-medium transition",
                            selected
                              ? "border-orange-500 bg-orange-50 text-orange-700"
                              : "border-transparent bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-950"
                          )}
                        >
                          <Icon className={cn("h-5 w-5", selected ? "text-orange-600" : "")} />
                          {ct.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("channelTypeHint")}
                  </p>
                </>
              )}
            </div>

            {!compactGuidance && lockChannelType && selectedChannelType && (
              <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                      {c.scenarioBoxTitle}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">
                      {setupIntentTitle}
                    </h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                      {setupIntentDescription}
                    </p>
                  </div>
                  <div className="w-fit rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">
                    {setupIntentLabel}
                  </div>
                </div>
                <div className="mt-4 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200">
                  {[
                    { label: c.planProviderTitle, value: operatorPlan.provider, marker: "1" },
                    { label: c.planLeadDriveTitle, value: operatorPlan.leadDrive, marker: "2" },
                    { label: c.planVerifyTitle, value: operatorPlan.verify, marker: "3" },
                  ].map((item) => (
                    <div key={item.label} className="bg-zinc-50 p-4">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">
                          {item.marker}
                        </span>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          {item.label}
                        </p>
                      </div>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-700">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!compactGuidance && lockChannelType && selectedChannelType && (
              <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-50/80 shadow-sm">
                <div className="border-b border-zinc-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-200">
                      <span className="text-sm font-bold">1</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-950">
                        {tf("channelSetupTitle", { channel: selectedChannelType.label })}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {tf("channelSetupIntro")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <div
                    className="mb-4 h-2 overflow-hidden rounded-full bg-zinc-200"
                    role="progressbar"
                    aria-label={`${c.setupStepLabel} ${safeSetupStepIndex + 1}/${setupStepKeys.length}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(setupProgress)}
                  >
                    <div
                      className="h-full rounded-full bg-orange-500 transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${setupProgress}%` }}
                    />
                  </div>
                  <div className="mb-4 rounded-2xl border border-orange-200 bg-white px-4 py-3" aria-live="polite">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                      {c.setupCurrentStep} · {c.setupStepLabel} {safeSetupStepIndex + 1}/{setupStepKeys.length}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-700">{activeSetupStepText}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{c.setupStepperHint}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={safeSetupStepIndex === 0}
                        onClick={() => moveToSetupStep(safeSetupStepIndex - 1)}
                      >
                        {c.setupPreviousStep}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={safeSetupStepIndex >= setupStepKeys.length - 1}
                        onClick={() => moveToSetupStep(safeSetupStepIndex + 1)}
                      >
                        {c.setupNextStep}
                      </Button>
                    </div>
                  </div>
                  <ol className="grid gap-2">
                    {setupStepKeys.map((stepKey, index) => {
                      const selected = safeSetupStepIndex === index
                      return (
                        <li key={stepKey}>
                          <button
                            type="button"
                            onClick={() => moveToSetupStep(index)}
                            aria-current={selected ? "step" : undefined}
                            className={cn(
                              "flex w-full gap-3 rounded-2xl border px-3 py-3 text-left text-sm leading-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                              selected
                                ? "border-orange-400 bg-orange-50 text-orange-950 shadow-[0_0_0_2px_rgba(251,146,60,0.20)]"
                                : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200 hover:bg-zinc-50 hover:text-orange-900"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                                selected ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700"
                              )}
                            >
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1">{tf(stepKey)}</span>
                            {selected ? (
                              <span className="self-start rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-200">
                                {c.setupCurrentStep}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              </div>
            )}

            {!compactGuidance && lockChannelType && selectedChannelType && (
              <div className="rounded-3xl border border-orange-200 bg-orange-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-orange-600 ring-1 ring-orange-200">
                    <span className="text-sm font-bold">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">
                      {c.setupNextBlockTitle}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {tf("channelSetupCredentialHint")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!compactGuidance && credentialGuide && (
              <div className="grid gap-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    {c.credentialMapTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-700">{credentialGuide.needs}</p>
                </div>
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                    {c.afterSaveTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-orange-800">{credentialGuide.afterSave}</p>
                </div>
              </div>
            )}

            {!compactGuidance && lockChannelType && credentialFieldRows.length > 0 && (
              <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                    {c.fieldMapTitle}
                  </p>
                  <p className="max-w-2xl text-xs leading-5 text-zinc-500">{c.fieldMapHint}</p>
                </div>
                <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200">
                  <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <span>{c.fieldMapField}</span>
                    <span className="mt-1 block normal-case tracking-normal text-zinc-400">{c.fieldMapWhere}</span>
                  </div>
                  <div className="divide-y divide-zinc-100">
                    {credentialFieldRows.map((row) => (
                      <div
                        key={`${row.field}-${row.source}`}
                        className="grid gap-1.5 px-4 py-3 text-sm leading-6 text-zinc-700"
                      >
                        <div className="flex flex-wrap items-center gap-2 font-medium text-zinc-950">
                          <span>{row.field}</span>
                          {row.required ? (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700">
                              {c.requiredBadge}
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 break-words rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-100">
                          {row.source}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Динамические поля по типу канала */}
            {form.channelType === "telegram" && (
              <>
                <div>
                  <Label htmlFor="botToken" className="text-sm font-medium">Bot Token</Label>
                  <Input
                    id="botToken"
                    value={form.botToken}
                    onChange={(e) => update("botToken", e.target.value)}
                    placeholder="123456:ABC-DEF..."
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("telegramBotTokenHint")}
                  </p>
                </div>
                <div>
                  <Label htmlFor="chatId" className="text-sm font-medium">Chat ID</Label>
                  <Input
                    id="chatId"
                    value={form.chatId}
                    onChange={(e) => update("chatId", e.target.value)}
                    placeholder="123456789"
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("telegramChatIdHint")}
                  </p>
                </div>
              </>
            )}

            {form.channelType === "email" && (
              <>
                <div>
                  <Label htmlFor="apiKey" className="text-sm font-medium">{tf("apiKeySmtpPassword")}</Label>
                  <Input
                    id="apiKey"
                    value={form.apiKey}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder="sk-..."
                    className="mt-1.5 font-mono text-sm"
                    type="password"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("apiKeyHint")}
                  </p>
                </div>
                <div>
                  <Label htmlFor="webhookUrl" className="text-sm font-medium">Webhook URL</Label>
                  <Input
                    id="webhookUrl"
                    value={form.webhookUrl}
                    onChange={(e) => update("webhookUrl", e.target.value)}
                    placeholder="https://hooks.example.com/..."
                    className="mt-1.5"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("webhookUrlHint")}
                  </p>
                </div>
                <section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/30">
                  <div>
                    <h3 className="text-sm font-semibold">{c.emailIntakeTitle}</h3>
                  </div>
                  <div>
                    <Label htmlFor="emailTicketIntakeAddress" className="text-sm font-medium">{c.emailTicketIntakeLabel}</Label>
                    <Input
                      id="emailTicketIntakeAddress"
                      value={form.emailTicketIntakeAddress}
                      onChange={(e) => update("emailTicketIntakeAddress", e.target.value)}
                      placeholder="support@example.com"
                      className="mt-1.5"
                      type="email"
                    />
                    <p className="text-xs text-muted-foreground mt-1">{c.emailTicketIntakeHint}</p>
                  </div>
                  <div>
                    <Label htmlFor="emailComplaintIntakeAddress" className="text-sm font-medium">{c.emailComplaintIntakeLabel}</Label>
                    <Input
                      id="emailComplaintIntakeAddress"
                      value={form.emailComplaintIntakeAddress}
                      onChange={(e) => update("emailComplaintIntakeAddress", e.target.value)}
                      placeholder="complaints@example.com"
                      className="mt-1.5"
                      type="email"
                    />
                    <p className="text-xs text-muted-foreground mt-1">{c.emailComplaintIntakeHint}</p>
                  </div>
                </section>
              </>
            )}

            {form.channelType === "whatsapp" && (
              <section className="space-y-5 rounded-3xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
                <div
                  id="whatsappProviderGuide"
                  tabIndex={-1}
                  className="scroll-mt-6 rounded-lg border border-orange-200 bg-orange-50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                >
                  <p className="mb-1 text-xs font-medium text-orange-800">Meta WhatsApp Business API</p>
                  <p className="text-xs text-orange-700">
                    {tf("whatsappWabaHint")}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {c.whatsappMessagingOnly}
                </div>
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <p className="text-xs font-medium text-orange-800">{c.whatsappWebhookTitle}</p>
                  <CopyableProviderValue
                    label="Callback URL"
                    value={whatsappCallbackUrl}
                    copyLabel={c.copyValue}
                    copiedLabel={c.copiedValue}
                  />
                  <p className="text-xs leading-5 text-orange-700">{c.whatsappWebhookHint}</p>
                  <p className="text-xs leading-5 text-orange-700">{c.whatsappCallingNote}</p>
                </div>
                <div>
                  <Label htmlFor="apiKey" className="text-sm font-medium">{tf("whatsappAccessToken")} *</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder={hasStoredWhatsAppAccessToken ? c.storedCredentialPlaceholder : "EAAi..."}
                    className="mt-1.5 font-mono text-sm"
                    required={!hasStoredWhatsAppAccessToken}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tf("whatsappTokenHint")}
                  </p>
                  {isEdit && (
                    <p className={`mt-1 text-xs ${hasStoredWhatsAppAccessToken ? "text-emerald-700" : "text-amber-700"}`}>
                      {credentialStateHint(hasStoredWhatsAppAccessToken)}
                    </p>
                  )}
                </div>
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="phoneNumber" className="text-sm font-medium">Phone Number ID *</Label>
                    <Input
                      id="phoneNumber"
                      value={form.phoneNumber}
                      onChange={(e) => update("phoneNumber", e.target.value)}
                      placeholder={hasStoredWhatsAppPhoneNumberId ? c.storedCredentialPlaceholder : "1089534267571015"}
                      className="mt-1.5 font-mono text-sm"
                      required={!hasStoredWhatsAppPhoneNumberId}
                    />
                    <p className="text-xs text-muted-foreground mt-1">{tf("whatsappPhoneIdHint")}</p>
                    {isEdit && (
                      <p className={`mt-1 text-xs ${hasStoredWhatsAppPhoneNumberId ? "text-emerald-700" : "text-amber-700"}`}>
                        {credentialStateHint(hasStoredWhatsAppPhoneNumberId)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="webhookUrl" className="text-sm font-medium">Business Account ID *</Label>
                    <Input
                      id="webhookUrl"
                      value={form.webhookUrl}
                      onChange={(e) => update("webhookUrl", e.target.value)}
                      placeholder={hasStoredWhatsAppBusinessAccountId ? c.storedCredentialPlaceholder : "907151598973492"}
                      className="mt-1.5 font-mono text-sm"
                      required={!hasStoredWhatsAppBusinessAccountId}
                    />
                    <p className="text-xs text-muted-foreground mt-1">{tf("whatsappAccountIdHint")}</p>
                    {isEdit && (
                      <p className={`mt-1 text-xs ${hasStoredWhatsAppBusinessAccountId ? "text-emerald-700" : "text-amber-700"}`}>
                        {credentialStateHint(hasStoredWhatsAppBusinessAccountId)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="verifyToken" className="text-sm font-medium">Webhook Verify Token *</Label>
                    <Input
                      id="verifyToken"
                      value={form.verifyToken}
                      onChange={(e) => update("verifyToken", e.target.value)}
                      placeholder={hasStoredWhatsAppVerifyToken ? c.storedCredentialPlaceholder : tf("whatsappVerifyTokenPlaceholder")}
                      className="mt-1.5 font-mono text-sm"
                      required={!hasStoredWhatsAppVerifyToken}
                    />
                    <p className="text-xs text-muted-foreground mt-1">{tf("whatsappVerifyTokenHint")}</p>
                    {isEdit && (
                      <p className={`mt-1 text-xs ${hasStoredWhatsAppVerifyToken ? "text-emerald-700" : "text-amber-700"}`}>
                        {credentialStateHint(hasStoredWhatsAppVerifyToken)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="appSecret" className="text-sm font-medium">App Secret *</Label>
                    <Input
                      id="appSecret"
                      type="password"
                      value={form.appSecret}
                      onChange={(e) => update("appSecret", e.target.value)}
                      placeholder={hasStoredWhatsAppAppSecret ? c.storedCredentialPlaceholder : tf("whatsappAppSecretPlaceholder")}
                      className="mt-1.5 font-mono text-sm"
                      required={!hasStoredWhatsAppAppSecret}
                    />
                    <p className="text-xs text-muted-foreground mt-1">{tf("whatsappAppSecretHint")}</p>
                    {isEdit && (
                      <p className={`mt-1 text-xs ${hasStoredWhatsAppAppSecret ? "text-emerald-700" : "text-amber-700"}`}>
                        {credentialStateHint(hasStoredWhatsAppAppSecret)}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="displayName" className="text-sm font-medium">{c.displayNameLabel}</Label>
                  <Input
                    id="displayName"
                    value={form.displayName}
                    onChange={(e) => update("displayName", e.target.value)}
                    placeholder="AFI Group WhatsApp"
                    className="mt-1.5 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{tf("whatsappDisplayNameHint")}</p>
                </div>
              </section>
            )}

            {form.channelType === "sms" && (
              <section className="space-y-5 rounded-3xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
                <div
                  id="smsProviderStep"
                  tabIndex={-1}
                  className="scroll-mt-6 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                >
                  <Label htmlFor="smsProvider" className="text-sm font-medium">{tf("smsProviderLabel")}</Label>
                  <Select
                    id="smsProvider"
                    value={form.smsProvider}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => { update("smsProvider", e.target.value as SmsProvider); update("smsSecret", "") }}
                    className="mt-1.5"
                  >
                    <option value="atl">{tf("smsProviderATL")}</option>
                    <option value="twilio">{tf("smsProviderTwilio")}</option>
                    <option value="vonage">{tf("smsProviderVonage")}</option>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{tf("smsProviderHint")}</p>
                </div>

                {form.smsProvider === "atl" && (
                  <div
                    id="smsAtlCredentialFields"
                    tabIndex={-1}
                    className="scroll-mt-6 space-y-5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                  >
                    <div>
                      <Label htmlFor="atlLogin" className="text-sm font-medium">{tf("atlLogin")}</Label>
                      <Input
                        id="atlLogin"
                        value={form.atlLogin}
                        onChange={(e) => update("atlLogin", e.target.value)}
                        placeholder="login"
                        className="mt-1.5 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="smsSecret" className="text-sm font-medium">{tf("atlPassword")}</Label>
                      <Input
                        id="smsSecret"
                        value={form.smsSecret}
                        onChange={(e) => update("smsSecret", e.target.value)}
                        placeholder={form.smsEditing ? tf("leaveBlankToKeep") : "password"}
                        className="mt-1.5 font-mono text-sm"
                        type="password"
                      />
                    </div>
                    <div>
                      <Label htmlFor="atlTitle" className="text-sm font-medium">{tf("atlTitle")}</Label>
                      <Input
                        id="atlTitle"
                        value={form.atlTitle}
                        onChange={(e) => update("atlTitle", e.target.value)}
                        placeholder="TEST"
                        className="mt-1.5 font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{tf("atlTitleHint")}</p>
                    </div>
                  </div>
                )}

                {form.smsProvider === "twilio" && (
                  <div
                    id="smsGenericCredentialFields"
                    tabIndex={-1}
                    className="scroll-mt-6 space-y-5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                  >
                    <div>
                      <Label htmlFor="twilioAccountSid" className="text-sm font-medium">Twilio Account SID</Label>
                      <Input
                        id="twilioAccountSid"
                        value={form.twilioAccountSid}
                        onChange={(e) => update("twilioAccountSid", e.target.value)}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="mt-1.5 font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{tf("twilioSidHint")}</p>
                    </div>
                    <div>
                      <Label htmlFor="smsSecret" className="text-sm font-medium">Twilio Auth Token</Label>
                      <Input
                        id="smsSecret"
                        value={form.smsSecret}
                        onChange={(e) => update("smsSecret", e.target.value)}
                        placeholder={form.smsEditing ? tf("leaveBlankToKeep") : "Auth Token from Twilio"}
                        className="mt-1.5 font-mono text-sm"
                        type="password"
                      />
                    </div>
                    <div>
                      <Label htmlFor="twilioNumber" className="text-sm font-medium">{tf("twilioSenderPhone")}</Label>
                      <Input
                        id="twilioNumber"
                        value={form.twilioNumber}
                        onChange={(e) => update("twilioNumber", e.target.value)}
                        placeholder="+14155552671"
                        className="mt-1.5"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{tf("twilioPhoneHint")}</p>
                    </div>
                  </div>
                )}

                {form.smsProvider === "vonage" && (
                  <div
                    id="smsGenericCredentialFields"
                    tabIndex={-1}
                    className="scroll-mt-6 space-y-5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                  >
                    <div>
                      <Label htmlFor="vonageApiKey" className="text-sm font-medium">Vonage API Key</Label>
                      <Input
                        id="vonageApiKey"
                        value={form.vonageApiKey}
                        onChange={(e) => update("vonageApiKey", e.target.value)}
                        placeholder="a1b2c3d4"
                        className="mt-1.5 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="smsSecret" className="text-sm font-medium">Vonage API Secret</Label>
                      <Input
                        id="smsSecret"
                        value={form.smsSecret}
                        onChange={(e) => update("smsSecret", e.target.value)}
                        placeholder={form.smsEditing ? tf("leaveBlankToKeep") : "Vonage API secret"}
                        className="mt-1.5 font-mono text-sm"
                        type="password"
                      />
                    </div>
                    <div>
                      <Label htmlFor="vonageFromName" className="text-sm font-medium">{tf("vonageFromName")}</Label>
                      <Input
                        id="vonageFromName"
                        value={form.vonageFromName}
                        onChange={(e) => update("vonageFromName", e.target.value)}
                        placeholder="LeadDrive"
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                )}

                {isEdit && (
                  <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <Label htmlFor="smsTestNumber" className="text-sm font-medium">{tf("smsTestLabel")}</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="smsTestNumber"
                        value={smsTestNumber}
                        onChange={(e) => setSmsTestNumber(e.target.value)}
                        placeholder="+994501234567"
                        className="min-w-0 font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={smsTesting || !smsTestNumber.trim()}
                        onClick={async () => {
                          setSmsTesting(true)
                          setSmsTestResult(null)
                          try {
                            const res = await fetch("/api/v1/channels/sms/test", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
                              },
                              body: JSON.stringify({ to: smsTestNumber.trim() }),
                            })
                            const json = await res.json()
                            setSmsTestResult({ success: !!json.success, message: json.success ? (tf("smsTestSuccess") as string) : (json.error || "Error") })
                          } catch (err: unknown) {
                            setSmsTestResult({ success: false, message: err instanceof Error ? err.message : "Network error" })
                          } finally {
                            setSmsTesting(false)
                          }
                        }}
                      >
                        {smsTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : tf("smsTestButton")}
                      </Button>
                    </div>
                    {smsTestResult && (
                      <p className={cn("text-xs", smsTestResult.success ? "text-green-600" : "text-red-600")}>
                        {smsTestResult.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{tf("smsTestHint")}</p>
                  </div>
                )}
              </section>
            )}

            {form.channelType === "chatwoot" && (
              <section className="space-y-5 rounded-3xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
                <div
                  id="chatwootBridgeGuide"
                  tabIndex={-1}
                  className="scroll-mt-6 space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                >
                  <p className="text-xs font-medium text-orange-800">{c.chatwootBridgeTitle}</p>
                  <p className="text-xs text-orange-700">
                    {c.chatwootBridgeBody}
                  </p>
                  <CopyableProviderValue
                    label={c.chatwootWebhookUrl}
                    value={chatwootWebhookEndpoint}
                    copyLabel={c.copyValue}
                    copiedLabel={c.copiedValue}
                  />
                </div>
                <div>
                  <Label htmlFor="chatwootBaseUrl" className="text-sm font-medium">Chatwoot Base URL *</Label>
                  <Input
                    id="chatwootBaseUrl"
                    value={form.chatwootBaseUrl}
                    onChange={(e) => update("chatwootBaseUrl", e.target.value)}
                    placeholder="https://app.chatwoot.com"
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{c.chatwootBaseUrlHint}</p>
                </div>
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="chatwootAccountId" className="text-sm font-medium">Chatwoot Account ID *</Label>
                    <Input
                      id="chatwootAccountId"
                      value={form.chatwootAccountId}
                      onChange={(e) => update("chatwootAccountId", e.target.value)}
                      placeholder="171064"
                      className="mt-1.5 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="chatwootWebhookSecret" className="text-sm font-medium">Webhook Secret *</Label>
                    <Input
                      id="chatwootWebhookSecret"
                      value={form.chatwootWebhookSecret}
                      onChange={(e) => update("chatwootWebhookSecret", e.target.value)}
                      placeholder={hasStoredChatwootWebhookSecret ? c.storedCredentialPlaceholder : c.chatwootWebhookSecretPlaceholder}
                      className="mt-1.5 font-mono text-sm"
                      required={!hasStoredChatwootWebhookSecret}
                    />
                    {isEdit && (
                      <p className={`mt-1 text-xs ${hasStoredChatwootWebhookSecret ? "text-emerald-700" : "text-amber-700"}`}>
                        {credentialStateHint(hasStoredChatwootWebhookSecret)}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="apiKey" className="text-sm font-medium">Chatwoot API Token *</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder={isEdit ? tf("leaveBlankToKeep") : c.chatwootTokenPlaceholder}
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.chatwootTokenHint}
                  </p>
                </div>
              </section>
            )}

            {(form.channelType === "facebook" || form.channelType === "instagram") && (
              <section className="space-y-5 rounded-3xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
                {/* Model A — the default path. LeadDrive's own Meta app: one OAuth click, no tenant
                    keys at all. `?from=channels-*` does two things on the server: it tells the start
                    route this is an INBOX connect (so the messaging scopes are requested even on a
                    first connect, when no ChannelConfig exists yet) and it tells the callback to
                    return the user to this channel card instead of Social Monitoring. */}
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <p className="text-xs font-medium text-orange-800">{c.metaOneClickTitle}</p>
                  <p className="text-xs text-orange-700">{c.metaOneClickDesc}</p>
                  {form.channelType === "instagram" && !form.igLogin && (
                    <p className="text-xs text-orange-700">{c.metaOneClickIgNote}</p>
                  )}
                  {/* Connection state, stated plainly. Saving this form creates a ChannelConfig row and
                      nothing more — without the pageId + page token that OAuth stores, the channel is
                      inert, so the form must never let the user walk away believing otherwise. */}
                  <p
                    data-testid="meta-connection-state"
                    className={`text-xs font-medium ${metaConnectionLive ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {metaConnectionMessage}
                  </p>
                  {metaOAuthReady === false ? (
                    <p className="text-xs text-amber-700">{c.metaNeedsSetup}</p>
                  ) : metaOAuthBlockedByOwnApp ? (
                    <>
                      {/* Disabled rather than hidden: hiding the button was what made the previous
                          version unexplainable — the user saw nothing and had nowhere to go. */}
                      <button
                        type="button"
                        disabled
                        data-testid="meta-oauth-connect"
                        className="w-full cursor-not-allowed rounded-lg bg-zinc-200 py-2.5 text-sm font-medium text-zinc-500"
                      >
                        {form.channelType === "facebook" ? c.metaConnectFacebook : c.metaConnectInstagram}
                      </button>
                      <p className="text-xs text-amber-700">{c.metaSaveFirst}</p>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="meta-oauth-connect"
                      onClick={() => {
                        // Instagram Direct is delivered through the LINKED Facebook Page's `messages`
                        // webhook, and only the facebook callback wires a ChannelConfig for it — so the
                        // Instagram card starts the FACEBOOK flow unless the tenant explicitly chose the
                        // separate Instagram-Login app below.
                        const provider = form.igLogin ? "instagram" : "facebook"
                        const from = form.channelType === "instagram" ? "channels-instagram" : "channels-facebook"
                        window.location.href = `/api/v1/social/oauth/${provider}/start?from=${from}`
                      }}
                      className="w-full rounded-lg bg-orange-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600"
                    >
                      {form.channelType === "facebook" ? c.metaConnectFacebook : c.metaConnectInstagram}
                    </button>
                  )}
                </div>
                {/* Model B — the tenant runs its own Meta app. Nothing here was removed, only folded
                    away: every field stays fully functional for the tenants that need it. Note the
                    inputs carry NO html `required`: a required control inside a collapsed <details>
                    makes Chrome abort submit with "invalid form control is not focusable" and no
                    visible message. The all-three-or-none rule is enforced in handleSubmit instead. */}
                <details className="rounded-lg border border-zinc-200 bg-white p-3">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                    {c.metaOwnAppToggle}
                  </summary>
                  <div className="mt-3 space-y-5">
                    <p className="text-xs text-muted-foreground">{c.metaOwnAppHint}</p>
                    {form.channelType === "instagram" && (
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                        <input
                          type="checkbox"
                          checked={form.igLogin}
                          onChange={(e) => update("igLogin", e.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="text-xs">
                          {c.instagramLoginOption}
                        </span>
                      </label>
                    )}
                    <div
                      id="metaProviderGuide"
                      tabIndex={-1}
                      className="scroll-mt-6 space-y-1 rounded-lg border border-orange-200 bg-orange-50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                    >
                      <p className="text-xs font-medium text-orange-800">
                        {c.metaOwnAppTitle.replace("{channel}", form.channelType === "facebook"
                          ? "Facebook Messenger"
                          : form.igLogin
                            ? "Instagram Direct (Instagram Login)"
                            : "Instagram Direct (via Facebook Page)")}
                      </p>
                      <p className="text-xs text-orange-700">
                        1. {c.metaStep1}
                      </p>
                      <p className="text-xs text-orange-700">
                        2. {c.metaStep2}
                      </p>
                      <CopyableProviderValue
                        label="Webhook Callback URL"
                        value={metaWebhookEndpoint}
                        copyLabel={c.copyValue}
                        copiedLabel={c.copiedValue}
                      />
                      <p className="text-xs text-orange-700">
                        3. {c.metaStep3}
                      </p>
                      <CopyableProviderValue
                        label="OAuth Redirect URI"
                        value={metaOAuthRedirectUri}
                        copyLabel={c.copyValue}
                        copiedLabel={c.copiedValue}
                      />
                      <p className="text-xs text-orange-700">
                        4. {c.metaStep4}
                      </p>
                    </div>
                    <div className="grid gap-3">
                      <div>
                        <Label htmlFor="appId" className="text-sm font-medium">Meta App ID</Label>
                        <Input
                          id="appId"
                          value={form.appId}
                          onChange={(e) => update("appId", e.target.value)}
                          placeholder="1234567890"
                          className="mt-1.5 font-mono text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="appSecret" className="text-sm font-medium">App Secret</Label>
                        <Input
                          id="appSecret"
                          type="password"
                          value={form.appSecret}
                          onChange={(e) => update("appSecret", e.target.value)}
                          placeholder={hasStoredMetaAppSecret ? c.storedCredentialPlaceholder : c.metaAppSecretPlaceholder}
                          className="mt-1.5 font-mono text-sm"
                        />
                        {isEdit && (
                          <p className={`mt-1 text-xs ${hasStoredMetaAppSecret ? "text-emerald-700" : "text-amber-700"}`}>
                            {credentialStateHint(hasStoredMetaAppSecret)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="verifyToken" className="text-sm font-medium">Webhook Verify Token</Label>
                      <Input
                        id="verifyToken"
                        value={form.verifyToken}
                        onChange={(e) => update("verifyToken", e.target.value)}
                        placeholder={hasStoredMetaVerifyToken ? c.storedCredentialPlaceholder : c.metaVerifyTokenPlaceholder}
                        className="mt-1.5 font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.metaVerifyTokenHint}
                      </p>
                      {isEdit && (
                        <p className={`mt-1 text-xs ${hasStoredMetaVerifyToken ? "text-emerald-700" : "text-amber-700"}`}>
                          {credentialStateHint(hasStoredMetaVerifyToken)}
                        </p>
                      )}
                    </div>
                    {metaOAuthBlockedByOwnApp ? (
                      <p className="text-xs text-amber-700">
                        {/* Same condition as the guard on the Connect button above, so the two can never
                            disagree: OAuth reads the App ID from the DB, and an empty or edited-but-unsaved
                            value would run the flow against the stale stored one. */}
                        {c.metaSaveFirst}
                      </p>
                    ) : null}
                    <div className="space-y-3 border-t border-zinc-200 pt-3">
                      <p className="text-xs text-muted-foreground">{c.metaManualFallback}</p>
                      <div>
                        <Label htmlFor="apiKey" className="text-sm font-medium">Page Access Token</Label>
                        <Input
                          id="apiKey"
                          type="password"
                          value={form.apiKey}
                          onChange={(e) => update("apiKey", e.target.value)}
                          placeholder="EAAi..."
                          className="mt-1.5 font-mono text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="pageId" className="text-sm font-medium">{c.metaPageIdLabel}</Label>
                        <Input
                          id="pageId"
                          value={form.pageId}
                          onChange={(e) => update("pageId", e.target.value)}
                          placeholder={c.metaPageIdPlaceholder}
                          className="mt-1.5 font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </section>
            )}

            {form.channelType === "vkontakte" && (
              <>
                <div
                  id="vkontakteProviderGuide"
                  tabIndex={-1}
                  className="scroll-mt-6 space-y-1 rounded-lg border border-orange-200 bg-orange-50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                >
                  <p className="text-xs font-medium text-orange-800">
                    VKontakte — Community Callback API
                  </p>
                  <p className="text-xs text-orange-700">
                    1. In your VK community: <span className="font-medium">Manage → API usage → Callback API</span>.
                  </p>
                  <p className="text-xs text-orange-700">
                    2. Set the server URL to: <code className="rounded bg-orange-100 px-1 font-mono">
                      {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/webhooks/vkontakte
                    </code>
                  </p>
                  <p className="text-xs text-orange-700">
                    3. Copy the confirmation string VK shows into the field below, then save & confirm in VK.
                  </p>
                </div>
                <div>
                  <Label htmlFor="pageId" className="text-sm font-medium">Community (Group) ID *</Label>
                  <Input
                    id="pageId"
                    value={form.pageId}
                    onChange={(e) => update("pageId", e.target.value)}
                    placeholder="123456789"
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Your VK community numeric id — routes inbound messages to this org.
                  </p>
                </div>
                <div>
                  <Label htmlFor="apiKey" className="text-sm font-medium">Community Access Token *</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder="vk1.a..."
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Generated in Manage → API usage → Access tokens. Used to send replies.
                  </p>
                </div>
                <div>
                  <Label htmlFor="confirmationCode" className="text-sm font-medium">Callback Confirmation String *</Label>
                  <Input
                    id="confirmationCode"
                    value={form.confirmationCode}
                    onChange={(e) => update("confirmationCode", e.target.value)}
                    placeholder="a1b2c3d4"
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The string VK displays when adding the Callback server — returned on VK&apos;s confirmation handshake.
                  </p>
                </div>
              </>
            )}

            {/* Status */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 transition-colors hover:bg-zinc-100">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => update("isActive", e.target.checked)}
                className="rounded h-4 w-4"
              />
              <div>
                <span className="text-sm font-medium">{tf("channelActive")}</span>
                <p className="text-xs text-muted-foreground">{tf("channelActiveHint")}</p>
              </div>
            </label>
          </div>
        </DialogContent>
        {savedClaimedElsewhere && (
          <div
            role="alert"
            data-testid="channel-claimed-elsewhere-warning"
            className="mx-5 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <p className="font-medium">{ts("channelClaimedElsewhere.savedTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-amber-700">{ts("channelClaimedElsewhere.hint")}</p>
          </div>
        )}
        <DialogFooter>
          {savedClaimedElsewhere ? (
            // The row is already saved: a second submit here would create a duplicate, so the only way
            // forward is to acknowledge.
            <Button
              type="button"
              onClick={() => {
                onSaved()
                onOpenChange(false)
              }}
            >
              {ts("channelClaimedElsewhere.acknowledge")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
              <Button id="channelSubmitButton" type="submit" disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? tc("saving") : isEdit ? tc("save") : tc("create")}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </>
  )

  if (variant === "inline") {
    return (
      <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        {formBody}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-4xl" maxHeightClassName="max-h-[92vh]">
      {formBody}
    </Dialog>
  )
}
