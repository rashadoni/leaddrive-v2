import type {
  DemoJourneyAction,
  DemoJourneyManifest,
  DemoJourneyReduceResult,
  DemoJourneySection,
  DemoJourneySnapshot,
  DemoJourneyStep,
} from "@/lib/demo-center/journey"
import type { DemoWhatsAppTicketView } from "@/lib/demo-center/demo-whatsapp-ticket-view"
import type { DemoSocialInboxView } from "@/lib/demo-center/demo-social"

/**
 * Who is looking at the demo.
 *
 * `granted` is a prospect on a watermarked, expiring link; `preview` is the
 * owner reviewing it from admin; `open` is anyone at all on the public page.
 * Scenes need this because some of what they say is only true for one of
 * them — the orientation screen called every visitor's session private until
 * the open demo shipped and told a public page it was confidential.
 */
export type DemoJourneyVariant = "granted" | "preview" | "open"

/**
 * What every scene receives. Scenes render from the snapshot only, dispatch
 * journey actions for real changes, and use `hint` when the prospect clicks
 * something the current step does not ask for. They never fetch.
 */
export interface DemoSceneProps {
  manifest: DemoJourneyManifest
  snapshot: DemoJourneySnapshot
  /** Section displayed (frontier, or an earlier one in review mode). */
  section: DemoJourneySection
  /** Frontier step when it belongs to the displayed section, else null. */
  step: DemoJourneyStep | null
  reviewMode: boolean
  variant: DemoJourneyVariant
  dispatch: (action: DemoJourneyAction) => DemoJourneyReduceResult
  hint: (message: string) => void
  /** Opens a section ahead of the story, staging what lies in between (the orientation's «Nədən başlayaq?»). */
  openSection?: (sectionId: string) => void
  /** Live data the page already reads — scenes still never fetch. */
  live?: DemoSceneLive
}

/** What the page reads live for the scenes. */
export interface DemoSceneLive {
  /** The real ticket the prospect's own WhatsApp opened in LeadDrive's Service Desk, in its customer's view. */
  whatsappTicket: DemoWhatsAppTicketView | null
  /** The prospect's own Facebook Page, once connected: the real Facebook row of the inbox. */
  social?: DemoSocialInboxView | null
}
