import { redirect } from "next/navigation"

/**
 * The employees' Telegram bot moved into the channel catalog on 2026-10-26 (owner: one place for every channel,
 * in Settings). This address stays so bookmarks and older links keep working.
 */
export default function TelegramBotSettingsMovedPage() {
  redirect("/settings/channels/telegram-staff")
}
