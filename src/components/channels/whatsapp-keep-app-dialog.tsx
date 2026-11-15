"use client"

import { BadgeCheck, CheckCircle2, QrCode, ShieldCheck } from "lucide-react"
import { Dialog, DialogTitle } from "@/components/ui/dialog"

/**
 * «WhatsApp Business-i qoşun» — what happens, said before Meta's window opens.
 *
 * Laid out after the owner's approved mock-up (omni-reel/screens, 2026-11-15). The QR code itself is
 * Meta's: it appears in Meta's own window, which only Meta may draw, so the right half of this one is
 * the way there, not a picture of a code that would scan to nothing. The button opens that window
 * inside the click — a popup opened later is blocked by the browser.
 */
type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  title: string; subtitle: string; steps: [string, string, string]; gets: [string, string, string]
  provider: string; qrNote: string; go: string; secure: string; elseNote: string; cancel: string
}> = {
  az: {
    title: "WhatsApp Business-i qoşun",
    subtitle: "Nömrəniz dəyişmir, tətbiq telefonda qalır",
    steps: ["Telefonda WhatsApp Business tətbiqini açın", "Meta pəncərəsindəki QR-kodu tətbiqlə skan edin", "Hazırdır — mesajlar həm telefona, həm bura gəlir"],
    gets: ["WhatsApp telefonunuzda işləməyə davam edir", "Kontaktlarınız LeadDrive-a köçürülür", "Son 6 ayın yazışmaları gəlir"],
    provider: "LeadDrive — Meta-nın rəsmi texnologiya provayderi (Tech Provider)",
    qrNote: "QR-kod Meta-nın təhlükəsiz pəncərəsində açılacaq",
    go: "Meta ilə davam et",
    secure: "Meta ilə təhlükəsiz qoşulma",
    elseNote: "Meta kod əvəzinə tətbiqə mesaj göndərsə, qoşulmanı orada təsdiqləyin və tarixçəni paylaşmağa icazə verin.",
    cancel: "Bağla",
  },
  ru: {
    title: "Подключите WhatsApp Business",
    subtitle: "Номер не меняется, приложение остаётся в телефоне",
    steps: ["Откройте приложение WhatsApp Business на телефоне", "Отсканируйте приложением QR-код в окне Meta", "Готово — сообщения приходят и в телефон, и сюда"],
    gets: ["WhatsApp продолжает работать на вашем телефоне", "Ваши контакты переносятся в LeadDrive", "Приходит переписка за последние 6 месяцев"],
    provider: "LeadDrive — официальный поставщик технологий Meta (Tech Provider)",
    qrNote: "QR-код откроется в защищённом окне Meta",
    go: "Продолжить с Meta",
    secure: "Безопасное подключение через Meta",
    elseNote: "Если вместо кода Meta пришлёт сообщение в приложение — подтвердите подключение там и разрешите поделиться историей.",
    cancel: "Закрыть",
  },
  en: {
    title: "Connect WhatsApp Business",
    subtitle: "Your number stays the same, the app stays on the phone",
    steps: ["Open the WhatsApp Business app on your phone", "Scan the QR code in Meta's window with the app", "Done — messages come to the phone and here"],
    gets: ["WhatsApp keeps working on your phone", "Your contacts move to LeadDrive", "The last 6 months of chats come over"],
    provider: "LeadDrive is an official Meta Tech Provider",
    qrNote: "The QR code opens in Meta's secure window",
    go: "Continue with Meta",
    secure: "Secure connection through Meta",
    elseNote: "If Meta sends a message to the app instead of a code, confirm the connection there and allow sharing the history.",
    cancel: "Close",
  },
}

function asLocale(locale: string): Locale {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

export function WhatsAppKeepAppDialog({
  open,
  locale,
  onOpenChange,
  onContinue,
}: {
  open: boolean
  locale: string
  onOpenChange: (open: boolean) => void
  /** Opens Meta's window — called inside the button's click. */
  onContinue: () => void
}) {
  const c = COPY[asLocale(locale)]
  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-[52rem]" mobileFullscreen>
      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1.25fr_1fr]" data-testid="whatsapp-keep-app-dialog">
        <div className="space-y-5 bg-card p-6 md:p-8">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-2xl font-bold leading-tight">{c.title}</DialogTitle>
              <p className="text-sm text-muted-foreground">{c.subtitle}</p>
            </div>
          </div>
          <ol className="space-y-3" data-testid="whatsapp-keep-app-steps">
            {c.steps.map((step, i) => (
              <li key={step} className="flex items-center gap-3 text-[15px] text-foreground">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            {c.gets.map((line) => (
              <div key={line} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />{line}</div>
            ))}
          </div>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground"><BadgeCheck className="h-4 w-4 shrink-0 text-blue-600" />{c.provider}</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 bg-[#0f2a4d] p-6 text-center text-white md:p-8">
          <div className="relative flex h-40 w-40 items-center justify-center rounded-2xl bg-white" aria-hidden>
            <QrCode className="h-28 w-28 text-slate-300" strokeWidth={1.2} />
            <span className="absolute inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>
            </span>
          </div>
          <p className="text-sm text-white/85">{c.qrNote}</p>
          <button
            type="button"
            data-crm-color-role="provider"
            data-dialog-initial-focus
            onClick={onContinue}
            className="w-full rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1ebe5b]"
          >
            {c.go}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5" />{c.secure}</span>
          <p className="text-[11px] leading-snug text-white/70">{c.elseNote}</p>
        </div>
      </div>
    </Dialog>
  )
}
