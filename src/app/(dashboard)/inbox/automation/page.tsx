import { redirect } from "next/navigation"

/**
 * «Автоматизация» was merged into «Автоответы» (owner, 2026-11-27: «Слить с автоответами»).
 * Its scenarios never ran for any organization — they waited for an organization flag that
 * nothing in the CRM could set — so the address leads to the page where auto-replies are
 * switched on and actually answer. The stored scenarios and team queues are left in place.
 */
export default function InboxAutomationMovedPage() {
  redirect("/inbox/chatbot-rules")
}
