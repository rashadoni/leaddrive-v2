/**
 * What a WhatsApp message says, in one reader.
 *
 * A Cloud API message carries its contents in an object named after its own `type`, and the thread
 * has to show something for a message that has no words at all — a sticker, a voice note, a pin on a
 * map. Those placeholders are what the operator reads in the inbox and what the AI reads as history,
 * so they must be the SAME text whoever received the message.
 *
 * Until coexistence there was one producer — the inbound webhook — and the switch lived inside it.
 * A number that also lives in the WhatsApp Business app on a phone brings a second one: every reply
 * the team types there arrives back as an `smb_message_echoes` webhook with exactly this shape
 * (`type` plus a type-named object), and an echo that said «[Image]» where an inbound message says
 * «[Изображение]» would quietly split one conversation into two vocabularies.
 */
export type WaMessageTextPayload = {
  type?: unknown
  text?: { body?: unknown }
  image?: { caption?: unknown }
  video?: { caption?: unknown }
  audio?: { caption?: unknown }
  voice?: { caption?: unknown }
  document?: { caption?: unknown; filename?: unknown }
  sticker?: { caption?: unknown }
  location?: { latitude?: unknown; longitude?: unknown }
  contacts?: unknown
  reaction?: { emoji?: unknown }
  button?: { text?: unknown }
  interactive?: {
    button_reply?: { title?: unknown }
    list_reply?: { title?: unknown }
    /** A form filled inside WhatsApp (Flows); its answers are one JSON string. */
    nfm_reply?: { response_json?: unknown; name?: unknown }
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * The thread text and the stored `messageType` for one message.
 *
 * `messageType` is Meta's own `type` (defaulting to `text` when absent), kept verbatim: it is what
 * decides media fetching and how the inbox renders the row, so it must not be normalised here.
 */
export function describeWaMessage(msg: WaMessageTextPayload): { text: string; messageType: string } {
  const messageType = str(msg.type) ?? "text"
  switch (msg.type) {
    case "text":
      return { text: str(msg.text?.body) ?? "", messageType }
    case "image":
      return { text: str(msg.image?.caption) ?? "[Изображение]", messageType }
    case "video":
      return { text: str(msg.video?.caption) ?? "[Видео]", messageType }
    case "audio":
      return { text: "[Аудио сообщение]", messageType }
    case "voice":
      return { text: "[Голосовое сообщение]", messageType }
    case "document":
      return {
        text: str(msg.document?.caption) ?? `[Документ: ${str(msg.document?.filename) ?? "file"}]`,
        messageType,
      }
    case "sticker":
      return { text: "[Стикер]", messageType }
    case "location":
      return { text: `[Локация: ${msg.location?.latitude}, ${msg.location?.longitude}]`, messageType }
    case "contacts":
      return { text: "[Контакт]", messageType }
    case "reaction":
      return { text: `[Реакция: ${msg.reaction?.emoji || ""}]`, messageType }
    case "button":
      return { text: str(msg.button?.text) ?? "[Кнопка]", messageType }
    case "interactive":
      return {
        text: str(msg.interactive?.button_reply?.title)
          ?? str(msg.interactive?.list_reply?.title)
          // A form carries no title to show: what the client picked is an id
          // only the booking agent can resolve, and it answers in the next
          // message of the thread. So the row says a form came back, with the
          // name typed into it when there is one.
          ?? (str(msg.interactive?.nfm_reply?.response_json) ? `[Форма${formName(msg.interactive?.nfm_reply?.response_json)}]` : null)
          ?? "[Интерактив]",
        messageType,
      }
    default:
      return { text: `[${str(msg.type) ?? "unknown"}]`, messageType }
  }
}

/** «: Rəşad» when the form carried a name, nothing when it did not. */
function formName(responseJson: unknown): string {
  if (typeof responseJson !== "string") return ""
  try {
    const parsed = JSON.parse(responseJson) as Record<string, unknown>
    const name = typeof parsed?.client === "string" ? parsed.client.trim() : ""
    return name ? `: ${name.slice(0, 60)}` : ""
  } catch {
    return ""
  }
}
