"use client"

/**
 * Your own Gemini key — help article (English). For administrators only: it is
 * opened from «Settings → AI and spend». The Google steps follow the Google AI
 * Studio docs (key and billing), read on 2026-11-23.
 */
import { HelpCallout, HelpDef, HelpKey, HelpScenario, HelpSection, HelpStep } from "@/components/help/help-content"

export default function AiOwnKeyHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Organization administrator" goal="Pay Google for AI directly: connect your own Gemini key">
        By default the AI runs on the LeadDrive key and there is nothing to do. You need your own key only if
        you decided to pay Google yourself. You will need the company&apos;s Google account and a bank card.
      </HelpScenario>

      <HelpSection title="What changes">
        <dl className="rounded-md border p-3">
          <HelpDef term="Runs on your key">The AI&apos;s conversation in phone calls and the voice assistant. Google bills you for them.</HelpDef>
          <HelpDef term="Stays on the LeadDrive key">The line&apos;s voice and speech recognition in calls.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step">
        <HelpStep n={1}>
          <p>Open <HelpKey>aistudio.google.com/apikey</HelpKey> and sign in to the company&apos;s Google account.</p>
          <HelpCallout kind="see" label="What you'll see">The API keys page. For a new user Google creates a project and a first key itself once you accept the terms.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>If there is no key in the list, click <HelpKey>Create API key</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">A new key in the list.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Turn billing on: in the project&apos;s row, in the <HelpKey>Billing Tier</HelpKey> column, click <HelpKey>Set up billing</HelpKey>. Enter the country and the card and prepay (from 5 dollars).</p>
          <HelpCallout kind="see" label="What you'll see">The project moved from the free tier to the paid one. The free tier&apos;s limits are small — calls need the paid tier.</HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Copy the whole key.</p>
        </HelpStep>
        <HelpStep n={5}>
          <p>In the CRM open <HelpKey>Settings</HelpKey> → <HelpKey>AI and spend</HelpKey>. In the <HelpKey>AI provider keys</HelpKey> block, in the Gemini row, click <HelpKey>Enter your own key</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The «Gemini key» field.</HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>Paste the key and click <HelpKey>Check and save</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">In the Gemini row — «Your key» and its last 4 characters. If Google refuses the key, the CRM says so and saves nothing.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="How to check it works">
        <p>After the next call or conversation with the assistant open the spend table on this same screen: the row&apos;s <HelpKey>Whose key</HelpKey> column says «Your key».</p>
      </HelpSection>

      <HelpSection title="Back to how it was">
        <p>In the Gemini row click <HelpKey>Remove key</HelpKey>. The AI runs on the LeadDrive key again.</p>
      </HelpSection>

      <HelpCallout kind="warning" label="Important">
        If Google refuses your key during a call (for example the account ran out of money), the call is not cut off: it runs on the LeadDrive key and is counted as spend on the LeadDrive key.
      </HelpCallout>
      <HelpCallout kind="security" label="Security">
        The key is stored encrypted. Only its last 4 characters are shown, and only to administrators.
      </HelpCallout>
    </div>
  )
}
