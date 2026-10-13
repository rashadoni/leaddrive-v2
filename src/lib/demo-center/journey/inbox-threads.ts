/**
 * The demo inbox, filled like a working company's.
 *
 * Owner, 2026-10-13, after walking his own demo: Omni Channel is the product
 * he advertises, and its demo showed one Instagram conversation in an empty
 * list with «1» on every counter — the one screen whose whole point is «all
 * channels in one window» showed a single channel.
 *
 * Every person, company and sentence below is invented for the demo. The
 * channels are the product's own keys (`src/lib/inbox-channels.tsx`), so the
 * scene draws them with the product's own icons and labels, and nothing is
 * shown that the real inbox does not have: a row carries a channel icon, an
 * unread count and the «Cavabsız» pill — no SLA timer, no assignee avatar.
 *
 * Pure data: the scene decides what is visible; the story's own conversation
 * (the prospect's request) is not here — it comes from the journey records.
 */
import type { DemoSourceChannel } from "./records"

export type DemoInboxChannel = "email" | "telegram" | "sms" | "whatsapp" | "facebook" | "instagram" | "tiktok" | "web-chat"

/** Who a thread is assigned to, from the seat the prospect sits in (the manager's). */
export type DemoInboxAssignee = "me" | "colleague" | null

export interface DemoInboxMessage {
  readonly id: string
  /** `note` is an internal team note: the customer never sees it. */
  readonly from: "customer" | "ai" | "operator" | "note"
  /** Operator or note author; absent for the customer and the AI agent. */
  readonly author?: string
  readonly text: string
  readonly minutesAgo: number
}

export interface DemoInboxThread {
  readonly id: string
  readonly contactName: string
  readonly companyName: string | null
  readonly channel: DemoInboxChannel
  readonly unread: number
  /** The last word is the customer's — the product's red «Cavabsız» pill. */
  readonly unanswered: boolean
  readonly assignee: DemoInboxAssignee
  readonly colleagueName?: string
  /** The AI agent answered here — what the «Çatbot» view collects. */
  readonly botHandled: boolean
  readonly messages: readonly DemoInboxMessage[]
}

/** Colleagues a conversation can be handed to. */
export const DEMO_INBOX_COLLEAGUES = ["Tural Əhmədov", "Səbinə Rzayeva"] as const

export const DEMO_INBOX_THREADS: readonly DemoInboxThread[] = [
  {
    id: "wa-delivery",
    contactName: "Rəşad Quliyev",
    companyName: "Abşeron Market",
    channel: "whatsapp",
    unread: 2,
    unanswered: true,
    assignee: null,
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Salam. Dünən verdiyim sifariş nə vaxt çatdırılacaq?", minutesAgo: 9 },
      { id: "m2", from: "customer", text: "Sifariş nömrəsi 4471-dir.", minutesAgo: 8 },
    ],
  },
  {
    id: "ig-price",
    contactName: "Günel Hüseynova",
    companyName: null,
    channel: "instagram",
    unread: 0,
    unanswered: false,
    assignee: null,
    botHandled: true,
    messages: [
      { id: "m1", from: "customer", text: "Salam, qiymət siyahınızı göndərə bilərsiniz?", minutesAgo: 34 },
      { id: "m2", from: "ai", text: "Salam, Günel xanım! Qiymət komandanın ölçüsündən asılıdır. Neçə nəfər istifadə edəcək? Menecerimiz sizə uyğun təklif hazırlayar.", minutesAgo: 33 },
      { id: "m3", from: "customer", text: "Təxminən 12 nəfər.", minutesAgo: 30 },
      { id: "m4", from: "ai", text: "Təşəkkür edirəm. Sorğunuzu satış menecerinə ötürdüm — bu gün sizinlə əlaqə saxlayacaq.", minutesAgo: 30 },
    ],
  },
  {
    id: "tg-contract",
    contactName: "Elçin Məmmədli",
    companyName: "Qafqaz Tikinti MMC",
    channel: "telegram",
    unread: 0,
    unanswered: false,
    assignee: "me",
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Müqaviləni imzaladıq, skan göndərirəm.", minutesAgo: 95 },
      { id: "m2", from: "note", author: "Aysel Məmmədova", text: "@Tural hesab-fakturanı bu gün göndərək, ödəniş cümə günü olacaq.", minutesAgo: 90 },
      { id: "m3", from: "operator", author: "Aysel Məmmədova", text: "Təşəkkürlər, Elçin bəy! Hesab-fakturanı bu gün göndəririk.", minutesAgo: 88 },
    ],
  },
  {
    id: "em-quote",
    contactName: "Aygün Səfərova",
    companyName: "Bakı Tekstil MMC",
    channel: "email",
    unread: 1,
    unanswered: true,
    assignee: "colleague",
    colleagueName: "Tural Əhmədov",
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Təklif sorğusu: 40 istifadəçi üçün illik lisenziya və tətbiq xidmətinin qiymətini göndərməyinizi xahiş edirik.", minutesAgo: 140 },
    ],
  },
  {
    id: "fb-hours",
    contactName: "Kamran Əliyev",
    companyName: null,
    channel: "facebook",
    unread: 0,
    unanswered: false,
    assignee: null,
    botHandled: true,
    messages: [
      { id: "m1", from: "customer", text: "Ofisiniz şənbə günü işləyir?", minutesAgo: 185 },
      { id: "m2", from: "ai", text: "Salam! Şənbə günü 10:00–15:00 arası işləyirik. Görüş təyin etməyimi istəyirsiniz?", minutesAgo: 184 },
    ],
  },
  {
    id: "wc-demo",
    contactName: "Leyla Kərimova",
    companyName: "Nar Klinika",
    channel: "web-chat",
    unread: 1,
    unanswered: true,
    assignee: null,
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Salam, klinikamız üçün demo görmək istəyirik. Kimlə danışa bilərəm?", minutesAgo: 22 },
    ],
  },
  {
    id: "wa-payment",
    contactName: "Nərmin Abbasova",
    companyName: "Zirvə Logistika",
    channel: "whatsapp",
    unread: 0,
    unanswered: false,
    assignee: "me",
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Ödənişi etdim, qəbzi göndərirəm.", minutesAgo: 260 },
      { id: "m2", from: "operator", author: "Aysel Məmmədova", text: "Qəbul etdik, təşəkkür edirik! Giriş məlumatları e-poçtunuza göndərildi.", minutesAgo: 255 },
    ],
  },
  {
    id: "tt-product",
    contactName: "Orxan Nəbiyev",
    companyName: null,
    channel: "tiktok",
    unread: 0,
    unanswered: false,
    assignee: "colleague",
    colleagueName: "Səbinə Rzayeva",
    botHandled: false,
    messages: [
      { id: "m1", from: "customer", text: "Videodakı hesabat ekranı hansı paketə daxildir?", minutesAgo: 320 },
      { id: "m2", from: "operator", author: "Səbinə Rzayeva", text: "Salam, Orxan bəy! Hesabatlar bütün paketlərdə var. İstəsəniz, qısa demo göstərək.", minutesAgo: 300 },
    ],
  },
]

/** The inbox channel the prospect's own request arrives on. */
export function demoInboxChannelOf(source: DemoSourceChannel): DemoInboxChannel {
  switch (source) {
    case "instagram":
      return "instagram"
    case "whatsapp":
      return "whatsapp"
    case "website":
      return "web-chat"
    // A referral or an event lead is entered from a form; the reply goes by e-mail.
    case "referral":
    case "event":
      return "email"
  }
}
