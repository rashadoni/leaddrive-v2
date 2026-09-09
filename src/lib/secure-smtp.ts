import nodemailer from "nodemailer"
import { isPrivateHost } from "@/lib/url-validation"

export type SecureSmtpConfig = {
  host: string
  port: number
  user?: string
  pass?: string
  tls?: boolean
}

export function assertSafeMailHeaderValue(label: string, value: string): string {
  if (/\r|\n/.test(value)) {
    throw new Error(`${label} contains a forbidden line break`)
  }
  return value
}

export function sanitizeMailHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const safe: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      throw new Error("Email header name contains forbidden characters")
    }
    safe[name] = assertSafeMailHeaderValue(`Email header ${name}`, value)
  }
  return safe
}

export function createSecureSmtpTransport(config: SecureSmtpConfig) {
  const host = assertSafeMailHeaderValue("SMTP host", config.host.trim())
  if (!host || isPrivateHost(host)) {
    throw new Error("SMTP host points to a private/internal network or is empty")
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("SMTP port is invalid")
  }

  return nodemailer.createTransport({
    host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
    tls: config.tls === false ? undefined : { rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    // Nodemailer must never dereference a message-supplied path or URL. Callers
    // materialize approved local attachments into Buffer content first.
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}
