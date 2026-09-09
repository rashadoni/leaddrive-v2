// LeadDrive CRM — VoIP Provider Factory

import type { VoipProvider, VoipSettings } from "./types"
import { TwilioProvider } from "./providers/twilio"
import { ThreeCxProvider } from "./providers/threecx"
import { AsteriskProvider } from "./providers/asterisk"
import { CustomSipProvider } from "./providers/custom-sip"

/**
 * Create a VoIP provider adapter based on the settings.provider field.
 * Defaults to Twilio if provider is not specified.
 */
export function getVoipProvider(settings: VoipSettings): VoipProvider {
  switch (settings.provider) {
    case "twilio":
      return new TwilioProvider(settings)
    case "threecx":
      return new ThreeCxProvider(settings)
    case "asterisk":
      return new AsteriskProvider(settings)
    case "custom-sip":
      return new CustomSipProvider(settings)
    default:
      // Fallback for legacy configs that don't have provider field
      return new TwilioProvider(settings as any)
  }
}
