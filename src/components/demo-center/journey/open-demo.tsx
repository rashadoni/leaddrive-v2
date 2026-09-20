"use client"

import { PROSPECT_TO_CLOSED_WON, type DemoProspectIdentity } from "@/lib/demo-center/journey"
import { DemoJourneyPlayer } from "./demo-journey-player"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * The demo anyone can open.
 *
 * No email, no code, no approval, and no landing card to click through: the
 * visitor arrives and the story is already on screen — the way the reference
 * product put "Getting Started" next to Home rather than behind a gate.
 *
 * Two things stay switched off here, and both were switched off in the
 * reference too: the assistant (it is a paid call, and nobody has verified
 * who is asking — the reference kept its own assistant behind an explicit
 * activation) and the guide clips (those are the product's help library, not
 * public marketing assets). Both are named in the UI rather than quietly
 * missing, with the private demo offered as the way to get them.
 *
 * `name`/`company` only personalise who the lead in the story is. They come
 * from the visitor's own browser, are never posted anywhere, and fall back
 * to a sample when empty.
 */

const SAMPLE: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "ni•••@xezerlogistika.az",
  phoneMasked: "+994 ••••• 67",
  sourceChannel: "instagram",
}

export function OpenDemo({ name, company }: { name?: string; company?: string }) {
  const identity: DemoProspectIdentity = {
    ...SAMPLE,
    name: name?.trim().slice(0, 80) || SAMPLE.name,
    company: company?.trim().slice(0, 120) || SAMPLE.company,
  }

  return (
    <DemoJourneyPlayer
      variant="open"
      // Not a capability token: the open demo has no grant. It only keys this
      // browser's saved progress, so a refresh resumes the story.
      token="open-demo"
      manifest={PROSPECT_TO_CLOSED_WON}
      identity={identity}
      company={identity.company}
      watermark={`${identity.company} · ${S.badgeOpen}`}
    />
  )
}
