"use client"

import CapabilitiesHelp from "./content"

const copy = {
  "title": "Using the overview",
  "intro": "Choose a task and a module card. Its details explain the purpose, current access and next step.",
  "access": "Understanding status",
  "accessText": "Available means you can access the module. Check external service connections separately in settings. This page does not purchase or activate modules.",
  "next": "Getting started",
  "nextText": "Open workspace takes you to the module. Configure opens its existing setup form. Administrators can discuss additional access with LeadDrive; employees contact their administrator.",
  "apps": "Previously installed apps",
  "appsText": "A separate page retains configuration, temporary disabling and removal for previously installed apps. Unprepared new packages are not offered in the overview."
}

export default function CapabilitiesHelpEn() {
  return <CapabilitiesHelp copy={copy} />
}
