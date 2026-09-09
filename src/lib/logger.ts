import pino from "pino"

interface LoggerContext {
  org_id?: string
  user_id?: string
  module?: string
  request_id?: string
}

const isDev = process.env.NODE_ENV === "development"

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
    transport: isDev
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  }
)

export function createLogger(context: LoggerContext = {}) {
  return logger.child(context)
}

export function logInfo(message: string, context?: LoggerContext): void {
  createLogger(context).info(message)
}

export function logWarn(message: string, context?: LoggerContext): void {
  createLogger(context).warn(message)
}

export function logError(
  message: string,
  error?: Error,
  context?: LoggerContext
): void {
  createLogger(context).error(error, message)
}

export function logDebug(message: string, context?: LoggerContext): void {
  createLogger(context).debug(message)
}

export default logger
