import pino, { type DestinationStream } from "pino"
import { privateLogBindings, privateLogEvent, privateLogMessage } from "./telemetry/pino-privacy"

interface LoggerContext {
  org_id?: string
  user_id?: string
  module?: string
  request_id?: string
}

const isDev = process.env.NODE_ENV === "development"

export function createPrivacyLogger(destination?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
    base: undefined,
    formatters: { bindings: privateLogBindings },
    hooks: {
      logMethod(args, method) {
        const event = privateLogEvent(args[0])
        method.call(this, event, privateLogMessage(event))
      },
    },
    transport: isDev && !destination
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
  const instance = destination ? pino(options, destination) : pino(options)
  return privacyFacade(instance)
}

/** Expose only the operations used by application consumers. Pino child()
 * resets its bindings formatter, so sanitize BEFORE child serialization and
 * retain the same boundary for nested children. Runtime mutation APIs and
 * arbitrary child options have no reviewed application contract.
 */
function privacyFacade(instance: pino.Logger): PrivacyLogger {
  return {
    info: instance.info.bind(instance),
    warn: instance.warn.bind(instance),
    error: instance.error.bind(instance),
    debug: instance.debug.bind(instance),
    child: (bindings: unknown) => privacyFacade(instance.child(privateLogBindings(bindings))),
  }
}

export interface PrivacyLogger {
  info: pino.LogFn
  warn: pino.LogFn
  error: pino.LogFn
  debug: pino.LogFn
  child: (bindings: unknown) => PrivacyLogger
}

const logger = createPrivacyLogger()

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
