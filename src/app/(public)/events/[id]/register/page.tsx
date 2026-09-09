"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"

const TYPE_EMOJI: Record<string, string> = {
  conference: "🎤", webinar: "💻", workshop: "🔧", meetup: "☕", exhibition: "🏛️", other: "📋",
}

export default function EventRegistrationPage() {
  const t = useTranslations("eventRegistration")
  const locale = useLocale()
  const params = useParams()
  const [event, setEvent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", notes: "",
  })

  useEffect(() => {
    fetch(`/api/v1/public/events/${params.id}/register`)
      .then(r => r.json())
      .then(json => { if (json.success) setEvent(json.data) })
      .finally(() => setLoading(false))
  }, [params.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) return setError(t("errorRequired"))
    setSubmitting(true)
    setError("")

    try {
      const res = await fetch(`/api/v1/public/events/${params.id}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Registration failed")
      setSuccess(true)
    } catch (e: any) {
      setError(e.message)
    } finally { setSubmitting(false) }
  }

  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="h-8 w-48 bg-muted rounded mx-auto mb-4" />
          <div className="h-4 w-32 bg-muted rounded mx-auto" />
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h1 className="text-2xl font-bold text-foreground">{t("notFound")}</h1>
          <p className="text-muted-foreground mt-2">{t("notFoundDesc")}</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-7xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-foreground mb-2">{t("confirmed")}</h1>
          <p className="text-muted-foreground mb-6">
            {t("confirmedDesc", { name: event.name })}
          </p>
          <div className="bg-card rounded-2xl shadow-lg p-6 text-left space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <p className="text-xs text-muted-foreground uppercase">{t("date")}</p>
                <p className="font-semibold">{new Date(event.startDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</p>
              </div>
            </div>
            {event.location && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">📍</span>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">{t("location")}</p>
                  <p className="font-semibold">{event.location}</p>
                </div>
              </div>
            )}
            {event.isOnline && event.meetingUrl && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔗</span>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">{t("joinOnline")}</p>
                  <a href={event.meetingUrl} className="font-semibold text-indigo-600 hover:underline" target="_blank">{event.meetingUrl}</a>
                </div>
              </div>
            )}
          </div>

          {/* Calendar note */}
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-left">
            <p className="font-semibold mb-1">{t("checkEmail")}</p>
            <p className="text-amber-700 text-xs">{t("checkEmailDesc")}</p>
          </div>
        </div>
      </div>
    )
  }

  const canRegister = event.canRegister && !event.isFull
  const spotsLeft = event.maxParticipants ? event.maxParticipants - event.registeredCount : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white">
        <div className="max-w-3xl mx-auto px-4 py-12 md:py-16 text-center">
          <div className="text-5xl mb-4">{TYPE_EMOJI[event.type] || "📋"}</div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{event.name}</h1>
          <div className="flex items-center justify-center gap-4 text-sm opacity-90 flex-wrap">
            <span className="flex items-center gap-1.5">
              📅 {formatDate(event.startDate, locale, { day: "numeric", month: "long", year: "numeric" })}
            </span>
            {event.location && <span className="flex items-center gap-1.5">📍 {event.location}</span>}
            {event.isOnline && <span className="flex items-center gap-1.5">🌐 Online</span>}
          </div>
          {spotsLeft !== null && spotsLeft > 0 && (
            <div className="mt-4 inline-block bg-white/20 rounded-full px-4 py-1.5 text-sm font-medium backdrop-blur-sm">
              {t("spotsRemaining", { count: spotsLeft })}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-8">
        <div className="grid md:grid-cols-5 gap-6">
          {/* Registration Form */}
          <div className="md:col-span-3">
            <div className="bg-card rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-xl font-bold text-foreground mb-1">{t("registerNow")}</h2>
              <p className="text-sm text-muted-foreground mb-6">{t("registerDesc")}</p>

              {!canRegister ? (
                <div className="text-center py-8">
                  <div className="text-5xl mb-4">{event.isFull ? "😔" : "🔒"}</div>
                  <h3 className="text-lg font-bold text-foreground/70">
                    {event.isFull ? t("eventFull") : t("registrationClosed")}
                  </h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    {event.isFull ? t("eventFullDesc") : t("registrationClosedDesc")}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">{t("labelName")}</label>
                    <input
                      type="text" required value={form.name} onChange={e => set("name", e.target.value)}
                      className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                      placeholder={t("placeholderName")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">{t("labelEmail")}</label>
                    <input
                      type="email" required value={form.email} onChange={e => set("email", e.target.value)}
                      className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground/70 mb-1">{t("labelPhone")}</label>
                      <input
                        type="tel" value={form.phone} onChange={e => set("phone", e.target.value)}
                        className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                        placeholder="+994..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/70 mb-1">{t("labelCompany")}</label>
                      <input
                        type="text" value={form.company} onChange={e => set("company", e.target.value)}
                        className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                        placeholder={t("placeholderCompany")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/70 mb-1">{t("labelNotes")}</label>
                    <textarea
                      value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
                      className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm resize-none"
                      placeholder={t("placeholderNotes")}
                    />
                  </div>

                  {error && (
                    <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit" disabled={submitting}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold py-3.5 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-60"
                  >
                    {submitting ? t("registering") : t("registerForEvent")}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Event Info Sidebar */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card rounded-2xl shadow-lg p-5">
              <h3 className="font-bold text-foreground mb-3">{t("eventDetails")}</h3>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3">
                  <span className="text-lg">📅</span>
                  <div>
                    <p className="text-muted-foreground text-xs">{t("dateTime")}</p>
                    <p className="font-medium">{new Date(event.startDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</p>
                    {event.endDate && (
                      <p className="text-muted-foreground text-xs mt-0.5">
                        to {new Date(event.endDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}
                      </p>
                    )}
                  </div>
                </div>
                {event.location && (
                  <div className="flex gap-3">
                    <span className="text-lg">📍</span>
                    <div>
                      <p className="text-muted-foreground text-xs">{t("location")}</p>
                      <p className="font-medium">{event.location}</p>
                    </div>
                  </div>
                )}
                {event.isOnline && (
                  <div className="flex gap-3">
                    <span className="text-lg">🌐</span>
                    <div>
                      <p className="text-muted-foreground text-xs">{t("format")}</p>
                      <p className="font-medium">{t("onlineEvent")}</p>
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <span className="text-lg">👥</span>
                  <div>
                    <p className="text-muted-foreground text-xs">{t("registered")}</p>
                    <p className="font-medium">
                      {t("participants", { count: event.registeredCount })}
                      {event.maxParticipants ? ` / ${event.maxParticipants} max` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {event.description && (
              <div className="bg-card rounded-2xl shadow-lg p-5">
                <h3 className="font-bold text-foreground mb-2">{t("about")}</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
              </div>
            )}

            {event.tags?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {event.tags.map((tag: string) => (
                  <span key={tag} className="bg-card shadow-sm px-3 py-1 rounded-full text-xs font-medium text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-8 text-xs text-muted-foreground">
          {t("poweredBy")}
        </div>
      </div>
    </div>
  )
}
