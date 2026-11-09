import { defaultLocale, locales, type Locale } from "@/i18n/routing"

// What the bell (and its push) says about a task. Until 2026-11-09 these were
// fixed strings — «New Task» / «Task created: …» and «Task Completed» in
// English, «Вам назначена задача» in Russian — so an Azerbaijani screen showed
// English pop-ups (found while recording the Boards video guide).
//
// The language is the recipient's own (User.preferredLanguage); most people
// never set one (46 of 51 in the two live tenants on 2026-11-09), so next comes
// the language of the person who acted — the screen they acted in, which in a
// tenant is its working language — and only then the app default.

export type TaskNotificationKind = "created" | "assigned" | "completed"

const TEXT: Record<Locale, {
  title: Record<TaskNotificationKind, string>
  created: (title: string) => string
  completed: (title: string) => string
  urgent: Record<"urgent" | "critical", string>
}> = {
  az: {
    title: { created: "Yeni tapşırıq", assigned: "Sizə tapşırıq təyin olundu", completed: "Tapşırıq tamamlandı" },
    created: (title) => `Tapşırıq yaradıldı: «${title}»`,
    completed: (title) => `Tamamlandı: «${title}»`,
    urgent: { urgent: "Təcili", critical: "Kritik" },
  },
  ru: {
    title: { created: "Новая задача", assigned: "Вам назначена задача", completed: "Задача выполнена" },
    created: (title) => `Создана задача: «${title}»`,
    completed: (title) => `Выполнена: «${title}»`,
    urgent: { urgent: "Срочно", critical: "Критично" },
  },
  en: {
    title: { created: "New task", assigned: "A task was assigned to you", completed: "Task completed" },
    created: (title) => `Task created: "${title}"`,
    completed: (title) => `Completed: "${title}"`,
    urgent: { urgent: "Urgent", critical: "Critical" },
  },
}

const known = (value: string | null | undefined): value is Locale => locales.includes(value as Locale)

/** Recipient's language, else the actor's screen language, else the app default. */
export function taskNotificationLocale(recipientLanguage?: string | null, actorLocale?: string | null): Locale {
  if (known(recipientLanguage)) return recipientLanguage
  if (known(actorLocale)) return actorLocale
  return defaultLocale
}

export function taskNotificationText(
  kind: TaskNotificationKind,
  locale: Locale,
  task: { title: string; priority?: string | null },
): { title: string; message: string } {
  const text = TEXT[locale]
  if (kind === "assigned") return { title: text.title.assigned, message: task.title }
  if (kind === "completed") return { title: text.title.completed, message: text.completed(task.title) }
  const urgency = task.priority === "urgent" || task.priority === "critical" ? text.urgent[task.priority] : null
  return { title: text.title.created, message: `${text.created(task.title)}${urgency ? ` (${urgency})` : ""}` }
}
