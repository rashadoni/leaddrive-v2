export class BookingCommandError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "BookingCommandError" }
}
