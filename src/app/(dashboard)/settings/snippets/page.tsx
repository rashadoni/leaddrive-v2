"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { AlertTriangle, Bot, CheckCircle2, Copy, Eye, Hash, Loader2, Mail, MousePointerClick, Pencil, Plus, RotateCcw, Sparkles, Trash2, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { SUPPORTED_SNIPPET_VARS } from "@/lib/inbox/snippet-vars"
import { REPLY_CHANNELS, ChannelIcon, channelColor, channelLabel } from "@/lib/inbox-channels"
import { readJsonSafely } from "@/lib/http/read-json-safely"

interface Snippet {
  id: string
  shortcut: string
  title: string
  body: string
  channelTypes: string[]
  isActive: boolean
  usageCount: number
  sortOrder: number
}

const CHANNELS = REPLY_CHANNELS

const VAR_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

type Loc = "en" | "ru" | "az"

type ApiEnvelope<T> = {
  success?: boolean
  data?: T
  error?: string
}

const VARIABLE_CATALOG = [
  {
    token: "{{contact.name}}",
    icon: UserRound,
    label: { en: "Customer name", ru: "Имя клиента", az: "Müştəri adı" },
    description: { en: "Full contact name from the open conversation.", ru: "Полное имя контакта из открытого диалога.", az: "Açıq dialoqdakı kontaktın tam adı." },
    sample: { en: "Anna Karimova", ru: "Анна Каримова", az: "Aysel Məmmədova" },
  },
  {
    token: "{{contact.first_name}}",
    icon: UserRound,
    label: { en: "First name", ru: "Только имя", az: "Yalnız ad" },
    description: { en: "First word of the contact name, useful for short greetings.", ru: "Первое слово из имени клиента — удобно для короткого приветствия.", az: "Qısa salamlaşma üçün kontakt adının ilk sözü." },
    sample: { en: "Anna", ru: "Анна", az: "Aysel" },
  },
  {
    token: "{{contact.email}}",
    icon: Mail,
    label: { en: "Customer email", ru: "Email клиента", az: "Müştəri emaili" },
    description: { en: "Email saved on the contact, when available.", ru: "Email из карточки контакта, если он заполнен.", az: "Kontakt kartında varsa email ünvanı." },
    sample: { en: "anna@example.com", ru: "anna@example.com", az: "aysel@example.com" },
  },
  {
    token: "{{agent.name}}",
    icon: Bot,
    label: { en: "Agent name", ru: "Имя агента", az: "Agent adı" },
    description: { en: "Name of the teammate inserting the snippet.", ru: "Имя сотрудника, который вставляет сниппет.", az: "Snippet-i daxil edən komanda üzvünün adı." },
    sample: { en: "LeadDrive Agent", ru: "Мария из LeadDrive", az: "LeadDrive agenti" },
  },
] as const

const advertisedVariableTokens = new Set<string>(SUPPORTED_SNIPPET_VARS)
const ADVERTISED_VARIABLES = VARIABLE_CATALOG.filter((variable) => advertisedVariableTokens.has(variable.token))

type SnippetTemplate = {
  key: string
  shortcut: string
  channelTypes: string[]
  title: Record<Loc, string>
  description: Record<Loc, string>
  body: Record<Loc, string>
}

const SNIPPET_TEMPLATES: SnippetTemplate[] = [
  {
    key: "greeting",
    shortcut: "hello",
    channelTypes: [],
    title: { en: "Warm greeting", ru: "Тёплое приветствие", az: "Səmimi salamlaşma" },
    description: {
      en: "First answer for any inbox conversation.",
      ru: "Первый ответ для любого входящего диалога.",
      az: "İstənilən gələn dialoq üçün ilk cavab.",
    },
    body: {
      en: "Hi {{contact.first_name}}, this is {{agent.name}} from LeadDrive. How can I help you today?",
      ru: "Здравствуйте, {{contact.first_name}}! Меня зовут {{agent.name}}. Чем могу помочь?",
      az: "Salam, {{contact.first_name}}! Mən {{agent.name}}. Sizə necə kömək edə bilərəm?",
    },
  },
  {
    key: "price",
    shortcut: "price",
    channelTypes: [],
    title: { en: "Price request", ru: "Запрос цены", az: "Qiymət sorğusu" },
    description: {
      en: "Ask for the missing detail before quoting.",
      ru: "Уточнить деталь перед отправкой цены.",
      az: "Qiyməti göndərməzdən əvvəl detalı dəqiqləşdirin.",
    },
    body: {
      en: "{{contact.first_name}}, please tell me which product or service you are interested in, and I will send the current price.",
      ru: "{{contact.first_name}}, уточните, пожалуйста, какой товар или услуга вас интересует, и я сразу отправлю актуальную цену.",
      az: "{{contact.first_name}}, zəhmət olmasa hansı məhsul və ya xidmətlə maraqlandığınızı yazın, aktual qiyməti göndərim.",
    },
  },
  {
    key: "followup",
    shortcut: "followup",
    channelTypes: [],
    title: { en: "Follow-up", ru: "Повторный контакт", az: "Təkrar əlaqə" },
    description: {
      en: "Bring a paused conversation back without sounding pushy.",
      ru: "Вернуть диалог без давления на клиента.",
      az: "Dayanmış dialoqu təzyiqsiz yenidən açın.",
    },
    body: {
      en: "{{contact.first_name}}, I am following up on your request. Is it still relevant for you?",
      ru: "{{contact.first_name}}, возвращаюсь к вашему запросу. Актуально ли ещё обсудить детали?",
      az: "{{contact.first_name}}, sorğunuzla bağlı yenidən yazıram. Hələ aktualdır?",
    },
  },
  {
    key: "callback",
    shortcut: "callback",
    channelTypes: ["sms", "whatsapp", "telegram"],
    title: { en: "Callback request", ru: "Запрос звонка", az: "Zəng sorğusu" },
    description: {
      en: "Short mobile-friendly message for SMS and messengers.",
      ru: "Короткий текст для SMS и мессенджеров.",
      az: "SMS və messencerlər üçün qısa mətn.",
    },
    body: {
      en: "{{contact.first_name}}, can we call you? Please send a convenient time and {{agent.name}} will contact you.",
      ru: "{{contact.first_name}}, можем созвониться? Напишите удобное время, и {{agent.name}} свяжется с вами.",
      az: "{{contact.first_name}}, sizə zəng edə bilərik? Rahat vaxtı yazın, {{agent.name}} əlaqə saxlayacaq.",
    },
  },
  {
    key: "tiktok",
    shortcut: "tiktok",
    channelTypes: ["tiktok"],
    title: { en: "TikTok via Chatwoot", ru: "TikTok через Chatwoot", az: "Chatwoot vasitəsilə TikTok" },
    description: {
      en: "Short handoff wording for TikTok DM conversations.",
      ru: "Короткий ответ для TikTok DM через Chatwoot.",
      az: "Chatwoot üzərindən TikTok DM üçün qısa cavab.",
    },
    body: {
      en: "Hi {{contact.first_name}}, thanks for your TikTok message. I am checking the details and will reply here shortly.",
      ru: "{{contact.first_name}}, спасибо за сообщение в TikTok. Я проверю детали и отвечу здесь в ближайшее время.",
      az: "{{contact.first_name}}, TikTok mesajınız üçün təşəkkürlər. Detalları yoxlayıb az sonra burada cavab verəcəyəm.",
    },
  },
  {
    key: "email",
    shortcut: "emailinfo",
    channelTypes: ["email"],
    title: { en: "Email details sent", ru: "Детали отправлены на email", az: "Detallar emailə göndərildi" },
    description: {
      en: "Confirm that the client received a longer answer by email.",
      ru: "Подтвердить, что подробности ушли на email.",
      az: "Ətraflı cavabın emailə göndərildiyini təsdiqləyin.",
    },
    body: {
      en: "Hello {{contact.name}}, I sent the details to {{contact.email}}. If needed, I can also duplicate them here.",
      ru: "Здравствуйте, {{contact.name}}! Отправил(а) детали на {{contact.email}}. Если нужно, продублирую их здесь.",
      az: "Salam, {{contact.name}}! Detalları {{contact.email}} ünvanına göndərdim. Lazımdırsa, burada da təkrar yaza bilərəm.",
    },
  },
]

function normalizeVariableKey(raw: string): string {
  return raw.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "").trim().toLowerCase()
}

function variableSample(key: string, locale: Loc): string | null {
  const normalizedKey = key === "contact.firstname" ? "contact.first_name" : key
  const variable = VARIABLE_CATALOG.find((item) => normalizeVariableKey(item.token) === normalizedKey)
  return variable?.sample[locale] ?? variable?.sample.en ?? null
}

const KNOWN_VARIABLE_KEYS = new Set([
  ...SUPPORTED_SNIPPET_VARS.map((token) => normalizeVariableKey(token)),
  "contact.firstname",
])

function extractUnknownVariables(body: string): string[] {
  const unknown = new Set<string>()
  for (const match of body.matchAll(VAR_TOKEN_RE)) {
    const key = normalizeVariableKey(match[1] ?? "")
    if (key && !KNOWN_VARIABLE_KEYS.has(key)) unknown.add(`{{${key}}}`)
  }
  return Array.from(unknown)
}

function extractVariableTokens(body: string): string[] {
  const tokens = new Set<string>()
  for (const match of body.matchAll(VAR_TOKEN_RE)) {
    const key = normalizeVariableKey(match[1] ?? "")
    if (key) tokens.add(`{{${key}}}`)
  }
  return Array.from(tokens)
}

function renderSnippetPreview(body: string, locale: Loc): string {
  return body.replace(VAR_TOKEN_RE, (match, rawKey: string) => {
    return variableSample(normalizeVariableKey(rawKey), locale) ?? match
  })
}

const L: Record<string, Record<Loc, string>> = {
  heading: { en: "Message snippets", ru: "Сниппеты сообщений", az: "Mesaj snippetləri" },
  sub: {
    en: 'Saved replies the team inserts in the inbox by typing "/shortcut". Add variables from the picker so agents do not type tokens by hand.',
    ru: 'Сохранённые ответы, которые команда вставляет в инбоксе через "/ярлык". Переменные теперь выбираются кнопками — их не нужно писать вручную.',
    az: 'Komandanın inbox-da "/qısayol" ilə daxil etdiyi hazır cavablar. Dəyişənləri düymələrdən seçin — tokenləri əl ilə yazmaq lazım deyil.',
  },
  newOne: { en: "New snippet", ru: "Новый сниппет", az: "Yeni snippet" },
  templatesHeading: { en: "Start from a ready scenario", ru: "Начните с готового сценария", az: "Hazır ssenari ilə başlayın" },
  templatesSub: {
    en: "Pick a common reply and LeadDrive will fill the form with the right variables and channel limits. You can edit everything before saving.",
    ru: "Выберите частый ответ — LeadDrive заполнит форму правильными переменными и ограничениями каналов. Перед сохранением всё можно изменить.",
    az: "Tez istifadə olunan cavabı seçin — LeadDrive formanı uyğun dəyişənlər və kanal məhdudiyyətləri ilə dolduracaq. Saxlamazdan əvvəl hər şeyi dəyişə bilərsiniz.",
  },
  useTemplate: { en: "Use template", ru: "Использовать", az: "İstifadə et" },
  availableVariables: { en: "Available variables", ru: "Доступные переменные", az: "Mövcud dəyişənlər" },
  exampleValue: { en: "Example", ru: "Пример", az: "Nümunə" },
  variableWillBecome: { en: "becomes", ru: "станет", az: "olacaq" },
  copyVariable: { en: "Copy", ru: "Копировать", az: "Kopyala" },
  copiedVariable: { en: "Copied", ru: "Скопировано", az: "Kopyalandı" },
  copiedVariableHint: {
    en: "Variable copied. Paste it into the message text or use the picker inside the form.",
    ru: "Переменная скопирована. Вставьте её в текст или используйте выбор справа в форме.",
    az: "Dəyişən kopyalandı. Onu mətnə yapışdırın və ya formanın sağ panelindən seçin.",
  },
  copyVariableFailed: {
    en: "Browser blocked automatic copy. The token is still visible here; select it manually or click “Use in snippet”.",
    ru: "Браузер заблокировал автокопирование. Токен виден здесь — выделите его вручную или нажмите «В новый текст».",
    az: "Brauzer avtomatik kopyalamanı blokladı. Token burada görünür — onu əl ilə seçin və ya “Snippet-də istifadə et” düyməsini basın.",
  },
  useVariableInSnippet: { en: "Use in snippet", ru: "В новый текст", az: "Snippet-də istifadə et" },
  appliesTo: { en: "Applies to", ru: "Каналы", az: "Kanallar" },
  selectedChannels: { en: "selected", ru: "выбрано", az: "seçildi" },
  guideShortcut: { en: "1. Name the shortcut", ru: "1. Назовите ярлык", az: "1. Qısayolu adlandırın" },
  guideShortcutDesc: { en: 'Agents type it after "/".', ru: 'Агент вводит его после "/".', az: 'Agent onu "/" işarəsindən sonra yazır.' },
  guideText: { en: "2. Compose the reply", ru: "2. Соберите текст", az: "2. Cavabı hazırlayın" },
  guideTextDesc: { en: "Insert variables with buttons.", ru: "Вставляйте переменные кнопками.", az: "Dəyişənləri düymələrlə daxil edin." },
  guideCheck: { en: "3. Check preview", ru: "3. Проверьте пример", az: "3. Önizləməni yoxlayın" },
  guideCheckDesc: { en: "Unknown tokens block saving.", ru: "Ошибочные токены блокируют сохранение.", az: "Yanlış tokenlər saxlamanı bloklayır." },
  empty: { en: "No snippets yet. Create the first one.", ru: "Сниппетов пока нет. Создайте первый.", az: "Hələ snippet yoxdur. İlkini yaradın." },
  emptyHint: {
    en: 'Start with a greeting, pricing answer, or delivery update. Agents can insert it from the inbox with "/shortcut".',
    ru: 'Начните с приветствия, ответа по цене или статуса доставки. Агент вставит текст в инбоксе через "/ярлык".',
    az: 'Salamlama, qiymət cavabı və ya çatdırılma statusu ilə başlayın. Agent inbox-da "/qısayol" ilə daxil edəcək.',
  },
  shortcut: { en: "Shortcut", ru: "Ярлык", az: "Qısayol" },
  title: { en: "Title", ru: "Название", az: "Başlıq" },
  titleHint: {
    en: "Internal name for the team. Customers do not see it.",
    ru: "Внутреннее название для команды. Клиенты его не видят.",
    az: "Komanda üçün daxili ad. Müştərilər bunu görmür.",
  },
  body: { en: "Message", ru: "Текст", az: "Mətn" },
  bodyHint: {
    en: "Place the cursor where the data should appear, then click a variable on the right.",
    ru: "Поставьте курсор туда, где должны появиться данные, и нажмите нужную переменную справа.",
    az: "Məlumatın görünəcəyi yerə kursoru qoyun və sağdan dəyişəni seçin.",
  },
  channels: { en: "Channels (empty = all)", ru: "Каналы (пусто = все)", az: "Kanallar (boş = hamısı)" },
  channelsHint: {
    en: "Leave empty if the snippet is safe for every channel. Pick channels when wording must stay channel-specific.",
    ru: "Оставьте пустым, если текст подходит всем каналам. Выберите каналы, если формулировка нужна только там.",
    az: "Mətn bütün kanallara uyğundursa boş saxlayın. Yalnız konkret kanal üçündürsə kanalları seçin.",
  },
  active: { en: "Active", ru: "Активен", az: "Aktiv" },
  activeHint: {
    en: "Inactive snippets stay saved but are hidden from agents in the inbox.",
    ru: "Выключенные сниппеты сохраняются, но не показываются агентам в инбоксе.",
    az: "Deaktiv snippetlər saxlanılır, amma agentlərə inbox-da göstərilmir.",
  },
  save: { en: "Save", ru: "Сохранить", az: "Saxla" },
  cancel: { en: "Cancel", ru: "Отмена", az: "Ləğv et" },
  edit: { en: "Edit", ru: "Изменить", az: "Düzəliş" },
  del: { en: "Delete", ru: "Удалить", az: "Sil" },
  delConfirm: { en: "Delete this snippet?", ru: "Удалить этот сниппет?", az: "Bu snippet silinsin?" },
  used: { en: "used", ru: "исп.", az: "istifadə" },
  inactive: { en: "inactive", ru: "выключен", az: "deaktiv" },
  shortcutHint: { en: "one token, no spaces or /", ru: "одно слово, без пробелов и /", az: "bir söz, boşluqsuz və /" },
  dupErr: { en: "A snippet with this shortcut already exists", ru: "Сниппет с таким ярлыком уже есть", az: "Bu qısayolla snippet artıq var" },
  composer: { en: "Snippet text", ru: "Текст сниппета", az: "Snippet mətni" },
  variables: { en: "Variables", ru: "Переменные", az: "Dəyişənlər" },
  variablesDesc: {
    en: "Do not type tokens manually. Click a variable and LeadDrive will insert it at the cursor.",
    ru: "Не вводите токены вручную. Нажмите переменную — LeadDrive вставит её в место курсора.",
    az: "Tokenləri əl ilə yazmayın. Dəyişəni seçin — LeadDrive onu kursor yerinə daxil edəcək.",
  },
  clickToInsert: { en: "Click to insert", ru: "Нажмите, чтобы вставить", az: "Daxil etmək üçün basın" },
  preview: { en: "Live preview", ru: "Живой предпросмотр", az: "Canlı önizləmə" },
  previewDesc: {
    en: "This is an example of what the agent will see before sending. Missing contact data becomes blank.",
    ru: "Такой пример агент увидит перед отправкой. Если данных в контакте нет, поле станет пустым.",
    az: "Agent göndərmədən əvvəl bunu nümunə kimi görəcək. Kontakt məlumatı yoxdursa, sahə boş qalacaq.",
  },
  previewEmpty: {
    en: "Start typing a reply or insert a variable to see the preview.",
    ru: "Начните писать ответ или вставьте переменную, чтобы увидеть предпросмотр.",
    az: "Önizləmə üçün cavab yazın və ya dəyişən daxil edin.",
  },
  unknownVariables: { en: "Unknown variable", ru: "Неизвестная переменная", az: "Naməlum dəyişən" },
  unknownVariablesHint: {
    en: "LeadDrive will not replace this token. Remove it or pick a supported variable from the panel.",
    ru: "LeadDrive не сможет заменить этот токен. Удалите его или выберите переменную из панели.",
    az: "LeadDrive bu tokeni əvəz etməyəcək. Silin və ya paneldən dəstəklənən dəyişən seçin.",
  },
  variablesOk: { en: "Variables are valid", ru: "Переменные корректны", az: "Dəyişənlər düzgündür" },
  noVariables: { en: "No variables yet", ru: "Пока без переменных", az: "Hələ dəyişən yoxdur" },
  allChannels: { en: "All channels", ru: "Все каналы", az: "Bütün kanallar" },
  saveBlocked: { en: "Fix the unknown variable to save", ru: "Исправьте неизвестную переменную, чтобы сохранить", az: "Saxlamaq üçün naməlum dəyişəni düzəldin" },
  createExamples: { en: "Create examples", ru: "Создать примеры", az: "Nümunələr yarat" },
  creatingExamples: { en: "Creating…", ru: "Создаю…", az: "Yaradılır…" },
  examplesReady: { en: "Example snippets are ready for testing.", ru: "Примерные сниппеты готовы для теста.", az: "Nümunə snippetlər test üçün hazırdır." },
  examplesAllExist: { en: "All example snippets already exist.", ru: "Все примерные сниппеты уже есть.", az: "Bütün nümunə snippetlər artıq var." },
  examplesFailed: { en: "Could not create examples. Try again.", ru: "Не удалось создать примеры. Попробуйте ещё раз.", az: "Nümunələri yaratmaq mümkün olmadı. Yenidən cəhd edin." },
  listHeading: { en: "Saved snippets", ru: "Сохранённые сниппеты", az: "Saxlanmış snippetlər" },
  listSub: {
    en: "Search by shortcut, title, message text, or variable. Preview shows what the agent sees before sending.",
    ru: "Ищите по ярлыку, названию, тексту или переменной. Preview показывает, что агент увидит перед отправкой.",
    az: "Qısayol, başlıq, mətn və ya dəyişən üzrə axtarın. Önizləmə agentin göndərmədən əvvəl gördüyünü göstərir.",
  },
  searchPlaceholder: { en: "Search snippets or variables…", ru: "Поиск сниппетов или переменных…", az: "Snippet və ya dəyişən axtar…" },
  showAll: { en: "All", ru: "Все", az: "Hamısı" },
  showActive: { en: "Active", ru: "Активные", az: "Aktiv" },
  showInactive: { en: "Inactive", ru: "Выключенные", az: "Deaktiv" },
  filteredEmpty: {
    en: "Nothing matches these filters. Clear search or choose another channel.",
    ru: "По этим фильтрам ничего нет. Очистите поиск или выберите другой канал.",
    az: "Bu filtrlərə uyğun nəticə yoxdur. Axtarışı təmizləyin və ya başqa kanal seçin.",
  },
  clearFilters: { en: "Clear filters", ru: "Сбросить фильтры", az: "Filtrləri sıfırla" },
  createFromBlank: { en: "Create blank snippet", ru: "Создать пустой сниппет", az: "Boş snippet yarat" },
  previewLabel: { en: "Preview", ru: "Предпросмотр", az: "Önizləmə" },
  rawLabel: { en: "Template text", ru: "Шаблон", az: "Şablon mətni" },
  variablesFound: { en: "Variables used", ru: "Используются переменные", az: "İstifadə olunan dəyişənlər" },
  invalidSnippet: { en: "Needs variable fix", ru: "Нужно исправить переменную", az: "Dəyişən düzəldilməlidir" },
  shortcutInvalid: { en: "Shortcut must be one word without spaces or /", ru: "Ярлык должен быть одним словом без пробелов и /", az: "Qısayol boşluqsuz və / olmadan bir söz olmalıdır" },
  missingRequired: { en: "Fill shortcut, title, and message", ru: "Заполните ярлык, название и текст", az: "Qısayol, başlıq və mətni doldurun" },
  readyToSave: { en: "Ready to save", ru: "Можно сохранить", az: "Saxlamağa hazırdır" },
}

const emptyForm = { shortcut: "", title: "", body: "", channelTypes: [] as string[], isActive: true }

export default function SnippetsPage() {
  const locale = (useLocale() as Loc) || "en"
  const tr = useCallback((k: string) => L[k]?.[locale] ?? L[k]?.en ?? k, [locale])
  useAutoTour("messageSnippets")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers = useMemo<Record<string, string>>(
    () => {
      const nextHeaders: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) nextHeaders["x-organization-id"] = String(orgId)
      return nextHeaders
    },
    [orgId],
  )

  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [bulkCreating, setBulkCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [listChannelFilter, setListChannelFilter] = useState("all")
  const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const load = useCallback(() => {
    if (!orgId) return
    setLoading(true)
    fetch("/api/v1/message-snippets?includeInactive=1", { headers })
      .then((r) => readJsonSafely<ApiEnvelope<Snippet[]>>(r))
      .then((j) => setSnippets(j?.success && Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId, headers])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditingId(null); setForm(emptyForm); setError(null); setNotice(null); setOpen(true) }
  const openTemplate = (template: SnippetTemplate) => {
    setEditingId(null)
    setForm({
      shortcut: template.shortcut,
      title: template.title[locale] ?? template.title.en,
      body: template.body[locale] ?? template.body.en,
      channelTypes: [...template.channelTypes],
      isActive: true,
    })
    setError(null)
    setNotice(null)
    setOpen(true)
  }
  const openWithVariable = (token: string) => {
    setEditingId(null)
    setForm({ ...emptyForm, body: token })
    setError(null)
    setNotice(null)
    setOpen(true)
    window.requestAnimationFrame(() => bodyRef.current?.focus())
  }
  const openEdit = (s: Snippet) => {
    setEditingId(s.id)
    setForm({ shortcut: s.shortcut, title: s.title, body: s.body, channelTypes: s.channelTypes ?? [], isActive: s.isActive })
    setError(null)
    setNotice(null)
    setOpen(true)
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const url = editingId ? `/api/v1/message-snippets/${editingId}` : "/api/v1/message-snippets"
      const res = await fetch(url, { method: editingId ? "PUT" : "POST", headers, body: JSON.stringify(form) })
      if (res.ok) {
        setOpen(false)
        load()
      } else {
        const j = await readJsonSafely<ApiEnvelope<unknown>>(res)
        setError(res.status === 409 ? tr("dupErr") : j?.error || "Error")
      }
    } catch {
      setError("Error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm(tr("delConfirm"))) return
    await fetch(`/api/v1/message-snippets/${id}`, { method: "DELETE", headers }).catch(() => {})
    load()
  }

  const toggleChannel = (ch: string) =>
    setForm((f) => ({ ...f, channelTypes: f.channelTypes.includes(ch) ? f.channelTypes.filter((c) => c !== ch) : [...f.channelTypes, ch] }))

  const unknownVariables = useMemo(() => extractUnknownVariables(form.body), [form.body])
  const previewBody = useMemo(() => renderSnippetPreview(form.body, locale), [form.body, locale])
  const insertedVariables = useMemo(() => extractVariableTokens(form.body), [form.body])
  const channelSummary = form.channelTypes.length > 0 ? form.channelTypes.map(channelLabel).join(", ") : tr("allChannels")
  const smsRelevant = form.channelTypes.length === 0 || form.channelTypes.includes("sms")
  const smsChars = form.body.length
  const smsSegments = smsChars === 0 ? 0 : Math.ceil(smsChars / 160)
  const guideSteps = useMemo(
    () => [
      { title: tr("guideShortcut"), description: tr("guideShortcutDesc") },
      { title: tr("guideText"), description: tr("guideTextDesc") },
      { title: tr("guideCheck"), description: tr("guideCheckDesc") },
    ],
    [tr],
  )
  const filteredSnippets = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return snippets.filter((snippet) => {
      if (statusFilter === "active" && !snippet.isActive) return false
      if (statusFilter === "inactive" && snippet.isActive) return false
      const channels = snippet.channelTypes ?? []
      if (listChannelFilter !== "all" && channels.length > 0 && !channels.includes(listChannelFilter)) return false
      if (!needle) return true
      const tokens = extractVariableTokens(snippet.body).join(" ")
      return [
        snippet.shortcut,
        snippet.title,
        snippet.body,
        tokens,
        channels.map(channelLabel).join(" "),
      ].join(" ").toLowerCase().includes(needle)
    })
  }, [listChannelFilter, query, snippets, statusFilter])

  const hasActiveListFilters = Boolean(query.trim()) || statusFilter !== "all" || listChannelFilter !== "all"

  const clearSnippetFilters = () => {
    setQuery("")
    setStatusFilter("all")
    setListChannelFilter("all")
  }

  const copyVariableWithFallback = async (token: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(token)
        return true
      } catch {
        // Fall back to the legacy copy path below. Some embedded browsers expose
        // navigator.clipboard but reject writes from automated or constrained contexts.
      }
    }

    const textarea = document.createElement("textarea")
    textarea.value = token
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  }

  const copyVariableToken = async (token: string) => {
    try {
      const copied = await copyVariableWithFallback(token)
      if (!copied) throw new Error("copy-failed")
      setCopiedVariableToken(token)
      setNotice(tr("copiedVariableHint"))
      window.setTimeout(() => setCopiedVariableToken((current) => (current === token ? null : current)), 1800)
    } catch {
      setCopiedVariableToken(null)
      setNotice(tr("copyVariableFailed"))
    }
  }

  const insertVariable = (token: string) => {
    const textarea = bodyRef.current
    setForm((f) => {
      const body = f.body ?? ""
      const start = textarea?.selectionStart ?? body.length
      const end = textarea?.selectionEnd ?? body.length
      const before = body.slice(0, start)
      const after = body.slice(end)
      const prefix = before && !/\s$/.test(before) ? " " : ""
      const suffix = after && !/^\s/.test(after) ? " " : ""
      const insertion = `${prefix}${token}${suffix}`
      const nextBody = `${before}${insertion}${after}`
      const caret = before.length + insertion.length
      window.requestAnimationFrame(() => {
        bodyRef.current?.focus()
        bodyRef.current?.setSelectionRange(caret, caret)
      })
      return { ...f, body: nextBody }
    })
  }

  const shortcutInvalid = Boolean(form.shortcut.trim()) && /[\s/]/.test(form.shortcut)
  const requiredMissing = !form.shortcut.trim() || !form.title.trim() || !form.body.trim()
  const canSave = !requiredMissing && !shortcutInvalid && unknownVariables.length === 0
  const saveReadinessText = shortcutInvalid
    ? tr("shortcutInvalid")
    : requiredMissing
      ? tr("missingRequired")
      : unknownVariables.length > 0
        ? tr("saveBlocked")
        : tr("readyToSave")

  const createExampleSnippets = async () => {
    if (!orgId || bulkCreating) return
    setBulkCreating(true)
    setError(null)
    setNotice(null)
    try {
      let created = 0
      for (const template of SNIPPET_TEMPLATES) {
        const res = await fetch("/api/v1/message-snippets", {
          method: "POST",
          headers,
          body: JSON.stringify({
            shortcut: template.shortcut,
            title: template.title[locale] ?? template.title.en,
            body: template.body[locale] ?? template.body.en,
            channelTypes: template.channelTypes,
            isActive: true,
          }),
        })
        if (res.ok) created += 1
        if (!res.ok && res.status !== 409) throw new Error("create-example-failed")
      }
      setNotice(created > 0 ? tr("examplesReady") : tr("examplesAllExist"))
      load()
    } catch {
      setError(tr("examplesFailed"))
    } finally {
      setBulkCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" data-tour-id="snippets-header">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <Hash className="h-5 w-5 shrink-0" /> {tr("heading")}
            <span className="inline-flex flex-wrap items-center gap-2">
              <HelpButton slug="message-snippets" variant="label" />
              <TourReplayButton tourId="messageSnippets" />
            </span>
          </h1>
          <PageDescription text={tr("sub")} />
        </div>
        <Button onClick={openNew} className="w-full shrink-0 justify-center sm:w-auto" data-tour-id="snippets-new">
          <Plus className="mr-1 h-4 w-4 shrink-0" /> {tr("newOne")}
        </Button>
      </div>

      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-tour-id="snippets-templates">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> {tr("templatesHeading")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{tr("templatesSub")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:min-w-[310px]">
            <Button variant="outline" onClick={createExampleSnippets} disabled={bulkCreating || !orgId} className="justify-center">
              {bulkCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {bulkCreating ? tr("creatingExamples") : tr("createExamples")}
            </Button>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{tr("availableVariables")}</p>
              <div className="grid gap-2">
                {ADVERTISED_VARIABLES.map((variable) => (
                  <div key={variable.token} className="rounded-lg border bg-background/80 p-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">{variable.label[locale]}</span>
                        <code className="mt-1 block break-all rounded-md bg-muted px-1.5 py-1 font-mono text-[10px] text-primary">{variable.token}</code>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {tr("exampleValue")}: <span className="font-medium text-foreground">{variable.sample[locale]}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyVariableToken(variable.token)}
                        className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-full border bg-card px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        aria-label={`${tr("copyVariable")} ${variable.token}`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedVariableToken === variable.token ? tr("copiedVariable") : tr("copyVariable")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openWithVariable(variable.token)}
                        className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        aria-label={`${tr("useVariableInSnippet")} ${variable.token}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{tr("useVariableInSnippet")}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {(notice || error) && (
          <div
            className={cn(
              "mt-4 rounded-xl border p-3 text-sm",
              error ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-emerald-200 bg-emerald-50 text-emerald-800",
            )}
          >
            {error ?? notice}
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SNIPPET_TEMPLATES.map((template) => {
            const channels = template.channelTypes.length > 0 ? template.channelTypes : []
            const templateBody = template.body[locale] ?? template.body.en
            return (
              <article key={template.key} className="flex min-h-[178px] flex-col rounded-xl border bg-background p-4 transition-colors hover:border-primary/35 hover:bg-primary/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-primary">/{template.shortcut}</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {template.channelTypes.length > 0 ? `${template.channelTypes.length} ${tr("selectedChannels")}` : tr("allChannels")}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold leading-snug">{template.title[locale] ?? template.title.en}</h3>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => openTemplate(template)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> {tr("useTemplate")}
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{template.description[locale] ?? template.description.en}</p>
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg border bg-emerald-50/60 p-2">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700">{tr("previewLabel")}</p>
                    <p className="line-clamp-2 text-xs leading-relaxed text-emerald-950">{renderSnippetPreview(templateBody, locale)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{tr("rawLabel")}</p>
                    <p className="line-clamp-2 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{templateBody}</p>
                  </div>
                </div>
                <div className="mt-auto pt-3">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{tr("appliesTo")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {channels.length > 0 ? (
                      channels.map((ch) => (
                        <span key={ch} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium", channelColor(ch))}>
                          <ChannelIcon channel={ch} className="h-3 w-3" /> {channelLabel(ch)}
                        </span>
                      ))
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">{tr("allChannels")}</Badge>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : snippets.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-muted-foreground sm:p-10" data-tour-id="snippets-list">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3 font-medium text-foreground">{tr("empty")}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm">{tr("emptyHint")}</p>
          <Button onClick={createExampleSnippets} disabled={bulkCreating || !orgId} className="mt-5">
            {bulkCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {bulkCreating ? tr("creatingExamples") : tr("createExamples")}
          </Button>
        </div>
      ) : (
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" data-tour-id="snippets-list">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold">{tr("listHeading")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{tr("listSub")}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto] lg:min-w-[620px]">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("searchPlaceholder")} />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="all">{tr("showAll")}</option>
                <option value="active">{tr("showActive")}</option>
                <option value="inactive">{tr("showInactive")}</option>
              </select>
              <select
                value={listChannelFilter}
                onChange={(event) => setListChannelFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="all">{tr("allChannels")}</option>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>{channelLabel(channel)}</option>
                ))}
              </select>
            </div>
          </div>

          {filteredSnippets.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              <p>{tr("filteredEmpty")}</p>
              <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                {hasActiveListFilters && (
                  <Button type="button" variant="outline" onClick={clearSnippetFilters} className="justify-center">
                    <RotateCcw className="mr-2 h-4 w-4" /> {tr("clearFilters")}
                  </Button>
                )}
                <Button type="button" onClick={openNew} className="justify-center">
                  <Plus className="mr-2 h-4 w-4" /> {tr("createFromBlank")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredSnippets.map((s) => {
                const snippetTokens = extractVariableTokens(s.body)
                const snippetUnknownVariables = extractUnknownVariables(s.body)
                const snippetChannels = s.channelTypes ?? []
                const appliesEverywhere = snippetChannels.length === 0
                return (
                  <article
                    key={s.id}
                    className={cn(
                      "rounded-2xl border bg-background p-4 transition-colors hover:border-primary/35",
                      !s.isActive && "bg-muted/20 opacity-75",
                      snippetUnknownVariables.length > 0 && "border-destructive/35 bg-destructive/[0.03]",
                    )}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono text-sm font-semibold text-primary">/{s.shortcut}</span>
                          <span className="font-medium text-foreground">{s.title}</span>
                          {!s.isActive && <Badge variant="outline" className="text-[10px]">{tr("inactive")}</Badge>}
                          {snippetUnknownVariables.length > 0 && <Badge variant="destructive" className="text-[10px]">{tr("invalidSnippet")}</Badge>}
                          <span className="text-[11px] text-muted-foreground">{s.usageCount} {tr("used")}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {appliesEverywhere ? (
                            <Badge variant="secondary" className="text-[10px]">{tr("allChannels")}</Badge>
                          ) : (
                            snippetChannels.map((c) => (
                              <span key={c} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", channelColor(c))}>
                                <ChannelIcon channel={c} className="h-3 w-3" /> {channelLabel(c)}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-1 lg:justify-start">
                        <Button size="sm" variant="outline" onClick={() => openEdit(s)} title={tr("edit")}><Pencil className="mr-1.5 h-4 w-4" />{tr("edit")}</Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => remove(s.id)} title={tr("del")}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border bg-card p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">{tr("previewLabel")}</p>
                        <p className="min-h-[58px] whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {renderSnippetPreview(s.body, locale)}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">{tr("rawLabel")}</p>
                        <p className="min-h-[58px] whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                          {s.body}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{tr("variablesFound")}:</span>
                      {snippetTokens.length > 0 ? (
                        snippetTokens.map((token) => (
                          <Badge key={token} variant={snippetUnknownVariables.includes(token) ? "destructive" : "secondary"} className="font-mono text-[10px]">
                            {token}
                          </Badge>
                        ))
                      ) : (
                        <span>{tr("noVariables")}</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      <Dialog open={open} onOpenChange={setOpen} widthClassName="max-w-6xl" maxHeightClassName="max-h-[92vh]">
        <DialogContent className="p-0">
          <DialogHeader className="border-b bg-card/80 pr-14">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <DialogTitle>{editingId ? tr("edit") : tr("newOne")}</DialogTitle>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{tr("variablesDesc")}</p>
              </div>
              <Badge variant="brand" className="font-mono">
                /{form.shortcut.trim() || tr("shortcut").toLowerCase()}
              </Badge>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="space-y-5 p-6">
              <div className="grid gap-2 sm:grid-cols-3">
                {guideSteps.map((step) => (
                  <div key={step.title} className="rounded-xl border bg-muted/30 p-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">{step.title}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="space-y-1.5">
                  <Label>{tr("shortcut")}</Label>
                  <Input
                    value={form.shortcut}
                    onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
                    placeholder="greeting"
                    className={shortcutInvalid ? "border-destructive focus-visible:ring-destructive/30" : undefined}
                  />
                  <p className={cn("text-xs", shortcutInvalid ? "text-destructive" : "text-muted-foreground")}>
                    {shortcutInvalid ? tr("shortcutInvalid") : tr("shortcutHint")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{tr("title")}</Label>
                  <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">{tr("titleHint")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <Label>{tr("composer")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{tr("bodyHint")}</p>
                  </div>
                  {smsRelevant && (
                    <span className="rounded-full border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                      SMS: {smsChars}/160{smsSegments > 1 ? ` · ${smsSegments}` : ""}
                    </span>
                  )}
                </div>
                <Textarea
                  ref={bodyRef}
                  rows={7}
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Hi {{contact.name}}, ..."
                  className="min-h-[190px] resize-y text-sm leading-relaxed"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {insertedVariables.length > 0 ? (
                    insertedVariables.map((token) => (
                      <Badge key={token} variant={unknownVariables.includes(token) ? "destructive" : "secondary"} className="font-mono">
                        {token}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">{tr("noVariables")}</span>
                  )}
                </div>
              </div>

              {unknownVariables.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">{tr("unknownVariables")}: {unknownVariables.join(", ")}</p>
                      <p className="mt-1 text-xs text-destructive/80">{tr("unknownVariablesHint")}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{tr("channels")}</Label>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                        form.channelTypes.includes(ch)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <ChannelIcon channel={ch} className="h-3.5 w-3.5" /> {channelLabel(ch)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{tr("channelsHint")} · {channelSummary}</p>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
                  <div>
                    <Label className="cursor-pointer">{tr("active")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{tr("activeHint")}</p>
                  </div>
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <aside className="space-y-4 border-t bg-muted/30 p-6 lg:border-l lg:border-t-0">
              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{tr("variables")}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr("variablesDesc")}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {ADVERTISED_VARIABLES.map((variable) => {
                    const Icon = variable.icon
                    return (
                      <button
                        key={variable.token}
                        type="button"
                        onClick={() => insertVariable(variable.token)}
                        title={tr("clickToInsert")}
                        className="group w-full rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        <div className="flex items-start gap-3">
                          <span className="rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-foreground">{variable.label[locale]}</span>
                              <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                            </span>
                            <span className="mt-0.5 block font-mono text-xs text-primary">{variable.token}</span>
                            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{variable.description[locale]}</span>
                            <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                              <span>{tr("variableWillBecome")}</span>
                              <span className="truncate font-medium text-foreground">{variable.sample[locale]}</span>
                            </span>
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-accent/10 p-2 text-accent">
                    <Eye className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{tr("preview")}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr("previewDesc")}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border bg-background p-3">
                  <p className={cn("min-h-[96px] whitespace-pre-wrap text-sm leading-relaxed", form.body.trim() ? "text-foreground" : "text-muted-foreground")}>
                    {form.body.trim() ? previewBody : tr("previewEmpty")}
                  </p>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs">
                  {unknownVariables.length === 0 ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-muted-foreground">{insertedVariables.length > 0 ? tr("variablesOk") : tr("noVariables")}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">{tr("saveBlocked")}</span>
                    </>
                  )}
                </div>
              </div>
            </aside>
          </div>

          <DialogFooter className="flex-col items-stretch sm:flex-row sm:items-center">
            <span className={cn("rounded-lg bg-muted/40 px-3 py-2 text-xs sm:mr-auto sm:bg-transparent sm:px-0 sm:py-0", canSave ? "text-emerald-700" : "text-muted-foreground")}>
              {saveReadinessText}
            </span>
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("cancel")}</Button>
            <Button onClick={save} disabled={!canSave || saving} title={!canSave ? saveReadinessText : undefined}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tr("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
