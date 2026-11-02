"use client"

import Link from "next/link"
import { HelpSection } from "@/components/help/help-content"

interface CapabilitiesHelpCopy {
  title: string
  intro: string
  access: string
  accessText: string
  next: string
  nextText: string
  apps: string
  appsText: string
}

export default function CapabilitiesHelp({ copy }: { copy: CapabilitiesHelpCopy }) {
  return (
    <div className="space-y-6">
      <HelpSection title={copy.title}><p>{copy.intro}</p></HelpSection>
      <HelpSection title={copy.access}><p>{copy.accessText}</p></HelpSection>
      <HelpSection title={copy.next}><p>{copy.nextText}</p></HelpSection>
      <HelpSection title={copy.apps}>
        <p>{copy.appsText}</p>
        <Link href="/marketplace/apps" className="mt-3 inline-block underline underline-offset-4">{copy.apps}</Link>
      </HelpSection>
    </div>
  )
}
