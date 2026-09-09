"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import {
  AtSign,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  Headphones,
  Mail,
  MessageCircle,
  MessagesSquare,
  Network,
  PauseCircle,
  Pencil,
  PhoneCall,
  PlayCircle,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  Webhook,
  Workflow,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ChannelConfigForm } from "@/components/channel-config-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { cn } from "@/lib/utils"
import {
  channelConnectionState,
  channelIsLiveConnection,
  type ChannelConnectionState,
} from "@/lib/channels/live-connection"

interface ChannelConfig {
  id: string
  channelType: string
  configName: string
  botToken?: string
  webhookUrl?: string
  apiKey?: string
  phoneNumber?: string
  /** Present on the /api/v1/channels payload; the API sends JSON null when unset, which the
   *  Boolean() reads below already handle — same shape as botToken/webhookUrl/phoneNumber above. */
  pageId?: string
  isActive: boolean
  settings?: Record<string, unknown> | null
  hasAccessToken?: boolean
  hasPhoneNumberId?: boolean
  hasVerifyToken?: boolean
  hasAppSecret?: boolean
}

type LocaleKey = "en" | "ru" | "az"
type CatalogTab = "all" | "business" | "calls" | "sms" | "email" | "live"
type CatalogAction =
  | { type: "form"; channelType: string; presetName: string; settings?: Record<string, unknown> }
  | { type: "link"; href: string }
  | { type: "guide"; guideType: "whatsapp-calling" }
  | { type: "disabled" }

interface CatalogCard {
  id: string
  tab: Exclude<CatalogTab, "all">
  channelType?: string
  provider?: string
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  logo: string
  accent: string
  badge?: string
  typeLabel?: string
  /** One-click OAuth start URL. When set, the card offers "Connect with Meta" directly and keeps the
   *  step-by-step wizard as the secondary link. Purely additive — other cards are unaffected. */
  oauthStart?: string
  action: CatalogAction
}

interface ChannelTutorial {
  key: string
  duration: string
  description: string
  steps: string[]
}

interface TutorialScene {
  provider: string
  screenTitle: string
  screenUrl: string
  leadDriveTitle: string
  fields: string[]
}

const LEADDRIVE_APP_ORIGIN = "https://app.leaddrivecrm.org"

function whatsappWebhookUrl(orgSlug?: string | null) {
  const slug = orgSlug ? encodeURIComponent(orgSlug) : "<tenant-slug>"
  return `${LEADDRIVE_APP_ORIGIN}/api/v1/webhooks/whatsapp?t=${slug}`
}

const copy = {
  en: {
    title: "Channel Catalog",
    desc: "Manage messaging channels and discover new ones to acquire more customers.",
    hint: "Choose a category, then connect the exact provider. Existing connected channels stay editable from the cards.",
    search: "Search Channel Catalog",
    connected: "Connected",
    notConnected: "Open setup",
    configure: "Configure",
    configureConnected: "Edit setup",
    openGuide: "Open guide",
    callingReadinessBadge: "Readiness checklist",
    comingSoon: "Roadmap",
    edit: "Edit",
    delete: "Delete",
    noResults: "No channels match this search.",
    noResultsHint: "Clear the search or switch back to All to see every provider.",
    active: "active",
    available: "available",
    guidedSetup: "Guided setup",
    oauthConnect: "Connect with Meta",
    cardStatus: "Status",
    cardNextStep: "Next step",
    cardVerify: "Verify",
    cardConnectedHint: "Saved in LeadDrive. Edit credentials or send a controlled test before automation.",
    cardDraftBadge: "Draft",
    cardDraftStatus: "Connection not finished",
    cardDraftHint: "The channel row is saved, but Meta has not returned a Page yet, so no message will arrive. Finish Connect with Meta.",
    cardPausedBadge: "Switched off",
    cardPausedStatus: "Channel is switched off",
    cardPausedHint: "The credentials are stored, but the channel is switched off and every inbound webhook only looks at active channels, so messages are dropped. Turn it back on in Edit setup.",
    cardReconnectBadge: "Reconnect needed",
    cardReconnectStatus: "Meta is not delivering messages",
    cardReconnectHint: "Meta refused the message subscription for this Page — usually a missing messaging permission — so DMs never reach Inbox. Run Connect with Meta again and approve every permission it asks for.",
    cardNewHint: "Open the guided setup. It shows what to prepare, what to paste, and how to test delivery.",
    cardRoadmapHint: "This provider is visible for planning, but connection is not enabled yet.",
    catalogFlowTitle: "How channel setup works",
    catalogFlow: [
      { title: "Pick a provider", desc: "Use tabs to choose messaging, calls, SMS, email or live chat." },
      { title: "Follow the guide", desc: "Each supported provider opens a focused setup page with the required checklist." },
      { title: "Save credentials", desc: "Only the fields needed by that provider are shown." },
      { title: "Test delivery", desc: "Verify one real inbound message, call or SMS before using automation." },
    ],
    tabGuides: {
      all: "Choose a channel card. Connected channels can be edited; new providers open a guided setup.",
      business: "WhatsApp Business, Facebook, Instagram and TikTok use provider-specific guides. TikTok is connected through Chatwoot.",
      calls: "Use VoIP settings for PBX/SIP providers. WhatsApp Business Calling has its own readiness checklist.",
      sms: "ATL is the default SMS route for Azerbaijan. Twilio and Vonage stay available for tenants that already use them.",
      email: "Email cards open SMTP/IMAP setup. Use provider app passwords where required.",
      live: "Website chat uses the LeadDrive widget; external live chat providers should route through Integrations.",
    },
    otherConnected: "Other connected channels",
    otherConnectedHint: "Existing saved channels that are not in the catalog yet stay visible here.",
    testMessage: "WhatsApp Test Message",
    testAction: "Test message",
    recipientNumber: "Recipient number",
    phoneFormat: "Format: +country_code number (no spaces)",
    templateName: "Template name",
    templateLanguage: "Language",
    templateHint: "Cold WhatsApp tests use an approved template. Use hello_world only with Meta public test numbers.",
    testCaveatTitle: "Before you send",
    testCaveatBody: "Meta blocks free-form messages outside the 24-hour customer window. This test sends a template message; production numbers need your own approved template.",
    publicTemplateError: "Meta rejected hello_world: that sample template can only be sent from Meta public test numbers. Use a public test number in Meta, or enter one of your approved production templates.",
    messageSent: "Message sent successfully",
    sendError: "Failed to send message",
    cancel: "Cancel",
    send: "Send",
    sending: "Sending...",
    connectChannel: "Connect Channel",
    backToCatalog: "Back to Channel Catalog",
    additionalResources: "Additional Resources",
    resourceGuide: "Setup checklist",
    resourcePricing: "Pricing and limits",
    resourceHelp: "Yardım mərkəzi",
    connectHeading: "Connect",
    connectHelp: "Use a guided setup first. Manual credentials are available when the provider requires them.",
    videoTitle: "Channel setup guide",
    watchTutorial: "Watch setup tutorial",
    connectionPathTitle: "Recommended connection path",
    connectionPathHint: "Start with the guide, then open the exact credential form for this channel.",
    connectionPath: [
      { title: "Choose scenario", desc: "New account or existing provider credentials." },
      { title: "Watch the guide", desc: "See the required provider steps before filling fields." },
      { title: "Save and test", desc: "Create the channel, then verify one real inbound message." },
    ],
    callingConnectionPath: [
      { title: "Match the Meta app", desc: "Use the app that owns the same WhatsApp number saved in LeadDrive." },
      { title: "Subscribe calls", desc: "Paste the LeadDrive callback and verify token in Meta, then subscribe calls." },
      { title: "Test in Inbox", desc: "Check one inbound call, then request customer call permission and start one approved outbound call from Inbox." },
    ],
    optionNewTitle: "Create and connect a new account",
    optionNewDesc: "Choose this when you want to set up a fresh provider account or a new number.",
    optionExistingTitle: "Connect an existing account",
    optionExistingDesc: "Choose this when you already have credentials or an existing provider account.",
    getStarted: "Get started",
    skip: "Skip",
    selectedChannel: "Selected channel",
    setupLockedHint: "channel type is fixed for this setup",
    manualSetup: "Manual API setup",
    manualSetupHint: "Embedded provider signup is not enabled yet, so this continues into the credential setup for the selected channel.",
    prepareSetup: "Prepare setup",
    callingReadinessTitle: "WhatsApp Calling readiness",
    callingReadinessHint: "Use this checklist before testing real WhatsApp calls in Inbox: inbound customer calls and outbound calls after the customer grants WhatsApp call permission.",
    callingTestDomain: "Test domain",
    callingMessageWebhook: "Current WhatsApp webhook",
    callingMessageWebhookHint: "Use this callback in Meta for messages and webhook verification. The same Meta app must also subscribe to calls events before Inbox call controls can appear.",
    callingBackendTitle: "How live calls are handled",
    callingBackendHint: "LeadDrive stores the WhatsApp API keys, accepts Meta calls events, records customer call permission and gates outbound connect until Meta returns start_call=true. Finish the Meta calls subscription, then test one inbound call and one approved outbound call from Inbox.",
    callingOpenMessagingSetup: "Set up WhatsApp Business API first",
    callingRequirementsTitle: "Readiness checklist",
    callingRequirements: [
      "The same Meta app owns the WhatsApp number already saved in this tenant.",
      "WhatsApp API channel has access token, Phone Number ID, verify token and app secret saved.",
      "Meta webhook uses app.leaddrivecrm.org and is subscribed to calls.",
      "One real inbound WhatsApp call and one permission-approved outbound WhatsApp call were checked in Inbox.",
    ],
    callingCredentialStatusTitle: "Saved WhatsApp credentials",
    callingCredentialStatusHint: "These checks come from the active WhatsApp Business API channel. Secret values are never shown.",
    callingNoMessagingChannel: "No active WhatsApp Business API channel is saved yet. Save the messaging channel first, then return to this checklist.",
    callingCredentialAccessToken: "Access token",
    callingCredentialPhoneNumberId: "Phone number ID",
    callingCredentialVerifyToken: "Verify token",
    callingCredentialAppSecret: "App secret",
    callingReady: "Ready",
    callingMissing: "Missing",
    callingSignedWebhookBlocked: "Signed calls webhooks will be rejected until App Secret is saved.",
    callingEditMessagingSetup: "Edit WhatsApp Business API setup",
    tabs: {
      all: "All",
      business: "Business Messaging",
      calls: "Calls",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    groups: {
      business: "Business Messaging",
      calls: "Calls",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    cards: {
      whatsappBusiness: "Meta WhatsApp Business API with WABA, templates, webhooks and inbox replies.",
      tiktok: "One TikTok hub for DM Inbox, Comments & Mentions, and Lead Ads. Chatwoot stays the DM transport.",
      facebook: "Connect Facebook Messenger from your tenant's own Meta app.",
      instagram: "Connect Instagram Direct via Facebook Page or Instagram Login.",
      telegram: "Connect a Telegram Bot for real-time customer support.",
      vk: "Connect VKontakte messages alongside the rest of your inbox.",
      customBusiness: "Use Integrations to register a webhook for channels that are not covered natively, then route inbound events into Inbox.",
      twilioCall: "Cloud telephony for outbound calls, call logs, recordings and insights.",
      threecx: "3CX PBX connector for call events and CRM call history.",
      asterisk: "Asterisk ARI connector for self-hosted PBX teams.",
      customSip: "Custom SIP profile for your own voice infrastructure.",
      whatsappCalling: "Enable live WhatsApp calls for the existing Cloud API number: inbound customer calls and outbound calls after the customer grants permission in WhatsApp.",
      atlSms: "Azerbaijan-first SMS delivery through ATL. This is the default LeadDrive SMS provider.",
      twilioSms: "Fallback SMS provider for international tenants that use Twilio.",
      vonageSms: "Fallback SMS provider for tenants already using Vonage.",
      googleWorkspace: "Connect Google Workspace mailboxes through SMTP/IMAP settings.",
      gmail: "Connect Gmail via SMTP to manage customer email communication.",
      otherEmail: "Connect another email provider through SMTP credentials.",
      websiteChat: "Configure the LeadDrive web chat widget, launcher behavior, AI handoff and escalation rules.",
      customLiveChat: "Use Integrations webhooks when a website chat provider needs to forward conversations into LeadDrive.",
    },
  },
  ru: {
    title: "Каталог каналов",
    desc: "Подключайте каналы сообщений и находите новые точки входа для клиентов.",
    hint: "Выберите категорию и подключите нужный провайдер. Уже подключённые каналы можно редактировать прямо в карточках.",
    search: "Поиск по каталогу каналов",
    connected: "Подключено",
    notConnected: "Открыть настройку",
    configure: "Настроить",
    configureConnected: "Изменить настройку",
    openGuide: "Открыть инструкцию",
    callingReadinessBadge: "Чеклист готовности",
    comingSoon: "В разработке",
    edit: "Редактировать",
    delete: "Удалить",
    noResults: "По этому поиску каналов нет.",
    noResultsHint: "Очистите поиск или вернитесь во вкладку «Все», чтобы увидеть всех провайдеров.",
    active: "активных",
    available: "доступно",
    guidedSetup: "Пошаговая настройка",
    oauthConnect: "Подключить через Meta",
    cardStatus: "Статус",
    cardNextStep: "Следующий шаг",
    cardVerify: "Проверка",
    cardConnectedHint: "Канал сохранён в LeadDrive. Измените ключи или отправьте контролируемый тест перед автоматизацией.",
    cardDraftBadge: "Черновик",
    cardDraftStatus: "Подключение не завершено",
    cardDraftHint: "Запись канала сохранена, но Meta ещё не вернула страницу, поэтому сообщения приходить не будут. Завершите «Подключить через Meta».",
    cardPausedBadge: "Выключен",
    cardPausedStatus: "Канал выключен",
    cardPausedHint: "Ключи канала сохранены, но канал выключен, а обработчики входящих ищут только активные каналы — сообщения теряются. Включите канал в «Изменить настройку».",
    cardReconnectBadge: "Нужно переподключить",
    cardReconnectStatus: "Meta не доставляет сообщения",
    cardReconnectHint: "Meta отказала в подписке на сообщения этой страницы — обычно из-за не выданного разрешения на переписку — поэтому входящие не доходят до Inbox. Запустите «Подключить через Meta» ещё раз и подтвердите все запрошенные разрешения.",
    cardNewHint: "Откройте пошаговую настройку. Она покажет, что подготовить, какие ключи вставить и как проверить доставку.",
    cardRoadmapHint: "Провайдер показан для планирования, но подключение ещё не включено.",
    catalogFlowTitle: "Как работает подключение канала",
    catalogFlow: [
      { title: "Выберите провайдера", desc: "Откройте нужную вкладку: сообщения, звонки, SMS, email или live chat." },
      { title: "Пройдите инструкцию", desc: "Поддерживаемые каналы открывают отдельный экран с чеклистом подключения." },
      { title: "Сохраните ключи", desc: "LeadDrive показывает только поля, нужные выбранному провайдеру." },
      { title: "Проверьте доставку", desc: "Перед автоматизацией подтвердите одно реальное входящее сообщение, звонок или SMS." },
    ],
    tabGuides: {
      all: "Выберите карточку канала. Подключённые каналы редактируются здесь, новые открывают пошаговую настройку.",
      business: "WhatsApp Business, Facebook, Instagram и TikTok подключаются по отдельным инструкциям. TikTok идёт через Chatwoot.",
      calls: "PBX/SIP провайдеры настраиваются в VoIP. WhatsApp Business Calling имеет отдельный чеклист готовности.",
      sms: "ATL — основной SMS-маршрут для Азербайджана. Twilio и Vonage оставлены для tenant-ов, которые уже ими пользуются.",
      email: "Email-каналы открывают SMTP/IMAP настройку. Где нужно, используйте app password провайдера.",
      live: "Website Chat — это виджет LeadDrive. Внешние live chat провайдеры подключайте через Integrations.",
    },
    otherConnected: "Другие подключённые каналы",
    otherConnectedHint: "Сохранённые каналы, которых пока нет в каталоге, остаются видимыми здесь.",
    testMessage: "Тестовое сообщение WhatsApp",
    testAction: "Тестовое сообщение",
    recipientNumber: "Номер получателя",
    phoneFormat: "Формат: +код страны и номер без пробелов",
    templateName: "Название шаблона",
    templateLanguage: "Язык",
    templateHint: "Холодный WhatsApp‑тест идёт через approved template. hello_world работает только с публичными тестовыми номерами Meta.",
    testCaveatTitle: "Перед отправкой",
    testCaveatBody: "Meta блокирует обычные сообщения вне 24‑часового окна клиента. Этот тест отправляет шаблон; для production‑номеров нужен ваш approved template.",
    publicTemplateError: "Meta отклонила hello_world: этот примерный шаблон можно отправлять только с публичных тестовых номеров Meta. Используйте public test number в Meta или введите свой approved production template.",
    messageSent: "Сообщение успешно отправлено",
    sendError: "Не удалось отправить сообщение",
    cancel: "Отмена",
    send: "Отправить",
    sending: "Отправка...",
    connectChannel: "Подключение канала",
    backToCatalog: "Назад в каталог каналов",
    additionalResources: "Полезные материалы",
    resourceGuide: "Чеклист подключения",
    resourcePricing: "Тарифы и лимиты",
    resourceHelp: "Справочный центр",
    connectHeading: "Подключить",
    connectHelp: "Сначала выберите сценарий подключения. Ручные ключи появятся только там, где провайдер их требует.",
    videoTitle: "Справка по подключению канала",
    watchTutorial: "Смотреть туториал",
    connectionPathTitle: "Рекомендуемый порядок подключения",
    connectionPathHint: "Сначала посмотрите справку, затем откройте точную форму ключей для этого канала.",
    connectionPath: [
      { title: "Выберите сценарий", desc: "Новый аккаунт или уже готовые ключи провайдера." },
      { title: "Посмотрите туториал", desc: "Поймите шаги у провайдера до заполнения полей." },
      { title: "Сохраните и проверьте", desc: "Создайте канал и подтвердите одно реальное входящее сообщение." },
    ],
    callingConnectionPath: [
      { title: "Сверьте Meta app", desc: "Используйте app, где находится тот же WhatsApp-номер, сохранённый в LeadDrive." },
      { title: "Подпишите calls", desc: "Вставьте callback LeadDrive и verify token в Meta, затем подпишите calls." },
      { title: "Проверьте в Inbox", desc: "Проверьте один входящий звонок, затем запросите разрешение клиента и начните один разрешённый исходящий звонок из Inbox." },
    ],
    optionNewTitle: "Создать и подключить новый аккаунт",
    optionNewDesc: "Выберите, если нужно завести новый аккаунт провайдера или новый номер.",
    optionExistingTitle: "Подключить существующий аккаунт",
    optionExistingDesc: "Выберите, если аккаунт/ключи провайдера уже созданы.",
    getStarted: "Начать",
    skip: "Пропустить",
    selectedChannel: "Выбранный канал",
    setupLockedHint: "тип канала зафиксирован для этого подключения",
    manualSetup: "Ручная настройка API",
    manualSetupHint: "Embedded signup провайдера пока не включён, поэтому следующий шаг открывает настройку ключей только для выбранного канала.",
    prepareSetup: "Подготовить настройку",
    callingReadinessTitle: "Готовность WhatsApp Calling",
    callingReadinessHint: "Этот чеклист нужен до теста реальных WhatsApp-звонков в Inbox: входящих звонков клиента и исходящих звонков после разрешения клиента в WhatsApp.",
    callingTestDomain: "Тестовый домен",
    callingMessageWebhook: "Текущий webhook WhatsApp",
    callingMessageWebhookHint: "Этот callback используется в Meta для сообщений и webhook-верификации. Это же Meta app должно быть подписано на calls-события, чтобы в Inbox появились call controls.",
    callingBackendTitle: "Как обрабатываются живые звонки",
    callingBackendHint: "LeadDrive хранит WhatsApp API ключи, принимает Meta calls-события, записывает разрешение клиента на звонок и блокирует исходящий connect, пока Meta не вернёт start_call=true. Завершите подписку calls в Meta, затем проверьте один входящий и один разрешённый исходящий звонок из Inbox.",
    callingOpenMessagingSetup: "Сначала настроить WhatsApp Business API",
    callingRequirementsTitle: "Чеклист готовности",
    callingRequirements: [
      "То же Meta app владеет WhatsApp-номером, уже сохранённым в этом tenant-е.",
      "В WhatsApp API канале сохранены access token, Phone Number ID, verify token и app secret.",
      "Webhook Meta использует app.leaddrivecrm.org и подписан на calls.",
      "Один реальный входящий WhatsApp-звонок и один исходящий WhatsApp-звонок после разрешения клиента проверены в Inbox.",
    ],
    callingCredentialStatusTitle: "Сохранённые WhatsApp credentials",
    callingCredentialStatusHint: "Эти проверки читаются из активного канала WhatsApp Business API. Значения секретов не показываются.",
    callingNoMessagingChannel: "Активный канал WhatsApp Business API ещё не сохранён. Сначала сохраните messaging-канал, затем вернитесь к этому чеклисту.",
    callingCredentialAccessToken: "Access token",
    callingCredentialPhoneNumberId: "Phone number ID",
    callingCredentialVerifyToken: "Verify token",
    callingCredentialAppSecret: "App secret",
    callingReady: "Готово",
    callingMissing: "Не хватает",
    callingSignedWebhookBlocked: "Signed calls webhooks будут отклоняться, пока App Secret не сохранён.",
    callingEditMessagingSetup: "Редактировать WhatsApp Business API",
    tabs: {
      all: "Все",
      business: "Business Messaging",
      calls: "Звонки",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    groups: {
      business: "Business Messaging",
      calls: "Звонки",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    cards: {
      whatsappBusiness: "Meta WhatsApp Business API: WABA, шаблоны, webhook-и и ответы из инбокса.",
      tiktok: "Один TikTok Hub для DM Inbox, Comments & Mentions и Lead Ads. Chatwoot остаётся транспортом DM.",
      facebook: "Facebook Messenger через собственное Meta-приложение tenant-а.",
      instagram: "Instagram Direct через Facebook Page или Instagram Login.",
      telegram: "Telegram Bot для realtime-поддержки клиентов.",
      vk: "Сообщения VKontakte рядом с остальными каналами инбокса.",
      customBusiness: "Используйте Integrations, чтобы зарегистрировать webhook для каналов без нативной интеграции и направлять входящие события в Inbox.",
      twilioCall: "Облачная телефония: исходящие звонки, журнал, записи и инсайты.",
      threecx: "Коннектор 3CX PBX для событий звонков и CRM-истории.",
      asterisk: "Asterisk ARI для self-hosted PBX команд.",
      customSip: "Custom SIP-профиль для собственной голосовой инфраструктуры.",
      whatsappCalling: "Включите live WhatsApp-звонки для существующего Cloud API номера: входящие звонки клиента и исходящие звонки после разрешения клиента в WhatsApp.",
      atlSms: "SMS-доставка через ATL для Азербайджана. Это основной SMS-провайдер LeadDrive.",
      twilioSms: "Резервный SMS-провайдер для международных tenant-ов на Twilio.",
      vonageSms: "Резервный SMS-провайдер для tenant-ов, которые уже используют Vonage.",
      googleWorkspace: "Подключение почты Google Workspace через SMTP/IMAP-настройки.",
      gmail: "Gmail через SMTP для клиентской email-коммуникации.",
      otherEmail: "Любой другой email-провайдер через SMTP-доступы.",
      websiteChat: "Настройте LeadDrive web-chat виджет, поведение launcher-а, AI handoff и правила эскалации.",
      customLiveChat: "Используйте webhook-и в Integrations, если внешний chat-провайдер должен передавать диалоги в LeadDrive.",
    },
  },
  az: {
    title: "Kanal kataloqu",
    desc: "Mesaj kanallarını qoşun və müştəri cəlbi üçün yeni giriş nöqtələri yaradın.",
    hint: "Kateqoriyanı seçin, sonra lazımi provayderi qoşun. Qoşulmuş kanallar kartların içindən redaktə olunur.",
    search: "Kanal kataloqunda axtar",
    connected: "Qoşulub",
    notConnected: "Qurulmanı aç",
    configure: "Tənzimlə",
    configureConnected: "Qurulmanı dəyiş",
    openGuide: "Təlimatı aç",
    callingReadinessBadge: "Hazırlıq checklist-i",
    comingSoon: "Planlaşdırılır",
    edit: "Redaktə et",
    delete: "Sil",
    noResults: "Bu axtarışa uyğun kanal yoxdur.",
    noResultsHint: "Axtarışı təmizləyin və ya bütün provayderləri görmək üçün Hamısı bölməsinə qayıdın.",
    active: "aktiv",
    available: "mövcud",
    guidedSetup: "Addım-addım quraşdırma",
    oauthConnect: "Meta ilə qoş",
    cardStatus: "Status",
    cardNextStep: "Növbəti addım",
    cardVerify: "Yoxlama",
    cardConnectedHint: "Kanal LeadDrive-da saxlanılıb. Avtomatizasiyadan əvvəl açarları dəyişin və ya kontrollu test göndərin.",
    cardDraftBadge: "Qaralama",
    cardDraftStatus: "Qoşulma tamamlanmayıb",
    cardDraftHint: "Kanal qeydi saxlanılıb, amma Meta hələ səhifə qaytarmayıb, ona görə mesaj gəlməyəcək. «Meta ilə qoş» addımını tamamlayın.",
    cardPausedBadge: "Söndürülüb",
    cardPausedStatus: "Kanal söndürülüb",
    cardPausedHint: "Kanalın açarları saxlanılıb, amma kanal söndürülüb, gələn mesaj həlledicilərinin hamısı isə yalnız aktiv kanallara baxır — mesajlar itir. «Qurulmanı redaktə et» bölməsində kanalı yenidən yandırın.",
    cardReconnectBadge: "Yenidən qoşulmalıdır",
    cardReconnectStatus: "Meta mesajları çatdırmır",
    cardReconnectHint: "Meta bu səhifə üçün mesaj abunəliyini rədd edib — adətən yazışma icazəsi verilmədiyinə görə — ona görə DM-lər Inbox-a çatmır. «Meta ilə qoş» addımını yenidən işə salın və istənilən bütün icazələri təsdiqləyin.",
    cardNewHint: "Addım-addım qurulmanı açın. Nə hazırlamaq, hansı açarları yazmaq və çatdırılmanı necə yoxlamaq göstərilir.",
    cardRoadmapHint: "Provayder planlama üçün görünür, amma qoşulma hələ aktiv deyil.",
    catalogFlowTitle: "Kanal qoşulması necə işləyir",
    catalogFlow: [
      { title: "Provayder seçin", desc: "Mesaj, zəng, SMS, email və ya live chat üçün uyğun tabı açın." },
      { title: "Təlimatı izləyin", desc: "Dəstəklənən provayderlər qoşulma checklist-i olan ayrıca səhifə açır." },
      { title: "Açarları saxlayın", desc: "LeadDrive yalnız seçilmiş provayderə lazım olan sahələri göstərir." },
      { title: "Çatdırılmanı yoxlayın", desc: "Avtomatizasiyadan əvvəl bir real inbound mesaj, zəng və ya SMS test edin." },
    ],
    tabGuides: {
      all: "Kanal kartını seçin. Qoşulmuş kanallar burada redaktə olunur, yeni provayderlər addım-addım qurulmaya açılır.",
      business: "WhatsApp Business, Facebook, Instagram və TikTok ayrıca təlimatla qoşulur. TikTok Chatwoot vasitəsilə işləyir.",
      calls: "PBX/SIP provayderləri VoIP-də qurulur. WhatsApp Business Calling üçün ayrıca hazırlıq checklist-i var.",
      sms: "ATL Azərbaycan üçün əsas SMS marşrutudur. Twilio və Vonage artıq istifadə edən tenant-lar üçün qalır.",
      email: "Email kartları SMTP/IMAP qurulmasını açır. Lazım olduqda provayder app password istifadə edin.",
      live: "Website Chat LeadDrive vidcetidir. Xarici live chat provayderlərini Integrations vasitəsilə qoşun.",
    },
    otherConnected: "Digər qoşulmuş kanallar",
    otherConnectedHint: "Kataloqda hələ olmayan saxlanmış kanallar burada görünür.",
    testMessage: "WhatsApp test mesajı",
    testAction: "Test mesajı",
    recipientNumber: "Alıcı nömrəsi",
    phoneFormat: "Format: +ölkə_kodu və nömrə (boşluqsuz)",
    templateName: "Şablon adı",
    templateLanguage: "Dil",
    templateHint: "Soyuq WhatsApp testi approved template ilə göndərilir. hello_world yalnız Meta public test nömrələri ilə işləyir.",
    testCaveatTitle: "Göndərməzdən əvvəl",
    testCaveatBody: "Meta 24 saatlıq müştəri pəncərəsindən kənar sərbəst mesajları bloklayır. Bu test şablon göndərir; production nömrələri üçün öz approved template-iniz lazımdır.",
    publicTemplateError: "Meta hello_world şablonunu rədd etdi: bu nümunə yalnız Meta public test nömrələrindən göndərilə bilər. Meta-da public test number istifadə edin və ya öz approved production template-inizi yazın.",
    messageSent: "Mesaj uğurla göndərildi",
    sendError: "Mesaj göndərilmədi",
    cancel: "Ləğv et",
    send: "Göndər",
    sending: "Göndərilir...",
    connectChannel: "Kanal qoş",
    backToCatalog: "Kanal kataloquna qayıt",
    additionalResources: "Əlavə materiallar",
    resourceGuide: "Qoşulma çeki",
    resourcePricing: "Qiymət və limitlər",
    resourceHelp: "Yardım mərkəzi",
    connectHeading: "Qoş",
    connectHelp: "Əvvəl qoşulma ssenarisini seçin. Manual açarlar yalnız provayder tələb etdikdə açılır.",
    videoTitle: "Kanal qoşulması üzrə yardım",
    watchTutorial: "Təlimata bax",
    connectionPathTitle: "Tövsiyə olunan qoşulma yolu",
    connectionPathHint: "Əvvəl yardıma baxın, sonra bu kanal üçün dəqiq açar formasını açın.",
    connectionPath: [
      { title: "Ssenarini seçin", desc: "Yeni hesab və ya hazır provayder açarları." },
      { title: "Təlimata baxın", desc: "Sahələri doldurmazdan əvvəl provayder addımlarını görün." },
      { title: "Saxlayın və yoxlayın", desc: "Kanalı yaradın və bir real incoming mesajı təsdiqləyin." },
    ],
    callingConnectionPath: [
      { title: "Meta app-i tutuşdurun", desc: "LeadDrive-da saxlanan eyni WhatsApp nömrəsi olan app-dən istifadə edin." },
      { title: "Calls-a abunə olun", desc: "LeadDrive callback və verify token-i Meta-da yazın, sonra calls-a abunə olun." },
      { title: "Inbox-da test edin", desc: "Bir inbound zəngi yoxlayın, sonra müştəri zəng icazəsi istəyin və Inbox-dan bir icazəli outbound zəng başladın." },
    ],
    optionNewTitle: "Yeni hesab yaradıb qoş",
    optionNewDesc: "Yeni provayder hesabı və ya yeni nömrə qurmaq istəyirsinizsə seçin.",
    optionExistingTitle: "Mövcud hesabı qoş",
    optionExistingDesc: "Provayder hesabı və ya açarlar artıq hazırdırsa seçin.",
    getStarted: "Başla",
    skip: "Keç",
    selectedChannel: "Seçilmiş kanal",
    setupLockedHint: "bu qoşulmada kanal tipi sabitdir",
    manualSetup: "Manual API qurulması",
    manualSetupHint: "Provayderin daxili qeydiyyatı hələ aktiv deyil; növbəti addım seçilmiş kanal üçün açar formasını açır.",
    prepareSetup: "Qurulmanı hazırla",
    callingReadinessTitle: "WhatsApp Calling hazırlığı",
    callingReadinessHint: "Inbox-da real WhatsApp zənglərini test etməzdən əvvəl bu checklist lazımdır: müştərinin inbound zəngləri və müştəri WhatsApp-da icazə verdikdən sonra outbound zənglər.",
    callingTestDomain: "Test domeni",
    callingMessageWebhook: "Cari WhatsApp webhook",
    callingMessageWebhookHint: "Bu callback Meta-da mesajlar və webhook yoxlaması üçün istifadə olunur. Inbox call controls görünməzdən əvvəl eyni Meta app calls hadisələrinə də abunə olmalıdır.",
    callingBackendTitle: "Canlı zənglər necə işlənir",
    callingBackendHint: "LeadDrive WhatsApp API açarlarını saxlayır, Meta calls hadisələrini qəbul edir, müştərinin zəng icazəsini yazır və Meta start_call=true qaytarmadan outbound connect-i bloklayır. Meta calls abunəliyini tamamlayın, sonra Inbox-dan bir inbound və bir icazəli outbound zəngi test edin.",
    callingOpenMessagingSetup: "Əvvəl WhatsApp Business API qur",
    callingRequirementsTitle: "Hazırlıq checklist-i",
    callingRequirements: [
      "Eyni Meta app bu tenant-da saxlanan WhatsApp nömrəsinə sahibdir.",
      "WhatsApp API kanalında access token, Phone Number ID, verify token və app secret saxlanıb.",
      "Meta webhook app.leaddrivecrm.org istifadə edir və calls üçün abunədir.",
      "Bir real inbound WhatsApp zəngi və müştəri icazəsindən sonra bir outbound WhatsApp zəngi Inbox-da yoxlanıb.",
    ],
    callingCredentialStatusTitle: "Saxlanmış WhatsApp credentials",
    callingCredentialStatusHint: "Bu yoxlamalar aktiv WhatsApp Business API kanalından oxunur. Secret dəyərləri göstərilmir.",
    callingNoMessagingChannel: "Aktiv WhatsApp Business API kanalı hələ saxlanmayıb. Əvvəl messaging kanalını saxlayın, sonra bu checklist-ə qayıdın.",
    callingCredentialAccessToken: "Access token",
    callingCredentialPhoneNumberId: "Phone number ID",
    callingCredentialVerifyToken: "Verify token",
    callingCredentialAppSecret: "App secret",
    callingReady: "Hazırdır",
    callingMissing: "Çatışmır",
    callingSignedWebhookBlocked: "App Secret saxlanana qədər signed calls webhooks rədd ediləcək.",
    callingEditMessagingSetup: "WhatsApp Business API qurulmasını redaktə et",
    tabs: {
      all: "Hamısı",
      business: "Business Messaging",
      calls: "Zənglər",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    groups: {
      business: "Business Messaging",
      calls: "Zənglər",
      sms: "SMS",
      email: "Email",
      live: "Live Chat",
    },
    cards: {
      whatsappBusiness: "Meta WhatsApp Business API: WABA, şablonlar, webhook-lar və inbox cavabları.",
      tiktok: "DM Inbox, Comments & Mentions və Lead Ads üçün bir TikTok Hub. Chatwoot DM transportu olaraq qalır.",
      facebook: "Facebook Messenger tenant-ın öz Meta tətbiqi ilə qoşulur.",
      instagram: "Instagram Direct — Facebook Page və ya Instagram Login ilə.",
      telegram: "Realtime müştəri dəstəyi üçün Telegram Bot qoşun.",
      vk: "VKontakte mesajları bütün inbox kanalları ilə birlikdə işləyir.",
      customBusiness: "Nativ inteqrasiya olmayan kanallar üçün Integrations bölməsində webhook qeydiyyatdan keçirin və daxil olan hadisələri Inbox-a yönləndirin.",
      twilioCall: "Bulud telefoniyası: gedən zənglər, jurnal, qeydlər və insight-lar.",
      threecx: "3CX PBX konnektoru: zəng hadisələri və CRM zəng tarixçəsi.",
      asterisk: "Self-hosted PBX komandaları üçün Asterisk ARI.",
      customSip: "Öz səs infrastrukturunuz üçün Custom SIP profili.",
      whatsappCalling: "Mövcud Cloud API nömrəsi üçün live WhatsApp zənglərini aktiv edin: müştərinin inbound zəngləri və müştəri WhatsApp-da icazə verdikdən sonra outbound zənglər.",
      atlSms: "Azərbaycan üçün ATL SMS çatdırılması. LeadDrive-da əsas SMS provayderidir.",
      twilioSms: "Twilio istifadə edən beynəlxalq tenant-lar üçün ehtiyat SMS provayderi.",
      vonageSms: "Vonage istifadə edən tenant-lar üçün ehtiyat SMS provayderi.",
      googleWorkspace: "Google Workspace poçtlarını SMTP/IMAP parametrləri ilə qoşun.",
      gmail: "Müştəri email-kommunikasiyası üçün Gmail-i SMTP ilə qoşun.",
      otherEmail: "Başqa email provayderini SMTP məlumatları ilə qoşun.",
      websiteChat: "LeadDrive web-chat vidcetini, launcher davranışını, AI handoff-u və eskalasiya qaydalarını tənzimləyin.",
      customLiveChat: "Xarici chat provayderi söhbətləri LeadDrive-a ötürməlidirsə, Integrations webhook-larından istifadə edin.",
    },
  },
} as const

const catalogCards = (c: (typeof copy)[LocaleKey]): CatalogCard[] => [
  {
    id: "whatsapp-business",
    tab: "business",
    channelType: "whatsapp",
    title: "WhatsApp Business Platform (API)",
    description: c.cards.whatsappBusiness,
    icon: MessageCircle,
    logo: "☎",
    badge: "Popular",
    accent: "from-orange-500/22 via-orange-500/8 to-transparent border-orange-500/25",
    action: { type: "form", channelType: "whatsapp", presetName: "WhatsApp Business" },
  },
  {
    id: "tiktok",
    tab: "business",
    channelType: "chatwoot",
    provider: "tiktok",
    title: "TikTok",
    description: c.cards.tiktok,
    icon: Sparkles,
    logo: "♪",
    badge: "Channel hub",
    accent: "from-orange-500/16 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "chatwoot", presetName: "TikTok via Chatwoot", settings: { provider: "tiktok" } },
  },
  {
    id: "facebook",
    tab: "business",
    channelType: "facebook",
    title: "Facebook Messenger",
    description: c.cards.facebook,
    icon: MessagesSquare,
    logo: "f",
    badge: "Popular",
    accent: "from-orange-500/18 via-orange-500/8 to-transparent border-orange-400/20",
    oauthStart: "/api/v1/social/oauth/facebook/start?from=channels-facebook",
    action: { type: "form", channelType: "facebook", presetName: "Facebook Messenger" },
  },
  {
    id: "instagram",
    tab: "business",
    channelType: "instagram",
    title: "Instagram",
    description: c.cards.instagram,
    icon: AtSign,
    logo: "◎",
    accent: "from-orange-500/18 via-stone-500/8 to-transparent border-orange-400/20",
    // Instagram Direct rides the LINKED Facebook Page's messages webhook, and only the facebook
    // callback creates a ChannelConfig for it — instagram/start would finish "successfully" and leave
    // the card grey. (INSTAGRAM_APP_ID is also unset in production.)
    oauthStart: "/api/v1/social/oauth/facebook/start?from=channels-instagram",
    action: { type: "form", channelType: "instagram", presetName: "Instagram Direct" },
  },
  {
    id: "telegram",
    tab: "business",
    channelType: "telegram",
    title: "Telegram",
    description: c.cards.telegram,
    icon: Send,
    logo: "✈",
    accent: "from-orange-500/18 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "telegram", presetName: "Telegram Bot" },
  },
  {
    id: "vkontakte",
    tab: "business",
    channelType: "vkontakte",
    title: "VKontakte",
    description: c.cards.vk,
    icon: MessageCircle,
    logo: "VK",
    accent: "from-orange-500/16 via-zinc-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "vkontakte", presetName: "VKontakte" },
  },
  {
    id: "custom-business",
    tab: "business",
    title: "Custom Channel",
    description: c.cards.customBusiness,
    icon: Webhook,
    logo: "⌘",
    accent: "from-orange-500/16 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/integrations" },
  },
  {
    id: "twilio-calls",
    tab: "calls",
    channelType: "voip",
    provider: "twilio",
    title: "Twilio",
    description: c.cards.twilioCall,
    icon: PhoneCall,
    logo: "☎",
    accent: "from-orange-500/18 via-orange-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/voip" },
  },
  {
    id: "threecx",
    tab: "calls",
    channelType: "voip",
    provider: "threecx",
    title: "3CX",
    description: c.cards.threecx,
    icon: Headphones,
    logo: "3CX",
    accent: "from-orange-500/16 via-stone-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/voip" },
  },
  {
    id: "asterisk",
    tab: "calls",
    channelType: "voip",
    provider: "asterisk",
    title: "Asterisk",
    description: c.cards.asterisk,
    icon: Network,
    logo: "*",
    accent: "from-orange-500/16 via-orange-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/voip" },
  },
  {
    id: "custom-sip",
    tab: "calls",
    channelType: "voip",
    provider: "custom-sip",
    title: "Custom SIP",
    description: c.cards.customSip,
    icon: Radio,
    logo: "SIP",
    accent: "from-stone-400/14 via-orange-500/6 to-transparent border-stone-500/25",
    action: { type: "link", href: "/settings/voip" },
  },
  {
    id: "whatsapp-business-calls",
    tab: "calls",
    provider: "whatsapp-calling",
    title: "WhatsApp Business Calling",
    description: c.cards.whatsappCalling,
    icon: MessageCircle,
    logo: "WA",
    badge: c.callingReadinessBadge,
    typeLabel: "WhatsApp Calling",
    accent: "from-orange-500/18 via-orange-500/8 to-transparent border-orange-400/20",
    action: { type: "guide", guideType: "whatsapp-calling" },
  },
  {
    id: "atl-sms",
    tab: "sms",
    channelType: "sms",
    provider: "atl",
    title: "ATL SMS",
    description: c.cards.atlSms,
    icon: Smartphone,
    logo: "ATL",
    badge: "LeadDrive default",
    accent: "from-orange-500/22 via-orange-500/8 to-transparent border-orange-500/25",
    action: { type: "form", channelType: "sms", presetName: "ATL SMS", settings: { smsProvider: "atl" } },
  },
  {
    id: "twilio-sms",
    tab: "sms",
    channelType: "sms",
    provider: "twilio",
    title: "Twilio SMS",
    description: c.cards.twilioSms,
    icon: Smartphone,
    logo: "Tw",
    accent: "from-orange-500/16 via-stone-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "sms", presetName: "Twilio SMS", settings: { smsProvider: "twilio" } },
  },
  {
    id: "vonage-sms",
    tab: "sms",
    channelType: "sms",
    provider: "vonage",
    title: "Vonage SMS",
    description: c.cards.vonageSms,
    icon: Smartphone,
    logo: "V",
    accent: "from-stone-400/14 via-orange-500/6 to-transparent border-stone-500/25",
    action: { type: "form", channelType: "sms", presetName: "Vonage SMS", settings: { smsProvider: "vonage" } },
  },
  {
    id: "google-workspace",
    tab: "email",
    channelType: "email",
    title: "Google Workspace",
    description: c.cards.googleWorkspace,
    icon: Mail,
    logo: "G",
    accent: "from-orange-500/16 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "email", presetName: "Google Workspace" },
  },
  {
    id: "gmail",
    tab: "email",
    channelType: "email",
    title: "Gmail",
    description: c.cards.gmail,
    icon: Mail,
    logo: "M",
    accent: "from-orange-500/16 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "email", presetName: "Gmail" },
  },
  {
    id: "other-email",
    tab: "email",
    channelType: "email",
    title: "Other Email",
    description: c.cards.otherEmail,
    icon: Mail,
    logo: "✉",
    accent: "from-orange-500/16 via-stone-500/8 to-transparent border-orange-400/20",
    action: { type: "form", channelType: "email", presetName: "Email SMTP" },
  },
  {
    id: "website-chat",
    tab: "live",
    channelType: "web-chat",
    title: "Website Chat",
    description: c.cards.websiteChat,
    icon: MessageCircle,
    logo: "💬",
    accent: "from-orange-500/16 via-stone-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/web-chat" },
  },
  {
    id: "custom-live-chat",
    tab: "live",
    title: "Custom Channel (Live Chat)",
    description: c.cards.customLiveChat,
    icon: Webhook,
    logo: "⌘",
    accent: "from-orange-500/16 via-amber-500/8 to-transparent border-orange-400/20",
    action: { type: "link", href: "/settings/integrations" },
  },
]

const tabs: CatalogTab[] = ["all", "business", "calls", "sms", "email", "live"]

const catalogConnectAliases: Record<string, string> = {
  whatsapp: "whatsapp-business",
  whatsapp_business: "whatsapp-business",
  whatsapp_business_platform: "whatsapp-business",
  whatsapp_business_api: "whatsapp-business",
  whatsapp_business_calls: "whatsapp-business-calls",
  "whatsapp-business-calls": "whatsapp-business-calls",
  whatsapp_calling: "whatsapp-business-calls",
  "whatsapp-calling": "whatsapp-business-calls",
  tiktok_chatwoot: "tiktok",
  "tiktok-chatwoot": "tiktok",
  facebook_messenger: "facebook",
  "facebook-messenger": "facebook",
  instagram_direct: "instagram",
  "instagram-direct": "instagram",
  telegram_bot: "telegram",
  "telegram-bot": "telegram",
  vk: "vkontakte",
  custom_business: "custom-business",
  "custom-business": "custom-business",
  custom_channel: "custom-business",
  "custom-channel": "custom-business",
  atl_sms: "atl-sms",
  "atl-sms": "atl-sms",
  twilio_sms: "twilio-sms",
  "twilio-sms": "twilio-sms",
  vonage_sms: "vonage-sms",
  "vonage-sms": "vonage-sms",
  google_workspace: "google-workspace",
  "google-workspace": "google-workspace",
  other_email: "other-email",
  "other-email": "other-email",
  live_chat: "website-chat",
  "live-chat": "website-chat",
  website_chat: "website-chat",
  "website-chat": "website-chat",
  webchat: "website-chat",
  custom_live_chat: "custom-live-chat",
  "custom-live-chat": "custom-live-chat",
  calls: "twilio-calls",
  voip: "twilio-calls",
  custom_sip: "custom-sip",
  "custom-sip": "custom-sip",
}

const guidedCatalogIds = new Set([
  "whatsapp-business",
  "tiktok",
  "facebook",
  "instagram",
  "telegram",
  "vkontakte",
  "custom-business",
  "atl-sms",
  "twilio-sms",
  "vonage-sms",
  "google-workspace",
  "gmail",
  "other-email",
  "website-chat",
  "custom-live-chat",
  "twilio-calls",
  "threecx",
  "asterisk",
  "custom-sip",
  "whatsapp-business-calls",
])

function normalizeCatalogConnectId(connectId: string) {
  return catalogConnectAliases[connectId] || connectId
}

function guideHrefForCard(card: CatalogCard) {
  return guidedCatalogIds.has(card.id) ? `/settings/channels/connect/${card.id}` : null
}

const tutorialScenes: Record<string, TutorialScene[]> = {
  whatsapp: [
    {
      provider: "Meta Business Suite",
      screenTitle: "WhatsApp accounts",
      screenUrl: "business.facebook.com/settings/whatsapp-accounts",
      leadDriveTitle: "Choose scenario: new WABA or existing keys",
      fields: ["Business Manager", "WABA ID", "phone number"],
    },
    {
      provider: "Meta Business Manager",
      screenTitle: "Business access and phone number",
      screenUrl: "business.facebook.com/settings/users",
      leadDriveTitle: "Confirm admin access before opening the form",
      fields: ["admin role", "verified business", "display phone"],
    },
    {
      provider: "Meta for Developers",
      screenTitle: "Webhook callback",
      screenUrl: "developers.facebook.com/apps/webhooks",
      leadDriveTitle: "Copy callback URL and verify token into Meta",
      fields: ["callback URL", "verify token", "messages webhook"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Save and test WhatsApp",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save the channel and send one approved template",
      fields: ["access token", "phone number ID", "template name"],
    },
  ],
  whatsappCalling: [
    {
      provider: "Meta for Developers",
      screenTitle: "Correct Meta app",
      screenUrl: "developers.facebook.com/apps/{app-id}/settings/basic",
      leadDriveTitle: "Match the Meta app to the WhatsApp number saved in LeadDrive",
      fields: ["App ID", "App Secret", "Phone Number ID"],
    },
    {
      provider: "Meta Webhooks",
      screenTitle: "WhatsApp configuration",
      screenUrl: "developers.facebook.com/apps/{app-id}/use_cases",
      leadDriveTitle: "Paste the LeadDrive callback and subscribe calls",
      fields: ["callback URL", "verify token", "calls event"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "WhatsApp Business API credentials",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save the existing WhatsApp API channel keys",
      fields: ["access token", "Phone Number ID", "app secret"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "Incoming call test",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Ask the client to call the WhatsApp business number",
      fields: ["Inbox", "Calls tab", "answer/reject/end"],
    },
  ],
  tiktok: [
    {
      provider: "Chatwoot",
      screenTitle: "TikTok inbox",
      screenUrl: "chatwoot.example.com/app/accounts/inboxes",
      leadDriveTitle: "Create or select TikTok inbox",
      fields: ["inbox ID", "account ID", "channel name"],
    },
    {
      provider: "Chatwoot",
      screenTitle: "Webhook and access token",
      screenUrl: "chatwoot.example.com/profile/settings/api",
      leadDriveTitle: "Copy Chatwoot credentials",
      fields: ["base URL", "access token", "webhook URL"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "TikTok via Chatwoot",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save Chatwoot channel with provider = TikTok",
      fields: ["provider", "Chatwoot URL", "access token"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "Incoming TikTok DM",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Confirm that one TikTok DM appears in Inbox",
      fields: ["sender", "last message", "assigned queue"],
    },
  ],
  meta: [
    {
      provider: "Meta for Developers",
      screenTitle: "Facebook app",
      screenUrl: "developers.facebook.com/apps",
      leadDriveTitle: "Open the tenant's Meta app",
      fields: ["app ID", "app secret", "business verification"],
    },
    {
      provider: "Facebook",
      screenTitle: "Page or Instagram account",
      screenUrl: "facebook.com/settings?tab=linked_instagram",
      leadDriveTitle: "Select the exact page or business account",
      fields: ["page ID", "Instagram business ID", "page access"],
    },
    {
      provider: "Meta permissions",
      screenTitle: "Messaging permissions",
      screenUrl: "developers.facebook.com/apps/review",
      leadDriveTitle: "Grant messaging and webhook permissions",
      fields: ["pages_messaging", "instagram_manage_messages", "webhooks"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Save and verify Inbox delivery",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save the channel and send one inbound test message",
      fields: ["page token", "app secret", "verify token"],
    },
  ],
  bot: [
    {
      provider: "Provider bot console",
      screenTitle: "Create bot",
      screenUrl: "t.me/BotFather",
      leadDriveTitle: "Create or select the bot that will talk to customers",
      fields: ["bot username", "bot token", "bot status"],
    },
    {
      provider: "Provider bot console",
      screenTitle: "Copy access token",
      screenUrl: "provider.example.com/bot/settings",
      leadDriveTitle: "Copy the token exactly once",
      fields: ["access token", "webhook permissions", "bot ID"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Paste token",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save the bot token in the channel form",
      fields: ["channel name", "bot token", "webhook URL"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "First inbound message",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Send one message to the bot and verify routing",
      fields: ["conversation", "contact", "assigned user"],
    },
  ],
  smsAtl: [
    {
      provider: "ATL SMS portal",
      screenTitle: "Sender profile",
      screenUrl: "sms.atl.example.com/senders",
      leadDriveTitle: "Prepare ATL account and sender name",
      fields: ["sender name", "account status", "allowed routes"],
    },
    {
      provider: "ATL SMS portal",
      screenTitle: "API credentials",
      screenUrl: "sms.atl.example.com/api",
      leadDriveTitle: "Copy API credentials",
      fields: ["API key", "API secret", "sender ID"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "ATL SMS channel",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save ATL as the SMS provider",
      fields: ["smsProvider", "sender ID", "API key"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Delivery test",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Send a test SMS and check delivery status",
      fields: ["recipient number", "message", "delivery result"],
    },
  ],
  smsGeneric: [
    {
      provider: "SMS provider",
      screenTitle: "API dashboard",
      screenUrl: "provider.example.com/sms/api",
      leadDriveTitle: "Open provider credentials",
      fields: ["API key", "API secret", "account SID"],
    },
    {
      provider: "SMS provider",
      screenTitle: "Sending number",
      screenUrl: "provider.example.com/phone-numbers",
      leadDriveTitle: "Choose the approved sender number",
      fields: ["phone number", "country", "SMS capability"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "SMS channel form",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Paste provider credentials into LeadDrive",
      fields: ["provider", "sender number", "API key"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Test SMS",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Send one test SMS before using automation",
      fields: ["recipient", "message", "status"],
    },
  ],
  emailGoogle: [
    {
      provider: "Google Admin",
      screenTitle: "Workspace access",
      screenUrl: "admin.google.com/ac/apps",
      leadDriveTitle: "Confirm admin approval path",
      fields: ["admin role", "mailbox", "security policy"],
    },
    {
      provider: "Google Account",
      screenTitle: "App password or SMTP access",
      screenUrl: "myaccount.google.com/security",
      leadDriveTitle: "Prepare mailbox credentials",
      fields: ["email", "app password", "2-step verification"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Mailbox channel",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save SMTP/IMAP settings",
      fields: ["SMTP host", "port", "TLS"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "Email test",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Send and receive one test email",
      fields: ["from address", "subject", "thread"],
    },
  ],
  emailSmtp: [
    {
      provider: "Mail provider",
      screenTitle: "Security settings",
      screenUrl: "mail.example.com/security",
      leadDriveTitle: "Create app password if required",
      fields: ["email", "app password", "allowed login"],
    },
    {
      provider: "Mail provider",
      screenTitle: "SMTP settings",
      screenUrl: "mail.example.com/smtp",
      leadDriveTitle: "Copy SMTP server and port",
      fields: ["SMTP host", "port", "TLS/SSL"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Email channel form",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Paste mailbox credentials into LeadDrive",
      fields: ["email", "SMTP host", "password"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "Forwarding test",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Validate that replies land in Inbox",
      fields: ["outbound test", "inbound reply", "contact match"],
    },
  ],
  generic: [
    {
      provider: "Provider console",
      screenTitle: "Integration settings",
      screenUrl: "provider.example.com/integrations",
      leadDriveTitle: "Prepare webhook URL and credentials",
      fields: ["API key", "webhook URL", "secret"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Channel identifier",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Choose the channel type and provider",
      fields: ["channel type", "provider", "config name"],
    },
    {
      provider: "LeadDrive",
      screenTitle: "Save channel",
      screenUrl: "app.leaddrivecrm.org/settings/channels",
      leadDriveTitle: "Save the credentials",
      fields: ["credential fields", "active switch", "webhook status"],
    },
    {
      provider: "LeadDrive Inbox",
      screenTitle: "Verification",
      screenUrl: "app.leaddrivecrm.org/inbox",
      leadDriveTitle: "Verify one inbound and one outbound message",
      fields: ["inbound event", "reply", "delivery status"],
    },
  ],
}

const tutorialCopy: Record<LocaleKey, {
  title: string
  preview: string
  chapters: string
  ready: string
  play: string
  pause: string
  previous: string
  next: string
  replay: string
  frame: string
  fieldLabel: string
  leadDriveLabel: string
  duration: string
  descriptions: Record<string, string>
  steps: Record<string, string[]>
}> = {
  en: {
    title: "Setup guide",
    preview: "Guided setup preview",
    chapters: "Setup steps",
    ready: "Built for this channel",
    play: "Auto-play",
    pause: "Pause",
    previous: "Previous",
    next: "Next",
    replay: "Start over",
    frame: "Step",
    fieldLabel: "Field",
    leadDriveLabel: "LeadDrive",
    duration: "4 steps",
    descriptions: {
      whatsapp: "WABA choice, Meta requirements, webhook verification and a safe test send.",
      whatsappCalling: "Exact Meta app, webhook subscription and the inbound-call test in Inbox.",
      tiktok: "How TikTok DMs enter LeadDrive through the Chatwoot bridge.",
      meta: "Meta permission flow for Facebook Messenger and Instagram Direct.",
      bot: "Bot token setup, webhook check and first inbound message validation.",
      smsAtl: "ATL sender setup, API credentials and first SMS delivery check.",
      smsGeneric: "Provider credentials, sender number and delivery verification.",
      emailGoogle: "Google Workspace mailbox requirements and admin approval path.",
      emailSmtp: "SMTP credentials, app password and forwarding validation.",
      generic: "What to prepare, where to paste credentials and how to verify the channel.",
    },
    steps: {
      whatsapp: ["Choose new or existing WhatsApp Business account", "Check Meta Business access and phone number", "Copy webhook URL and verify token", "Send one test message from LeadDrive"],
      whatsappCalling: ["Open the same Meta app that owns the WhatsApp number saved in LeadDrive", "Copy App Secret from App settings -> Basic and save it in the WhatsApp API channel", "In WhatsApp configuration, set the LeadDrive callback and verify token, then subscribe calls", "Ask the client to call the WhatsApp business number; answer, reject or end it from Inbox"],
      tiktok: ["Create or select the TikTok inbox in Chatwoot", "Copy Chatwoot webhook and access token", "Save the channel as TikTok in LeadDrive", "Confirm that one TikTok DM appears in Inbox"],
      meta: ["Start the Meta connection flow", "Select the page or Instagram business account", "Grant messaging permissions", "Return to LeadDrive and verify Inbox delivery"],
      bot: ["Create or select an existing bot", "Copy the bot access token", "Paste the token into LeadDrive", "Send one inbound message to confirm routing"],
      smsAtl: ["Prepare ATL account and sender name", "Paste ATL API credentials", "Save the sender number or sender ID", "Send one test SMS and check delivery"],
      smsGeneric: ["Copy provider API credentials", "Select or paste the sending number", "Save the channel in LeadDrive", "Send one test SMS"],
      emailGoogle: ["Confirm Google Workspace admin access", "Allow the LeadDrive mail connection", "Save mailbox settings", "Send and receive one test email"],
      emailSmtp: ["Create an app password if required", "Enter email, SMTP server and port", "Enable TLS/SSL when required", "Validate forwarding into Inbox"],
      generic: ["Prepare webhook URL and credentials", "Choose the channel identifier", "Save the channel", "Verify one inbound and one outbound message"],
    },
  },
  ru: {
    title: "Справка по подключению",
    preview: "Пошаговый сценарий подключения",
    chapters: "Шаги подключения",
    ready: "Собрано под этот канал",
    play: "Автопрокрутка",
    pause: "Пауза",
    previous: "Назад",
    next: "Дальше",
    replay: "Сначала",
    frame: "Шаг",
    fieldLabel: "Поле",
    leadDriveLabel: "LeadDrive",
    duration: "4 шага",
    descriptions: {
      whatsapp: "Выбор WABA, требования Meta, проверка webhook и безопасная тестовая отправка.",
      whatsappCalling: "Точное Meta-приложение, подписка webhook и проверка входящего плюс разрешённого исходящего звонка в Inbox.",
      tiktok: "Как TikTok DM попадают в LeadDrive через Chatwoot bridge.",
      meta: "Права Meta для Facebook Messenger и Instagram Direct.",
      bot: "Bot token, проверка webhook и первое входящее сообщение.",
      smsAtl: "Настройка ATL sender, API‑ключи и первая проверка SMS‑доставки.",
      smsGeneric: "Ключи провайдера, номер отправителя и проверка доставки.",
      emailGoogle: "Требования Google Workspace и путь через администратора.",
      emailSmtp: "SMTP‑доступы, app password и проверка пересылки.",
      generic: "Что подготовить, куда вставить ключи и как проверить канал.",
    },
    steps: {
      whatsapp: ["Выбрать новый или существующий WhatsApp Business аккаунт", "Проверить доступ к Meta Business и номеру", "Скопировать webhook URL и verify token", "Отправить одно тестовое сообщение из LeadDrive"],
      whatsappCalling: ["Откройте то же Meta app, к которому привязан WhatsApp-номер, сохранённый в LeadDrive", "Скопируйте App Secret из App settings -> Basic и сохраните его в WhatsApp API канале", "В WhatsApp configuration вставьте callback LeadDrive и verify token, затем подпишите событие calls", "Попросите клиента позвонить на WhatsApp business номер; ответьте, отклоните или завершите звонок в Inbox"],
      tiktok: ["Создать или выбрать TikTok inbox в Chatwoot", "Скопировать webhook и access token из Chatwoot", "Сохранить канал как TikTok в LeadDrive", "Проверить, что один TikTok DM пришёл в Inbox"],
      meta: ["Запустить подключение Meta", "Выбрать страницу или Instagram business аккаунт", "Выдать права на сообщения", "Вернуться в LeadDrive и проверить Inbox"],
      bot: ["Создать или выбрать существующего бота", "Скопировать bot access token", "Вставить token в LeadDrive", "Отправить входящее сообщение и проверить routing"],
      smsAtl: ["Подготовить ATL аккаунт и sender name", "Вставить ATL API‑доступы", "Сохранить номер или sender ID", "Отправить тестовое SMS и проверить доставку"],
      smsGeneric: ["Скопировать API‑ключи провайдера", "Выбрать или вставить номер отправителя", "Сохранить канал в LeadDrive", "Отправить одно тестовое SMS"],
      emailGoogle: ["Проверить доступ администратора Google Workspace", "Разрешить почтовое подключение LeadDrive", "Сохранить mailbox settings", "Отправить и принять тестовый email"],
      emailSmtp: ["Создать app password, если требуется", "Ввести email, SMTP server и port", "Включить TLS/SSL при необходимости", "Проверить пересылку в Inbox"],
      generic: ["Подготовить webhook URL и ключи", "Выбрать идентификатор канала", "Сохранить канал", "Проверить одно входящее и одно исходящее сообщение"],
    },
  },
  az: {
    title: "Qoşulma yardımı",
    preview: "Addım-addım qoşulma ssenarisi",
    chapters: "Qoşulma addımları",
    ready: "Bu kanal üçün hazırlanıb",
    play: "Avtomatik bax",
    pause: "Pauza",
    previous: "Geri",
    next: "İrəli",
    replay: "Yenidən",
    frame: "Addım",
    fieldLabel: "Sahə",
    leadDriveLabel: "LeadDrive",
    duration: "4 addım",
    descriptions: {
      whatsapp: "WABA seçimi, Meta tələbləri, webhook yoxlaması və təhlükəsiz test mesajı.",
      whatsappCalling: "Düzgün Meta app, webhook abunəliyi və Inbox-da inbound plus icazəli outbound zəng testi.",
      tiktok: "TikTok DM-lərinin Chatwoot bridge vasitəsilə LeadDrive-a necə gəldiyi.",
      meta: "Facebook Messenger və Instagram Direct üçün Meta icazə axını.",
      bot: "Bot token, webhook yoxlaması və ilk gələn mesajın təsdiqi.",
      smsAtl: "ATL sender qurulması, API açarları və ilk SMS çatdırılma testi.",
      smsGeneric: "Provayder açarları, göndərən nömrə və çatdırılma yoxlaması.",
      emailGoogle: "Google Workspace mailbox tələbləri və admin təsdiqi.",
      emailSmtp: "SMTP məlumatları, app password və yönləndirmə yoxlaması.",
      generic: "Nə hazırlamaq, açarları hara yazmaq və kanalı necə yoxlamaq.",
    },
    steps: {
      whatsapp: ["Yeni və ya mövcud WhatsApp Business hesabını seçin", "Meta Business girişi və nömrəni yoxlayın", "Webhook URL və verify token-i kopyalayın", "LeadDrive-dan bir test mesajı göndərin"],
      whatsappCalling: ["LeadDrive-da saxlanan WhatsApp nömrəsinə bağlı eyni Meta app-i açın", "App settings -> Basic bölməsindən App Secret-i kopyalayıb WhatsApp API kanalında saxlayın", "WhatsApp configuration-da LeadDrive callback və verify token yazın, sonra calls event-ə abunə olun", "Müştəridən WhatsApp business nömrəsinə zəng etməsini istəyin; Inbox-da cavablayın, rədd edin və ya bitirin"],
      tiktok: ["Chatwoot-da TikTok inbox yaradın və ya seçin", "Chatwoot webhook və access token-i kopyalayın", "LeadDrive-da kanalı TikTok kimi saxlayın", "Bir TikTok DM-in Inbox-a gəldiyini yoxlayın"],
      meta: ["Meta qoşulma axınını başladın", "Page və ya Instagram business hesabını seçin", "Mesaj icazələrini verin", "LeadDrive-a qayıdıb Inbox çatdırılmasını yoxlayın"],
      bot: ["Yeni bot yaradın və ya mövcud botu seçin", "Bot access token-i kopyalayın", "Token-i LeadDrive-a yazın", "Bir gələn mesaj göndərib routing-i yoxlayın"],
      smsAtl: ["ATL hesabı və sender name hazırlayın", "ATL API məlumatlarını yazın", "Nömrə və ya sender ID saxlayın", "Test SMS göndərib çatdırılmanı yoxlayın"],
      smsGeneric: ["Provayder API açarlarını kopyalayın", "Göndərən nömrəni seçin və ya yazın", "Kanalı LeadDrive-da saxlayın", "Bir test SMS göndərin"],
      emailGoogle: ["Google Workspace admin girişini yoxlayın", "LeadDrive mail qoşulmasına icazə verin", "Mailbox parametrlərini saxlayın", "Bir test email göndərin və qəbul edin"],
      emailSmtp: ["Lazımdırsa app password yaradın", "Email, SMTP server və port yazın", "Lazımdırsa TLS/SSL aktiv edin", "Inbox-a yönləndirməni yoxlayın"],
      generic: ["Webhook URL və açarları hazırlayın", "Kanal identifikatorunu seçin", "Kanalı saxlayın", "Bir gələn və bir gedən mesajı yoxlayın"],
    },
  },
}

function tutorialKeyForCard(card: CatalogCard) {
  if (card.id === "whatsapp-business-calls") return "whatsappCalling"
  if (card.channelType === "whatsapp") return "whatsapp"
  if (card.id === "tiktok") return "tiktok"
  if (card.channelType === "facebook" || card.channelType === "instagram") return "meta"
  if (card.channelType === "telegram" || card.channelType === "vkontakte") return "bot"
  if (card.id === "atl-sms") return "smsAtl"
  if (card.channelType === "sms") return "smsGeneric"
  if (card.id === "google-workspace") return "emailGoogle"
  if (card.channelType === "email") return "emailSmtp"
  return "generic"
}

function tutorialForCard(card: CatalogCard, locale: LocaleKey): ChannelTutorial {
  const t = tutorialCopy[locale]
  const key = tutorialKeyForCard(card)
  return {
    key,
    duration: t.duration,
    description: t.descriptions[key] || t.descriptions.generic,
    steps: t.steps[key] || t.steps.generic,
  }
}

function sceneForTutorial(key: string, index: number) {
  const scenes = tutorialScenes[key] || tutorialScenes.generic
  return scenes[Math.min(index, scenes.length - 1)] || scenes[0]
}

function normalizeLocale(locale: string): LocaleKey {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

function channelProvider(channel: ChannelConfig): string | undefined {
  const settings = channel.settings || {}
  if (channel.channelType === "sms") {
    if (typeof settings.smsProvider === "string") return settings.smsProvider
    if (typeof settings.accountSid === "string" || channel.phoneNumber) return "twilio"
    return "atl"
  }
  if (channel.channelType === "voip") {
    return typeof settings.provider === "string" ? settings.provider : "twilio"
  }
  if (channel.channelType === "chatwoot") {
    return typeof settings.provider === "string" ? settings.provider : undefined
  }
  return undefined
}

function channelMatchesCard(card: CatalogCard, channel: ChannelConfig) {
  if (!card.channelType || channel.channelType !== card.channelType) return false
  if (!card.provider) return true
  return channelProvider(channel) === card.provider
}

function channelLabel(channel: ChannelConfig) {
  const provider = channelProvider(channel)
  return [channel.channelType, provider, channel.phoneNumber].filter(Boolean).join(" · ")
}

/**
 * A Meta row that is not live is not automatically a "draft". Three different things break delivery
 * and each needs a different action from the user: nothing came back from Meta (draft → finish the
 * OAuth), the row is switched off (paused → switch it on), or Meta refused the message subscription
 * (needsReconnect → re-run OAuth and grant the messaging permission). Labelling all three "Draft"
 * would send two of the three users to the wrong fix.
 */
function cardBrokenBadge(c: (typeof copy)[LocaleKey], state: ChannelConnectionState) {
  if (state === "draft") return c.cardDraftBadge
  if (state === "paused") return c.cardPausedBadge
  if (state === "needsReconnect") return c.cardReconnectBadge
  return null
}

function cardBrokenStatus(c: (typeof copy)[LocaleKey], state: ChannelConnectionState) {
  if (state === "draft") return c.cardDraftStatus
  if (state === "paused") return c.cardPausedStatus
  if (state === "needsReconnect") return c.cardReconnectStatus
  return null
}

function cardBrokenHint(c: (typeof copy)[LocaleKey], state: ChannelConnectionState) {
  if (state === "draft") return c.cardDraftHint
  if (state === "paused") return c.cardPausedHint
  if (state === "needsReconnect") return c.cardReconnectHint
  return null
}

function explainWhatsAppTestError(message: string, c: (typeof copy)[LocaleKey]) {
  const normalized = message.toLowerCase()
  if (normalized.includes("#131058") || (normalized.includes("hello_world") && normalized.includes("public test"))) {
    return c.publicTemplateError
  }
  return message
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<div className="force-light min-h-[70vh] rounded-[28px] border bg-white" />}>
      <ChannelsPageInner />
    </Suspense>
  )
}

function ChannelsPageInner() {
  const { data: session } = useSession()
  const t = useTranslations("settings")
  const locale = normalizeLocale(useLocale())
  const router = useRouter()
  const searchParams = useSearchParams()
  const c = copy[locale]
  useAutoTour("channels")

  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [connectCard, setConnectCard] = useState<CatalogCard | null>(null)
  const [connectMode, setConnectMode] = useState<"new" | "existing">("new")
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialPlaying, setTutorialPlaying] = useState(true)
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0)
  const [lockFormChannelType, setLockFormChannelType] = useState(false)
  const [editData, setEditData] = useState<(Partial<ChannelConfig> & { settings?: Record<string, unknown> }) | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<CatalogTab>("all")
  const [testPhone, setTestPhone] = useState("")
  const [testTemplateName, setTestTemplateName] = useState("hello_world")
  const [testLanguageCode, setTestLanguageCode] = useState("en_US")
  const [testChannelId, setTestChannelId] = useState<string | null>(null)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [reducedTutorialMotion, setReducedTutorialMotion] = useState(false)
  const orgId = session?.user?.organizationId
  const orgSlug = session?.user?.organizationSlug

  const cards = useMemo(() => catalogCards(c), [c])
  const whatsappCallingWebhook = whatsappWebhookUrl(orgSlug)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/channels", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (res.ok) {
        const result = await res.json()
        setChannels(result.data || [])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchChannels() }, [fetchChannels])

  useEffect(() => {
    const connectId = searchParams.get("connect")
    if (!connectId) return
    const normalizedConnectId = normalizeCatalogConnectId(connectId)
    const card = cards.find((item) => item.id === normalizedConnectId)
    const mode = searchParams.get("mode") === "existing" ? "existing" : "new"
    if (card) {
      router.replace(`/settings/channels/connect/${card.id}?mode=${mode}`)
      return
    }
    router.replace("/settings/channels")
  }, [cards, router, searchParams])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/channels/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchChannels()
  }

  const sendTestWhatsApp = async () => {
    if (!testPhone) return
    setTestSending(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/v1/whatsapp/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          to: testPhone,
          templateName: testTemplateName.trim() || "hello_world",
          languageCode: testLanguageCode.trim() || "en_US",
        }),
      })
      const data = await res.json()
      const rawError = typeof data.error === "string" ? data.error : c.sendError
      setTestResult({
        success: res.ok && Boolean(data.success),
        message: res.ok && data.success ? c.messageSent : explainWhatsAppTestError(rawError, c),
      })
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : c.sendError })
    } finally {
      setTestSending(false)
    }
  }

  const openNewChannel = (card: CatalogCard) => {
    const guideHref = guideHrefForCard(card)
    if (guideHref) {
      router.push(`${guideHref}?mode=new`)
      return
    }
    if (card.action.type === "link") {
      router.push(card.action.href)
      return
    }
    if (card.action.type !== "form") return
    setTutorialOpen(false)
    setConnectCard(card)
    setConnectMode("new")
  }

  const startManualSetup = () => {
    if (!connectCard || connectCard.action.type !== "form") return
    setEditData({
      channelType: connectCard.action.channelType,
      configName: connectCard.action.presetName,
      settings: connectCard.action.settings,
      isActive: true,
    })
    setLockFormChannelType(true)
    setConnectCard(null)
    setShowForm(true)
  }

  const connectedByCard = useMemo(() => {
    const map = new Map<string, ChannelConfig>()
    const primaryIds = new Set<string>()
    for (const card of cards) {
      const matches = channels.filter((channel) => channelMatchesCard(card, channel))
      // Prefer a row that actually delivers. A Model B tenant keeps TWO facebook rows: the Meta-app
      // config row (appId/appSecret/verifyToken, no page) and the page row the OAuth callback writes.
      // The card must describe the delivering one instead of whichever the API ordered first.
      // For every other channel type this only prefers a switched-on row over a switched-off one.
      const connected = matches.find((channel) => channelIsLiveConnection(channel)) || matches[0]
      if (connected) {
        map.set(card.id, connected)
        primaryIds.add(connected.id)
      }
    }
    return { map, primaryIds }
  }, [cards, channels])

  const connectedForCard = (card: CatalogCard) => connectedByCard.map.get(card.id)
  const whatsappBusinessChannel =
    connectedByCard.map.get("whatsapp-business")
    || channels.find((channel) => channel.channelType === "whatsapp" && channel.isActive)
  const whatsappCallingCredentialChecks = whatsappBusinessChannel
    ? [
        { label: c.callingCredentialAccessToken, ready: Boolean(whatsappBusinessChannel.hasAccessToken) },
        { label: c.callingCredentialPhoneNumberId, ready: Boolean(whatsappBusinessChannel.hasPhoneNumberId) },
        { label: c.callingCredentialVerifyToken, ready: Boolean(whatsappBusinessChannel.hasVerifyToken) },
        { label: c.callingCredentialAppSecret, ready: Boolean(whatsappBusinessChannel.hasAppSecret) },
      ]
    : []
  const whatsappCallingCredentialsReady =
    whatsappCallingCredentialChecks.length > 0
    && whatsappCallingCredentialChecks.every((check) => check.ready)
  const editExistingChannel = (channel: ChannelConfig) => {
    const card = cards.find((item) => channelMatchesCard(item, channel))
    if (card) {
      router.push(`/settings/channels/connect/${card.id}?mode=existing&stage=connect&channelId=${encodeURIComponent(channel.id)}`)
      return
    }
    setEditData({ ...channel, settings: channel.settings || undefined })
    setLockFormChannelType(true)
    setShowForm(true)
  }

  const q = search.trim().toLowerCase()
  const visibleCards = cards.filter((card) => {
    if (activeTab !== "all" && card.tab !== activeTab) return false
    if (!q) return true
    return [
      card.title,
      card.description,
      card.tab,
      card.provider || "",
      card.channelType || "",
    ].join(" ").toLowerCase().includes(q)
  })
  const unmatchedChannels = channels.filter((channel) => {
    if (activeTab !== "all") return false
    if (connectedByCard.primaryIds.has(channel.id)) return false
    if (!q) return true
    return [
      channel.configName,
      channel.channelType,
      channelProvider(channel) || "",
      channel.phoneNumber || "",
    ].join(" ").toLowerCase().includes(q)
  })
  const hasVisibleChannels = visibleCards.length > 0 || unmatchedChannels.length > 0

  // "N active" sits next to a green check, so it has to mean "N channels that actually work". An
  // empty Meta row is created with isActive=true, so counting isActive alone counted drafts as wins.
  // The isActive term is now implied by the predicate for every type; it stays as a cheap guard for
  // callers that hand us a row with the column unselected.
  const activeCount = channels.filter((cn) => cn.isActive && channelIsLiveConnection(cn)).length
  const availableCount = cards.filter(card => card.action.type !== "disabled").length
  const ConnectIcon = connectCard?.icon
  const connectTutorial = useMemo(
    () => (connectCard ? tutorialForCard(connectCard, locale) : null),
    [connectCard, locale]
  )
  const tutorialUi = tutorialCopy[locale]
  const tutorialSteps = connectTutorial?.steps || []
  const connectResources = connectCard
    ? [
        { label: c.resourceGuide, icon: BookOpen, stepIndex: 0 },
        { label: c.resourcePricing, icon: CircleDot, stepIndex: Math.min(1, Math.max(tutorialSteps.length - 1, 0)) },
        { label: c.resourceHelp, icon: ExternalLink, stepIndex: Math.min(2, Math.max(tutorialSteps.length - 1, 0)) },
      ]
    : []
  const safeTutorialStepIndex = tutorialSteps.length
    ? Math.min(tutorialStepIndex, tutorialSteps.length - 1)
    : 0
  const currentTutorialStep = tutorialSteps[safeTutorialStepIndex] || ""
  const currentTutorialScene = connectTutorial ? sceneForTutorial(connectTutorial.key, safeTutorialStepIndex) : null
  const tutorialProgress = tutorialSteps.length ? ((safeTutorialStepIndex + 1) / tutorialSteps.length) * 100 : 0
  const connectionPathSteps = connectCard?.action.type === "guide" ? c.callingConnectionPath : c.connectionPath
  const openTutorialAt = (stepIndex: number) => {
    setTutorialStepIndex(stepIndex)
    setTutorialPlaying(!reducedTutorialMotion)
    setTutorialOpen(true)
  }

  useEffect(() => {
    setTutorialStepIndex(0)
    setTutorialPlaying(!reducedTutorialMotion)
  }, [connectCard?.id, reducedTutorialMotion])

  useEffect(() => {
    if (typeof window === "undefined") return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const syncPreference = () => setReducedTutorialMotion(query.matches)
    syncPreference()
    query.addEventListener("change", syncPreference)
    return () => query.removeEventListener("change", syncPreference)
  }, [])

  useEffect(() => {
    if (reducedTutorialMotion || !tutorialOpen || !tutorialPlaying || tutorialSteps.length <= 1) return
    const timer = window.setInterval(() => {
      setTutorialStepIndex((index) => (index + 1) % tutorialSteps.length)
    }, 2600)
    return () => window.clearInterval(timer)
  }, [reducedTutorialMotion, tutorialOpen, tutorialPlaying, tutorialSteps.length])

  return (
    <div className="force-light overflow-hidden rounded-[28px] border border-zinc-200 bg-[#f8fafc] text-zinc-950 shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
      {connectCard ? (
        <>
          <div className="border-b border-zinc-200 bg-white px-6 py-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTutorialOpen(false)
                setConnectCard(null)
              }}
              className="mb-4 gap-2 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
            >
              <ArrowLeft className="h-4 w-4" />
              {c.backToCatalog}
            </Button>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-600">{c.connectChannel}</p>
                <div className="mt-3 flex items-center gap-4">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-2xl font-black text-orange-600 shadow-inner">
                    {connectCard.logo}
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{connectCard.title}</h1>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">{connectCard.description}</p>
                  </div>
                </div>
              </div>
              {connectCard.badge && (
                <Badge className="w-fit border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                  <BadgeCheck className="mr-1 h-3 w-3" />
                  {connectCard.badge}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid min-h-[620px] gap-6 px-6 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-5">
              <div className={cn("relative overflow-hidden rounded-3xl border bg-white p-5 shadow-sm", connectCard.accent)}>
                <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80", connectCard.accent)} />
                <div className="relative flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-xl font-black text-orange-600">
                    {ConnectIcon && <ConnectIcon className="h-6 w-6" />}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{c.connectHeading}</p>
                    <p className="text-lg font-semibold text-zinc-950">{connectCard.title}</p>
                  </div>
                </div>
                <p className="relative mt-4 text-sm leading-6 text-zinc-600">
                  {connectCard.action.type === "guide" ? c.callingReadinessHint : c.connectHelp}
                </p>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-zinc-900">{c.additionalResources}</h2>
                <div className="mt-4 space-y-2">
                  {connectResources.map((resource) => {
                    const ResourceIcon = resource.icon
                    return (
                      <button
                        key={resource.label}
                        type="button"
                        onClick={() => openTutorialAt(resource.stepIndex)}
                        aria-label={`${resource.label}: ${tutorialUi.frame} ${resource.stepIndex + 1}`}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-orange-50/60 px-3 py-3 text-left text-sm text-orange-800 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                      >
                        <span className="flex min-w-0 items-start gap-3">
                          <ResourceIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                          <span className="min-w-0">
                            <span className="block break-words font-medium text-orange-950">{resource.label}</span>
                            <span className="mt-0.5 block line-clamp-2 break-words text-xs leading-5 text-orange-700">
                              {tutorialUi.frame} {resource.stepIndex + 1}: {tutorialSteps[resource.stepIndex] || connectTutorial?.description || tutorialUi.ready}
                            </span>
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-white px-2 py-1 text-[11px] font-semibold text-orange-700">
                          <PlayCircle className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">{c.watchTutorial}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </aside>

            <section className="space-y-5 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="rounded-3xl border border-orange-200 bg-orange-50/60 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{c.connectionPathTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-600">
                      {connectCard.action.type === "guide" ? c.callingReadinessHint : c.connectionPathHint}
                    </p>
                  </div>
                  <Badge className="w-fit border-orange-200 bg-white text-orange-700 hover:bg-white">
                    {connectTutorial?.duration || tutorialUi.duration}
                  </Badge>
                </div>
                <ol className="mt-4 grid gap-3 md:grid-cols-3">
                  {connectionPathSteps.map((step, index) => {
                    const stepIndex = tutorialSteps.length ? Math.min(index, tutorialSteps.length - 1) : 0
                    return (
                      <li key={step.title}>
                        <button
                          type="button"
                          onClick={() => openTutorialAt(stepIndex)}
                          className="flex h-full w-full items-start gap-3 rounded-2xl border border-orange-100 bg-white p-3 text-left transition hover:border-orange-200 hover:bg-orange-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-bold text-white shadow-sm">
                            {index + 1}
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-zinc-950">{step.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-zinc-600">{step.desc}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  {connectTutorial && (
                    <div className="overflow-hidden rounded-3xl border border-orange-200 bg-white shadow-sm">
                      <div className="relative min-h-[250px] overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(251,146,60,0.26),transparent_32%),linear-gradient(135deg,#fff7ed_0%,#ffffff_45%,#f4f4f5_100%)] p-5">
                        <div className="absolute right-5 top-5 rounded-full border border-orange-200 bg-white/80 px-3 py-1 text-xs font-semibold text-orange-700 shadow-sm backdrop-blur">
                          {connectTutorial.duration}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-orange-200 bg-white text-orange-600 shadow-sm">
                            <PlayCircle className="h-7 w-7" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">
                              {tutorialUi.title}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-zinc-950">{connectCard.title}</p>
                          </div>
                        </div>

                        <div className="mt-7 grid min-h-[126px] place-items-center rounded-3xl border border-orange-200/70 bg-white/78 px-6 text-center shadow-[0_24px_70px_rgba(249,115,22,0.16)] backdrop-blur">
                          <button
                            type="button"
                            onClick={() => {
                              setTutorialStepIndex(0)
                              setTutorialPlaying(true)
                              setTutorialOpen(true)
                            }}
                            className="group inline-flex items-center gap-3 rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(249,115,22,0.28)] transition hover:bg-orange-600"
                            aria-label={`${tutorialUi.play} ${connectCard.title}`}
                          >
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/18">
                              <PlayCircle className="h-5 w-5" />
                            </span>
                            <span>{c.watchTutorial}</span>
                          </button>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                          <Badge className="border-orange-200 bg-white text-orange-700 hover:bg-white">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {tutorialUi.ready}
                          </Badge>
                          <span>{connectTutorial.description}</span>
                        </div>
                      </div>

                      <div className="border-t border-orange-100 bg-white p-5">
                        <p className="text-sm font-semibold text-zinc-900">{tutorialUi.chapters}</p>
                        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                          {connectTutorial.steps.map((step, index) => (
                            <li key={step} className="flex gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                                {index + 1}
                              </span>
                              <span className="text-sm leading-5 text-zinc-700">{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>

                {connectCard.action.type === "guide" ? (
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
                    <p className="text-lg font-semibold text-zinc-900">{c.callingReadinessTitle}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{c.callingReadinessHint}</p>

                    <div className="mt-5 space-y-3">
                      <div className="rounded-2xl border border-orange-200 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                          {c.callingTestDomain}
                        </p>
                        <code className="mt-2 block break-all rounded-xl bg-orange-50 px-3 py-2 font-mono text-xs text-orange-800">
                          {LEADDRIVE_APP_ORIGIN}
                        </code>
                      </div>
                      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          {c.callingMessageWebhook}
                        </p>
                        <code className="mt-2 block break-all rounded-xl bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700">
                          {whatsappCallingWebhook}
                        </code>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{c.callingMessageWebhookHint}</p>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{c.callingCredentialStatusTitle}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-600">
                            {whatsappBusinessChannel ? c.callingCredentialStatusHint : c.callingNoMessagingChannel}
                          </p>
                        </div>
                        {whatsappBusinessChannel && (
                          <Badge className={cn(
                            "w-fit border text-xs",
                            whatsappCallingCredentialsReady
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                              : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50"
                          )}>
                            {whatsappCallingCredentialsReady ? c.callingReady : c.callingMissing}
                          </Badge>
                        )}
                      </div>

                      {whatsappBusinessChannel && (
                        <>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {whatsappCallingCredentialChecks.map((check) => {
                              const StatusIcon = check.ready ? CheckCircle2 : Clock3
                              return (
                                <div
                                  key={check.label}
                                  className={cn(
                                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium",
                                    check.ready
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                      : "border-amber-200 bg-amber-50 text-amber-900"
                                  )}
                                >
                                  <StatusIcon className={cn("h-4 w-4 shrink-0", check.ready ? "text-emerald-600" : "text-amber-700")} />
                                  <span className="min-w-0 flex-1 break-words">{check.label}</span>
                                  <span className="shrink-0">{check.ready ? c.callingReady : c.callingMissing}</span>
                                </div>
                              )
                            })}
                          </div>
                          {!whatsappCallingCredentialsReady && (
                            <p className="mt-3 text-xs leading-5 text-amber-800">{c.callingSignedWebhookBlocked}</p>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => editExistingChannel(whatsappBusinessChannel)}
                            className="mt-4 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                          >
                            <Pencil className="h-4 w-4" />
                            {c.callingEditMessagingSetup}
                          </Button>
                        </>
                      )}
                    </div>

                    <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-sm font-semibold text-zinc-900">{c.callingRequirementsTitle}</p>
                      <ol className="mt-3 space-y-2">
                        {c.callingRequirements.map((requirement, index) => (
                          <li key={requirement} className="flex gap-3 text-sm leading-5 text-zinc-700">
                            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-700">
                              {index + 1}
                            </span>
                            <span>{requirement}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-900">{c.callingBackendTitle}</p>
                      <p className="mt-2 text-xs leading-5 text-amber-800">{c.callingBackendHint}</p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          const whatsappCard = cards.find((card) => card.id === "whatsapp-business")
                          if (whatsappCard) openNewChannel(whatsappCard)
                        }}
                        className="bg-orange-500 text-white hover:bg-orange-600"
                      >
                        {c.callingOpenMessagingSetup}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setTutorialOpen(false)
                          setConnectCard(null)
                        }}
                        className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      >
                        {c.backToCatalog}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5">
                    <p className="text-lg font-semibold text-zinc-900">{c.connectHeading} {connectCard.title}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{c.manualSetupHint}</p>
                    <div className="mt-5 space-y-3" role="radiogroup" aria-label={c.connectChannel}>
                      {([
                        ["new", c.optionNewTitle, c.optionNewDesc],
                        ["existing", c.optionExistingTitle, c.optionExistingDesc],
                      ] as const).map(([value, title, description]) => {
                        const selected = connectMode === value
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setConnectMode(value)}
                            className={cn(
                              "w-full rounded-2xl border p-4 text-left transition",
                              selected
                                ? "border-orange-300 bg-orange-50 text-orange-950 shadow-[0_0_0_1px_rgba(251,146,60,0.22)]"
                                : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200 hover:bg-zinc-50 hover:text-zinc-950"
                            )}
                            role="radio"
                            aria-checked={selected}
                          >
                            <span className="flex items-start gap-3">
                              <span className={cn("mt-1 h-3 w-3 rounded-full border", selected ? "border-orange-500 bg-orange-500" : "border-zinc-300")} />
                              <span>
                                <span className="block text-sm font-semibold">{title}</span>
                                <span className={cn(
                                  "mt-1 block text-xs leading-5",
                                  selected ? "text-orange-800" : "text-zinc-500",
                                )}>{description}</span>
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button onClick={startManualSetup} className="bg-orange-500 text-white hover:bg-orange-600">
                        {c.getStarted}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setTutorialOpen(false)
                          setConnectCard(null)
                        }}
                        className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      >
                        {c.skip}
                      </Button>
                    </div>
                    <p className="mt-4 text-xs text-zinc-500">{c.manualSetup}</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      ) : (
        <>
      <div className="border-b border-zinc-200 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600">
                <Settings className="h-5 w-5" />
              </div>
              <h1 data-tour-id="channels-header" className="text-2xl font-semibold tracking-tight">
                {c.title}
              </h1>
              <TourReplayButton tourId="channels" />
              <HelpButton slug="channels" variant="label" />
            </div>
            <p className="text-sm text-zinc-600">{c.desc}</p>
            <p className="mt-1 text-xs text-zinc-500">{c.hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              data-testid="channels-active-count"
              className="gap-1 border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {activeCount} {c.active}
            </Badge>
            <Badge className="gap-1 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
              <CircleDot className="h-3.5 w-3.5" />
              {availableCount} {c.available}
            </Badge>
            <Button
              onClick={() => {
                setActiveTab("all")
                setSearch("")
                document.getElementById("channel-catalog-grid")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
              className="gap-2 bg-orange-500 text-white hover:bg-orange-600"
            >
              <Plus className="h-4 w-4" />
              {t("channelAdd")}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-200 bg-zinc-50/70 px-6 py-4">
        <div className="rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-orange-50 text-orange-600">
                <Workflow className="h-4 w-4" />
              </div>
              <p className="text-sm font-semibold text-zinc-950">{c.catalogFlowTitle}</p>
            </div>
            <p className="max-w-3xl text-xs leading-5 text-zinc-500">{c.tabGuides[activeTab]}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {c.catalogFlow.map((step, index) => (
              <div key={step.title} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-orange-500 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-zinc-900">{step.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{step.desc}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-200 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const selected = activeTab === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition",
                    selected
                      ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200 shadow-[inset_0_-3px_0_rgba(249,115,22,0.85)]"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  )}
                >
                  {c.tabs[tab]}
                </button>
              )
            })}
          </div>
          <div className="relative w-full xl:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={c.search}
              className="h-11 rounded-xl border-zinc-200 bg-white pl-10 text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-orange-500"
            />
          </div>
        </div>
      </div>

      <div id="channel-catalog-grid" className="min-h-[560px] scroll-mt-6 px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100" />
            ))}
          </div>
        ) : !hasVisibleChannels ? (
          <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-zinc-200 bg-white text-center">
            <div className="max-w-sm px-6">
              <Search className="mx-auto mb-3 h-8 w-8 text-zinc-400" />
              <p className="font-medium text-zinc-700">{c.noResults}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{c.noResultsHint}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {(["business", "calls", "sms", "email", "live"] as const).map((group) => {
              const groupCards = visibleCards.filter((card) => card.tab === group)
              if (groupCards.length === 0) return null
              return (
                <section key={group} className="space-y-4">
                  {activeTab === "all" && (
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <h2 className="text-base font-semibold text-zinc-950">{c.groups[group]}</h2>
                      <p className="max-w-2xl text-sm leading-6 text-zinc-500">{c.tabGuides[group]}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
                    {groupCards.map((card) => {
                      const connected = connectedForCard(card)
                      // "Row exists" was never the same thing as "the channel delivers". The state
                      // comes from lib/channels/live-connection, which reads the same three facts the
                      // inbound resolver reads, so the badge cannot drift away from reality. A row in
                      // any non-live state stays editable and deletable, must not wear the "Connected"
                      // badge, and must not hide the OAuth button.
                      const connectionState = connected ? channelConnectionState(connected) : null
                      const connectionLive = connectionState === "live"
                      const connectionBroken = Boolean(connected) && !connectionLive
                      const brokenBadge = connectionState ? cardBrokenBadge(c, connectionState) : null
                      const brokenStatus = connectionState ? cardBrokenStatus(c, connectionState) : null
                      const brokenHint = connectionState ? cardBrokenHint(c, connectionState) : null
                      const guideHref = guideHrefForCard(card)
                      const Icon = card.icon
                      return (
                        <article
                          key={card.id}
                          data-testid={`channel-card-${card.id}`}
                          className={cn(
                            "group relative flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_14px_42px_rgba(15,23,42,0.09)]",
                            card.accent
                          )}
                        >
                          <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60", card.accent)} />

                          <div className="relative flex flex-1 flex-col p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
                                    {c.groups[card.tab]}
                                  </span>
                                {card.badge && (
                                  <Badge className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50">
                                    <BadgeCheck className="mr-1 h-3 w-3" />
                                    {card.badge}
                                  </Badge>
                                )}
                                {connectionLive && (
                                  <Badge
                                    data-testid="channel-card-connected-badge"
                                    className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"
                                  >
                                    {c.connected}
                                  </Badge>
                                )}
                                {connectionBroken && brokenBadge && (
                                  <Badge
                                    data-testid="channel-card-broken-badge"
                                    className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50"
                                  >
                                    <Clock3 className="mr-1 h-3 w-3" />
                                    {brokenBadge}
                                  </Badge>
                                )}
                                {!connected && guideHref && card.action.type !== "disabled" && (
                                  <Badge className="border-zinc-200 bg-white text-zinc-700 hover:bg-white">
                                    <BookOpen className="mr-1 h-3 w-3" />
                                    {c.guidedSetup}
                                  </Badge>
                                )}
                                {card.action.type === "disabled" && (
                                  <Badge className="border-zinc-200 bg-zinc-100 text-zinc-600 hover:bg-zinc-100">
                                    <Clock3 className="mr-1 h-3 w-3" />
                                    {c.comingSoon}
                                  </Badge>
                                )}
                              </div>
                                <h3 className="text-xl font-semibold leading-tight text-zinc-950">
                                {card.title}
                              </h3>
                            </div>
                              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-xl font-black text-orange-600">
                              {card.logo}
                              </div>
                            </div>

                            <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-600">
                            {card.description}
                          </p>

                            <div className="mt-5 grid gap-3 rounded-xl border border-zinc-200 bg-white/82 p-3">
                              <div className="flex items-start gap-3">
                                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-600">
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{c.cardStatus}</p>
                            {connected ? (
                                    <div className="mt-1 min-w-0 space-y-1">
                                      <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-700">
                                        <span className={cn(
                                          "h-2 w-2 rounded-full",
                                          connectionBroken ? "bg-amber-400" : connected.isActive ? "bg-orange-400" : "bg-zinc-500"
                                        )} />
                                        <span className="min-w-0 break-words">{connected.configName}</span>
                                      </div>
                                      {connectionBroken && brokenStatus && (
                                        <p className="text-xs font-medium text-amber-700">{brokenStatus}</p>
                                      )}
                                    </div>
                            ) : (
                                    <p className="mt-1 text-sm text-zinc-700">{card.typeLabel || card.channelType || "custom"}</p>
                            )}
                                </div>
                              </div>
                              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
                                <span className="font-semibold text-zinc-800">{connectionLive ? c.cardVerify : c.cardNextStep}: </span>
                                {connectionLive
                                  ? c.cardConnectedHint
                                  : connectionBroken && brokenHint
                                    ? brokenHint
                                    : card.action.type === "disabled"
                                      ? c.cardRoadmapHint
                                      : c.cardNewHint}
                              </div>
                            </div>

                            <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-200 pt-4">
                              {connected && (connectionLive || !card.oauthStart) ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 flex-1 justify-center gap-2 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                                    onClick={() => editExistingChannel(connected)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    {c.configureConnected}
                                  </Button>
                                  {connected.channelType === "whatsapp" && connected.isActive && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-9 w-9 p-0 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                                      onClick={() => {
                                        setTestChannelId(connected.id)
                                        setTestPhone("")
                                        setTestTemplateName("hello_world")
                                        setTestLanguageCode("en_US")
                                        setTestResult(null)
                                      }}
                                      title={c.testAction}
                                    >
                                      <Send className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-9 w-9 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => {
                                      setDeleteId(connected.id)
                                      setDeleteName(connected.configName)
                                    }}
                                    title={c.delete}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : card.oauthStart ? (
                                <>
                                  {/* Plain same-origin navigation, exactly like the Social Monitoring
                                      connect tiles: the session cookie rides along, so no fetch or
                                      client state is needed to start the Meta dialog.
                                      Order matters: this branch now sits ABOVE the generic ones and
                                      the branch above it only claims LIVE connections, so a draft row
                                      (saved, but Meta never returned a Page) lands here and the way
                                      back into OAuth never disappears from the card. */}
                                  <Button
                                    asChild
                                    size="sm"
                                    className="h-9 flex-1 justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600"
                                  >
                                    <a href={card.oauthStart} aria-label={`${c.oauthConnect}: ${card.title}`}>
                                      <Plus className="h-4 w-4" />
                                      {c.oauthConnect}
                                    </a>
                                  </Button>
                                  {connected ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-9 w-9 p-0 text-zinc-600 hover:bg-zinc-50"
                                        onClick={() => editExistingChannel(connected)}
                                        title={c.configureConnected}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-9 w-9 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                                        onClick={() => {
                                          setDeleteId(connected.id)
                                          setDeleteName(connected.configName)
                                        }}
                                        title={c.delete}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <Button asChild size="sm" variant="ghost" className="h-9 shrink-0 px-2 text-xs text-zinc-600 hover:bg-zinc-50">
                                      <Link href={`/settings/channels/connect/${card.id}`}>{c.guidedSetup}</Link>
                                    </Button>
                                  )}
                                </>
                              ) : card.action.type === "link" ? (
                                <Button
                                  asChild
                                  size="sm"
                                  className="h-9 gap-2 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                                >
                                  <Link
                                    href={guideHref || card.action.href}
                                    aria-label={guideHref ? `${c.notConnected}: ${card.title}` : `${c.configure}: ${card.title}`}
                                  >
                                    {guideHref ? (
                                      <Plus className="h-4 w-4" />
                                    ) : (
                                      <Workflow className="h-4 w-4" />
                                    )}
                                    {guideHref ? c.notConnected : c.configure}
                                  </Link>
                                </Button>
                              ) : card.action.type === "disabled" ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled
                                  className="h-9 border border-zinc-200 bg-zinc-100 text-zinc-400"
                                >
                                  {c.comingSoon}
                                </Button>
                              ) : card.action.type === "guide" ? (
                                <Button
                                  asChild
                                  size="sm"
                                  className="h-9 flex-1 justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600"
                                >
                                  <Link href={`/settings/channels/connect/${card.id}`} aria-label={`${c.notConnected}: ${card.title}`}>
                                    <Plus className="h-4 w-4" />
                                    {c.notConnected}
                                  </Link>
                                </Button>
                              ) : (
                                <Button
                                  asChild
                                  size="sm"
                                  className="h-9 flex-1 justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600"
                                >
                                  <Link href={`/settings/channels/connect/${card.id}`} aria-label={`${c.notConnected}: ${card.title}`}>
                                    <Plus className="h-4 w-4" />
                                    {c.notConnected}
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              )
            })}
            {unmatchedChannels.length > 0 && (
              <section className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">{c.otherConnected}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{c.otherConnectedHint}</p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5">
                  {unmatchedChannels.map((channel) => {
                    // This list is where a Model B tenant's SECOND facebook row lands (the Meta-app
                    // config row with no pageId — the catalog card shows the delivering page row
                    // instead). It used to wear an unconditional "Connected" badge, i.e. the exact
                    // claim the card above had already stopped making about that same row.
                    const rowState = channelConnectionState(channel)
                    const rowBrokenBadge = cardBrokenBadge(c, rowState)
                    return (
                    <article
                      key={channel.id}
                      data-testid={`channel-row-${channel.id}`}
                      className="group relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_18px_60px_rgba(15,23,42,0.10)]"
                    >
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-500/10 via-zinc-50 to-transparent" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            {rowBrokenBadge ? (
                              <Badge
                                data-testid="channel-row-broken-badge"
                                className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50"
                              >
                                <Clock3 className="mr-1 h-3 w-3" />
                                {rowBrokenBadge}
                              </Badge>
                            ) : (
                              <Badge
                                data-testid="channel-row-connected-badge"
                                className="border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"
                              >
                                {c.connected}
                              </Badge>
                            )}
                            <Badge className="border-zinc-200 bg-zinc-100 text-zinc-600 hover:bg-zinc-100">
                              {channel.channelType}
                            </Badge>
                          </div>
                          <h3 className="line-clamp-2 text-xl font-semibold leading-tight text-zinc-950">
                            {channel.configName}
                          </h3>
                        </div>
                        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 shadow-inner">
                          <Webhook className="h-7 w-7" />
                        </div>
                      </div>
                      <div className="relative mt-4 flex items-center gap-2 text-sm text-zinc-600">
                        <span className={cn(
                          "h-2 w-2 rounded-full",
                          channel.isActive ? "bg-orange-400" : "bg-zinc-500"
                        )} />
                        <span className="min-w-0 break-words">{channelLabel(channel)}</span>
                      </div>
                      <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-zinc-200 pt-4">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-9 gap-2 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                          onClick={() => editExistingChannel(channel)}
                        >
                          <Pencil className="h-4 w-4" />
                          {c.edit}
                        </Button>
                        <div className="flex items-center gap-1">
                          {channel.channelType === "whatsapp" && channel.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 w-9 p-0 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                              onClick={() => {
                                setTestChannelId(channel.id)
                                setTestPhone("")
                                setTestTemplateName("hello_world")
                                setTestLanguageCode("en_US")
                                setTestResult(null)
                              }}
                              title={c.testAction}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 w-9 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                            onClick={() => {
                              setDeleteId(channel.id)
                              setDeleteName(channel.configName)
                            }}
                            title={c.delete}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </article>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
        </>
      )}

      <ChannelConfigForm
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open)
          if (!open) {
            setEditData(undefined)
            setLockFormChannelType(false)
          }
        }}
        onSaved={fetchChannels}
        initialData={editData}
        orgId={orgId}
        orgSlug={orgSlug}
        lockChannelType={lockFormChannelType}
        lockChannelTypeLabel={c.selectedChannel}
        lockChannelTypeHint={c.setupLockedHint}
        setupIntent={connectMode}
      />

      <Dialog
        open={tutorialOpen && Boolean(connectCard && connectTutorial)}
        onOpenChange={setTutorialOpen}
        widthClassName="max-w-4xl"
        maxHeightClassName="max-h-[92vh]"
      >
        <DialogContent className="force-light border-zinc-200 bg-white p-0 text-zinc-950">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {tutorialUi.title} — {connectCard?.title}
            </DialogTitle>
          </DialogHeader>
          {connectTutorial && connectCard && currentTutorialScene && (
            <div className="grid overflow-hidden rounded-3xl bg-white lg:grid-cols-[minmax(0,1.35fr)_320px]">
              <div className="bg-orange-50/70 p-5 text-zinc-950">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl border border-orange-200 bg-white text-orange-600">
                      <PlayCircle className="h-6 w-6" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-700">
                        {tutorialUi.title}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-zinc-950">{connectCard.title}</p>
                    </div>
                  </div>
                  <Badge className="border-orange-200 bg-white text-orange-700 hover:bg-white">
                    {connectTutorial.duration}
                  </Badge>
                </div>

                <div className="relative overflow-hidden rounded-[28px] border border-orange-200 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_30%),linear-gradient(135deg,#fff7ed_0%,#ffffff_54%,#f4f4f5_100%)] shadow-[0_24px_70px_rgba(249,115,22,0.14)]">
                  <div className="absolute left-5 right-5 top-5 flex items-center justify-between rounded-full border border-orange-100 bg-white/82 px-3 py-2 text-[11px] text-zinc-600 shadow-sm backdrop-blur">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-red-400" />
                      <span className="h-2 w-2 rounded-full bg-amber-300" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    <span>{tutorialUi.frame} {safeTutorialStepIndex + 1}/{tutorialSteps.length}</span>
                  </div>

                  <div className="grid min-h-[390px] place-items-center px-5 pb-8 pt-20 sm:min-h-[450px]">
                    <div className="w-full max-w-[620px] overflow-hidden rounded-[28px] border border-orange-100 bg-white text-zinc-950 shadow-[0_30px_80px_rgba(249,115,22,0.18)]">
                      <div className="border-b border-zinc-200 bg-zinc-100 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                          <div className="ml-2 min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500">
                            <span className="break-all">{currentTutorialScene.screenUrl}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-0 md:grid-cols-[minmax(0,1.12fr)_220px]">
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
                                {currentTutorialScene.provider}
                              </p>
                              <p className="mt-1 text-xl font-semibold leading-tight text-zinc-950">
                                {currentTutorialScene.screenTitle}
                              </p>
                            </div>
                            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-50 text-lg font-black text-orange-600 ring-1 ring-orange-200">
                              {connectCard.logo}
                            </div>
                          </div>

                          <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                              {tutorialUi.preview}
                            </p>
                            <p className="mt-2 text-base font-semibold leading-6 text-zinc-950">{currentTutorialStep}</p>
                            <p className="mt-2 text-sm leading-6 text-zinc-600">{connectTutorial.description}</p>
                          </div>

                          <div className="mt-5 grid gap-2 sm:grid-cols-2">
                            {currentTutorialScene.fields.map((field) => (
                              <div key={field} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{tutorialUi.fieldLabel}</p>
                                <p className="mt-1 break-words text-sm font-medium leading-5 text-zinc-800">{field}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-zinc-200 bg-zinc-50 p-5 md:border-l md:border-t-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{tutorialUi.leadDriveLabel}</p>
                          <p className="mt-2 text-sm font-semibold leading-5 text-zinc-950">{currentTutorialScene.leadDriveTitle}</p>
                          <div className="mt-4 space-y-2">
                            {currentTutorialScene.fields.slice(0, 3).map((field) => (
                              <div key={field} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-zinc-700 ring-1 ring-zinc-200">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                                <span className="min-w-0 break-words">{field}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div
                        className="h-2 overflow-hidden bg-zinc-200"
                        role="progressbar"
                        aria-label={`${tutorialUi.frame} ${safeTutorialStepIndex + 1}/${tutorialSteps.length}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(tutorialProgress)}
                      >
                        <div
                          className="h-full bg-orange-500 transition-[width] duration-500 motion-reduce:transition-none"
                          style={{ width: `${tutorialProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 gap-2 border border-orange-200 bg-white text-orange-700 hover:bg-orange-50"
                      onClick={() => setTutorialStepIndex((index) => (index === 0 ? Math.max(tutorialSteps.length - 1, 0) : index - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {tutorialUi.previous}
                    </Button>
                    <Button
                      type="button"
                      className="h-10 gap-2 bg-orange-500 text-white hover:bg-orange-600"
                      onClick={() => setTutorialPlaying((playing) => !playing)}
                    >
                      {tutorialPlaying ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                      {tutorialPlaying ? tutorialUi.pause : tutorialUi.play}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 gap-2 border border-orange-200 bg-white text-orange-700 hover:bg-orange-50"
                      onClick={() => setTutorialStepIndex((index) => (index + 1) % Math.max(tutorialSteps.length, 1))}
                    >
                      {tutorialUi.next}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 gap-2 text-zinc-600 hover:bg-orange-100 hover:text-zinc-950"
                    onClick={() => {
                      setTutorialStepIndex(0)
                      setTutorialPlaying(true)
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {tutorialUi.replay}
                  </Button>
                </div>
              </div>

              <aside className="border-l border-zinc-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
                    {tutorialUi.chapters}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{connectTutorial.description}</p>
                </div>
                <ol className="space-y-3">
                  {connectTutorial.steps.map((step, index) => {
                    const selected = safeTutorialStepIndex === index
                    return (
                      <li key={step}>
                        <button
                          type="button"
                          onClick={() => {
                            setTutorialStepIndex(index)
                            setTutorialPlaying(false)
                          }}
                          aria-current={selected ? "step" : undefined}
                          className={cn(
                            "flex w-full gap-3 rounded-2xl border p-3 text-left transition",
                            selected
                              ? "border-orange-300 bg-orange-50 text-orange-950 shadow-[0_0_0_1px_rgba(251,146,60,0.22)]"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-orange-200 hover:bg-zinc-50 hover:text-zinc-950"
                          )}
                        >
                          {selected ? (
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-bold text-white">
                              {index + 1}
                            </span>
                          ) : (
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600">
                              {index + 1}
                            </span>
                          )}
                          <span className="self-center text-sm leading-5">{step}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!testChannelId}
        onOpenChange={(open) => {
          if (!open) {
            setTestChannelId(null)
            setTestPhone("")
            setTestTemplateName("hello_world")
            setTestLanguageCode("en_US")
            setTestResult(null)
          }
        }}
        widthClassName="max-w-md"
      >
        <DialogContent className="force-light border-zinc-200 bg-white text-zinc-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{c.testMessage}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
              <p className="font-semibold">{c.testCaveatTitle}</p>
              <p className="mt-1 leading-5">{c.testCaveatBody}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700" htmlFor="whatsapp-test-phone">
                {c.recipientNumber}
              </label>
              <Input
                id="whatsapp-test-phone"
                value={testPhone}
                onChange={(event) => setTestPhone(event.target.value)}
                placeholder="+994501234567"
                className="border-zinc-200 bg-white text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-orange-500"
              />
              <p className="text-xs text-zinc-500">{c.phoneFormat}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_104px]">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700" htmlFor="whatsapp-test-template">
                  {c.templateName}
                </label>
                <Input
                  id="whatsapp-test-template"
                  value={testTemplateName}
                  onChange={(event) => setTestTemplateName(event.target.value)}
                  placeholder="hello_world"
                  className="border-zinc-200 bg-white font-mono text-sm text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-orange-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700" htmlFor="whatsapp-test-language">
                  {c.templateLanguage}
                </label>
                <Input
                  id="whatsapp-test-language"
                  value={testLanguageCode}
                  onChange={(event) => setTestLanguageCode(event.target.value)}
                  placeholder="en_US"
                  className="border-zinc-200 bg-white font-mono text-sm text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-orange-500"
                />
              </div>
            </div>
            <p className="text-xs leading-5 text-zinc-500">{c.templateHint}</p>
            {testResult && (
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  testResult.success
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-700"
                )}
              >
                {testResult.message}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setTestChannelId(null)}
              className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            >
              {c.cancel}
            </Button>
            <Button onClick={sendTestWhatsApp} disabled={testSending || !testPhone} className="bg-orange-500 text-white hover:bg-orange-600">
              {testSending ? c.sending : c.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title="Delete Channel"
        itemName={deleteName}
      />
    </div>
  )
}
