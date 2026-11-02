/**
 * The demo's campaign list, filled like a working company's.
 *
 * Owner, 2026-10-13: the campaigns screen showed a row of zeros — one
 * campaign, the prospect's own, under status cards that read 0/0/0/1/0. The
 * list now carries the campaigns a marketing team has at any moment: a draft,
 * one scheduled to go out by itself, a few sent, one cancelled.
 *
 * Every name and figure is invented for the demo, and only what the product
 * has: its four campaign types (`src/lib/campaigns/send-campaign.ts`), its
 * statuses, recipients and sends. Opens and clicks exist for e-mail only, as
 * the product records them; the cards show none of them.
 *
 * Pure data; the prospect's own campaign comes from the journey records.
 */
import type { DemoCampaignType } from "./records"

export type DemoSampleCampaignStatus = "draft" | "scheduled" | "sent" | "cancelled"

export interface DemoSampleCampaign {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly type: DemoCampaignType
  readonly status: DemoSampleCampaignStatus
  readonly audience: number
  readonly sent: number
  /** Entered for the campaign; shown on the card while it has not gone out. */
  readonly budget: number
}

export const DEMO_SAMPLE_CAMPAIGNS: readonly DemoSampleCampaign[] = [
  {
    id: "cmp-sample-satisfaction",
    name: "E-poçt: müştəri məmnuniyyəti sorğusu",
    description: "Ötən rübün müştərilərinə NPS sorğusu",
    type: "email",
    status: "sent",
    audience: 1840,
    sent: 1829,
    budget: 0,
  },
  {
    id: "cmp-sample-webinar",
    name: "Telegram: vebinar dəvəti",
    description: "Planlaşdırılıb — vaxtı çatanda özü göndəriləcək",
    type: "telegram",
    status: "scheduled",
    audience: 860,
    sent: 0,
    budget: 150,
  },
  {
    id: "cmp-sample-catalog",
    name: "WhatsApp: yeni kataloq",
    description: "Təsdiqlənmiş şablonla, razılıq verən müştərilərə",
    type: "whatsapp",
    status: "sent",
    audience: 312,
    sent: 310,
    budget: 120,
  },
  {
    id: "cmp-sample-payment",
    name: "SMS: ödəniş xatırlatması",
    description: "Ödəniş tarixi yaxınlaşan müştərilərə",
    type: "sms",
    status: "sent",
    audience: 420,
    sent: 420,
    budget: 84,
  },
  {
    id: "cmp-sample-newyear",
    name: "E-poçt: Yeni il təklifləri",
    description: "Mətn hazırlanır",
    type: "email",
    status: "draft",
    audience: 2140,
    sent: 0,
    budget: 600,
  },
  {
    id: "cmp-sample-holiday",
    name: "SMS: bayram təbriki",
    description: "Ləğv edildi — e-poçtla göndərilməsi qərara alındı",
    type: "sms",
    status: "cancelled",
    audience: 950,
    sent: 0,
    budget: 190,
  },
]
