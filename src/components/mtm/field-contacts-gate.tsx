"use client"

import type { ReactNode } from "react"
import { MtmFeatureGate } from "@/components/mtm/mtm-feature-gate"

/** Field contacts pages: the shared MTM feature notice (see MtmFeatureGate). */
export function FieldContactsGate({ children }: { children: ReactNode }) {
  return <MtmFeatureGate feature="fieldContactsEnabled">{children}</MtmFeatureGate>
}
