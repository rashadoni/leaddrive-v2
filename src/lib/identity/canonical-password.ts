/** Shared credential format and public fictitious work factor, not a secret. */
export const IDENTITY_PASSWORD_DUMMY_HASH = "$2b$12$" + "A".repeat(53)
export const isCanonicalIdentityPasswordHash = (value: unknown): value is string =>
  typeof value === "string" && value.length === 60 && /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(value)
